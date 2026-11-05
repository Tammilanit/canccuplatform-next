# Legacy inventory: canccuplatform

The legacy system repo, read in full so the product owner can confirm what exists before the tenancy foundation ([#47](../roadmap.md#2b-tenancy-foundation)) and the contracts ([#36](../roadmap.md#2c-event-catalog-and-screen-contract)) are designed. Roadmap step 2a, issue #68. Other legacy repos are out of scope here; each has its own inventory (#69 canccubot, #70 canccumanager, #71 canccusignage, #72 the signup site, #73 thefinals_mini_tourney, #74 canccudocs, #75 canccustream), and the summary (#76) joins them.

Nothing here is copied from the legacy repo: it is described. Short identifiers (route paths, table and column names, env var names, cue ids) are kept so the port can find them. Event-specific values are named by kind and counted only (see [Event-specific content](#event-specific-content)).

## In short

- **What it is.** The legacy system repo: a map of the other repos, the cross-repo contracts, plans, one runbook, one systemd unit, and the operator scripts (status, logs, restart, deploy over SSH). It runs no service, holds no data and has no migrations.
- **What it ties together.** Five running pieces on three kinds of host: the signage server and the mini-tourney inside WSL2 on a venue laptop, the Discord bot on a home-server guest, the signup site on a hosted serverless platform, and the planned manager on its own home-server container. The links between them are tailnet HTTP, bearer tokens and one browser `postMessage` protocol, all written down here as contracts.
- **Size.** 36 tracked files, 3730 lines; 63 commits from 2026-10-15 to 2026-10-30, one author. Read at commit `d5e3bb4d01` (`main`, 2026-10-30).
- **Port verdict.** Almost nothing ports as code. The scripts, unit, runbook and Windows steps are dropped ([0010](../decisions/0010-scope.md)). The contracts are the valuable part: they are the most exact description of how the legacy pieces talk, and each one feeds a new contract (Screen #35, event catalog #34, the module contracts written at the start of each port).

## Coverage

Every tracked file was read in full; nothing was skipped. "Lines" is `wc -l`.

| Directory | Files | Lines | Files read |
|---|---|---|---|
| `/` (root) | 3 | 59 | `.gitignore`, `.lycheeignore`, `CLAUDE.md` |
| `.github/workflows/` | 1 | 38 | `.github/workflows/ci.yml` |
| `deploy/` | 2 | 40 | `deploy/README.md`, `deploy/thefinals-tourney.service` |
| `docs/` | 1 | 15 | `docs/lessons.md` |
| `docs/contracts/` | 10 | 1184 | `docs/contracts/.gitkeep` (empty), `docs/contracts/admin-link-auth.md`, `docs/contracts/health.md`, `docs/contracts/lan-display-views.md`, `docs/contracts/manager-api.md`, `docs/contracts/manager-heartbeat.md`, `docs/contracts/screen-postmessage.md`, `docs/contracts/signage-control-api.md`, `docs/contracts/site-api.md`, `docs/contracts/tourney-api.md` |
| `docs/plans/` | 7 | 1673 | `docs/plans/PLAN_15_LOW_LATENCY_CASTING.md`, `docs/plans/PLAN_17_CANCCUMANAGER_REBUILD.md`, `docs/plans/canccumanager.md`, `docs/plans/issue-16.md`, `docs/plans/issue-53.md`, `docs/plans/issue-71.md`, `docs/plans/pizza-orders-v1.md` |
| `docs/runbooks/` | 1 | 93 | `docs/runbooks/thefinals-tourney-venue.md` |
| `docs/upstream/` | 1 | 25 | `docs/upstream/thefinals_mini_tourney.md` |
| `scripts/` | 10 | 603 | `scripts/lib.sh`, `scripts/deploy.sh`, `scripts/deploy.ps1`, `scripts/logs.sh`, `scripts/logs.ps1`, `scripts/restart.sh`, `scripts/restart.ps1`, `scripts/status.sh`, `scripts/status.ps1`, `scripts/test-deploy-guard.sh` |
| **Total** | **36** | **3730** | |

By kind: source 10 (6 bash, 4 PowerShell, 603 lines); config 4 (CI workflow, systemd unit, `.gitignore`, `.lycheeignore`); migrations 0; tests 1 (`scripts/test-deploy-guard.sh`); docs 21. The git history was read too (63 commit subjects, the bodies of the `fix` commits); no files were ever deleted. Untracked paths the docs mention (`docs/handoffs/`, sibling clones listed in `.gitignore`) do not exist in the repo.

## Features

This repo serves nothing itself. Its features are either operator tools that run from a dev PC, or cross-repo features it defines as contracts and that other repos implement. "Where" is the path in this repo; "Reached by" is how a person or service gets to it.

### Operator features (implemented here)

| # | Feature | Where | Reached by |
|---|---|---|---|
| O1 | Service status: `systemctl is-active` of one unit over SSH, exit 0 only when active | `scripts/status.sh`, `scripts/status.ps1`, `scripts/lib.sh` | Command `status.sh --service signage\|bot\|tourney\|manager` (PowerShell: signage, bot, tourney only) |
| O2 | Service logs: last N journal lines (1–5000, default 100) of one unit over SSH | `scripts/logs.sh`, `scripts/logs.ps1` | Command `logs.sh --service … [--lines N]` |
| O3 | Service restart: `sudo systemctl restart` of one unit, with a prompt | `scripts/restart.sh`, `scripts/restart.ps1` | Command `restart.sh --service … [--yes]` |
| O4 | Deploy: one SSH call runs a remote script with named steps (sync to `origin/main` with a hard reset, Node check, install, build, version, restart, kiosk); a failure names the step | `scripts/deploy.sh`, `scripts/deploy.ps1` | Command `deploy.sh --service …`; the `deploy` workflow word |
| O5 | Deploy guard: `--yes` (PowerShell `-Confirm:$false`) is refused unless `DEPLOY_CONFIRM` equals the service; a non-interactive run without it fails with a clear message | `scripts/deploy.sh`, `scripts/deploy.ps1`, `docs/lessons.md` | Same commands |
| O6 | Host Node check before install for npm services (minimum from `engines.node`, else the `.nvmrc` major); never upgrades Node | `scripts/deploy.sh` (bash only) | Deploy of signage, tourney, manager |
| O7 | Bot health binding: deploy writes a systemd drop-in with `BOT_VERSION` (short git sha), `HEALTH_PORT=8080` and `HEALTH_HOST` (the guest's tailnet IPv4) | `scripts/deploy.sh`, `scripts/deploy.ps1` | Deploy of the bot |
| O8 | Kiosk reload after a signage deploy: kill the kiosk browser, wait 3 s, start the kiosk scheduled task on Windows; the "restart display" action the manager was to reuse | `scripts/deploy.sh`, `scripts/deploy.ps1`, `docs/lessons.md` | Deploy of signage |
| O9 | Manager deploy with a sudoers pre-check (the deploy user may run only `daemon-reload` and the unit restart) | `scripts/deploy.sh`, `deploy/README.md` | `deploy.sh --service manager` (bash only) |
| O10 | SSH hard timeout per call (`CANCCU_SSH_TIMEOUT`, default 120 s), failing with the step name; WSL wrapping (`--distro`) for Windows OpenSSH hosts | `scripts/lib.sh` | All bash scripts |
| O11 | Mini-tourney host setup: systemd unit (user substituted at install, secrets in a root-only env file), venue LAN exposure via a Windows port proxy 80 → 3000 and a firewall rule, DNS-only record for a LAN hostname, on-site checklist | `deploy/thefinals-tourney.service`, `docs/runbooks/thefinals-tourney-venue.md` | Manual runbook |
| O12 | CI: PowerShell static analysis, shellcheck, markdown link check | `.github/workflows/ci.yml`, `.lycheeignore` | Every PR and push to `main` |
| O13 | Workflow: the one-word commands (`issues`, `<n>`, `execute`, `finish`, `ship`, `pause`, `resume`, `groom`), standard issue body, ready chain, contracts-first rule, lessons | `CLAUDE.md`, `docs/lessons.md` | Claude Code sessions |
| O14 | Upstream rules for the mini-tourney repo (minimum changes by PR, no tooling files there, issues tracked here with a `tourney` label, `npm test` as the only gate) | `docs/upstream/thefinals_mini_tourney.md`, `CLAUDE.md` | Sessions in the tourney clone (loaded through an untracked local file) |
| O15 | System map: repos, hosts, network paths, contract list | `CLAUDE.md` | Reading |

### Cross-repo features (defined here, implemented elsewhere)

| # | Feature | Who sees it | Contract or plan | Implemented by | Reached by |
|---|---|---|---|---|---|
| X1 | Shared health shape (`status`, `version`, `uptimeSeconds`, `checks[]`; 503 when down; nothing internal exposed) | Operators, the manager, the bot | `docs/contracts/health.md` | signage, bot, signup site, tourney | `GET /api/healthz`, `/healthz`, `/api/health` |
| X2 | Admin login link from Discord: a signed one-time token opens a signage admin session | Admins | `docs/contracts/admin-link-auth.md` | bot (`/adminlink`), signage | Discord command, then `GET /admin/link` |
| X3 | Screen control: directives (web, asset, stream) with TTL, labels, band ranking, ticker, 409 when a higher band holds the screen | Everyone at the venue (the big screen) | `docs/contracts/signage-control-api.md` | signage (provider), bot (caller) | `/api/control/override` |
| X4 | Bot trigger settings edited at the venue (hot-game threshold, banner times, poll and announce times) | Crew | `docs/contracts/signage-control-api.md` | signage stores, bot reads | `GET /api/control/triggers` |
| X5 | Hot-game banner: one banner per episode when enough players play the same game; per-game cooldown | Everyone | `docs/contracts/signage-control-api.md` (bot policy) | bot | Bot timer, `label: hot_game` |
| X6 | Photo carousel and spotlight from Discord posts | Everyone | `docs/contracts/signage-control-api.md` | bot, signage | `/api/carousel/*` |
| X7 | Finals takeover cards: full-screen "registration open" and "lobbies open" cards for a mini-tourney season, held for the phase window | Everyone | `docs/contracts/lan-display-views.md`, `docs/contracts/signage-control-api.md`, `docs/contracts/site-api.md` | bot (watcher), signup site (state, page), signage | `PUT /api/display/finals`, `?view=finals_open\|finals_start` |
| X8 | LAN display page: stats (presence, voice, games, trends), poll, poll result, game banner, announce, tournament leaderboard, finals cards; 30 s poll | Everyone (embedded in the screen) | `docs/contracts/lan-display-views.md` | signup site | `/lan-display?view=…` |
| X9 | Screen messages from the embedded page: ready (fallback image after 8 s), page progress, sound cues | Everyone (sound and progress bar) | `docs/contracts/screen-postmessage.md` | signup site (sender), signage (receiver) | `window.postMessage` |
| X10 | Catch-up cues: the screen plays a missed "tournament next" or "pre-tournament" cue later, once, inside a window; off by default | Everyone | `docs/contracts/signage-control-api.md`, `docs/contracts/screen-postmessage.md`, `docs/plans/issue-71.md` | signage | `GET /api/screen/state` field `catchUp` |
| X11 | Pizza ordering: group orders, one open at a time, holder/claim/release, placed, bill, payer, daily record and CSV, Discord webhook posts | Attendees, the orderer, the admin | `docs/contracts/site-api.md`, `docs/plans/pizza-orders-v1.md` | signup site, bot (`/pizza order`, `/pizza claim`) | `/pizza`, `/pizza/orderer`, `/admin/pizza`, `/api/pizza/*` |
| X12 | Pizza ticker and pizza sound cues on the screen | Everyone | `docs/contracts/signage-control-api.md`, `docs/plans/pizza-orders-v1.md` | signage (polls the site) | `GET /api/screen/state` field `pizzaCue` |
| X13 | Tournament events, registration, roster, scores, leaderboard with per-route auth | Players, admins | `docs/contracts/site-api.md` | signup site, bot | `/api/tournament/**`, `/tournament register` |
| X14 | Polls and Discord stats snapshots pushed by the bot | Everyone (screen), voters | `docs/contracts/site-api.md` | bot, signup site | `/api/polls*`, `/api/snapshots/*` |
| X15 | Mini-tourney read API and live updates | Bot watcher | `docs/contracts/tourney-api.md` | tourney | `/api/seasons`, `/api/events` (SSE) |
| X16 | Manager: health poller, state history, alerts to Discord with Acknowledge, mute, logs on demand, restart and restart-display actions with a live-cast guard, action log, auto-restart policy (planned; contract written before the code) | Operators, bot admins | `docs/contracts/manager-api.md`, `docs/plans/canccumanager.md`, `docs/plans/PLAN_17_CANCCUMANAGER_REBUILD.md` | canccumanager, bot (`/platform …`, `/alert`) | Tailnet API, status page, Discord |
| X17 | Manager heartbeat: the manager pushes to the signup site every 60 s; a scheduled check alerts a Discord webhook when it stops (planned) | Operators | `docs/contracts/manager-heartbeat.md` | canccumanager, signup site | `POST /api/manager-heartbeat` |
| X18 | Low-latency casting: anyone on the LAN casts a screen, window or tab to the projector over WebRTC through a relay; hooks post the takeover; stall guard; End cast (planned) | Attendees, crew | `docs/plans/PLAN_15_LOW_LATENCY_CASTING.md` | signage with a MediaMTX relay, bot (`/cast`) | Cast page, WHIP, `/cast stop` |
| X19 | Mini-tourney on the venue LAN by hostname | Players | `docs/runbooks/thefinals-tourney-venue.md` | tourney | A LAN hostname, `/admin.html` |

## Interfaces

This repo serves no HTTP, has no Discord client, no socket and no bus. Below, A lists the commands it ships. B to G enumerate every interface its contracts and plans define, with the provider repo; "planned" marks what the contract wrote before any code ("Verified against: not yet implemented"). The provider's own inventory is the authority on the implementation.

### A. Commands shipped here

| Command | Flags (bash; PowerShell equivalents in brackets) | Effect | Exit |
|---|---|---|---|
| `scripts/status.sh` / `status.ps1` | `--service` (required), `--distro`, `--dry-run`/`-n`, host and unit overrides [`-Service`, `-Distro`, `-WhatIf`, `-*Host`, `-*Unit`] | Prints `<service>: <state>` | 0 when active |
| `scripts/logs.sh` / `logs.ps1` | as above plus `--lines N` (1–5000) [`-Lines`] | Prints journal lines | ssh exit |
| `scripts/restart.sh` / `restart.ps1` | as status plus `--yes` [`-Confirm:$false`] | Restarts the unit after a prompt | 1 on failure or abort |
| `scripts/deploy.sh` / `deploy.ps1` | as restart plus `--*-dir` overrides [`-*Dir`] | Remote steps `sync`, `node`, `install`, `build`, `version` (bot), `sudoers` (manager), `restart`, `kiosk` (signage), `done` | 1 with the failed step |
| `scripts/test-deploy-guard.sh` | none | Five cases against a fake `ssh` on `PATH` | 1 on any failure |

Service table (bash defaults; each overridable by `CANCCU_<NAME>` and by flag): signage → venue laptop host, `~/canccusignage`, unit `canccusignage-supervisor`, `npm ci` + `npm run build`; tourney → venue laptop host, `~/thefinals_mini_tourney`, unit `thefinals-tourney`, `npm ci --omit=dev`; bot → bot guest host, `/opt/canccubot`, unit `canccubot`, `.venv/bin/pip install -e .`; manager → manager container host, `/opt/canccumanager`, unit `canccumanager`, `npm ci` + `npm run build`. Unreachable-host messages name the host kind ("check that it is powered and on the tailnet").

### B. HTTP routes

**Signage (provider canccusignage; port `SIGNAGE_HTTP_PORT`, default 4321).**

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /admin/link?token=` | none (the token) | Token `<payload>.<signature>`, base64url; claims `iss` (must be `canccubot`), `aud` (`canccusignage-admin`), `instance_id` (= `SIGNAGE_INSTANCE_ID`), `jti`, `discord_user_id`, `discord_username`, `role_ids[]` (one must be in `DISCORD_ALLOWED_ROLE_IDS`), `iat` (≤ 60 s ahead), `exp` (`exp − iat` ≤ 600 s); HMAC-SHA256 with `DISCORD_LOGIN_LINK_HMAC_SECRET` | `303` to `/admin` with the session and binding cookies; else a "link unavailable" page. Logged reasons `misconfigured`, `invalid`, `expired`, `replay`, `unauthorized`; `jti` single use |
| `POST /api/control/override` | Bearer control token; the token fixes `source` (`bot`, `ops`, `stream`, `emergency`); `Origin`, when sent, must be loopback or in `SIGNAGE_TRUSTED_ADMIN_HOSTS` | JSON `source`, `kind` (`web` with a host in `SIGNAGE_WEB_ASSET_ALLOWED_HOSTS`, `asset` id, `stream` URL), `ttlSeconds` 1–7200, `label`, `message`, `actor`. `label: ticker` instead sets the ticker: `message` or `target`, `ttlSeconds`, `pollExpiresAt` | `200 {success, id, source, compositor}`; ticker `200 {ok, ticker}`; `409 {success:false, error:"override_rejected", data:{active}, retry_after_seconds}` for `hot_game`, `finals_open`, `finals_start` under a higher band; `400` (finals card with no time left); `401`; `403` origin |
| `DELETE /api/control/override?label=&actor=` | as above | none | `200 {ok, source, compositor}`; no label clears all of the caller's directives |
| `GET /api/control/override` | control token or admin session | none | `200 {ok, directives, compositor}` |
| `GET /api/control/triggers` | control token, origin check | none | `200 {ok, gameThreshold, bannerDisplaySeconds, bannerCooldownSeconds, testMode, pollHighlightSeconds, pollResultSeconds, announceDefaultSeconds, finalsOpenSeconds, finalsStartSeconds}` |
| `POST /api/carousel/photos` | Bearer `SIGNAGE_CAROUSEL_TOKEN`; untrusted `Origin` on writes → 403 | multipart `photos[]`, `messageId`, `channelName`, `authorDisplayName`, `postedAt` | `200 {ok, added, rejected}`; `400`; `409` when the carousel playlist is missing |
| `DELETE /api/carousel/photos?messageId=` | as above | none | `200 {ok, removed, filesDeleted, filesKept}` |
| `POST /api/carousel/spotlight` | as above | JSON `{assetId}`, or multipart with one photo plus the metadata above | `200 {ok, assetId, expiresAt}`; `409 {ok:false, error:"screen_busy", currentBase}`; `400`. Duration from the `spotlightDurationSeconds` setting (60) |
| `POST /api/screen/playback-progress` | none; request URL host must be loopback | `{playlistId, playlistItemId?, offsetSeconds ≥ 0, imageIndex?, slideNumber?}` | not specified in the contract |
| `POST /api/screen/youtube-playback-error` | as above | `{assetId, playlistId, playlistItemId?, errorCode, mirror?}` | not specified |
| `POST /api/screen/sound-log` | as above | `{cueId, source?, outcome, reason?, eventAtMs?, catchUp?}` | not specified; resolves catch-up and pizza cue records |
| `POST /api/screen/sound-probe`, `DELETE /api/screen/sound-probe` | as above | `POST` takes `cueId?` | not specified |
| `POST /api/screen/sound-status` | as above | `{audioUnlocked?, soundCheck?}` | not specified |
| `GET /api/screen/state[?mirror=1]` | none, no guard | none | Screen state, `Cache-Control: no-store`; only `generatedAt`, `active.base`, `active.overlay`, `catchUp` (`{cue, source, issuedAt, expiresAt}` or `null`) and `pizzaCue` (`{cue, orderId, state, source, issuedAt, expiresAt}` or absent/`null`) are named. A poll without `mirror=1` counts as kiosk liveness |
| `GET /api/healthz` | none | none | Health shape (X1); `/api/health` and `/api/readiness` are older endpoints whose shape is not in any contract |

**Signup site (provider: the signup site; [0005](../decisions/0005-signup-site-stays-outside.md) keeps it outside the platform).** Writes from the bot carry `Authorization: Bearer <API_SECRET>`, compared in constant time.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/polls` | secret | poll (shape not in the contract) | not specified |
| `PATCH /api/polls/{id}` | secret | `message_id` | not specified |
| `POST /api/polls/{id}/votes` | secret | vote | not specified |
| `POST /api/polls/{id}/close` | secret | none | not specified |
| `GET /api/polls/active` | public | none | not specified |
| `POST /api/snapshots/presence`, `/api/snapshots/voice`, `/api/snapshots/game` | secret | counts; voice channels; games (items may carry `application_id`, `cover_image_url`) | not specified |
| `POST /api/display/announce`, `DELETE /api/display/announce` | secret | `{message, sfx}` (`bell`, `fanfare`, `alert`, `cancel`) | not specified |
| `PUT /api/display/finals` | secret | `{seasonId, name, state (register\|active), format, mode, createdAt, startedAt, capacity, registered, link}` | `204`; `400`; `401`; idempotent; a new `seasonId` replaces the stored one |
| `DELETE /api/display/finals` | secret | none | `204` always; `401` |
| `POST /api/display/stats-history` | secret | `{statsHistory, …}` | not specified |
| `GET /api/display/state` | public | query `trend_seconds`, `include=tournament`, `finals_registration_min`, `finals_started_min` | Always `activePoll`, `latestClosedPoll`, `presence`, `voiceChannels`, `games`, `announce`, `server_now`; optional `statsHistory`, `presencePrevious`, `gamesPrevious`, `trendStateNow`, `trendState96h`, `finals` (`phase` `registration`\|`started` plus the season fields, only inside its window), `tournament` (with the include) |
| `GET /api/health` | public | none | Health shape |
| `POST /api/manager-heartbeat` (planned) | Bearer heartbeat token | Health shape plus `sentAt` | `204`; `400`; `401`; errors `{error:{code, message}}` |
| `GET /lan-display` (page) | public | `?view=` (`stats`, `active_poll`, `poll_result`, `game_banner`/`hot_game`, `announce`, `tournament_leaderboard`, `finals_open`, `finals_start`), `msg`, `sfx`, `season_id`, `season_name`, `window_end`, `trend_seconds`, `include`, `api_base`/`api`, thresholds `hot_game_min` (4), `busy_voice_min` (5), `spike_min` (5), `poll_result_line_min` (10), `tournament_soon_min` (30), `tournament_pre_min` (15), `finals_registration_min` (15), `finals_started_min` (10), `bg_fade_ms` (5000) | HTML page |

Tournament routes, all under `/api/tournament` ("secret" = `API_SECRET`; admin token from `admin_tokens`; registration token from `registration_tokens`; a route taking both tries the secret first). Request and response shapes are not in the contract; see #72.

| Auth | Routes |
|---|---|
| public | `GET /events`, `GET /leaderboard`, `GET /events/{id}/registrants/public`, `GET /events/{id}/scores/public` |
| secret only | `PATCH /events/{id}/status`, `/vc`, `/cleanup`, `/create-now`; `POST /events/{id}/roster`; `GET`/`POST /internal/token`; `GET`/`POST /internal/admin-token`; `GET /internal/users/{user_id}/registrations`; `DELETE /internal/clear` |
| secret or admin token | `POST /events`; `DELETE /events/{id}`; `GET /events/{id}/registrants` |
| admin token only | `PATCH /events/{id}`; `GET /events/{id}/roster`; `GET`/`POST /events/{id}/scores`; `POST /events/{id}/end`, `/start-scoring`, `/debug/create-now`, `/debug/cleanup-now`; `GET /admin/me` |
| registration or admin token | `GET /me`; `GET`/`POST /registrations`; `DELETE /registrations/{event_id}` |

The bot uses, with the secret: `GET`/`POST /api/tournament/events`, `DELETE /api/tournament/events/{id}`, `GET /api/tournament/events/{id}/registrants`, `PATCH /api/tournament/events/{id}/{status,vc,cleanup,create-now}`, `POST /api/tournament/events/{id}/roster`, `GET /api/tournament/leaderboard`, `GET`/`POST /api/tournament/internal/token`, `GET`/`POST /api/tournament/internal/admin-token`, `GET /api/tournament/internal/users/{user_id}/registrations`, `DELETE /api/tournament/internal/clear`.

Pizza routes, all under `/api/pizza` (the signage server reads `GET /api/pizza/status`; the pizza pages read `GET /api/pizza/orders/current` and `GET /api/pizza/orders/{id}`; the contract still says "planned, not yet implemented", although later additive fields (`ingredients`, `me`, `you_hold`) were added to it; whether the site shipped them is for #72; JSON only, writes need `Content-Type: application/json`; errors `{error, message}`; attendee = `Bearer <registration token>`; orderer = the attendee holding the order; admin = the site's admin session, which passes every orderer check).

| Route | Caller | Request | Response |
|---|---|---|---|
| `GET /status` | public, `Access-Control-Allow-Origin: *` | none | `state` (`none`\|`open`\|`closed`\|`placed`\|`cancelled`), `id`, `date`, `seq`, `pizzeria_name`, `orderer_name`, `target_at`, `placed_at`, `pizza_count`, `people_count` |
| `GET /orders/current`, `GET /orders/{id}` | public (token optional) | none | The order with pizzeria, active menu (items carry `ingredients[]`), toppings, base, note, target, holder, `claimed_at`, `placed_at`, `payer_name`, `bill_total_cents`, pizzas (`mine` on own), `you_hold`; `/orders/current` adds `me: {display_name}` with a valid token |
| `GET /pizzerias` | public | none | names and ids |
| `GET /me/bills` | attendee | none | placed orders the caller paid with no bill |
| `POST /orders` | attendee | `pizzeria_id`, `target_at`, `note` | the order; `409 another_open` |
| `POST /orders/{id}/claim` | attendee | none | `409 claimed` with `holder`, `since` |
| `POST /orders/{id}/release` | orderer, admin (logged `force_release`) | none | |
| `PUT /orders/{id}` | orderer, admin | `pizzeria_id` (`409 has_pizzas`), `target_at`, `note`, `placed_at`; admin also `payer_discord_user_id` | |
| `PUT /orders/{id}/bill` | payer, orderer, admin | `bill_total_cents` (0–500000) | `409 not_placed` |
| `POST /orders/{id}/close`, `/reopen` | orderer, admin | none | reopen `409 placed` |
| `POST /orders/{id}/placed`, `/unplace` | orderer, admin | `placed`: `at` | unplace `409 another_open` |
| `POST /orders/{id}/cancel` | orderer, admin; any attendee for an order dated before today | none | `409 placed` |
| `GET /orders/{id}/summary` | orderer, admin | none | counts, who list, copy-as-text |
| `POST /orders/{id}/pizzas` | attendee | `kind` `menu` (`menu_item_id`) \| `custom` (`toppings` 1–4) \| `text` (1–80 chars); `note`, `comment` ≤ 120 | `403 closed` |
| `PUT /pizzas/{id}`, `DELETE /pizzas/{id}` | owner while open; orderer; admin | as above | `403 closed`, `403 not_owner`, `404` |
| `POST /pizzerias`, `PUT /pizzerias/{id}`, `PUT /pizzerias/{id}/menu` | admin | pizzeria fields; menu `{base_name, items[], toppings[]}` | |
| `GET /orders`, `GET /report[?format=csv]` | admin | none | all orders; daily record (CSV with BOM, `;`, decimal comma) |
| `DELETE /orders/{id}` | admin | none | |

Error codes: `400 invalid_body`; `401 token_expired` (else a plain 401); `403 closed`, `not_owner`, `not_orderer`; `404`; `409 another_open`, `claimed`, `has_pizzas`, `placed`, `not_placed`.

**Mini-tourney (provider thefinals_mini_tourney; read-only contract, no auth).**

| Method and path | Response |
|---|---|
| `GET /api/seasons` | Array, newest first: `id`, `name` (≤ 60), `state` (`register`\|`active`\|`finished`), `format` (`twelve`, `nine`, `eight`, `six`, `four`), `created_at` (SQLite UTC text), `team_count`, `mode` (`teams`\|`individual`) |
| `GET /api/seasons/:id` | `season` (adds `started_at`, `finished_at`, arena fields), `capacity`, `individuals.count`, `teams[]` (`id`, `name`, `players` of 3), `champion`; `404`; never edit tokens |
| `GET /api/events` | SSE (section D) |
| `GET /api/healthz` | Health shape, check `database`, version = short sha |

Creating a season while one is not finished is `409`. Write routes and `/admin.html` are outside the contract (#73).

**Manager (provider canccumanager; planned; tailnet only; `Authorization: Bearer` per client plus `X-Caller`; errors `{error:{code, message, warnings?}}`).**

| Method and path | Phase | Request | Response |
|---|---|---|---|
| `GET /api/status` | 1 | none | `{subsystems:[health shape + name, lastChange, muted, actions[{name,label}]]}` |
| `GET /api/subsystems/<name>` | 1 | none | the entry plus `events[]` (last 20: `id`, `at`, `from`, `to`, `message`) |
| `GET /api/subsystems/<name>/logs?lines=` | 4 | `lines` default 100, max 1000 | `{lines[]}` redacted; `404 no_log_source`; `502 log_fetch_failed` |
| `GET /api/events?limit=` | 2 | `limit` default 50, max 200 | `{events:[{id, subsystem, at, from, to, message, acknowledged}]}` |
| `POST /api/events/<id>/ack` | 2 | none; acknowledger = `X-Caller` | the event; `404 not_found` |
| `PUT /api/subsystems/<name>/mute` | 2 | `{muted: boolean}` | the status entry |
| `POST /api/subsystems/<name>/actions/<action>` | 4 | `{confirm:true, confirmWarnings?}`; actions `restart`, `restart-display` (signage only) | streamed output; `400 confirm_required` with `warnings` (`cast_live`, `emergency_directive`); `409 action_in_progress` |
| `POST /api/subsystems/<name>/restart` | 4 | as above | alias of `actions/restart` |
| `GET /api/actions?limit=` | 4 | as events | `{actions:[{id, subsystem, action, caller, at, finishedAt, exitCode, warnings, auto}]}` |
| `POST /api/subsystems/<name>/update`, `POST /api/subsystems/<name>/deploy` | later | | |
| `GET /api/heartbeat` | 2 | none | `{at}`; stale after 3 minutes |

Subsystem keys: `canccusignage`, `canccubot`, `canccustream` (decommissioned, key reserved), `tourney`, and a key named after the signup site. Status codes: `400 invalid_body`, `confirm_required`; `401 unauthorized`; `403 forbidden`, `caller_required`; `404 unknown_subsystem`, `not_found`, `no_log_source`; `409 action_in_progress`; `500 internal`; `502 log_fetch_failed`.

**Bot (provider canccubot; tailnet only).** `GET /healthz` (health shape; checks `discord`, `api`, optionally `signage`). `POST /alert` (planned; manager token) with `{eventId, subsystem, state, failingCheck, since, link}`; the bot's Acknowledge button calls `POST /api/events/<eventId>/ack` on the manager.

**Cast relay (planned, MediaMTX).** WHIP publish on port 8889 path `cast`; local API on loopback port 9997 (`/v3/paths/get/cast` for `inboundBytes`, `/v3/webrtc/sessions/kick/{id}`); WebRTC UDP 8189.

### C. Discord commands and handlers

Implemented in canccubot (#69); named here only.

| Command or handler | Purpose | Source |
|---|---|---|
| `/adminlink` | Mints the signage login link after a role check (lifetime 300 s, fresh `jti`) | `docs/contracts/admin-link-auth.md` |
| `/tournament register` | Mints or reuses the attendee token (7 days) and links the registration page | `docs/contracts/site-api.md` |
| `/pizza order`, `/pizza claim` | Ephemeral link buttons to `/pizza` and `/pizza/orderer` with the same token | `docs/plans/pizza-orders-v1.md` |
| `/platform status [subsystem]`, `/platform logs`, `/platform restart`, `/platform update`, `/platform deploy`, `/platform mute` | Manager through the bot, admin role only (planned) | `docs/plans/canccumanager.md` |
| `/platform event-mode` | Only in the older manager plan; dropped in the newer one | `docs/plans/PLAN_17_CANCCUMANAGER_REBUILD.md` |
| `/stream` → `/cast status`, `/cast stop` | Legacy stream commands to be repurposed for casting (planned) | `docs/plans/PLAN_15_LOW_LATENCY_CASTING.md` |
| Acknowledge button | Acks a manager alert | `docs/contracts/manager-api.md` |
| Alert DM and admin-channel post | On `POST /alert` (DM users in `MANAGER_ALERT_DM_USERS`); bot polls the manager heartbeat each minute | `docs/plans/canccumanager.md` |
| Presence, voice and game watchers | Feed the snapshots (60 s, 30 s, 30 s) | `docs/contracts/site-api.md` |
| Carousel photo handler | Posts photos from a channel to `/api/carousel/photos`; deletes by `messageId` | `docs/contracts/signage-control-api.md` |
| Hot-game detector, finals watcher | Directives for X5 and X7 | `docs/contracts/signage-control-api.md` |
| Discord webhooks (no bot) | Admin-channel webhook: manager fallback and the site's stale-heartbeat alert; pizza channel webhook (`PIZZA_DISCORD_WEBHOOK_URL`), `@everyone` only on the open post | `docs/contracts/manager-heartbeat.md`, `docs/plans/pizza-orders-v1.md` |

### D. WebSocket, SSE and streams

- `GET /api/events` on the mini-tourney: SSE; `: connected` on connect, then `data: update` after every successful non-GET under `/api`; no id, no replay; clients re-read.
- Manager actions "stream" their output; the transport is not specified.
- Cast: WHIP in, WebRTC out (planned).
- No WebSocket anywhere.

### E. Messages and events

There is no bus. The messages are:

- **`postMessage` from the embedded lan-display page to `/screen`** (version 1, sent to `*` only when embedded; the receiver checks the iframe source, an exact hard-coded origin of the signup site, `type` and `version`):
  - `canccu:screen-ready` `{view?}`: once per load. Opt-in per target (`baseline`, `announce`, `poll_result`, `game_banner`, `tournament_leaderboard`, `finals_open`, `finals_start`); with none in 8000 ms the screen shows a fallback image.
  - `canccu:screen-pages` `{pageCount, pageIndex, pageSeconds}`: each page change; leaderboard pages every 20 s (60 s under reduced motion).
  - `canccu:screen-cue` `{cue, source}`: cue ids `chrome.hot`, `chrome.voice`, `chrome.spike`, `strip.tournament_next`, `strip.finals_open`, `strip.finals_start`, `tournament.pre`, `tournament.start`, `tournament.post`; well-formed unknown ids are logged and ignored.
- **Server-issued cues in screen state:** `catchUp` (cues `strip.tournament_next`, `tournament.pre`) and `pizzaCue` (cues `pizza.open`, `pizza.closed`, `pizza.placed`; source `pizza-<orderId>-<state>`).
- **Receiver rules:** dedupe by cue + source with per-cue cooldowns; chip cues within 2 s coalesce; flood guard one per cue + source per 10 s and 20 per minute; mirror messages dropped first; drop reasons `mirror`, `flood`, `dedupe`, `busy`, `expired`, `stale`; `oncePerSource` memory for 7 days.
- **Manager state-change events and actions** (planned): see the manager table.

### F. Scheduled and background jobs

| Job | Cadence | Runs in | Source |
|---|---|---|---|
| Presence, voice, game snapshots; stats history | 60 s (`PRESENCE_INTERVAL`), 30 s (`VOICE_INTERVAL`), 30 s (`GAME_INTERVAL`), 300 s (`STATS_HISTORY_PUBLISH_SECONDS`) | bot | `docs/contracts/site-api.md` |
| Hot-game episodes | each game snapshot (~30 s); banner 120 s, cooldown 900 s | bot | `docs/contracts/signage-control-api.md` |
| Finals watcher: read the tourney, push or clear the finals state, show and end cards | on tourney updates; clear once after start | bot | `docs/contracts/site-api.md`, `docs/contracts/signage-control-api.md` |
| Signage adapter polls | display state 180 s, tournament 60 s, health 30 s, pizza status 30 s; fetch timeout 10 s | signage server | `docs/contracts/site-api.md` |
| Catch-up decision and record expiry | each screen state build | signage server | `docs/contracts/signage-control-api.md` |
| Sound log and catch-up prune | 7-day retention | signage server | `docs/plans/issue-71.md` |
| lan-display poll; carousel step | 30 s (`POLL_INTERVAL_MS`), 10 s with an active poll (`ACTIVE_POLL_INTERVAL_MS`); 15 s (`ALIVE_DWELL_MS`) | browser | `docs/contracts/lan-display-views.md` |
| Kiosk tick and catch-up gates | 1 s; 30 s spacing | kiosk browser | `docs/plans/issue-71.md` |
| Manager poll, debounce, reminder, heartbeat push, auto-restart (planned) | 30 s; 2 agreeing polls; 30 min; 60 s; cap 3 per 30 min, cooldown 120 s | manager | `docs/plans/canccumanager.md` |
| Stale-heartbeat check (planned) | every 5 min; stale after 10 min | signup site | `docs/contracts/manager-heartbeat.md` |
| Cast hook refresh and stall guard (planned) | 5 s refresh, 15 s TTL, stall 300 s | relay host | `docs/plans/PLAN_15_LOW_LATENCY_CASTING.md` |
| Pizza pages refresh | 20 s | browser | `docs/plans/pizza-orders-v1.md` |
| CI | each PR and push to `main` | GitHub Actions | `.github/workflows/ci.yml` |

Deploys, restarts and status checks here are manual; nothing in this repo runs on a schedule.

## Data

This repo stores no data and has no migrations. The stores below are the ones its contracts and plans name; the owning repo's inventory has the full schema. "Scope" says whether the data is per event, global, or belongs to a venue (or a device at a venue) rather than to an event.

| Store | Owner | Columns or keys | Scope | Retention |
|---|---|---|---|---|
| `sound_log` (SQLite) | signage | `cue_id`, `source`, `outcome`, `reason`, catch-up marker | per event | 7 days |
| `sound_catch_up` (SQLite) | signage | `event_id`, `cue_id` (key), `issued_at_ms`, `expires_at_ms`, `resolved_at_ms`, `outcome` (`played`\|`dropped`), `reason` | per event | 7 days |
| Login-link redemptions (SQLite) | signage | `jti`, user id, time, token expiry; created with the session | per event (identity is global) | not stated |
| Admin sessions, directives and directive history (`actor`), assets, playlists, carousel playlist, settings (trigger, sound incl. `catchUpEnabled`, carousel incl. `spotlightDurationSeconds`) | signage | names only here | per event; the instance is per venue device | not stated |
| `canccu-sound-once-per-source-v1` (browser `localStorage`) | kiosk | handled cue + source pairs | per device at a venue | 7 days |
| `registration_tokens` (D1) | signup site | UUID token, `discord_user_id`, `discord_username`, expiry | per event; maps a global Discord user | 7 days from issue |
| `admin_tokens` (D1) | signup site | token, `expires_at` | per event | until `expires_at` |
| Polls, votes, snapshots, announce, finals season (one row), `statsHistory` blob, tournament events, registrations, rosters, scores | signup site | not in the contracts (#72) | per event | not stated |
| Manager heartbeat (D1, migration `027_manager_heartbeat.sql`) | signup site | last body, receive time | global | last only |
| `pizzerias` (D1) | signup site | `id`, `name` (unique), `phone`, `base_name`, `created_at` | **venue** (pizzerias near the venue; menus reusable across events there) | permanent |
| `pizzeria_menu_items` | signup site | `id`, `pizzeria_id`, `number`, `name`, `sort_order`, `active`; unique (`pizzeria_id`, `name`) | venue | permanent (`active` hides) |
| `pizzeria_toppings` | signup site | `id`, `pizzeria_id`, `name` (case-insensitive unique), `sort_order` | venue | permanent |
| `pizza_orders` | signup site | `id`, `date`, `seq` (unique per date), `pizzeria_id`, `target_at`, `note`, `opened_at`, `opened_by_name`, `closed_at`, `orderer_discord_user_id`, `orderer_name`, `claimed_at`, `placed_at`, `payer_discord_user_id`, `payer_name`, `bill_total_cents`, `cancelled_at`, `cancelled_by_name`, `created_at`; partial unique index allows one open order | per event | permanent (for the bill system) |
| `pizza_order_log` | signup site | `id`, `order_id`, `at`, `discord_user_id`, `display_name`, `event`, `detail` (JSON); append-only | per event | permanent |
| `pizza_items` | signup site | `id`, `order_id`, `discord_user_id`, `display_name`, `kind`, `menu_item_id`, `custom_toppings`, `text`, `note`, `comment`, `created_at`, `updated_at` | per event | permanent |
| Tourney database (SQLite file `DB_FILE`) | tourney | seasons, teams (with edit tokens), individuals, matches, rounds, champion | per event | not stated |
| Manager database (SQLite, planned) | manager | state history, events, acknowledgements (who), mutes, action log | global | not stated |
| `config/subsystems.yaml` (planned) | manager | subsystems, health URL, host, action catalog, `autoRestart`, `confirmPolls`, `cooldownSeconds`, `maxAttempts` | global (hosts are venue and home) | repo |
| Bot finals memory | bot | last `{seasonId, phase}`, cards shown, "cleared since last push" | per event | not stated |
| Host files | hosts | tourney env file (mode 600), manager env file, signage auth env file (`AUTH_ENV_FILE`), adapter env file, bot systemd drop-in, deploy sudoers rule | per host | until changed |

Nothing in the repo describes backups of any of these.

## Configuration

Secret values are never in the repo and none are copied here.

### Scripts (this repo)

| Name | Default | Meaning |
|---|---|---|
| `CANCCU_SIGNAGE_HOST`, `CANCCU_TOURNEY_HOST`, `CANCCU_BOT_HOST`, `CANCCU_MANAGER_HOST` | tailnet host names (venue laptop for the first two, bot guest, manager container) | SSH target per service |
| `CANCCU_SIGNAGE_DIR`, `CANCCU_TOURNEY_DIR`, `CANCCU_BOT_DIR`, `CANCCU_MANAGER_DIR` | `~/canccusignage`, `~/thefinals_mini_tourney`, `/opt/canccubot`, `/opt/canccumanager` | Checkout on the host (`~` expands remotely) |
| `CANCCU_SIGNAGE_UNIT`, `CANCCU_TOURNEY_UNIT`, `CANCCU_BOT_UNIT`, `CANCCU_MANAGER_UNIT` | `canccusignage-supervisor`, `thefinals-tourney`, `canccubot`, `canccumanager` | systemd unit |
| `CANCCU_SSH_TIMEOUT` | 120 | Seconds per SSH call |
| `DEPLOY_CONFIRM` | unset | Must equal the service for `--yes`; set only by the deploy word |
| Internal names `SIGNAGE_HOST`, `TOURNEY_HOST`, `BOT_HOST`, `MANAGER_HOST`, `SIGNAGE_DIR`, `TOURNEY_DIR`, `BOT_DIR`, `MANAGER_DIR`, `SIGNAGE_UNIT`, `TOURNEY_UNIT`, `BOT_UNIT`, `MANAGER_UNIT`, `SSH_HOST`, `SSH_TIMEOUT` | from the above | Shell variables in `scripts/lib.sh`, not read from the environment |
| PowerShell `-SignageHost`, `-TourneyHost`, `-BotHost`, `-SignageDir`, `-TourneyDir`, `-BotDir`, `-SignageUnit`, `-TourneyUnit`, `-BotUnit` | same values | No manager entries and no environment overrides |

### Written by deploy or the runbook

| Name | Default | Meaning |
|---|---|---|
| `BOT_VERSION` | short git sha | Bot `/healthz` version (drop-in) |
| `HEALTH_PORT` | 8080 | Bot health listener port (drop-in) |
| `HEALTH_HOST` | the guest's tailnet IPv4 | Bot health bind address (drop-in) |
| `ADMIN_PASSWORD` | secret, chosen at install | Tourney shared admin password (env file) |
| `PORT` | 3000 | Tourney port |
| `DB_FILE` | absolute path under the user's state directory | Tourney SQLite file |

### Named by the contracts (other repos)

| Name | Repo | Default | Meaning |
|---|---|---|---|
| `SIGNAGE_HTTP_PORT` | signage | 4321 | HTTP port |
| `SIGNAGE_CONTROL_TOKEN_BOT`, `SIGNAGE_CONTROL_TOKEN_OPS`, `SIGNAGE_CONTROL_TOKEN_STREAM`, `SIGNAGE_CONTROL_TOKEN_EMERGENCY` | signage | secrets | Control token per source |
| `SIGNAGE_TRUSTED_ADMIN_HOSTS` | signage | empty | Extra hosts allowed in `Origin` |
| `SIGNAGE_WEB_ASSET_ALLOWED_HOSTS` | signage | not stated | Hosts allowed as `web` targets |
| `SIGNAGE_CAROUSEL_TOKEN` | signage | secret | Carousel bearer |
| `DISCORD_LOGIN_LINK_HMAC_SECRET` | signage, bot | secret | Login-link HMAC key |
| `SIGNAGE_INSTANCE_ID` | signage | none | This host's id in the login link |
| `DISCORD_ALLOWED_ROLE_IDS` | signage | none | Comma-separated Discord role ids allowed to sign in |
| `AUTH_ENV_FILE` | signage | an auth env file under `/etc/canccusignage/` | Fallback env file for the three above |
| `ADAPTER_CLOUD_AUTH_MODE` | signage | `public` | `public` or `bearer` |
| `ADAPTER_CLOUD_BEARER_TOKEN` | signage | secret | Required when `bearer` |
| `ADAPTER_CLOUD_BASE_URL` | signage | the site | Site base URL |
| `ADAPTER_POLL_DISPLAY_MS`, `ADAPTER_POLL_TOURNAMENT_MS`, `ADAPTER_POLL_HEALTH_MS` | signage | 180000, 60000, 30000 | Poll intervals |
| `ADAPTER_FETCH_TIMEOUT_MS` | signage | 10000 | Fetch timeout |
| `CANCCUSIGNAGE_CONTROL_URL` | bot | none | Signage base URL (tailnet) |
| `CANCCUSIGNAGE_CONTROL_TOKEN`, `CANCCUSIGNAGE_CAROUSEL_TOKEN` | bot | secrets | Bearers |
| `CANCCUSIGNAGE_CONTROL_ENABLED` | bot | none | Ignored (no effect) |
| `API_URL`, `API_SECRET` | bot, site | secret | Site base URL; shared write secret |
| `PRESENCE_INTERVAL`, `VOICE_INTERVAL`, `GAME_INTERVAL`, `STATS_HISTORY_PUBLISH_SECONDS` | bot | 60, 30, 30, 300 | Cadences (seconds) |
| `GAME_THRESHOLD`, `GAME_BANNER_DISPLAY_SECONDS`, `GAME_BANNER_COOLDOWN_SECONDS` | bot | 4, 120, 900 | Hot-game policy |
| `MANAGER_ALERT_DM_USERS` | bot (planned) | none | Users the alert DMs go to |
| `FRONTEND_URL` | bot | the site | Base of the pizza and registration links |
| `FINALS_REGISTRATION_WINDOW_MINUTES`, `FINALS_STARTED_WINDOW_MINUTES` | site | 15, 10 | Finals phase windows (query params win) |
| `PIZZA_DISCORD_WEBHOOK_URL` | site | secret; unset = no posts | Pizza channel webhook |
| `MANAGER_HEARTBEAT_TOKEN` | site, manager | secret | Heartbeat bearer |
| Admin Discord webhook | site, manager | secret | Stale-heartbeat and fallback alerts |
| `STREAM_TOKEN`, `CONTROL_URL`, `CAST_DIRECTIVE`, `STALL_SECONDS` | cast hooks (planned) | secret, none, none, 300 | Hook environment |
| `ADMIN_PASSWORD`, `PORT`, `DB_FILE` | tourney | see above | |

Settings (not env): the nine trigger settings (`gameThreshold` 4, `bannerDisplaySeconds` 120, `bannerCooldownSeconds` 900, `testMode` false, `pollHighlightSeconds` 60, `pollResultSeconds` 180, `announceDefaultSeconds` 60, deprecated `finalsOpenSeconds` and `finalsStartSeconds` 60); sound settings (`catchUpEnabled` false, flood guard limits, per-cue sounds); carousel `spotlightDurationSeconds` 60; the lan-display URL params in section B; manager `subsystems.yaml` keys.

## External integrations

| Integration | Used for | Needs |
|---|---|---|
| Discord | Commands, presence/voice/game data, login links, alerts, Acknowledge, carousel photos | The bot's token and intents (in canccubot); role ids; an admin channel; two webhooks (admin, pizza) |
| Tailscale | Every operator and service path between dev PC, venue laptop, bot guest and manager | All hosts on one tailnet with MagicDNS; Tailscale inside WSL2 (not on Windows); `tailscale ip -4` on the bot guest |
| SSH | All scripts; the manager's action catalog | Key-based login (`BatchMode`), Windows OpenSSH or sshd in WSL, passwordless `sudo` for restarts |
| systemd and journald | Units, restarts, logs, drop-ins | On every Linux host, including WSL2 |
| Windows | Kiosk browser and its scheduled task, port proxy 80 → 3000 (IP Helper service), firewall rule (private and domain profiles), the cast relay | Admin PowerShell once per laptop |
| Hosted serverless platform of the signup site | The site, its SQL database, scheduled checks, DNS records, logs API | Its account (held by the site's maintainer); CI deploys on merge |
| DNS | A DNS-only record pointing a LAN hostname to a venue static lease; planned certificate for a cast hostname by DNS validation | Venue lease known in advance; venue resolver must not strip private answers |
| Proxmox | Bot guest, manager container; planned guest restart through its API | API token on the manager |
| GitHub Actions | CI here; site deploys on merge | |
| MediaMTX, WebRTC/WHIP (planned) | Casting | Binary on the Windows side, UDP and TCP ports open, H.264 senders, a trusted certificate |
| YouTube | Assets on signage; private videos only by casting a tab | |
| Node.js, npm, Python venv | Builds on the hosts | Node ≥ the repo minimum (tourney runbook: 22.22.1) |
| lychee, shellcheck, PSScriptAnalyzer | CI | |
| Files and media | Carousel photos and assets live on the signage host; the fallback image for Ready | signage storage (#71) |

## Tests

| File | Covers |
|---|---|
| `scripts/test-deploy-guard.sh` | `deploy.sh` guard with a fake `ssh`: `--yes` without `DEPLOY_CONFIRM` refused; wrong value refused; matching value reaches the host once; `--dry-run` needs no confirm; non-interactive without `--yes` refused |
| `.github/workflows/ci.yml` | Static checks only: PSScriptAnalyzer (errors and warnings) on `scripts/`, shellcheck on `scripts/*.sh`, lychee on `CLAUDE.md` and `docs/**/*.md` (one private repo ignored) |

Gaps that matter for the port:

- The guard test is not run in CI; it runs only by hand.
- No tests for `scripts/lib.sh` argument parsing, `status`, `logs`, `restart`, the Node check, the kiosk step or the timeout; the PowerShell scripts have no tests at all.
- Contracts are checked by hand against code ("Verified against" rows), never by a machine. The manager and heartbeat contracts and the lan-display fade param were never verified.
- None of this matters for code (the scripts are dropped), but the new contracts need contract tests in CI from the start (already in the merge rules).

## Known problems

From the files and the commit history.

1. **Incident: kiosk not relaunched after deploy** (#115): the remote script arrives on stdin and a Windows `.exe` read the rest of it, so the scheduled task never ran. Fixed by redirecting each call's stdin.
2. **Incident: hung SSH calls blocked scripts** (#122): fixed with a timeout wrapper in bash only.
3. **`--yes` misuse risk** (#99): an agent could deploy without approval; fixed with `DEPLOY_CONFIRM` and a lesson.
4. **PowerShell scripts drift from bash:** no `manager` service, no Node check, no SSH timeout, no environment overrides.
5. **Deploy discards host changes:** `git reset --hard origin/main` on the host (the dirty state is only printed first).
6. **Loopback guard is host-header based:** `/api/screen/*` checks the URL host, not the socket, and the server listens on all interfaces, so a client sending a loopback `Host` passes.
7. **Dead credentials:** control tokens for `ops`, `stream` and `emergency` are accepted but have no caller; `CANCCUSIGNAGE_CONTROL_ENABLED` is ignored; `finalsOpenSeconds` and `finalsStartSeconds` are deprecated but still served.
8. **Unspecified responses:** the five kiosk POST routes, polls and snapshots have no documented response shape.
9. **Two manager plans disagree:** the newer plan drops event mode, keeps the laptop's host name, DMs admins and polls the bot; the older one keeps event mode, renames the laptop and posts only in the channel. Health path for the tourney is `/healthz` in the manager plan but `/api/healthz` in the health contract. Open questions in the newer plan (rename, DM scope, who may see status, `/cast` vs `/platform`, watching Proxmox) were never closed.
10. **Contracts ahead of code:** manager API, heartbeat and pizza routes were written before implementation; "Verified against" says so.
11. **Insecure exposure at the venue:** the mini-tourney runs plain HTTP on the venue LAN with one shared admin password and no login rate limit (the runbook puts TLS and rate limiting out of scope); the LAN hostname depends on the venue resolver allowing private answers.
12. **Single points:** one venue laptop runs signage, the tourney and the planned relay; the tailnet is the only path for operators and for the bot → signage control calls.
13. **Hard-coded origin:** the screen accepts messages only from one fixed site origin, so another host cannot embed the display.
14. **Retention gaps:** no backup or retention rule for any store except the 7-day sound and token windows; pizza data is kept forever.
15. **Doc links that rot:** links into a private, now archived docs repo (ignored by the link check) and three links to private chat artifacts in the manager plan.
16. **Time-bound plans:** the pizza plan and the event-2026 references are dated to one event; the casting plan assumes the relay is on the venue LAN.
17. **No TODO or FIXME markers** in the repo.

## Port recommendation

Targets use the roadmap's steps. "Drop" follows [0010](../decisions/0010-scope.md) unless said otherwise.

| Feature | Verdict | Reason | Target module | Roadmap step |
|---|---|---|---|---|
| O1–O4 status, logs, restart, deploy scripts | drop | Containers on one VM; code reaches the VM only by merge and auto-deploy; Windows, WSL and SSH actions dropped | deploy, setup | 1 (#14 auto-deploy) |
| O5 deploy guard | drop | No manual deploy path; the merge gate replaces it | — | — |
| O6 Node check | drop | Images pin the runtime | — | — |
| O7 bot version and health binding | drop | Version is the release tag; health from the kit | kit | 1 |
| O8 kiosk reload | rewrite | A per-device "reload" action on paired screens, not a Windows task | screen, admin | 3, 8 |
| O9 manager deploy and sudoers check | drop | No hosts to SSH into | — | — |
| O10 SSH timeout and step naming | drop (idea kept) | The named-step failure pattern is worth reusing in `setup/` scripts | setup | 1 (#12) |
| O11 tourney unit, venue runbook | drop | No service runs at the venue; the VM is remote ([0011](../decisions/0011-hosting-on-remote-vm.md)) | — | — |
| O12 CI checks | port with changes | Keep a link check and shellcheck for `setup/`; drop PowerShell analysis | ci | 1 |
| O13 workflow rules | done | Already carried into `AGENTS.md` and `CLAUDE.md` | — | — |
| O14 upstream rules for the tourney repo | drop | The tourney code is ported (after its author's OK), not patched upstream | games | Games track |
| O15 system map | rewrite | `docs/roadmap.md` and `contracts/` replace it | — | done |
| X1 health shape | port with changes | Already reshaped as the admin contract's `GET /health` (`module`, `time`, `checks` as a map); keep "never expose internals" | kit, all modules | 1 (done) |
| X2 login link | drop | Replaced by Discord sign-in through the central sign-in host | admin, sign-in | 2b (#52) |
| X3 screen control, band ranking, ticker | rewrite | Directives become Moments takeovers, blocks and overlays from bus events; keep the ranking and TTL rules as the spec; per-source tokens dropped | moments, screen | 2c (#35), 4 |
| X4 trigger settings | port with changes | Per-tenant module settings through admin | moments, bot | 4, 6 |
| X5 hot-game banner | port with changes | Bot emits game events; Moments decides the banner | bot, moments | 6, 9 |
| X6 photo carousel, spotlight | port with changes | Upload through the bot into tenant files; Screen playlist | bot, screen | 6, 9 |
| X7 finals cards | port with changes | Becomes games/tournament events ranked by Moments; the site detour goes | games, moments | Games track, 9 |
| X8 LAN display page | rewrite | Screen widgets fed by events; polls dropped; comes last | screen | 9 |
| X9 `postMessage` protocol | drop | Screen-embed protocol dropped; Moments runs server-side | — | — |
| X10 catch-up cues | rewrite | The rule (windows, once per event, never twice) becomes Moments policy; server-side state makes the kiosk hold and `localStorage` memory unnecessary | moments | 4 |
| X11 pizza ordering | port with changes | Port the router and tests; `pizza.order.*` events instead of webhooks and polling; claims in a transaction; Discord identity from sign-in, not registration tokens | pizza | 5 |
| X12 pizza ticker and cues | port with changes | Screen and Moments consume `pizza.order.*` | screen, moments | 5, 9 |
| X13 tournament routes | port with changes | Scoring, leaderboard and final ported; tokens, voice handshake and admin UI rewritten; registration inside the module | tournament | 7 |
| X14 polls | drop | Polls dropped ([0005](../decisions/0005-signup-site-stays-outside.md)) | — | — |
| X14 stats snapshots | port with changes | Bot presence, voice and game data as bot events | bot | 6 |
| X15 tourney read API and SSE | rewrite | Storage and API rewritten; SSE becomes bus events | games | Games track |
| X16 manager | port with changes | Debounce, alerts as events consumed by the bot, ack, mute, restart policy; the executor designed first; subsystem list becomes module list | admin | 8 |
| X17 heartbeat to the site | drop | Manager dead-man's switch dropped; the hardening watchdog covers it | — | 10 |
| X18 casting | port with changes | Takeover lifecycle, stall guard, End cast and the encoder findings kept; relay placement open with a remote VM | cast | Cast track |
| X19 tourney on a LAN hostname | drop | Everything is served from the VM over HTTPS | — | — |

## Tenancy questions

What this repo implies for the tenancy design (#48). Each is a question for the tenants contract or a module contract; none is decided here.

**Global (platform, superadmin)**

1. The manager's subsystem list, alerts, ack and mute are about the shared stack. Do tenant admins see platform health at all, or only a per-tenant status view ([0013](../decisions/0013-multi-tenant-core.md) item 28)? Who receives platform alerts: the superadmin only, or also the admins of live tenants?
2. The legacy alerts go to one admin channel and named users. On a shared bot, is the alert channel a platform setting (superadmin guild) and separate from tenant channels?
3. The health contract forbids exposing internals; on a shared stack health is outside tenant resolution (item 2). Should health carry any per-tenant checks?

**Per tenant (event)**

4. Discord role ids, the admin channel, the pizza webhook channel, trigger and sound settings, `catchUpEnabled`, thresholds and cadences: all per tenant settings or bot bindings (items 14–18)?
5. One open pizza order, one non-finished tourney season, one finals card at a time: these singletons become "one per tenant". Confirm none is global.
6. Retention: sound log 7 days, tokens 7 days, pizza records permanent for an outside bill system. Should retention be a per-tenant setting, and does per-tenant export cover the pizza daily record?
7. The attendee token is per event and tied to a global Discord user; users are global (item 30). Does any per-tenant identity remain once sign-in is central?
8. The screen accepts one hard-coded origin; with hostnames per tenant, which origins does a screen trust, if any embedding survives?

**Per venue**

9. Pizzerias and menus belong to the place, not the event. Are they venue-scoped rows (global, managed by the superadmin or an event admin) that a tenant reuses, or copied into each tenant?
10. The kiosk, its reload action, the signage instance id and the screen's cue memory are per device at a venue. Confirm these map to Screen's global device rows (item 34), with the reload action allowed to whom: the superadmin, or the admin of the device's current tenant?
11. The venue LAN assumptions (LAN hostname, private DNS answers, static lease, port proxy, LAN-only casting, "anyone on the LAN may cast") end with a remote VM. Does any per-venue network setting survive besides the venue IP addresses of item 33, for example for casting?
12. Local time zone and number format appear in the pizza plan (dates, CSV). Is the time zone a venue property or a tenant setting?

## Event-specific content

Named by kind and counted only; no value appears in this file. The location of each value is listed in the PR, for a follow-up issue in the event repo.

| Kind | Distinct values | Lines | Files |
|---|---|---|---|
| The signup site's domain (in URLs, the hard-coded origin, the manager subsystem key) | 1 | 92 | 17 |
| A venue-LAN hostname under that domain for the mini-tourney | 1 | 9 | 3 |
| Tailnet name | 1 | 1 | 1 |
| Tailnet host names (venue laptop, bot guest, manager container, dev PC, a planned rename) | 5 | at least 40 (16 are script defaults; three of the names are also repo names, counted only where used as a host) | 14 |
| Network adapter MAC address of the venue laptop | 1 | 1 | 1 |
| Personal names and personal accounts (plan author, site maintainer account, tourney author account, legacy repo owner account) | 4 | 43 | 17 |
| Example attendee nicknames in the pizza plan and contract | 9 | 17 | 2 |
| Discord channel name (the admin channel) | 1 | 20 | 3 |
| Discord role names (the admin roles, the bot role) | 3 | 21 | 2 |
| Home-server guest id | 1 | 3 | 1 |
| Windows scheduled task name for the kiosk | 1 | 8 | 4 |
| Event dates (event days, rehearsal, the spring 2026 event) | 7 | 15 | 2 |
| Example pizzeria name, custom-pizza base name and local-language toppings and menu items | 14 | 28 | 2 |
| Per-day sheet page paths on the site | 3 | 4 | 1 |
| Event locale (time zone, local spreadsheet format) | 2 | 5 | 1 |
| Links to private chat artifacts | 3 | 3 | 1 |
| Links into the private legacy docs repo | 1 repo | 20 | 9 |
| Discord ids, venue IP addresses | 0 real (placeholders and loopback only) | — | — |

Menus, photos and other media: none in this repo.
