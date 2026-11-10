"""Entry point: `python -m canccu_agenda.main` serves on port 8080."""

from __future__ import annotations

import asyncio
import os

import uvicorn
from canccu_kit import (
    AdminClient,
    Bus,
    ConfigError,
    Event,
    Health,
    IpMode,
    Outbox,
    RightsChecker,
    ServiceIdentity,
    SettingsClient,
    TenantResolver,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    service_key_from_env,
    valkey_check,
)

from . import mirror, timers
from .app import create_app
from .db import Db
from .deps import Deps


async def serve() -> None:
    config = load_config()
    create_logger(config.module)
    missing = [n for n in ("CANCCU_DATABASE_URL", "CANCCU_TENANTS_URL") if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"missing environment variable(s): {', '.join(missing)}")
    try:
        identity = ServiceIdentity(config.module, service_key_from_env())
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    # The stack logs in as a plain role and migrates as the migration role (0013 item 5).
    db = await Db.connect(
        os.environ["CANCCU_DATABASE_URL"],
        migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None,
    )
    streams = ValkeyStreamStore.from_url(config.valkey_url)
    bus = Bus(streams, config.module)
    admin = AdminClient(config.admin_url)
    rights = RightsChecker(admin)
    settings = SettingsClient(admin, config.module, service=identity)
    own_hosts = ("CANCCU_SIGNIN_HOSTNAME", "CANCCU_SUPERADMIN_HOSTNAME")
    ip_mode = config.version == "dev" and os.environ.get("CANCCU_IP_MODE") == "demo"
    resolver = TenantResolver(
        os.environ["CANCCU_TENANTS_URL"],
        platform_hosts=[os.environ[n] for n in own_hosts if os.environ.get(n)],
        ip_mode=IpMode(config.version) if ip_mode else None,
        service=identity,
    )

    d = Deps(db=db, bus=bus, rights=rights, settings=settings, outbox=Outbox(bus, db))

    async def on_admin(event: Event) -> None:
        await rights.handle_event(event)

    async def on_tenants(event: Event) -> None:
        resolver.handle_event(event)  # a status change (archived) reaches the next request

    async def on_admin_tenant(event: Event) -> None:
        # The client reloads first, so the reschedule reads the new lead times; a short admin
        # outage is retried, since the bus does not redeliver a failed event.
        await mirror.retrying(lambda: settings.handle_event(event))
        await mirror.retrying(lambda: timers.on_settings_changed(d, event))

    async def on_tournament(event: Event) -> None:
        await mirror.handle(d, event)

    bus.subscribe(["admin"], on_admin)
    bus.subscribe(["tenants"], on_tenants)
    bus.subscribe_tenants(["tenants"], on_tenants)
    bus.subscribe_tenants(["admin"], on_admin_tenant)
    # From the start of each stream: the tombstones and revisions make a replay change nothing,
    # and a session added while no container ran still gets its item.
    bus.subscribe_tenants(["tournament"], on_tournament, from_id="0")
    scheduler = asyncio.create_task(timers.run(d))
    sender = asyncio.create_task(d.outbox.run())

    async def ping() -> None:
        async with db.platform() as conn:
            await conn.fetchval("SELECT 1")

    health = Health(
        config.module,
        config.version,
        {"postgres": postgres_check(ping), "valkey": valkey_check(streams)},
    )
    app = create_app(d, health, resolver, identity)
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
        scheduler.cancel()
        sender.cancel()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
