"""Starlette (and FastAPI) adapter: /health, rights check, error body, correlation id, tenancy.

Install with the extra: `canccu-kit[starlette]`.
"""

from __future__ import annotations

import functools
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .context import CORRELATION_HEADER, correlation
from .errors import KitError, MissingRight, code_for_status, error_body, internal_error_body
from .health import Health
from .resolve import TenantResolver, UnknownHost
from .rights import RightsChecker, Session
from .service import SERVICE_HEADER, ServiceIdentity, service_has_right
from .tenant import tenant_scope
from .web_security import check_origin

log = logging.getLogger("canccu.kit.http")


def health_route(health: Health, path: str = "/health") -> Route:
    async def endpoint(request: Request) -> Response:
        result = await health.run()
        return JSONResponse(result.body, status_code=result.http_status)

    return Route(path, endpoint, methods=["GET"])


def right_dependency(
    checker: RightsChecker, right: str, service: ServiceIdentity | None = None
) -> Callable[[Request], Awaitable[Session | None]]:
    """A FastAPI dependency (`Depends(...)`) that returns the session or raises a KitError.

    With `service`, a module that signs the request passes for its own rights only and gets
    None (its name is on `request.state.service`); people still need a session.
    """

    async def dependency(request: Request) -> Session | None:
        signed = request.headers.get(SERVICE_HEADER)
        if service is not None and signed is not None:
            caller = service.verify(signed)
            if not service_has_right(caller, right):
                raise MissingRight(f"needs right {right}")
            request.state.service = caller
            request.state.session = None
            return None
        session = await checker.check(request.headers.get("cookie"), right)
        request.state.session = session
        return session

    return dependency


Endpoint = Callable[[Request], Awaitable[Response]]


def require_right(
    checker: RightsChecker, right: str, *, service: ServiceIdentity | None = None
) -> Callable[[Endpoint], Endpoint]:
    """Decorator for Starlette endpoints; the session is on `request.state.session`."""
    dependency = right_dependency(checker, right, service)

    def decorate(endpoint: Endpoint) -> Endpoint:
        @functools.wraps(endpoint)
        async def wrapped(request: Request) -> Response:
            await dependency(request)
            return await endpoint(request)

        return wrapped

    return decorate


async def _kit_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, KitError)
    return JSONResponse(exc.to_body(), status_code=exc.status)


async def _http_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, HTTPException)
    message = exc.detail if isinstance(exc.detail, str) else "request failed"
    return JSONResponse(
        error_body(code_for_status(exc.status_code), message),
        status_code=exc.status_code,
        headers=exc.headers,
    )


async def _internal_error(request: Request, exc: Exception) -> Response:
    log.error("unhandled error", exc_info=exc, extra={"path": request.url.path})
    return JSONResponse(internal_error_body(), status_code=500)


class CorrelationMiddleware:
    """Sets the correlation id from X-Correlation-Id (or a new one) and echoes it back."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope["headers"]).get(CORRELATION_HEADER.encode())
        with correlation(incoming.decode() if incoming else None) as value:

            async def send_with_header(message: Message) -> None:
                if message["type"] == "http.response.start":
                    message.setdefault("headers", [])
                    message["headers"].append((CORRELATION_HEADER.encode(), value.encode()))
                await send(message)

            await self.app(scope, receive, send_with_header)


class OriginCheckMiddleware:
    """The kit's origin check on every request; see web_security.check_origin."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = dict(scope["headers"])

            def header(name: bytes) -> str | None:
                value = headers.get(name)
                return None if value is None else value.decode("latin-1")

            try:
                check_origin(
                    scope["method"],
                    scope["path"],
                    header(b"origin"),
                    header(b"host"),
                    header(b"sec-fetch-site"),
                )
            except KitError as exc:
                await JSONResponse(exc.to_body(), status_code=exc.status)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install(app: Starlette, health: Health | None = None) -> None:
    """Add the error body handlers, the origin check, correlation middleware and (optionally)
    /health."""
    handlers: dict[Any, Any] = {
        KitError: _kit_error,
        HTTPException: _http_error,
        Exception: _internal_error,
    }
    for exc_class, handler in handlers.items():
        app.add_exception_handler(exc_class, handler)
    # Added first, so the correlation middleware wraps it and its 403 carries the id too.
    app.add_middleware(OriginCheckMiddleware)
    app.add_middleware(CorrelationMiddleware)
    if health is not None:
        app.router.routes.append(health_route(health))


