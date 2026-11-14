"""The 2-minute undo of a page action (plan issue-187 D12).

An undo runs through the same writes as any change, so it emits the normal events and people who
were told are told again. It is its author's alone, used once, and refused, naming who, when any
item it would touch has changed since.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import timedelta
from typing import Any

from canccu_kit import new_id
from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import model, store, timers
from .access import writer
from .deps import Deps, deps
from .edits import remove
from .effective import event_settings
from .history import labels
from .inverse import Inverse
from .kinds import not_found
from .web import BASE, button, esc, redirect, zone_of

LIFETIME = timedelta(minutes=2)
_ID = re.compile(r"un_[0-9a-f]{32}")
TIME_COLUMNS = ("starts_at", "ends_at", "planned_starts_at", "planned_ends_at")
# What an item added again keeps of the cancelled one, its delay included.
COPIED = (
    "title",
    "description",
    "kind",
    *TIME_COLUMNS,
    "location",
    "zone",
    "visibility",
    "reminder_leads_minutes",
    "notify",
    "tournament_id",
    "moment_id",
)
# The events of an undo, stored once every item is rendered: (type, the item to render or None,
# data).
Pending = list[tuple[str, str | None, dict[str, Any]]]


async def save(d: Deps, session: Session, inverse: Inverse) -> str | None:
    """Keeps the inverse for its author; answers its id, or None when the action changed
    nothing."""
    if not inverse.steps:
        return None
    undo_id = f"un_{secrets.token_hex(16)}"
    now = d.now()
    async with d.db.tenant() as conn:
        await conn.execute("DELETE FROM agenda_undo WHERE expires_at <= $1", now)
        await conn.execute(
            "INSERT INTO agenda_undo (id, actor_user_id, steps, expires_at)"
            " VALUES ($1, $2, $3::jsonb, $4)",
            undo_id,
            session.user_id,
            json.dumps(inverse.steps),
            now + LIFETIME,
        )
    return undo_id


def with_undo(path: str, undo_id: str | None) -> str:
    return f"{path}&undo={undo_id}" if undo_id else path


async def offer_html(d: Deps, session: Session, undo_id: str | None) -> str:
    """The Undo button under a change's notice, while its author may still use it."""
    if not undo_id or not _ID.fullmatch(undo_id):
        return ""
    async with d.db.tenant() as conn:
        live = await conn.fetchval(
            "SELECT true FROM agenda_undo WHERE id = $1 AND actor_user_id = $2 AND expires_at > $3",
            undo_id,
            session.user_id,
            d.now(),
        )
    if not live:
        return ""
    return (
        f'<form method=post action="{BASE}/undo/{esc(undo_id)}" class="canccu-agenda-undo">'
        + button("Undo", "secondary")
        + " <span>Within 2 minutes. People who were told are told again.</span></form>"
    )


async def undo_page(request: Request) -> Response:
    session = await writer(request)
    d = deps(request)
    undo_id = request.path_params["undo_id"]
    if not _ID.fullmatch(undo_id):
        raise not_found("undo")
    channels, leads = await event_settings(d)
    now = d.now()
    actor = store.actor_of(session)
    async with d.db.tenant() as conn:
        await store.state(conn, lock=True)
        # Claimed by deleting it: used once, and a refusal below rolls the claim back.
        record = await conn.fetchrow(
            "DELETE FROM agenda_undo WHERE id = $1 RETURNING actor_user_id, steps, expires_at",
            undo_id,
        )
        if record is None or record["actor_user_id"] != session.user_id:
            raise not_found("undo")
        if record["expires_at"] <= now:
            raise model.conflict(
                "undo_expired", "more than 2 minutes have passed: change it again instead"
            )
        steps = json.loads(record["steps"])
        rows = [await _current(conn, step) for step in steps]
        out: Pending = []
        touched = []
        for step, row in zip(steps, rows, strict=True):
            touched += await _apply(conn, step, row, actor, out)
        kinds = await store.kinds(conn)
        # Steps saved before `announce` existed were announced.
        rearm = {
            step["item_id"]
            for step in steps
            if step["op"] == "restore"
            and step.get("announce", True)
            and "starts_at" in step["values"]
        }
        await timers.reschedule(conn, touched, kinds, leads, now, rearm=rearm)
        rendered = {r["id"]: model.item_json(r, kinds, channels) for r in touched}
        await store_events(d, conn, session, out, rendered)
    await d.outbox.flush()
    # The earliest item still there; undoing an add leaves none, so the day alone.
    first = min(touched, key=lambda r: r["starts_at"], default=None)
    day = now if first is None else first["starts_at"]
    path = f"/?day={day.astimezone(zone_of(request)).date().isoformat()}&done=undone"
    return redirect(path, None if first is None else first["id"])


