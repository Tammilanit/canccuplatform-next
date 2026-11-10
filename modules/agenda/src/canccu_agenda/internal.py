"""`/internal/agenda/…`: reads for the other modules of the stack, which have no session and no
event hostname (contracts/agenda.md, Reading). The kit's service identity guards them."""

from __future__ import annotations

from canccu_kit import KitError, TenantResolver, is_tenant_id, tenant_scope
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import model, store
from .deps import deps
from .effective import read_channels
from .items import render


async def all_items(request: Request) -> Response:
    """Every item of the event, crew and cancelled ones too: a module keeping its own copy reads
    it again after an `agenda_version` jump or a clone, whose items no event carries."""
    tenant_id = request.query_params.get("tenant_id", "")
    resolver: TenantResolver = request.app.state.tenants
    if not is_tenant_id(tenant_id) or await resolver.by_id(tenant_id) is None:
        raise KitError("no such event", status=404, code="not_found")
    d = deps(request)
    with tenant_scope(tenant_id):
        channels = await read_channels(d)
        async with d.db.tenant() as conn:
            state = await store.state(conn)
            rows = await store.items(conn, frozenset(model.VISIBILITIES))
            items = await render(conn, rows, channels)
    return JSONResponse({"agenda_version": state["agenda_version"], "items": items})


ROUTES = [Route("/internal/agenda/items", all_items, methods=["GET"])]
