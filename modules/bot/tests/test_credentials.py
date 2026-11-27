"""Writing the connection (contracts/bot.md, The event's connection): both credentials checked
with Discord before anything is stored, sealed for the event and the application, the
event-admin role itself, revisions, and never a value in an answer, an event or the audit."""

from __future__ import annotations

from typing import Any

from canccu_kit.testing.discord import FakeApplication
from conftest import SHARED_ID, Env


async def put(env: Env, body: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    async with env.client() as c:
        return await c.put("/api/bot/connection", json=body, headers=headers or env.admin())


def own_body(app: FakeApplication, revision: int = 0, **extra: Any) -> dict[str, Any]:
    body = {
        "mode": "own",
        "application_id": app.id,
        "bot_token": app.token,
        "client_secret": app.client_secret,
        "revision": revision,
    }
    return {**body, **extra}


def code(r: Any) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


async def test_an_own_application_is_stored_sealed_and_routed(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    r = await put(env, own_body(app))
    assert r.status_code == 200
    body = r.json()
    assert (body["mode"], body["application_id"], body["revision"]) == ("own", app.id, 1)
    assert body["credentials"]["bot_token_set"] and body["credentials"]["client_secret_set"]
    assert body["credentials"]["updated_by"] == "u_org"
    assert app.token not in r.text and app.client_secret not in r.text
    [row] = await env.fetch("ev-a", "SELECT bot_token, client_secret FROM bot_connections")
    box = env.deps.secrets
    assert box.open_text(row["bot_token"], f"bot:token:ev-a:{app.id}") == app.token
    assert box.open_text(row["client_secret"], f"bot:secret:ev-a:{app.id}") == app.client_secret
    routes = await env.fetch(None, "SELECT application_id, tenant_id FROM bot_application_routes")
    assert [(x["application_id"], x["tenant_id"]) for x in routes] == [(app.id, "ev-a")]


async def test_the_change_is_emitted_and_audited_without_a_value(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    await put(env, own_body(app))
    [event] = env.events("ev-a")
    assert event == {
        "type": "bot.connection.changed",
        "data": {
            "mode": "own",
            "application_id": app.id,
            "changed": ["mode", "application_id", "bot_token", "client_secret"],
            "revision": 1,
            "actor_user_id": "u_org",
        },
    }
    [entry] = env.audit.entries
    assert (entry["action"], entry["actor_user_id"]) == ("bot.connection.changed", "u_org")
    assert app.token not in str(env.audit.entries) + str(env.streams.streams)
    assert app.client_secret not in str(env.audit.entries) + str(env.streams.streams)


async def test_a_wrong_token_secret_or_application_stores_nothing(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    other = env.discord.add_application("Other Bot")
    bad_token = own_body(app, bot_token="x" * 60)
    assert code(await put(env, bad_token)) == (400, "token_invalid")
    mismatch = own_body(app, bot_token=other.token)
    assert code(await put(env, mismatch)) == (400, "application_mismatch")
    bad_secret = own_body(app, client_secret="wrong-secret-of-20ch")
    assert code(await put(env, bad_secret)) == (400, "client_secret_invalid")
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_connections") == []
    assert env.events("ev-a") == [] and env.audit.entries == []


async def test_writes_need_the_event_admin_role_itself(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    crew = env.rights.sign_in("u_crew", "bot.connection.read", "agenda.items.write")
    assert code(await put(env, own_body(app), crew)) == (403, "missing_right")
    async with env.client() as c:
        r = await c.put("/api/bot/connection", json=own_body(app))
    assert code(r) == (401, "not_signed_in")


async def test_the_shared_or_a_taken_application_is_refused(env: Env) -> None:
    shared = env.discord.applications[SHARED_ID]
    assert code(await put(env, own_body(shared))) == (409, "application_reserved")
    app = env.discord.add_application("Own Bot")
    assert (await put(env, own_body(app))).status_code == 200
    async with env.client("b.example.test") as c:
        r = await c.put("/api/bot/connection", json=own_body(app), headers=env.admin("u_b"))
    assert code(r) == (409, "application_taken")


async def test_a_stale_revision_is_a_conflict(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    await put(env, own_body(app))
    assert code(await put(env, own_body(app, revision=0))) == (409, "version_conflict")


async def test_a_rotation_checks_and_replaces_only_the_credential_it_brings(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    await put(env, own_body(app))
    [before] = await env.fetch("ev-a", "SELECT bot_token FROM bot_connections")
    app.client_secret = "rotated-secret-value-1"
    r = await put(
        env,
        {
            "mode": "own",
            "application_id": app.id,
            "client_secret": app.client_secret,
            "revision": 1,
        },
    )
    assert r.status_code == 200
    [after] = await env.fetch("ev-a", "SELECT bot_token, client_secret FROM bot_connections")
    assert after["bot_token"] == before["bot_token"]
    opened = env.deps.secrets.open_text(after["client_secret"], f"bot:secret:ev-a:{app.id}")
    assert opened == "rotated-secret-value-1"
    assert env.events("ev-a")[-1]["data"]["changed"] == ["client_secret"]


async def test_a_new_application_needs_both_credentials(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    body = {"mode": "own", "application_id": app.id, "bot_token": app.token, "revision": 0}
    assert code(await put(env, body)) == (400, "invalid_request")


async def test_the_application_cannot_change_while_a_guild_is_bound(env: Env) -> None:
    await env.sql(
        "ev-a",
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id)"
        " VALUES ('100000000000000077', 'G', $1)",
        SHARED_ID,
    )
    app = env.discord.add_application("Own Bot")
    assert code(await put(env, own_body(app))) == (409, "guild_bound")


async def test_back_to_shared_erases_the_credentials_and_frees_the_application(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    await put(env, own_body(app))
    async with env.client() as c:
        r = await c.delete("/api/bot/connection?revision=1", headers=env.admin())
    assert r.status_code == 200
    assert (r.json()["mode"], r.json()["credentials"], r.json()["revision"]) == ("shared", None, 2)
    [row] = await env.fetch(
        "ev-a", "SELECT bot_token, client_secret, updated_by FROM bot_connections"
    )
    assert tuple(row) == (None, None, None)
    assert await env.fetch(None, "SELECT 1 FROM bot_application_routes") == []
    assert env.events("ev-a")[-1]["data"]["mode"] == "shared"


async def test_clearing_needs_the_revision_read_and_works_on_an_archived_event(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    await put(env, own_body(app))
    env.contexts["ev-a"]["status"] = "archived"
    async with env.client() as c:
        stale = await c.delete("/api/bot/connection?revision=0", headers=env.admin())
        missing = await c.delete("/api/bot/connection", headers=env.admin())
        ok = await c.put(
            "/api/bot/connection", json={"mode": "shared", "revision": 1}, headers=env.admin()
        )
    assert code(stale) == (409, "version_conflict")
    assert code(missing) == (400, "invalid_request")
    assert ok.status_code == 200 and ok.json()["mode"] == "shared"


async def test_an_archived_event_takes_no_own_application(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "archived"
    app = env.discord.add_application("Own Bot")
    assert code(await put(env, own_body(app))) == (409, "event_archived")


async def test_a_body_with_more_or_wrong_fields_is_400(env: Env) -> None:
    app = env.discord.add_application("Own Bot")
    for body in (
        {**own_body(app), "extra": 1},
        {"mode": "shared", "application_id": app.id, "revision": 0},
        own_body(app, revision=-1),
        own_body(app, application_id="not-a-snowflake"),
    ):
        assert code(await put(env, body)) == (400, "invalid_request"), body
