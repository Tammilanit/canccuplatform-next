"""`/internal/agenda/…`: reads for the other modules of the stack, which have no session and no
event hostname (contracts/agenda.md, Reading). The kit's service identity guards them."""

from __future__ import annotations

from canccu_kit import ServiceForbidden, TenantResolver, tenant_scope
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import model, store
from .deps import deps
from .effective import read_channels
from .items import now_and_next, render
from .kinds import not_found


async def _known_event(request: Request) -> str:
    """The `tenant_id` the calling module's kit set, once the tenants module knows it, in any
    status."""
    tenant_id = request.query_params.get("tenant_id", "")
    resolver: TenantResolver = request.app.state.tenants
    # by_id answers None for an id that is not one, before any request.
    if await resolver.by_id(tenant_id) is None:
        raise not_found("event")
    return tenant_id


async def all_items(request: Request) -> Response:
    """Every item of the event, crew and cancelled ones too: a module keeping its own copy reads
    it again after an `agenda_version` jump or a clone, whose items no event carries."""
    tenant_id = await _known_event(request)
    d = deps(request)
    with tenant_scope(tenant_id):
        channels = await read_channels(d)
        async with d.db.tenant() as conn:
            state = await store.state(conn)
            rows = await store.items(conn, frozenset(model.VISIBILITIES))
            items = await render(conn, rows, channels)
    return JSONResponse({"agenda_version": state["agenda_version"], "items": items})


async def screen_now(request: Request) -> Response:
    """Now and next as a guest sees them, for the event's screens whatever the info-page mode
    (contracts/agenda.md, Reading): the screen module's container is no venue address and has no
    session, so the guest read refuses it in `venue_only` and `sign_in`. Skipping that gate is
    safe only because the answer is `public` items alone, what a guest gets where the gate is open.
    """
    caller = request.state.service
    if caller != "screen":
        raise ServiceForbidden(f"module {caller} may not read the screens' now and next")
    tenant_id = await _known_event(request)
    zone = request.query_params.get("zone")
    with tenant_scope(tenant_id):
        body = await now_and_next(deps(request), frozenset({"public"}), zone)
    return JSONResponse(body)


ROUTES = [
    Route("/internal/agenda/items", all_items, methods=["GET"]),
    Route("/internal/agenda/now", screen_now, methods=["GET"]),
]
