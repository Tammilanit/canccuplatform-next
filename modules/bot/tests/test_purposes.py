"""Purposes (contracts/bot.md, Purposes): each bound to a channel or a role of the event's guild,
picked from the live lists or created from its template; one deleted in Discord shows `missing`
(E3), one whose feature is off `not_on`, and roles are created only while the bot's role is above
the bound ones (E6)."""

from __future__ import annotations

from typing import Any

from canccu_kit.testing.discord import FakeGuild
from conftest import SHARED_ID, Env
from test_guild import bound

from canccu_bot.perms import (
    EMBED_LINKS,
    MANAGE_CHANNELS,
    MANAGE_ROLES,
    PIN_MESSAGES,
    READ_MESSAGE_HISTORY,
    SEND_MESSAGES,
    VIEW_CHANNEL,
)

EVERYDAY = VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | PIN_MESSAGES | READ_MESSAGE_HISTORY
MANAGER = EVERYDAY | MANAGE_CHANNELS | MANAGE_ROLES


async def server(env: Env, permissions: int = MANAGER, tenant: str = "ev-a") -> FakeGuild:
    """A bound guild where the shared bot holds its own role, on top, with `permissions`."""
    guild = await bound(env, tenant)
    role = env.discord.add_role(guild.id, "Platform Bot", permissions=permissions, managed=True)
    env.discord.give_bot_role(guild.id, SHARED_ID, role)
    return guild


def by_purpose(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["purpose"]: p for p in body["purposes"]}


async def put(env: Env, purpose: str, target: str | None, **kw: Any) -> Any:
    async with env.client() as c:
        return await c.put(
            f"/api/bot/guild/purposes/{purpose}",
            json={"target_id": target},
            headers=kw.get("headers") or env.admin(),
        )


async def read(env: Env) -> dict[str, dict[str, Any]]:
    async with env.client() as c:
        r = await c.get("/api/bot/guild/purposes", headers=env.reader())
    assert r.status_code == 200
    return by_purpose(r.json())


async def test_the_catalogue_shows_each_purpose_missing_or_not_on(env: Env) -> None:
    await server(env)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True}
    found = await read(env)
    assert list(found) == [
        "announcements",
        "now_and_next",
        "food",
        "photos",
        "crew",
        "tournaments",
        "match_voice",
        "crew_role",
        "attendee_role",
    ]
    assert {k: v["state"] for k, v in found.items()} == {
        "announcements": "missing",
        "now_and_next": "missing",
        "food": "missing",
        "photos": "not_on",  # screen.photos is off
        "crew": "missing",
        "tournaments": "not_on",  # no tournament module yet: its flag counts as off
        "match_voice": "not_on",
        "crew_role": "missing",
        "attendee_role": "missing",
    }
    assert found["food"]["flag"] == "pizza.enabled"
    assert (found["match_voice"]["kind"], found["crew_role"]["kind"]) == ("category", "role")
    assert found["now_and_next"]["template_name"] == "now-and-next"


async def test_a_picked_channel_is_bound_and_announced(env: Env) -> None:
    guild = await server(env)
    channel = env.discord.add_channel(guild.id, "news")
    r = await put(env, "announcements", channel)
    assert r.status_code == 200
    assert (r.json()["state"], r.json()["target_name"]) == ("bound", "news")
    assert (await read(env))["announcements"]["target_id"] == channel
    [event] = [e for e in env.events("ev-a") if e["type"] == "bot.purposes.changed"]
    assert event["data"] == {"purposes": {"announcements": channel}, "actor_user_id": "u_org"}
    assert env.audit.entries[-1]["action"] == "bot.purpose.changed"
    r = await put(env, "announcements", None)
    assert (r.json()["state"], r.json()["target_id"]) == ("missing", None)


async def test_a_target_of_the_wrong_kind_or_not_in_the_guild_is_refused(env: Env) -> None:
    guild = await server(env)
    category = env.discord.add_channel(guild.id, "Matches", type=4)
    text = env.discord.add_channel(guild.id, "general")
    managed = env.discord.add_role(guild.id, "Other Bot", managed=True)
    other = await bound(env, "ev-b")
    elsewhere = env.discord.add_channel(other.id, "news")
    for purpose, target in (
        ("announcements", category),
        ("match_voice", text),
        ("announcements", elsewhere),
        ("crew_role", guild.id),  # @everyone
        ("crew_role", managed),
        ("crew_role", text),
        ("announcements", "not-a-snowflake"),
    ):
        r = await put(env, purpose, target)
        assert (purpose, r.status_code, r.json()["error"]["code"]) == (
            purpose,
            400,
            "target_invalid",
        )
    assert (await put(env, "match_voice", category)).status_code == 200
    assert (await put(env, "breakfast", text)).status_code == 404


async def test_a_bound_channel_deleted_in_discord_shows_missing(env: Env) -> None:
    guild = await server(env)
    channel = env.discord.add_channel(guild.id, "food")
    await put(env, "crew", channel)
    del guild.channels[channel]
    found = (await read(env))["crew"]
    assert (found["state"], found["target_id"], found["target_name"]) == (
        "missing",
        channel,
        None,
    )


async def test_the_pick_lists_are_read_live_without_everyone(env: Env) -> None:
    guild = await server(env)
    channel = env.discord.add_channel(guild.id, "news")
    crew = env.discord.add_role(guild.id, "Crew")
    async with env.client() as c:
        channels = (await c.get("/api/bot/guild/channels", headers=env.reader())).json()
        roles = (await c.get("/api/bot/guild/roles", headers=env.reader())).json()
    assert [(x["id"], x["name"], x["type"]) for x in channels["channels"]] == [(channel, "news", 0)]
    assert [x["name"] for x in roles["roles"]] == ["Crew", "Platform Bot"]
    assert {x["id"] for x in roles["roles"]} >= {crew}
    assert roles["roles"][1]["managed"] is True


