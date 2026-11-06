# canccu-kit (Python)

Shared plumbing for platform modules, following [contracts/admin.md](../../contracts/admin.md): event bus, `/health`, settings client, rights check, error body and JSON logging. The core has no web framework; `canccu_kit.starlette` is a small adapter for Starlette and FastAPI.

## Install (from a module)
```toml
# modules/<name>/pyproject.toml
dependencies = ["canccu-kit[starlette] @ file:../../packages/kit-py"]
```
The kit reads `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL` and `CANCCU_ADMIN_URL`; `load_config()` stops at start and names any that is missing.

## Usage
```python
from canccu_kit import (
    AdminClient,
    Bus,
    Health,
    RightsChecker,
    SettingsClient,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    valkey_check,
)

config = load_config()
log = create_logger(config.module)  # JSON lines on stdout
store = ValkeyStreamStore.from_url(config.valkey_url)
bus = Bus(store, config.module)
admin = AdminClient(config.admin_url)

# Bus: publish to events:<module> (trimmed to ~10000 entries), subscribe to other modules' streams
await bus.publish("screen.slide.shown", {"slide": 3}, version=1)

# Settings: read once at start, then follow admin.settings.changed (never poll)
settings = SettingsClient(admin, config.module)
await settings.start()
rotation = settings.get("rotation_seconds", 10)

# Rights: checks the canccu_session cookie against GET /api/admin/session, cached ≤ 30 s
rights = RightsChecker(admin)


async def on_admin_event(event):
    await settings.handle_event(event)
    await rights.handle_event(event)  # drops the cache on admin.rights.changed


subscription = bus.subscribe(["admin"], on_admin_event)

# Health: the shared /health shape; 200 for ok/degraded, 503 for down
health = Health(
    config.module,
    config.version,
    {"valkey": valkey_check(store), "postgres": postgres_check(run_select_1)},
)
```

### Starlette / FastAPI
```python
from starlette.applications import Starlette
from canccu_kit.starlette import install, require_right, right_dependency

app = Starlette(routes=[...])
install(app, health)  # /health, error body for every non-2xx, X-Correlation-Id


@require_right(rights, "screen.slides.edit")  # Starlette endpoint
async def edit(request):
    user = request.state.session.user_id
    ...


# FastAPI: session: Session = Depends(right_dependency(rights, "screen.slides.edit"))
```
Raise `KitError("text", status=400, code="slide_invalid")` (or `MissingRight`, `NotSignedIn`, …) and the adapter answers `{"error": {"code", "message"}}`. Unexpected errors become 500 `internal_error`, with the details only in the log.

### Errors from admin
`SettingsClient.write` raises `VersionConflict` (409): read again and retry. An admin that can't be reached gives `AdminUnavailable` (503 `admin_unavailable`).

## No state
The kit writes nothing to disk. Its only in-memory items are the rights cache (≤ 30 s per session), the current settings and the bus's dedupe list of recent event ids. Sessions live in admin (Postgres) and events in Valkey.

## Tests for modules
`canccu_kit.testing.MemoryStreamStore` is an in-memory `StreamStore` that records every `xadd` call.

## Check
```sh
pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy . && pytest
```
CI runs `ruff check .`, `mypy .` and `pytest` (job `lint-types-test (kit-py)`).

## Integration test
The store and bus run against the real Valkey from the Compose stack: publish with MAXLEN (exact and `~`), subscribe, and dedupe of an entry added twice. The test is skipped unless `CANCCU_VALKEY_URL` is set, so the check above stays offline.
```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait valkey
CANCCU_VALKEY_URL=redis://127.0.0.1:6379 pytest tests/test_valkey_integration.py
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml down
```
`compose.test.yml` publishes Valkey on `127.0.0.1:6379` only. CI runs this as the `integration (kit)` job.
