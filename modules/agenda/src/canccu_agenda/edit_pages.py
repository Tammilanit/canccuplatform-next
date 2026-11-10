"""Delay ("and everything after it"), cancel and "show on screens now", each with its preview:
what moves, what does not and why, and who is told (plan issue-187 D10, D14).

The preview and the change share `edits.plan_delay`. A delay with following also moves items
the preview listed, so its confirm carries the `agenda_version` it was shown at: if the run of
show changed meanwhile, the organiser sees the new preview instead of a different change.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from canccu_kit import KitError
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import announce, edits, forms, model, store, undo
from .access import writer
from .deps import Deps, deps
from .effective import read_channels
from .inverse import Inverse
from .item_pages import load_item
from .preview import change_of, moved_line, preview_html, told, told_announce
from .web import (
    BASE,
    button,
    esc,
    field,
    hhmm,
    hidden,
    notice,
    page,
    redirect,
    text_input,
    zone_of,
)

CHIPS = (5, 10, 15, 30)


def _day(row: Any, request: Request) -> str:
    starts: datetime = row["starts_at"]
    return starts.astimezone(zone_of(request)).date().isoformat()


async def _plan(d: Deps, row: Any, minutes: int, following: bool, now: datetime) -> Any:
    async with d.db.tenant() as conn:
        plan = await edits.plan_delay(conn, row, minutes, following, now, lock=False)
        version = (await store.state(conn))["agenda_version"]
        kinds = await store.kinds(conn)
    return plan, version, kinds


async def _delay_preview(
    request: Request, row: Any, minutes: int, following: bool
) -> tuple[str, int, int]:
    """The preview of a delay, the `agenda_version` it shows and the number of items it moves."""
    d = deps(request)
    tz, now = zone_of(request), d.now()
    plan, version, kinds = await _plan(d, row, minutes, following, now)
    channels = await read_channels(d)
    changed = [moved_line(r, s, e, tz) for r, s, e in plan.moves]
    if row["starts_at"] <= now:
        changed.insert(0, f"{row['title']} is running: its end moves, its start stays.")
    kept = [f"{r['title']} stays at {hhmm(r['starts_at'], tz)}: {why}." for r, why in plan.kept]
    who = told("delay", [change_of(r, kinds, channels, s) for r, s, _ in plan.moves], now)
    return preview_html(changed, kept, who), version, len(plan.moves)


async def delay_page(request: Request) -> Response:
    await writer(request)
    d = deps(request)
    row, _, _ = await load_item(d, request.path_params["item_id"])
    q = request.query_params
    chosen = "minutes" in q or "other" in q
    following = q.get("following") == "1" if chosen else True
    base = f"{BASE}/items/{esc(row['id'])}"
    chips = "".join(
        button(
            f"+{m}",
            "primary" if q.get("minutes") == str(m) else "secondary",
            name="minutes",
            value=str(m),
        )
        for m in CHIPS
    )
    choose = (
        f'<form method=get action="{base}/delay" class="canccu-agenda-form">'
        # Enter in a field submits with the form's first button: this one sends no chip, so the
        # typed minutes count.
        '<button class="canccu-agenda-hidden" tabindex=-1 aria-hidden=true>Preview</button>'
        f'<div class="canccu-agenda-chips-row">{chips}</div>'
        '<label class="canccu-field"><span class="canccu-field__label">Other (minutes;'
        " negative brings it forward)</span>"
        f'<input class="canccu-input" type=number name=other min=-720 max=720'
        f' value="{esc(q.get("other", ""))}"></label>'
        '<label class="canccu-field canccu-field--check"><input class=canccu-check type=checkbox'
        f" name=following value=1{' checked' if following else ''}> and everything after it</label>"
        f"{button('Preview', 'secondary')}</form>"
    )
    body = (
        notice("The run of show changed meanwhile: check the preview again.", "error")
        if q.get("changed")
        else ""
    )
    body += choose
    if chosen:
        try:
            minutes = edits.minutes_of(_int(q.get("minutes") or q.get("other")))
            preview, version, count = await _delay_preview(request, row, minutes, following)
        except KitError as exc:
            body += notice(exc.message, "error")
        else:
            items = f"{count} item{'s' if count != 1 else ''}"
            label = (
                f"Delay {items} +{minutes} min"
                if minutes > 0
                else (f"Bring {items} forward {-minutes} min")
            )
            body += preview + (
                f'<form method=post action="{base}/delay" class="canccu-agenda-actions">'
                + hidden(
                    {
                        "revision": row["revision"],
                        "minutes": minutes,
                        "following": "1" if following else "",
                        "agenda_version": version,
                    }
                )
                + button(label)
                + "</form>"
            )
    return page(request, f"Delay {row['title']}", body)


def _int(value: Any) -> Any:
    try:
        return int(str(value))
    except ValueError:
        return value  # minutes_of refuses it with the API's message


async def delay_save(request: Request) -> Response:
    session = await writer(request)
    d = deps(request)
    form = await request.form()
    item_id = request.path_params["item_id"]
    minutes = edits.minutes_of(_int(form.get("minutes")))
    following = form.get("following") == "1"
    revision = model.revision(_int(form.get("revision")))
    shown = _int(form.get("agenda_version"))
    inverse = Inverse()
    try:
        _, items = await edits.delay(
            d,
            session,
            item_id,
            revision,
            minutes,
            following,
            expected_version=shown if isinstance(shown, int) else -1,
            inverse=inverse,
        )
    except KitError as exc:
        if exc.code != "agenda_changed":
            raise
        query = urlencode({"minutes": minutes, "following": "1" if following else "", "changed": 1})
        return redirect(f"/items/{item_id}/delay?{query}")
    path = f"/?day={_day_of(items[0]['starts_at'], request)}&done=delayed"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


def _day_of(value: str, request: Request) -> str:
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return when.astimezone(zone_of(request)).date().isoformat()


async def cancel_page(request: Request) -> Response:
    await writer(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    row, _, kinds = await load_item(d, request.path_params["item_id"])
    if row["managed_by"] is not None:
        raise model.conflict("item_managed", "cancel the session in the tournament module")
    if row["status"] == "cancelled":
        raise model.conflict("item_cancelled", "the item is already cancelled")
    channels = await read_channels(d)
    preview = preview_html(
        [
            f"{row['title']} at {hhmm(row['starts_at'], tz)} is cancelled: it stays on the run"
            " of show, struck through. Cancelling is final; add it again to bring it back."
        ],
        [],
        told("cancel", [change_of(row, kinds, channels)], now),
    )
    body = preview + (
        f'<form method=post action="{BASE}/items/{esc(row["id"])}/cancel"'
        ' class="canccu-agenda-actions">'
        + hidden({"revision": row["revision"]})
        + button(f"Cancel {row['title']}", "danger")
        + "</form>"
    )
    return page(request, f"Cancel {row['title']}", body)


async def cancel_save(request: Request) -> Response:
    session = await writer(request)
    form = await request.form()
    revision = model.revision(_int(form.get("revision")))
    d, inverse = deps(request), Inverse()
    item_id = request.path_params["item_id"]
    item = await edits.cancel_one(d, session, item_id, revision, inverse=inverse)
    path = f"/?day={_day_of(item['starts_at'], request)}&done=cancelled"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


def bring_forward(row: Any, now: datetime) -> int:
    """Minutes to bring an item forward so screens show it now (plan D14). An item with an end
    starts now and runs; a moment has no "running", so it becomes the next thing, within a
    minute. 0 when there is nothing to bring forward."""
    lead: float = (row["starts_at"] - now) / timedelta(minutes=1)
    if lead <= 0:
        return 0
    minutes = math.ceil(lead) if row["ends_at"] is not None else math.floor(lead)
    if minutes > 720:  # the delay's limit, checked again at the confirm
        raise model.invalid("it starts more than 12 hours from now: move it instead")
    return minutes


def _announce_form(row: Any, kinds: Any, channels: list[str]) -> str:
    """The optional announcement, sent in the same step; quiet hours are never announced."""
    if row["kind"] == "quiet_hours":
        return ""
    who = "".join(
        f"<li>{esc(line)}</li>" for line in told_announce(change_of(row, kinds, channels))
    )
    return (
        '<fieldset class="canccu-agenda-fieldset"><legend>Announcement</legend>'
        '<label class="canccu-field canccu-field--check"><input class=canccu-check type=checkbox'
        " name=announce value=1> Announce it too</label>"
        + field(
            "Message (optional)",
            text_input("message", "", maxlength=announce.MESSAGE_MAX),
            "Up to 140 characters; the item's title is the heading.",
        )
        + f"<h2>If you announce it</h2><ul>{who}</ul></fieldset>"
    )


async def show_now_page(request: Request) -> Response:
    await writer(request)
    d = deps(request)
    row, _, kinds = await load_item(d, request.path_params["item_id"])
    if row["status"] == "cancelled":
        raise model.conflict("item_cancelled", "a cancelled item cannot be shown")
    minutes = bring_forward(row, d.now())
    channels = await read_channels(d)
    announcing = _announce_form(row, kinds, channels)
    if minutes == 0:
        if not announcing:
            body = notice("Screens already show it in now and next.")
            return page(request, f"Show {row['title']} now", body)
        body = notice("Screens already show it in now and next; you can still announce it.")
        label = "Announce now"
    else:
        preview, _, _ = await _delay_preview(request, row, -minutes, False)
        body = (
            "<p>Brings it forward to now with a delay, so every screen shows it in now and next"
            " at once and its planned time stays visible.</p>" + preview
        )
        label = "Show on screens now"
    body += (
        f'<form method=post action="{BASE}/items/{esc(row["id"])}/show-now"'
        ' class="canccu-agenda-form">'
        + hidden({"revision": row["revision"]})
        + announcing
        + f'<div class="canccu-agenda-actions">{button(label)}</div></form>'
    )
    return page(request, f"Show {row['title']} now", body)


async def show_now_save(request: Request) -> Response:
    session = await writer(request)
    d = deps(request)
    form = await request.form()
    row, _, _ = await load_item(d, request.path_params["item_id"])
    announcing = form.get("announce") == "1"
    # Checked before the item moves, so a refused announcement leaves the run of show as it was.
    message = announce.message_of(forms.opt_text(form, "message"))
    if announcing and row["kind"] == "quiet_hours":
        raise model.invalid("quiet hours are never announced")
    # Counted again at the moment of the change, so a moment never lands in the past.
    minutes = bring_forward(row, d.now())
    inverse = Inverse()
    if minutes:
        revision = model.revision(_int(form.get("revision")))
        await edits.delay(d, session, row["id"], revision, -minutes, False, inverse=inverse)
    if announcing:
        # After the bring-forward, so the announced item carries its new times (contract).
        await announce.announce(d, session, row["id"], message)
    done = ("shown_announced" if announcing else "shown") if minutes else "announced"
    path = f"/?day={_day(row, request)}&done={done}"
    # An announcement cannot be taken back; the undo brings the item back to its time.
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


ROUTES = [
    Route("/items/{item_id}/delay", delay_page, methods=["GET"]),
    Route("/items/{item_id}/delay", delay_save, methods=["POST"]),
    Route("/items/{item_id}/cancel", cancel_page, methods=["GET"]),
    Route("/items/{item_id}/cancel", cancel_save, methods=["POST"]),
    Route("/items/{item_id}/show-now", show_now_page, methods=["GET"]),
    Route("/items/{item_id}/show-now", show_now_save, methods=["POST"]),
]
