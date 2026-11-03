# @cp/kit (TypeScript)

Shared plumbing for platform modules, following [contracts/admin.md](../../contracts/admin.md): event bus, `/health`, settings client, rights check, error body and JSON logging. The core has no web framework. Two small adapters connect it to one: `@cp/kit/fastify` and `@cp/kit/web` (Web `Request` → `Response`: Hono and any fetch-style server).

## Install (from a module)

```json
{ "dependencies": { "@cp/kit": "file:../../packages/kit-ts" } }
```

`npm install` builds the kit (`prepare`). Node 22.13+, ESM only. Fastify is an optional peer: install it in the module if you use `@cp/kit/fastify`.

The kit reads `CP_MODULE`, `CP_VERSION`, `CP_VALKEY_URL` and `CP_ADMIN_URL`; `loadConfig()` throws at start and names any that is missing.

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
} from "@cp/kit";

const config = loadConfig();
const log = createLogger(config.module); // JSON lines on stdout
const store = ValkeyStreamStore.fromUrl(config.valkeyUrl);
const bus = new Bus(store, config.module, log);
const admin = new AdminClient(config.adminUrl);

// Bus: publish to events:<module> (trimmed to ~10000 entries), subscribe to other modules' streams
await bus.publish("screen.slide.shown", { slide: 3 }, { version: 1 });

// Settings: read once at start, then follow admin.settings.changed (never poll)
const settings = new SettingsClient(admin, config.module);
await settings.start();
const rotation = settings.get("rotation_seconds", 10);

// Rights: checks the cp_session cookie against GET /api/admin/session, cached ≤ 30 s
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
import { install, requireRight } from "@cp/kit/fastify";

const app = Fastify();
install(app, { health }); // /health, error body for every non-2xx, X-Correlation-Id
app.post("/slides", { preHandler: requireRight(rights, "screen.slides.edit") }, async (request) => {
  return { by: request.session?.userId };
});
```

### Web (Hono, fetch handlers)

```ts
import { healthHandler, withKit, withRight } from "@cp/kit/web";

app.get("/health", (c) => healthHandler(health)(c.req.raw));
const edit = withRight(rights, "screen.slides.edit", async (req, session) =>
  Response.json({ by: session.userId }),
);
export default { fetch: withKit(router, log) }; // error body + correlation id around everything
```

Throw `new KitError("text", { status: 400, code: "slide_invalid" })` (or `MissingRight`, `NotSignedIn`, …) and the adapter answers `{"error": {"code", "message"}}`. Unexpected errors become 500 `internal_error`, with the details only in the log.

### Errors from admin

`SettingsClient.write` throws `VersionConflict` (409): read again and retry. An admin that can't be reached gives `AdminUnavailable` (503 `admin_unavailable`).

## No state

The kit writes nothing to disk. Its only in-memory items are the rights cache (≤ 30 s per session), the current settings and the bus's dedupe list of recent event ids. Sessions live in admin (Postgres) and events in Valkey.

## Tests for modules

`@cp/kit/testing` exports `MemoryStreamStore`, an in-memory `StreamStore` that records every `xadd` call.

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

CI runs the same commands (job `lint-types-test (kit-ts)`).
