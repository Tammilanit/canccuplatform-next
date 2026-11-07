"""Entry point: wires Postgres, Valkey and the kit, then serves on port 8080."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

import uvicorn
from canccu_kit import (
    AdminClient,
    Bus,
    Health,
    RightsChecker,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    valkey_check,
)

from .app import create_app
from .auth import Auth, normalize_public_url
from .auth_db import PgAuthStore
from .auth_routes import CALLBACK_PATH
from .db import PgStore
from .declarations import load_declarations
from .discord import Discord
from .profile import make_validator
from .service import Service


def parse_targets(raw: str) -> dict[str, str]:
    """`hello=http://hello:8080/health,...` -> {module: url}."""
    pairs = (item.split("=", 1) for item in raw.split(",") if item.strip())
    return {name.strip(): url.strip() for name, url in pairs}


def public_url() -> str | None:
    """CANCCU_PUBLIC_URL: where browsers reach the platform; every absolute URL comes from it."""
    raw = os.environ.get("CANCCU_PUBLIC_URL", "").strip()
    if not raw:
        return None
    try:
        return normalize_public_url(raw)
    except ValueError as exc:
        raise SystemExit(f"CANCCU_PUBLIC_URL {raw!r}: {exc}") from exc


def discord(public: str | None) -> Discord | None:
    client_id = os.environ.get("CANCCU_DISCORD_CLIENT_ID", "").strip()
    secret = os.environ.get("CANCCU_DISCORD_CLIENT_SECRET", "").strip()
    if client_id and secret and public:
        return Discord(client_id, secret, f"{public}{CALLBACK_PATH}")
    logging.getLogger("canccu.admin").warning(
        "Discord sign-in is off: it needs CANCCU_DISCORD_CLIENT_ID, CANCCU_DISCORD_CLIENT_SECRET"
        " and CANCCU_PUBLIC_URL"
    )
    return None


async def serve() -> None:
    config = load_config()
    create_logger(config.module)
    database_url = os.environ.get("CANCCU_DATABASE_URL")
    if not database_url:
        raise SystemExit("missing environment variable(s): CANCCU_DATABASE_URL")
    public = public_url()
    store = await PgStore.connect(database_url)
    streams = ValkeyStreamStore.from_url(config.valkey_url)
    bus = Bus(streams, config.module)
    rights = RightsChecker(AdminClient(config.admin_url))
    auth = Auth(
        await PgAuthStore.create(store.pool),
        bus,
        public,
        discord(public),
        on_session_end=rights.forget_session,
    )
    await auth.issue_first_run_code()
    contracts = Path(os.environ.get("CANCCU_CONTRACTS_DIR", "/repo/contracts"))
    service = Service(
        store=store,
        bus=bus,
        validator=make_validator(contracts / "profile.schema.json"),
        event_dir=Path(os.environ.get("CANCCU_EVENT_DIR", "/files/event")),
        declarations=load_declarations(
            Path(os.environ.get("CANCCU_DECLARATIONS_DIR", "declarations"))
        ),
        health_targets=parse_targets(os.environ.get("CANCCU_HEALTH_TARGETS", "")),
    )
    health = Health(
        config.module,
        config.version,
        {
            "postgres": postgres_check(store.ping),
            "valkey": valkey_check(streams),
        },
    )
    # Admin checks its own pages through the kit like any module, so CI's session stub
    # (deploy/compose.ci.yml) can stand in for it; its own role changes and ended sessions
    # drop the cache at once.
    app = create_app(service, health, rights.check, auth, rights.handle_event)
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=8080, log_config=None))
    await server.serve()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
