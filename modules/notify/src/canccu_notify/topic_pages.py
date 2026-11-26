"""Notifications in plain words (#782 part C, plan D12, sheet 01): one sentence on what the page
is for, then each kind of notification with an example of what a phone shows and one switch.
Advanced (topic_advanced.py) keeps every other setting.

A switch posts only `enabled` (`only=enabled`) with the values the page showed, so it never
writes a channel or a parameter back, nor turns `enabled` into the event's own value over admin's
setting `topics` when nothing changed (config.effective)."""

from __future__ import annotations

import json
from datetime import date
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import VersionConflict
from canccu_kit.ui import empty_state, icon, info_tip, status_chip
from canccu_kit.ui import notice as ui_notice
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .access import TOPICS_WRITE, tenant_of
from .config import configured, settings_ready, write_config
from .deps import deps
from .examples import example_for
from .registry import bad, not_found
from .topic_advanced import origin, shown_channels, shown_values
from .web import (
    TOPICS,
    esc,
    hidden,
    notice,
    page,
    page_session,
    redirect,
    switch,
    writer_session,
)

DESCRIPTION = (
    "Choose what attendees can be notified about."
    " Each person picks which of these they want in their hub."
)
NOTICES = {
    "saved": "Saved.",
    "unchanged": "Nothing to save: no value changed.",
    "removed": "Removed, with people's choices for it.",
}
SWITCH_TIP = (
    "On: people can choose this kind in their hub. Off: nobody at this event gets it, and"
    " people's own choices are kept for when it is on again."
)


def _switch_form(found: dict[str, Any], *, enabled: bool, label: str, undo: bool = False) -> str:
    """The form one kind's switch saves through; Undo is the same form, sending the old value."""
    config = found["config"]
    key = found["topic_type"]["key"]
    values = {"config_version": config["config_version"], "shown": shown_values(config)}
    fields = hidden(values | {"only": "enabled"})
    if undo:
        on = '<input type=hidden name=enabled value="on">' if enabled else ""
        return (
            f'<form method=post action="{TOPICS}/{esc(key)}" class="canccu-notify-undo">{fields}'
            f'{on}<button class="canccu-button canccu-button--secondary">Undo</button></form>'
        )
    return (
        f'<form method=post action="{TOPICS}/{esc(key)}" class="canccu-notify-switchform">'
        f"{fields}{switch('enabled', label, enabled, SWITCH_TIP)}"
        '<button class="canccu-button canccu-button--secondary canccu-notify-save">Save</button>'
        "</form>"
    )


def _example(reg: dict[str, Any], zone: str, today: date) -> str:
    title, body = example_for(reg, zone, today)
    if not title and not body:
        return ""
    return (
        '<figure class="canccu-notify-example"><div class="canccu-notify-example__phone">'
        f'<p class="canccu-notify-example__title">{esc(title)}</p><p>{esc(body)}</p>'
        '<span class="canccu-notify-muted">now</span></div>'
        "<figcaption class=canccu-notify-muted>Example of what a phone shows</figcaption></figure>"
    )


def _kind(found: dict[str, Any], zone: str, today: date, writable: bool) -> str:
    reg, enabled = found["topic_type"], found["config"]["enabled"]
    gid, source = origin(found)
    where = "Your own kind" if gid == "own" else f"Comes from {source}"
    chips = (
        status_chip("plain", source, where + ".")
        + " "
        + (
            status_chip("ok", "On", "People can choose it in their hub.")
            if enabled
            else status_chip("plain", "Off", "Nobody at this event gets it.")
        )
    )
    about = f"<p>{esc(reg['description'])}</p>" if reg.get("description") else ""
    title = reg["title"]
    control = _switch_form(found, enabled=enabled, label=f"{title} on") if writable else ""
    return (
        f'<section class="canccu-card canccu-notify-kind" id="{esc(reg["key"])}">'
        f'<div class="canccu-notify-kind__head"><h3 class="canccu-card__title">{esc(title)}</h3>'
        f'<span class="canccu-cluster">{chips}</span></div>{about}'
        f"{_example(reg, zone, today)}{control}</section>"
    )


def _switched(found: dict[str, Any] | None) -> str:
    """The notice after a switch, with Undo (sheet 01, marker 5)."""
    if found is None:
        return ""
    title, enabled = found["topic_type"]["title"], found["config"]["enabled"]
    words = (
        f"Saved. {title} is now on: people can choose it in their hub."
        if enabled
        else f"Saved. {title} is now off for everyone."
    )
    undo = _switch_form(found, enabled=not enabled, label="", undo=True)
    return ui_notice("ok", words, actions=undo)


