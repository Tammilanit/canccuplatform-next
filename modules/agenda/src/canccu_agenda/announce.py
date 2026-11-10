"""Announce: tell people about an item now, on its channels (contracts/agenda.md, Editing live).
It changes nothing in the agenda, so it bumps no `revision` and no `agenda_version`."""

from __future__ import annotations

from canccu_kit.rights import Session
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import model, store
from .access import writer
from .deps import Deps, deps
from .effective import event_channels
from .kinds import body, not_found

MESSAGE_MAX = 140


def message_of(value: object) -> str | None:
    return model.text(value, "message", MESSAGE_MAX)


async def announce_item(request: Request) -> Response:
    session = await writer(request)
    data = await body(request)
    await announce(
        deps(request), session, request.path_params["item_id"], message_of(data.get("message"))
    )
    return Response(status_code=204)


async def announce(d: Deps, session: Session, item_id: str, message: str | None) -> None:
    # Strict, like a write: consumers decide by the item's channels, so a guessed default would
    # announce where the organiser may have chosen not to.
    channels = await event_channels(d)
    async with d.db.tenant() as conn:
        # Under the event's write lock, so the version sent is the one the item has.
        state = await store.state(conn, lock=True)
        row = await store.item(conn, item_id)
        if row is None:
            raise not_found("item")
        if row["kind"] == "quiet_hours":
            raise model.invalid("quiet hours are never announced")
        if row["status"] == "cancelled":
            raise model.conflict("item_cancelled", "a cancelled item cannot be announced")
        item = model.item_json(row, await store.kinds(conn), channels)
    await d.bus.publish(
        "agenda.item.announced",
        {
            "item": item,
            "message": message,
            "agenda_version": state["agenda_version"],
            "actor_user_id": session.user_id,
        },
        version=1,
    )


ROUTES = [Route("/api/agenda/items/{item_id}/announce", announce_item, methods=["POST"])]