async def _current(conn: Any, step: dict[str, Any]) -> Any:
    """The item locked, still at the revision the action left it; otherwise the refusal names
    who changed it."""
    row = await store.item(conn, step["item_id"], lock=True)
    if row is not None and row["revision"] == step["revision"]:
        return row
    log = await store.changes(conn, step["item_id"], after=step["revision"])
    last = log[-1] if log else None
    title = row["title"] if row is not None else "the item"
    if last is None:
        what = f"{title} changed since"
    elif last["action"] == "removed":
        what = f"{last['actor_name']} removed it since"
    else:
        what = f"{last['actor_name']} changed {title} since ({labels(last['fields'])})"
    raise model.conflict("undo_stale", f"{what}: nothing was undone.")


def _values(values: dict[str, Any]) -> dict[str, Any]:
    return {
        k: model.parse_time(v, k) if k in TIME_COLUMNS and v is not None else v
        for k, v in values.items()
    }


async def _apply(
    conn: Any, step: dict[str, Any], row: Any, actor: store.Actor, out: Pending
) -> list[Any]:
    """One step through the normal writes; answers the rows whose timers it changed."""
    if step["op"] == "remove":
        await _remove(conn, row, actor, out)
        return []
    if step["op"] == "add_again":
        return [await add_again(conn, row, actor, out, "undo_stale")]
    values = _values(step["values"])
    new = await store.update_item(conn, row, values, actor)
    version = await store.bump(conn, "agenda_version")
    announce = step.get("announce", True)
    if step["minutes"] is not None:
        data = {"minutes": step["minutes"], "announce": announce, "agenda_version": version}
        out.append(("agenda.item.delayed", new["id"], data))
    else:
        changed = list(dict.fromkeys(k.removeprefix("planned_") for k in values))
        data = {"changed": changed, "announce": announce, "agenda_version": version}
        out.append(("agenda.item.changed", new["id"], data))
    return [new]


async def add_again(conn: Any, row: Any, actor: store.Actor, out: Pending, code: str) -> Any:
    """A cancelled item back as a new one with its fields, and the cancelled one removed, since
    cancelling is final (contracts/agenda.md): the undo of a cancel, and Bring back. `code` is
    the refusal's when the item's kind is gone."""
    # The add's own check: an item of a kind the event no longer has would be unknown to all.
    if await store.kind(conn, row["kind"]) is None:
        raise model.conflict(
            code, f"the kind of {row['title']} was removed since: nothing changed."
        )
    new = await store.insert_item(conn, {k: row[k] for k in COPIED}, actor)
    version = await store.bump(conn, "agenda_version")
    out.append(("agenda.item.added", new["id"], {"agenda_version": version}))
    await _remove(conn, row, actor, out)
    return new


async def _remove(conn: Any, row: Any, actor: store.Actor, out: Pending) -> None:
    version = await remove(conn, row, actor)
    data = {"item_id": row["id"], "visibility": row["visibility"], "agenda_version": version}
    out.append(("agenda.item.removed", None, data))


async def store_events(
    d: Deps, conn: Any, session: Session, out: Pending, rendered: dict[str, dict[str, Any]]
) -> None:
    """An undone delay is told as one delay: one correlation id, in order of the new start, as
    edits.delay does."""

    def payload(item_id: str | None, data: dict[str, Any]) -> dict[str, Any]:
        item = {} if item_id is None else {"item": rendered[item_id]}
        return {**item, **data, "actor_user_id": session.user_id}

    delayed = sorted(
        (o for o in out if o[0] == "agenda.item.delayed"),
        key=lambda o: (rendered[str(o[1])]["starts_at"], o[1]),
    )
    correlation_id = new_id()
    for event_type, item_id, data in delayed:
        await d.outbox.add(
            conn, event_type, payload(item_id, data), version=1, correlation_id=correlation_id
        )
    for event_type, item_id, data in out:
        if event_type != "agenda.item.delayed":
            await d.outbox.add(conn, event_type, payload(item_id, data), version=1)


ROUTES = [Route("/undo/{undo_id}", undo_page, methods=["POST"])]
