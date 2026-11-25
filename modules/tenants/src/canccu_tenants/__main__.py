"""Shell commands, run with `docker compose exec tenants python -m canccu_tenants …`."""

from __future__ import annotations

import argparse
import asyncio
import os

from canccu_kit import Bus, ValkeyStreamStore, load_config
from canccu_kit.access import tailscale_cidrs

from . import dev_seed, seed
from .core import Files
from .db import Db
from .deps import load_flags
from .main import env


async def dev_hostnames(db: Db, hosts: list[str]) -> str:
    config = load_config()
    e = env()
    bus = Bus(ValkeyStreamStore.from_url(config.valkey_url), config.module)
    reserved = frozenset(h for h in (e.signin_host, e.superadmin_host) if h)
    changed = await dev_seed.dev_hostnames(
        db, bus, hosts, config.version, platform_domain=e.platform_domain, reserved=reserved
    )
    said = (
        "the demo event's dev hostnames: changed " + ", ".join(changed)
        if changed
        else "the demo event's dev hostnames are in place; nothing changed"
    )
    # In the same command, so the deploy's dev seed needs no step of its own (issues #733, #788).
    try:
        added = await dev_seed.dev_venue(db, bus, config.version, tailscale_cidrs())
        venue = (
            "the demo venue's addresses: added " + ", ".join(added)
            if added
            else "the demo venue's addresses are in place; nothing changed"
        )
    except dev_seed.LeftAlone as exc:
        venue = f"the demo venue's addresses: left alone: {exc}"
    turned = await dev_seed.dev_event(db, bus, config.version, load_flags(e.flags_file))
    event = (
        "the demo event's photo wall and Wi-Fi: set " + ", ".join(turned)
        if turned
        else "the demo event's photo wall and Wi-Fi are in place or set by hand; nothing changed"
    )
    return f"{said}\n{venue}\n{event}"


async def run(args: argparse.Namespace) -> str:
    e = env()
    # As the service does (main.py): the stack's login role is plain and may not migrate.
    db = await Db.connect(
        e.database_url, migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None
    )
    try:
        if args.command == "seed-demo":
            created = await seed.seed_demo(
                db, Files(e.files_root), e.demo_profile, e.platform_domain
            )
            return "demo tenant created" if created else "demo tenant exists; nothing changed"
        if args.command == "dev-hostnames":
            try:
                return await dev_hostnames(db, args.hosts)
            except dev_seed.Refused as exc:
                raise SystemExit(f"refused: {exc}") from exc
        user_id = await seed.add_superadmin(db, args.discord_id, args.name)
        return f"superadmin {user_id}; the superadmin paths open once sign-in reports Discord 2FA"
    finally:
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m canccu_tenants")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-demo", help="create the demo venue and the live demo tenant")
    dev = sub.add_parser(
        "dev-hostnames",
        help="dev mode only: the demo event answers on these hostnames, the first primary, and"
        " its venue takes the Tailscale prefixes",
    )
    dev.add_argument("hosts", nargs="+", metavar="HOST")
    superadmin = sub.add_parser("superadmin", help="superadmins")
    superadmin.add_argument("action", choices=["add"])
    superadmin.add_argument("--discord-id", required=True)
    superadmin.add_argument("--name", required=True)
    print(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
