"""The demo run of show on the dev server (#715): dev mode only, on today and tomorrow of the
event's time zone, moved to the new days on a later run, never over an agenda changed by hand."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from canccu_kit import DEMO_TENANT, tenant_scope
from canccu_kit.rights import Session
from conftest import NOW, Env

from canccu_agenda import dev_seed, items, model, store


async def demo_rows(env: Env) -> list[Any]:
    with tenant_scope(DEMO_TENANT):
        async with env.db.tenant() as conn:
            return await store.items(conn, frozenset(model.VISIBILITIES))


async def seed(env: Env, *, force: bool = False, zone: str = "UTC", version: str = "dev") -> str:
    return await dev_seed.seed_demo_agenda(env.deps, version, zone, force=force)


def local_day(row: Any, zone: str = "UTC") -> date:
    when: datetime = row["starts_at"]
    return when.astimezone(ZoneInfo(zone)).date()


def organiser() -> Session:
    return Session("u_org", "Org", frozenset(), NOW + timedelta(days=1))


async def add_by_hand(env: Env) -> None:
    with tenant_scope(DEMO_TENANT):
        await items.add(
            env.deps,
            organiser(),
            {
                "title": "Board games",
                "kind": "activity",
                "starts_at": "2026-11-20T18:00:00Z",
                "visibility": "public",
            },
        )


async def test_refused_outside_dev_mode(env: Env) -> None:
    with pytest.raises(dev_seed.Refused, match="not dev"):
        await seed(env, version="1.4.0")
    assert await demo_rows(env) == []


async def test_seeds_a_run_of_show_on_today_and_tomorrow(env: Env) -> None:
    assert await seed(env) == dev_seed.SEEDED
    rows = await demo_rows(env)
    days = {local_day(r) for r in rows}
    assert days == {NOW.date(), NOW.date() + timedelta(days=1)}
    by_title = {r["title"]: r for r in rows}
    # A tournament session, a pizza order time and a raffle, as the issue asks.
    assert by_title["Raffle"]["kind"] == "activity"
    # A raffle each day, so Moments finds one ahead even after today's.
    assert {local_day(r) for r in rows if r["title"] == "Raffle"} == days
    assert by_title["Pizza order"]["kind"] == "meal"
    assert {r["kind"] for r in rows} >= {"tournament", "meal", "doors"}
    for day in days:
        assert sum(local_day(r) == day for r in rows) >= 3
    assert all(r["visibility"] == "public" and r["managed_by"] is None for r in rows)
    # Screens, phones and Moments hear of them as of any added item.
    added = [e for e in env.events() if e.get("type") == "agenda.item.added"]
    assert len(added) == len(rows)


async def test_the_days_are_the_event_time_zones(env: Env) -> None:
    # 23:30 UTC is already the next day in Helsinki.
    env.clock[0] = datetime(2026, 11, 20, 23, 30, tzinfo=UTC)
    await seed(env, zone="Europe/Helsinki")
    rows = await demo_rows(env)
    days = {local_day(r, "Europe/Helsinki") for r in rows}
    assert days == {date(2026, 11, 21), date(2026, 11, 22)}
    doors = next(r for r in rows if r["title"] == "Doors open")
    assert doors["starts_at"].astimezone(ZoneInfo("Europe/Helsinki")).strftime("%H:%M") == "16:00"


async def test_a_second_run_the_same_day_changes_nothing(env: Env) -> None:
    await seed(env)
    before = [(r["id"], r["revision"]) for r in await demo_rows(env)]
    assert await seed(env) == dev_seed.UP_TO_DATE
    assert [(r["id"], r["revision"]) for r in await demo_rows(env)] == before


async def test_a_later_day_moves_the_run_of_show_to_it(env: Env) -> None:
    await seed(env)
    old_ids = {r["id"] for r in await demo_rows(env)}
    env.clock[0] = NOW + timedelta(days=3)
    assert await seed(env) == dev_seed.SEEDED
    rows = await demo_rows(env)
    assert {local_day(r) for r in rows} == {
        NOW.date() + timedelta(days=3),
        NOW.date() + timedelta(days=4),
    }
    assert not old_ids & {r["id"] for r in rows}
    removed = [e for e in env.events() if e.get("type") == "agenda.item.removed"]
    assert len(removed) == len(old_ids)


async def test_never_over_an_agenda_made_by_hand(env: Env) -> None:
    await add_by_hand(env)
    assert await seed(env) == dev_seed.HAND_MADE
    assert [r["title"] for r in await demo_rows(env)] == ["Board games"]


async def test_never_over_a_seeded_item_changed_by_hand(env: Env) -> None:
    await seed(env)
    raffle = next(r for r in await demo_rows(env) if r["title"] == "Raffle")
    with tenant_scope(DEMO_TENANT):
        edit = {"revision": 1, "title": "Big raffle"}
        await items.edit(env.deps, organiser(), raffle["id"], edit)
    env.clock[0] = NOW + timedelta(days=1)
    assert await seed(env) == dev_seed.HAND_MADE
    titles = [r["title"] for r in await demo_rows(env)]
    assert "Big raffle" in titles and titles.count("Raffle") == 1


async def test_force_resets_to_the_demo_run_of_show(env: Env) -> None:
    await seed(env)
    await add_by_hand(env)
    assert await seed(env, force=True) == dev_seed.SEEDED
    rows = await demo_rows(env)
    assert "Board games" not in {r["title"] for r in rows}
    assert len(rows) == len(dev_seed.DEMO_RUN)
    # After the reset the seed owns the agenda again: a later day moves it.
    env.clock[0] = NOW + timedelta(days=1)
    assert await seed(env) == dev_seed.SEEDED


async def test_other_events_are_untouched(env: Env) -> None:
    await seed(env)
    with tenant_scope("ev-a"):
        async with env.db.tenant() as conn:
            assert await store.items(conn, frozenset(model.VISIBILITIES)) == []
