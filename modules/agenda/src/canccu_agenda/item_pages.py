"""The full item form: add an item, or edit and move one. A move shows its preview first."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import KitError
from starlette.datastructures import FormData
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import forms, history, items, merge, model, store, templates, undo
from .access import writer
from .deps import Deps, deps
from .effective import read_channels
from .inverse import Inverse
from .kinds import int_query, not_found
from .preview import change_of, moved_line, preview_html, told
from .web import (
    BASE,
    api_time,
    button,
    esc,
    field,
    from_local,
    hidden,
    local_input,
    next_minute,
    notice,
    page,
    redirect,
    text_input,
    zone_of,
)


def _form(values: dict[str, Any], kinds: Any, action: str, error: str = "") -> str:
    revision = values.get("revision")
    return (
        (notice(error, "error") if error else "")
        + f'<form method=post action="{action}" class="canccu-agenda-form">'
        + (hidden({"revision": revision}) if revision else "")
        + field(
            "Title",
            text_input("title", values.get("title") or "", required=True, maxlength=120),
        )
        + forms.kind_select(kinds, values.get("kind"))
        + field(
            "Starts",
            text_input("starts", values.get("starts") or "", "datetime-local", required=True),
        )
        + field(
            "Ends",
            text_input("ends", values.get("ends") or "", "datetime-local"),
            "Empty for a moment in time, like doors opening.",
        )
        + forms.visibility_select(values.get("visibility"))
        + forms.defaults_fields(values)
        + field(
            "About",
            f'<textarea class="canccu-input" name=description maxlength=2000>'
            f"{esc(values.get('description') or '')}</textarea>",
        )
        + f'<div class="canccu-agenda-actions">{button("Save")}</div></form>'
    )


def _posted(form: FormData) -> dict[str, Any]:
    """The form as posted, for showing it again after a refusal."""
    values: dict[str, Any] = {k: form.get(k) for k in form}
    try:
        values["reminder_leads_minutes"] = forms.leads_from(str(form.get("reminders") or ""))
    except KitError:
        values["reminder_leads_minutes"] = None
    values["notify"] = forms.notify_from(form)
    return values


def _fields(form: FormData, tz: ZoneInfo) -> dict[str, Any]:
    """The posted form as the API's fields."""
    ends = forms.opt_text(form, "ends")
    return {
        "title": forms.opt_text(form, "title"),
        "kind": form.get("kind"),
        "starts_at": from_local(str(form.get("starts") or ""), tz, "starts"),
        "ends_at": None if ends is None else from_local(ends, tz, "ends"),
        "visibility": form.get("visibility"),
        "description": forms.opt_text(form, "description"),
        **forms.defaults_from(form),
    }


async def _kinds(d: Deps) -> Any:
    async with d.db.tenant() as conn:
        await store.ensure_event(conn)
        return await store.kinds(conn)


async def new_page(request: Request) -> Response:
    await writer(request)
    d = deps(request)
    tz, now = zone_of(request), d.now()
    try:
        day = date.fromisoformat(request.query_params.get("day", ""))
    except ValueError:
        day = now.astimezone(tz).date()
    starts = next_minute(now)
    if day != now.astimezone(tz).date():
        starts = datetime.combine(day, time(12, 0), tz)
    values: dict[str, Any] = {"starts": local_input(api_time(starts), tz), "visibility": "public"}
    async with d.db.tenant() as conn:
        rows = await templates.all_templates(conn)  # makes the event's starter kinds too
        kinds = await store.kinds(conn)
        chosen = request.query_params.get("template")
        template = next((r for r in rows if r["id"] == chosen), None)
    if template is not None:
        values.update({k: template[k] for k in templates.FIELDS if k != "name"})
        if template["minutes"]:
            values["ends"] = local_input(
                api_time(starts + timedelta(minutes=template["minutes"])), tz
            )
    links = " · ".join(
        f'<a href="{BASE}/items/new?day={day}&amp;template={esc(r["id"])}">{esc(r["name"])}</a>'
        for r in rows
    )
    body = (f"<p>Start from a template: {links}</p>" if links else "") + _form(
        values, kinds, f"{BASE}/items/new"
    )
    return page(request, "New item", body)


async def add_page(request: Request) -> Response:
    session = await writer(request)
    d = deps(request)
    tz = zone_of(request)
    form = await request.form()
    inverse = Inverse()
    try:
        item = await items.add(d, session, _fields(form, tz), inverse=inverse)
    except KitError as exc:
        body = _form(_posted(form), await _kinds(d), f"{BASE}/items/new", exc.message)
        return page(request, "New item", body, status=400)
    path = f"/?day={_day(item['starts_at'], tz)}&done=added"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


def _day(value: str, tz: ZoneInfo) -> str:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(tz).date().isoformat()


