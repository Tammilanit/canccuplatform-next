"""Shell commands, run with `docker compose exec admin python -m canccu_admin …`."""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from canccu_kit import Bus, ValkeyStreamStore, load_config

from . import dev_seed
from .db import PgStore
from .declarations import load_declarations
from .profile import make_validator
from .service import Service


async def seed(force: bool) -> str:
    config = load_config()
    database_url = os.environ.get("CANCCU_DATABASE_URL")
    if not database_url:
        raise SystemExit("missing environment variable(s): CANCCU_DATABASE_URL")
    # Refused before anything connects: outside dev mode the command touches nothing.
    if config.version != "dev":
        raise SystemExit(f"refused: CANCCU_VERSION is {config.version}, not dev: nothing changed")
    store = await PgStore.connect(
        database_url, migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None
    )
    try:
        contracts = Path(os.environ.get("CANCCU_CONTRACTS_DIR", "/repo/contracts"))
        service = Service(
            store=store,
            bus=Bus(ValkeyStreamStore.from_url(config.valkey_url), config.module),
            validator=make_validator(contracts / "profile.schema.json"),
            files_root=Path(os.environ.get("CANCCU_FILES_ROOT", "/files")),
            declarations=load_declarations(
                Path(os.environ.get("CANCCU_DECLARATIONS_DIR", "declarations"))
            ),
        )
        source = Path(os.environ.get("CANCCU_DEMO_EVENT_DIR", "/repo/events/demo"))
        return await dev_seed.seed_demo_profile(service, source, config.version, force=force)
    except dev_seed.Refused as exc:
        raise SystemExit(f"refused: {exc}") from exc
    finally:
        await store.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m canccu_admin")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser(
        "dev-seed",
        help="dev mode only: load events/demo's profile and assets into the demo event",
    )
    cmd.add_argument(
        "--force", action="store_true", help="load it even over changes made by hand (a reset)"
    )
    args = parser.parse_args()
    print(asyncio.run(seed(args.force)))


if __name__ == "__main__":
    main()
