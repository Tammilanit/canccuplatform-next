"""HTTP surface: the admin API (contracts/admin.md) and the server-rendered pages."""

from __future__ import annotations

import html
from typing import Any
from urllib.parse import urlencode

from canccu_kit import Health, KitError, MissingRight, NotSignedIn, TenantResolver
from canccu_kit.rights import Session
from canccu_kit.starlette import install
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .auth import Auth
from .auth_routes import Authorize, OnEvent, OriginCheck, auth_routes
from .declarations import Setting
from .pages import BASE, SIGN_OUT, page
from .service import BadSettings, Service
from .tenancy import TenantPaths

MODULES = ("screen", "tournament", "pizza", "bot", "admin", "games", "moments", "voices", "cast")


def _field(s: Setting, value: Any) -> str:
    name, label = html.escape(s.key), html.escape(s.label)
    value = s.default if value is None else value
    if s.type == "boolean":
        checked = " checked" if value else ""
        return f"<p><label><input type=checkbox name={name}{checked}> {label}</label></p>"
    if s.choices:
        opts = "".join(
            f"<option{' selected' if c == value else ''}>{html.escape(c)}</option>"
            for c in s.choices
        )
        return f"<p><label>{label} <select name={name}>{opts}</select></label></p>"
    text = (
        ", ".join(map(str, value)) if isinstance(value, list) else ("" if value is None else value)
    )
    kind = "number" if s.type == "number" else "text"
    return (
        f"<p><label>{label} <input type={kind} step=any name={name} "
        f"value='{html.escape(str(text))}'></label></p>"
    )


def _from_form(declared: list[Setting], form: Any) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for s in declared:
        raw = form.get(s.key)
        if s.type == "boolean":
            values[s.key] = raw is not None
        elif raw is None or raw == "":
            continue
        elif s.type == "number":
            try:
                number = float(raw)
            except ValueError as exc:
                raise BadSettings(f"{s.key} must be a number") from exc
            values[s.key] = int(number) if number.is_integer() else number
        elif s.type == "list":
            values[s.key] = [p.strip() for p in str(raw).split(",") if p.strip()]
        else:
            values[s.key] = str(raw)
    return values


def create_app(
    service: Service,
    health: Health,
    authorize: Authorize,
    auth: Auth,
    resolver: TenantResolver,
    on_event: OnEvent | None = None,
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
        fields = "".join(_field(s, current["values"].get(s.key)) for s in declared)
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
        values = _from_form(service.declarations.get(module, []), form)
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
