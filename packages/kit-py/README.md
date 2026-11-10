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
    ServiceIdentity,
    SettingsClient,
    ValkeyStreamStore,
    create_logger,
    load_config,
    postgres_check,
    service_key_from_env,
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

# Settings, per tenant: read through admin's internal path on first use, then follow
# admin.settings.changed on admin's tenant streams (never poll)
service = ServiceIdentity(config.module, service_key_from_env())
settings = SettingsClient(admin, config.module, service=service)
with tenant_scope("demo"):
    await settings.ensure()
    rotation = settings.get("rotation_seconds", 10)

# Rights: checks the canccu_session cookie against GET /api/admin/session, cached ≤ 30 s;
# rights.forget_session(session_id) drops one session at once (admin calls it on sign-out)
rights = RightsChecker(admin)


async def on_admin_event(event):
    await settings.handle_event(event)
    await rights.handle_event(event)  # drops the cache on admin.rights.changed


subscription = bus.subscribe(["admin"], on_admin_event)
settings_subscription = bus.subscribe_tenants(["admin"], settings.handle_event)

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
Raise `KitError("text", status=400, code="slide_invalid")` (or `MissingRight`, `NotSignedIn`, …) and the adapter answers `{"error": {"code", "message"}}`. Unexpected errors become 500 `internal_error`, with the details only in the log. A module with pages passes `error_response=` (a function of the request and the `KitError`, answering a page or None for the JSON body) to both `install` and `install_tenancy`: the origin check and tenant resolution answer in middleware, before the app's exception handlers.

### Outbox
`Outbox(bus, db)` sends a write's events only once it has committed, and never loses them: `await outbox.add(conn, type, data, version=1)` inside the write's tenant transaction stores the event (built as `Bus.publish` would), `await outbox.flush()` after the commit sends it, and `outbox.run()` (a task in every container) sends what a failed flush left. `db` is the module's Db (`tenant()` and `platform()` transactions as its app role); the tables `<module>_outbox` and `<module>_outbox_tenants` are in the module's migrations, as the docstring of `outbox.py` shows. Delivery is at least once with the same event id, in order per tenant.

### Errors from admin
A person writes settings on admin's API. `SettingsClient.write(values, actor_user_id=…)` sets some of the module's own keys for the current tenant (`PATCH /internal/admin/settings/{module}`), only for settings its contract makes the same values as something it stores; a stale version raises `AdminError` `version_conflict`, and the caller reloads and decides again. An admin that can't be reached gives `AdminUnavailable` (503 `admin_unavailable`).

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
- **Bus:** `publish` uses the current tenant (or `tenant=`); without one it raises `NoTenant`. Platform events need `platform=True`, and only a module whose contract says so emits them. A consumer drops a message whose `tenant` does not match its stream. A handler that raises runs again in place, 500 ms later and doubling (up to 10 s), five times in all (`handler_tries=`, `retry_ms=`); then the event is logged as `event skipped after failed handler` and skipped, so one bad event cannot stop the stream. Later events of that subscription wait meanwhile, and a handler may see the same event more than once, so handlers must be idempotent.
- **Resolution:** `TenantResolver` (signed with `service=`) asks `GET /internal/tenants/resolve?host=` and caches the answer, for at most 10,000 hosts, for 30 s or until a tenants event (any tenants event also drops cached unknown hosts). An unknown host is 404 `not_found` with no detail; the platform's own hostnames resolve to `Resolution("platform", host=…)` (the middleware answers 404 unless `platform_hosts="serve"`). The IP-mode demo stack (`ip_mode=IpMode(version)`) serves only the `demo` tenant, only on an IP literal and only while the version is `dev`; it asks `GET /internal/tenants/ip-mode`, where the tenants module applies the only-tenant rule. `by_id(tenant_id)` asks `GET /internal/tenants/tenants/{tenant_id}` for another event's context in every status (`None` for an unknown id, that is a 404; any other failure is `TenantsUnavailable`, as in kit-ts), uncached, only for actions that span events. Env: `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`.
- **Access:** `check_screen_access` (device token **and** the venue address, unless the emergency switch is off until `disabled_until`; 401 `device_unknown`, 403 `venue_ip_refused`), `new_device_token`, `hash_device_token` and `device_token_matches` (store only the hash), `check_info_access` (the info-page mode), `check_admin_access` (`admin_access`: venue or Tailscale, `CANCCU_TAILSCALE_CIDRS`). `client_ip` is the address Caddy forwards (trust only Caddy as a proxy).
- **Leak tests** (`canccu_kit.testing`): `assert_tenant_isolation(probe)` seeds a marker per tenant and fails with `TenantLeak` if one tenant reads the other's, or if a tenant cannot read its own (the test would prove nothing). For a consumer, seed with `deliver_as(handler, tenant_event(tenant, type, data))`.

