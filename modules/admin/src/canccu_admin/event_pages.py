"""Admin → Event (#782 part B, plan D7, D8): every event-specific base setting in one place, each
section read from and saved through its owner as the person (event_owners.py).

A section's form posts only to its own owner with that owner's revision, so a refusal or a
conflict answers that one section again with what was typed and the current values beside it; the
other sections are untouched (the admin control room pack, E3).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import KitError
from canccu_kit.rights import Session
from canccu_kit.ui import esc, local_time
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from starlette.routing import Route

from .access_pages import ACCESS_SETTINGS
from .auth_routes import Need
from .event_owners import TenantsApi
from .event_venue import PLAN, wifi_rows
from .event_views import EVENT, event_view
from .event_widgets import EventData, Retry
from .pages import BASE, SETTINGS_TABS, page
from .zones import zone_names

DESCRIPTION = (
    "Everything that makes this event its own: its name and dates, venue, web addresses, who gets "
    "in, its modules and organisers."
)
BASIC_FIELDS = ("name", "short_name", "starts_at", "ends_at", "time_zone", "description")
NOT_SAVED = "Not saved"
CONFLICT = "Someone changed this meanwhile. What you typed is kept here: save again to use it."
# A browser never fills a file field again, so a floor plan's conflict asks for the file.
PLAN_CONFLICT = "Someone changed this meanwhile. Choose the file again to save it."
READS = {
    "venue_info": "/api/tenants/current/venue-info",
    "venue": "/api/tenants/current/venue",
    "hostnames": "/api/tenants/current/hostnames",
    "flags": "/api/tenants/current/flags",
    "storage": "/api/tenants/current/storage",
    "series": "/api/tenants/current/series",
}
Users = Callable[[], Awaitable[list[tuple[Any, str | None]]]]


def _utc(local: str, zone: str) -> str | None:
    """A `datetime-local` value read in `zone`, as the contract's UTC time."""
    if not local.strip():
        return None
    try:
        moment = datetime.fromisoformat(local.strip()).replace(tzinfo=ZoneInfo(zone))
    except ValueError as exc:
        raise ValueError("Write each time as a date and a time.") from exc
    return moment.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def _form_text(form: Any) -> dict[str, str]:
    return {k: v for k, v in form.items() if isinstance(v, str)}


