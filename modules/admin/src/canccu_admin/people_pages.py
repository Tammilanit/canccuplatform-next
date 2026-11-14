"""People (docs/design/mockups.html, sheet 4; #437): who may open which pages, for the owner.

Server-rendered and usable without script: search, the role filter and "Show" are links and a
GET form; a role is changed in the row by a button that applies at once, with Undo in the notice;
Remove asks first on a page of its own. On a phone the table becomes one row per person, and a
row opens the person's sheet (`/admin/people/{id}`). Only `people.js` copies the sign-in link.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from urllib.parse import urlencode

from canccu_kit.rights import Session
from canccu_kit.ui import day_label, empty_state, esc, icon, initials, notice, time_label
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from starlette.routing import Route

from .auth import Auth, UnknownUser
from .auth_db import Person
from .auth_routes import Need, OnEvent
from .pages import BASE, event_of, page

RIGHT = "admin.rights.write"
PEOPLE = f"{BASE}/people"
PAGE_SIZE = 25
# What each role is called and allows, in the words the page uses (crew comes with #223).
ROLE_NAMES = {"owner": "Owner", "admin": "Admin", None: "No role"}
ALLOWS = {
    "owner": "The owner may open every page and hands out roles.",
    "admin": "An admin may open every page except People: settings, health and the event profile.",
    None: "Without a role they can sign in, but open no organiser page.",
}
CHOICES = (None, "admin")  # the roles the owner hands out; the owner's own never changes
FILTERS = (("", "All"), ("none", "No role yet"), ("admin", "Admin"), ("owner", "Owner"))
COPY = (
    '<button type="button" class="canccu-button canccu-button--secondary"'
    f' data-canccu-copy="{BASE}/sign-in">Copy the sign-in link</button>'
)


def _role_value(role: str | None) -> str:
    return role or "none"


def last_here(at: datetime | None, now: datetime, time_zone: str) -> str:
    """ "now", "18:40", "yesterday" or "Fri 13 Mar", in the event's time zone."""
    if at is None:
        return "—"
    if now - at < timedelta(minutes=2):
        return "now"
    if day_label(at, time_zone) == day_label(now, time_zone):
        return time_label(at, time_zone)
    if day_label(at, time_zone) == day_label(now - timedelta(days=1), time_zone):
        return "yesterday"
    return day_label(at, time_zone)


def role_control(person: Person) -> str:
    """The role as buttons: one tap applies it (the owner's is a badge, as it never changes)."""
    if person.role == "owner":
        return '<span class="canccu-badge canccu-badge--primary">Owner</span>'
    buttons = "".join(
        f'<button class="canccu-chip" name="role" value="{_role_value(r)}" aria-pressed='
        f'"{"true" if person.role == r else "false"}">{ROLE_NAMES[r]}</button>'
        for r in CHOICES
    )
    return (
        f'<form method="post" action="{PEOPLE}/{esc(person.user.id)}" class="canccu-chips"'
        f' aria-label="Role of {esc(person.user.name)}">{buttons}</form>'
    )


def _remove_link(person: Person, label: str) -> str:
    if person.role == "owner":
        return ""
    return (
        f'<a class="canccu-danger-link" href="{PEOPLE}/{esc(person.user.id)}/remove">'
        f"{esc(label)}</a>"
    )


def _row(person: Person, you: bool, seen: str) -> str:
    user = person.user
    handle = esc(user.handle or "") + (" · you" if you else "")
    return (
        '<tr class="canccu-people__row"><td>'
        f'<a class="canccu-people__who" href="{PEOPLE}/{esc(user.id)}">'
        f'<span class="canccu-avatar" aria-hidden="true">{esc(initials(user.name))}</span>'
        f'<span class="canccu-people__names"><span class="canccu-people__name"'
        f' title="{esc(user.name)}">{esc(user.name)}</span>'
        f'<span class="canccu-people__handle">{handle}</span></span></a></td>'
        f'<td class="canccu-people__role">{role_control(person)}'
        f'<span class="canccu-people__label">{ROLE_NAMES[person.role]}</span></td>'
        f'<td class="canccu-people__seen">{esc(seen)}</td>'
        f'<td class="canccu-people__remove">{_remove_link(person, "Remove…")}</td></tr>'
    )


def _matches(person: Person, query: str, role: str) -> bool:
    if role and _role_value(person.role) != role:
        return False
    words = f"{person.user.name} {person.user.handle or ''}".lower()
    return query.lower() in words


def _query(**params: str) -> str:
    kept = {k: v for k, v in params.items() if v}
    return f"{PEOPLE}?{urlencode(kept)}" if kept else PEOPLE


