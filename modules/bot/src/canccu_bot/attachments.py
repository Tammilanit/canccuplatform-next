"""A message's attachment, fetched for a command ("Send to the screen"). Only from Discord's own
file hosts, over https, and only as large as Screen takes a photo: the URL comes inside the
interaction, and a fetch to anywhere else would let a message point the bot into the stack's
network."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import httpx

from .framework import Refused, Unreachable

HOSTS = ("cdn.discordapp.com", "media.discordapp.net")
MAX_BYTES = 20 * 1024 * 1024


def is_picture(attachment: dict[str, Any]) -> bool:
    return str(attachment.get("content_type") or "").startswith("image/")


async def download(http: httpx.AsyncClient, attachment: dict[str, Any]) -> bytes:
    """The file's bytes; `Refused("file_too_large")` over the limit, `Unreachable` when the host
    does not give it."""
    url = str(attachment.get("url") or "")
    parts = urlsplit(url)
    if parts.scheme != "https" or (parts.hostname or "") not in HOSTS:
        raise Refused("media_unsupported")
    if int(attachment.get("size") or 0) > MAX_BYTES:
        raise Refused("file_too_large")
    try:
        response = await http.get(url, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise Unreachable() from exc
    if response.status_code != 200:
        raise Unreachable()
    if len(response.content) > MAX_BYTES:
        raise Refused("file_too_large")
    return response.content
