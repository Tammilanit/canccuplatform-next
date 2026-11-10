# @canccu/kit (TypeScript)

Shared plumbing for platform modules, following [contracts/admin.md](../../contracts/admin.md) and [contracts/tenants.md](../../contracts/tenants.md): event bus, `/health`, settings client, rights check, error body, JSON logging and tenancy. The core has no web framework. Two small adapters connect it to one: `@canccu/kit/fastify` and `@canccu/kit/web` (Web `Request` → `Response`: Hono and any fetch-style server).

## Install (from a module)

```json
{ "dependencies": { "@canccu/kit": "file:../../packages/kit-ts" } }
```

`npm install` builds the kit (`prepare`). Node 22.13+, ESM only. Fastify is an optional peer: install it in the module if you use `@canccu/kit/fastify`.

The kit reads `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL` and `CANCCU_ADMIN_URL`; `loadConfig()` throws at start and names any that is missing. `serviceKeyFromEnv()` reads `CANCCU_SERVICE_KEY` and `SecretBox.fromEnv()` reads `CANCCU_SECRETS_KEY` and `CANCCU_SECRETS_KEYS_RETIRED`, each throwing `ConfigError` the same way.

## Usage

```ts
import {
  AdminClient,
  Bus,
  RightsChecker,
  ServiceIdentity,
  SettingsClient,
  ValkeyStreamStore,
  createHealth,
  createLogger,
  loadConfig,
  postgresCheck,
  serviceKeyFromEnv,
  valkeyCheck,
  withTenant,
} from "@canccu/kit";

const config = loadConfig();
const log = createLogger(config.module); // JSON lines on stdout
const store = ValkeyStreamStore.fromUrl(config.valkeyUrl);
const bus = new Bus(store, config.module, log);
const admin = new AdminClient(config.adminUrl);

// Bus: publish a tenant event to t:<tenant>:events:<module> (trimmed to ~10000 entries)
await withTenant("demo", () => bus.publish("screen.slide.shown", { slide: 3 }, { version: 1 }));

// Service identity: signs calls to other modules' /internal/ paths (CANCCU_SERVICE_KEY)
const service = new ServiceIdentity({ module: config.module, key: serviceKeyFromEnv() });

// Settings, per tenant: read on GET /internal/admin/settings/<module>?tenant_id=, then follow
// admin.settings.changed (never poll). It does not write: writes are a person's, on admin's API
// on the event's own hostname, where admin learns the tenant
const settings = new SettingsClient(admin, config.module, { service });
await withTenant("demo", async () => {
  await settings.ensure(); // the current tenant once (concurrent callers share the read)
  const rotation = settings.get("rotation_seconds", 10);
});

// Rights: checks the canccu_session cookie against GET /api/admin/session, cached ≤ 30 s
const rights = new RightsChecker(admin);
// Superadmin paths: 403 missing_right unless admin's `superadmin` is true (a missing field is
// false); answer them only on the superadmin hostname as well (contracts/admin.md)
const session = await rights.requireSuperadmin(request.headers.cookie);

bus.subscribeTenants(["admin"], (event) => settings.handleEvent(event)); // re-reads that tenant
bus.subscribe(["admin"], (event) => {
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
install(app, { health }); // /health, error body for every non-2xx, X-Correlation-Id, origin check
app.post("/slides", { preHandler: requireRight(rights, "screen.slides.edit") }, async (request) => {
  return { by: request.session?.userId };
});
```

### Web (Hono, fetch handlers)

```ts
import { healthHandler, withKit, withRight } from "@canccu/kit/web";

app.get("/health", (c) => healthHandler(health)(c.req.raw));
// session is Session | null: null when a module signs the request (with { service })
const edit = withRight(rights, "screen.slides.edit", async (req, session) =>
  Response.json({ by: session?.userId }),
);
export default { fetch: withKit(router, log) }; // error body + correlation id around everything
```

Throw `new KitError("text", { status: 400, code: "slide_invalid" })` (or `MissingRight`, `NotSignedIn`, …) and the adapter answers `{"error": {"code", "message"}}`. Unexpected errors become 500 `internal_error`, with the details only in the log.

### Errors from admin

