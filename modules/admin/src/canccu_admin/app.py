"""HTTP surface: the admin API (contracts/admin.md) and the server-rendered pages."""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from canccu_kit import (
    KitError,
    NotSignedIn,
    ServiceForbidden,
    ServiceIdentity,
    TenantResolver,
    VersionConflict,
    is_tenant_id,
    tenant_scope,
)
from canccu_kit.rights import Session, session_id_from_cookie
from canccu_kit.starlette import install, install_service_identity
from canccu_kit.ui import esc, icon, menu_for
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .auth import Auth
from .auth_routes import Authorize, OnEvent, OriginCheck, Viewer, auth_routes
from .forms import from_form
from .health import HealthWatch
from .health_view import health_body
from .pages import (
    BASE,
    MODULE_ICONS,
    event_of,
    not_signed_in,
    page,
    page_error_handler,
    part_name,
    static_script,
    static_ui_css,
)
from .people_pages import people_routes
from .profile_pages import profile_routes
from .service import BadSettings, Service
from .settings_form import failure, kept_after_conflict
from .settings_form import settings_form as settings_form_html
from .settings_view import SHOWN_CHANGES, glance, last_changes, settings_list, when
from .tenancy import TenantPaths

log = logging.getLogger("canccu.admin")

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
    watch: HealthWatch,
    authorize: Authorize,
    auth: Auth,
    resolver: TenantResolver,
    on_event: OnEvent | None = None,
    *,
    identity: ServiceIdentity,
    viewer: Viewer | None = None,
) -> Starlette:
    """`viewer` reads a cookie's session as the kit does, for pages that need no right; without
    it, admin's own sessions."""

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
            or isinstance(body["settings_version"], bool)
            or not isinstance(body.get("actor_user_id"), str)
            or not body["actor_user_id"]
        ):
            raise BadSettings("body needs settings_version, values and actor_user_id")
        # The caller refuses its own writes on an archived event first; this holds when it does
        # not (contracts/admin.md, Settings).
        context = await resolver.by_id(tenant)
        if context is None:
            raise KitError("no such tenant", status=404, code="not_found")
        if context["status"] == "archived":
            raise KitError("the event is archived", status=409, code="event_archived")
        with tenant_scope(tenant):
            return JSONResponse(
                await service.patch_settings(
                    module, body["settings_version"], body["values"], body["actor_user_id"]
                )
            )

    async def theming_tenant(request: Request) -> str:
        """The tenant of an internal profile read: only theming asks, and only for an event the
        tenants module knows (contracts/admin.md, Profile)."""
        if request.state.service != "theming":
            raise ServiceForbidden(f"module {request.state.service} may not read the profile")
        tenant = request.query_params.get("tenant_id", "")
        if not is_tenant_id(tenant):
            raise KitError("tenant_id: a tenant id", status=400, code="invalid_request")
        if await resolver.by_id(tenant) is None:
            raise KitError("no such tenant", status=404, code="not_found")
        return tenant

    async def internal_profile_theme(request: Request) -> Response:
        with tenant_scope(await theming_tenant(request)):
            return JSONResponse(await service.profile_theme())

    async def internal_profile_logo(request: Request) -> Response:
        with tenant_scope(await theming_tenant(request)):
            logo = await service.profile_logo()
        if logo is None:
            raise KitError("the profile names no main logo", status=404, code="not_found")
        # The hash lets theming tell whether these bytes are the ones `/profile/theme` named.
        etag = f'"{hashlib.sha256(logo).hexdigest()}"'
        return Response(logo, media_type="application/octet-stream", headers={"ETag": etag})

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
        """The first page this person may open; without a role, "No role yet" on sign-in."""
        session = await auth.session(session_id_from_cookie(request.headers.get("cookie")))
        pages = [i["href"] for g in menu_for(session) for i in g["items"]]
        return RedirectResponse(pages[0] if pages else f"{BASE}/sign-in", status_code=303)

    async def settings_index(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        event = await event_of(request)
        zone, now = (event.time_zone if event else "UTC"), datetime.now(UTC)
        changed = await service.store.last_changed()
        recent = await service.store.recent_changes(SHOWN_CHANGES)
        # A loaded profile can set a module that declares nothing (pizza): it still has a name.
        parts = [*service.declarations, *(c.module for c in recent)]
        groups = {m: part_name(m, settings=True) for m in parts}
        rows = []
        for m, declared in service.declarations.items():
            _, values = await service.store.get_settings(m)
            about, values_now = glance(m, declared, values)
            rows.append(
                (
                    f"{BASE}/settings/{m}",
                    MODULE_ICONS.get(m, "sliders"),
                    groups[m],
                    about,
                    values_now,
                    when(changed.get(m), now, zone),
                )
            )
        # Signed-in names; a session from elsewhere (the CI stub) names at least itself.
        names = {u.id: u.name for u, _ in await auth.users()} if recent else {}
        names.setdefault(session.user_id, session.user_name)
        side = last_changes(recent, names, groups, service.declarations, now, zone)
        name = event.name if event and event.name else "the event"
        return await page(
            request,
            "Settings",
            f'<div class="canccu-split">{settings_list(rows)}{side}</div>',
            session=session,
            current="settings",
            description=f"How each part of {esc(name)} behaves. A change applies when you save it.",
        )

    async def form_page(
        request: Request,
        module: str,
        session: Session,
        body: str,
        status: int = 200,
    ) -> Response:
        return await page(
            request,
            part_name(module, settings=True),
            body,
            status,
            session=session,
            current="settings",
            narrow=True,
            crumb=(f"{BASE}/settings", "Settings"),
        )

    async def settings_form(request: Request) -> Response:
        module = module_of(request)
        session = await need(request, "admin.settings.read")
        version, stored = await service.store.get_settings(module)
        body = settings_form_html(
            service.declarations.get(module, []),
            service.groups.get(module, []),
            stored,
            stored,
            version,
            f"{BASE}/settings/{module}",
            saved=bool(request.query_params.get("saved")),
        )
        return await form_page(request, module, session, body)

    async def settings_save(request: Request) -> Response:
        module = module_of(request)
        session = await need(request, "admin.settings.write")
        form = await request.form()
        declared = service.declarations.get(module, [])
        try:
            version = int(str(form.get("settings_version", "")))
        except ValueError as exc:
            raise BadSettings("settings_version missing") from exc
        # Keep stored keys the form does not declare.
        _, stored = await service.store.get_settings(module)
        try:
            values = from_form(declared, form)
            await service.put_settings(module, version, {**stored, **values}, session.user_id)
        except (BadSettings, VersionConflict) as exc:
            # The form again with what was typed, so nothing is lost (sheet 4, "Couldn't
            # save"); after a conflict it compares with, and saves over, what is saved now.
            typed: dict[str, Any] = {
                s.key: form.get(s.key) for s in declared if s.type != "boolean"
            }
            typed |= {s.key: form.get(s.key) is not None for s in declared if s.type == "boolean"}
            if isinstance(exc, VersionConflict):
                version, stored = await service.store.get_settings(module)
                typed = kept_after_conflict(declared, form, typed, stored)
            body = settings_form_html(
                declared,
                service.groups.get(module, []),
                typed,
                stored,
                version,
                f"{BASE}/settings/{module}",
                failed=failure(declared, exc),
            )
            return await form_page(request, module, session, body, exc.status)
        return RedirectResponse(f"{BASE}/settings/{module}?saved=1", status_code=303)

    async def health_page(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        # "Check now" checks at once, then sends the browser on to the plain page, so a reload
        # (or health.js) reads the watch's latest check instead of checking again.
        if request.query_params.get("check") == "now":
            await watch.check()
            return RedirectResponse(f"{BASE}/health-view", status_code=303)
        check = await watch.current()
        event = await event_of(request)
        description, body = health_body(check, event.time_zone if event else "UTC")
        return await page(
            request,
            "Health",
            body,
            session=session,
            current="health",
            description=description,
            actions=f'<a class="canccu-button canccu-button--secondary" '
            f'href="{BASE}/health-view?check=now">{icon("refresh")}Check now</a>',
        )

    app = Starlette(
        routes=[
            Route("/api/admin/settings/{module}", get_settings, methods=["GET"]),
            Route("/api/admin/settings/{module}", put_settings, methods=["PUT"]),
            Route("/internal/admin/settings/{module}", internal_settings, methods=["GET"]),
            Route("/internal/admin/settings/{module}", internal_patch_settings, methods=["PATCH"]),
            Route("/internal/admin/profile/theme", internal_profile_theme, methods=["GET"]),
            Route("/internal/admin/profile/logo", internal_profile_logo, methods=["GET"]),
            Route("/api/admin/profile", get_profile, methods=["GET"]),
            Route("/api/admin/profile", put_profile, methods=["PUT"]),
            Route("/", index),
            Route("/settings", settings_index),
            Route("/settings/{module}", settings_form, methods=["GET"]),
            Route("/settings/{module}", settings_save, methods=["POST"]),
            Route("/health-view", health_page),
            Route("/static/ui.css", static_ui_css, methods=["GET"]),
            Route("/static/{name}.js", static_script, methods=["GET"]),
            *profile_routes(service, auth, authorize),
            *auth_routes(auth, authorize, on_event, viewer),
            *people_routes(auth, authorize, on_event),
        ]
    )
    # Added before install(): Starlette wraps each later middleware around the earlier ones,
    # so the kit's correlation middleware also covers the origin check's 403.
    app.state.tenants = resolver  # the event the shell's header names (pages.event_of)
    app.state.health_watch = watch  # the menu's note on Health (pages.page)
    app.add_middleware(OriginCheck, origin=auth.public_origin)
    install(app, watch.own)
    # Innermost, as the kit's install_tenancy places it: the correlation id and the origin check
    # cover its 404s, and settings and profile handlers run inside the request's tenant.
    app.user_middleware.append(Middleware(TenantPaths, resolver=resolver))
    install_service_identity(app, identity)
    app.add_exception_handler(NotSignedIn, not_signed_in)
    app.add_exception_handler(KitError, page_error_handler(auth))
    return app
