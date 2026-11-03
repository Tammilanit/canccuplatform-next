"""Entry point: wires Postgres, Valkey and the kit, then serves on port 8080."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import uvicorn
from cp_kit import (
    AdminClient,
    Bus,
    Health,
    RightsChecker,
    ValkeyStreamStore,
    load_config,
    postgres_check,
    valkey_check,
)

from .app import create_app
from .db import PgStore
from .declarations import load_declarations
from .profile import make_validator
from .service import Service


def parse_targets(raw: str) -> dict[str, str]:
    """`hello=http://hello:8080/health,...` -> {module: url}."""
    pairs = (item.split("=", 1) for item in raw.split(",") if item.strip())
    return {name.strip(): url.strip() for name, url in pairs}


async def serve() -> None:
    config = load_config()
    database_url = os.environ.get("CP_DATABASE_URL")
    if not database_url:
        raise SystemExit("missing environment variable(s): CP_DATABASE_URL")
    store = await PgStore.connect(database_url)
    streams = ValkeyStreamStore.from_url(config.valkey_url)
    contracts = Path(os.environ.get("CP_CONTRACTS_DIR", "/repo/contracts"))
    service = Service(
        store=store,
        bus=Bus(streams, config.module),
        validator=make_validator(contracts / "profile.schema.json"),
        event_dir=Path(os.environ.get("CP_EVENT_DIR", "/files/event")),
        declarations=load_declarations(Path(os.environ.get("CP_DECLARATIONS_DIR", "declarations"))),
        health_targets=parse_targets(os.environ.get("CP_HEALTH_TARGETS", "")),
    )
    health = Health(
        config.module,
        config.version,
        {
            "postgres": postgres_check(store.ping),
            "valkey": valkey_check(streams),
        },
    )
    rights = RightsChecker(AdminClient(config.admin_url))
    app = create_app(service, health, rights.check)
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=8080, log_config=None))
    await server.serve()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