async def load_item(d: Deps, item_id: str) -> tuple[Any, dict[str, Any], Any]:
    channels = await read_channels(d)
    async with d.db.tenant() as conn:
        row = await store.item(conn, item_id)
        if row is None:
            raise not_found("item")
        kinds = await store.kinds(conn)
    return row, model.item_json(row, kinds, channels), kinds


def _values_of(item: dict[str, Any], tz: ZoneInfo) -> dict[str, Any]:
    return {
        **item,
        "starts": local_input(item["starts_at"], tz),
        "ends": local_input(item.get("ends_at"), tz),
    }


async def edit_page(request: Request) -> Response:
    await writer(request)
    d = deps(request)
    tz = zone_of(request)
    row, item, kinds = await load_item(d, request.path_params["item_id"])
    action = f"{BASE}/items/{esc(row['id'])}/edit"
    return page(request, f"Edit {row['title']}", _form(_values_of(item, tz), kinds, action))


async def save_page(request: Request) -> Response:
    session = await writer(request)
    d = deps(request)
    tz = zone_of(request)
    row, item, kinds = await load_item(d, request.path_params["item_id"])
    form = await request.form()
    action = f"{BASE}/items/{esc(row['id'])}/edit"
    current = _values_of(item, tz)
    try:
        fields = _fields(form, tz)
        sent = model.revision(int_query(str(form.get("revision") or "")))
        if sent != row["revision"]:
            rebased = await merge.rebase(d, row, sent, fields, tz)
            if not rebased.complete or rebased.clash:
                return _clash_page(request, rebased, item, kinds, tz)
            fields = rebased.fields
        # Only times the organiser changed are sent: sending the current time of a delayed item
        # would be a move that clears its delay.
        for key, name in (("starts_at", "starts"), ("ends_at", "ends")):
            if key in fields and (form.get(name) or "") == current[name]:
                del fields[key]
        fields["revision"] = row["revision"]
        moving = "starts_at" in fields or "ends_at" in fields
        if moving and not form.get("confirm"):
            return _move_preview(request, form, row, kinds, fields, tz)
        inverse = Inverse()
        await items.edit(d, session, row["id"], fields, inverse=inverse)
    except KitError as exc:
        if exc.code == "version_conflict":
            raise
        body = _form(_posted(form), kinds, action, exc.message)
        return page(request, f"Edit {row['title']}", body, status=400)
    path = f"/?day={_day(fields.get('starts_at') or item['starts_at'], tz)}&done=saved"
    return redirect(undo.with_undo(path, await undo.save(d, session, inverse)))


def _clash_page(
    request: Request, rebased: merge.Rebased, item: dict[str, Any], kinds: Any, tz: ZoneInfo
) -> Response:
    """Who changed what since the form was read, and the form again as the item is now."""
    if not rebased.complete:
        raise model.conflict("version_conflict", "the item changed: read it again")
    changes = "".join(f"<li>{esc(history.line(r, tz))}</li>" for r in rebased.log)
    body = (
        notice(
            f"Someone changed this item meanwhile. Your change to {history.labels(rebased.clash)}"
            " was not saved: the form shows the item as it is now.",
            "error",
        )
        + f'<ul class="canccu-agenda-changes">{changes}</ul>'
        + _form(_values_of(item, tz), kinds, f"{BASE}/items/{esc(item['id'])}/edit")
    )
    return page(request, f"Edit {item['title']}", body, status=409)


def _move_preview(
    request: Request, form: FormData, row: Any, kinds: Any, fields: dict[str, Any], tz: ZoneInfo
) -> Response:
    starts = model.parse_time(fields.get("starts_at", item_time(row["starts_at"])), "starts_at")
    ends_raw = fields["ends_at"] if "ends_at" in fields else item_time(row["ends_at"])
    ends = None if ends_raw is None else model.parse_time(ends_raw, "ends_at")
    if ends is not None and ends <= starts:
        raise model.invalid("the end must be after the start")
    channels = list(model.DEFAULT_CHANNELS)  # moves tell nobody, so channels do not matter
    preview = preview_html(
        [moved_line(row, starts, ends, tz) + " (a new plan: no delay shows)"],
        [],
        told("move", [change_of(row, kinds, channels, starts)], deps(request).now()),
    )
    keep = {k: form.getlist(k) for k in form}
    body = (
        preview
        + f'<form method=post action="{BASE}/items/{esc(row["id"])}/edit"'
        + ' class="canccu-agenda-actions">'
        + hidden({**keep, "confirm": "1"})
        + button("Move it")
        + f'<a class="canccu-button canccu-button--secondary" href="{BASE}/items/{esc(row["id"])}">'
        "Back</a></form>"
    )
    return page(request, f"Move {row['title']}", body)


def item_time(value: datetime | None) -> str | None:
    return None if value is None else model.iso(value)


ROUTES = [
    Route("/items/new", new_page, methods=["GET"]),
    Route("/items/new", add_page, methods=["POST"]),
    Route("/items/{item_id}/edit", edit_page, methods=["GET"]),
    Route("/items/{item_id}/edit", save_page, methods=["POST"]),
]
