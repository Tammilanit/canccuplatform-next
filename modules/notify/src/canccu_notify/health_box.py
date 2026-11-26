"""Can attendees get notifications? (#782 part C, plan D15, sheet 01; the lead's comment of
2026-11-23, item 3): whether the event is on https, the push key is set, how many phones and PCs
registered, and how the last push went, each problem with what to do.

Its read is `GET /api/notify/delivery-health`: `/api/notify/health` is the module's own liveness
check, which Caddy and the platform smoke already use."""

from __future__ import annotations

from typing import Any

from canccu_kit.ui import esc, info_tip, status_chip, time_label
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .access import tenant_of, topics_writer
from .deps import deps

TITLE = "Can attendees get notifications?"
ABOUT = (
    "Phones and PCs get notifications only when all of these are OK. Each problem says what to do."
)


async def read_health(request: Request) -> dict[str, Any]:
    """The event's health, as the read answers it; the caller has checked the right."""
    d = deps(request)
    async with d.db.tenant() as conn:
        devices = await conn.fetchrow(
            "SELECT count(*) FILTER (WHERE device = 'phone') AS phones,"
            " count(*) FILTER (WHERE device IS DISTINCT FROM 'phone') AS pcs"
            " FROM notify_subscriptions"
        )
        last = await conn.fetchrow(
            "SELECT status, done_at, error FROM notify_deliveries WHERE channel = 'push'"
            " AND status IN ('sent', 'failed') ORDER BY done_at DESC, id DESC LIMIT 1"
        )
    return {
        # uvicorn takes the scheme from X-Forwarded-Proto of the trusted proxies (Caddy).
        "https": request.url.scheme == "https",
        "push_key": bool(getattr(getattr(d.push, "vapid", None), "public_key", None)),
        "devices": {"phones": devices["phones"], "pcs": devices["pcs"]},
        "last_delivery": None
        if last is None
        else {
            "at": last["done_at"].isoformat().replace("+00:00", "Z"),
            "status": last["status"],
            "error": last["error"],
        },
    }


async def delivery_health(request: Request) -> Response:
    await topics_writer(request)
    return JSONResponse(await read_health(request))


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _row(label: str, ok: bool | None, chip: str, words: str, todo: str = "") -> str:
    kind = "ok" if ok else ("plain" if ok is None else "down")
    meaning = {
        "ok": "Nothing to do here.",
        "plain": "Not a problem yet.",
        "down": "Needs a look: what to do is below.",
    }[kind]
    todo_html = f'<p class="canccu-notify-muted">{esc(todo)}</p>' if todo else ""
    return (
        f'<li class="canccu-notify-health__row"><div class="canccu-notify-health__head">'
        f"<strong>{esc(label)}</strong>{status_chip(kind, chip, meaning)}</div>"
        f"<p>{esc(words)}</p>{todo_html}</li>"
    )


def box_html(health: dict[str, Any], zone: str, actions: str = "") -> str:
    """The box at the top of Notifications; `actions` is the crew test's form."""
    phones, pcs = health["devices"]["phones"], health["devices"]["pcs"]
    devices = f"{_count(phones, 'phone', 'phones')}, {_count(pcs, 'PC', 'PCs')}."
    rows = [
        _row("Secure address (https)", True, "OK", "Set.")
        if health["https"]
        else _row(
            "Secure address (https)",
            False,
            "Missing",
            "Missing, so phones can't register.",
            "Open the event on its https address. The platform admin adds one.",
        ),
        _row("Push key", True, "OK", "Set.")
        if health["push_key"]
        else _row(
            "Push key",
            False,
            "Missing",
            "Missing, so no phone gets a notification.",
            "The platform admin sets the platform's push key.",
        ),
        _row("Devices registered", True, "OK", devices)
        if phones + pcs
        else _row(
            "Devices registered",
            None,
            "None yet",
            devices,
            "Attendees allow notifications in the event's hub, on a phone or a PC.",
        ),
    ]
    last = health["last_delivery"]
    if last is None:
        rows.append(_row("Last delivery", None, "None yet", "Nothing sent yet."))
    elif last["status"] == "sent":
        rows.append(_row("Last delivery", True, "OK", f"Sent {time_label(last['at'], zone)}."))
    else:
        reason = last.get("error") or "the push service didn't take it"
        rows.append(
            _row(
                "Last delivery",
                False,
                "Failed",
                f"Failed {time_label(last['at'], zone)}: {reason}.",
                "Send a test to the crew to check again. A device that keeps failing can allow"
                " notifications again in the hub.",
            )
        )
    return (
        '<section class="canccu-card canccu-notify-health" id="health"'
        ' aria-labelledby="health-title"><div class="canccu-notify-kinds__head">'
        f'<h2 class="canccu-card__title" id="health-title">{esc(TITLE)}</h2>{info_tip(ABOUT)}</div>'
        f'<ul class="canccu-notify-health__rows">{"".join(rows)}</ul>{actions}</section>'
    )


async def box_for(request: Request, actions: str = "") -> str:
    """The box for the page, as its writer sees it."""
    zone = tenant_of(request).get("time_zone") or "UTC"
    return box_html(await read_health(request), zone, actions)


ROUTES = [Route("/api/notify/delivery-health", delivery_health, methods=["GET"])]