def event_routes(
    need: Need, api: TenantsApi | None, users: Users, declared: Mapping[str, Any]
) -> list[Route]:
    """`users` lists admin's people with their roles (auth.users)."""

    async def people() -> list[tuple[str, str]]:
        """Who may be the event's contact person: everyone with a role (#782, Q4)."""
        return [(user.id, user.name) for user, role in await users() if role]

    def tenants() -> TenantsApi:
        if api is None:
            raise KitError("no tenants API", status=503, code="tenants_unavailable")
        return api

    links = {m: f"/admin/settings/{m}" for m in declared} | dict(SETTINGS_TABS)

    async def read_all(request: Request) -> EventData:
        owner = tenants()
        tenant, *rest = await asyncio.gather(
            owner.read(request), *(owner.read_status(request, path) for path in READS.values())
        )
        got = {key: answer for key, (answer, _) in zip(READS, rest, strict=True)}
        codes = {key: code for key, (_, code) in zip(READS, rest, strict=True)}
        hostnames = got["hostnames"]
        return EventData(
            tenant=tenant,
            venue_info=got["venue_info"],
            venue=got["venue"],
            venue_status=codes["venue"],
            hostnames_status=codes["hostnames"],
            hostnames=None if hostnames is None else hostnames.get("hostnames", []),
            flags=got["flags"],
            storage=got["storage"],
            series=got["series"],
            people=await people(),
            settings_links=links,
            ctx=getattr(request.state, "tenant", None),
        )

    async def show(
        request: Request, session: Session, retry: Retry | None = None, status: int = 200
    ) -> Response:
        data = await read_all(request)
        data.saved = request.query_params.get("saved")
        return await page(
            request,
            "Event",
            event_view(session, data, retry),
            status,
            session=session,
            # The page is in no menu: nothing is marked, and the crumb leads back to Home.
            crumb=(f"{BASE}/", "Home"),
            description_html=esc(DESCRIPTION),
        )

    def saved(section: str) -> Response:
        return RedirectResponse(f"{EVENT}?saved={section}#{section}", status_code=303)

    async def refused(
        request: Request,
        session: Session,
        exc: KitError,
        section: str,
        typed: Mapping[str, str],
        *,
        plan: bool = False,
    ) -> Response:
        """The owner said no: that section again, with what was typed and why."""
        if exc.code == "version_conflict" and plan:
            retry = Retry(section, {}, NOT_SAVED, PLAN_CONFLICT)
        elif exc.code == "version_conflict":
            now = await tenants().read(request) if section in ("basics", "organisers") else None
            names = dict(await people())
            retry = Retry(
                section, typed, NOT_SAVED, CONFLICT + _now_words(section, now, typed, names)
            )
        elif exc.code == "missing_right":
            retry = Retry(section, {}, NOT_SAVED, "Only the event's admins can change this.")
            retry.read_only = True
        elif exc.status in (400, 413, 415, 422):
            # 413/415: a floor plan too big or not a picture. Access refusals (403) stay errors.
            retry = Retry(section, typed, NOT_SAVED, exc.message or "The owner refused it.")
        else:
            raise exc
        return await show(request, session, retry, exc.status)

    async def event_page(request: Request) -> Response:
        return await show(request, await need(request, "admin.settings.read"))

    async def save_basics(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        typed = _form_text(await request.form())
        zone = typed.get("time_zone", "").strip()
        if zone not in zone_names():
            retry = Retry("basics", typed, NOT_SAVED, "Choose a time zone from the list.")
            return await show(request, session, retry, 400)
        try:
            wanted: dict[str, Any] = {
                "name": typed.get("name", "").strip(),
                "short_name": typed.get("short_name", "").strip(),
                "description": typed.get("description", "").strip(),
                "time_zone": zone,
                "starts_at": _utc(typed.get("starts_at", ""), zone),
                "ends_at": _utc(typed.get("ends_at", ""), zone),
            }
        except ValueError as exc:
            return await show(request, session, Retry("basics", typed, NOT_SAVED, str(exc)), 400)
        current = await tenants().call(request, "GET")
        patch = {k: v for k, v in wanted.items() if not _same(k, v, current.get(k))}
        if not patch:
            return saved("basics")
        try:
            await tenants().call(request, "PATCH", patch | {"revision": _int(typed, "revision")})
        except KitError as exc:
            return await refused(request, session, exc, "basics", typed)
        return saved("basics")

    async def save_venue(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        typed = _form_text(await request.form())
        body = {
            "revision": _int(typed, "revision"),
            "address": typed.get("address", "").strip(),
            "house_rules": typed.get("house_rules", ""),
            "wifi": wifi_rows(typed),
        }
        try:
            await tenants().call(request, "PUT", body, path=READS["venue_info"])
        except KitError as exc:
            return await refused(request, session, exc, "venue", typed)
        return saved("venue")

    async def save_plan(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        upload = (await request.form()).get("floor_plan")
        if not isinstance(upload, UploadFile):
            retry = Retry("venue", {}, NOT_SAVED, "Choose a picture of the floor plan.")
            return await show(request, session, retry, 400)
        content = await upload.read()
        kind = upload.content_type or "application/octet-stream"
        try:
            await tenants().call(request, "PUT", path=PLAN, content=content, content_type=kind)
        except KitError as exc:
            return await refused(request, session, exc, "venue", {}, plan=True)
        return saved("venue")

    async def save_modules(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        typed = _form_text(await request.form())
        current = await tenants().call(request, "GET", path=READS["flags"])
        switches = {k: v for k, v in current.get("flags", {}).items() if k.endswith(".enabled")}
        changed = {k: k in typed for k, v in switches.items() if (k in typed) != v}
        if not changed:
            return saved("modules")
        body = {"flags_version": _int(typed, "flags_version"), "flags": changed}
        try:
            await tenants().call(request, "PUT", body, path=READS["flags"])
        except KitError as exc:
            return await refused(request, session, exc, "modules", typed)
        return saved("modules")

    async def save_contact(request: Request) -> Response:
        session = await need(request, "admin.settings.read")
        typed = _form_text(await request.form())
        contact = typed.get("contact_user_id", "")
        if contact and contact not in dict(await people()):
            retry = Retry("organisers", typed, NOT_SAVED, "Choose someone with a role.")
            return await show(request, session, retry, 400)
        body = {"revision": _int(typed, "revision"), "contact_user_id": contact or None}
        try:
            await tenants().call(request, "PATCH", body)
        except KitError as exc:
            return await refused(request, session, exc, "organisers", typed)
        return saved("organisers")

    async def save_access(request: Request) -> Response:
        session = await need(request, "admin.settings.write")
        typed = _form_text(await request.form())
        patch: dict[str, Any] = {"revision": _int(typed, "revision")}
        for key, title, choices in ACCESS_SETTINGS:
            if key in typed:
                if typed[key] not in {v for v, _, _ in choices}:
                    retry = Retry("access", typed, NOT_SAVED, f"Choose {title.lower()}.")
                    return await show(request, session, retry, 400)
                patch[key] = typed[key]
        try:
            await tenants().call(request, "PATCH", patch)
        except KitError as exc:
            return await refused(request, session, exc, "access", typed)
        return saved("access")

    async def access_moved(request: Request) -> Response:
        return RedirectResponse(f"{EVENT}#access", status_code=303)

    return [
        Route("/event", event_page, methods=["GET"]),
        Route("/event/basics", save_basics, methods=["POST"]),
        Route("/event/venue", save_venue, methods=["POST"]),
        Route("/event/floor-plan", save_plan, methods=["POST"]),
        Route("/event/modules", save_modules, methods=["POST"]),
        Route("/event/contact", save_contact, methods=["POST"]),
        Route("/access", access_moved, methods=["GET"]),
        Route("/access", save_access, methods=["POST"]),
    ]


LABELS = {
    "name": "name",
    "short_name": "short name",
    "time_zone": "time zone",
    "description": "poster text",
    "starts_at": "start",
    "ends_at": "end",
    "contact_user_id": "contact person",
}


def _minute(iso: Any) -> datetime | None:
    if not iso:
        return None
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).replace(second=0, microsecond=0)


def _same(key: str, wanted: Any, stored: Any) -> bool:
    """A time is typed to the minute, so it equals a stored time of the same minute: saving
    another field must not cut the stored seconds."""
    if key in ("starts_at", "ends_at"):
        return _minute(wanted) == _minute(stored)
    return bool(wanted == stored)


def _now_words(
    section: str,
    now: Mapping[str, Any] | None,
    typed: Mapping[str, str],
    names: Mapping[str, str],
) -> str:
    """The values someone else saved meanwhile that differ from what was typed, in words: times
    as the form writes them, the contact person by name."""
    if now is None:
        return ""
    keys = BASIC_FIELDS if section == "basics" else ("contact_user_id",)
    zone = str(now.get("time_zone") or "UTC")
    shown = []
    for key in keys:
        value = str(now.get(key) or "")
        mine = typed.get(key, "")
        if key in ("starts_at", "ends_at"):
            value = local_time(value, zone).strftime("%Y-%m-%d %H:%M") if value else ""
            mine = mine.replace("T", " ")
        if value == mine:
            continue
        if key == "contact_user_id" and value:
            value = names.get(value, "someone without a role now")
        shown.append(f"{LABELS[key]} {value or 'empty'}")
    return f" Now: {'; '.join(shown)}." if shown else ""


def _int(form: Mapping[str, str], key: str) -> int:
    try:
        return int(form.get(key, ""))
    except ValueError as exc:
        raise KitError(f"{key} missing", status=400, code="invalid_request") from exc
