"""Event pages: the CSP with a per-response nonce, and the origin check (contracts/theming.md, The
CSP of event pages and The sandbox; contracts/README.md, Conventions)."""

from __future__ import annotations

import base64
import re
import secrets
from typing import Literal
from urllib.parse import urlsplit

from .errors import KitError

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_NONCE_RE = re.compile(r"[A-Za-z0-9+/_-]{16,}={0,2}")
_HOST_RE = re.compile(r"[a-z0-9.-]+|[0-9a-f:.]+")
_SOURCE_RE = re.compile(r"https?://[A-Za-z0-9.:\[\]/_-]+")

Page = Literal["surface", "admin", "sign_in"]


class OriginRefused(KitError):
    status = 403
    code = "origin_refused"


def new_nonce() -> str:
    return base64.b64encode(secrets.token_bytes(16)).decode("ascii")


def event_page_csp(
    nonce: str, hostname: str, *, page: Page = "surface", sandbox: str | None = None
) -> str:
    """The policy of an HTML response on an event's hostname.

    Every argument lands in a header the browser parses, so anything that could end a directive
    or add a source is refused rather than escaped.
    """
    if _NONCE_RE.fullmatch(nonce) is None:
        raise ValueError("invalid nonce")
    if _HOST_RE.fullmatch(hostname) is None:
        raise ValueError(f"invalid hostname {hostname!r}")
    frame = sandbox if sandbox is not None else f"https://{hostname}/theming/sandbox/"
    if _SOURCE_RE.fullmatch(frame) is None:
        raise ValueError(f"invalid sandbox source {frame!r}")
    # Admin frames surface pages for its virtual-screen preview; admin and sign-in pages must
    # never be framed themselves (look-alike controls).
    frame_src = f"'self' {frame}" if page == "admin" else frame
    ancestors = "'self'" if page == "surface" else "'none'"
    return "; ".join(
        [
            "default-src 'none'",
            "script-src 'self'",
            f"style-src 'self' 'nonce-{nonce}'",
            "img-src 'self' data:",
            "font-src 'self'",
            "media-src 'self'",
            "connect-src 'self'",
            "manifest-src 'self'",
            "worker-src 'self'",
            f"frame-src {frame_src}",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'self'",
            f"frame-ancestors {ancestors}",
        ]
    )


def _host_of(value: str) -> str:
    return value.strip().lower().removesuffix(".")


def check_origin(
    method: str,
    path: str,
    origin: str | None,
    host: str | None,
    sec_fetch_site: str | None = None,
) -> None:
    """Refuse a sandbox document's API request and a state-changing request from another site.

    A request with neither Origin nor cross-site Fetch Metadata passes: that is a module or a
    script, not a browser page, and sign-in's CSRF rules (#52) cover the rest.
    """
    if origin == "null" and path.startswith("/api/"):
        raise OriginRefused("requests from a sandboxed document are refused")
    if method.upper() in SAFE_METHODS:
        return
    if origin is None:
        if (sec_fetch_site or "").lower() == "cross-site":
            raise OriginRefused("requests from another site are refused")
        return
    parsed = urlsplit(origin) if origin != "null" else None
    sent = _host_of(parsed.netloc) if parsed is not None else ""
    if not sent or sent != _host_of(host or ""):
        raise OriginRefused("requests from another site are refused")
