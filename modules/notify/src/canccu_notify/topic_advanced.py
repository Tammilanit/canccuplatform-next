"""Advanced notification settings (#782 part C, plan D13, sheet 02): every setting the old topic
list had, grouped by the part of the event a kind comes from, with channels as switches in words,
a whole number as a stepper with quick picks, and a tooltip on every control.

Each form sends back the values it showed, so saving one kind's lead time does not turn its
`enabled` into the event's own value over admin's setting `topics` (config.effective)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import timedelta
from typing import Any

from canccu_kit.ui import icon, info_tip, tooltip
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .access import STATS_READ, TOPICS_WRITE, tenant_of
from .config import configured, settings_ready, type_channels
from .deps import deps
from .web import (
    CHANNEL_LABELS,
    CHANNEL_TIPS,
    OWN,
    OWNER_NAMES,
    PART_LABELS,
    PART_TIPS,
    TOPICS,
    button,
    esc,
    hidden,
    notice,
    page,
    page_session,
    switch,
    text_input,
)

ADVANCED = f"{TOPICS}/advanced"
DESCRIPTION = (
    "Where each kind may go, its timing, and your own kinds. Most events never need this page."
)
ENABLED_TIP = "Off: nobody at this event gets this kind. People's own choices are kept."
PARAM_LABELS = {"lead_minutes": "Reminder lead time"}
PICKS = (5, 10, 15, 30)
NOTICES = {
    "saved": "Saved.",
    "unchanged": "Nothing to save: no value changed.",
}


def shown_channels(found: dict[str, Any], every: Mapping[str, dict[str, Any]]) -> list[str]:
    """The channels a kind's form offers: a custom kind only those its base allows here."""
    if "custom" in found:
        base = every.get(found["custom"]["based_on"])
        return list(base["config"]["channels"]) if base is not None else []
    return type_channels(found["topic_type"])


def shown_values(config: dict[str, Any]) -> str:
    """The values a form showed, sent back with it: a write in admin's settings does not move
    `config_version`, so only these tell a stale form from a change."""
    return json.dumps({k: config[k] for k in ("enabled", "params", "channels")}, sort_keys=True)


def origin(found: dict[str, Any]) -> tuple[str, str]:
    """The group a kind belongs to, as (id, name in words)."""
    if "custom" in found:
        return "own", OWN
    owner = str(found["topic_type"]["owner"])
    return owner, OWNER_NAMES.get(owner, owner.capitalize())


def _labelled(fid: str, label: str, tip: str, control: str, extra: str = "") -> str:
    return (
        '<div class="canccu-field"><div class="canccu-field__labelrow">'
        f'<label class="canccu-field__label" for="{fid}">{esc(label)}</label>{info_tip(tip)}'
        f"</div>{control}{extra}</div>"
    )


def _stepper(fid: str, control: str, unit: str) -> str:
    """Less and More around the number; topics.js steps it, inside its min and max."""

    def step(n: int, words: str, sign: str) -> str:
        return tooltip(
            f'<button type=button class="canccu-stepper__button" data-canccu-step={n} '
            f'data-canccu-for="{fid}" aria-label="{words}">{sign}</button>',
            words,
            repeats_label=True,
        )

    unit_html = f'<span class="canccu-notify-unit">{esc(unit)}</span>' if unit else ""
    return (
        f'<span class="canccu-stepper">{step(-1, "Less", "&minus;")}{control}{unit_html}'
        f"{step(1, 'More', '+')}</span>"
    )


def _picks(fid: str, p: dict[str, Any]) -> str:
    low, high = p.get("min", 1), p.get("max", 10**6)
    buttons = "".join(
        f'<button type=button class="canccu-chip" data-canccu-for="{fid}" data-canccu-pick={n}>'
        f"{n} min</button>"
        for n in PICKS
        if low <= n <= high
    )
    return f'<div class="canccu-chips canccu-field__picks">{buttons}</div>' if buttons else ""


def param_input(key: str, p: dict[str, Any], value: Any) -> str:
    name = f"param_{p['key']}"
    label = PARAM_LABELS.get(p["key"]) or p.get("description") or p["key"]
    tip = p.get("description") or label
    fid = f"canccu-{esc(key)}-{esc(p['key'])}"
    if p["type"] == "boolean":
        return switch(name, label, bool(value), tip)
    if p["type"] != "integer":
        return _labelled(fid, label, tip, text_input(name, value, id=fid))
    minutes = str(p["key"]).endswith("_minutes")
    if "min" in p and "max" in p:
        tip = f"{tip}. From {p['min']} to {p['max']}{' min' if minutes else ''}."
    control = text_input(
        name, value, "number", min=p.get("min"), max=p.get("max"), required=True, id=fid
    )
    picks = _picks(fid, p) if minutes else ""
    return _labelled(fid, label, tip, _stepper(fid, control, "min" if minutes else ""), picks)


