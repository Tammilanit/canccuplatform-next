"""What the legacy import would write, worked out from the legacy files, Discord's answers and
the event's rows without writing anything: one report line per kind, with the rows that differ
from what is stored. Nothing here talks to Discord or Postgres (legacy_import.py does)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .legacy_files import Legacy
from .purposes import BY_NAME, TYPES

SURGE_DEFAULT = 4
"""Games' `surge_threshold` default (contracts/games.md, Settings)."""
LEGACY_LABEL = {"tournaments": "tournaments", "crew": "alerts"}
"""Each purpose by the legacy channel's name for it, as the operator knew it."""
DONE = " · already imported"


@dataclass(frozen=True)
class Event:
    """The event's rows the plan compares with."""

    mode: str | None
    same_app: bool
    """Its own application is the legacy one already."""
    token_kept: bool
    """…and its stored token is the legacy token."""
    revision: int
    bound_app: str | None
    holder: str | None
    """The event that holds the legacy application's route, if any."""
    purposes: dict[str, str]
    legacy: dict[tuple[str, str], Any]


@dataclass
class Plan:
    lines: list[tuple[str, int, str]] = field(default_factory=list)
    skipped: list[tuple[str, list[str]]] = field(default_factory=list)
    connection: list[str] = field(default_factory=list)
    """The connection's changed fields, as `bot.connection.changed` names them; empty: none."""
    purposes: dict[str, str] = field(default_factory=dict)
    legacy: dict[tuple[str, str], Any] = field(default_factory=dict)


def _line(plan: Plan, kind: str, changes: int, text: str, items: int) -> None:
    done = DONE if items and not changes else ""
    plan.lines.append((kind, changes, text + done))


def _application(plan: Plan, app_id: str, event: Event) -> None:
    if not event.same_app:
        plan.connection = ["mode", "application_id", "bot_token"]
    elif not event.token_kept:
        plan.connection = ["bot_token"]
    text = f"own application {app_id}, token checked with Discord"
    _line(plan, "Bot application", 1 if plan.connection else 0, text, 1)


def _server(plan: Plan, legacy: Legacy, found: dict[str, Any], event: Event) -> None:
    name = found["guild_name"]
    if event.bound_app is not None and event.same_app:
        text = f"{name} ({legacy.guild_id}) → bound"
    else:
        text = f"{name} ({legacy.guild_id}) → binding: finish it in the Discord page's setup (D11)"
    plan.lines.append(("Server", 0, text))


def _channels(plan: Plan, legacy: Legacy, found: dict[str, Any], event: Event) -> None:
    shown: list[str] = []
    for purpose, channel_id in legacy.channels.items():
        label = LEGACY_LABEL[purpose]
        title = BY_NAME[purpose].template_name.capitalize()
        channel = found["channels"].get(channel_id)
        if channel is None or channel.get("type") not in TYPES["channel"]:
            plan.skipped.append((f"{label}: not a text channel of the server any more", []))
            continue
        stored = event.purposes.get(purpose)
        if stored is not None and stored != channel_id:
            why = f"{label} → {title}: kept, the event already uses another channel"
            plan.skipped.append((why, []))
            continue
        shown.append(f"{label} → {title}")
        if stored is None:
            plan.purposes[purpose] = channel_id
    _line(plan, "Channels", len(plan.purposes), " · ".join(shown) or "none", len(shown))


def _admin_role(plan: Plan, legacy: Legacy, found: dict[str, Any]) -> None:
    """Read and shown, never stored: the mapping of Discord roles to platform rights is #763's,
    which the Go-public track builds; the runbook names the step for when it is in."""
    name = legacy.admin_role_name
    role = next((r for r in found["roles"] if r.get("name") == name), None)
    if role is None:
        text = f'"{name}": no role of that name in the server'
    else:
        text = f'"{name}" → role {role["id"]}: waits for #763 (Discord roles to platform rights)'
    plan.lines.append(("Admin role", 0, text))


def _rows(plan: Plan, event: Event, kind: str, values: dict[str, Any]) -> int:
    changes = 0
    for key, value in values.items():
        if event.legacy.get((kind, key)) != value:
            plan.legacy[(kind, key)] = value
            changes += 1
    return changes


def _settings(plan: Plan, legacy: Legacy, event: Event) -> None:
    parts = []
    threshold = legacy.settings.get("GAME_THRESHOLD")
    if threshold is not None:
        # The bot writes only its own settings (contracts/admin.md, Settings), so a value other
        # than Games' default is the operator's to set; the report says which.
        if threshold == SURGE_DEFAULT:
            hint = "its default: nothing to set"
        else:
            hint = "set it in the Games settings"
        parts.append(f"game threshold {threshold} → Games surge_threshold ({hint})")
    ttl = legacy.settings.get("BOT_TICKER_TTL_SECONDS")
    if ttl is not None:
        parts.append(f"ticker TTL {ttl} → default (the new /ticker sets each line's end)")
    changes = _rows(plan, event, "setting", dict(legacy.settings))
    _line(plan, "Settings", changes, " · ".join(parts) or "none", len(parts))


def _finals(plan: Plan, legacy: Legacy, event: Event) -> None:
    parts = []
    watcher = legacy.finals.get("tourney_watcher.json")
    if watcher is not None:
        counts = [
            f"{len(watcher.get(k) or [])} {word}"
            for k, word in (
                ("seasons", "announced"),
                ("started", "started"),
                ("champions", "champion"),
            )
        ]
        parts.append("watcher: " + ", ".join(counts))
    if "finals_cards.json" in legacy.finals:
        parts.append("finals card")
    channels = sum(1 for key in legacy.finals if key.endswith("_CHANNEL_ID"))
    if channels:
        parts.append(f"{channels} finals channel{'s' if channels > 1 else ''}")
    changes = _rows(plan, event, "finals", dict(legacy.finals))
    text = " · ".join(parts) + " → kept for the Finals module (D9)" if parts else "none"
    _line(plan, "Finals state", changes, text, len(legacy.finals))


def plan_rows(legacy: Legacy, found: dict[str, Any], event: Event) -> Plan:
    plan = Plan()
    _application(plan, found["application_id"], event)
    _server(plan, legacy, found, event)
    _channels(plan, legacy, found, event)
    _admin_role(plan, legacy, found)
    _settings(plan, legacy, event)
    _finals(plan, legacy, event)
    return plan
