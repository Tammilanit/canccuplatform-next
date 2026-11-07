"""Entry point: `python -m canccu_tenants.main` serves on port 8080; `python -m canccu_tenants`
runs the shell commands (seed-demo, superadmin add)."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

import uvicorn
from canccu_kit import (
    AdminClient,
    Bus,
    Event,
    Health,
    RightsChecker,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    valkey_check,
)
from canccu_kit.resolve import normalize_host

from . import seed, timers
from .app import create_app
from .caller import Caller
from .core import Files
from .db import Db
from .deps import Deps, dns_txt, load_flags


@dataclass(frozen=True)
class Env:
    database_url: str
    superadmin_host: str | None
    signin_host: str | None
    platform_domain: str | None
    files_root: str
    flags_file: Path
    demo_profile: Path


def env() -> Env:
    url = os.environ.get("CANCCU_DATABASE_URL")
    if not url:
        raise SystemExit("missing environment variable(s): CANCCU_DATABASE_URL")

    def opt(name: str) -> str | None:
        return normalize_host(os.environ.get(name))

    return Env(
        database_url=url,
        superadmin_host=opt("CANCCU_SUPERADMIN_HOSTNAME"),
        signin_host=opt("CANCCU_SIGNIN_HOSTNAME"),
        platform_domain=opt("CANCCU_PLATFORM_DOMAIN"),
        files_root=os.environ.get("CANCCU_FILES_ROOT", "/files"),
        flags_file=Path(os.environ.get("CANCCU_FLAGS_FILE", "/repo/contracts/flags.yaml")),
        demo_profile=Path(os.environ.get("CANCCU_DEMO_PROFILE", "/repo/events/demo/profile.yaml")),
    )


async def serve() -> None:
    config = load_config()
    create_logger(config.module)
    e = env()
    db = await Db.connect(e.database_url)
    files = Files(e.files_root)
    if os.environ.get("CANCCU_SEED_DEMO") == "1":
        await seed.seed_demo(db, files, e.demo_profile, e.platform_domain)
    streams = ValkeyStreamStore.from_url(config.valkey_url)
    bus = Bus(streams, config.module)
    rights = RightsChecker(AdminClient(config.admin_url))
    platform_hosts = [h for h in (e.signin_host, e.superadmin_host) if h]
    d = Deps(
        db=db,
        bus=bus,
        caller=Caller(db, rights, e.superadmin_host),
        files=files,
        declared_flags=load_flags(e.flags_file),
        txt_lookup=dns_txt,
        platform_domain=e.platform_domain,
        reserved_hosts=frozenset(platform_hosts),
    )

    async def on_admin(event: Event) -> None:
        await rights.handle_event(event)  # a role change drops that user's cached session

    bus.subscribe(["admin"], on_admin)

    async def ping() -> None:
        async with db.platform() as conn:
            await conn.fetchval("SELECT 1")

    health = Health(
        config.module,
        config.version,
        {"postgres": postgres_check(ping), "valkey": valkey_check(streams)},
    )
    ip_mode = config.version == "dev" and os.environ.get("CANCCU_IP_MODE") == "demo"
    app = create_app(d, health, platform_hosts, config.version, ip_mode)
    timer = asyncio.create_task(timers.loop(d))
    # Caddy is the only proxy in front of this container (contracts/tenants.md, Access).
    trusted = os.environ.get("CANCCU_TRUSTED_PROXIES", "127.0.0.1")
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="0.0.0.0",
            port=8080,
            log_config=None,
            proxy_headers=True,
            forwarded_allow_ips=trusted,
        )
    )
    try:
        await server.serve()
    finally:
        timer.cancel()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
