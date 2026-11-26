"""The form of a kind of your own (a custom topic): pick a base, then a title, the defaults
(which can only switch channels off) and the conditions (docs/plans/issue-188.md, area O; #782,
D13). The form reads back into the body `PUT /api/notify/topic-types/{custom_…}` takes, so
custom.validate stays the only rule."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from canccu_kit import KitError
from canccu_kit.ui import empty_state, info_tip
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import custom_api, registry
from .access import tenant_of
from .config import configured, settings_ready
from .custom import PREFIX
from .custom_form import (
    conditions_from,
    defaults_from,
    form_rows,
    paths_of,
    rows_html,
    split,
)
from .deps import deps
from .registry import bad, not_found
from .web import (
    CHANNEL_LABELS,
    PART_LABELS,
    TOPICS,
    button,
    check,
    esc,
    field,
    hidden,
    notice,
    page,
    redirect,
    select,
    text_input,
    writer_session,
)

DEFAULTS_TIP = (
    "Where it goes for people who have not chosen yet. Each person can change it in their hub."
)
WHEN_TIP = "It goes out only when every condition holds. A row left empty is skipped."
CUSTOM_ABOUT = (
    "A kind of your own: a narrower copy of one the event has, sent only when its conditions hold."
)


def _form(
    request: Request,
    base: dict[str, Any],
    values: Mapping[str, Any],
    rows: list[tuple[str, str, str]],
    kept: str,
    *,
    key: str | None = None,
    revision: int | None = None,
    error: str = "",
    status: int = 200,
    kinds: list[dict[str, Any]] | None = None,
) -> Response:
    defaults = values.get("defaults") or {}
    boxes = ""
    for name, part in base["parts"].items():
        for channel in part["channels"]:
            allowed = part["defaults"].get(channel) is True
            on = allowed and defaults.get(name, {}).get(channel, True) is not False
            label = f"{PART_LABELS.get(name, name)}: {CHANNEL_LABELS.get(channel, channel)}"
            hint = "" if allowed else "Off, as in the base: a kind of your own cannot switch it on."
            boxes += check(f"default_{name}_{channel}", label, on, disabled=not allowed, hint=hint)
    kept_list = json.loads(kept)
    kept_html = (
        "<p class=canccu-notify-muted>Also, kept as set through the API: "
        + esc("; ".join(json.dumps(c) for c in kept_list))
        + "</p>"
        if kept_list
        else ""
    )
    name_field = (
        field(
            "Key",
            text_input("name", values.get("name") or "", pattern="[a-z0-9_]{1,25}", required=True),
            f"Lowercase letters, digits and _; the kind's key becomes {PREFIX}<key>.",
        )
        if key is None
        else ""
    )
    action = f"{TOPICS}/new" if key is None else f"{TOPICS}/{esc(key)}/edit"
    keys = {"based_on": base["key"], "keep": kept}
    if revision is not None:
        keys["revision"] = str(revision)
    body = (
        (notice(error, "error") if error else "")
        + f"<p>Based on <strong>{esc(base['title'])}</strong>: it reaches the same people as"
        " the base, narrowed by the conditions below, never anyone else.</p>"
        + f'<form method=post action="{action}">{hidden(keys)}{name_field}'
        + field(
            "Title", text_input("title", values.get("title") or "", maxlength=60, required=True)
        )
        + field(
            "Description", text_input("description", values.get("description") or "", maxlength=200)
        )
        + '<fieldset class="canccu-notify-fieldset"><legend>On by default '
        + info_tip(DEFAULTS_TIP)
        + f"</legend>{boxes}"
        "</fieldset>"
        + '<fieldset class="canccu-notify-fieldset"><legend>Only when '
        + info_tip(WHEN_TIP)
        + "</legend>"
        + "<p class=canccu-notify-muted>Every condition must hold. Pick what to look at, a test"
        " and a value; separate the values of 'is one of' with commas.</p>"
        + rows_html(rows, paths_of(base), kinds)
        + kept_html
        + "</fieldset>"
        + f'<p class="canccu-notify-actions">{button("Save")}</p></form>'
    )
    title = "New kind of your own" if key is None else f"Edit {values.get('title') or key}"
    return page(request, title, body, status=status, description=CUSTOM_ABOUT)


async def _kinds(request: Request) -> list[dict[str, Any]] | None:
    """The run of show's item kinds, read as the person (hub.py); None leaves values as text."""
    hub = deps(request).hub
    if hub is None:
        return None
    return await hub.agenda_kinds(request.headers.get("host") or "", request.headers.get("cookie"))


async def _module_types(request: Request) -> dict[str, dict[str, Any]]:
    async with deps(request).db.tenant() as conn:
        return await registry.load(conn)


