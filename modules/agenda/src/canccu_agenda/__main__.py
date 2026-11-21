"""Shell commands, run with `docker compose exec agenda python -m canccu_agenda …`."""

from __future__ import annotations

import argparse
import asyncio
import os

from canccu_kit import (
    DEMO_TENANT,
    AdminClient,
    Bus,
    ConfigError,
    RightsChecker,
    ServiceIdentity,
    SettingsClient,
    TenantResolver,
    ValkeyStreamStore,
    load_config,
    service_key_from_env,
)

from . import dev_seed, posts
from .db import Db
from .deps import Deps


async def seed(force: bool) -> str:
    config = load_config()
    # Refused before anything connects: outside dev mode the command touches nothing.
    if config.version != "dev":
        raise SystemExit(f"refused: CANCCU_VERSION is {config.version}, not dev: nothing changed")
    missing = [n for n in ("CANCCU_DATABASE_URL", "CANCCU_TENANTS_URL") if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"missing environment variable(s): {', '.join(missing)}")
    try:
        identity = ServiceIdentity(config.module, service_key_from_env())
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    event = await TenantResolver(os.environ["CANCCU_TENANTS_URL"], service=identity).by_id(
        DEMO_TENANT
    )
    if event is None:
        raise SystemExit("refused: there is no demo event: nothing changed")
    db = await Db.connect(
        os.environ["CANCCU_DATABASE_URL"],
        migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None,
    )
    try:
        bus = Bus(ValkeyStreamStore.from_url(config.valkey_url), config.module)
        admin = AdminClient(config.admin_url)
        d = Deps(
            db=db,
            bus=bus,
            rights=RightsChecker(admin),
            settings=SettingsClient(admin, config.module, service=identity),
            outbox=posts.Outbox(bus, db),
        )
        return await dev_seed.seed_demo_agenda(d, config.version, event["time_zone"], force=force)
    except dev_seed.Refused as exc:
        raise SystemExit(f"refused: {exc}") from exc
    finally:
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m canccu_agenda")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser(
        "dev-seed", help="dev mode only: give the demo event a run of show for today and tomorrow"
    )
    cmd.add_argument(
        "--force",
        action="store_true",
        help="replace the run of show even over changes made by hand (a reset)",
    )
    args = parser.parse_args()
    print(asyncio.run(seed(args.force)))


if __name__ == "__main__":
    main()
