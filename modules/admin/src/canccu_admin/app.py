"""HTTP surface: the admin API (contracts/admin.md) and the server-rendered pages."""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from urllib.parse import urlencode

from canccu_kit import (
    Health,
    KitError,
    NotSignedIn,
    ServiceForbidden,
    ServiceIdentity,
    TenantResolver,
    is_tenant_id,
    tenant_scope,
)
from canccu_kit.rights import Session
from canccu_kit.starlette import install, install_service_identity
from canccu_kit.ui import esc, icon, notice
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .auth import Auth
from .auth_routes import Authorize, OnEvent, OriginCheck, auth_routes
from .forms import field_html, from_form
from .pages import (
    BASE,
    HEALTH_ORDER,
    HEALTH_WORDS,
    MODULE_ICONS,
    event_of,
    page,
    page_error_handler,
    part_name,
    static_ui_css,
)
from .service import BadSettings, Service
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
        return RedirectResponse(f"{BASE}/settings", status_code=303)

    async def settings_index(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        event = await event_of(request)
        zone, now = (event.time_zone if event else "UTC"), datetime.now(UTC)
        changed = await service.store.last_changed()
        groups = {m: part_name(m, settings=True) for m in service.declarations}
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
        recent = await service.store.recent_changes(SHOWN_CHANGES)
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

    async def settings_form(request: Request) -> Response:
        module = module_of(request)
        session = await need(request, "admin.settings.read")
        declared = service.declarations.get(module, [])
        current = await service.get_settings(module)
        fields = "".join(field_html(s, current["values"].get(s.key)) for s in declared)
        saved = (
            notice("ok", "Saved", "The change applies now.")
            if request.query_params.get("saved")
            else ""
        )
        form = (
            f'{saved}<form method=post class="canccu-card canccu-form">'
            f"<input type=hidden name=settings_version value={current['settings_version']}>"
            f'{fields}<div class="canccu-cluster">'
            '<button class="canccu-button canccu-button--primary">Save</button></div></form>'
        )
        return await page(
            request,
            part_name(module, settings=True),
            form,
            session=session,
            current="settings",
            narrow=True,
            crumb=(f"{BASE}/settings", "Settings"),
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
        rows.sort(key=lambda r: (HEALTH_ORDER.get(r[1], 0), part_name(r[0])))
        # "What it says" only when some part says something: an empty column is only noise.
        said = any(d for *_, d in rows)
        trs = "".join(
            f"<tr><td><b>{esc(part_name(m))}</b></td>"
            f'<td><span class="canccu-badge canccu-badge--{esc(s)}">'
            f"{esc(HEALTH_WORDS.get(s, s))}</span></td>{f'<td>{esc(d)}</td>' if said else ''}"
            f'<td class="canccu-hide-phone canccu-num">{esc(v)}</td>'
            f'<td class="canccu-hide-phone"><code class="canccu-muted">{esc(m)}</code></td></tr>'
            for m, s, v, d in rows
        )
        counts = [
            f"{n} {HEALTH_WORDS[k].lower()}"
            for k in ("ok", "degraded", "down")
            if (n := sum(1 for r in rows if r[1] == k))
        ]
        table = (
            '<section class="canccu-card canccu-card--flush"><table class="canccu-table">'
            f"<thead><tr><th>Part</th><th>Status</th>{'<th>What it says</th>' if said else ''}"
            '<th class="canccu-hide-phone">Version</th><th class="canccu-hide-phone">Log name</th>'
            f"</tr></thead><tbody>{trs}</tbody></table></section>"
        )
        return await page(
            request,
            "Health",
            table,
            session=session,
            current="health",
            description=f"{len(rows)} parts: {', '.join(counts)}. Checked when you open the page.",
            actions=f'<a class="canccu-button canccu-button--secondary" href="{BASE}/health-view">'
            f"{icon('refresh')}Check now</a>",
        )

    async def profile_page(request: Request) -> Response:
        session = await need(request, "admin.profile.read")
        message = request.query_params.get("message", "")
        warns = request.query_params.getlist("warn")
        notes = notice("ok", message) if message else ""
        if warns:
            notes += notice("warn", "Loaded with warnings", "; ".join(warns))
        cards = (
            '<section class="canccu-card"><h2 class="canccu-card__title">Save</h2>'
            '<p class="canccu-card__desc">Writes the event\'s name, modules, settings and look'
            " to the event folder, as one profile.</p>"
            f'<form method=post action="{BASE}/profile/save"><button class="canccu-button '
            'canccu-button--secondary">Save to the event folder</button></form></section>'
            '<section class="canccu-card"><h2 class="canccu-card__title">Replace</h2>'
            '<p class="canccu-card__desc">Loads the profile in the event folder. It replaces'
            " settings and look, and can't be undone; run of show and people stay.</p>"
            f'<form method=post action="{BASE}/profile/load"><button class="canccu-button '
            'canccu-button--danger-ghost">Load the profile from the event folder</button>'
            "</form></section>"
        )
        return await page(
            request,
            "Event profile",
            notes + cards,
            session=session,
            current="profile",
            narrow=True,
            description="The event's name, modules, settings and look, as one file.",
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
            Route("/profile", profile_page),
            Route("/profile/save", profile_save, methods=["POST"]),
            Route("/profile/load", profile_load, methods=["POST"]),
            *auth_routes(auth, authorize, on_event),
        ]
    )
    # Added before install(): Starlette wraps each later middleware around the earlier ones,
    # so the kit's correlation middleware also covers the origin check's 403.
    app.state.tenants = resolver  # the event the shell's header names (pages.event_of)
    app.add_middleware(OriginCheck, origin=auth.public_origin)
    install(app, health)
    # Innermost, as the kit's install_tenancy places it: the correlation id and the origin check
    # cover its 404s, and settings and profile handlers run inside the request's tenant.
    app.user_middleware.append(Middleware(TenantPaths, resolver=resolver))
    install_service_identity(app, identity)
    app.add_exception_handler(NotSignedIn, _not_signed_in)
    app.add_exception_handler(KitError, page_error_handler(auth))
    return app


async def _not_signed_in(request: Request, exc: Exception) -> Response:
    """The API answers 401 (contracts/admin.md); a page sends the browser to sign in."""
    if request.url.path.startswith("/api/"):
        assert isinstance(exc, NotSignedIn)
        return JSONResponse(exc.to_body(), status_code=exc.status)
    return RedirectResponse(f"{BASE}/sign-in", status_code=303)
