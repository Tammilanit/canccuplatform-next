"""Event access (#778, #783): where the event's organiser pages open and where its paired screens
play, the tenants contract's `admin_access` and `screen_access` (contracts/tenants.md, Admin access,
Screen access) in plain words, each with its default.

The value is the tenants module's, so the page reads and saves it through the tenants API as the
person: their cookie decides the right (`tenants.access.write`, the event-admin role only) and their
address, forwarded as Caddy gave it, decides `admin_access` itself, never admin's own address.
"""

from __future__ import annotations

from typing import Any

import httpx
from canccu_kit import KitError, TenantContext
from canccu_kit.ui import esc, notice
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from starlette.routing import Route

from .auth_routes import Need
from .pages import BASE, page

ACCESS = f"{BASE}/access"
# The default first; the words the crew reads, never the values.
CHOICES = (
    (
        "internet",
        "From anywhere, after signing in",
        "Organisers and crew sign in with Discord and see only what their role allows.",
    ),
    (
        "restricted",
        "Only from the venue's network",
        "Elsewhere the organiser pages say that they open only at the venue. Choose it only "
        "where the venue's network is up whenever the crew needs these pages.",
    ),
)
# Pairing is the trust (#783): the default lets a paired screen play on any network.
SCREEN_CHOICES = (
    (
        "internet",
        "Anywhere, once paired",
        "An organiser pairs each screen with the code it shows, which proves it is the event's. "
        "Screens keep playing on a 4G router or when the venue's address changes.",
    ),
    (
        "restricted",
        "Only on the venue's network",
        "Elsewhere a screen says it is not at the venue. Choose it only where the venue's network "
        "has fixed addresses.",
    ),
)
DEFAULT = "internet"
READ_ONLY = "Only the event's admins can change this."
WORDS = {value: label for value, label, _ in CHOICES}
SCREEN_WORDS = {value: label for value, label, _ in SCREEN_CHOICES}
# Each setting: its field, its card's title, its choices.
SETTINGS = (
    ("admin_access", "The organiser pages open", CHOICES),
    ("screen_access", "Screens play", SCREEN_CHOICES),
)


class TenantsApi:
    """`GET` and `PATCH /api/tenants/current` on the request's own hostname, as the person."""

    def __init__(self, url: str, http: httpx.AsyncClient) -> None:
        self.url = url.rstrip("/")
        self.http = http

    async def call(self, request: Request, method: str, body: dict[str, Any] | None = None) -> Any:
        headers = {"host": request.headers.get("host", "")}
        for name in ("cookie", "x-forwarded-for"):
            if name in request.headers:
                headers[name] = request.headers[name]
        try:
            response = await self.http.request(
                method, f"{self.url}/api/tenants/current", headers=headers, json=body
            )
            answer = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise KitError(
                "tenants did not answer", status=503, code="tenants_unavailable"
            ) from exc
        if response.is_success and isinstance(answer, dict):
            return answer
        error = answer.get("error", {}) if isinstance(answer, dict) else {}
        raise KitError(
            str(error.get("message", "tenants refused")),
            status=response.status_code if response.status_code >= 400 else 503,
            code=str(error.get("code", "tenants_unavailable")),
        )


def access_row(ctx: TenantContext | None) -> tuple[str, str, str, str, str, str]:
    """The Settings list's row for Event access (settings_view.settings_list)."""
    shown = WORDS.get(ctx["admin_access"], "") if ctx else ""
    return (
        ACCESS,
        "pin",
        "Event access",
        "Where the organiser pages open and screens play",
        shown,
        "",
    )


def _option(name: str, value: str, label: str, help_text: str, current: str) -> str:
    fid = f"{name}-{value}"
    default = ' <span class="canccu-badge">Default</span>' if value == DEFAULT else ""
    return (
        f'<div class="canccu-field canccu-field--check"><input class="canccu-check" '
        f'type=radio name={name} value="{value}"{" checked" if value == current else ""}'
        f" id={fid}>"
        f'<label class="canccu-field__label" for={fid}>{esc(label)}</label>{default}'
        f'<p class="canccu-field__hint">{esc(help_text)}</p></div>'
    )