def is_health_request(method: str, path: str) -> bool:
    """`GET /health` stays outside tenant resolution (0013 item 2)."""
    return method in ("GET", "HEAD") and path == "/health"


class TenancyMiddleware:
    """Resolves each request's tenant from its Host header (Caddy forwards it unchanged).

    The rest of the request runs inside tenant_scope, with the TenantContext on
    `request.state.tenant` (None on /health and on a served platform hostname). Errors are
    answered here: a middleware's exceptions never reach the app's exception handlers.
    """

    def __init__(
        self,
        app: ASGIApp,
        resolver: TenantResolver,
        platform_hosts: Literal["serve", "refuse"] = "refuse",
    ) -> None:
        self.app = app
        self.resolver = resolver
        self.platform_hosts = platform_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        state = scope.setdefault("state", {})
        state["tenant"] = None
        if is_health_request(scope["method"], scope["path"]):
            await self.app(scope, receive, send)
            return
        host = dict(scope["headers"]).get(b"host", b"").decode("latin-1")
        try:
            resolution = await self.resolver.resolve(host)
            if resolution.kind == "platform" and self.platform_hosts != "serve":
                raise UnknownHost()
        except KitError as exc:
            await JSONResponse(exc.to_body(), status_code=exc.status)(scope, receive, send)
            return
        if resolution.context is None:
            await self.app(scope, receive, send)
            return
        state["tenant"] = resolution.context
        with tenant_scope(resolution.context["tenant_id"]):
            await self.app(scope, receive, send)


def install_tenancy(
    app: Starlette,
    resolver: TenantResolver,
    platform_hosts: Literal["serve", "refuse"] = "refuse",
) -> None:
    """Resolve every request's tenant; `serve` only in a module that answers on the sign-in or
    superadmin hostname."""
    if app.middleware_stack is not None:
        raise RuntimeError("Cannot add middleware after an application has started")
    # Innermost of the user middleware, whatever the call order with install(): the correlation
    # id then covers tenancy errors, and no other middleware runs on a request with no tenant.
    app.user_middleware.append(
        Middleware(TenancyMiddleware, resolver=resolver, platform_hosts=platform_hosts)
    )


class ServiceIdentityMiddleware:
    """Every request under `prefix` must carry a live service token for this module; the caller
    is on `request.state.service`. `exempt` is for callers that cannot sign, such as Caddy's
    on-demand TLS `ask`."""

    def __init__(
        self,
        app: ASGIApp,
        identity: ServiceIdentity,
        prefix: str = "/internal/",
        exempt: tuple[str, ...] = (),
    ) -> None:
        self.app = app
        self.identity = identity
        self.prefix = prefix
        self.exempt = frozenset(exempt)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        guarded = (
            scope["type"] == "http"
            and scope["path"].startswith(self.prefix)
            and scope["path"] not in self.exempt
        )
        if guarded:
            raw = dict(scope["headers"]).get(SERVICE_HEADER.encode())
            try:
                caller = self.identity.verify(None if raw is None else raw.decode("latin-1"))
            except KitError as exc:
                await JSONResponse(exc.to_body(), status_code=exc.status)(scope, receive, send)
                return
            scope.setdefault("state", {})["service"] = caller
        await self.app(scope, receive, send)


def install_service_identity(
    app: Starlette,
    identity: ServiceIdentity,
    *,
    prefix: str = "/internal/",
    exempt: tuple[str, ...] = (),
) -> None:
    """Guard the internal paths with the module-to-module identity."""
    if app.middleware_stack is not None:
        raise RuntimeError("Cannot add middleware after an application has started")
    app.user_middleware.append(
        Middleware(ServiceIdentityMiddleware, identity=identity, prefix=prefix, exempt=exempt)
    )