## Module-to-module identity
Calls to `/internal/…` paths carry `x-canccu-service: v1.<caller>.<audience>.<expires>.<HMAC>`, signed with the stack's `CANCCU_SERVICE_KEY` (at least 32 characters; a `local-only` placeholder runs only while the version is `dev`). Tokens live 60 s.
```python
service = ServiceIdentity(config.module, service_key_from_env())
headers = service.headers("tenants")  # for a call to the tenants module
install_service_identity(app, service, exempt=("/internal/tenants/ask",))  # 401 without a token
caller = request.state.service  # e.g. "screen"; service.require(value, allowed={"screen"}) → 403
# a module passes for its own rights; request.state.session is then None (Session | None)
@require_right(rights, "screen.slides.edit", service=service)
```
Every module holds the same key, so a token proves "a module of this stack", not which one against a compromised module; it keeps out everything else on the internal network and never sends the key. `TenantResolver(..., service=service)` and `SettingsClient` sign their calls.

## Secrets
`SecretBox.from_env()` reads `CANCCU_SECRETS_KEY` (`<version>:<base64 of 32 bytes>`) and `CANCCU_SECRETS_KEYS_RETIRED` (comma-separated, still opened). `seal(value, aad)` gives `cs1.<version>.<nonce>.<ciphertext>` (AES-256-GCM); `open(token, aad)` / `open_text` raise `SecretUndecryptable`; `needs_rotation` and `rotate` move a value to the current key. `from_env` refuses deploy/compose.yml's placeholder key, as current or retired key, unless `CANCCU_VERSION` is `dev`. `aad` binds a value to its row, e.g. `bot:token:<tenant>:<application id>`. kit-ts reads and writes the same format.

## Event pages
`event_page_csp(new_nonce(), hostname, page="surface"|"admin"|"sign_in", sandbox=None)` is the CSP of [contracts/theming.md](../../contracts/theming.md#the-csp-of-event-pages); give the same nonce to the page's `<style>`. `install()` adds the origin check: `Origin: null` on `/api/…` and a state-changing request from another origin (or cross-site with no Origin) get 403 `origin_refused`.

## Database roles
Modules log in as a plain role (no superuser, no BYPASSRLS, owns nothing) and run migrations as another role that owns the tables (0013 item 5). `check_login_role(conn)` refuses anything else; call it at start on a fresh connection, before SET ROLE. `run_migrations(conn, dir, ledger=, lock=, app_role=, grant_to=)` runs each new file once as the migration role and grants the module's app role to the login role. The whole run holds one platform-wide advisory lock (`PLATFORM_MIGRATION_LOCK`, the same key in kit-ts) around the module's own `lock`, so modules starting at once migrate one after the other: their GRANTs change shared catalog rows, which fails with `tuple concurrently updated` when two run at once. One login role (`canccu_app`) serves every module today, so it holds every module's app role: RLS keeps tenants apart, not modules.

## No state
The kit writes nothing to disk. Its only in-memory items are the rights cache (≤ 30 s per session), the current settings, the tenant resolver's cache (≤ 30 s per host) and the bus's dedupe list of recent event ids and stream positions. Sessions live in admin (Postgres) and events in Valkey.

## Tests for modules
`canccu_kit.testing.MemoryStreamStore` is an in-memory `StreamStore` that records every `xadd` call. `await require_test_database(conn)` raises unless the connection (or pool) is on a database whose name ends in `_test`, and `await require_test_database_url(url)` does the same on a connection of its own; module tests call the latter before their store connects (and so migrates), and before they drop or empty tables ([docs/ci.md](../../docs/ci.md#modules)).

## Check
```sh
pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy . && pytest
```
CI runs the same commands through `scripts/check-module packages/kit-py`, with the integration tests below (job `lint-types-test (kit-py)`).

## Integration test
The store and bus run against the real Valkey from the Compose stack: publish with MAXLEN (exact and `~`), subscribe, dedupe of an entry added twice, and tenant streams found by `scan` and read per tenant. Row-level security runs against the real Postgres, as a plain app role the test creates (a superuser bypasses RLS); its role and table names differ from the kit-ts test, so both can share one database. Two modules' migrators started at once must run one after the other. Each test is skipped unless `CANCCU_VALKEY_URL` or `CANCCU_DATABASE_URL` is set, so the check above stays offline.
```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait valkey postgres
# canccu_test is made once, as in docs/ci.md#modules (Locally)
CANCCU_VALKEY_URL=redis://127.0.0.1:6379 \
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu_test \
  pytest tests/test_valkey_integration.py tests/test_postgres_integration.py
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml down
```
`compose.test.yml` publishes Valkey and Postgres on `127.0.0.1` only. CI runs these in the `lint-types-test (kit-py)` job; `integration (kit)` passes when it does.
