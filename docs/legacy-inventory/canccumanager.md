# Legacy inventory: canccumanager

Read-only inventory of the legacy repo `canccumanager` at commit `def9bd721b` (17 commits, 56 tracked files, 10 927 lines, 7 511 of them `package-lock.json`). Nothing is copied: code and docs are described, and only short identifiers (route paths, table, column, env and config names) are quoted. Event-specific values are counted by kind only (see [Event-specific content](#event-specific-content)). Roadmap steps and decisions are those of [docs/roadmap.md](../roadmap.md) and [docs/decisions/](../decisions/README.md).

Hosts are named by role: the **venue laptop** (Windows with WSL; runs the signage service and the mini-tourney), the **bot guest** (runs canccubot), the **manager container** (runs this repo) and **the signup site** (a hosted serverless worker). The signup site's subsystem key is the org name, so this file calls it "the signup-site key".

## In short
- **What it is:** one Node 22 process (TypeScript, Astro 5 in middleware mode, better-sqlite3, zod, yaml) that polls the `/healthz` of five legacy subsystems every 30 s, debounces status changes, records them in SQLite, alerts through canccubot or a Discord webhook, and serves a token-protected JSON API plus a one-page status view on the tailnet only.
- **Operator features:** status table, event history, mute, acknowledge, 30-minute reminders, on-demand logs (journald over ssh, or the hosted worker's logs API) with redaction, a catalog of ssh actions (service restart, kiosk display restart) with an action log, one automatic restart policy (kiosk display), and a heartbeat pushed to the signup site.
- **No end-user features.** There are no Discord commands, no bus events, no WebSocket or SSE. All state is one SQLite file.
- **Health:** CI runs `astro check`, the tests and the build. The 9 test files (95 tests) pass on a clean copy (`npm ci && npx vitest run`, run for this inventory).
- **History:** the first five commits were an unrelated Python generation (a manager plus host-side control agents), deleted wholesale in `daecbcf`; the current code is 11 commits from 21 to 25 October 2026.
- **Biggest port concerns:** the auth model (shared tokens, a self-declared `X-Caller`, unauthenticated page forms), ssh as the executor, and two real defects: the page's action buttons skip their confirm dialog, and the guarded auto-restart can never run (see [Known problems](#known-problems)).

## Coverage
Every tracked file was read in full except `package-lock.json`, which was checked only for the dependency set (it matches `package.json`). The deleted Python generation was looked at only to describe the history; it is not in the tree. Nothing was skipped.

| Directory | Files | Lines | Contents |
|---|---:|---:|---|
| (root) | 9 | 7 633 | package, lockfile (7 511), Astro, TypeScript, vitest config, agent instructions, README |
| `.github/` | 1 | 33 | CI workflow |
| `config/` | 1 | 61 | subsystems, redaction, actions, auto-restart policy |
| `deploy/` | 3 | 95 | systemd unit, env template, deploy notes |
| `docs/` | 3 | 143 | two implementation plans, a placeholder |
| `src/` | 30 | 1 837 | 13 lib modules (1 511), 15 pages and endpoints, server and middleware (326 with pages) |
| `tests/` | 9 | 1 125 | vitest suites |
| **Total** | **56** | **10 927** | |

Per file:

| File | Lines | What it is |
|---|---:|---|
| `.github/workflows/ci.yml` | 33 | CI on PRs and pushes to main: Node from `.nvmrc`, `npm ci`, `npm run check`, `npm run test:run`, `npm run build`. |
| `.gitignore` | 8 | Ignores build output, `.env`, SQLite files, coverage. |
| `.nvmrc` | 1 | Node 22. |
| `CLAUDE.md` | 39 | Agent instructions: stack, commands, env list, rules (contracts live in the legacy system repo, no hosts or tokens in messages), workflow words including a manual `deploy` word. |
| `README.md` | 8 | One-paragraph summary; points to the legacy system repo for design and contracts. |
| `astro.config.mjs` | 12 | Server output, node adapter in middleware mode, Astro's origin check off (forms check Origin themselves). |
| `package.json` | 38 | Scripts `dev`, `build` (Astro plus an esbuild bundle of `src/server.ts`), `start`, `check`, `test`, `test:run`; deps `astro`, `@astrojs/node`, `better-sqlite3`, `yaml`, `zod`. |
| `package-lock.json` | 7 511 | Lockfile. |
| `tsconfig.json` | 8 | Astro strict config plus node and vitest types. |
| `vitest.config.ts` | 8 | Node environment, `tests/**/*.test.ts`. |
| `config/subsystems.yaml` | 61 | The runtime config (see [Configuration](#configuration)). |
| `deploy/README.md` | 45 | How the manager container is set up (checkout, system user, env file, unit symlink, narrow sudoers rule), the manual deploy one-liner, the check `curl`, and the auto-restart behaviour. |
| `deploy/canccumanager.service` | 29 | systemd unit: system user, env file, `Restart=on-failure` (the tailnet address may not exist yet at boot), state directory, sandboxing options. |
| `deploy/env.example` | 21 | Env template with placeholders for every variable. |
| `docs/handoffs/.gitkeep` | 0 | Placeholder for session handoff notes. |
| `docs/plans/issue-2.md` | 75 | Plan for phase 1 (poller, read API, page), with decisions and answered questions. |
| `docs/plans/issue-6.md` | 68 | Plan for the auto-restart policy, with findings, decisions and open questions. |
| `src/server.ts` | 48 | Entry: parses env, loads config, opens the DB, loads the Astro handler, starts the poller (with auto-restart and alerts after each cycle) and the heartbeat, binds the http server, shuts down on SIGTERM and SIGINT. |
| `src/middleware.ts` | 15 | Auth for `/api/*` only; turns thrown errors into a 500. |
| `src/lib/actions.ts` | 134 | ssh action runner (2 min timeout), live-cast warnings, the auto-restart guard predicate, action start with validation, one-at-a-time lock, redacted streaming output. |
| `src/lib/alerts.ts` | 221 | Alert config, route choice (bot or webhook), which events announce, reminders, webhook text, delivery, bookkeeping in `alert_log`. |
| `src/lib/api.ts` | 189 | Response shapes for the API, mute and ack logic shared by API and page, `limit` and `lines` parsing, JSON and error helpers, bearer auth, Origin check. |
| `src/lib/autorestart.ts` | 114 | Auto-restart engine run after each poll. |
| `src/lib/config.ts` | 140 | zod schemas for the YAML and the env, token parsing. |
| `src/lib/context.ts` | 13 | Lazily opened read side (config, DB, tokens) for the Astro pages. |
| `src/lib/db.ts` | 346 | SQLite open (WAL, busy timeout), four schema migrations, all queries. |
| `src/lib/format.ts` | 14 | Uptime and time formatting for the page. |
| `src/lib/health.ts` | 66 | Health response schema, fetch with timeout, mapping failures to a synthetic `down`. |
| `src/lib/heartbeat.ts` | 88 | Builds and pushes the manager's own health every 60 s; reads the commit from `.git`. |
| `src/lib/logs.ts` | 88 | Redaction, the ssh journald call, the hosted worker logs query. |
| `src/lib/poller.ts` | 76 | One poll of all subsystems in parallel, state machine, events; the non-overlapping 30 s loop. |
| `src/lib/state.ts` | 22 | The debounce state machine (pure). |
| `src/pages/index.astro` | 117 | The status page. |
| `src/pages/api/[...rest].ts` | 5 | Catch-all 404 in the API error shape. |
| `src/pages/api/actions.ts` | 9 | `GET /api/actions`. |
| `src/pages/api/heartbeat.ts` | 5 | `GET /api/heartbeat`. |
| `src/pages/api/status.ts` | 8 | `GET /api/status`. |
| `src/pages/api/events/index.ts` | 9 | `GET /api/events`. |
| `src/pages/api/events/[id]/ack.ts` | 6 | `POST /api/events/<id>/ack`. |
| `src/pages/api/subsystems/[name]/index.ts` | 10 | `GET /api/subsystems/<name>`. |
| `src/pages/api/subsystems/[name]/logs.ts` | 20 | `GET /api/subsystems/<name>/logs`. |
| `src/pages/api/subsystems/[name]/mute.ts` | 10 | `PUT /api/subsystems/<name>/mute`. |
| `src/pages/api/subsystems/[name]/restart.ts` | 12 | `POST /api/subsystems/<name>/restart` (alias). |
| `src/pages/api/subsystems/[name]/actions/[action].ts` | 11 | `POST /api/subsystems/<name>/actions/<action>`. |
| `src/pages/ui/ack.ts` | 11 | Page form: acknowledge. |
| `src/pages/ui/action.ts` | 18 | Page form: run an action. |
| `src/pages/ui/mute.ts` | 12 | Page form: mute or unmute. |
| `tests/actions.test.ts` | 106 | See [Tests](#tests). |
| `tests/alerts.test.ts` | 409 | See [Tests](#tests). |
| `tests/api.test.ts` | 97 | See [Tests](#tests). |
| `tests/autorestart.test.ts` | 188 | See [Tests](#tests). |
| `tests/config.test.ts` | 53 | See [Tests](#tests). |
| `tests/health.test.ts` | 72 | See [Tests](#tests). |
| `tests/logs.test.ts` | 91 | See [Tests](#tests). |
| `tests/poller.test.ts` | 71 | See [Tests](#tests). |
| `tests/state.test.ts` | 38 | See [Tests](#tests). |

## Features
All features are operator features: the users are the crew on the tailnet and the bot. None is visible to attendees.

| # | Feature | Where it lives | How it is reached |
|---|---|---|---|
| F1 | **Health polling** of the five subsystems (signage, tourney, bot, the signup site, the cast relay) every 30 s, in parallel, 5 s timeout each. A failed fetch, non-JSON or a body that does not match the health contract becomes `down` with one synthetic check `reachable` and a generic message (`timed out`, `unreachable`, `HTTP <n>, not JSON`, `HTTP <n>, not contract-shaped`, `not deployed`). A 503 with a valid body is taken as reported. Last known version and uptime are kept while unreachable. | `src/lib/health.ts`, `src/lib/poller.ts`, `src/server.ts` | Schedule (30 s loop) |
| F2 | **Debounce:** a new status becomes current only after two polls in a row agree; the first observation sets it silently; an A→B→A flicker never changes it. | `src/lib/state.ts` | Inside F1 |
| F3 | **State-change events:** each change is a row with from, to, the first non-ok check and a message `<check>: <message>`. | `src/lib/poller.ts`, `src/lib/db.ts` | Inside F1; read by F5 and F6 |
| F4 | **Status page:** one row per subsystem (status badge, version, uptime, last change, failing check), mute or unmute, acknowledge the open alert, one button per catalog action (browser confirm with live-cast warnings), a link to logs; refreshes every 30 s (paused while logs are open). Rendered on the server; the browser holds no token. | `src/pages/index.astro`, `src/pages/ui/*.ts`, `src/lib/format.ts` | `GET /`, `GET /?logs=<name>`, forms to `POST /ui/mute`, `POST /ui/ack`, `POST /ui/action` |
| F5 | **Status API** for scripts and the bot. | `src/pages/api/status.ts`, `src/pages/api/subsystems/[name]/index.ts`, `src/lib/api.ts` | `GET /api/status`, `GET /api/subsystems/<name>` |
| F6 | **Event history and acknowledge:** history across subsystems; the first ack stands and records who and when. | `src/pages/api/events/index.ts`, `src/pages/api/events/[id]/ack.ts`, `src/lib/api.ts` | `GET /api/events`, `POST /api/events/<id>/ack`, the page, the bot's Acknowledge button (in canccubot) |
| F7 | **Alerts:** an incident runs from ok→non-ok to non-ok→ok. Sent: the start, the first escalation to `down` within the incident, the recovery, and every auto-restart "gave up" or "blocked" event. Other changes inside an incident are recorded silently. Events from before alerts existed are marked handled by the migration. | `src/lib/alerts.ts` | After each poll (schedule) |
| F8 | **Alert routing:** canccubot's `POST /alert` first (its URL defaults to the bot's health origin plus `/alert`); the Discord webhook when the bot is the subject, is not configured, or refuses. Webhook text names subsystem, state, check, since and the page link, with mentions disabled. | `src/lib/alerts.ts` | After each poll |
| F9 | **Reminders:** while a subsystem's latest event is non-ok and nobody acknowledged it (or the last announced event), a reminder every 30 min after its last message, carrying the current state and the incident's start time. A message no route could take is recorded as `failed` and retried at that cadence, not every poll. | `src/lib/alerts.ts` | After each poll |
| F10 | **Mute:** per subsystem; muted subsystems get no alerts, no reminders and no auto-restart; new events while muted are marked handled and never announced later. The cast relay is seeded muted by migration (it is not deployed). | `src/lib/api.ts`, `src/lib/db.ts`, `src/pages/api/subsystems/[name]/mute.ts`, `src/pages/ui/mute.ts` | `PUT /api/subsystems/<name>/mute`, page |
| F11 | **On-demand logs:** last N lines (default 100, max 1000), oldest first, every line redacted by the configured patterns. Sources: `journalctl -u <unit>` over ssh on the subsystem's host (optionally through `wsl.exe -d <distro>`, unused), or the hosted worker logs API (last hour). Errors hide hosts, paths and tokens. | `src/lib/logs.ts`, `src/pages/api/subsystems/[name]/logs.ts`, `src/pages/index.astro` | `GET /api/subsystems/<name>/logs`, `GET /?logs=<name>` |
| F12 | **Action catalog:** per subsystem, named commands from the config run over ssh (2 min limit), one at a time per subsystem (a row unfinished for over 4 min counts as crashed). Requires `confirm: true`; for signage and the cast relay, a `restart` or `restart-display` while a check named `cast_live` or `emergency_directive` is not ok also needs `confirmWarnings: true` (a warning, never a block). Output streams back redacted, ending with the exit code. Shipped: service restart for signage, tourney and the bot; kiosk display restart on the venue laptop. | `src/lib/actions.ts`, `src/pages/api/subsystems/[name]/actions/[action].ts`, `src/pages/api/subsystems/[name]/restart.ts`, `src/pages/ui/action.ts` | `POST /api/subsystems/<name>/actions/<action>`, `POST /api/subsystems/<name>/restart`, page |
| F13 | **Action log:** every run (manual or automatic) with caller, start, finish, exit code, warnings, `auto`. | `src/lib/db.ts`, `src/pages/api/actions.ts` | `GET /api/actions` |
| F14 | **Auto-restart policy:** off unless listed. A policy triggers on one check non-ok for N seconds while other checks are ok, or (default) on status `down` for N polls. Cooldown, at most N attempts per fixed 30-min window, then one "gave up" event (alerts, can be acked) until the trigger clears. Never for a muted subsystem. A guarded policy runs only when the subsystem's health reports `castLive` and `emergencyDirective` both `false`; otherwise one "blocked" event per incident. State survives a manager restart. Shipped: one unguarded policy, kiosk display restart when `screen-poll` is non-ok for 60 s while `readiness` is ok (cooldown 300 s, 3 attempts). | `src/lib/autorestart.ts`, `src/lib/config.ts`, `config/subsystems.yaml` | After each poll |
| F15 | **Manager heartbeat (push):** the manager's own health shape (one check `poller`: `ok` if the last cycle is at most 90 s old, `degraded` to 300 s, then `down`) plus `sentAt`, posted to the signup site every 60 s; failures are logged, not retried. | `src/lib/heartbeat.ts`, `src/server.ts` | Schedule (60 s) |
| F16 | **Manager heartbeat (pull):** time of the last completed poll cycle. | `src/pages/api/heartbeat.ts` | `GET /api/heartbeat` |
| F17 | **Tailnet-only bind:** refuses to start without a bind address and refuses all-interfaces binds without an explicit opt-in. | `src/lib/config.ts`, `src/server.ts` | Startup |
| F18 | **Deploy and run:** systemd unit, env template, manual deploy over ssh, CI. | `deploy/*`, `.github/workflows/ci.yml`, `package.json` | Manual and CI |

## Interfaces

### A. HTTP routes served
All `/api/*` routes require `Authorization: Bearer <token>` (any token in `MANAGER_TOKENS`) and a non-empty `X-Caller` header; the caller string is what is recorded as the actor. Errors are `{"error": {"code", "message"}}`: `401 unauthorized`, `403 caller_required`, `500 internal`, plus the per-route codes below. Responses are JSON with `cache-control: no-store` unless noted. Shapes follow the legacy contract `manager-api.md` in the legacy system repo (see the canccuplatform inventory).

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/status` | token + caller | none | `{subsystems: [StatusEntry]}`; StatusEntry = `name`, `status` (`ok`/`degraded`/`down`), `version` (string or null), `uptimeSeconds` (int or null), `checks` (`[{name, status, message?}]`), `lastChange` (ISO or null), `muted`, `actions` (`[{name, label}]`). A never-polled subsystem is `down` with one `reachable` check. |
| `GET /api/subsystems/<name>` | token + caller | none | StatusEntry plus `events`: the last 20 as `{id, at, from, to, message}`, newest first. `404 unknown_subsystem`. |
| `GET /api/subsystems/<name>/logs` | token + caller | query `lines` (default 100, clamp 1000) | `{lines: [string]}`, oldest first, redacted. `400 invalid_body`, `404 unknown_subsystem`, `404 no_log_source`, `502 log_fetch_failed`. |
| `PUT /api/subsystems/<name>/mute` | token + caller | `{muted: boolean}` | StatusEntry. `400 invalid_body`, `404 unknown_subsystem`. |
| `POST /api/subsystems/<name>/actions/<action>` | token + caller | `{confirm: true, confirmWarnings?: boolean}` | `200 text/plain`, streamed redacted command output, last line `exit <code>`, header `x-action-id`. `400 invalid_body`, `400 confirm_required` (with `warnings: [string]` when only `confirmWarnings` is missing), `404 unknown_subsystem`, `404 not_found` (action not in catalog), `409 action_in_progress`. |
| `POST /api/subsystems/<name>/restart` | token + caller | as above | Alias of the `restart` action. |
| `GET /api/events` | token + caller | query `limit` (default 50, clamp 200) | `{events: [{id, subsystem, at, from, to, message, acknowledged}]}`, newest first. `400 invalid_body`. |
| `POST /api/events/<id>/ack` | token + caller | none (no body) | The event entry as in `GET /api/events`; acking again changes nothing. `404 not_found`. |
| `GET /api/actions` | token + caller | query `limit` (default 50, clamp 200) | `{actions: [{id, subsystem, action, caller, at, finishedAt, exitCode, warnings, auto}]}`, newest first. `400 invalid_body`. |
| `GET /api/heartbeat` | token + caller | none | `{at}`: the last completed poll cycle (the process start until the first). |
| any other `/api/*` | token + caller | any method | `404 not_found`. |
| `GET /` | none (tailnet bind) | query `logs=<name>` (`?logs=<name>`) opens the log panel | HTML page. |
| `POST /ui/mute` | none; Origin must be absent or same host | form `name`, `muted` | `303` to `/`; `403 forbidden` on a foreign Origin. Actor recorded as `page`. |
| `POST /ui/ack` | as above | form `id` | as above. |
| `POST /ui/action` | as above | form `name`, `action` | Waits for the command to finish (up to 2 min), then `303` to `/`. Always sends both confirmations. |

### B. HTTP calls made (outbound)

| Call | When | Auth | Body and expectation |
|---|---|---|---|
| `GET <healthUrl>` of each subsystem | every 30 s | none | `Accept: application/json`; 5 s timeout; body must match the health contract (`status`, `version`, `uptimeSeconds`, `checks`); extra keys are dropped. |
| canccubot `POST /alert` | an alert or reminder is due | `Authorization: Bearer` `MANAGER_BOT_TOKEN`, `X-Caller: manager` | `{eventId, subsystem, state, failingCheck, since, link}`; any 2xx is success; 5 s timeout. The bot's handling (DM, Acknowledge button) is in canccubot. |
| Discord webhook | bot route not used or failed | the URL is the secret | `{content, allowed_mentions: {parse: []}}`; 5 s timeout. |
| Signup site heartbeat (`MANAGER_HEARTBEAT_URL`) | every 60 s | `Authorization: Bearer` `MANAGER_HEARTBEAT_TOKEN` | Health shape plus `sentAt`; only `204` is success. Contract `manager-heartbeat.md` in the legacy system repo. |
| Hosted worker logs query (the provider's account-level telemetry query endpoint) | on a logs request | `Authorization: Bearer` `MANAGER_CF_TOKEN` | Events view, filter on the worker name, last hour, `limit` = lines; 15 s timeout. |

### C. Commands run on other hosts (ssh)
- `ssh -o BatchMode=yes -o ConnectTimeout=10 -- <host> journalctl -u <unit> -n <lines> --no-pager` for logs (15 s timeout, 4 MB buffer).
- `ssh` with the same options running a catalog `command` for actions (2 min timeout, killed after). Shipped commands: `sudo systemctl restart <unit>` for three units, and a PowerShell call on the venue laptop to a kiosk restart script (it exits 1 if the kiosk did not come back).

### D. Discord commands and event handlers
None in this repo. Discord is reached only through canccubot's `POST /alert` and a webhook. The bot's Acknowledge button calls `POST /api/events/<id>/ack` (implemented in canccubot).

### E. WebSocket and SSE channels
None. Action output is a streamed (chunked) plain-text HTTP response, not SSE. The page refreshes with a meta tag.

### F. Messages and bus events
None: there is no bus. The `events` table holds state-change records; alerts are HTTP posts (B).

### G. Scheduled and background jobs

| Job | Cadence | What it does |
|---|---|---|
| Poller | every 30 s after the previous cycle ends (never overlaps), first run at start | F1–F3, writes meta `last_poll`. |
| Auto-restart pass | after each poll cycle | F14; a running action is awaited inside the cycle. |
| Alert pass | after each poll cycle, after auto-restart | F7–F10; reminders every 30 min. |
| Heartbeat push | at start and every 60 s | F15; off when URL or token is unset. |
| Page refresh | 30 s meta refresh in the browser | F4. |

## Data
One SQLite file (`MANAGER_DB`, default under the state directory), WAL mode, 5 s busy timeout, schema version in `user_version` (now 4). Migrations run inside a transaction at open. Everything is **global** in the legacy model: the manager watches one event's hosts and has no notion of an event.

| Table (migration) | Columns or keys | Per event or global | Retention |
|---|---|---|---|
| `subsystem_state` (v1) | `name` PK, `status`, `pending_status` (debounce), `version`, `uptime_seconds`, `checks_json`, `last_seen`, `last_change` | Global (platform services); one row per subsystem | Overwritten each poll |
| `events` (v1, v2) | `id` PK autoincrement, `name`, `at`, `from_status`, `to_status`, `failing_check` (also carries the auto-restart "gave up"/"blocked" text), `message`, `acked_at`, `acked_by` (v2); index on (`name`, `id`) | Global; would be per tenant only where a status concerns one event | Kept forever |
| `mutes` (v2) | `name` PK, `muted`, `by`, `at` | Global; seeded with the cast relay muted | Overwritten |
| `alert_log` (v2) | `event_id` PK, `last_sent_at`, `route` (`bot`, `webhook`, `failed`, `muted`, `silent`, and `legacy` for events from before v2) | Global | Kept forever |
| `meta` (v2) | `key` PK, `value`; one key: `last_poll` | Global | Overwritten |
| `actions` (v3) | `id` PK autoincrement, `name`, `action`, `caller`, `at`, `finished_at`, `exit_code`, `warnings_json`, `auto`; index on (`name`, `id`) | Global; the attempt counter of F14 reads it | Kept forever |
| `autorestart_state` (v4) | (`subsystem`, `action`) PK, `nonok_since`, `polls`, `gave_up` | Global | Overwritten |

- **Personal data:** `acked_by`, `mutes.by` and `actions.caller` hold whatever the caller declared (`X-Caller`), or `page`, `auto`, `migration`.
- **Venue rather than event:** the kiosk display restart, its script on the venue laptop, the `screen-poll` trigger and the live-cast warnings concern the venue's projector PC (a device), not the event. The ssh host roles (venue laptop) are venue infrastructure.
- **Not stored:** the health facts `castLive` and `emergencyDirective`. The auto-restart plan proposed a `facts_json` column; it was never added.

## Configuration

### Environment (`deploy/env.example`, read by `src/lib/config.ts`, `src/lib/alerts.ts`, `src/lib/heartbeat.ts`, `src/lib/logs.ts`)

| Variable | Default | Meaning |
|---|---|---|
| `MANAGER_HOST` | none (required) | Bind address, the tailnet address. `0.0.0.0` or `::` is refused unless `MANAGER_ALLOW_ANY_HOST` is `1`. |
| `MANAGER_ALLOW_ANY_HOST` | unset | `1` allows an all-interfaces bind (development). |
| `MANAGER_PORT` | `8090` | Listen port. |
| `MANAGER_TOKENS` | empty (then every API call is 401) | Secret. Comma-separated `client:token` pairs; the client name is parsed but never used. |
| `MANAGER_DB` | a path under `/var/lib/canccumanager/` | SQLite file. |
| `MANAGER_CONFIG` | `config/subsystems.yaml` | YAML config path. |
| `MANAGER_BOT_ALERT_URL` | canccubot health URL's origin + `/alert` | Bot alert endpoint. |
| `MANAGER_BOT_TOKEN` | unset (then no bot route) | Secret. Bearer token the bot accepts. |
| `MANAGER_WEBHOOK_URL` | unset (then no webhook route) | Secret. Discord webhook of the admin channel. |
| `MANAGER_LINK` | empty | Status page URL put into alerts. |
| `MANAGER_HEARTBEAT_URL` | unset (then no push) | Heartbeat endpoint on the signup site. |
| `MANAGER_HEARTBEAT_TOKEN` | unset (then no push) | Secret. Must match the signup site's secret. |
| `MANAGER_CF_TOKEN` | unset (then `502 log_fetch_failed`) | Secret. API token with read access to the hosted worker's logs. |
| `MANAGER_CF_ACCOUNT` | unset | Hosting account id for the logs query. |
| `NODE_ENV` | `production` in the unit | Set by the unit only. |

Development uses a `.env` loaded by the `dev` script.

### Config file `config/subsystems.yaml` (schema in `src/lib/config.ts`; unknown keys fail at start)
- `redact`: list of regex sources, applied case-insensitively and globally to every log and action output line; each match becomes `[redacted]`. Shipped: 4 patterns (bearer tokens, `key=value` secrets with common secret key names, Discord webhook URLs, three-part dotted token shapes).
- `subsystems`: a map keyed by one of five fixed names (`canccusignage`, `tourney`, `canccubot`, `canccustream`, and the signup-site key). Per entry:
  - `healthUrl` (optional URL; absent means "not deployed", always `down`);
  - `host` (ssh target; a tailnet name, or a marker for the hosted site);
  - `logs` (optional): `{type: ssh, unit, distro?}` or `{type: cloudflare, worker}`; names must be plain identifiers;
  - `actions`: map of action name to `{label, command, host?}`; `host` defaults to the subsystem's host.
- `autoRestart`: list of policies, each `{subsystem, action, when?, confirmPolls, cooldownSeconds, maxAttempts, guard}`, with `when` = `{check, nonOkForSeconds, andOk}`. Defaults: `confirmPolls` 2, `cooldownSeconds` 120, `maxAttempts` 3 (per fixed 30-min window), `guard` true, `andOk` empty. Load-time rules: the subsystem must be configured, the action must be in its catalog, and `guard: false` needs `when`.
- All keys, one by one: `redact`, `subsystems`, `healthUrl`, `host`, `logs`, `type`, `unit`, `distro`, `worker`, `actions`, `label`, `command`, `autoRestart`, `subsystem`, `action`, `when`, `check`, `nonOkForSeconds`, `andOk`, `confirmPolls`, `cooldownSeconds`, `maxAttempts`, `guard`.
- Shipped values: 5 subsystems (4 with a health URL, 4 with a log source, 3 ssh units and 1 hosted worker), 4 actions (3 service restarts, 1 kiosk display restart), 1 policy.

### Constants in code (not configurable)
Poll interval 30 s; health timeout 5 s; debounce 2 polls; reminder interval 30 min; alert post timeout 5 s; heartbeat 60 s with `degraded` after 90 s and `down` after 300 s; action timeout 2 min; crashed-action window 4 min; auto-restart window 30 min; logs timeout 15 s, hosted logs window 1 h; page event lookback 200; per-subsystem event list 20; list limits 50 default, 200 max; log lines 100 default, 1000 max. The guarded subsystems (signage, cast relay) and guarded actions (`restart`, `restart-display`) are hard-coded.

### Deployment config
`deploy/canccumanager.service`: runs as a no-login system user from a checkout under `/opt`, env file readable by root only, `StateDirectory` for the DB, restart on failure after 5 s, and `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices` and related options. `deploy/README.md` adds a sudoers rule that lets the deploy user only reload systemd and restart this unit; the service user needs an ssh key on the other hosts, journal read access there, and sudo for the restart commands.

## External integrations

| Integration | Used for | Needs |
|---|---|---|
| Health endpoints of the five subsystems | F1 | Reachable over the tailnet; the health contract shape. |
| canccubot `POST /alert` | F8 | Bot URL and a shared bearer token; the bot DMs the crew and offers Acknowledge. |
| Discord webhook | F8 fallback | A webhook URL of the admin channel (secret). |
| The signup site heartbeat endpoint | F15 | URL and a shared bearer token; the site watches for missing beats (the dead-man's switch). |
| Hosted worker logs API | F11 for the signup site | An API token with logs read access and the account id. |
| ssh to the venue laptop and the bot guest | F11, F12, F14 | A key for the service user authorised on those hosts, journald read rights, sudo for `systemctl restart`, and PowerShell on the venue laptop (sshd runs inside WSL there). |
| Tailscale | Bind address, MagicDNS names | The tailnet; ACLs are the only guard of the page. |
| Git checkout | F15 version | Reads `.git` of the working directory for the short commit. |
| Files and media | none | No files or media are stored or served. |
| Devices | the projector kiosk on the venue laptop | Restarted through its script; observed only through the signage health check `screen-poll`. |

## Tests
Vitest, Node environment, all in `tests/`. 9 files, 95 tests (counting `it.each` rows), all passing on a clean copy at `def9bd721b`. Dependencies are injected (fetch, ssh runner, clock), and the DB is an in-memory SQLite.

| File | Tests | Covers |
|---|---:|---|
| `tests/state.test.ts` | 5 | Debounce: first observation, blip ignored, two agreeing polls, A→B→A flicker, recovery. |
| `tests/health.test.ts` | 8 | Health fetch against a local http server: ok, degraded, 503 with a valid body, garbage and wrong shapes, timeout, unreachable host without naming it, no health URL. |
| `tests/poller.test.ts` | 3 | One event after two `down` polls with the failing check; last known version kept while unreachable; at most 20 events newest first. |
| `tests/config.test.ts` | 8 | The shipped YAML has exactly the five names with their catalogs; unknown key and unknown field rejected; bind address required, all-interfaces bind refused without opt-in, defaults, bad port; token parsing. |
| `tests/api.test.ts` | 7 | Status and subsystem bodies against a zod copy of the contract, never-polled subsystems, unknown name; auth 401 and 403 cases. |
| `tests/logs.test.ts` | 10 | Redaction of the shipped patterns; every subsystem but the cast relay has a log source; bad regex and unsafe unit rejected; `lines` parsing; the fixed journalctl call; redaction before return; no source; ssh errors hidden; hosted logs ordering and missing credentials. |
| `tests/actions.test.ts` | 7 | `confirm` required; unknown subsystem or action; catalog command on the catalog host, caller and exit code logged, output redacted; one action at a time; live-cast warnings need `confirmWarnings` and are recorded; the guard fails closed on a missing fact; warnings only for guarded subsystems and actions. |
| `tests/autorestart.test.ts` | 18 | The kiosk policy: 60 s threshold, no facts needed, `readiness` must be ok, timer reset on recovery, cooldown, cap and "gave up" announced once, resume after recovery, never when muted, counters survive an engine restart; a guarded service policy runs only with both facts `false` and blocks once otherwise (5 cases); config defaults, off by default, rejected entries. |
| `tests/alerts.test.ts` | 29 | Start and recovery sent once; pre-alert events not announced; muted events never announced; one message per incident start, first escalation and recovery; reminders (cadence, current state, incident start, labelled on the webhook, silenced by ack across silent changes, stop on recovery, retry of undeliverable alerts); cast relay seeded muted; route choice and fallback; bot URL derivation; webhook text; mute and ack bodies; events `limit`; heartbeat shape, degradation and push; Origin rule and the page form routes. |

**Gaps that matter for the port:**
- No test renders the page or calls the Astro endpoints over HTTP (except the two page form handlers); the broken confirm dialog (P1) went unnoticed because of this.
- `src/server.ts` wiring is untested: nothing checks that health facts reach the auto-restart engine (they do not; P2).
- No migration test (the auto-restart plan promised one for v3→v4).
- The real ssh runner, its timeout and killing, and stream handling when the client disconnects are untested.
- The "unknown subsystem" auto-restart config case uses a configured subsystem without that action, so it repeats the "unknown action" case; the real unknown-subsystem check is untested. The logs test named after the `wsl.exe` wrapper now asserts there is none; the `distro` branch is untested.
- No test for the heartbeat start-up path or `readVersion`.
- Tests read the shipped YAML, so they encode event-specific unit and host names; a port needs fixtures from `events/demo/`.

## Known problems
Found in the code, the plans and the history. "Confirmed" means reproduced for this inventory; "from the code" means read, not reproduced.

- **P1. The page's action buttons run without confirmation (confirmed).** The inline confirm handler is escaped twice, so the browser gets invalid JavaScript, the handler never runs and the form submits at once. Rendered on a clean copy, the handler text starts `return confirm(&#38;quot;`. With it, the live-cast warning in the dialog is never shown, and `POST /ui/action` always sends both confirmations.
- **P2. Guarded auto-restart can never run (from the code, documented).** The engine reads `castLive` and `emergencyDirective` through an injected source; `src/server.ts` passes none and nothing stores them, so every guarded policy only records "blocked". It is fail-closed on purpose until the health contract and signage emit the facts (open legacy issues), and none is configured.
- **P3. Two guard vocabularies.** Manual-action warnings read checks named `cast_live` and `emergency_directive`; the auto-restart guard reads the booleans `castLive` and `emergencyDirective`. The plan left the manual side for a separate issue.
- **P4. Auto-restart events break the state chain (from the code).** "Gave up" and "blocked" are written as events from the current status to `down` while the subsystem's state does not change. So the history shows a change to `down` that never happened, the next real event's `from` does not match it, and until that next real change the reminders report the subsystem as `down` (for example while it is only `degraded`).
- **P5. Long actions stall polling (from the code).** The auto-restart pass awaits the ssh command (up to 2 min) inside the poll cycle, delaying the next poll; past 90 s the manager's own heartbeat reports `degraded`.
- **P6. Weak identity and rights.** Any token may call any endpoint, including restarts (the per-client allowlist planned for when actions arrived was not built); the recorded actor is the self-declared `X-Caller`; the page forms need no token at all, and a missing Origin is accepted, so anything on the tailnet can mute, ack and restart.
- **P7. Failed recovery alerts are lost.** A delivery that no route takes is recorded as `failed`; reminders retry only non-ok, unacknowledged incidents, so a failed recovery message is never sent.
- **P8. Blind spot after a service restart** (documented in the auto-restart plan): signage reports `screen-poll` ok until the kiosk first polls, so a dead kiosk after a service restart never triggers the display restart.
- **P9. Deviation from the plan:** the plan wanted one alert per automatic attempt; the code sends none (the deploy notes say so).
- **P10. Heartbeat looks healthy before the first poll:** start-up writes `last_poll` with the start time.
- **P11. Unbounded tables:** `events`, `actions` and `alert_log` are never pruned.
- **P12. Hard-coded names:** the five subsystem names are a fixed enum, the guarded subsystems and actions are hard-coded, and the bot's alert URL is derived from the subsystem named `canccubot`.
- **P13. Config holds raw remote commands.** The action `command` is free text run by a remote shell; only unit, distro and worker names are validated. Safe while the config is trusted, but it is the executor the roadmap wants designed, not ported.
- **Incidents in the history:** alerts on every state change were too noisy and were cut to start, first escalation and recovery (`3754623`); reminders showed the latest change instead of the incident start (`4dd0775`); the `wsl.exe` wrapper for ssh commands was wrong because sshd runs inside WSL, and the guard was made fail-closed (`2b05b2b`). The earlier Python generation had fixes to its host-agent env loading and health facets (`7200020`, `45b696a`, `fd57392`) before it was deleted.
- **No TODO, FIXME or HACK markers** in the tree.

## Port recommendation
Target module: **admin** (roadmap step 8, Admin operations) unless noted. Verdicts refine the porting plan row in the roadmap; the summary (#76) updates it.

| Feature | Verdict | Reason | Target and step |
|---|---|---|---|
| F2 Debounce state machine (`src/lib/state.ts`) | Port as-is | Pure, small, well tested. | admin, step 8 |
| Log redaction (`redactLine` and the pattern list) | Port as-is | Pure; the patterns are generic. Belongs in the kit so every module's log view uses it. | kit, step 8 |
| F1 Health polling and parse | Port with changes | Poll every module's `/api/<module>/health` through the kit's health shape instead of tailnet URLs; keep the synthetic `down` mapping and generic messages. | admin, step 8 (the step-1 health view is the start) |
| F3 State-change events | Port with changes | Becomes a bus event (for example a health-changed event) with `tenant` where it concerns one event; history in Postgres. | admin, step 8; name in the event catalog (step 2c) |
| F7, F9 Alerts and reminders | Port with changes | Keep the incident rules and use its alert tests as the spec; publish alerts as events that the bot consumes instead of an HTTP post; fix P4 and P7. | admin and bot, steps 6 and 8 |
| F8 Webhook fallback | Port with changes | Still needed when the bot itself is down; the target channel becomes a setting per alert audience. | admin, step 8 |
| F10 Mute, F6 ack and history | Port with changes | Actor from the signed-in user, not a header; per tenant where the subject is per tenant. | admin, step 8 |
| F14 Restart policy | Port with changes | Keep the engine (trigger, cooldown, window cap, gave-up, fail-closed guard) on top of the new executor; the guard reads live state of every tenant that a restart would affect (P2, P3). | admin, step 8 |
| F12, F13 Action catalog and log | Rewrite | The roadmap says the executor is designed first; ssh commands, sudo and Windows scripts are dropped by [0010](../decisions/0010-scope.md). The log becomes part of the audit log. | admin executor, step 8 |
| F11 Log sources | Rewrite | Containers log to the runtime, not journald on other hosts; logs tagged with the tenant ([0013](../decisions/0013-multi-tenant-core.md), item 28). | admin and kit, step 8 |
| DB layer (`src/lib/db.ts`) | Rewrite | SQLite to Postgres with row-level security where tables are per tenant. | admin, step 8 |
| F4 Status page | Rewrite | Becomes the admin health view (already started in step 1) with sign-in; fixes P1. | admin, steps 1 and 8 |
| F5, F16 Status and heartbeat API | Port with changes | Shapes are a fair start for the admin contract; auth by sign-in and service tokens from the kit. | admin contract, step 8 |
| Kiosk display restart and `screen-poll` trigger | Rewrite | A device concern: Screen owns devices and their health (online, last seen); a restart of the projector browser is a device command, not an ssh script. | screen, step 3 (device health) and step 8 (policy) |
| Live-cast guard | Port with changes | The idea stays; the facts come from Cast and Moments events. | admin, step 8; Cast track |
| F15 Heartbeat push to the signup site | Drop | Dropped by [0010](../decisions/0010-scope.md) (the manager's dead-man's switch); the outside watchdog of step 10 replaces it. | — (step 10 watchdog) |
| Hosted worker log source | Drop | The signup site stays outside the platform ([0005](../decisions/0005-signup-site-stays-outside.md)). | — |
| Cast relay subsystem entry and its seeded mute | Drop | The relay belongs to the Cast track; its health comes with the cast module. | — |
| F6 bearer tokens and `X-Caller` | Drop | Replaced by Discord sign-in, rights and kit service auth (steps 1 and 2b). | — |
| F17 Tailnet-only bind | Drop | The platform runs behind Caddy on a hosted VM ([0011](../decisions/0011-hosting-on-remote-vm.md)). | — |
| F18 systemd unit, deploy notes, CI | Drop | Replaced by Compose, setup and the new CI. | — |

## Tenancy questions
1. **Whose health is it?** The manager watches services. On one shared stack a module container serves every tenant, so module health is global and belongs to the superadmin. Is there a per-tenant status view ([0013](../decisions/0013-multi-tenant-core.md), item 28), and what does it show: the global module health, or only health facts scoped to the tenant (its bot connection, its screens)?
2. **Who receives alerts?** Global module alerts go to the superadmin; tenant-scoped alerts (its devices, its own bot token failing) go to that event's admins. Through which bot connection and guild: the shared platform bot in a platform guild, or the tenant's bot?
3. **Mute and ack scope:** a global mute silences an alert for every tenant. Should a tenant admin be able to mute or ack only the tenant-scoped alerts, and the superadmin the global ones?
4. **Restarts affect everyone.** Restarting a module container interrupts every tenant. Is a container restart (manual or automatic) superadmin-only, and must its guard check live state across all tenants (a live cast or emergency in any tenant)? This mirrors the rule that deploys wait while any tenant is live (item 22).
5. **Device actions are per venue.** The kiosk restart concerns a device at a venue. Devices are global rows with a current tenant (item 34). May the current tenant's admins restart their device, or only the superadmin who manages venues?
6. **Logs per tenant:** if logs are tagged with the tenant, may an event admin read the lines of their own tenant, and are untagged lines superadmin-only? Redaction patterns stay global.
7. **Event history and GDPR:** `acked_by`, mute `by` and action callers become user ids. Do they fall under the pseudonymisation rule for the audit log (item 31), and what is the retention of health history (legacy: forever)?
8. **Auto-restart policies:** global config (part of the stack), or settings per tenant for the tenant-scoped kinds (device restarts)?
9. **Outside watchdog:** the step-10 watchdog is global; does it also expose status per tenant to organizers, or only to the superadmin?

## Event-specific content
Counted by kind only. The exact locations (`file:line` in the legacy repo) are listed in the PR that added this file, for a follow-up issue in the event repo; values are not repeated here or there ([0003](../decisions/0003-event-content-scrubbed.md)).

| Kind | Count |
|---|---|
| Signup site domain (in URLs) | 4 lines in 3 files |
| Subsystem key equal to the org name | 13 lines in 7 files (also in code and tests) |
| Tailnet host names used as hosts (venue laptop, bot guest, manager container) | 3 names, at least 19 lines in 5 files |
| Admin channel name | 3 lines in 3 files |
| Personal account name | 15 lines in 6 files |
| Hypervisor and container id of the manager container | 2 lines in 2 files |
| Venue laptop file path of the kiosk script | 3 lines in 3 files |
| Game name in the tourney unit | 3 lines in 2 files |
| Tailnet address placeholder | 1 line |
| Discord ids, real IP addresses | none (only loopback and test placeholders) |
