"""The template pages: list, add, edit and remove the event's templates for recurring items."""

from __future__ import annotations

from typing import Any

from canccu_kit import KitError, MissingRight
from canccu_kit.ui import empty_state, icon
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import forms, store, templates
from .access import WRITE, writer
from .deps import deps
from .kinds import not_found
from .web import BASE, button, esc, field, notice, page, page_session, redirect, text_input


async def _template_writer(request: Request) -> None:
    session = await page_session(request)
    if not session.has(WRITE):
        raise MissingRight(f"needs right {WRITE}")


async def list_page(request: Request) -> Response:
    await _template_writer(request)
    async with deps(request).db.tenant() as conn:
        rows = await templates.all_templates(conn)
        kinds = await store.kinds(conn)
    items = "".join(
        f'<a class="canccu-list__row" href="{BASE}/templates/{esc(r["id"])}">'
        f'<span class="canccu-list__main"><p class="canccu-list__title">{esc(r["name"])}</p>'
        f'<p class="canccu-list__meta">{esc(_summary(r, kinds))}</p></span>'
        f'<span class="canccu-list__end">{icon("right")}</span></a>'
        for r in rows
    )
    new = (
        f'<a class="canccu-button canccu-button--primary" href="{BASE}/templates/new">'
        f"{icon('plus')}New template</a>"
    )
    body = (
        f'<section class="canccu-card canccu-card--flush"><div class="canccu-list">{items}</div>'
        "</section>"
        if items
        else '<section class="canccu-card">'
        + empty_state("calendar", "No templates yet", "A template fills a quick add.", new)
        + "</section>"
    )
    return page(
        request,
        "Templates",
        body,
        actions=new if items else "",
        description="Quick add fills an item from a template: its kind, length, place,"
        " audience, reminders and channels.",
    )


def _summary(row: Any, kinds: dict[str, Any]) -> str:
    kind = kinds.get(row["kind"])
    parts = [kind["name"] if kind else f"{row['kind']} (kind removed)"]
    parts.append(f"{row['minutes']} min" if row["minutes"] else "a moment")
    if row["location"]:
        parts.append(row["location"])
    return " · ".join(parts)


def _form(values: dict[str, Any], template_id: str | None, kinds: Any, error: str = "") -> str:
    action = f"{BASE}/templates/{esc(template_id) if template_id else 'new'}"
    minutes = values.get("minutes")
    remove = ""
    if template_id is not None:
        remove = (
            f'<form method=post action="{action}/delete">'
            f"{button('Remove template', 'danger')}</form>"
        )
    return (
        (notice(error, "error") if error else "")
        + f'<form method=post action="{action}" class="canccu-agenda-form">'
        + field("Name", text_input("name", values.get("name") or "", required=True, maxlength=60))
        + forms.kind_select(kinds, values.get("kind"))
        + field(
            "Length in minutes",
            text_input("minutes", "" if minutes is None else minutes, "number", min=1, max=1440),
            "Empty for a moment in time, like doors opening.",
        )
        + forms.visibility_select(values.get("visibility"))
        + forms.defaults_fields(values)
        + f'<div class="canccu-agenda-actions">{button("Save")}</div></form>'
        + remove
    )


def _values(form: Any) -> dict[str, Any]:
    raw = str(form.get("minutes") or "").strip()
    try:
        minutes = int(raw) if raw else None
    except ValueError:
        minutes = -1  # refused by templates.checked with its message
    return {
        "name": forms.opt_text(form, "name"),
        "kind": form.get("kind"),
        "minutes": minutes,
        "visibility": form.get("visibility"),
        **forms.defaults_from(form),
    }


async def edit_page(request: Request) -> Response:
    await _template_writer(request)
    template_id = request.path_params.get("template_id")
    async with deps(request).db.tenant() as conn:
        row = None if template_id is None else await templates.one(conn, template_id)
        kinds = await store.kinds(conn)
    if template_id is not None and row is None:
        raise not_found("template")
    title = "New template" if row is None else f"Template: {row['name']}"
    values = dict(row) if row is not None else {"visibility": "public", "kind": "other"}
    return page(request, title, _form(values, template_id, kinds))


async def save_page(request: Request) -> Response:
    await writer(request)
    template_id = request.path_params.get("template_id")
    form = await request.form()
    async with deps(request).db.tenant() as conn:
        await templates.ensure(conn)
        kinds = await store.kinds(conn)
        if template_id is not None and await templates.one(conn, template_id) is None:
            raise not_found("template")
        try:
            await templates.save(conn, template_id, _values(form))
        except KitError as exc:
            # Shown again as posted, so nothing typed is lost.
            shown = {**form, **_safe(form)}
            body = _form(shown, template_id, kinds, exc.message)
            return page(request, "Template", body, status=400)
    return redirect("/templates")


def _safe(form: Any) -> dict[str, Any]:
    try:
        reminders = forms.leads_from(form.get("reminders"))
    except KitError:
        reminders = None
    return {"reminder_leads_minutes": reminders, "notify": forms.notify_from(form)}


async def remove_page(request: Request) -> Response:
    await writer(request)
    async with deps(request).db.tenant() as conn:
        await templates.remove(conn, request.path_params["template_id"])
    return redirect("/templates")


ROUTES = [
    Route("/templates", list_page, methods=["GET"]),
    Route("/templates/new", edit_page, methods=["GET"]),
    Route("/templates/new", save_page, methods=["POST"]),
    Route("/templates/{template_id}", edit_page, methods=["GET"]),
    Route("/templates/{template_id}", save_page, methods=["POST"]),
    Route("/templates/{template_id}/delete", remove_page, methods=["POST"]),
]
