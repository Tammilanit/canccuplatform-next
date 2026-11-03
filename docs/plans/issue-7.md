# Plan: issue #7 — kit-ts and kit-py: bus, health, settings, rights, errors, logging

Branch `7-kit-ts-and-py`. Parent epic #15 (after #6, before #8). Source of truth: `contracts/admin.md`, `contracts/admin.openapi.yaml`, `contracts/README.md` as merged in #24. No contract changes here.

## Shape: thin core, small adapters
- **Core** (no web framework): bus, health, settings client, rights check, error body, logging, config. It works on plain values: a cookie header string in, a `{status, body}` result out. Every module can use it whatever server it runs.
- **Adapters** (a few dozen lines each) connect the core to one framework: they mount `/health`, run the rights check before a route, and turn thrown kit errors into the error body. Framework packages are optional peers or extras, so a module that uses none of them doesn't install them.
- Both packages have the same parts with the same names: TS in `camelCase`, Python in `snake_case`.

## Decisions
| # | Decision | Reason |
|---|---|---|
| D1 | TS package `@cp/kit` in `packages/kit-ts`; Python distribution `cp-kit`, import `cp_kit`, in `packages/kit-py` | Short, matches the `cp_session` prefix, and survives the rename at the switch |
| D2 | Not published; modules depend on it by path (`"@cp/kit": "file:../../packages/kit-ts"`, `cp-kit @ file:../../packages/kit-py`) | One version for the whole platform: the kit ships with the git tag, so it needs no registry |
| D3 | TS: Node 22, ESM only, npm, own `package-lock.json` in the package | CI already runs `npm ci` with Node 22 in `packages/kit-ts` |
| D4 | TS: `typescript` 6.0.3, `tsc` builds to `dist/`, `strict` on, `exports` map `.`, `./fastify`, `./web` | Compiled JS avoids a runtime loader in modules; 6.0.3 is the newest version typescript-eslint 8.72 supports (<6.1) |
| D5 | Python: 3.12, `hatchling` 1.33.0, `src/cp_kit` layout, `py.typed`, asyncio throughout | CI uses 3.12 and `pip install -e ".[dev]"`; the src layout stops tests importing the source tree by accident |
| D6 | Valkey client TS: `iovalkey` 0.4.0 | Valkey's own fork of ioredis, pure JS with no native build, full Streams API |
| D7 | Valkey client Python: `valkey` 6.2.0 (`valkey.asyncio`) | Valkey's own fork of redis-py, async built in, Streams supported |
| D8 | The core talks to Valkey through a small `StreamStore` interface (`xadd`, `xread`) with one real implementation per client | Tests use an in-memory fake, and the trim argument can be checked exactly |
| D9 | Admin API client TS: built-in `fetch`, injectable | Node 22 has it, so no dependency; tests pass a fake fetch |
| D10 | Admin API client Python: `httpx` 0.28.1 (`AsyncClient`) | Async and typed; `httpx.MockTransport` fakes admin with no extra test dependency |
| D11 | TS adapters: `@cp/kit/fastify` (plugin: `/health`, `requireRight` preHandler, error handler) and `@cp/kit/web` (Web `Request` → `Response` handlers) | Fastify 5.12.8 is the default TS server; the Web-standard adapter covers Hono and anything fetch-based without another dependency |
| D12 | Python adapter: `cp_kit.starlette` (health route, `require_right` dependency or decorator, exception handler) | Starlette 1.10.0 also covers FastAPI, which is built on it; installed through the extra `cp-kit[starlette]` |
| D13 | Test runner TS: `vitest` 5.1.0 | Native ESM and TS, fast, built-in fake timers for the 30 s cache test |
| D14 | Test runner Python: `pytest` 9.2.0 + `pytest-asyncio` 1.4.1.post1 (`asyncio_mode = "auto"`) | The CI command is `pytest`; auto mode avoids a marker on every async test |
| D15 | Lint TS: `eslint` 10.14.0 + `typescript-eslint` 8.72.1 (type-checked rules) + `@eslint/js` 10.0.1, flat config; `prettier` 3.9.10 `--check` inside `npm run lint` | CI runs `npm run lint`; one command covers lint and format |
| D16 | Lint and types Python: `ruff` 0.17.3 (lint and `format --check`), `mypy` 2.4.1 `strict` | CI runs `ruff check .` and `mypy .`; strict typing keeps the kit API exact |
| D17 | UUID v7 TS: `uuid` 14.0.3 (`v7()`) | Well-tested implementation of RFC 9562 |
| D18 | UUID v7 Python: `uuid6` 2025.0.1 (`uuid7()`) | Python 3.12 has no `uuid.uuid7` (it arrives in 3.14); the package is small and pure Python |
| D19 | Logging TS: `pino` 10.4.0, set to `messageKey: "message"`, ISO `time`, `level` as a label, base `{module}` | Fast JSON lines on stdout; the settings give the same fields as Python |
| D20 | Logging Python: stdlib `logging` with a kit `JsonFormatter`, no dependency | Every library's logs come out as the same JSON lines |
| D21 | `correlation_id` carried by `AsyncLocalStorage` (TS) and `contextvars` (Python); adapters set it from the `X-Correlation-Id` header or a new UUID v7 | Logs and `publish` pick it up without passing it by hand |
| D22 | Config from the environment: `CP_MODULE`, `CP_VERSION`, `CP_VALKEY_URL`, `CP_ADMIN_URL`; `loadConfig()` fails at start and names the missing variable | No event-specific defaults in code; Compose (#9) sets them |
| D23 | Pins: exact versions (no `^` or `~`) in `package.json`; `==` in `pyproject.toml` for runtime and dev, with framework extras pinned the same | "Pin versions": builds can be repeated; upgrades are deliberate PRs |
| D24 | `@types/node` 22.20.5 | Matches the Node 22 runtime, not the latest Node types |

## Parts (the same in both packages)
1. **Bus** (`bus`)
   - `publish(type, data, {version, correlationId?})`: checks `type` against `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$` and that its first part equals `CP_MODULE`, otherwise throws `InvalidEventType`. It builds the envelope (`id` v7, `time` UTC with `Z`, `source`, `version` ≥ 1) and runs `XADD events:<module> MAXLEN ~ 10000 * event <json>`. The 10000 is a named constant.
   - `subscribe(modules[], handler, {from?})`: runs `XREAD BLOCK` over `events:<m>`, starting at `$` unless `from` is given. It parses and checks the 7 fields (a bad entry is logged and skipped), dedupes by `id` in a bounded LRU (10000 ids), and passes events with any `type` to the handler (unknown types are the handler's choice). Unknown envelope fields are ignored. On error it reconnects with backoff, and `close()` stops it.
   - No consumer groups (out of scope).
2. **Health** (`health`): `createHealth({checks: {name: () => Promise<{status, detail?}>}})`. It runs the checks with a 2 s timeout each (a timeout counts as `down`) and combines them. A check marked `essential` and `down` makes the whole `down`; a non-essential one makes it `degraded`. It returns `{httpStatus, body}` with the `Health` shape. Ready-made checks: `valkeyCheck` and `postgresCheck(queryFn)`. The Postgres check takes a function, so the kit doesn't depend on a Postgres driver.
3. **Settings client** (`settings`): `start()` runs `GET /api/admin/settings/{module}` and keeps `settingsVersion` and `values`. On `admin.settings.changed` where `data.module` is its own module and `data.settings_version` is greater than the one it holds, it re-reads and calls `onChange(keys)`. `write(values)` runs `PUT` with the held version. A 409 becomes `VersionConflict` and other non-2xx answers become `AdminError(code)`. Version 0 with empty values is valid. It never polls.
4. **Rights check** (`rights`): `checkRight(cookieHeader, right)` reads `cp_session` from the cookie header. Without the cookie it answers `not_signed_in` at once. Otherwise it calls `GET /api/admin/session` with that cookie only, and the answer is 401 → `not_signed_in`, right absent → `missing_right`, right present → allowed with `user`. The cache is a map keyed by session id, with an entry lifetime of min(30 s, `expires_at`) and an index from user id to sessions. On `admin.rights.changed` it drops all of that `user_id`'s entries. 401 answers are not cached. Admin being unreachable gives 503 `admin_unavailable`.
5. **Error body** (`errors`): a `KitError(status, code, message)` base class with `toBody()` → `{"error": {"code", "message"}}`, and `parseErrorBody(json)` for clients. Adapters turn any uncaught error into 500 `internal_error` with a generic message, and log the details.
6. **Logging** (`log`): `createLogger(module)` gives JSON lines `{time, level, module, message, correlation_id?, ...fields}` on stdout.
7. **No state**: the only in-memory items are the rights cache, the current settings and the dedupe LRU, and nothing touches the disk. Each package's README states this.

## Files
| File | New/changed | Purpose |
|---|---|---|
| `packages/kit-ts/package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc` | new | Package, pins, scripts `build`, `lint`, `typecheck`, `test` |
| `packages/kit-ts/src/{bus,health,settings,rights,errors,log,config,context,store}.ts`, `src/index.ts` | new | Core |
| `packages/kit-ts/src/adapters/{fastify,web}.ts` | new | Adapters (subpath exports) |
| `packages/kit-ts/test/*.test.ts` | new | Unit tests with a fake store, fake fetch and fake timers |
| `packages/kit-ts/README.md` | new | Usage example per part, check command |
| `packages/kit-py/pyproject.toml` | new | Package, pins, extras `starlette` and `dev`; ruff, mypy and pytest config |
| `packages/kit-py/src/cp_kit/{bus,health,settings,rights,errors,log,config,context,store}.py`, `__init__.py`, `py.typed` | new | Core |
| `packages/kit-py/src/cp_kit/starlette.py` | new | Adapter |
| `packages/kit-py/tests/test_*.py` | new | Unit tests with a fake store, `httpx.MockTransport` and a controllable clock |
| `packages/kit-py/README.md` | new | Usage example per part, check command |
| `docs/ci.md` | changed | Note that both kit jobs now run real checks |

CI needs no workflow change: the jobs already run the right commands once `package.json` / `pyproject.toml` exist. The TS `npm test` runs `vitest run`, and `npm run typecheck` runs `tsc --noEmit`.

## Tests (each in both languages)
- Bus: the envelope has all 7 fields and a valid v7 id and UTC time; a wrong type or another module's prefix is refused; **the append carries `MAXLEN ~ 10000`**; `subscribe` drops a duplicate `id`, skips a bad envelope, ignores unknown fields and passes an unknown type to the handler.
- Health: all ok → 200 `ok`; non-essential down → 200 `degraded`; essential down or a timeout → 503 `down`; the body matches the `Health` schema (checked against the shape from `admin.openapi.yaml`, read in the test).
- Settings: start reads version 0; a change event for its module re-reads, one for another module or an older version doesn't; a write sends the held version; 409 → `VersionConflict`.
- Rights: allowed; no cookie → 401 with no admin call; admin 401 → `not_signed_in`; right missing → 403 `missing_right`; a second call within 30 s causes no admin call and one after 30 s does (fake clock); `admin.rights.changed` for the user drops the entry; admin down → 503.
- Errors and logging: error body shape; a JSON line has the fields; `correlation_id` gets from context into a log line and into the published envelope.
- Adapters: Fastify and Starlette each serve `/health` with 200/503, apply the rights check to a route and return the error body; the Web adapter is tested the same way with `Request` objects.

## Steps
1. kit-py scaffold: `pyproject.toml` with pins, empty package; `ruff check .`, `mypy .` and `pytest` run green.
2. kit-py core in order: config, log, errors, store, bus, health, settings, rights; tests for each part as it lands.
3. kit-py Starlette adapter + tests; README.
4. kit-ts scaffold: `package.json` with pins, lockfile, tsconfig, eslint; `npm run lint`, `typecheck` and `test` run green.
5. kit-ts core in the same order, with tests; then the Fastify and Web adapters + tests; README.
6. `docs/ci.md` note. Run both packages' checks locally, then `finish`.

## Verification
- `cd packages/kit-py && pip install -e ".[dev]" && ruff check . && mypy . && pytest`
- `cd packages/kit-ts && npm ci && npm run lint && npm run typecheck && npm test`
- CI jobs `lint-types-test (kit-ts)` and `lint-types-test (kit-py)` green on the PR.

## Out of scope
UI (#8), sign-in and session storage (#10), consumer groups, a Postgres driver in the kit, and any change to `contracts/`.