`SettingsClient` only reads: a write is a person's, on admin's API on the event's own hostname, where admin learns the tenant. An admin that can't be reached gives `AdminUnavailable` (503 `admin_unavailable`).

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
- **Names:** `tenantStream(module)` → `t:<tenant>:events:<module>`, `platformStream(module)` → `events:<module>`, `tenantKey(module, …parts)` → `t:<tenant>:<module>:…`, `platformKey(module, …parts)` → `<module>:…` (a key that spans every event by design, such as screen's render queue; ids and times only, never an event's content; modules `t` and `events` refused), `tenantFile(module, path)` → `/files/<tenant>/<module>/<path>` (refuses `..`), `platformFilesDir(module)` → `/files/_platform/<module>/`. Modules spell no raw keys.
- **Bus:** `publish` uses the current tenant (or `{ tenant }`); without one it throws `NoTenant`. Platform events need `{ platform: true }`, and only a module whose contract says so emits them. A consumer drops a message whose `tenant` does not match its stream. A handler that throws runs again in place, 500 ms later and doubling (up to 10 s), five times in all (`handlerTries`, `retryMs`); then the event is logged as `event skipped after failed handler` and skipped, so one bad event cannot stop the stream. Later events of that subscription wait meanwhile, and a handler may see the same event more than once, so handlers must be idempotent.
- **Resolution:** `TenantResolver` asks `GET /internal/tenants/resolve?host=` and caches the answer, for at most 10,000 hosts, for 30 s or until a tenants event (any tenants event also drops cached unknown hosts). An unknown host is 404 `not_found` with no detail; the platform's own hostnames return `{ kind: "platform" }` (adapters answer 404 unless `platformHosts: "serve"`). The IP-mode demo stack (`ipMode: { version }`) serves only the `demo` tenant, only on an IP literal and only while the version is `dev`; it asks `GET /internal/tenants/ip-mode`. `byId(tenantId)` asks `GET /internal/tenants/tenants/{tenant_id}` for another event's context in every status (`null` for an unknown id, that is a 404; any other failure is `TenantsUnavailable`, as in kit-py), uncached, only for actions that span events. Env: `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`.
- **Access:** `checkScreenAccess` (device token **and** the venue address, unless the emergency switch is off until `disabled_until`; 401 `device_unknown`, 403 `venue_ip_refused`), `newDeviceToken`, `hashDeviceToken` and `deviceTokenMatches` (store only the hash), `checkInfoAccess` (the info-page mode), `checkAdminAccess` (`admin_access`: venue or Tailscale, `CANCCU_TAILSCALE_CIDRS`). `clientIp` is the address Caddy forwards (Fastify `trustProxy` set to Caddy only).
- **Leak tests** (`@canccu/kit/testing`): `assertTenantIsolation({ seed, read })` seeds a marker per tenant and fails with `TenantLeak` if one tenant reads the other's, or if a tenant cannot read its own (the test would prove nothing). For a consumer, seed with `deliverAs(handler, tenantEvent(tenant, type, data))`.

## Service identity

Internal paths (`/internal/<module>/…`) take no session; modules prove they belong to the stack with the header `x-canccu-service`: `v1.<caller>.<audience>.<expires>.<HMAC-SHA256>`, valid for 60 s and for one audience only. Every module holds the same key, `CANCCU_SERVICE_KEY` (at least 32 characters; a `local-only` placeholder runs only while `CANCCU_VERSION` is `dev`), so it proves "a module of this stack", not which one beyond honesty.

```ts
import { installServiceIdentity, requireRight } from "@canccu/kit/fastify";

const service = new ServiceIdentity({ module: "pizza", key: serviceKeyFromEnv() });
await fetch(`${tenantsUrl}/internal/tenants/…`, { headers: service.headers("tenants") });
installServiceIdentity(app, service); // every /internal/ request: valid token or 401 service_unauthenticated; request.service
app.get("/orders", { preHandler: requireRight(rights, "pizza.orders.read", { service }) }, handler);
```