async def test_reading_needs_the_right_and_writing_the_event_admin_role(env: Env) -> None:
    guild = await server(env)
    channel = env.discord.add_channel(guild.id, "news")
    async with env.client() as c:
        r = await c.get("/api/bot/guild/purposes", headers=env.rights.sign_in("u_x"))
        assert r.status_code == 403
        r = await c.post("/api/bot/guild/purposes/create-missing", headers=env.reader())
        assert r.status_code == 403
    assert (await put(env, "announcements", channel, headers=env.reader())).status_code == 403


async def test_without_a_guild_there_is_nothing_to_set_up(env: Env) -> None:
    async with env.client() as c:
        r = await c.get("/api/bot/guild/purposes", headers=env.reader())
    assert (r.status_code, r.json()["error"]["code"]) == (404, "not_found")


async def test_an_archived_event_reads_and_writes_nothing_on_discord(env: Env) -> None:
    guild = await server(env)
    channel = env.discord.add_channel(guild.id, "news")
    env.contexts["ev-a"]["status"] = "archived"
    assert (await put(env, "announcements", channel)).status_code == 409
    async with env.client() as c:
        r = await c.get("/api/bot/guild/purposes", headers=env.reader())
    assert (r.status_code, r.json()["error"]["code"]) == (409, "event_archived")


async def test_discord_not_answering_is_503(env: Env) -> None:
    guild = await server(env)
    env.discord.fail_next(502, path=f"/guilds/{guild.id}/channels")
    async with env.client() as c:
        r = await c.get("/api/bot/guild/purposes", headers=env.reader())
    assert (r.status_code, r.json()["error"]["code"]) == (503, "discord_unavailable")


async def create(env: Env) -> Any:
    async with env.client() as c:
        return await c.post("/api/bot/guild/purposes/create-missing", headers=env.admin())


async def test_create_missing_makes_the_roles_then_the_channels_from_their_templates(
    env: Env,
) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True}
    news = env.discord.add_channel(guild.id, "news")
    await put(env, "announcements", news)
    r = await create(env)
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == ["now_and_next", "food", "crew", "crew_role", "attendee_role"]
    assert body["skipped"] == []
    states = {k: v["state"] for k, v in by_purpose(body).items()}
    assert [k for k, v in states.items() if v == "bound"] == [
        "announcements",
        "now_and_next",
        "food",
        "crew",
        "crew_role",
        "attendee_role",
    ]
    made = {c["name"]: c for c in guild.channels.values()}
    assert set(made) == {"news", "now-and-next", "food", "crew"}
    roles = {r["name"]: r["id"] for r in guild.roles.values()}
    crew_ow = {o["id"]: o for o in made["crew"]["permission_overwrites"]}
    assert int(crew_ow[guild.id]["deny"]) & VIEW_CHANNEL  # crew only
    assert int(crew_ow[roles["Crew"]]["allow"]) & VIEW_CHANNEL
    bot_user = env.discord.applications[SHARED_ID].bot_user_id
    assert int(crew_ow[bot_user]["allow"]) & SEND_MESSAGES
    food_ow = {o["id"]: o for o in made["food"]["permission_overwrites"]}
    assert int(food_ow[guild.id]["deny"]) & SEND_MESSAGES  # the bot's channel to post in
    assert int(food_ow[bot_user]["allow"]) & PIN_MESSAGES
    [event] = [e for e in env.events("ev-a") if e["type"] == "bot.purposes.changed"][1:]
    assert set(event["data"]["purposes"]) == set(body["created"])
    assert env.audit.entries[-1]["action"] == "bot.purposes.created"


async def test_roles_wait_while_the_bots_role_is_below_a_bound_one(env: Env) -> None:
    guild = await server(env)
    above = env.discord.add_role(guild.id, "Attendee")  # added last: above the bot's role
    await put(env, "attendee_role", above)
    body = (await create(env)).json()
    assert body["created"] == ["announcements", "now_and_next", "crew"]
    assert body["skipped"] == [{"purpose": "crew_role", "reason": "role_order"}]
    assert {r["name"] for r in guild.roles.values()} == {"@everyone", "Platform Bot", "Attendee"}


async def test_without_manage_channels_no_channel_is_made(env: Env) -> None:
    guild = await server(env, EVERYDAY | MANAGE_ROLES)
    body = (await create(env)).json()
    assert body["created"] == ["crew_role", "attendee_role"]
    assert {s["reason"] for s in body["skipped"]} == {"missing_permission"}
    assert [s["purpose"] for s in body["skipped"]] == ["announcements", "now_and_next", "crew"]
    assert guild.channels == {}


async def test_a_refused_create_is_skipped_and_the_rest_go_on(env: Env) -> None:
    guild = await server(env)
    env.discord.fail_next(403, path=f"/guilds/{guild.id}/roles", method="POST")
    body = (await create(env)).json()
    assert {"purpose": "crew_role", "reason": "discord_refused"} in body["skipped"]
    assert "attendee_role" in body["created"]
    assert "crew" in body["created"]


async def test_unbinding_forgets_the_purposes(env: Env) -> None:
    guild = await server(env)
    await put(env, "announcements", env.discord.add_channel(guild.id, "news"))
    async with env.client() as c:
        assert (await c.delete("/api/bot/guild", headers=env.admin())).status_code == 204
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_purposes") == []
