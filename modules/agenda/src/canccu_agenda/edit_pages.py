"""Cancel and "show on screens now", each with its preview: what moves, what does not and why,
and who is told (plan issue-187 D10, D14). The delay has its own page (delay_pages.py)."""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

from canccu_kit import KitError
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import announce, edits, forms, model, undo
from .delay_pages import as_int, day_of, preview
from .deps import deps
from .effective import read_channels
from .inverse import Inverse
from .item_pages import load_item
from .preview import change_of, preview_html, told, told_announce
from .web import (
    BASE,
    button,
    esc,
    field,
    hhmm,
    hidden,
    notice,
    page,
    page_writer,
    redirect,
    text_input,
    zone_of,
)


def _day(row: Any, request: Request) -> str:
    starts: datetime = row["starts_at"]
    return starts.astimezone(zone_of(request)).date().isoformat()


async def cancel_page(request: Request) -> Response:
    await page_writer(request)
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
    session = await page_writer(request)
    form = await request.form()
    revision = model.revision(as_int(form.get("revision")))
    d, inverse = deps(request), Inverse()
    item_id = request.path_params["item_id"]
    item = await edits.cancel_one(d, session, item_id, revision, inverse=inverse)
    path = f"/?day={day_of(item['starts_at'], request)}&done=cancelled"
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
    await page_writer(request)
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
        body = (
            "<p>Brings it forward to now with a delay, so every screen shows it in now and next"
            " at once and its planned time stays visible.</p>"
            + await preview(request, row, -minutes)
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
    session = await page_writer(request)
    d = deps(request)
    form = await request.form()
    row, _, _ = await load_item(d, request.path_params["item_id"])
    announcing = form.get("announce") == "1"
    # Checked before the item moves, so a refused announcement leaves the run of show as it was.
    message = announce.message_of(forms.opt_text(form, "message")) if announcing else None
    if announcing and row["kind"] == "quiet_hours":
        raise model.invalid("quiet hours are never announced")
    # Counted again at the moment of the change, so a moment never lands in the past.
    minutes = bring_forward(row, d.now())
    if not minutes and not announcing:
        raise model.invalid("screens already show it; tick Announce it too to announce it")
    inverse = Inverse()
    if minutes:
        revision = model.revision(as_int(form.get("revision")))
        await edits.delay(d, session, row["id"], revision, -minutes, False, inverse=inverse)
    # Saved before the announcement: the move has happened whatever the announcement does, so its
    # undo is offered either way. An announcement cannot be taken back.
    undo_id = await undo.save(d, session, inverse)
    done = "shown"
    if announcing:
        try:
            # After the bring-forward, so the announced item carries its new times (contract).
            await announce.announce(d, session, row["id"], message)
        except KitError:
            if not minutes:
                raise  # nothing happened: the error page says why
            done = "shown_not_announced"
        else:
            done = "shown_announced" if minutes else "announced"
    return redirect(undo.with_undo(f"/?day={_day(row, request)}&done={done}", undo_id))


ROUTES = [
    Route("/items/{item_id}/cancel", cancel_page, methods=["GET"]),
    Route("/items/{item_id}/cancel", cancel_save, methods=["POST"]),
    Route("/items/{item_id}/show-now", show_now_page, methods=["GET"]),
    Route("/items/{item_id}/show-now", show_now_save, methods=["POST"]),
]
