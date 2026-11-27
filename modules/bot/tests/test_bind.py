"""Binding a guild (contracts/bot.md, Binding a guild): the start, the single-use state, the
callback's checks against Discord and the platform, one transaction under unique keys, and the
way back to the event."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlsplit

from canccu_kit.testing.discord import MANAGE_GUILD, FakeGuild, FakeUser
from conftest import SHARED_ID, SIGNIN, Env


async def start(env: Env, host: str = "a.example.test", **body: Any) -> Any:
    async with env.client(host) as c:
        return await c.post("/api/bot/guild/bind", json=body or None, headers=env.admin())


async def callback(env: Env, query: dict[str, str], host: str = SIGNIN) -> Any:
    async with env.client(host) as c:
        return await c.get("/api/bot/install/callback", params=query)


def state_of(r: Any) -> str:
    return parse_qs(urlsplit(r.json()["authorize_url"]).query)["state"][0]


def organiser(env: Env, guild_name: str = "Demo Community") -> tuple[FakeUser, FakeGuild]:
    """A person whose platform user is u_org, owning a guild."""
    user = env.discord.add_user("Organiser")
    env.users.discord_ids["u_org"] = user.id
    return user, env.discord.add_guild(guild_name, owner_id=user.id)


async def bind(env: Env, user: FakeUser, guild: FakeGuild, app_id: str = SHARED_ID) -> Any:
    state = state_of(await start(env))
    code = env.discord.authorize(app_id, user.id, guild.id)
    return await callback(env, {"state": state, "code": code, "guild_id": guild.id})


async def test_the_start_names_discords_page_for_the_events_application(env: Env) -> None:
    r = await start(env, guild_id="100000000000000055")
    assert r.status_code == 200
    url = urlsplit(r.json()["authorize_url"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://discord.test/oauth2/authorize"
    query = parse_qs(url.query)
    assert query["client_id"] == [SHARED_ID]
    assert query["scope"] == ["bot applications.commands identify guilds"]
    assert query["redirect_uri"] == [f"https://{SIGNIN}/api/bot/install/callback"]
    assert query["guild_id"] == ["100000000000000055"]
    assert len(query["state"][0]) >= 32
    assert r.json()["expires_at"] == "2026-11-27T10:10:00Z"
    # Only a digest of the state is kept, never the value the browser carries.
    assert not any(query["state"][0] in k or query["state"][0] in v[0] for k, v in env.keys.values.items())


async def test_a_bind_binds_routes_audits_and_emits(env: Env) -> None:
    user, guild = organiser(env)
    r = await bind(env, user, guild)
    assert r.status_code == 200 and "Discord server connected" in r.text
    [row] = await env.fetch("ev-a", "SELECT guild_id, guild_name, bound_by FROM bot_bindings")
    assert tuple(row) == (guild.id, "Demo Community", "u_org")
    routes = await env.fetch(None, "SELECT guild_id, tenant_id, application_id FROM bot_guild_routes")
    assert [tuple(x) for x in routes] == [(guild.id, "ev-a", SHARED_ID)]
    assert env.events("ev-a") == [
        {
            "type": "bot.guild.bound",
            "data": {
                "guild_id": guild.id,
                "guild_name": "Demo Community",
                "application_id": SHARED_ID,
                "actor_user_id": "u_org",
            },
        }
    ]
    assert [e["action"] for e in env.audit.entries] == ["bot.guild.bound"]
    # The commands of the event's flags (none yet) went to the guild in one overwrite.
    assert guild.commands[SHARED_ID] == []
    [state] = await env.fetch("ev-a", "SELECT commands_status FROM bot_bindings")
    assert state["commands_status"] == "registered"


async def test_the_state_works_once(env: Env) -> None:
    user, guild = organiser(env)
    state = state_of(await start(env))
    code = env.discord.authorize(SHARED_ID, user.id, guild.id)
    assert (await callback(env, {"state": state, "code": code})).status_code == 200
    again = await callback(env, {"state": state, "code": code})
    assert again.status_code == 400 and "run out" in again.text
    unknown = await callback(env, {"state": "x" * 40, "code": code})
    assert unknown.status_code == 400


async def test_the_callback_answers_only_on_the_sign_in_host(env: Env) -> None:
    r = await callback(env, {"state": "x" * 40, "code": "c"}, host="a.example.test")
    assert r.status_code == 404


async def test_the_guild_comes_from_discords_answer_not_the_query(env: Env) -> None:
    user, guild = organiser(env)
    other = env.discord.add_guild("Other Community", owner_id=user.id)
    state = state_of(await start(env))
    code = env.discord.authorize(SHARED_ID, user.id, guild.id)
    await callback(env, {"state": state, "code": code, "guild_id": other.id})
    [row] = await env.fetch("ev-a", "SELECT guild_id FROM bot_bindings")
    assert row["guild_id"] == guild.id


async def test_another_discord_account_is_refused(env: Env) -> None:
    _, guild = organiser(env)
    stranger = env.discord.add_user("Stranger")
    env.discord.add_member(guild.id, stranger.id, permissions=MANAGE_GUILD)
    r = await bind(env, stranger, guild)
    assert "Another Discord account" in r.text
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") == []


async def test_no_confirmed_discord_id_fails_closed(env: Env) -> None:
    user, guild = organiser(env)
    env.users.discord_ids.clear()  # the users seam, while tenants does not serve the read
    assert "Another Discord account" in (await bind(env, user, guild)).text


async def test_manage_server_is_checked_in_the_persons_own_guild_list(env: Env) -> None:
    user = env.discord.add_user("Member")
    env.users.discord_ids["u_org"] = user.id
    guild = env.discord.add_guild("Demo Community")
    env.discord.add_member(guild.id, user.id, permissions=0)
    assert "Manage Server" in (await bind(env, user, guild)).text
    env.discord.guilds[guild.id].members[user.id]["permissions"] = str(MANAGE_GUILD)
    assert "connected" in (await bind(env, user, guild)).text


async def test_the_bot_must_be_in_the_guild(env: Env) -> None:
    user, guild = organiser(env)
    state = state_of(await start(env))
    code = env.discord.authorize(SHARED_ID, user.id, guild.id, add_bot=False)
    r = await callback(env, {"state": state, "code": code})
    assert "not in that server" in r.text


async def test_a_guild_bound_to_another_event_is_refused(env: Env) -> None:
    user, guild = organiser(env)
    await env.platform_sql(
        "INSERT INTO bot_guild_routes VALUES ($1, 'ev-b', $2)", guild.id, SHARED_ID
    )
    r = await bind(env, user, guild)
    assert "Already connected" in r.text
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") == []


async def test_an_event_with_a_guild_cannot_start_again(env: Env) -> None:
    user, guild = organiser(env)
    await bind(env, user, guild)
    r = await start(env)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "guild_bound")


async def test_a_connection_changed_since_the_start_is_refused(env: Env) -> None:
    user, guild = organiser(env)
    state = state_of(await start(env))
    await env.sql("ev-a", "INSERT INTO bot_connections (revision) VALUES (1)")
    code = env.discord.authorize(SHARED_ID, user.id, guild.id)
    r = await callback(env, {"state": state, "code": code})
    assert "changed meanwhile" in r.text


async def test_an_archived_event_or_a_cancel_binds_nothing(env: Env) -> None:
    user, guild = organiser(env)
    state = state_of(await start(env))
    r = await callback(env, {"state": state, "error": "access_denied"})
    assert "closed before it said yes" in r.text
    state = state_of(await start(env))
    env.contexts["ev-a"]["status"] = "archived"
    code = env.discord.authorize(SHARED_ID, user.id, guild.id)
    assert "has ended" in (await callback(env, {"state": state, "code": code})).text
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_bindings") == []


async def test_a_deleted_event_is_state_invalid(env: Env) -> None:
    user, guild = organiser(env)
    state = state_of(await start(env))
    del env.contexts["ev-a"]
    code = env.discord.authorize(SHARED_ID, user.id, guild.id)
    assert (await callback(env, {"state": state, "code": code})).status_code == 400


async def test_a_used_code_is_code_exchange_failed(env: Env) -> None:
    user, guild = organiser(env)
    state = state_of(await start(env))
    r = await callback(env, {"state": state, "code": "never-issued"})
    assert "did not confirm" in r.text


async def test_the_browser_goes_back_to_the_events_primary_hostname(env: Env) -> None:
    env.contexts["ev-a"]["primary_hostname"] = "demo.example.test"
    user, guild = organiser(env)
    r = await bind(env, user, guild)
    assert r.status_code == 303
    assert r.headers["location"] == "https://demo.example.test/bot/?bind=ok"


async def test_an_own_application_binds_with_its_own_secret(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    body = {
        "mode": "own",
        "application_id": app.id,
        "bot_token": app.token,
        "client_secret": app.client_secret,
        "revision": 0,
    }
    async with env.client() as c:
        assert (await c.put("/api/bot/connection", json=body, headers=env.admin())).status_code == 200
    user, guild = organiser(env)
    r = await bind(env, user, guild, app.id)
    assert "connected" in r.text
    [row] = await env.fetch(None, "SELECT application_id FROM bot_guild_routes")
    assert row["application_id"] == app.id


async def test_without_a_callback_address_the_start_is_503(env: Env) -> None:
    from canccu_bot.config import Hosts

    env.deps.hosts = Hosts(signin=None, superadmin=None, public_url=None)
    r = await start(env)
    assert (r.status_code, r.json()["error"]["code"]) == (503, "discord_not_configured")


async def test_starting_needs_the_event_admin_role(env: Env) -> None:
    async with env.client() as c:
        r = await c.post("/api/bot/guild/bind", headers=env.reader())
    assert (r.status_code, r.json()["error"]["code"]) == (403, "missing_right")
