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
    Outbox,
    RightsChecker,
    SecretBox,
    ServiceIdentity,
    TenantResolver,
    ValkeyStreamStore,
    bot_admin_key_from_env,
    create_logger,
    load_config,
    postgres_check,
    service_key_from_env,
    valkey_check,
)

from . import commands, lifecycle, store
from .access import SeriesReader, TenantsAudit, UsersReader
from .acting import ActingClient, module_url
from .app import create_app
from .checks import discord_checks
from .client import DiscordClient
from .components import ComponentKeys
from .config import DiscordConfig, Hosts, discord_config
from .counting import Counting
from .db import Db
from .deps import Deps
from .discord_api import DiscordApi
from .feeds import Feeds
from .interactions import Interactions
from .lease import ValkeyKeys
from .live import ValkeyLive
from .look import EventLook
from .pool import Pool
from .router import INTENTS, Directory, Handler, Router
from .status import ClientEvents, StatusBoard
from .transport import connect_gateway

log = logging.getLogger("canccu_bot.main")


def settings() -> tuple[Any, DiscordConfig, ServiceIdentity, SecretBox, bytes, bytes | None]:
    config = load_config()
    create_logger(config.module)
    missing = [n for n in ("CANCCU_DATABASE_URL", "CANCCU_TENANTS_URL") if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"missing environment variable(s): {', '.join(missing)}")
    try:
        key = service_key_from_env()
        return (
            config,
            discord_config(os.environ),
            ServiceIdentity(config.module, key),
            SecretBox.from_env(),
            key,
            bot_admin_key_from_env(),
        )
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc


async def serve() -> None:
    config, discord, identity, box, service_key, bot_admin_key = settings()
    if bot_admin_key is None:
        log.warning("CANCCU_BOT_ADMIN_KEY is not set: commands cannot act for anyone")
    # The stack logs in as a plain role and migrates as the migration role (0013 item 5).
    db = await Db.connect(
        os.environ["CANCCU_DATABASE_URL"],
        migrate_url=os.environ.get("CANCCU_MIGRATE_DATABASE_URL") or None,
    )
    streams = ValkeyStreamStore.from_url(config.valkey_url)
    bus = Bus(streams, config.module)
    keys = ValkeyKeys.from_url(config.valkey_url)
    board = StatusBoard(keys)
    live = ValkeyLive.from_url(config.valkey_url)
    rights = RightsChecker(AdminClient(config.admin_url))
    hosts = Hosts(
        signin=os.environ.get("CANCCU_SIGNIN_HOSTNAME") or None,
        superadmin=os.environ.get("CANCCU_SUPERADMIN_HOSTNAME") or None,
        public_url=os.environ.get("CANCCU_PUBLIC_URL") or None,
    )
    ip_mode = config.version == "dev" and os.environ.get("CANCCU_IP_MODE") == "demo"
    tenants_url = os.environ["CANCCU_TENANTS_URL"]
    outside = httpx.AsyncClient(timeout=8.0)
    resolver = TenantResolver(
        tenants_url,
        platform_hosts=[h for h in (hosts.signin, hosts.superadmin) if h],
        ip_mode=IpMode(config.version) if ip_mode else None,
        service=identity,
    )
    d = Deps(
        db=db,
        rights=rights,
        board=board,
        shared=discord.shared,
        secrets=box,
        discord=DiscordApi(httpx.AsyncClient(timeout=15.0), discord.api_url),
        outbox=Outbox(bus, db),
        keys=keys,
        tenants=resolver,
        users=UsersReader(tenants_url, identity),
        audit=TenantsAudit(tenants_url, identity),
        hosts=hosts,
        series=SeriesReader(tenants_url),
        commands=commands.COMMANDS,
        components=ComponentKeys.from_service_key(service_key),
        # Below the framework's 10 s, so a slow module ends in its sentence, not in a hang.
        acting=ActingClient(config.admin_url, identity, bot_admin_key, outside),
        look=EventLook(tenants_url, module_url("theming"), identity, outside),
        http=outside,
        live=live,
    )
    directory = Directory(d)

    async def on_admin(event: Event) -> None:
        await rights.handle_event(event)

    async def on_platform(event: Event) -> None:
        resolver.handle_event(event)
        await lifecycle.on_platform(d, event)

    async def on_tenant(event: Event) -> None:
        resolver.handle_event(event)  # a status change (archived) reaches the next request
        await lifecycle.on_tenant(d, directory, event)

    bus.subscribe(["admin"], on_admin)
    bus.subscribe(["tenants"], on_platform)
    bus.subscribe_tenants(["tenants"], on_tenant)

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

    async def open_client(application_id: str, token: str) -> DiscordClient:
        holder: list[DiscordClient] = []
        interactions = Interactions(d, application_id, directory.context, lambda: holder[0].rest)
        feeds = Feeds(live, directory.context, d.hidden)
        handlers: dict[str, Handler] = {"interaction": interactions, **feeds.handlers()}
        router = Router(d, application_id, directory, handlers=handlers)
        # The counts run beside the client, so its lease keeps them in one container.
        ready = lambda: holder[0].status["status"] == "ready"  # noqa: E731
        counting = asyncio.create_task(
            Counting(d, feeds, directory, application_id, ready=ready).run()
        )

        def stop() -> None:
            router.close()
            interactions.close()
            counting.cancel()

        client = DiscordClient(
            application_id,
            token,
            http=httpx.AsyncClient(timeout=15.0),
            api_url=discord.api_url,
            connector=connect_gateway,
            intents=INTENTS,
            on_status=on_status,
            on_dispatch=router.dispatch,
            on_stop=stop,
        )
        holder.append(client)
        router.rest = client.rest
        return client

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
    sending = asyncio.create_task(d.outbox.run())  # what a write's own flush left

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
        sending.cancel()
        await events.close()
        await keys.close()
        await live.close()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
