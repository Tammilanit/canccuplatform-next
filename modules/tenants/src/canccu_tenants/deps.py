"""Everything a route needs, built once in main.py (or by the tests) and kept on `app.state`."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from canccu_kit import Bus
from starlette.requests import Request

from .caller import Caller
from .core import Files
from .db import Db

TxtLookup = Callable[[str], Awaitable[list[str]]]
"""TXT record values of a DNS name; [] when there is none."""


@dataclass
class Deps:
    db: Db
    bus: Bus
    caller: Caller
    files: Files
    declared_flags: dict[str, bool]
    txt_lookup: TxtLookup
    platform_domain: str | None
    reserved_hosts: frozenset[str]
    """The sign-in and superadmin hostnames: never registrable (409 `hostname_reserved`)."""


def deps(request: Request) -> Deps:
    value: Deps = request.app.state.deps
    return value


def load_flags(path: Path) -> dict[str, bool]:
    """`contracts/flags.yaml`: `flags: {<module>.<feature>: {default: bool}}`. A missing file
    declares no flags, so every flag is 400 `unknown_flag` until a module's contract adds one."""
    if not path.exists():
        return {}
    raw: Any = yaml.safe_load(path.read_text()) or {}
    flags = raw.get("flags") or {}
    return {str(name): bool((spec or {}).get("default", False)) for name, spec in flags.items()}


async def dns_txt(name: str) -> list[str]:
    import dns.asyncresolver
    import dns.exception

    try:
        answer = await dns.asyncresolver.resolve(name, "TXT")
    except dns.exception.DNSException:
        return []
    return [b"".join(r.strings).decode("utf-8", "replace") for r in answer]
