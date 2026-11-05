"""HTTP surface: the admin API (contracts/admin.md) and the server-rendered pages."""

from __future__ import annotations

import html
from collections.abc import Awaitable, Callable
from typing import Any

from canccu_kit import Health, KitError
from canccu_kit.rights import Session
from canccu_kit.starlette import install
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Route

from .declarations import Setting
from .service import BadSettings, Service

Authorize = Callable[[str | None, str], Awaitable[Session]]
BASE = "/admin"  # Caddy serves module pages under /admin/ and strips it
MODULES = ("screen", "tournament", "pizza", "bot", "admin", "games", "moments", "voices", "cast")


def _page(title: str, body: str) -> HTMLResponse:
    nav = " · ".join(
        f'<a href="{BASE}/{p}">{n}</a>'
        for p, n in (("settings", "Settings"), ("health-view", "Health"), ("profile", "Profile"))
    )
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
        f"<body style='font-family:sans-serif;max-width:48rem;margin:2rem auto'>"
        f"<nav>{nav}</nav><h1>{html.escape(title)}</h1>{body}</body>"
    )


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


def create_app(service: Service, health: Health, authorize: Authorize) -> Starlette:
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
        await need(request, "admin.settings.read")
        links = "".join(
            f'<li><a href="{BASE}/settings/{m}">{m}</a></li>' for m in service.declarations
        )
        return _page(
            "Settings", f"<ul>{links}</ul>" if links else "<p>No module declares settings.</p>"
        )

    async def settings_form(request: Request) -> Response:
        module = module_of(request)
        await need(request, "admin.settings.read")
        declared = service.declarations.get(module, [])
        current = await service.get_settings(module)
        fields = "".join(_field(s, current["values"].get(s.key)) for s in declared)
        notice = (request.query_params.get("saved") and "<p><b>Saved.</b></p>") or ""
        return _page(
            f"Settings: {module}",
            f"{notice}<form method=post>"
            f"<input type=hidden name=settings_version value={current['settings_version']}>"
            f"{fields}<button>Save</button></form>",
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
        await need(request, "admin.settings.read")
        own = (await health.run()).body
        rows = [(health.module, own["status"], own["version"], "")]
        rows += [(h.module, h.status, h.version, h.detail) for h in await service.health_view()]
        trs = "".join(
            f"<tr><td>{html.escape(m)}</td><td>{html.escape(s)}</td><td>{html.escape(v)}</td>"
            f"<td>{html.escape(d)}</td></tr>"
            for m, s, v, d in rows
        )
        return _page(
            "Health",
            "<table border=1 cellpadding=4><tr><th>Module<th>Status<th>Version"
            f"<th>Detail</tr>{trs}</table>",
        )

    async def profile_page(request: Request) -> Response:
        await need(request, "admin.profile.read")
        message = html.escape(request.query_params.get("message", ""))
        warns = "".join(f"<li>{html.escape(w)}</li>" for w in request.query_params.getlist("warn"))
        return _page(
            "Profile",
            (f"<p><b>{message}</b></p>" if message else "")
            + (f"<p>Warnings:</p><ul>{warns}</ul>" if warns else "")
            + f"<form method=post action={BASE}/profile/save><button>Save profile to event folder"
            f"</button></form><form method=post action={BASE}/profile/load>"
            "<button>Load profile from event folder</button></form>",
        )

    async def profile_save(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        result = await service.save_profile(session.user_id)
        return RedirectResponse(f"{BASE}/profile?message=Saved+{result['name']}", status_code=303)

    async def profile_load(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        result = await service.load_profile(session.user_id)
        from urllib.parse import urlencode

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
        ]
    )
    install(app, health)
    return app
