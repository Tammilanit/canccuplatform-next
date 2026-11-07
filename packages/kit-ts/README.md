# @canccu/kit (TypeScript)

Shared plumbing for platform modules, following [contracts/admin.md](../../contracts/admin.md) and [contracts/tenants.md](../../contracts/tenants.md): event bus, `/health`, settings client, rights check, error body, JSON logging and tenancy. The core has no web framework. Two small adapters connect it to one: `@canccu/kit/fastify` and `@canccu/kit/web` (Web `Request` → `Response`: Hono and any fetch-style server).

## Install (from a module)

```json
{ "dependencies": { "@canccu/kit": "file:../../packages/kit-ts" } }
```

`npm install` builds the kit (`prepare`). Node 22.13+, ESM only. Fastify is an optional peer: install it in the module if you use `@canccu/kit/fastify`.

The kit reads `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL` and `CANCCU_ADMIN_URL`; `loadConfig()` throws at start and names any that is missing.

## Usage

```ts
import {
  AdminClient,
  Bus,
  RightsChecker,
  SettingsClient,
  ValkeyStreamStore,
  createHealth,
  createLogger,
  loadConfig,
  postgresCheck,
  valkeyCheck,
} from "@canccu/kit";

const config = loadConfig();
const log = createLogger(config.module); // JSON lines on stdout
const store = ValkeyStreamStore.fromUrl(config.valkeyUrl);
const bus = new Bus(store, config.module, log);
const admin = new AdminClient(config.adminUrl);

// Bus: publish a tenant event to t:<tenant>:events:<module> (trimmed to ~10000 entries)
await withTenant("demo", () => bus.publish("screen.slide.shown", { slide: 3 }, { version: 1 }));

// Settings: read once at start, then follow admin.settings.changed (never poll)
const settings = new SettingsClient(admin, config.module);
await settings.start();
const rotation = settings.get("rotation_seconds", 10);

// Rights: checks the canccu_session cookie against GET /api/admin/session, cached ≤ 30 s
const rights = new RightsChecker(admin);

const subscription = bus.subscribe(["admin"], async (event) => {
  await settings.handleEvent(event);
  rights.handleEvent(event); // drops the cache on admin.rights.changed
});

// Health: the shared /health shape; 200 for ok/degraded, 503 for down
const health = createHealth({
  module: config.module,
  version: config.version,
  checks: { valkey: valkeyCheck(store), postgres: postgresCheck(() => pool.query("SELECT 1")) },
});
```

### Fastify

```ts
import Fastify from "fastify";
import { install, requireRight } from "@canccu/kit/fastify";

const app = Fastify();
install(app, { health }); // /health, error body for every non-2xx, X-Correlation-Id
app.post("/slides", { preHandler: requireRight(rights, "screen.slides.edit") }, async (request) => {
  return { by: request.session?.userId };
});
```

### Web (Hono, fetch handlers)

```ts
import { healthHandler, withKit, withRight } from "@canccu/kit/web";

app.get("/health", (c) => healthHandler(health)(c.req.raw));
const edit = withRight(rights, "screen.slides.edit", async (req, session) =>
  Response.json({ by: session.userId }),
);
export default { fetch: withKit(router, log) }; // error body + correlation id around everything
```

Throw `new KitError("text", { status: 400, code: "slide_invalid" })` (or `MissingRight`, `NotSignedIn`, …) and the adapter answers `{"error": {"code", "message"}}`. Unexpected errors become 500 `internal_error`, with the details only in the log.

### Errors from admin

`SettingsClient.write` throws `VersionConflict` (409): read again and retry. An admin that can't be reached gives `AdminUnavailable` (503 `admin_unavailable`).

## Tenancy

Every event is a tenant on one shared stack ([0013](../../docs/decisions/0013-multi-tenant-core.md), [contracts/tenants.md](../../contracts/tenants.md)). The kit makes a module tenant-safe by construction: everything that stores or reads data needs a tenant, and it comes only from the request's hostname or the bus message.

```ts
import {
  TenantResolver,
  tenantTransaction,
  tenantKey,
  tenantFile,
  checkInfoAccess,
} from "@canccu/kit";
import { installTenancy } from "@canccu/kit/fastify";

const tenants = new TenantResolver({
  tenantsUrl: process.env.CANCCU_TENANTS_URL ?? "",
  platformHosts: [
    process.env.CANCCU_SIGNIN_HOSTNAME,
    process.env.CANCCU_SUPERADMIN_HOSTNAME,
  ].filter((h): h is string => !!h),
});
install(app, { health });
installTenancy(app, tenants); // request.tenant + withTenant for the whole request; /health is exempt

app.get("/menu", async (request) => {
  checkInfoAccess(request.tenant!, { clientIp: request.ip, viewer: "guest" }); // 403 info_pages_closed
  const client = await pool.connect();
  try {
    return await tenantTransaction(client, (c) => c.query("SELECT * FROM pizza_menu")); // RLS sees only this tenant
  } finally {
    client.release();
  }
});

// Consumers: every tenant's t:<tenant>:events:pizza, new tenants without a restart; handler runs in event.tenant
bus.subscribeTenants(["pizza"], async (event) => {
  /* currentTenant() === event.tenant */
});
bus.subscribe(["tenants"], (event) => tenants.handleEvent(event)); // drop the resolver cache on tenants events
```