async def topics_page(request: Request) -> Response:
    session = await page_session(request)
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        every = await configured(conn, d.settings if ready else None)
    ctx = tenant_of(request)
    archived = ctx["status"] == "archived"
    writable = session.has(TOPICS_WRITE) and not archived
    zone = ctx.get("time_zone") or "UTC"
    today = d.now().astimezone(ZoneInfo(zone)).date()
    top = "".join(notice(text) for name, text in NOTICES.items() if request.query_params.get(name))
    if writable:
        top += _switched(every.get(request.query_params.get("switched") or ""))
    if archived:
        top += notice("The event is archived: its kinds can be read, not changed.")
    elif not ready:
        top += notice("Admin is unreachable: the kinds show their defaults.", "error")
    kinds = "".join(_kind(f, zone, today, writable) for f in every.values())
    if not kinds:
        kinds = (
            '<div class="canccu-card">'
            + empty_state(
                "bell",
                "No kinds of notification yet",
                "They appear here when a part that sends notifications is switched on.",
            )
            + "</div>"
        )
    lead = (
        '<div class="canccu-notify-kinds__head"><h2 class="canccu-notify-group" id="kinds-title">'
        f"Kinds of notification</h2>{info_tip(SWITCH_TIP)}</div>"
        "<p class=canccu-notify-muted>Switch off a kind and nobody at this event gets it."
        " People's own choices are kept.</p>"
    )
    advanced = (
        f'<a class="canccu-button canccu-button--secondary" href="{TOPICS}/advanced">Advanced</a>'
    )
    new = (
        f'<a class="canccu-button canccu-button--primary" href="{TOPICS}/new">'
        f"{icon('plus')}New kind</a>"
        if writable
        else ""
    )
    body = f'{top}<section aria-labelledby="kinds-title">{lead}{kinds}</section>'
    return page(
        request,
        "Notifications",
        body,
        actions=new + advanced,
        description=DESCRIPTION,
        script=writable,
    )


def _param_value(p: dict[str, Any], raw: Any) -> Any:
    if p["type"] == "boolean":
        return raw is not None
    if p["type"] == "integer":
        try:
            return int(str(raw))
        except ValueError:
            raise bad(f"params.{p['key']}: a whole number") from None
    return str(raw or "")


async def save_config(request: Request) -> Response:
    session = await writer_session(request)
    ctx = tenant_of(request)
    key = request.path_params["topic"]
    form = await request.form()
    d = deps(request)
    await d.settings.ensure()
    async with d.db.tenant() as conn:
        every = await configured(conn, d.settings)
    found = every.get(key)
    if found is None:
        raise not_found()
    config = found["config"]
    try:
        version = int(str(form.get("config_version")))
    except ValueError:
        raise bad("config_version: required") from None
    if version != config["config_version"]:
        raise VersionConflict(f"config_version is {config['config_version']}")
    try:
        shown = json.loads(str(form.get("shown")))
    except ValueError:
        raise bad("shown: the values the form showed") from None
    if shown != json.loads(shown_values(config)):
        raise VersionConflict("changed meanwhile, here or in admin's settings; reload")
    back = "/advanced" if form.get("back") == "advanced" else ""
    # Only what the person changed on the form: a value they left alone is never written back.
    body: dict[str, Any] = {"config_version": version}
    enabled = form.get("enabled") is not None
    if enabled != shown["enabled"]:
        body["enabled"] = enabled
    if form.get("only") == "enabled":
        if len(body) == 1:
            return redirect(f"?unchanged={key}#{key}")
        await write_config(d, ctx["tenant_id"], session.user_id, key, body)
        return redirect(f"?switched={key}#{key}")
    channels = [c for c in shown_channels(found, every) if form.get(f"channel_{c}") is not None]
    if channels != shown["channels"]:
        body["channels"] = channels
    params = {
        p["key"]: value
        for p in found["topic_type"].get("params") or []
        if (value := _param_value(p, form.get(f"param_{p['key']}")))
        != shown["params"].get(p["key"])
    }
    if params:
        body["params"] = params
    if len(body) == 1:
        return redirect(f"{back}?unchanged={key}#{key}")
    await write_config(d, ctx["tenant_id"], session.user_id, key, body)
    return redirect(f"{back}?saved={key}#{key}")


ROUTES = [
    Route("/admin/topics", topics_page, methods=["GET"]),
    Route("/admin/topics/{topic}", save_config, methods=["POST"]),
]
