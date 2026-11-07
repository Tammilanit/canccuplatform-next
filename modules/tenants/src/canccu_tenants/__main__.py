"""Shell commands, run with `docker compose exec tenants python -m canccu_tenants …`."""

from __future__ import annotations

import argparse
import asyncio

from . import seed
from .core import Files
from .db import Db
from .main import env


async def run(args: argparse.Namespace) -> str:
    e = env()
    db = await Db.connect(e.database_url)
    try:
        if args.command == "seed-demo":
            created = await seed.seed_demo(
                db, Files(e.files_root), e.demo_profile, e.platform_domain
            )
            return "demo tenant created" if created else "demo tenant exists; nothing changed"
        user_id = await seed.add_superadmin(db, args.discord_id, args.name)
        return f"superadmin {user_id}; the superadmin paths open once sign-in reports Discord 2FA"
    finally:
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m canccu_tenants")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-demo", help="create the demo venue and the live demo tenant")
    superadmin = sub.add_parser("superadmin", help="superadmins")
    superadmin.add_argument("action", choices=["add"])
    superadmin.add_argument("--discord-id", required=True)
    superadmin.add_argument("--name", required=True)
    print(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
