"""The tenant a piece of work runs for, and every name scoped by it: streams, Valkey keys, files.

0013 item 7, contracts/tenants.md. Modules build no raw keys or paths themselves.
"""

from __future__ import annotations

import posixpath
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

TENANT_ID_RE = re.compile(r"[a-z][a-z0-9-]{1,30}[a-z0-9]")
"""contracts/tenants.openapi.yaml, TenantId. No `_` or `:`, so `_platform` and key parts stay apart.

Always used with fullmatch: `$` would also accept a trailing newline.
"""

_MODULE_RE = re.compile(r"[a-z][a-z0-9_]*")
_KEY_PART_RE = re.compile(r"[^:\s]+")

FILES_ROOT = "/files"
PLATFORM_FILES_DIR = "_platform"
"""Global files of a module live outside every tenant's tree; `_` is not allowed in tenant ids."""

_tenant: ContextVar[str | None] = ContextVar("canccu_tenant", default=None)


class NoTenant(RuntimeError):
    """Work that needs a tenant ran without one: a bug in the module, never a user error."""

    def __init__(self) -> None:
        super().__init__("no tenant is set for this work (use tenant_scope)")


def is_tenant_id(value: str) -> bool:
    return TENANT_ID_RE.fullmatch(value) is not None


def _check_tenant_id(tenant: str) -> str:
    if not is_tenant_id(tenant):
        raise ValueError(f"invalid tenant id {tenant!r}")
    return tenant


def _check_module(module: str) -> str:
    if _MODULE_RE.fullmatch(module) is None:
        raise ValueError(f"invalid module {module!r}")
    return module


@contextmanager
def tenant_scope(tenant: str) -> Iterator[str]:
    """Run a block for `tenant`; everything it awaits, and tasks it starts, see the same tenant."""
    token = _tenant.set(_check_tenant_id(tenant))
    try:
        yield tenant
    finally:
        _tenant.reset(token)


def current_tenant() -> str | None:
    return _tenant.get()


def require_tenant() -> str:
    tenant = _tenant.get()
    if tenant is None:
        raise NoTenant()
    return tenant


def tenant_stream(module: str, tenant: str | None = None) -> str:
    """`t:<tenant>:events:<module>`: the stream of a tenant event (contracts/events.md)."""
    tenant = require_tenant() if tenant is None else tenant
    return f"t:{_check_tenant_id(tenant)}:events:{_check_module(module)}"


def platform_stream(module: str) -> str:
    """`events:<module>`: platform events, which concern no single tenant."""
    return f"events:{_check_module(module)}"


def tenant_key(module: str, *parts: str) -> str:
    """`t:<tenant>:<module>:<parts…>` for the current tenant: caches, locks, schedules."""
    _check_module(module)
    if module == "events":
        raise ValueError("t:<tenant>:events:… is reserved for streams")
    if not parts:
        raise ValueError("a key needs at least one part")
    for part in parts:
        if _KEY_PART_RE.fullmatch(part) is None:
            raise ValueError(f"invalid key part {part!r}")
    return f"t:{require_tenant()}:{module}:{':'.join(parts)}"


def tenant_files_dir(module: str, root: str = FILES_ROOT) -> str:
    """`/files/<tenant>/<module>/` for the current tenant."""
    tenant = require_tenant()
    return posixpath.normpath(posixpath.join(root, tenant, _check_module(module))) + "/"


def tenant_file(module: str, relative: str, root: str = FILES_ROOT) -> str:
    """A file inside the current tenant's tree; a path that could leave it is refused."""
    bad = (
        relative == ""
        or "\0" in relative
        or "\\" in relative
        or posixpath.isabs(relative)
        or ".." in relative.split("/")
    )
    if bad:
        raise ValueError(f"invalid file path {relative!r}")
    return posixpath.normpath(posixpath.join(tenant_files_dir(module, root), relative))


def platform_files_dir(module: str, root: str = FILES_ROOT) -> str:
    """`/files/_platform/<module>/`: a module's global files, e.g. venue floor plans."""
    return posixpath.normpath(posixpath.join(root, PLATFORM_FILES_DIR, _check_module(module))) + "/"
