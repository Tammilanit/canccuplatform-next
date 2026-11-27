"""Entry point: `python -m canccu_bot.main` serves on port 8080 and runs the client pool in the
same container (one container for the API and the gateway, O2 of the step 6 plan)."""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import socket
from typing import Any

import httpx
import uvicorn
from canccu_kit import (
    AdminClient,
    Bus,
    ConfigError,
    Event,
    Health,
    IpMode,
    RightsChecker,
    SecretBox,
    ServiceIdentity,
    TenantResolver,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    service_key_from_env,
    valkey_check,
)

from . import store
from .app import create_app
from .checks import discord_checks
from .client import DiscordClient
from .config import DiscordConfig, discord_config
from .db import Db
from .deps import Deps
from .lease import ValkeyKeys
from .pool import Pool
from .status import ClientEvents, StatusBoard
from .transport import connect_gateway

log = logging.getLogger("canccu_bot.main")

INTENTS = 1  # GUILDS. The feeds' intents and their flags come with the guild binding (link 2).


def settings() -> tuple[Any, DiscordConfig, ServiceIdentity, SecretBox]:
    config = load_config()
    create_logger(config.module)
    missing = [n for n in ("CANCCU_DATABASE_URL", "CANCCU_TENANTS_URL") if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"missing environment variable(s): {', '.join(missing)}")
    try:
        return (
            config,
            discord_config(os.environ),
            ServiceIdentity(config.module, service_key_from_env()),
            SecretBox.from_env(),
        )
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc


async def serve() -> None:
    config, discord, identity, box = settings()
    # The stack logs in as a plain role and migrates as the migration role (0013 item 5).
    db = await Db.connect(
        os.environ["CANCCU_DATABASE_URL"],
        migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None,
    )
    streams = ValkeyStreamStore.from_url(config.valkey_url)
    bus = Bus(streams, config.module)
    keys = ValkeyKeys.from_url(config.valkey_url)
    board = StatusBoard(keys)
    rights = RightsChecker(AdminClient(config.admin_url))
    own_hosts = ("CANCCU_SIGNIN_HOSTNAME", "CANCCU_SUPERADMIN_HOSTNAME")
    ip_mode = config.version == "dev" and os.environ.get("CANCCU_IP_MODE") == "demo"
    resolver = TenantResolver(
        os.environ["CANCCU_TENANTS_URL"],
        platform_hosts=[os.environ[n] for n in own_hosts if os.environ.get(n)],
        ip_mode=IpMode(config.version) if ip_mode else None,
        service=identity,
    )

    async def on_admin(event: Event) -> None:
        await rights.handle_event(event)

    async def on_tenants(event: Event) -> None:
        resolver.handle_event(event)  # a status change (archived) reaches the next request

    bus.subscribe(["admin"], on_admin)
    bus.subscribe(["tenants"], on_tenants)
    bus.subscribe_tenants(["tenants"], on_tenants)

    events = ClientEvents(bus, lambda app_id: store.tenants_served(db, app_id))
    reports: set[asyncio.Task[None]] = set()

    async def report(client: DiscordClient) -> None:
        try:
            await board.publish(client.application_id, client.status, client.bot_user)
            await events.changed(client.application_id, client.status)
        except Exception:
            log.exception("reporting the status of application %s failed", client.application_id)

    def on_status(client: DiscordClient) -> None:
        task = asyncio.create_task(report(client))
        reports.add(task)
        task.add_done_callback(reports.discard)

    async def on_dispatch(event: str, data: dict[str, Any]) -> None:
        # Nothing is stored yet: routing by guild to its event comes with the binding (link 2).
        return None

    async def open_client(application_id: str, token: str) -> DiscordClient:
        return DiscordClient(
            application_id,
            token,
            http=httpx.AsyncClient(timeout=15.0),
            api_url=discord.api_url,
            connector=connect_gateway,
            intents=INTENTS,
            on_status=on_status,
            on_dispatch=on_dispatch,
        )

    async def wanted() -> dict[str, str]:
        tokens = await store.own_applications(db, box)
        if discord.shared is not None:  # the contract refuses it as an own application anyway
            tokens[discord.shared.application_id] = discord.shared.token
        return tokens

    pool = Pool(
        holder=f"{socket.gethostname()}-{secrets.token_hex(4)}",
        keys=keys,
        board=board,
        wanted=wanted,
        open_client=open_client,
    )
    running = asyncio.create_task(pool.run())

    async def ping() -> None:
        async with db.platform() as conn:
            await conn.fetchval("SELECT 1")

    shared_id = None if discord.shared is None else discord.shared.application_id
    checks = discord_checks(board, shared_id, lambda: store.own_application_ids(db))
    health = Health(
        config.module,
        config.version,
        {"postgres": postgres_check(ping), "valkey": valkey_check(streams), **checks},
    )
    d = Deps(db=db, rights=rights, board=board, shared=discord.shared, secrets=box)
    app = create_app(d, health, resolver)
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
        await pool.close()  # hands the leases over at once instead of after 30 s
        running.cancel()
        await events.close()
        await keys.close()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