- **Context:** `withTenant(id, fn)`, `currentTenant()`, `requireTenant()` (throws `NoTenant`, a bug, never a user error).
- **Postgres:** `tenantTransaction` sets the tenant with `set_config('canccu.tenant', id, true)` (SET LOCAL) inside one transaction, never per connection. Migrations write `TENANT_COLUMN_SQL` (the column defaults to the setting) and `rlsSql(table)` (RLS enabled, forced, and the policy); with no tenant set a query sees nothing and an insert fails. `checkAppRole(client)` refuses to start as a superuser or BYPASSRLS role, which RLS does not bind. `scripts/check-tenancy` lints the migrations ([docs/ci.md](../../docs/ci.md#tenancy)).
- **Names:** `tenantStream(module)` → `t:<tenant>:events:<module>`, `platformStream(module)` → `events:<module>`, `tenantKey(module, …parts)` → `t:<tenant>:<module>:…`, `tenantFile(module, path)` → `/files/<tenant>/<module>/<path>` (refuses `..`), `platformFilesDir(module)` → `/files/_platform/<module>/`. Modules spell no raw keys.
- **Bus:** `publish` uses the current tenant (or `{ tenant }`); without one it throws `NoTenant`. Platform events need `{ platform: true }`, and only a module whose contract says so emits them. A consumer drops a message whose `tenant` does not match its stream.
- **Resolution:** `TenantResolver` asks `GET /internal/tenants/resolve?host=` and caches the answer, for at most 10,000 hosts, for 30 s or until a tenants event (any tenants event also drops cached unknown hosts). An unknown host is 404 `not_found` with no detail; the platform's own hostnames return `{ kind: "platform" }` (adapters answer 404 unless `platformHosts: "serve"`). The IP-mode demo stack (`ipMode`) serves only the `demo` tenant, only on an IP literal and only while the version is `dev`. Env: `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`.
- **Access:** `checkScreenAccess` (device token **and** the venue address, unless the emergency switch is off until `disabled_until`; 401 `device_token_invalid`, 403 `venue_ip_mismatch`), `newDeviceToken`, `hashDeviceToken` and `deviceTokenMatches` (store only the hash), `checkInfoAccess` (the info-page mode), `checkAdminAccess` (`admin_access`: venue or Tailscale, `CANCCU_TAILSCALE_CIDRS`). `clientIp` is the address Caddy forwards (Fastify `trustProxy` set to Caddy only).
- **Leak tests** (`@canccu/kit/testing`): `assertTenantIsolation({ seed, read })` seeds a marker per tenant and fails with `TenantLeak` if one tenant reads the other's, or if a tenant cannot read its own (the test would prove nothing). For a consumer, seed with `deliverAs(handler, tenantEvent(tenant, type, data))`.

## No state

The kit writes nothing to disk. Its only in-memory items are the rights cache (≤ 30 s per session), the current settings, the tenant resolver's cache (≤ 30 s per host) and the bus's dedupe list of recent event ids and stream positions. Sessions live in admin (Postgres) and events in Valkey.

## Tests for modules

`@canccu/kit/testing` exports `MemoryStreamStore`, an in-memory `StreamStore` that records every `xadd` call.

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

CI runs the same commands (job `lint-types-test (kit-ts)`).

## Integration test

The store and bus run against the real Valkey from the Compose stack: publish with MAXLEN (exact and `~`), subscribe, dedupe of an entry added twice, and tenant streams found by `scan` and read per tenant. Row-level security runs against the real Postgres, as a plain app role the test creates (a superuser bypasses RLS). Each test is skipped unless `CANCCU_VALKEY_URL` or `CANCCU_DATABASE_URL` is set, so the check above stays offline.

```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait valkey postgres
CANCCU_VALKEY_URL=redis://127.0.0.1:6379 \
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu \
  npx vitest run test/valkey.integration.test.ts test/postgres.integration.test.ts
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml down
```

`compose.test.yml` publishes Valkey and Postgres on `127.0.0.1` only. CI runs this as the `integration (kit)` job.
