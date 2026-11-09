"""Form fields shared by the item, template and quick-add pages, and their reading back into the
values the API takes (so the API's checks stay the only rules)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from . import model
from .web import CHANNEL_LABELS, VISIBILITY_LABELS, esc, field, select, text_input


def opt_text(form: Mapping[str, Any], name: str) -> str | None:
    value = str(form.get(name) or "").strip()
    return value or None


def leads_from(raw: str | None) -> list[int] | None:
    """Empty hands the choice to the kind; `none` turns reminders off."""
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.lower() == "none":
        return []
    try:
        values = [int(part) for part in raw.replace(" ", "").split(",") if part]
    except ValueError:
        raise model.invalid("reminders: minutes before the start, like 30, 10") from None
    return model.leads(values, "reminders")


def notify_from(form: Mapping[str, Any]) -> list[str] | None:
    """Unless "own channels" is ticked, the kind's (or the event's) channels apply."""
    if not form.get("notify_own"):
        return None
    return [c for c in model.CHANNELS if form.get(f"notify_{c}")]


def leads_text(value: Sequence[int] | None) -> str:
    if value is None:
        return ""
    return ", ".join(map(str, value)) if value else "none"


def kind_select(kinds: Mapping[str, Mapping[str, Any]], selected: str | None) -> str:
    options = [(key, str(row["name"])) for key, row in kinds.items()]
    return field("Kind", select("kind", options, selected or "other"))


def visibility_select(selected: str | None) -> str:
    options = list(VISIBILITY_LABELS.items())
    return field("Who sees it", select("visibility", options, selected or "public"))


def defaults_fields(values: Mapping[str, Any]) -> str:
    """Location, zone, reminders and channels: the fields an item and a template share."""
    notify = values.get("notify")
    boxes = "".join(
        f'<label class="canccu-field canccu-field--check"><input class=canccu-check type=checkbox'
        f" name=notify_{c}{' checked' if notify is not None and c in notify else ''}>"
        f" {esc(label)}</label>"
        for c, label in CHANNEL_LABELS.items()
    )
    own = " checked" if notify is not None else ""
    return (
        field("Where", text_input("location", values.get("location") or "", maxlength=120))
        + field(
            "Screen zone",
            text_input("zone", values.get("zone") or "", pattern="[a-z0-9_]{1,32}"),
            "Its zone's screens show it first; empty for every screen.",
        )
        + field(
            "Reminders",
            text_input("reminders", leads_text(values.get("reminder_leads_minutes"))),
            "Minutes before the start, like 30, 10; empty for the kind's; none for no reminders.",
        )
        + '<fieldset class="canccu-agenda-fieldset"><legend>Channels</legend>'
        + '<label class="canccu-field canccu-field--check"><input class=canccu-check'
        + f" type=checkbox name=notify_own{own}> Own channels, instead of the kind's</label>"
        + f"{boxes}</fieldset>"
    )


def defaults_from(form: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "location": opt_text(form, "location"),
        "zone": model.zone(opt_text(form, "zone")),
        "reminder_leads_minutes": leads_from(form.get("reminders")),
        "notify": notify_from(form),
    }
