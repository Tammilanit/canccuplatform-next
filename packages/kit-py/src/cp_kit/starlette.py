"""Starlette (and FastAPI) adapter: /health route, rights check, error body, correlation id.

Install with the extra: `cp-kit[starlette]`.
"""

from __future__ import annotations

import functools
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .context import CORRELATION_HEADER, correlation
from .errors import KitError, code_for_status, error_body, internal_error_body
from .health import Health
from .rights import RightsChecker, Session

log = logging.getLogger("cp.kit.http")


def health_route(health: Health, path: str = "/health") -> Route:
    async def endpoint(request: Request) -> Response:
        result = await health.run()
        return JSONResponse(result.body, status_code=result.http_status)

    return Route(path, endpoint, methods=["GET"])


def right_dependency(checker: RightsChecker, right: str) -> Callable[[Request], Awaitable[Session]]:
    """A FastAPI dependency (`Depends(...)`) that returns the session or raises a KitError."""

    async def dependency(request: Request) -> Session:
        session = await checker.check(request.headers.get("cookie"), right)
        request.state.session = session
        return session

    return dependency


Endpoint = Callable[[Request], Awaitable[Response]]


def require_right(checker: RightsChecker, right: str) -> Callable[[Endpoint], Endpoint]:
    """Decorator for Starlette endpoints; the session is on `request.state.session`."""
    dependency = right_dependency(checker, right)

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


def install(app: Starlette, health: Health | None = None) -> None:
    """Add the error body handlers, correlation middleware and (optionally) /health."""
    handlers: dict[Any, Any] = {
        KitError: _kit_error,
        HTTPException: _http_error,
        Exception: _internal_error,
    }
    for exc_class, handler in handlers.items():
        app.add_exception_handler(exc_class, handler)
    app.add_middleware(CorrelationMiddleware)
    if health is not None:
        app.router.routes.append(health_route(health))
