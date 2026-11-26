"""Who holds a role at an event, for notify's crew test only (#782 part C, plan Q7, D16;
contracts/admin.md, Internal): "Send a test to the crew" reaches organisers and crew, never every
attendee, and only admin knows who holds a role. The answer is user ids, never names. Admin's
roles are one list today (admin_roles has no tenant); notify sends only to these users'
subscriptions at the event it tests, so another event's crew gets nothing."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from canccu_kit import KitError, ServiceForbidden, is_tenant_id, tenant_scope
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

Users = Callable[[], Awaitable[list[tuple[Any, str | None]]]]


def people_route(users: Users) -> Route:
    async def with_role(request: Request) -> Response:
        # The middleware verified the caller's signature; only notify may ask.
        if request.state.service != "notify":
            raise ServiceForbidden(f"module {request.state.service} may not list role holders")
        tenant = request.query_params.get("tenant_id", "")
        if not is_tenant_id(tenant):
            raise KitError("tenant_id: a tenant id", status=400, code="invalid_request")
        with tenant_scope(tenant):
            ids = sorted(user.id for user, role in await users() if role)
        return JSONResponse({"user_ids": ids})

    return Route("/internal/admin/people/with-role", with_role, methods=["GET"])
