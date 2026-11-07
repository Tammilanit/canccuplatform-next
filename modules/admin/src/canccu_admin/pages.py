"""The page frame shared by every server-rendered admin page."""

from __future__ import annotations

import html

from canccu_kit.rights import Session
from starlette.responses import HTMLResponse

BASE = "/admin"  # Caddy serves module pages under /admin/ and strips it
# (path, label, the right the page needs): a link the user cannot follow is not shown.
NAV = (
    ("settings", "Settings", "admin.settings.read"),
    ("health-view", "Health", "admin.settings.read"),
    ("profile", "Profile", "admin.profile.read"),
    ("people", "People", "admin.rights.write"),
)
SIGN_OUT = (
    f"<form method=post action={BASE}/sign-out style='display:inline'>"
    "<button>Sign out</button></form>"
)


def page(
    title: str, body: str, status: int = 200, *, session: Session | None = None
) -> HTMLResponse:
    """A page; with a session it gets the navigation that session may follow."""
    header = ""
    if session is not None:
        links = [f'<a href="{BASE}/{p}">{n}</a>' for p, n, right in NAV if session.has(right)]
        header = f"<nav>{' · '.join([*links, SIGN_OUT])}</nav>"
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
        f"<body style='font-family:sans-serif;max-width:48rem;margin:2rem auto'>"
        f"{header}<h1>{html.escape(title)}</h1>{body}</body>",
        status_code=status,
    )
