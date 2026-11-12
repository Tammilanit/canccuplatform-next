"""Delay one item, or it and the items after it, as the accepted design draws the confirm
(docs/design/mockups.html, sheet 5; #382, #388): the two choices, then label and value rows
(Starts, Also moves, Screens, Discord, Phones) and a button that says what it does.

The pages run no script, so the confirm follows the choices without one: it is drawn once for each
combination of "Also move the N items after it" and "Tell people", and the stylesheet shows the one
whose boxes are ticked (agenda.css, `.canccu-agenda-choice`). The preview and the change share
`edits.plan_delay`; a confirm carries the `agenda_version` it was drawn at, and if the run of show
changed meanwhile the organiser sees the new confirm instead of a different change.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from canccu_kit import KitError
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import edits, model, store, undo
from .deps import Deps, deps
from .effective import read_channels
from .inverse import Inverse
from .item_pages import load_item
from .preview import change_of, confirm_rows, told, when_moved
from .web import (
    BASE,
    button,
    check,
    esc,
    hhmm,
    hidden,
    notice,
    page,
    page_writer,
    redirect,
    zone_of,
)

CHIPS = (5, 10, 15, 30)


async def _plans(
    d: Deps, row: Any, minutes: int, options: list[bool], now: datetime
) -> tuple[dict[bool, Any], int, Any]:
    """The plan for each `following` choice, or the refusal that explains why there is none, all
    read in one transaction with the `agenda_version` they show."""
    plans: dict[bool, Any] = {}
    async with d.db.tenant() as conn:
        for following in options:
            try:
                plans[following] = await edits.plan_delay(
                    conn, row, minutes, following, now, lock=False
                )
            except KitError as exc:
                plans[following] = exc
        version = (await store.state(conn))["agenda_version"]
        kinds = await store.kinds(conn)
    return plans, version, kinds


async def _after(d: Deps, row: Any, now: datetime) -> int:
    """How many items "Also move the items after it" would move, from the delay's own plan: which
    items follow does not depend on the minutes, and a shift of one minute is never refused."""
    plans, _, _ = await _plans(d, row, 1, [True], now)
    plan = plans[True]
    return 0 if isinstance(plan, KitError) else len(plan.moves) - 1


def _time(new: datetime, old: datetime, tz: ZoneInfo) -> str:
    return f"<b>{esc(when_moved(new, old, tz))}</b> <s>{esc(hhmm(old, tz))}</s>"


def facts(
    plan: Any, row: Any, kinds: Any, channels: list[str], tz: ZoneInfo, now: datetime, told_: bool
) -> list[tuple[str, str]]:
    """The confirm's rows for one plan: the item's new times, what else moves and what stays,
    then what each surface does. Values are HTML."""
    own = next(m for m in plan.moves if m[0]["id"] == row["id"])
    _, starts, ends = own
    if row["starts_at"] <= now:  # running: its start stays (edits._shifted)
        when = f"Running, so its start stays; it ends {_time(ends, row['ends_at'], tz)}"
    else:
        when = _time(starts, row["starts_at"], tz)
        if ends is not None:
            when += f", ends {esc(when_moved(ends, starts, tz))}"
    others = [
        f"{esc(r['title'])} {_time(s, r['starts_at'], tz)}"
        for r, s, _ in plan.moves
        if r["id"] != row["id"]
    ]
    also = " · ".join(others) or "Nothing else moves."
    kept = [f"{r['title']} stays at {hhmm(r['starts_at'], tz)}: {why}." for r, why in plan.kept]
    if kept:
        also += '<br><span class="canccu-agenda-muted">' + "<br>".join(map(esc, kept)) + "</span>"
    changes = [change_of(r, kinds, channels, s) for r, s, _ in plan.moves]
    who = told("delay", changes, now, announce=told_)
    return [("Starts", when), ("Also moves", also)] + [(k, esc(v)) for k, v in who]


async def preview(request: Request, row: Any, minutes: int) -> str:
    """The rows of a told delay of this item alone: "show on screens now" brings it forward with
    one."""
    d = deps(request)
    now = d.now()
    plans, _, kinds = await _plans(d, row, minutes, [False], now)
    plan = plans[False]
    if isinstance(plan, KitError):
        raise plan
    channels = await read_channels(d)
    return confirm_rows(facts(plan, row, kinds, channels, zone_of(request), now, True))


def _label(minutes: int, count: int, told_: bool) -> str:
    items = f" {count} items" if count > 1 else ""
    verb = f"Delay{items}" if minutes > 0 else f"Bring{items} forward"
    return verb + (" and tell everyone" if told_ else " quietly")


def _confirm(
    request: Request, row: Any, minutes: int, plans: dict[bool, Any], kinds: Any, channels: Any
) -> str:
    """One set of rows and buttons per combination of the two choices; agenda.css shows the one
    the ticked boxes name. Every button posts the same form, so what is sent is what is ticked."""
    tz, now = zone_of(request), deps(request).now()
    back = (
        f'<a class="canccu-button canccu-button--secondary" href="{BASE}/items/{esc(row["id"])}">'
    )
    back += "Don't delay</a>"
    out = ""
    for following, plan in plans.items():
        for told_ in (True, False):
            tags = f'data-following="{int(following)}" data-announce="{int(told_)}"'
            if isinstance(plan, KitError):
                out += f'<div class="canccu-agenda-variant" {tags}>{notice(plan.message, "error")}'
                out += f'<div class="canccu-agenda-confirm-actions">{back}</div></div>'
                continue
            rows = facts(plan, row, kinds, channels, tz, now, told_)
            body = "".join(f"<dt>{esc(k)}</dt><dd>{v}</dd>" for k, v in rows)
            action = button(_label(minutes, len(plan.moves), told_), name="minutes", value=minutes)
            out += (
                f'<div class="canccu-agenda-variant" {tags}><dl class="canccu-dl">{body}</dl>'
                f'<div class="canccu-agenda-confirm-actions">{back}{action}</div></div>'
            )
    return out


async def delay_page(request: Request) -> Response:
    await page_writer(request)
    d = deps(request)
    row, _, _ = await load_item(d, request.path_params["item_id"])
    q = request.query_params
    # This page's own form sends `chosen`; there an unticked box sends nothing. From a link,
    # telling people is the default and the items after it stay.
    following = q.get("following") == "1"
    announcing = q.get("announce") == "1" if "chosen" in q else True
    after = await _after(d, row, d.now())
    raw = q.get("minutes") or q.get("other")
    chips = "".join(
        button(
            f"+{m}",
            "primary" if raw == str(m) else "secondary",
            formmethod="get",
            name="minutes",
            value=m,
        )
        for m in CHIPS
    )
    choices = (
        check(
            "following",
            f"Also move the {after} item{'s' if after != 1 else ''} after it",
            following,
            "Off: they keep their times; only this item moves.",
        )
        if after
        else ""
    ) + check(
        "announce",
        "Tell people (Discord, phones)",
        announcing,
        "Off: nothing is announced. Screens and the hub still show the new time.",
    )
    confirm, title, version = "", "", 0
    if raw:
        try:
            minutes = edits.minutes_of(as_int(raw))
        except KitError as exc:
            confirm = notice(exc.message, "error")
        else:
            options = [False, True] if after else [False]
            plans, version, kinds = await _plans(d, row, minutes, options, d.now())
            channels = await read_channels(d)
            confirm = _confirm(request, row, minutes, plans, kinds, channels)
            title = (
                f"Delay it by {minutes} min?"
                if minutes > 0
                else f"Bring it forward {-minutes} min?"
            )
    else:
        confirm = (
            '<p class="canccu-agenda-muted">Pick how long to see what moves and who is told.</p>'
        )
    body = (
        notice("The run of show changed meanwhile: check the confirm again.", "error")
        if q.get("changed")
        else ""
    )
    body += (
        f'<form method=post action="{BASE}/items/{esc(row["id"])}/delay"'
        ' class="canccu-agenda-form canccu-agenda-choice">'
        + hidden({"chosen": 1, "revision": row["revision"], "agenda_version": version})
        # Enter in the field submits with the form's first button: this one sends no chip, so the
        # typed minutes count.
        + '<button formmethod=get class="canccu-agenda-hidden" tabindex=-1 aria-hidden=true>'
        "Show</button>"
        + f'<div class="canccu-agenda-chips-row">{chips}</div>'
        + '<label class="canccu-field"><span class="canccu-field__label">Other (minutes;'
        " negative brings it forward)</span>"
        + '<input class="canccu-input" type=number name=other min=-720 max=720'
        + f' value="{esc(q.get("other", ""))}"></label>'
        + '<section class="canccu-card canccu-agenda-confirm" aria-label="Confirm">'
        + (f'<h2 class="canccu-card__title">{esc(title)}</h2>' if title else "")
        + f'<div class="canccu-agenda-confirm-choices">{choices}</div>{confirm}</section></form>'
    )
    return page(request, f"Delay {row['title']}", body)


def as_int(value: Any) -> Any:
    """A posted number as an int; anything else as it came, for the check that refuses it."""
    try:
        return int(str(value))
    except ValueError:
        return value


async def delay_save(request: Request) -> Response:
    session = await page_writer(request)
    d = deps(request)
    form = await request.form()
    item_id = request.path_params["item_id"]
    minutes = edits.minutes_of(as_int(form.get("minutes")))
    following = form.get("following") == "1"
    # From this page's form an unticked box sends nothing; a form from before the choice existed
    # sent no `chosen` and told.
    announcing = form.get("announce", "" if "chosen" in form else "1") == "1"
    revision = model.revision(as_int(form.get("revision")))
    shown = as_int(form.get("agenda_version"))
    inverse = Inverse()
    try:
        _, items = await edits.delay(
            d,
            session,
            item_id,
            revision,
            minutes,
            following,
            announce=announcing,
            expected_version=shown if isinstance(shown, int) else -1,
            inverse=inverse,
        )
    except KitError as exc:
        if exc.code != "agenda_changed":
            raise
        query = urlencode(
            {
                "minutes": minutes,
                "following": "1" if following else "",
                "announce": "1" if announcing else "",
                "chosen": 1,
                "changed": 1,
            }
        )
        return redirect(f"/items/{item_id}/delay?{query}")
    path = f"/?day={day_of(items[0]['starts_at'], request)}&done=delayed"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


def day_of(value: str, request: Request) -> str:
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return when.astimezone(zone_of(request)).date().isoformat()


ROUTES = [
    Route("/items/{item_id}/delay", delay_page, methods=["GET"]),
    Route("/items/{item_id}/delay", delay_save, methods=["POST"]),
]