async def new_page(request: Request) -> Response:
    await writer_session(request)
    regs = await _module_types(request)
    base = regs.get(request.query_params.get("based_on") or "")
    if base is None:
        options = [(k, r["title"]) for k, r in regs.items()]
        if not options:  # nothing to narrow yet: no empty choice with a Next (UX audit F3)
            text = "A kind of your own narrows one a part of the event offers. None offers one yet."
            back = f'<a class="canccu-button canccu-button--secondary" href="{TOPICS}">Back</a>'
            body = (
                '<section class="canccu-card">'
                + empty_state("bell", "Nothing to base a kind on", text, back)
                + "</section>"
            )
            return page(request, "New kind of your own", body, description=CUSTOM_ABOUT)
        body = (
            "<p>A kind of your own narrows one the event has, for example only the"
            " cosplay items of the schedule.</p>"
            f'<form method=get action="{TOPICS}/new">'
            + field("Based on", select("based_on", options, None))
            + f'<p class="canccu-notify-actions">{button("Next")}</p></form>'
        )
        return page(request, "New kind of your own", body, description=CUSTOM_ABOUT)
    return _form(request, base, {}, [], "[]", kinds=await _kinds(request))


async def _submit(request: Request, key: str | None) -> Response:
    session = await writer_session(request)
    ctx = tenant_of(request)
    form = await request.form()
    regs = await _module_types(request)
    revision: int | None = None
    if key is None:
        base = regs.get(str(form.get("based_on") or ""))
        topic = PREFIX + str(form.get("name") or "")
    else:
        current = await _custom(request, key)
        base, topic = regs.get(current["custom"]["based_on"]), key
        revision = custom_api.revision_of(str(form.get("revision") or "") or None)
    if base is None:
        raise bad("based_on: a module's topic type")
    try:
        body: dict[str, Any] = {
            "based_on": base["key"],
            "title": str(form.get("title") or ""),
            "description": str(form.get("description") or "") or None,
            "defaults": defaults_from(form, base),
            "where": conditions_from(form),
        }
        if revision is not None:
            body["revision"] = revision
        await custom_api.save(deps(request), ctx["tenant_id"], session.user_id, topic, body)
    except KitError as exc:
        if exc.status != 400:
            raise
        # Shown again with what was typed, and why it was refused.
        values = {**form, "defaults": defaults_from(form, base)}
        kept = str(form.get("keep") or "[]")
        return _form(
            request,
            base,
            values,
            form_rows(form),
            kept,
            key=key,
            revision=revision,
            error=exc.message,
            status=400,
            kinds=await _kinds(request),
        )
    return redirect(f"?saved={topic}#{topic}")


async def new_submit(request: Request) -> Response:
    return await _submit(request, None)


async def _custom(request: Request, key: str) -> dict[str, Any]:
    d = deps(request)
    ready = await settings_ready(d.settings)
    async with d.db.tenant() as conn:
        found = (await configured(conn, d.settings if ready else None)).get(key)
    if found is None or "custom" not in found:
        raise not_found()
    return found


async def edit_page(request: Request) -> Response:
    await writer_session(request)
    key = request.path_params["topic"]
    found = await _custom(request, key)
    reg = found["topic_type"]
    base = (await _module_types(request))[found["custom"]["based_on"]]
    defaults = {n: p["defaults"] for n, p in reg["parts"].items()}
    values = {"title": reg["title"], "description": reg.get("description"), "defaults": defaults}
    rows, kept = split(found["custom"]["where"])
    revision = found["custom"]["revision"]
    return _form(
        request,
        base,
        values,
        rows,
        json.dumps(kept),
        key=key,
        revision=revision,
        kinds=await _kinds(request),
    )


async def edit_submit(request: Request) -> Response:
    return await _submit(request, request.path_params["topic"])


async def remove_page(request: Request) -> Response:
    await writer_session(request)
    found = await _custom(request, request.path_params["topic"])
    reg = found["topic_type"]
    body = (
        "<p>Nobody gets it any more, and the choices people made for it go too.</p>"
        f'<form method=post action="{TOPICS}/{esc(reg["key"])}/remove">'
        + hidden({"revision": found["custom"]["revision"]})
        + f'<p class="canccu-notify-actions">{button("Remove", "danger")}'
        f' <a class="canccu-button canccu-button--secondary" href="{TOPICS}">Keep it</a></p></form>'
    )
    return page(
        request,
        f"Remove {reg['title']}?",
        body,
        description="Removing this kind deletes it and the choices people made for it.",
    )


async def remove_submit(request: Request) -> Response:
    session = await writer_session(request)
    ctx = tenant_of(request)
    key = request.path_params["topic"]
    form = await request.form()
    revision = custom_api.revision_of(str(form.get("revision") or "") or None)
    await custom_api.remove(deps(request), ctx["tenant_id"], session.user_id, key, revision)
    return redirect(f"?removed={key}")


ROUTES = [
    Route("/admin/topics/new", new_page, methods=["GET"]),
    Route("/admin/topics/new", new_submit, methods=["POST"]),
    Route("/admin/topics/{topic}/edit", edit_page, methods=["GET"]),
    Route("/admin/topics/{topic}/edit", edit_submit, methods=["POST"]),
    Route("/admin/topics/{topic}/remove", remove_page, methods=["GET"]),
    Route("/admin/topics/{topic}/remove", remove_submit, methods=["POST"]),
]
