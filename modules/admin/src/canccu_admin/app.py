"""HTTP surface: the admin API (contracts/admin.md) and the server-rendered pages."""

from __future__ import annotations

import html
from urllib.parse import urlencode

from canccu_kit import (
    Health,
    KitError,
    MissingRight,
    NotSignedIn,
    ServiceForbidden,
    ServiceIdentity,
    TenantResolver,
    is_tenant_id,
    tenant_scope,
)
from canccu_kit.rights import Session
from canccu_kit.starlette import install, install_service_identity
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .auth import Auth
from .auth_routes import Authorize, OnEvent, OriginCheck, auth_routes
from .forms import field_html, from_form
from .pages import BASE, SIGN_OUT, page
from .service import BadSettings, Service
from .tenancy import TenantPaths

MODULES = (
    "screen",
    "tournament",
    "pizza",
    "bot",
    "admin",
    "games",
    "moments",
    "voices",
    "cast",
    "agenda",
    "notify",
    "theming",
)


def create_app(
    service: Service,
    health: Health,
    authorize: Authorize,
    auth: Auth,
    resolver: TenantResolver,
    on_event: OnEvent | None = None,
    *,
    identity: ServiceIdentity,
) -> Starlette:
    async def need(request: Request, right: str) -> Session:
        return await authorize(request.headers.get("cookie"), right)

    def module_of(request: Request) -> str:
        module = str(request.path_params["module"])
        if module not in MODULES:
            raise KitError(f"unknown module {module}", status=404, code="not_found")
        return module

    # --- API
    async def get_settings(request: Request) -> Response:
        module = module_of(request)
        await need(request, "admin.settings.read")
        return JSONResponse(await service.get_settings(module))

    async def internal_settings(request: Request) -> Response:
        """A module's own settings for the tenant it serves; no hostname names the tenant on
        admin's internal address, so the kit sends it (contracts/admin.md, Settings)."""
        module = module_of(request)
        # The middleware verified the caller; a module reads only its own settings.
        if request.state.service != module:
            raise ServiceForbidden(f"module {request.state.service} reads only its own settings")
        tenant = request.query_params.get("tenant_id", "")
        if not is_tenant_id(tenant):
            raise KitError("tenant_id: a tenant id", status=400, code="invalid_request")
        with tenant_scope(tenant):
            return JSONResponse(await service.get_settings(module))

    async def internal_patch_settings(request: Request) -> Response:
        """A module writes some of its own settings for the tenant it serves, for settings that
        are the same values as something it stores (contracts/admin.md, Settings)."""
        module = module_of(request)
        if request.state.service != module:
            raise ServiceForbidden(f"module {request.state.service} writes only its own settings")
        tenant = request.query_params.get("tenant_id", "")
        if not is_tenant_id(tenant):
            raise KitError("tenant_id: a tenant id", status=400, code="invalid_request")
        try:
            body = await request.json()
        except ValueError:
            body = None
        if (
            not isinstance(body, dict)
            or not isinstance(body.get("values"), dict)
            or not body["values"]
            or not isinstance(body.get("settings_version"), int)
            or not isinstance(body.get("actor_user_id"), str)
            or not body["actor_user_id"]
        ):
            raise BadSettings("body needs settings_version, values and actor_user_id")
        with tenant_scope(tenant):
            return JSONResponse(
                await service.patch_settings(
                    module, body["settings_version"], body["values"], body["actor_user_id"]
                )
            )

    async def put_settings(request: Request) -> Response:
        module = module_of(request)
        session = await need(request, "admin.settings.write")
        body = await request.json()
        if (
            not isinstance(body, dict)
            or not isinstance(body.get("values"), dict)
            or not isinstance(body.get("settings_version"), int)
        ):
            raise BadSettings("body needs settings_version and values")
        return JSONResponse(
            await service.put_settings(
                module, body["settings_version"], body["values"], session.user_id
            )
        )

    async def get_profile(request: Request) -> Response:
        session = await need(request, "admin.profile.read")
        return Response(await service.export_zip(session.user_id), media_type="application/zip")

    async def put_profile(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        return JSONResponse(await service.import_zip(await request.body(), session.user_id))

    # --- pages
    async def index(request: Request) -> Response:
        return RedirectResponse(f"{BASE}/settings", status_code=303)

    async def settings_index(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        links = "".join(
            f'<li><a href="{BASE}/settings/{m}">{m}</a></li>' for m in service.declarations
        )
        return page(
            "Settings",
            f"<ul>{links}</ul>" if links else "<p>No module declares settings.</p>",
            session=session,
        )

    async def settings_form(request: Request) -> Response:
        module = module_of(request)
        session = await need(request, "admin.settings.read")
        declared = service.declarations.get(module, [])
        current = await service.get_settings(module)
        fields = "".join(field_html(s, current["values"].get(s.key)) for s in declared)
        notice = (request.query_params.get("saved") and "<p><b>Saved.</b></p>") or ""
        return page(
            f"Settings: {module}",
            f"{notice}<form method=post>"
            f"<input type=hidden name=settings_version value={current['settings_version']}>"
            f"{fields}<button>Save</button></form>",
            session=session,
        )

    async def settings_save(request: Request) -> Response:
        module = module_of(request)
        session = await need(request, "admin.settings.write")
        form = await request.form()
        values = from_form(service.declarations.get(module, []), form)
        try:
            version = int(str(form.get("settings_version", "")))
        except ValueError as exc:
            raise BadSettings("settings_version missing") from exc
        # Keep stored keys the form does not declare.
        _, stored = await service.store.get_settings(module)
        merged = {**stored, **values}
        await service.put_settings(module, version, merged, session.user_id)
        return RedirectResponse(f"{BASE}/settings/{module}?saved=1", status_code=303)

    async def health_page(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        own = (await health.run()).body
        rows = [(health.module, own["status"], own["version"], "")]
        rows += [(h.module, h.status, h.version, h.detail) for h in await service.health_view()]
        trs = "".join(
            f"<tr><td>{html.escape(m)}</td><td>{html.escape(s)}</td><td>{html.escape(v)}</td>"
            f"<td>{html.escape(d)}</td></tr>"
            for m, s, v, d in rows
        )
        return page(
            "Health",
            "<table border=1 cellpadding=4><tr><th>Module<th>Status<th>Version"
            f"<th>Detail</tr>{trs}</table>",
            session=session,
        )

    async def profile_page(request: Request) -> Response:
        session = await need(request, "admin.profile.read")
        message = html.escape(request.query_params.get("message", ""))
        warns = "".join(f"<li>{html.escape(w)}</li>" for w in request.query_params.getlist("warn"))
        return page(
            "Profile",
            (f"<p><b>{message}</b></p>" if message else "")
            + (f"<p>Warnings:</p><ul>{warns}</ul>" if warns else "")
            + f"<form method=post action={BASE}/profile/save><button>Save profile to event folder"
            f"</button></form><form method=post action={BASE}/profile/load>"
            "<button>Load profile from event folder</button></form>",
            session=session,
        )

    async def profile_save(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        result = await service.save_profile(session.user_id)
        return RedirectResponse(f"{BASE}/profile?message=Saved+{result['name']}", status_code=303)

    async def profile_load(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        result = await service.load_profile(session.user_id)
        query = urlencode(
            [("message", f"Loaded {result['name']}")] + [("warn", w) for w in result["warnings"]]
        )
        return RedirectResponse(f"{BASE}/profile?{query}", status_code=303)

    app = Starlette(
        routes=[
            Route("/api/admin/settings/{module}", get_settings, methods=["GET"]),
            Route("/api/admin/settings/{module}", put_settings, methods=["PUT"]),
            Route("/internal/admin/settings/{module}", internal_settings, methods=["GET"]),
            Route("/internal/admin/settings/{module}", internal_patch_settings, methods=["PATCH"]),
            Route("/api/admin/profile", get_profile, methods=["GET"]),
            Route("/api/admin/profile", put_profile, methods=["PUT"]),
            Route("/", index),
            Route("/settings", settings_index),
            Route("/settings/{module}", settings_form, methods=["GET"]),
            Route("/settings/{module}", settings_save, methods=["POST"]),
            Route("/health-view", health_page),
            Route("/profile", profile_page),
            Route("/profile/save", profile_save, methods=["POST"]),
            Route("/profile/load", profile_load, methods=["POST"]),
            *auth_routes(auth, authorize, on_event),
        ]
    )
    # Added before install(): Starlette wraps each later middleware around the earlier ones,
    # so the kit's correlation middleware also covers the origin check's 403.
    app.add_middleware(OriginCheck, origin=auth.public_origin)
    install(app, health)
    # Innermost, as the kit's install_tenancy places it: the correlation id and the origin check
    # cover its 404s, and settings and profile handlers run inside the request's tenant.
    app.user_middleware.append(Middleware(TenantPaths, resolver=resolver))
    install_service_identity(app, identity)
    app.add_exception_handler(NotSignedIn, _not_signed_in)
    app.add_exception_handler(MissingRight, _missing_right)
    return app


async def _not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/admin.md); a page sends the browser to sign in."""
    if request.url.path.startswith("/api/"):
        assert isinstance(exc, NotSignedIn)
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return RedirectResponse(f"{BASE}/sign-in", status_code=303)


async def _missing_right(request: Request, exc: Exception) -> Response:
    """The API answers 403 `missing_right`; a page explains what to do instead."""
    assert isinstance(exc, MissingRight)
    if request.url.path.startswith("/api/"):
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return page(
        "No access",
        "<p>You are signed in, but your account has no right to this page"
        f" ({html.escape(exc.message)}). Ask the owner for a role, then reload.</p>"
        f"<p>Wrong account? {SIGN_OUT}</p>",
        exc.status,
    )