def access_view(
    current: dict[str, str], revision: int | None, *, saved: bool = False, stale: bool = False
) -> str:
    """A card per setting: its choices as a form for an event admin (`revision` known), else the
    current one in words."""
    notices = notice("ok", "Saved", "The change applies now.") if saved else ""
    if stale:
        notices += notice(
            "warn",
            "Not saved",
            "Someone changed this meanwhile. This is how it is now: choose again if you need to.",
        )
    cards = []
    for name, heading, choices in SETTINGS:
        value = current.get(name, DEFAULT)
        title = f'<h2 class="canccu-card__title" id={name}-title>{esc(heading)}</h2>'
        if revision is None:
            words = {v: label for v, label, _ in choices}.get(value, value)
            body = f'<p class="canccu-card__desc">{esc(words)}.</p>'
        else:
            options = "".join(_option(name, v, label, text, value) for v, label, text in choices)
            body = (
                f'<div class="canccu-form" role=radiogroup aria-labelledby={name}-title>'
                f"{options}</div>"
            )
        cards.append(f'<section class="canccu-card">{title}{body}</section>')
    if revision is None:
        return f"{notices}{''.join(cards)}<p>{esc(READ_ONLY)}</p>"
    return (
        f'<form method=post action="{ACCESS}">{notices}{"".join(cards)}'
        f'<input type=hidden name=revision value="{revision}">'
        '<div class="canccu-cluster"><button class="canccu-button canccu-button--primary">Save'
        "</button></div></form>"
    )


def access_routes(need: Need, api: TenantsApi | None) -> list[Route]:
    def tenants() -> TenantsApi:
        if api is None:
            raise KitError("no tenants API", status=503, code="tenants_unavailable")
        return api

    async def show(request: Request, view: str, status: int = 200) -> Response:
        session = await need(request, "admin.settings.read")
        return await page(
            request,
            "Event access",
            view,
            status,
            session=session,
            current="settings",
            description_html=esc(
                "Where organisers and crew can open the event's organiser pages, and where its "
                "paired screens play."
            ),
        )

    def values_of(source: Any) -> dict[str, str]:
        return {name: str(source.get(name, DEFAULT)) for name, _, _ in SETTINGS}

    def view_of(event: dict[str, Any], ctx: TenantContext | None, **marks: bool) -> str:
        revision = event.get("revision")
        if isinstance(revision, int) and "admin_access" in event:
            return access_view(values_of(event), revision, **marks)
        # Tenants shows the settings to its event admins only; the context says them to everyone.
        return access_view(values_of(ctx or {}), None, **marks)

    async def access_page(request: Request) -> Response:
        await need(request, "admin.settings.read")
        event = await tenants().call(request, "GET")
        saved = bool(request.query_params.get("saved"))
        return await show(request, view_of(event, request.state.tenant, saved=saved))

    async def access_save(request: Request) -> Response:
        await need(request, "admin.settings.write")
        form = await request.form()
        value = str(form.get("admin_access", ""))
        try:
            revision = int(str(form.get("revision", "")))
        except ValueError as exc:
            raise KitError("revision missing", status=400, code="invalid_request") from exc
        if value not in WORDS:
            raise KitError("Choose where the organiser pages open.", status=400, code="invalid")
        patch: dict[str, Any] = {"revision": revision, "admin_access": value}
        if "screen_access" in form:
            screens = str(form.get("screen_access"))
            if screens not in SCREEN_WORDS:
                raise KitError("Choose where screens play.", status=400, code="invalid")
            patch["screen_access"] = screens
        try:
            await tenants().call(request, "PATCH", patch)
        except KitError as exc:
            if exc.code == "missing_right":
                # `tenants.access.write` is the event-admin role only; admin's owner and admin
                # roles can read the full event without holding it, so the form can be offered
                # and refused. Show the value read only instead of a dead end.
                event = await tenants().call(request, "GET")
                return await show(request, access_view(values_of(event), None), 403)
            if exc.code != "version_conflict":
                raise
            event = await tenants().call(request, "GET")
            return await show(request, view_of(event, request.state.tenant, stale=True), 409)
        return RedirectResponse(f"{ACCESS}?saved=1", status_code=303)

    return [
        Route("/access", access_page, methods=["GET"]),
        Route("/access", access_save, methods=["POST"]),
    ]
