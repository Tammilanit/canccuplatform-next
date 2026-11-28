"""The guard every send passes (port of the legacy `tourney_guard`; L3 of the step 6 plan).

Discord pings whoever a message names (`@everyone`, a role, a person) unless the message says
otherwise, and a player's name or a team's can hold any of them. So every body the bot sends
carries `allowed_mentions` that ping nobody; the one exception is an urgent announcement's role,
picked by the event and allowed for that send alone. Text built from other people's words keeps
only links to the event's own hosts; a link button keeps its provider's host, since the provider
sent it, not a player."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any
from urllib.parse import urlsplit

_URL = re.compile(r"(?i)\b(?:[a-z][a-z0-9+.-]*)://[^\s<>()\[\]]+|\bwww\.[^\s<>()\[\]]+")


def guarded(body: dict[str, Any], *, role: str | None = None) -> dict[str, Any]:
    """`body` with mentions that ping nobody, or only `role`; what the body said is replaced."""
    allowed: dict[str, Any] = {"parse": []}
    if role is not None:
        allowed["roles"] = [role]
    return {**body, "allowed_mentions": allowed}


def is_event_url(url: str, hosts: Iterable[str]) -> bool:
    """An http(s) link whose host is one of the event's, port aside."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
    except ValueError:
        return False
    if parts.scheme.lower() not in ("http", "https") or parts.username is not None:
        return False
    return host in {h.lower() for h in hosts}


def strip_foreign_links(text: str, hosts: Iterable[str]) -> str:
    """`text` without any link that is not on the event's hosts (#122's posts)."""
    own = list(hosts)
    return _URL.sub(lambda m: m.group(0) if is_event_url(m.group(0), own) else "", text)
