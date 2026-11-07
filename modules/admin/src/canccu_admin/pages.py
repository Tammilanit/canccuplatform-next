"""The page frame shared by every server-rendered admin page."""

from __future__ import annotations

import html

from starlette.responses import HTMLResponse

BASE = "/admin"  # Caddy serves module pages under /admin/ and strips it
NAV = (
    ("settings", "Settings"),
    ("health-view", "Health"),
    ("profile", "Profile"),
    ("people", "People"),
)


def page(title: str, body: str, status: int = 200, *, nav: bool = True) -> HTMLResponse:
    links = " · ".join(f'<a href="{BASE}/{p}">{n}</a>' for p, n in NAV)
    sign_out = (
        f"<form method=post action={BASE}/sign-out style='display:inline'>"
        " · <button>Sign out</button></form>"
    )
    header = f"<nav>{links}{sign_out}</nav>" if nav else ""
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
        f"<body style='font-family:sans-serif;max-width:48rem;margin:2rem auto'>"
        f"{header}<h1>{html.escape(title)}</h1>{body}</body>",
        status_code=status,
    )
