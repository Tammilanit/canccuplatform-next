"""Discord DMs (contracts/notify.md, Delivery rules, Discord DMs): by choice and as the fallback,
only while the bot can send them, under the cap and quiet hours."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from conftest import Env
from test_checkin import recorded
from test_delivery import raise_alert, statuses
from topics import alert, play, quiet

DISCORD = "100000000000000001"
INVITE = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}


async def bot(env: Env, type: str, n: int = 1, **data: Any) -> None:
    await env.emit("ev-a", f"bot.{type}", data, id=f"bot-{n}")


async def bound(env: Env) -> None:
    data = {"guild_id": "1", "guild_name": "G", "application_id": "2", "actor_user_id": "u_org"}
    await bot(env, "guild.bound", 0, **data)


async def invite(env: Env, n: int = 1, **data: Any) -> None:
    await env.emit("ev-a", "games.session.invited", {**INVITE, **data}, id=f"inv-{n}")


def dms(env: Env) -> list[dict[str, Any]]:
    return [e["data"] for e in recorded(env) if e["type"] == "notify.dm.requested"]


async def choose(env: Env, user: str, body: dict[str, Any]) -> None:
    async with env.client() as c:
        r = await c.patch("/api/notify/me", json=body, headers=env.rights.sign_in(user))
    assert r.status_code == 200, r.text


DM_ON = {"channels": {"play": {"personal": {"discord_dm": True}}}}


async def test_a_dm_by_choice_goes_out_only_while_the_bot_can_send(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    await env.register(play())
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    await choose(env, "u_a", DM_ON)
    await invite(env, 1)
    assert dms(env) == [] and len(env.push.to("a1")) == 1  # no guild: the push still goes
    await bound(env)
    await invite(env, 2)
    [dm] = dms(env)
    async with env.db.tenant("ev-a") as conn:
        note = await conn.fetchrow(
            "SELECT * FROM notify_notifications WHERE source_event_id = 'inv-2'"
        )
    assert dm == {
        "user_id": "u_a",
        "discord_user_id": DISCORD,
        "notification_id": note["id"],
        "topic": "play",
        "title": "Chess with Host",
        "body": "Starts at 18:00",
        "url": "/notify/games",
        "urgent": False,
        "reason": "channel",
    }
    await bot(env, "client.changed", 2, status="paused", error_code=None, since="x")
    await invite(env, 3)
    await bot(env, "client.changed", 3, status="ready", error_code=None, since="x")
    await invite(env, 4)
    await bot(env, "guild.unbound", 4, guild_id="1", reason="unbound", actor_user_id="u_org")
    await invite(env, 5)
    assert len(dms(env)) == 2 and len(env.push.to("a1")) == 5


async def test_a_personal_notification_with_no_phone_falls_back_to_a_dm(env: Env) -> None:
    env.users.discord.update({"u_a": DISCORD, "u_b": "2"})
    await env.register(play())
    await bound(env)
    await env.subscribe("b1", env.rights.sign_in("u_b"), {"play": {"personal": True}})
    await invite(env, 1, user_ids=["u_a", "u_b"])
    assert [(d["user_id"], d["reason"]) for d in dms(env)] == [("u_a", "fallback")]
    assert len(env.push.to("b1")) == 1


async def test_the_fallback_follows_pushes_that_all_failed(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    await env.register(play())
    await bound(env)
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    await env.subscribe("a2", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    env.push.answers["https://push.example.test/send/a1"] = 500
    await invite(env, 1)
    assert dms(env) == []  # one phone got it
    env.push.answers["https://push.example.test/send/a2"] = 410
    await invite(env, 2)
    assert [d["reason"] for d in dms(env)] == ["fallback"]


async def test_only_an_explicit_choice_or_dm_fallback_off_stops_the_fallback(env: Env) -> None:
    env.users.discord.update({"u_a": "1", "u_c": "3", "u_e": "5"})
    await env.register(play())  # its discord_dm default is off: that alone stops nothing
    await bound(env)
    await choose(env, "u_a", {"channels": {"play": {"personal": {"discord_dm": False}}}})
    await choose(env, "u_c", {"dm_fallback": False})
    await invite(env, 1, user_ids=["u_a", "u_c", "u_e"])
    assert [d["user_id"] for d in dms(env)] == ["u_e"]
    env.settings.values["ev-a"] = {"dm_fallback": False}
    await invite(env, 2, user_ids=["u_e"])
    assert len(dms(env)) == 1


async def test_a_topic_or_event_without_discord_dm_has_no_fallback(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    reg = play()
    reg["parts"]["personal"].update(channels=["push"], defaults={"push": True})
    await env.register(reg)
    await bound(env)
    await invite(env, 1)
    assert dms(env) == []


async def test_event_wide_dms_go_to_members_who_chose_them(env: Env) -> None:
    env.users.discord.update({"u_a": DISCORD, "u_b": "2"})
    await env.register(alert())
    await bound(env)
    await choose(env, "u_a", {"channels": {"alert": {"event": {"discord_dm": True}}}})
    await choose(env, "u_b", {"dm_fallback": True})
    await env.subscribe("g1")
    await raise_alert(env, 1)
    assert [(d["user_id"], d["reason"]) for d in dms(env)] == [("u_a", "channel")]
    assert len(env.push.to("g1")) == 1


async def test_a_person_gets_one_dm_per_notification(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    await env.register(play())
    await bound(env)
    await choose(env, "u_a", DM_ON)
    await invite(env, 1)  # no phone either: still one DM, by choice
    assert [d["reason"] for d in dms(env)] == ["channel"]


async def test_no_discord_id_requests_no_dm(env: Env) -> None:
    await env.register(play())
    await bound(env)
    await invite(env, 1)
    assert dms(env) == [] and await statuses(env) == ["failed"]


async def test_the_cap_counts_a_push_and_a_dm_of_one_notification_once(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    env.settings.values["ev-a"] = {"hourly_cap": 1}
    await env.register(play())
    await bound(env)
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    await choose(env, "u_a", DM_ON)
    await invite(env, 1)
    await invite(env, 2)
    assert len(env.push.to("a1")) == 1 and len(dms(env)) == 1
    assert sorted(await statuses(env)) == ["capped", "capped", "sent", "sent"]


async def test_quiet_hours_hold_dms_too(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    await env.register(play())
    await bound(env)
    await choose(env, "u_a", DM_ON)
    data = {"item": quiet(end=20), "agenda_version": 1, "actor_user_id": "u_org"}
    await env.emit("ev-a", "agenda.item.added", data, id="ag-1")
    await invite(env, 1)
    assert dms(env) == [] and await statuses(env) == ["held"]
    env.clock[0] += timedelta(minutes=21)
    from canccu_notify import delivery

    await delivery.tick(env.deps)
    assert len(dms(env)) == 1


async def test_a_push_that_fails_before_sending_still_falls_back(env: Env) -> None:
    env.users.discord["u_a"] = DISCORD
    await env.register(play())
    await bound(env)
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    async with env.db.tenant("ev-a") as conn:
        await conn.execute("UPDATE notify_subscriptions SET keys_sealed = 'cs1.1.AAAA.AAAA'")
    await invite(env, 1)
    assert [d["reason"] for d in dms(env)] == ["fallback"]


async def test_a_failed_discord_id_read_is_tried_again(env: Env) -> None:
    await env.register(play())
    await bound(env)
    real = env.users

    class Down:
        async def discord_id(self, user_id: str) -> str | None:
            raise RuntimeError("tenants unreachable")

    env.deps.users = Down()
    await invite(env, 1)
    assert dms(env) == [] and await statuses(env) == ["pending"]
    env.deps.users = real
    real.discord["u_a"] = DISCORD
    from canccu_notify import delivery

    await delivery.tick(env.deps)
    assert len(dms(env)) == 1 and await statuses(env) == ["sent"]


async def test_a_dm_the_bot_can_no_longer_send_takes_no_cap_place(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    from canccu_notify import delivery

    env.users.discord["u_a"] = DISCORD
    env.settings.values["ev-a"] = {"hourly_cap": 1}
    await env.register(play())
    await bound(env)

    async def later(*args: Any, **kwargs: Any) -> int:
        return 0

    monkeypatch.setattr(delivery, "deliver", later)  # both rows wait for one batch
    await choose(env, "u_a", DM_ON)
    await invite(env, 1)  # no phone yet: a DM row
    await choose(env, "u_a", {"channels": {"play": {"personal": {"discord_dm": False}}}})
    await env.subscribe("a1", env.rights.sign_in("u_a"), {"play": {"personal": True}})
    await invite(env, 2)  # a push row
    await bot(env, "client.changed", 2, status="paused", error_code=None, since="x")
    monkeypatch.undo()
    await delivery.tick(env.deps)
    assert dms(env) == [] and len(env.push.to("a1")) == 1
    assert await statuses(env) == ["skipped", "sent"]