def _changed_notice(
    people: dict[str, Person], names: dict[str, str], params: dict[str, str]
) -> str:
    """After a role change: what it is now, with Undo; after Remove: who left."""
    removed = names.get(params.get("removed", ""))
    if removed is not None:
        return notice("ok", f"{removed} was removed", "They were signed out at once.")
    person = people.get(params.get("changed", ""))
    old = params.get("from")
    if person is None or person.role == "owner" or old not in ("none", "admin"):
        return ""
    name = person.user.name
    title = f"{name} is now an Admin" if person.role == "admin" else f"{name} has no role now"
    undo = (
        f'<form method="post" action="{PEOPLE}/{esc(person.user.id)}">'
        f'<input type="hidden" name="role" value="{old}"><input type="hidden" name="undo"'
        ' value="1"><button class="canccu-button canccu-button--secondary canccu-button--sm">'
        "Undo</button></form>"
    )
    return notice("ok", title, ALLOWS[person.role], undo)


def people_routes(auth: Auth, need: Need, on_event: OnEvent | None) -> list[Route]:
    async def owner(request: Request) -> Session:
        return await need(request, RIGHT)

    async def everyone(viewer: Session) -> tuple[list[Person], dict[str, Person]]:
        rank = {"owner": 0, "admin": 1}

        def order(p: Person) -> tuple[bool, int, float]:
            # The viewer heads the list, then roles, then whoever was here last.
            seen = p.last_seen_at.timestamp() if p.last_seen_at else 0.0
            return (p.user.id != viewer.user_id, rank.get(p.role or "", 2), -seen)

        people = sorted(await auth.people(), key=order)
        return people, {p.user.id: p for p in people}

    async def people_page(request: Request) -> Response:
        viewer = await owner(request)
        event = await event_of(request)
        zone, name = (event.time_zone, event.name) if event else ("UTC", None)
        people, by_id = await everyone(viewer)
        params = dict(request.query_params)
        query, role = params.get("q", "").strip()[:100], params.get("role", "")
        role = role if role in {v for v, _ in FILTERS} else ""
        others = [p for p in people if p.user.id != viewer.user_id]
        names = {u.id: u.name for u, _ in await auth.users()} if "removed" in params else {}
        notes = _changed_notice(by_id, names, params)
        event_name = esc(name or "the event")
        description = f"Who may open which pages of {event_name}. A role change applies at once."
        script = f'<script src="{BASE}/static/people.js" defer></script>'
        if not others:
            body = (
                '<section class="canccu-card">'
                + empty_state(
                    "users",
                    "Only you so far",
                    "People get a role here after they sign in once with Discord."
                    " Send them the sign-in link.",
                    COPY,
                )
                + "</section>"
            )
            return await page(
                request,
                "People",
                notes + body + script,
                session=viewer,
                current="people",
                description=description,
                actions=COPY,
            )
        counts = {
            v: sum(1 for p in people if not v or _role_value(p.role) == v) for v, _ in FILTERS
        }
        chips = "".join(
            f'<a class="canccu-chip" href="{esc(_query(q=query, role=v))}"'
            + (' aria-current="true"' if v == role else "")
            + f">{label} {counts[v]}</a>"
            for v, label in FILTERS
            if counts[v] or not v
        )
        search = (
            f'<form method="get" action="{PEOPLE}" role="search" class="canccu-people__search">'
            f'<input class="canccu-input" type="search" name="q" value="{esc(query)}"'
            f' placeholder="Search {len(people)} people" aria-label="Search people">'
            + (f'<input type="hidden" name="role" value="{esc(role)}">' if role else "")
            + f'</form><nav class="canccu-chips canccu-chips--scroll" aria-label="Role">{chips}'
            "</nav>"
        )
        shown = [p for p in people if _matches(p, query, role)]
        every = params.get("show") == "all"
        now = auth.now()
        rows = "".join(
            _row(p, p.user.id == viewer.user_id, last_here(p.last_seen_at, now, zone))
            for p in (shown if every else shown[:PAGE_SIZE])
        )
        if not shown:
            table = empty_state("users", "No one matches", "Try another name or role.")
        else:
            table = (
                '<table class="canccu-table canccu-people"><thead><tr><th>Who</th><th>Role</th>'
                f"<th>Last here</th><th></th></tr></thead><tbody>{rows}</tbody></table>"
            )
        more = len(shown) - PAGE_SIZE
        if every and len(shown) > PAGE_SIZE:
            foot = (
                f'<p class="canccu-people__end">All {len(shown)} people shown ·'
                ' <a href="#top">Back to top</a></p>'
            )
        elif more > 0:
            href = esc(_query(q=query, role=role, show="all"))
            foot = (
                f'<p class="canccu-people__end">{more} more people · <a href="{href}">Show</a></p>'
            )
        else:
            foot = ""
        body = (
            f'{notes}<div id="top">{search}</div>'
            f'<section class="canccu-card canccu-card--flush">{table}</section>{foot}{script}'
        )
        return await page(
            request,
            "People",
            body,
            session=viewer,
            current="people",
            description=description,
            actions=COPY,
        )

    async def person_page(request: Request) -> Response:
        viewer = await owner(request)
        _, by_id = await everyone(viewer)
        person = by_id.get(str(request.path_params["user_id"]))
        if person is None:
            raise UnknownUser("no such person")
        event = await event_of(request)
        zone, name = (event.time_zone, event.name) if event else ("UTC", None)
        user = person.user
        seen = last_here(person.last_seen_at, auth.now(), zone)
        handle = " · ".join(x for x in (user.handle, f"last here {seen}") if x)
        remove = _remove_link(person, f"Remove from {name or 'the event'}…")
        body = (
            '<section class="canccu-card canccu-person">'
            f'<div class="canccu-user"><span class="canccu-avatar" aria-hidden="true">'
            f'{esc(initials(user.name))}</span><span class="canccu-people__names">'
            f"<b>{esc(user.name)}</b>"
            f'<span class="canccu-people__handle">{esc(handle)}</span></span></div>'
            f'<p class="canccu-field__label">Role</p>{role_control(person)}'
            f'<p class="canccu-muted">{ALLOWS[person.role]}</p>'
            + (f'<p class="canccu-person__remove">{remove}</p>' if remove else "")
            + "</section>"
        )
        return await page(
            request,
            "Person",
            body,
            session=viewer,
            current="people",
            crumb=(PEOPLE, "People"),
            narrow=True,
        )

    async def save_role(request: Request) -> Response:
        viewer = await owner(request)
        user_id = str(request.path_params["user_id"])
        form = await request.form()
        role = str(form.get("role", ""))
        found = await auth.store.get_role(user_id)
        old = _role_value(found[1]) if found else "none"
        event = await auth.set_role(user_id, None if role == "none" else role, viewer.user_id)
        if on_event is not None:
            # Drops this process's cached rights for that user at once (contracts/admin.md).
            await on_event(event)
        if form.get("undo"):
            return RedirectResponse(PEOPLE, status_code=303)
        return RedirectResponse(_query(changed=user_id, **{"from": old}), status_code=303)

    async def ask_remove(request: Request) -> Response:
        viewer = await owner(request)
        _, by_id = await everyone(viewer)
        person = by_id.get(str(request.path_params["user_id"]))
        if person is None or person.role == "owner":
            raise UnknownUser("no such person")
        event = await event_of(request)
        name = esc(event.name if event and event.name else "the event")
        who = esc(person.user.name)
        lose = (
            f"lose their {ROLE_NAMES[person.role]} role in {name}"
            if person.role
            else f"leave People of {name}"
        )
        body = (
            '<section class="canccu-card canccu-confirm">'
            f'<h2 class="canccu-card__title">Remove {who}?</h2>'
            f"<p>They are signed out at once and {lose}. Their past changes stay in the history."
            '</p><p class="canccu-muted">They can sign in again and ask for a role.</p>'
            f'<form method="post" class="canccu-cluster"><a class="canccu-button '
            f'canccu-button--secondary" href="{PEOPLE}">Keep them</a>'
            f'<button class="canccu-button canccu-button--danger">{icon("out")}Remove {who}'
            "</button></form></section>"
        )
        return await page(
            request,
            f"Remove {person.user.name}",
            body,
            session=viewer,
            current="people",
            crumb=(PEOPLE, "People"),
            narrow=True,
        )

    async def remove(request: Request) -> Response:
        viewer = await owner(request)
        user_id = str(request.path_params["user_id"])
        event = await auth.remove(user_id, viewer.user_id)
        if on_event is not None:
            await on_event(event)
        return RedirectResponse(_query(removed=user_id), status_code=303)

    return [
        Route("/people", people_page, methods=["GET"]),
        Route("/people/{user_id}", person_page, methods=["GET"]),
        Route("/people/{user_id}", save_role, methods=["POST"]),
        Route("/people/{user_id}/remove", ask_remove, methods=["GET"]),
        Route("/people/{user_id}/remove", remove, methods=["POST"]),
    ]