- `verify(value)` gives the caller; `require(value, ["admin"])` also limits who (403 `service_forbidden`).
- With `{ service }`, `requireRight` lets a module through on its own rights only (`serviceHasRight`: `pizza` holds `pizza.*`, never another module's or admin's); `request.session` is then null, and `withRight`'s handler gets `session: Session | null`. Web: `withServiceIdentity(service, handler)` and `withRight(…, { service })`.
- `TenantResolver({ service })` signs its calls to the tenants module, and `SettingsClient` its reads from admin.

## Secrets

`SecretBox` seals secrets at rest (bot tokens, provider keys) with AES-256-GCM: `cs1.<key version>.<nonce>.<ciphertext>`, the same format as kit-py.

```ts
const box = SecretBox.fromEnv(); // CANCCU_SECRETS_KEY=<version>:<base64 of 32 bytes>
const aad = `bot:token:${tenant}:${applicationId}`; // binds the value to its row
const sealed = box.seal(token, aad);
const plain = box.openText(sealed, aad); // SecretUndecryptable on any mismatch (a bug, never shown)
if (box.needsRotation(sealed)) await save(box.rotate(sealed, aad));
```

Rotation: make the new key current and list the old one in `CANCCU_SECRETS_KEYS_RETIRED` (`<version>:<key>,…`) until every value is re-sealed.

## Event pages: CSP and origin check

- `eventPageCsp(newNonce(), hostname, { page: "surface" | "admin" | "sign_in" })` is the contract's policy ([theming.md](../../contracts/theming.md#the-csp-of-event-pages)); the nonce goes on the page's own `<style>` block. `sandbox` sets a separate sandbox origin.
- `checkOrigin(method, path, origin, host, secFetchSite)` throws 403 `origin_refused` for `Origin: null` on `/api/…` and for a state-changing request from another origin (or cross-site without Origin). The adapters run it on every request (`install`, `withKit`; `originCheck: false` turns it off).

## Postgres connections

- **Migrations:** `runMigrations(client, dir, { ledger, lock, appRole, grantTo })` runs each new `*.sql` file in `dir` once, in name order, each in its own transaction, recorded in the ledger table; then grants the app role to the login role. The whole run holds the platform-wide advisory lock `PLATFORM_MIGRATION_LOCK` (the same key in kit-py) around the module's own `lock`, so modules starting at once migrate one after the other. The same behaviour as kit-py's `run_migrations`.

- **Tracked clients:** `trackTransactions(client)` wraps a checked-out connection and follows its BEGIN/COMMIT/ROLLBACK; `tenantTransaction` then refuses to start inside the caller's own transaction, whose COMMIT it would otherwise end early. `release()` passes through.
- **Login role:** `checkLoginRole(client)` at start, before `SET ROLE` to the app role, refuses a login role that is a superuser, has BYPASSRLS or owns tables (it could switch RLS off). `checkAppRole` still checks the role the queries run as.

## No state

The kit writes nothing to disk. Its only in-memory items are the rights cache (≤ 30 s per session), the current settings per tenant served, parsed venue address lists (≤ 1024), the tenant resolver's cache (≤ 30 s per host) and the bus's dedupe list of recent event ids and stream positions. Sessions live in admin (Postgres) and events in Valkey.

## Tests for modules

`@canccu/kit/testing` exports `MemoryStreamStore`, an in-memory `StreamStore` that records every `xadd` call.

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

CI runs the same commands through `scripts/check-module packages/kit-ts`, with the integration tests below (job `lint-types-test (kit-ts)`).

## Integration test

The store and bus run against the real Valkey from the Compose stack: publish with MAXLEN (exact and `~`), subscribe, dedupe of an entry added twice, and tenant streams found by `scan` and read per tenant. Row-level security runs against the real Postgres, as a plain app role the test creates (a superuser bypasses RLS). Each test is skipped unless `CANCCU_VALKEY_URL` or `CANCCU_DATABASE_URL` is set, so the check above stays offline.

```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait valkey postgres
CANCCU_VALKEY_URL=redis://127.0.0.1:6379 \
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu \
  npx vitest run test/valkey.integration.test.ts test/postgres.integration.test.ts
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml down
```

`compose.test.yml` publishes Valkey and Postgres on `127.0.0.1` only. CI runs these in the `lint-types-test (kit-ts)` job; `integration (kit)` passes when it does.
