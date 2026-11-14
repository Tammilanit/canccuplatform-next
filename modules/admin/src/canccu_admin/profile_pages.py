"""The Event profile pages (docs/design/mockups.html, sheet 4): what is loaded and Download, and the
two ways to replace it, Load from the event folder and Upload, each asking first."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlencode

from canccu_kit import KitError
from canccu_kit.rights import Session
from canccu_kit.ui import empty_state, esc, icon, notice
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from starlette.routing import Route

from .auth import Auth
from .auth_routes import Need
from .pages import BASE, event_of, page
from .service import Service
from .settings_view import when

DOWNLOAD = '<a class="canccu-button canccu-button--secondary" href="/api/admin/profile" '
DOWNLOAD += f'download="profile.zip">{icon("download")}'
KEPT = "The run of show, people and their roles."
UNLOADABLE = "The profile in the event folder can't be loaded"


def _loaded_card(name: str, by: str, modules: int, zone: str, saved: str) -> str:
    """What is in use, when and by whom it was loaded, and the way to take it along."""
    return (
        '<section class="canccu-card"><h2 class="canccu-card__title">Loaded</h2>'
        f'<p class="canccu-card__desc">{esc(name)}{esc(by)}</p>'
        f'<dl class="canccu-dl"><dt>Modules</dt><dd>{modules}</dd>'
        f"<dt>Time zone</dt><dd>{esc(zone)}</dd></dl>"
        f'<div class="canccu-cluster">{DOWNLOAD}Download this profile</a>{saved}</div></section>'
    )


def _replace_card(folder: str | None, problem: KitError | None, again: bool) -> str:
    # A broken folder profile says why, so Upload stays the way out (no silent "no profile").
    broken = notice("down", UNLOADABLE, problem.message) if problem else ""
    load = (
        f'<a class="canccu-button canccu-button--danger-ghost" href="{BASE}/profile/load">'
        f"Load the {esc(folder)} profile{' again' if again else ''}…</a>"
        if folder
        else ""
        if problem
        else '<p class="canccu-muted canccu-small">The event folder holds no profile to load.</p>'
    )
    return (
        '<section class="canccu-card"><h2 class="canccu-card__title">Replace with another '
        'profile</h2><p class="canccu-card__desc">Replaces settings and look, and can\'t be '
        f"undone. Run of show and people stay. Both ask first.</p>{broken}"
        f'<div class="canccu-cluster">{load}<a class="canccu-button canccu-button--danger-ghost" '
        f'href="{BASE}/profile/upload">Upload a profile…</a></div></section>'
    )


def _ask(title: str, replaced: str, loaded: bool, form: str, problem: str = "") -> str:
    """The question before a replace: what goes, what stays, no undo; the danger button last."""
    undo = "No. Download the current profile first if you may want it back." if loaded else "No."
    download = f"{DOWNLOAD}Download current profile</a>" if loaded else ""
    return (
        f'{problem}<section class="canccu-card canccu-dialog" aria-labelledby="canccu-ask">'
        f'<h2 class="canccu-card__title" id="canccu-ask">{esc(title)}</h2>'
        f'<dl class="canccu-dl"><dt>Replaced</dt><dd>{esc(replaced)}</dd>'
        f"<dt>Kept</dt><dd>{KEPT}</dd><dt>Undo</dt><dd>{esc(undo)}</dd></dl>"
        f'{form}<div class="canccu-dialog__actions canccu-dialog__actions--stack">{download}'
        f'<a class="canccu-button canccu-button--secondary" href="{BASE}/profile">Cancel</a>'
        '<button class="canccu-button canccu-button--danger" form="canccu-replace">'
        "Replace settings and look</button></div></section>"
    )


def profile_routes(service: Service, auth: Auth, need: Need) -> list[Route]:
    async def ask_page(
        request: Request, session: Session, body: str, status: int = 200
    ) -> Response:
        return await page(
            request,
            "Event profile",
            body,
            status,
            session=session,
            current="profile",
            narrow=True,
            crumb=(f"{BASE}/profile", "Event profile"),
        )

    async def profile_page(request: Request) -> Response:
        session = await need(request, "admin.profile.read")
        message = request.query_params.get("message", "")
        warns = request.query_params.getlist("warn")
        notes = notice("ok", message) if message else ""
        if warns:
            notes += notice("warn", "Loaded with warnings", "; ".join(warns))
        record = await service.store.get_profile()
        saved = (
            f'<form method=post action="{BASE}/profile/save"><button class="canccu-button '
            'canccu-button--ghost">Save to the event folder</button></form>'
        )
        if record is None:
            in_use = empty_state("box", "Nothing loaded yet", "Load a profile or upload one.")
        else:
            loaded = await service.store.profile_loaded()
            by = ""
            if loaded is not None:
                event = await event_of(request)
                names = {u.id: u.name for u, _ in await auth.users()}
                # A session from elsewhere (CI's stub) is not among admin's users: it names itself.
                names.setdefault(session.user_id, session.user_name)
                moment = when(loaded[0], datetime.now(UTC), event.time_zone if event else "UTC")
                by = f" · {moment} by {names.get(loaded[1], 'someone')}"
            _, general = await service.store.get_settings("admin")
            zone = str(general.get("timezone") or "UTC")
            in_use = _loaded_card(str(record["name"]), by, len(record["modules"]), zone, saved)
        folder, problem = await service.folder_profile()
        return await page(
            request,
            "Event profile",
            notes + in_use + _replace_card(folder, problem, record is not None),
            session=session,
            current="profile",
            narrow=True,
            description="The event's name, modules, settings and look, as one file.",
        )

    async def ask_load(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        folder, problem = await service.folder_profile()
        loaded = await service.store.get_profile() is not None
        if problem is not None:
            raise problem
        if folder is None:
            raise KitError("the event folder holds no profile", status=404, code="not_found")
        form = f'<form method=post action="{BASE}/profile/load" id="canccu-replace"></form>'
        title = f"Load the {folder} profile{' again' if loaded else ''}?"
        body = _ask(title, "Every setting and the theme, with the profile's.", loaded, form)
        return await ask_page(request, session, body)

    def upload_form() -> str:
        return (
            f'<form method=post action="{BASE}/profile/upload" enctype="multipart/form-data" '
            'id="canccu-replace" class="canccu-form"><div class="canccu-field">'
            '<label class="canccu-field__label" for="canccu-field-profile">Profile file</label>'
            '<input class="canccu-input" type=file name=profile id="canccu-field-profile" '
            'accept=".zip,application/zip" required><p class="canccu-field__hint">A zip with '
            "profile.yaml and its assets, as Download makes it.</p></div></form>"
        )

    async def ask_upload(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        loaded = await service.store.get_profile() is not None
        body = _ask(
            "Upload a profile?",
            "Every setting and the theme, with the file's.",
            loaded,
            upload_form(),
        )
        return await ask_page(request, session, body)

    async def upload(request: Request) -> Response:
        session = await need(request, "admin.profile.write")
        file = (await request.form()).get("profile")
        try:
            if not isinstance(file, UploadFile):
                raise KitError("choose a profile file", status=400, code="profile_invalid")
            result = await service.import_zip(await file.read(), session.user_id)
        except KitError as exc:
            if exc.status != 400:
                raise
            loaded = await service.store.get_profile() is not None
            problem = notice("down", "Couldn't load that file", exc.message)
            body = _ask(
                "Upload a profile?",
                "Every setting and the theme, with the file's.",
                loaded,
                upload_form(),
                problem,
            )
            return await ask_page(request, session, body, 400)
        query = urlencode([("message", f"Loaded {result['name']}")])
        return RedirectResponse(f"{BASE}/profile?{query}", status_code=303)

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

    return [
        Route("/profile", profile_page),
        Route("/profile/save", profile_save, methods=["POST"]),
        Route("/profile/load", ask_load, methods=["GET"]),
        Route("/profile/load", profile_load, methods=["POST"]),
        Route("/profile/upload", ask_upload, methods=["GET"]),
        Route("/profile/upload", upload, methods=["POST"]),
    ]
