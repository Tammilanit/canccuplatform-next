"""The trigger engine alone: no database, every rule as a fixture."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from topics import reminder, schedule

from canccu_notify import engine

NOW = datetime(2026, 11, 20, 17, 0, tzinfo=UTC)
HELSINKI = ZoneInfo("Europe/Helsinki")


def run(data: dict[str, Any], *, params: dict[str, Any] | None = None, **env: Any) -> list[Any]:
    trigger = schedule()["triggers"][0]
    envelope = {"id": "e1", "type": "agenda.reminder.triggered", "data": data, **env}
    return engine.evaluate(
        "schedule",
        trigger,
        ["push", "discord_dm"],
        params or {"lead_minutes": 10},
        envelope,
        NOW,
        HELSINKI,
    )


def test_a_reminder_becomes_one_candidate_in_the_events_time_zone() -> None:
    [c] = run(reminder())
    assert (c.title, c.body, c.url) == ("Dinner at 20:00", "Starts in 10 min", "/notify/agenda/it1")
    assert c.audience == "public" and c.part == "event" and not c.urgent
    assert c.expires_at == datetime(2026, 11, 20, 18, 0, tzinfo=UTC)
    assert c.dedupe_key == "schedule\x1fe1"


def test_crew_items_and_quiet_hours_never_reach_phones() -> None:
    assert run(reminder("crew")) == []
    assert run(reminder(kind="quiet_hours")) == []


def test_nearest_lead_wins_and_a_tie_takes_the_larger() -> None:
    data = reminder(lead=15)
    data["leads_minutes"] = [5, 15]
    assert len(run(data)) == 1  # 10 is as near to 5 as to 15: the larger
    data["lead_minutes"] = 5
    assert run(data) == []
    data["leads_minutes"] = []
    assert run(data) == []


def test_channels_field_narrows_and_none_left_drops() -> None:
    [c] = run(reminder(notify_channels=["push"]))
    assert c.channels == ("push",)
    assert run(reminder(notify_channels=[])) == []
    assert run(reminder(notify_channels=None)) == []


def test_conditions_on_missing_paths_are_false() -> None:
    env = {"data": {"a": 1, "when": "2026-11-20T18:00:00Z", "list": ["x"]}}

    def ok(**cond: Any) -> bool:
        return engine.holds(cond, env, {"p": ["x"]}, NOW)

    assert ok(field="data.a", op="eq", value=1) and not ok(field="data.b", op="ne", value=1)
    assert ok(field="data.a", op="exists") and not ok(field="data.b", op="exists")
    assert ok(field="data.list", op="ne", value=[]) and ok(field="data.a", op="not_in", param="p")
    assert ok(field="data.when", op="within_minutes", value=60)
    assert not ok(field="data.when", op="within_minutes", value=59)


def test_within_minutes_is_false_for_the_past() -> None:
    env = {"data": {"when": "2026-11-20T16:59:00Z"}}
    assert not engine.holds(
        {"field": "data.when", "op": "within_minutes", "value": 120}, env, {}, NOW
    )


def test_templates_and_formatters() -> None:
    env = {"data": {"m": -5, "p": 15, "at": "2026-11-20T18:00:00Z"}}
    fill = engine.fill
    assert fill("{data.m|signed} {data.p|signed}", env, {}, HELSINKI) == engine.MINUS + "5 +15"
    assert fill("{data.at|date} {data.at|time}", env, {}, HELSINKI) == "2026-11-20 20:00"
    assert fill("[{data.none}] {param.x}", env, {"x": 3}, HELSINKI) == "[] 3"


def test_dedupe_by_audience_and_missing_values() -> None:
    trigger = {**schedule()["triggers"][1]}
    data = {"item": {**reminder()["item"], "starts_at": "2026-11-20T18:00:00Z"}, "minutes": 15}
    envelope = {"id": "e9", "type": "agenda.item.delayed", "correlation_id": "c1", "data": data}
    [c] = engine.evaluate("schedule", trigger, ["push"], {}, envelope, NOW, HELSINKI)
    assert c.dedupe_key == "schedule\x1fc1\x1fpublic"
    assert c.body == "Now at 20:00 (+15 min)"
    del envelope["correlation_id"]
    [c] = engine.evaluate("schedule", trigger, ["push"], {}, envelope, NOW, HELSINKI)
    assert c.dedupe_key == "schedule\x1fe9\x1fpublic"


def test_personal_recipients_are_user_ids_only() -> None:
    trigger = {
        "event": "games.session.invited",
        "part": "personal",
        "recipients": {"user_field": "data.user_ids"},
        "title": "t" * 100,
        "body": "b",
    }
    envelope: dict[str, Any] = {
        "id": "e1",
        "type": "games.session.invited",
        "data": {"user_ids": ["u1", None, 3, "u1", "u2"]},
    }
    [c] = engine.evaluate("play", trigger, ["push"], {}, envelope, NOW, HELSINKI)
    assert c.user_ids == ("u1", "u2") and c.audience == "personal"
    assert len(c.title) == engine.TITLE_MAX
    assert c.expires_at == NOW + engine.PERSONAL_EXPIRY
    envelope["data"]["user_ids"] = [None]
    assert engine.evaluate("play", trigger, ["push"], {}, envelope, NOW, HELSINKI) == []
