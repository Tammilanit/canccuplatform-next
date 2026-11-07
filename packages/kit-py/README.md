# canccu-kit (Python)

Shared plumbing for platform modules, following [contracts/admin.md](../../contracts/admin.md) and [contracts/tenants.md](../../contracts/tenants.md): event bus, `/health`, settings client, rights check, error body, JSON logging and tenancy. The core has no web framework; `canccu_kit.starlette` is a small adapter for Starlette and FastAPI.

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
    tenant_scope,
    valkey_check,
)

config = load_config()
log = create_logger(config.module)  # JSON lines on stdout
store = ValkeyStreamStore.from_url(config.valkey_url)
bus = Bus(store, config.module)
admin = AdminClient(config.admin_url)

# Bus: publish a tenant event to t:<tenant>:events:<module> (trimmed to ~10000 entries)
with tenant_scope("demo"):
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

## Tenancy
Every event is a tenant on one shared stack ([0013](../../docs/decisions/0013-multi-tenant-core.md), [contracts/tenants.md](../../contracts/tenants.md)). The kit makes a module tenant-safe by construction: everything that stores or reads data needs a tenant, and it comes only from the request's hostname or the bus message.
```python
import os

from canccu_kit import TenantResolver, check_info_access, tenant_transaction
from canccu_kit.starlette import install, install_tenancy

own_hosts = ("CANCCU_SIGNIN_HOSTNAME", "CANCCU_SUPERADMIN_HOSTNAME")
tenants = TenantResolver(
    os.environ["CANCCU_TENANTS_URL"],
    platform_hosts=[os.environ[name] for name in own_hosts if os.environ.get(name)],
)
install(app, health)
# request.state.tenant + tenant_scope for the whole request; /health is exempt
install_tenancy(app, tenants)


async def menu(request):
    check_info_access(request.state.tenant, client_ip=client_ip(request), viewer="guest")  # 403
    async with pool.acquire() as conn, tenant_transaction(conn):  # RLS sees only this tenant
        return JSONResponse([dict(r) for r in await conn.fetch("SELECT * FROM pizza_menu")])


# Consumers: every tenant's t:<tenant>:events:pizza, new tenants without a restart;
# the handler runs in event.tenant (current_tenant() == event.tenant)
bus.subscribe_tenants(["pizza"], on_pizza_event)
bus.subscribe(["tenants"], drop_cache)  # async def drop_cache(event): tenants.handle_event(event)
```
- **Context:** `with tenant_scope(id):`, `current_tenant()`, `require_tenant()` (raises `NoTenant`, a bug, never a user error). A ContextVar: tasks started inside the block keep the tenant.
- **Postgres:** `async with tenant_transaction(conn[, tenant])` (any asyncpg-shaped connection) sets the tenant with `set_config('canccu.tenant', id, true)` (SET LOCAL) inside one transaction, never per connection. Migrations write `TENANT_COLUMN_SQL` (the column defaults to the setting) and `rls_sql(table)` (RLS enabled, forced, and the policy); with no tenant set a query sees nothing and an insert fails. `check_app_role(conn)` refuses to start as a superuser or BYPASSRLS role, which RLS does not bind. `scripts/check-tenancy` lints the migrations ([docs/ci.md](../../docs/ci.md#tenancy)).
- **Names:** `tenant_stream(module)` → `t:<tenant>:events:<module>`, `platform_stream(module)` → `events:<module>`, `tenant_key(module, *parts)` → `t:<tenant>:<module>:…`, `tenant_file(module, path)` → `/files/<tenant>/<module>/<path>` (refuses `..`), `platform_files_dir(module)` → `/files/_platform/<module>/`. Modules spell no raw keys.
- **Bus:** `publish` uses the current tenant (or `tenant=`); without one it raises `NoTenant`. Platform events need `platform=True`, and only a module whose contract says so emits them. A consumer drops a message whose `tenant` does not match its stream.
- **Resolution:** `TenantResolver` asks `GET /internal/tenants/resolve?host=` and caches the answer, for at most 10,000 hosts, for 30 s or until a tenants event (any tenants event also drops cached unknown hosts). An unknown host is 404 `not_found` with no detail; the platform's own hostnames resolve to `Resolution("platform", host=…)` (the middleware answers 404 unless `platform_hosts="serve"`). The IP-mode demo stack (`ip_mode=IpMode(...)`) serves only the `demo` tenant, only on an IP literal and only while the version is `dev`. Env: `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`.
- **Access:** `check_screen_access` (device token **and** the venue address, unless the emergency switch is off until `disabled_until`; 401 `device_token_invalid`, 403 `venue_ip_mismatch`), `new_device_token`, `hash_device_token` and `device_token_matches` (store only the hash), `check_info_access` (the info-page mode), `check_admin_access` (`admin_access`: venue or Tailscale, `CANCCU_TAILSCALE_CIDRS`). `client_ip` is the address Caddy forwards (trust only Caddy as a proxy).
- **Leak tests** (`canccu_kit.testing`): `assert_tenant_isolation(probe)` seeds a marker per tenant and fails with `TenantLeak` if one tenant reads the other's, or if a tenant cannot read its own (the test would prove nothing). For a consumer, seed with `deliver_as(handler, tenant_event(tenant, type, data))`.

## No state
The kit writes nothing to disk. Its only in-memory items are the rights cache (≤ 30 s per session), the current settings, the tenant resolver's cache (≤ 30 s per host) and the bus's dedupe list of recent event ids and stream positions. Sessions live in admin (Postgres) and events in Valkey.

## Tests for modules
`canccu_kit.testing.MemoryStreamStore` is an in-memory `StreamStore` that records every `xadd` call.

## Check
```sh
pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy . && pytest
```
CI runs `ruff check .`, `mypy .` and `pytest` (job `lint-types-test (kit-py)`).

## Integration test
The store and bus run against the real Valkey from the Compose stack: publish with MAXLEN (exact and `~`), subscribe, dedupe of an entry added twice, and tenant streams found by `scan` and read per tenant. Row-level security runs against the real Postgres, as a plain app role the test creates (a superuser bypasses RLS); its role and table names differ from the kit-ts test, so both can share one database. Each test is skipped unless `CANCCU_VALKEY_URL` or `CANCCU_DATABASE_URL` is set, so the check above stays offline.
```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait valkey postgres
CANCCU_VALKEY_URL=redis://127.0.0.1:6379 \
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu \
  pytest tests/test_valkey_integration.py tests/test_postgres_integration.py
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml down
```
`compose.test.yml` publishes Valkey and Postgres on `127.0.0.1` only. CI runs this as the `integration (kit)` job.
