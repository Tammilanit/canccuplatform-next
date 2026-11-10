"""The topic list: each topic with this event's configuration as a form, and how many
notifications it made for those with `notify.stats.read` (docs/plans/issue-188.md, area O).

The form sends only what changed, so saving one topic's lead time does not turn its `enabled`
into the event's own value over admin's setting `topics` (config.effective)."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from canccu_kit import VersionConflict
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .access import STATS_READ, TOPICS_WRITE, tenant_of
from .config import configured, settings_ready, type_channels, write_config
from .deps import deps
from .registry import bad, not_found
from .web import (
    CHANNEL_LABELS,
    TOPICS,
    button,
    check,
    esc,
    field,
    hidden,
    notice,
    page,
    page_session,
    redirect,
    text_input,
    writer_session,
)

NOTICES = {
    "saved": "Saved.",
    "unchanged": "Nothing to save: no value changed.",
    "removed": "Removed, with people's choices for it.",
}


def shown_channels(found: dict[str, Any], every: dict[str, dict[str, Any]]) -> list[str]:
    """The channels a topic's form offers: a custom topic only those its base allows here."""
    if "custom" in found:
        base = every.get(found["custom"]["based_on"])
        return list(base["config"]["channels"]) if base is not None else []
    return type_channels(found["topic_type"])


def _param_input(p: dict[str, Any], value: Any) -> str:
    name = f"param_{p['key']}"
    label = p.get("description") or p["key"]
    if p["type"] == "boolean":
        return check(name, label, bool(value))
    if p["type"] == "integer":
        control = text_input(
            name, value, "number", min=p.get("min"), max=p.get("max"), required=True
        )
        return field(label, control)
    return field(label, text_input(name, value))


def _shown(config: dict[str, Any]) -> str:
    """The values a form showed, sent back with it: a write in admin's settings does not move
    `config_version`, so only these tell a stale form from a change."""
    return json.dumps({k: config[k] for k in ("enabled", "params", "channels")}, sort_keys=True)


def _form(found: dict[str, Any], every: dict[str, dict[str, Any]]) -> str:
    reg, config = found["topic_type"], found["config"]
    key = reg["key"]
    channels = "".join(
        check(f"channel_{c}", CHANNEL_LABELS.get(c, c), c in config["channels"])
        for c in shown_channels(found, every)
    )
    params = "".join(
        _param_input(p, config["params"].get(p["key"])) for p in reg.get("params") or []
    )
    links = ""
    if "custom" in found:
        links = (
            f' <a class="canccu-button canccu-button--secondary" href="{TOPICS}/{esc(key)}/edit">'
            f'Edit</a> <a class="canccu-button canccu-button--secondary"'
            f' href="{TOPICS}/{esc(key)}/remove">Remove</a>'
        )
    return (
        f'<form method=post action="{TOPICS}/{esc(key)}">'
        + hidden({"config_version": config["config_version"], "shown": _shown(config)})
        + check("enabled", "Offered at this event", config["enabled"])
        + f'<fieldset class="canccu-notify-fieldset"><legend>Channels</legend>{channels}</fieldset>'
        + params
        + f'<p class="canccu-notify-actions">{button("Save")}{links}</p></form>'
    )


def _summary(found: dict[str, Any]) -> str:
    config = found["config"]
    channels = ", ".join(CHANNEL_LABELS.get(c, c) for c in config["channels"]) or "none"
    params = "".join(f"<li>{esc(k)}: {esc(v)}</li>" for k, v in config["params"].items())
    state = "Offered" if config["enabled"] else "Not offered"
    return f"<p>{state} · Channels: {esc(channels)}</p>" + (f"<ul>{params}</ul>" if params else "")


def _card(found: dict[str, Any], every: dict[str, Any], counts: Any, writable: bool) -> str:
    reg = found["topic_type"]
    if "custom" in found:
        base = every.get(found["custom"]["based_on"])
        title = base["topic_type"]["title"] if base else found["custom"]["based_on"]
        origin = f"Custom, based on {title}"
    else:
        origin = f"From {reg['owner']}"
    meta = f'<p class="canccu-notify-muted">{esc(origin)} · <code>{esc(reg["key"])}</code></p>'
    if reg.get("description"):
        meta += f"<p>{esc(reg['description'])}</p>"
    if counts is not None:
        day, total = counts.get(reg["key"], (0, 0))
        meta += f"<p>Notifications: {day} in the last 24 hours, {total} in all</p>"
    body = _form(found, every) if writable else _summary(found)
    return (
        f'<section class="canccu-card canccu-notify-topic" id="{esc(reg["key"])}">'
        f'<h2 class="canccu-card__title">{esc(reg["title"])}</h2>{meta}{body}</section>'
    )


async def topics_page(request: Request) -> Response:
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
        top += notice("The event is archived: its topics can be read, not changed.")
    elif not ready:
        top += notice("Admin is unreachable: the topics show their defaults.", "error")
    cards = "".join(_card(f, every, counts, writable) for f in every.values())
    if not cards:
        cards = "<p>No module has registered a topic yet.</p>"
    return page(request, "Notifications", top + cards)


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
    if shown != json.loads(_shown(config)):
        raise VersionConflict("changed meanwhile, here or in admin's settings; reload")
    # Only what the person changed on the form: a value they left alone is never written back.
    body: dict[str, Any] = {"config_version": version}
    enabled = form.get("enabled") is not None
    if enabled != shown["enabled"]:
        body["enabled"] = enabled
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
        return redirect(f"?unchanged={key}#{key}")
    await write_config(d, ctx["tenant_id"], session.user_id, key, body)
    return redirect(f"?saved={key}#{key}")


ROUTES = [
    Route("/admin/topics", topics_page, methods=["GET"]),
    Route("/admin/topics/{topic}", save_config, methods=["POST"]),
]
