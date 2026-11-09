"""Entry point: `python -m canccu_notify.main` serves on port 8080."""

from __future__ import annotations

import asyncio
import os

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
    SettingsClient,
    TenantResolver,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    service_key_from_env,
    valkey_check,
)

from . import config as topic_config
from . import consumer
from .app import create_app
from .db import Db
from .deps import Deps

# deploy/compose.yml's stand-in for CANCCU_SECRETS_KEY, so a dev stack starts without one.
PLACEHOLDER_SECRETS_KEY = "Y2FuY2N1LWxvY2FsLW9ubHktc2VjcmV0cy1rZXktMzI="


def secret_box(version: str) -> SecretBox:
    """Seals each event's check-in key (docs/plans/issue-188.md, D5)."""
    try:
        box = SecretBox.from_env()
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    if os.environ["CANCCU_SECRETS_KEY"].endswith(PLACEHOLDER_SECRETS_KEY) and version != "dev":
        raise SystemExit("CANCCU_SECRETS_KEY is the local placeholder; set a real key")
    return box


class TenantsAudit:
    """Appends to the tenants module's audit log, in the request that made the change."""

    def __init__(self, base_url: str, identity: ServiceIdentity) -> None:
        self.url = base_url.rstrip("/") + "/internal/tenants/audit"
        self.identity = identity
        self.http = httpx.AsyncClient(timeout=5.0)

    async def append(
        self, tenant_id: str, actor_user_id: str, action: str, target: dict[str, str]
    ) -> None:
        body = {
            "tenant_id": tenant_id,
            "module": "notify",
            "actor_user_id": actor_user_id,
            "action": action,
            "target": target,
        }
        response = await self.http.post(
            self.url, json=body, headers=self.identity.headers("tenants")
        )
        response.raise_for_status()


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
    box = secret_box(config.version)
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

    async def on_admin(event: Event) -> None:
        await rights.handle_event(event)

    async def on_tenants(event: Event) -> None:
        resolver.handle_event(event)  # a status change (archived) reaches the next request

    bus.subscribe(["admin"], on_admin)
    bus.subscribe(["tenants"], on_tenants)
    bus.subscribe_tenants(["tenants"], on_tenants)

    async def ping() -> None:
        async with db.platform() as conn:
            await conn.fetchval("SELECT 1")

    health = Health(
        config.module,
        config.version,
        {"postgres": postgres_check(ping), "valkey": valkey_check(streams)},
    )
    audit = TenantsAudit(os.environ["CANCCU_TENANTS_URL"], identity)
    d = Deps(
        db=db,
        bus=bus,
        rights=rights,
        settings=settings,
        audit=audit,
        secrets=box,
        tenants=resolver,
    )

    async def on_source(event: Event) -> None:
        await consumer.handle(d, event)

    async def on_admin_tenant(event: Event) -> None:
        await settings.handle_event(event)
        await topic_config.on_admin_event(d, event)

    bus.subscribe_tenants(["admin"], on_admin_tenant)
    bus.subscribe_tenants(consumer.SOURCES, on_source)
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
    await server.serve()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
