"""The custom-topic form: pick a base, then a title, the defaults (which can only switch channels
off) and the conditions (docs/plans/issue-188.md, area O). The form reads back into the body
`PUT /api/notify/topic-types/{custom_…}` takes, so custom.validate stays the only rule."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from canccu_kit import KitError
from canccu_kit.ui import empty_state
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import custom_api, engine, registry
from .access import tenant_of
from .config import configured, settings_ready
from .custom import PREFIX
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

OPS = {
    "eq": "is",
    "ne": "is not",
    "in": "is one of",
    "not_in": "is none of",
    "exists": "is set",
    "within_minutes": "is at most this many minutes ahead",
}
"""The conditions the form writes. `nearest_in` and conditions against a parameter are set
through the API; the form keeps them as they are."""
EMPTY_ROWS = 2


def _literal(text: str) -> Any:
    # Numbers and true/false compare as such in the event; anything else is text.
    try:
        value = json.loads(text)
    except ValueError:
        return text
    return value if isinstance(value, bool | int | float) else text


def _display(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(_display(v) for v in value)
    return json.dumps(value) if isinstance(value, bool) else str(value)


def _value(op: str, raw: str, where: str) -> Any:
    if op in ("in", "not_in"):
        return [_literal(part.strip()) for part in raw.split(",") if part.strip()]
    if op == "within_minutes":
        try:
            return int(raw)
        except ValueError:
            raise bad(f"{where}: minutes, a whole number") from None
    return _literal(raw.strip())


def _row_indexes(form: Mapping[str, Any]) -> list[int]:
    found = {k.removeprefix("where_field_") for k in form if k.startswith("where_field_")}
    return sorted(int(i) for i in found if i.isdigit())


def conditions_from(form: Mapping[str, Any]) -> list[Any]:
    out: list[Any] = []
    for i in _row_indexes(form):
        path = str(form.get(f"where_field_{i}") or "").strip()
        if not path:
            continue
        op = str(form.get(f"where_op_{i}") or "")
        cond: dict[str, Any] = {"field": path, "op": op}
        if op != "exists":
            cond["value"] = _value(op, str(form.get(f"where_value_{i}") or ""), f"where[{i}]")
        out.append(cond)
    try:
        kept = json.loads(str(form.get("keep") or "[]"))
    except ValueError:
        raise bad("keep: the conditions as JSON") from None
    return out + (kept if isinstance(kept, list) else [])


def defaults_from(form: Mapping[str, Any], base: dict[str, Any]) -> dict[str, dict[str, bool]]:
    """Only the base's channels that default to on can be switched off; the rest stay off."""
    out: dict[str, dict[str, bool]] = {}
    for name, part in base["parts"].items():
        for channel in part["channels"]:
            if part["defaults"].get(channel) is True:
                on = form.get(f"default_{name}_{channel}") is not None
                out.setdefault(name, {})[channel] = on
    return out


def _paths(base: dict[str, Any]) -> list[str]:
    """Paths the base's triggers already use, offered as suggestions for a condition."""
    found: set[str] = set()
    for t in base["triggers"]:
        found.update(c["field"] for c in t.get("where") or [])
        for name in ("title", "body", "url"):
            found.update(
                m.group(1)
                for m in engine.TEMPLATE_RE.finditer(t.get(name) or "")
                if not m.group(1).startswith("param.")
            )
    return sorted(found)


def _rows(rows: list[tuple[str, str, str]]) -> str:
    out = []
    for i, (path, op, value) in enumerate([*rows, *[("", "eq", "")] * EMPTY_ROWS]):
        out.append(
            '<div class="canccu-notify-condition">'
            + field("Field", text_input(f"where_field_{i}", path, list="canccu-notify-paths"))
            + field("Test", select(f"where_op_{i}", list(OPS.items()), op))
            + field("Value", text_input(f"where_value_{i}", value))
            + "</div>"
        )
    return "".join(out)


def _split(conditions: list[Any]) -> tuple[list[tuple[str, str, str]], list[Any]]:
    """The conditions the form shows as rows, and those it keeps as set through the API."""
    rows, kept = [], []
    for c in conditions:
        if c.get("op") in OPS and "param" not in c:
            rows.append((c["field"], c["op"], _display(c.get("value", ""))))
        else:
            kept.append(c)
    return rows, kept


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
) -> Response:
    defaults = values.get("defaults") or {}
    boxes = ""
    for name, part in base["parts"].items():
        for channel in part["channels"]:
            allowed = part["defaults"].get(channel) is True
            on = allowed and defaults.get(name, {}).get(channel, True) is not False
            label = f"{PART_LABELS.get(name, name)}: {CHANNEL_LABELS.get(channel, channel)}"
            hint = "" if allowed else "Off, as in the base: a custom topic cannot switch it on."
            boxes += check(f"default_{name}_{channel}", label, on, disabled=not allowed, hint=hint)
    paths = "".join(f'<option value="{esc(p)}">' for p in _paths(base))
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
            f"Lowercase letters, digits and _; the topic's key becomes {PREFIX}<key>.",
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
        + f'<fieldset class="canccu-notify-fieldset"><legend>On by default</legend>{boxes}'
        "</fieldset>"
        + '<fieldset class="canccu-notify-fieldset"><legend>Only when</legend>'
        + "<p class=canccu-notify-muted>Every condition must hold. A field is a path into the"
        " event, like data.item.kind; numbers and true/false are read as such; separate the"
        " values of 'is one of' with commas.</p>"
        + _rows(rows)
        + kept_html
        + f'<datalist id="canccu-notify-paths">{paths}</datalist></fieldset>'
        + f'<p class="canccu-notify-actions">{button("Save")}</p></form>'
    )
    title = "New topic" if key is None else f"Edit {values.get('title') or key}"
    return page(request, title, body, status=status)


def _form_rows(form: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    return [
        (
            str(form.get(f"where_field_{i}") or ""),
            str(form.get(f"where_op_{i}") or "eq"),
            str(form.get(f"where_value_{i}") or ""),
        )
        for i in _row_indexes(form)
        if str(form.get(f"where_field_{i}") or "").strip()
    ]


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
            text = (
                "A topic of this event's own narrows one a module offers. No module offers one yet."
            )
            back = f'<a class="canccu-button canccu-button--secondary" href="{TOPICS}">Back</a>'
            body = (
                '<section class="canccu-card">'
                + empty_state("bell", "Nothing to base a topic on", text, back)
                + "</section>"
            )
            return page(request, "New topic", body)
        body = (
            "<p>A topic of this event's own narrows one a module offers, for example only the"
            " cosplay items of the schedule.</p>"
            f'<form method=get action="{TOPICS}/new">'
            + field("Based on", select("based_on", options, None))
            + f'<p class="canccu-notify-actions">{button("Next")}</p></form>'
        )
        return page(request, "New topic", body)
    return _form(request, base, {}, [], "[]")


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
            _form_rows(form),
            kept,
            key=key,
            revision=revision,
            error=exc.message,
            status=400,
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
    rows, kept = _split(found["custom"]["where"])
    revision = found["custom"]["revision"]
    return _form(request, base, values, rows, json.dumps(kept), key=key, revision=revision)


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
    return page(request, f"Remove {reg['title']}?", body)


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
