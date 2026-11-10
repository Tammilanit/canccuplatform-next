"""Checking in is never mandatory (docs/plans/issue-188.md, D11; principle 7 of the step 3 plan):
every Notify path a guest or a member uses answers the same with and without a check-in, and a
check-in makes nothing that asks anyone to check in."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from conftest import Env
from test_checkin import code, recorded
from topics import play, reminder, schedule

import canccu_notify

# The topic-type list and its configuration are the organisers' (right notify.topics.write).
READS = ("/api/notify/inbox", "/api/notify/topics")


async def answers(env: Env, headers: dict[str, str], note_ids: list[str]) -> list[Any]:
    paths = [*READS, *(f"/api/notify/notifications/{i}" for i in note_ids)]
    async with env.client() as c:
        return [((r := await c.get(p, headers=headers)).status_code, r.json()) for p in paths]


async def test_every_read_answers_the_same_after_a_check_in(env: Env) -> None:
    await env.register(schedule())
    await env.register(play())
    await env.emit("ev-a", "agenda.reminder.triggered", reminder(), id="e1")
    await env.emit("ev-a", "agenda.reminder.triggered", reminder("attendees"), id="e2")
    data = {"user_ids": ["u_a"], "game": "Chess", "host": "Host", "at": "2026-11-20T18:00:00Z"}
    await env.emit("ev-a", "games.session.invited", data, id="e3")
    member = env.rights.sign_in("u_a")
    async with env.db.tenant("ev-a") as conn:
        ids = [r["id"] for r in await conn.fetch("SELECT id FROM notify_notifications")]
    assert len(ids) == 3
    member_before = await answers(env, member, ids)
    guest_before = await answers(env, {}, ids)
    assert all(status == 200 for status, _ in member_before)

    async with env.client() as c:
        r = await c.post(
            "/api/notify/check-ins",
            json={"purpose": "arrival", "code": (await code(env))["code"]},
            headers=member,
        )
    assert r.status_code == 201

    assert await answers(env, member, ids) == member_before
    assert await answers(env, {}, ids) == guest_before
    # Nothing new to read and nothing that asks for a check-in: only the contract's event.
    async with env.db.tenant("ev-a") as conn:
        assert await conn.fetchval("SELECT count(*) FROM notify_notifications") == 3
    assert [e["type"] for e in recorded(env)] == ["notify.checkin.recorded"]


def test_only_the_check_in_code_reads_check_ins() -> None:
    """D11: no Notify path but the check-in API and page reads check-ins, so none can depend on
    one. The export (#226) joins this list when it lands."""
    src = Path(canccu_notify.__file__).parent
    readers = sorted(p.name for p in src.glob("*.py") if "notify_check_ins" in p.read_text())
    assert readers == ["checkin.py"]