def _form(found: dict[str, Any], every: Mapping[str, dict[str, Any]]) -> str:
    reg, config = found["topic_type"], found["config"]
    key = reg["key"]
    channels = "".join(
        switch(f"channel_{c}", CHANNEL_LABELS.get(c, c), c in config["channels"], CHANNEL_TIPS[c])
        if c in CHANNEL_TIPS
        else switch(f"channel_{c}", c, c in config["channels"], c)
        for c in shown_channels(found, every)
    )
    params = "".join(
        param_input(key, p, config["params"].get(p["key"])) for p in reg.get("params") or []
    )
    links = ""
    if "custom" in found:
        links = (
            f' <a class="canccu-button canccu-button--secondary" href="{TOPICS}/{esc(key)}/edit">'
            f'Edit</a> <a class="canccu-button canccu-button--secondary"'
            f' href="{TOPICS}/{esc(key)}/remove">Remove…</a>'
        )
    values = {
        "config_version": config["config_version"],
        "shown": shown_values(config),
        "back": "advanced",
    }
    return (
        f'<form method=post action="{TOPICS}/{esc(key)}">'
        + hidden(values)
        + switch("enabled", "On at this event", config["enabled"], ENABLED_TIP)
        + '<fieldset class="canccu-notify-fieldset"><legend>Where it may go</legend>'
        + f"{channels}</fieldset>"
        + params
        + f'<p class="canccu-notify-actions">{button("Save")}{links}</p></form>'
    )


def _summary(found: dict[str, Any]) -> str:
    config = found["config"]
    channels = ", ".join(CHANNEL_LABELS.get(c, c) for c in config["channels"]) or "none"
    params = "".join(
        f"<li>{esc(PARAM_LABELS.get(k, k))}: {esc(v)}</li>" for k, v in config["params"].items()
    )
    state = "On at this event" if config["enabled"] else "Off at this event"
    return f"<p>{state} · Where it may go: {esc(channels)}</p>" + (
        f"<ul>{params}</ul>" if params else ""
    )


def _card(found: dict[str, Any], every: Mapping[str, Any], counts: Any, writable: bool) -> str:
    reg = found["topic_type"]
    meta = ""  # the group's heading names where it comes from
    if counts is not None:
        day, total = counts.get(reg["key"], (0, 0))
        meta = f"{day} sent in the last 24 hours · {total} in all"
    parts = "".join(
        f"<li>{esc(PART_LABELS.get(name, name))} {info_tip(PART_TIPS.get(name, name))}</li>"
        for name in reg["parts"]
    )
    head = f'<p class="canccu-notify-muted">{esc(meta)}</p>' if meta else ""
    if reg.get("description"):
        head += f"<p>{esc(reg['description'])}</p>"
    head += f'<ul class="canccu-notify-parts">{parts}</ul>'
    body = _form(found, every) if writable else _summary(found)
    return (
        f'<section class="canccu-card canccu-notify-topic" id="{esc(reg["key"])}">'
        f'<h3 class="canccu-card__title">{esc(reg["title"])}</h3>{head}{body}</section>'
    )


def _groups(every: Mapping[str, dict[str, Any]]) -> list[tuple[str, str, list[dict[str, Any]]]]:
    """Kinds by the part they come from: the menu's order, unknown parts next, your own last."""
    groups: dict[str, tuple[str, list[dict[str, Any]]]] = {}
    for found in every.values():
        gid, name = origin(found)
        groups.setdefault(gid, (name, []))[1].append(found)
    order = [*OWNER_NAMES, *sorted(g for g in groups if g not in OWNER_NAMES and g != "own"), "own"]
    return [(g, groups[g][0], groups[g][1]) for g in order if g in groups]


async def advanced_page(request: Request) -> Response:
    session = await page_session(request)
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        every = await configured(conn, d.settings if ready else None)
        counts = None
        if session.has(STATS_READ):
            # Counts only, never recipients (contracts/notify.md, Rights).
            rows = await conn.fetch(
                "SELECT topic, count(*) FILTER (WHERE created_at > $1) AS day, count(*) AS total"
                " FROM notify_notifications GROUP BY topic",
                d.now() - timedelta(hours=24),
            )
            counts = {r["topic"]: (r["day"], r["total"]) for r in rows}
    archived = tenant_of(request)["status"] == "archived"
    writable = session.has(TOPICS_WRITE) and not archived
    top = "".join(notice(text) for name, text in NOTICES.items() if request.query_params.get(name))
    if archived:
        top += notice("The event is archived: its kinds can be read, not changed.")
    elif not ready:
        top += notice("Admin is unreachable: the kinds show their defaults.", "error")
    sections = "".join(
        f'<section id="group-{esc(gid)}" aria-labelledby="group-{esc(gid)}-title">'
        f'<h2 class="canccu-notify-group" id="group-{esc(gid)}-title">'
        f"{esc(name + ' kinds' if gid == 'own' else name)}</h2>"
        + "".join(_card(f, every, counts, writable) for f in kinds)
        + "</section>"
        for gid, name, kinds in _groups(every)
    )
    new = (
        f'<a class="canccu-button canccu-button--primary" href="{TOPICS}/new">'
        f"{icon('plus')}New kind</a>"
        if writable
        else ""
    )
    return page(
        request,
        "Advanced notification settings",
        top + sections,
        actions=new,
        description=DESCRIPTION,
        script=True,
    )


ROUTES = [Route("/admin/topics/advanced", advanced_page, methods=["GET"])]
