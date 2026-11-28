"""`python -m canccu_bot import-legacy`: the legacy bot import, run once by the operator at the
switch from inside the bot's container, which holds the database, Valkey and the secrets key
(README.md, The switch). Exit 0 when done or nothing changed, 1 on an error, 2 on a refusal; in
every case but 0 after a real run, nothing was written."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from canccu_kit import (
    Bus,
    ConfigError,
    KitError,
    Outbox,
    TenantResolver,
    ValkeyStreamStore,
)

from .access import TenantsAudit
from .config import Hosts
from .db import Db
from .deps import Deps
from .discord_api import DiscordApi
from .lease import ValkeyKeys
from .legacy_files import LegacyFileError, read
from .legacy_import import LegacyImportError, run_import
from .legacy_report import render
from .main import settings
from .status import StatusBoard
from .transport import connect_gateway


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m canccu_bot")
    commands = parser.add_subparsers(dest="command", required=True)
    one = commands.add_parser("import-legacy", help="import the legacy bot into one event")
    one.add_argument("--tenant", required=True, help="the event's tenant id")
    one.add_argument("--env", required=True, type=Path, help="the legacy bot's .env")
    one.add_argument("--state", required=True, type=Path, help="the legacy bot's data directory")
    one.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    return parser


async def _deps() -> tuple[Deps, list[Any]]:
    """The parts of the bot's Deps the import uses, from the container's environment; the others
    stay empty, since no request or client runs here."""
    config, discord, identity, box, _, _ = settings()
    url = os.environ["CANCCU_DATABASE_URL"]
    db = await Db.connect(url, migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None)
    keys = ValkeyKeys.from_url(config.valkey_url)
    tenants_url = os.environ["CANCCU_TENANTS_URL"]
    http = httpx.AsyncClient(timeout=15.0)
    d = Deps(
        db=db,
        rights=None,
        board=StatusBoard(keys),
        shared=discord.shared,
        secrets=box,
        discord=DiscordApi(http, discord.api_url),
        outbox=Outbox(Bus(ValkeyStreamStore.from_url(config.valkey_url), config.module), db),
        keys=keys,
        tenants=TenantResolver(tenants_url, platform_hosts=[], service=identity),
        users=None,
        audit=TenantsAudit(tenants_url, identity),
        hosts=Hosts(signin=None, superadmin=None, public_url=None),
        series=None,
    )
    return d, [db.close, keys.close, http.aclose]


async def _import(args: argparse.Namespace) -> int:
    legacy = read(args.env, args.state)
    try:
        d, closers = await _deps()
    except (OSError, asyncpg.PostgresError) as exc:
        raise LegacyImportError(f"cannot reach Postgres ({type(exc).__name__})") from None
    try:
        report = await run_import(d, args.tenant, legacy, connect_gateway, dry_run=args.dry_run)
    finally:
        for close in closers:
            await close()
    print(render(report))
    return 2 if report.refused is not None else 0


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return asyncio.run(_import(args))
    except (LegacyFileError, LegacyImportError, ConfigError, KitError, SystemExit) as exc:
        message = str(exc) if not isinstance(exc, SystemExit) else str(exc.code)
        print(f"error: {message}", file=sys.stderr)
        return 1
    except (OSError, httpx.HTTPError) as exc:
        print(f"error: a service did not answer ({type(exc).__name__})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
