# Legacy inventory: the signup site

The legacy signup site, read in full so the product owner can confirm what exists before the tenancy foundation ([#47](../roadmap.md#2b-tenancy-foundation)) and the contracts ([#36](../roadmap.md#2c-event-catalog-and-screen-contract)) are designed. Roadmap step 2a, issue #72. The site's real hostname is never written here; it is "the signup site". Other legacy repos have their own inventories (#68–#71, #73–#75); the summary (#76) joins them.

Per [0005](../decisions/0005-signup-site-stays-outside.md), event registration stays on the site and outside the platform. This inventory therefore covers in depth only what the platform ports or talks to: **pizza, tournament, the LAN display (with the bot ingest API and stats), the heartbeat, and auth**. Registration, the home page, the terminal, music and admin are described by their interfaces and data only.

Nothing here is copied from the legacy repo: it is described. Short identifiers (route paths, table and column names, env var names, cue ids) are kept so the port can find them. Event-specific values are named by kind and counted only (see [Event-specific content](#event-specific-content)).

## In short

- **What it is.** One Astro 5 server app on Cloudflare Workers with one D1 (SQLite) database, Drizzle for part of the queries and raw D1 SQL for the rest, Resend for e-mail, Turnstile for anti-spam, two cron triggers. It hosts five things: event registration, the pizza group-order app, the tournament (schedule, registration, scoring, final), the LAN display page embedded by the signage screen, and the ingest API that the Discord bot and the manager push into.
- **Size.** 454 tracked files: 401 text files with 66,591 lines and 53 binaries (mp3, png). 422 commits from 2025-03-10 to 2026-11-03, three human authors, many AI co-authored commits. Read at commit `491480a` (`main`, 2026-11-03).
- **Shape.** No tenant, event or venue key outside registration: one active event (`events.is_active`), and every pizza, tournament, poll, snapshot and display table is global to the database. One shared bearer secret for the bot, one admin password, plaintext UUID tokens in page URLs.
- **Port verdict.** Pizza ports with changes (pure logic and router tests nearly as-is). Tournament scoring, leaderboard and final port with changes; tokens, the admin UI and the bot flag-polling handshake are rewritten. The LAN display page is rewritten as Screen views last; its pure helpers and cue rules port. Polls are dropped. The D1 workarounds (15-minute snapshot retention, single-row stats blob) are dropped with Postgres. Registration, home page, terminal, music and e-mail stay on the site.

## Coverage

Every tracked file was examined. Source, config, migrations, scripts and tests were read in full except where the last column says otherwise. "Lines" is the git line count of text files; binaries count as files with 0 lines.

| Directory | Files | Lines | Binaries | Notes |
|---|---|---|---|---|
| `/` (root) | 12 | 7414 | 0 | Read in full except `pnpm-lock.yaml` (6762 lines, lockfile: size and purpose noted only) and `worker-configuration.d.ts` (generated, stale) |
| `.github/workflows/` | 2 | 87 | 0 | `ci.yml`, `deploy.yaml` |
| `migrations/` | 33 | 451 | 0 | All 33 (two share number 014) |
| `scripts/` | 3 | 224 | 0 | Stats backfill, sound generator, tournament seed SQL |
| `src/` (root files) | 2 | 90 | 0 | `worker.ts` (cron entry), `env.d.ts` |
| `src/assets/` | 2 | 2 | 0 | Two scaffold SVGs |
| `src/canccubot/` | 5 | 1100 | 0 | Ingest auth, polls, snapshots, stats, retention |
| `src/components/` | 14 | 1213 | 0 | Music player and design-preview blocks skimmed (stay on the site) |
| `src/db/` | 2 | 415 | 0 | Drizzle schema and client |
| `src/integrations/` | 1 | 32 | 0 | Build hook that drops the album zip |
| `src/layouts/` | 2 | 50 | 0 | |
| `src/lib/` | 73 | 11065 | 0 | Includes `lib/pizza/` (12) and `lib/tournament/` (17); the Snake game and art data skimmed (stay on the site) |
| `src/pages/` | 82 | 14957 | 0 | 65 API routes, 17 pages; the `admin.astro` client script read in its auth, API, event, CSV and e-mail parts; design-preview page skimmed |
| `src/styles/` | 1 | 254 | 0 | Pizza theme |
| `src/tests/` | 86 | 11679 | 0 | 83 test files, 2 helpers, 1 setup; core test bodies read by case list and mocks |
| `src/types/` | 1 | 61 | 0 | `Env` type |
| `public/` (root files) | 4 | 706 | 0 | `robots.txt`, `.assetsignore`, favicon, a tournament-embed design preview (title only) |
| `public/assets/` | 13 | 115 | 12 | 12 event-music mp3s (not opened), one game-server text file |
| `public/mockups/` | 2 | 566 | 0 | LAN display mockups (titles only) |
| `public/pizza/` | 2 | 0 | 2 | Mascot PNGs |
| `public/sounds/` | 5 | 41 | 4 | Four sfx mp3s and their README |
| `public/styles/` | 1 | 6196 | 0 | Site theme (skimmed: about 930 rules) |
| `docs/` (root files) | 9 | 2103 | 0 | Contract and context docs |
| `docs/archive/` | 9 | 3961 | 1 | Archived specs and plans |
| `docs/design/` | 24 | 1726 | 7 | Pizza mockups (`.dc.html`) and screenshots |
| `docs/handoffs/` | 1 | 0 | 0 | Empty `.gitkeep` |
| `docs/mockups/` | 51 | 984 | 27 | Mockups, render scripts, PNGs (2 PNGs opened to check for event content) |
| `docs/plans/` | 12 | 1099 | 0 | 11 issue plans and a `.gitkeep` |
| **Total** | **454** | **66591** | **53** | |

By kind: source 207 (TypeScript, Astro, JS), config 9, migrations 33, scripts 3, tests 86, docs and mockups 106, static assets 10. The git history was read too: all 422 commit subjects, the bodies of fix, revert and incident commits, and the deleted-file log.

Skipped or only skimmed, and why: the lockfile (generated); the 53 binaries (media, by kind and count only); the music player, Snake game, design previews and the site stylesheet (registration-side features that stay on the site; skimmed for routes, data and event content). Nothing on the ported paths (pizza, tournament, display, ingest, heartbeat, auth) was skipped.

## Features

"Where" is the path in the legacy repo; "Reached by" is how a person or service gets to it. **Port** marks the parts the platform ports or talks to; the rest stays on the site ([0005](../decisions/0005-signup-site-stays-outside.md)).

### Pizza (port)

| # | Feature | Where | Reached by |
|---|---|---|---|
| P1 | Group order: one open order at a time across the site; open with a pizzeria, a "calling around" time and a note; the opener holds it | `src/lib/pizza/router.ts`, `src/pages/pizza/orderer.astro` | `/pizza/orderer`, `POST /api/pizza/orders` |
| P2 | Add, edit, delete own pizzas while open: menu item (filter by name or ingredient), custom (base plus 1–4 toppings), or free text; a note for the pizzeria and a comment for the bill | `src/pages/pizza.astro`, `src/lib/pizza/validate.ts`, `menu-filter.ts` | `/pizza?token=…`, `/api/pizza/orders/:id/pizzas`, `/api/pizza/pizzas/:id` |
| P3 | Holder workflow: claim, release, close, reopen, call (grouped summary, copy as text, `tel:` link), mark placed (sets the payer), undo, enter the bill | `src/pages/pizza/orderer.astro`, `src/lib/pizza/summary.ts`, `orderer-view.ts` | `/pizza/orderer?token=…` |
| P4 | Take-over when nobody holds the order; cancel a stale order from an earlier day | `router.ts` | `/pizza/orderer` |
| P5 | "Your bills": placed orders where you are the payer and no bill is set | `router.ts` | `GET /api/pizza/me/bills` |
| P6 | Discord channel posts as embeds (open with `@everyone`, release, cancel, placed, reminders mentioning the holder, auto-release) | `src/lib/pizza/announce.ts` | Webhook, from routes and the cron |
| P7 | Reminders at +30 and +60 min (open past target; closed but not placed) and auto-release after 2 h closed | `src/lib/pizza/reminders.ts`, `src/worker.ts` | Cron every 5 min |
| P8 | Admin: all orders with per-person lists and Discord ids; force release, cancel, undo placed, set payer, set bill, hard delete | `src/pages/admin/pizza/index.astro` | `/admin/pizza` (admin cookie) |
| P9 | Admin: pizzerias, phone, custom base name, menu (textarea or JSON, with ingredients), toppings | `src/pages/admin/pizza/pizzerias.astro` | `/admin/pizza/pizzerias` |
| P10 | Daily record: orders by day with totals and flags; CSV for the after-event bill system | `src/lib/pizza/report.ts`, `src/pages/admin/pizza/report.astro` | `/admin/pizza/report`, `GET /api/pizza/report?format=csv` |
| P11 | Pizza block on the LAN display stats view (open, calling, ordered for 10 min) | `src/lib/lan-display-pizza.ts`, `src/pages/lan-display.astro` | Page polls `GET /api/pizza/status` every 10 s |
| P12 | Public status brief, also read by the signage screen for its ticker and cues | `router.ts` | `GET /api/pizza/status` (CORS `*`) |
| P13 | Retired per-day pages redirect to `/pizza` | `src/pages/pizza-[day].ts` | `/pizza-<day>` (302) |

### Tournament (port)

In this code a tournament "event" is one game session; the whole tournament is one implicit season per database.

| # | Feature | Where | Reached by |
|---|---|---|---|
| T1 | Public schedule by day, "Next up" countdown, details modal (scores or registrants) | `src/pages/tournament/index.astro` | `/tournament` |
| T2 | Rules page (static event policy) | `src/pages/tournament/rules.astro` | `/tournament/rules` |
| T3 | Leaderboard with medals, per-player results, final badges, 60 s refresh; `?fullscreen=true` redirects to the LAN display | `src/pages/tournament/leaderboard.astro`, `src/lib/tournament/scores.ts` | `/tournament/leaderboard` |
| T4 | Player registration per session, saved per checkbox, only while `open` | `src/pages/tournament/register.astro`, `src/lib/tournament/registrations.ts` | `/tournament/register?token=…` (link from the bot) |
| T5 | Admin: create, edit, postpone, reopen, end/cancel, delete sessions; Steam URL for cover art; Discord voice-channel plan (none, solo, team) | `src/pages/tournament/admin.astro`, `src/lib/tournament/events.ts`, `vc-plan.ts` | `/tournament/admin?token=…` (link from the bot) |
| T6 | Admin registrants: add by name with candidate resolution, remove, add "present, not registered" players from the voice roster | `src/lib/tournament/registrations.ts`, `roster.ts` | Same page |
| T7 | Scoring: "Start scoring" asks the bot for a voice-channel dwell roster, autofills solo or team placements (3/2/1/0 plus bonus), manual entry, nickname linking with warnings | `src/lib/tournament/scores.ts`, `roster.ts`, `score-merge.ts` | Same page; bot posts the roster |
| T8 | Final game: one session marked final; finalists, ranks and scores; four photo slots (JPEG ≤ 512 KB); finalists lead the leaderboard once scored | `src/lib/tournament/final*.ts` | Same page; `/api/tournament/events/:id/final*` |
| T9 | Debug "create now" and "cleanup now" flags for the bot (hidden in production by a build flag) | `src/pages/api/tournament/events/[id]/debug/*` | Admin page |
| T10 | LAN screen payload: next and previous session with covers, progress, top 10, schedule preview, final podium | `src/lib/tournament/display-tournament.ts`, `final-view-html.ts` | `GET /api/display/state?include=tournament`, `/lan-display?view=tournament_leaderboard` |
| T11 | Bot handshake by flags: the bot polls the session list and acts on `vc_plan`, `create_now_requested`, `scoring_started`, `cleanup_requested`; closes registration at the deadline; DMs reminders | `src/pages/api/tournament/**` | Bot polling and `PATCH` routes |
| T12 | Cover art lookup chain (cache, fuzzy session match, Discord activity art, Steam search, IGDB); production uses only the fast path | `src/lib/game-cover.ts`, `igdb-client.ts`, `game-name-match.ts`, `src/lib/tournament/steam-cover.ts` | Display state |

### LAN display, bot ingest, heartbeat (port)

| # | Feature | Where | Reached by |
|---|---|---|---|
| D1 | LAN display page, embedded in an iframe by the signage screen; polls the display state every 30 s (10 s while a poll is active, 20 s in demo) | `src/pages/lan-display.astro` (about 1800 lines of inline script) | `/lan-display?view=…` (public) |
| D2 | Stats view (default): presence now with trend arrows, presence 24 h chart (replaced by the pizza block), voice now, voice 24 h, top games now with covers, top games 96 h by player-hours | `lan-display.astro`, `src/lib/trend-*.ts` | `?view=stats` or no view |
| D3 | "Alive" chrome: cover wash background, pulse strip (poll open or result, tournament next, finals), chips (HOT, VOICE, SPIKE) from thresholds | `src/lib/lan-display-alive.ts` | Stats view; thresholds by URL params |
| D4 | Views: `game_banner` (alias `hot_game`), `active_poll`, `poll_result`, `announce`, `tournament_leaderboard`, `finals_open`, `finals_start` | `lan-display.astro`, `src/lib/lan-display-finals-card.ts` | `?view=` chosen by the signage screen; the page never picks a view itself |
| D5 | Screen messages to the parent window: ready, page progress, sound cues with a bounded resend | `src/lib/lan-display-screen-cues.ts` | `window.postMessage` |
| D6 | Demo overlays for every alert kind | `src/lib/lan-display-demo.ts` | `?demo=kind,…|all` |
| D7 | Polls run from Discord: one active poll, votes per Discord user, close or cancel | `src/canccubot/polls.ts` | Bot ingest routes |
| D8 | Presence, voice and game snapshots pushed by the bot | `src/canccubot/snapshots.ts` | Bot ingest routes |
| D9 | Stats history: snapshot rows folded into one JSON blob (24 h hourly, 4 days daily, 96 h games) when the bot asks | `src/lib/stats-history-accumulator.ts`, `stats-history-refresh.ts` | `POST /api/display/stats-history` |
| D10 | Snapshot retention: delete rows older than 15 min, at most 1000 per table per run | `src/canccubot/retention.ts` | Hourly cron |
| D11 | Announce card and finals-season card pushed by the bot | `src/lib/display-announce.ts`, `display-finals.ts` | `/api/display/announce`, `/api/display/finals` |
| D12 | Trend arrow memory posted back by the browser | `src/pages/api/display/trend-state.ts` | `POST /api/display/trend-state` |
| D13 | Polls RSS for a third-party signage ticker | `src/pages/api/display/polls-rss.ts` | `GET /api/display/polls-rss` |
| D14 | Manager heartbeat with a stale alert (once) and a recovery alert (once) to the admin Discord channel | `src/lib/manager-heartbeat.ts` | `POST /api/manager-heartbeat`; cron every 5 min |
| D15 | Health in the legacy platform shape | `src/pages/api/health.ts` | `GET /api/health` |
| D16 | LAN reset: clears snapshots, stats blob and trend state, optionally closes the poll | `src/pages/api/admin/lan-reset.ts` | `/admin` "RESET LAN DATA" |

### Registration and site (stays on the site; interfaces only)

| # | Feature | Where | Reached by |
|---|---|---|---|
| R1 | Registration through the retro terminal (`REGISTER nick name email`), Turnstile, rate limit, confirmation e-mail, one active event | `src/pages/api/registration.ts`, `src/lib/retro-terminal*.ts`, `src/lib/email-service.ts` | `/`, `POST /api/registration` |
| R2 | Self-cancel with the per-registration hash; participant list with local timestamps | `src/pages/api/delete-user.ts`, `src/components/RegisteredNicks.astro` | `/`, `POST /api/delete-user` |
| R3 | Event info box, countdown, payment info, thank-you page; per-event content fields with code defaults | `src/components/EventInfo.astro`, `src/lib/event-content.ts` | `/`, `/thankyou` |
| R4 | Home page sections on a schedule (pizza link, payment, music player) | `src/lib/quick-link-components.ts` | `/` |
| R5 | Music player (tracks in D1, files static) and Snake with a top-5 hiscore | `src/components/MusicPlayer.astro`, `src/lib/snake-*.ts` | `/`, `/api/music/tracks`, `/api/snake-hiscore` |
| R6 | Admin: password login; events, participants (CSV export), e-mail to participants in BCC chunks, home sections, music, links to LAN display views | `src/pages/admin.astro`, `src/pages/admin/email-participants.astro`, `src/pages/api/admin/*` | `/admin` |

## Interfaces

### A. Auth mechanisms

| Name | Mechanism | Used by |
|---|---|---|
| SECRET | `Authorization: Bearer <API_SECRET>`, constant-time compare; unset secret rejects all | Bot: polls, snapshots, announce, finals, stats-history, tournament bot routes, token issue |
| ADMIN-COOKIE | `admin-session` cookie (UUID, row in `admin_sessions`, 4 h, `SameSite=Strict`, `secure` only in production) from `POST /api/admin/auth` with `ADMIN_PASSWORD` (plain compare, no throttle) | `/admin`, pizza admin, site admin APIs |
| T-ADMIN | Bearer UUID from `admin_tokens`, valid while `expires_at > now` (string compare) | Tournament admin routes |
| PLAYER | Bearer UUID from `registration_tokens` (falls back to `admin_tokens` in tournament) | Tournament player routes; pizza attendee identity (no fallback) |
| HEARTBEAT | Bearer `MANAGER_HEARTBEAT_TOKEN`, constant-time | Manager heartbeat |
| HASH | Knowing the registration's deletion hash | Self-cancel |
| — | None | Public routes |

Tokens are issued by the bot through the internal routes and travel as `?token=` in page URLs; pages send them as bearer headers. Astro's origin check is off (`checkOrigin: false`), so the admin cookie relies on `SameSite=Strict` and, for pizza, on a JSON content type that forces a preflight.

### B. HTTP routes

65 API route files. Common envelope unless marked "raw": `{success, data?, message?, error?}`; validation errors are 400 `Validation failed`; a missing DB binding is 500.

**Pizza** (one catch-all, `src/pages/api/pizza/[...path].ts`; errors `{error, message, …}`; any non-GET without a JSON content type is 415 before routing; OPTIONS is 204 with `ACAO *`; JSON is `no-store`).

| Method | Path | Auth | Request | Response and codes |
|---|---|---|---|---|
| GET | `/api/pizza/status` | — (CORS `*`) | — | `{state:'none'}` or `{state, id, date, seq, pizzeria_name, orderer_name, target_at, placed_at, pizza_count, people_count}`; "current" = open order, else today's latest |
| GET | `/api/pizza/pizzerias` | — | — | `{pizzerias:[{id,name}]}` |
| GET | `/api/pizza/orders/current` | — (PLAYER optional) | — | Detail or `{state:'none', today}`; with a token adds `me` |
| GET | `/api/pizza/orders/:id` | — | — | Detail: `id, date, seq, state, you_hold, today, stale, pizzeria{id,name,base_name,phone (holder only)}, menu[], toppings[], target_at, note, opened_by_name, orderer_name, claimed_at, closed_at, placed_at, payer_name, bill_total_cents, cancelled_by_name, pizzas[{id, display_name, kind, label, menu_item_id, toppings, text, note, comment, mine}], viewer{kind, name, token_problem, is_orderer, is_payer}`; 404 |
| GET | `/api/pizza/me/bills` | PLAYER | — | `{bills:[{id, date, seq, pizzeria_name}]}`; 401 |
| POST | `/api/pizza/orders` | PLAYER | `{pizzeria_id, target_at ISO, note? ≤200}` | 201 detail; 409 `another_open` with `open`; 400 |
| POST | `/api/pizza/orders/:id/claim` | PLAYER | — | 200 detail (also if already holder); 409 `placed`, `cancelled`, `claimed` (with `holder`, `since`) |
| POST | `/api/pizza/orders/:id/pizzas` | PLAYER | `{kind:'menu', menu_item_id}` or `{kind:'custom', toppings[1..4]}` or `{kind:'text', text ≤80}`, plus `note? ≤120`, `comment? ≤120` | 201 `{id}`; 403 `closed`; 400 `invalid_body` with `field` |
| PUT, DELETE | `/api/pizza/pizzas/:id` | PLAYER (owner while open) or holder or admin | Same body as add | 200 `{id}` or `{deleted}`; 403 `not_owner`, `closed`; 404 |
| POST | `/api/pizza/orders/:id/release` | Holder or admin | — | 200; 409 if placed or cancelled; logs `force_release` when not the holder |
| POST | `/api/pizza/orders/:id/close`, `/reopen` | Holder or admin | — | 200; 409 if placed or cancelled |
| POST | `/api/pizza/orders/:id/placed` | Holder or admin | `{at? ISO}` | 200; sets payer; 409 if cancelled or placed |
| POST | `/api/pizza/orders/:id/unplace` | Holder or admin | — | 200; 409 `not_placed`, `another_open` |
| POST | `/api/pizza/orders/:id/cancel` | Holder or admin; any PLAYER for a stale order | — | 200; 409 if placed or cancelled |
| PUT | `/api/pizza/orders/:id` | Holder or admin (`payer_discord_user_id` admin only) | `{pizzeria_id?, target_at?, note?, placed_at?, payer_discord_user_id?}` | 200; 409 `has_pizzas`, cancelled; 400; 403 |
| GET | `/api/pizza/orders/:id/summary` | Holder or admin | — | `{header, pizza_count, lines[{count,label,note}], who[{name,count}], text}` (no comments) |
| PUT | `/api/pizza/orders/:id/bill` | Holder, admin or payer | `{bill_total_cents: 0..500000}` | 200; 409 `not_placed` |
| GET | `/api/pizza/orders` | ADMIN-COOKIE | — | `{orders:[…, people[{discord_user_id, name, pizzas[]}]]}` |
| DELETE | `/api/pizza/orders/:id` | ADMIN-COOKIE | — | 200 `{deleted}` (hard delete with log); 404 checked before auth |
| GET | `/api/pizza/report` | ADMIN-COOKIE | `?format=csv` | `{days[…], flags[]}` or CSV (BOM, `;`, decimal comma; one row per participant of placed orders) |
| POST | `/api/pizza/pizzerias` | ADMIN-COOKIE | `{name ≤60, phone? ≤30, base_name? ≤60}` | 201 `{id}`; 409 `exists` |
| GET, PUT | `/api/pizza/pizzerias/:id` | ADMIN-COOKIE | Partial row | Row with full menu and toppings; 409 `exists` |
| PUT | `/api/pizza/pizzerias/:id/menu` | ADMIN-COOKIE | `{base_name, items[string or {number?, name ≤80, ingredients?[≤20 × ≤40]}], toppings[≤40]}` | 200; missing items deactivated, missing toppings deleted |

Attendee 401 codes: missing or unknown token `unauthorized`, expired `token_expired`. Unknown paths 404 `not_found`.

**Tournament** (`src/pages/api/tournament/**`, 28 files; errors `{success:false, error, message}`; 401, 400, 404, 409, 500 as noted).

| Method | Path | Auth | Request | Response and codes |
|---|---|---|---|---|
| GET | `/api/tournament/events` | — | — | `{events:[{id, game_name, is_final, event_link, steam_store_url, vc_plan, vc_created, vc_channel_ids, scoring_started, roster_ready, cleanup_requested, vc_cleaned, create_now_requested, starts_at, registration_closes_at, status, registrant_count, created_by, scored_count}]}` (the bot polls this) |
| POST | `/api/tournament/events` | SECRET or T-ADMIN | `{game_name, starts_at, event_link?, steam_store_url?, vc_plan?, is_final?}`; SECRET also `registration_closes_at`, `created_by` | 201 event; 409 second final; offset-less times read as local time |
| PATCH | `/api/tournament/events/:id` | T-ADMIN | Any of the create fields; a new `starts_at` is a postpone | 200; 409 after voice channels or scoring; 409 final conflict; 400 if only `is_final` |
| DELETE | `/api/tournament/events/:id` | SECRET or T-ADMIN | — | 204; deletes photos, final results, scores, registrations |
| PATCH | `/api/tournament/events/:id/status` | SECRET | `{status: open|closed|started|cancelled|completed}` | `{ok:true}` |
| PATCH | `/api/tournament/events/:id/vc` | SECRET | `{vc_created:true, vc_channel_ids{name: snowflake}}` | 200; 409 if set |
| PATCH | `/api/tournament/events/:id/cleanup` | SECRET | `{vc_cleaned:true}` | 200; 409 if cleaned |
| PATCH | `/api/tournament/events/:id/create-now` | SECRET | `{create_now_requested:false}` | 200 |
| POST, PATCH, GET | `/api/tournament/events/:id/roster` | POST, PATCH SECRET; GET T-ADMIN | POST `{channels{name:[{discord_user_id, discord_username, dwell_seconds}]}, assignments[], leftovers{registered_not_qualified[], present_not_registered[]}}`; PATCH `{present_not_registered[]}` | 200 (idempotent); 409 before scoring or cancelled; GET 404 until posted |
| POST | `/api/tournament/events/:id/start-scoring` | T-ADMIN | — | `{id, scoring_started, roster_ready}`; 409 |
| GET, POST | `/api/tournament/events/:id/scores` | T-ADMIN | `{scores:[{discord_user_id?, discord_username, placement: first|second|participant|no_show, points, add_as_registered?}], fill_no_show?}` | Replaces all; `{event_id, scores_recorded, warnings?, cleanup_requested, vc_cleaned, create_now_requested}`; 409 cancelled |
| GET | `/api/tournament/events/:id/scores/public` | — | — | `{event_id, game_name, scores[{discord_username, placement, points}]}` |
| GET, POST | `/api/tournament/events/:id/registrants` | GET SECRET or T-ADMIN; POST T-ADMIN | `{discord_username, discord_user_id?}` | 201; 409 `nickname_unresolved` with `candidates[]`, duplicates, scored or cancelled |
| DELETE | `/api/tournament/events/:id/registrants/:registrant_id` | T-ADMIN | — | 204; 409 when scored |
| GET | `/api/tournament/events/:id/registrants/public` | — | — | `{event_id, game_name, registrants[{discord_username}]}` |
| POST | `/api/tournament/events/:id/end` | T-ADMIN | — | Status `cancelled`, cleanup requested |
| POST | `/api/tournament/events/:id/reopen` | T-ADMIN | `{registration_closes_at?}` | 200; 409 unless closed, future, no voice or scoring |
| POST | `/api/tournament/events/:id/debug/create-now`, `/debug/cleanup-now` | T-ADMIN | — | Sets the flag; 409 |
| GET, PUT, DELETE | `/api/tournament/events/:id/final` | T-ADMIN | PUT `{finalists:[{discord_user_id?, discord_username, final_rank?, final_score?}]}` | GET `{event_id, finalists[], photos{slot:{bytes, updated_at}}}`; 409 not final |
| GET | `/api/tournament/events/:id/final/photos/:slot` | — | — | JPEG, ETag, immutable cache, 304 |
| PUT, DELETE | `/api/tournament/events/:id/final/photos/:slot` | T-ADMIN | Raw JPEG ≤ 512,000 bytes | `{slot, bytes, etag}`; 413, 415, 409 |
| GET | `/api/tournament/leaderboard` | — | — | `{leaderboard[{discord_user_id, discord_username, total_points, events_played, finalist, final_rank, final_score}], last_updated, final}` |
| GET | `/api/tournament/me`, `/admin/me` | PLAYER, T-ADMIN | — | `{discord_user_id, discord_username}` |
| GET, POST | `/api/tournament/registrations` | PLAYER | POST `{event_id}` | List, or `{event_id, registered:true}`; 403 unless `open` |
| DELETE | `/api/tournament/registrations/:event_id` | PLAYER | — | `{event_id, unregistered:true}`; 403 unless `open` |
| GET, POST | `/api/tournament/internal/token`, `/internal/admin-token` | SECRET | GET `?user_id=`; POST `{token, user_id, username, expires_at}` (aliases accepted) | `{token}` or 404; upsert `{ok:true}` |
| GET | `/api/tournament/internal/users/:user_id/registrations` | SECRET | — | `{registrations[{event_id, game_name, starts_at, status, registered_at}]}` |
| DELETE | `/api/tournament/internal/clear` | SECRET | — | 204; wipes all tournament data and both token tables |

**Display, bot ingest, heartbeat, health.**

| Method | Path | Auth | Request | Response and codes |
|---|---|---|---|---|
| GET | `/api/display/state` | — (CORS `*`) | `include=tournament`, `trend_seconds`, `finals_registration_min`, `finals_started_min` | `data{activePoll, latestClosedPoll, presence, voiceChannels (null if older than 120 s), games (top 4 with covers), announce, server_now, presencePrevious?, gamesPrevious?, trendStateNow?, trendState96h?, statsHistory?, tournament?, finals?}`; sub-queries fail soft to null; writes the cover cache on a miss |
| POST, DELETE | `/api/display/announce` | SECRET | `{message, sfx: bell|fanfare|alert|cancel}` | Raw `{ok:true}` |
| PUT, DELETE | `/api/display/finals` | SECRET | `{seasonId, name, state, format, mode, createdAt, startedAt, capacity, registered, link}` | 204 |
| POST | `/api/display/stats-history` | SECRET | `{statsHistory{…} ≤ 512,000 chars}` (validated, then ignored) | Raw `{ok:true}`; triggers the fold |
| POST | `/api/display/trend-state` | **— (public write)** | `{games_now?{d,a}, games_96h?{d,a}}` | `{ok:true}`; preflight unhandled |
| GET | `/api/display/polls-rss` | — | — | RSS 2.0, `max-age=60` |
| POST | `/api/polls` | SECRET | `{question, options[], created_by, expires_at?}` | Raw 201 poll; 409 when one is active |
| GET | `/api/polls/active` | — | — | Raw poll with counts; 404 |
| PATCH | `/api/polls/:id` | SECRET | `{message_id}` | Raw `{ok:true}` |
| POST | `/api/polls/:id/votes` | SECRET | `{user_id, option_id}` | Upsert per user; 404 |
| POST | `/api/polls/:id/close` | SECRET | — | Raw poll with counts and `options:[]`; also used for cancel |
| POST | `/api/snapshots/presence` | SECRET | `{timestamp, online_count, idle_count, dnd_count}` | Raw 201; duplicate second gives 500 |
| POST | `/api/snapshots/voice` | SECRET | `{timestamp, channels[{channel_name, user_count}]}` | Raw 201; occupied channels only |
| POST | `/api/snapshots/game` | SECRET | `{timestamp, games[{game_name, user_count, application_id?, cover_image_url?}]}` | Raw 201 |
| POST | `/api/manager-heartbeat` | HEARTBEAT | `{status, version, uptimeSeconds, checks[], sentAt}` | 204; errors `{error{code, message}}` |
| GET | `/api/health` | — | — | `{status, version, uptimeSeconds, checks[{name:'database'}]}`; 503 when down |

**Site routes (stay on the site).**

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/registration` | Turnstile (optional), rate limit | Form `nick, realname, email, cf-turnstile-response`; 429, 400, 403 (no event, not open, closed, full); 302 to `/thankyou` or 200 with `emailSent:false` |
| POST | `/api/delete-user` | HASH | `{id or nick, hash}`; 400, 403, 404 |
| GET | `/api/events/current` | — | Whole active event row, `registration_open`, `registration_count` |
| GET, POST, PUT | `/api/events/manage` | GET none; others ADMIN-COOKIE | Older event admin |
| GET, POST, PUT | `/api/events/manage.refactored.example` | Same | Example file served as a live route |
| POST | `/api/events/set-max` | **none** | Changes any event's capacity |
| POST | `/api/admin/auth`, `/api/admin/logout` | Password; none | Session cookie |
| GET, POST, PUT, DELETE | `/api/admin/events` | GET **none**; others ADMIN-COOKIE | Event CRUD and activation |
| GET | `/api/admin/events/content-template` | ADMIN-COOKIE | Content of the latest past event |
| POST | `/api/admin/events/preview` | ADMIN-COOKIE | Rendered previews of content and e-mails |
| GET, POST, PUT, DELETE | `/api/admin/users` | ADMIN-COOKIE | Participants; e-mails on add and delete |
| POST | `/api/admin/send-reminder` | ADMIN-COOKIE | BCC in chunks of 50 |
| POST | `/api/admin/lan-reset` | ADMIN-COOKIE | `{snapshots?, polls?}` (see D16) |
| GET, POST, PUT, DELETE | `/api/admin/quick-links` | ADMIN-COOKIE | Home sections |
| GET, POST, PUT, DELETE | `/api/admin/music` | GET **none**; others ADMIN-COOKIE | Track metadata |
| GET | `/api/music/tracks` | — | Track list |
| GET, POST | `/api/snake-hiscore` | — | Top 5; score trusted from the client |
| GET | `/api/terminal/ping` | — | Is a nick registered for the active event |
| GET | `/api/_debug/session-rows` | — | Always 404 |

**Pages:** `/`, `/thankyou`, `/design-preview/home-countdown`, `/admin`, `/admin/email-participants`, `/admin/pizza`, `/admin/pizza/pizzerias`, `/admin/pizza/report`, `/lan-display`, `/pizza`, `/pizza/orderer`, `/pizza-[day]`, `/tournament`, `/tournament/admin`, `/tournament/leaderboard`, `/tournament/register`, `/tournament/rules`.

### C. Discord commands and handlers

The site has no Discord client. Commands live in the bot repo (#69) and reach the site over HTTP:

| Bot command or job | Site route it uses |
|---|---|
| `/pizza order`, `/pizza claim` | Issue a link with a registration token (`/internal/token`); the site renders the command mentions from `PIZZA_DISCORD_CMD_ID_ORDER` and `_CLAIM` |
| `/tournament register`, `/tournament admin` | `/internal/token`, `/internal/admin-token`, then a page link with `?token=` |
| `/tournament schedule`, `my-registrations`, `leaderboard`, `list` | `GET /events`, `/internal/users/:id/registrations`, `/leaderboard` |
| `/tournament add`, `remove`, `clear` | `POST /events`, `DELETE /events/:id`, `DELETE /internal/clear` |
| T−15 and deadline jobs | `PATCH /status`, `PATCH /vc`, roster `POST`, `PATCH /cleanup`, `PATCH /create-now`; reminder DMs from `GET /registrants` |
| Poll commands (create, cancel, votes) | `/api/polls*` |
| Presence, voice and game collectors | `/api/snapshots/*`, `POST /api/display/stats-history` |
| Announce and finals watcher | `/api/display/announce`, `/api/display/finals` |

Outbound Discord traffic from the site: two webhooks only (pizza channel, admin alert channel).

### D. WebSocket, SSE and streams

None. Everything polls: pizza pages 20 s, the pizza block 10 s, the display 30/10/20 s, the tournament admin roster 2 s, the leaderboard 60 s. (A removed shoutbox used SSE; see Known problems.)

### E. Messages and events

There is no bus. Three kinds of messages exist:

- **`postMessage` to the parent window** (only when embedded, target `*`): `canccu:screen-ready` (once per load, before the first API call), `canccu:screen-pages` (`pageCount`, `pageIndex`, `pageSeconds` per tournament panel), `canccu:screen-cue` (`cue`, `source`). Cues: `chrome.hot`, `chrome.voice`, `chrome.spike`, `strip.tournament_next`, `strip.finals_open`, `strip.finals_start`, `tournament.pre`, `tournament.start`, `tournament.post`. Sent on transitions after a baseline; view cues at most twice per cue and source until the view is re-entered.
- **Pizza audit log** (`pizza_order_log.event`): `open`, `claim`, `release`, `force_release`, `close`, `reopen`, `placed`, `unplace`, `cancel`, `bill`, `order_edit`, `payer_change`, `pizza_edit`, `pizza_delete`, `reminder_open_30`, `reminder_open_60`, `reminder_closed_30`, `reminder_closed_60`, `auto_release`. These are the natural seeds of `pizza.order.*` events.
- **Tournament flags** polled by the bot (`create_now_requested`, `scoring_started`/`roster_ready`, `cleanup_requested`, `vc_created`/`vc_cleaned`): an implicit event stream.

### F. Scheduled and background jobs

| Schedule | Job | Where |
|---|---|---|
| `0 * * * *` (any cron other than the exact five-minute string) | Snapshot retention: delete presence, voice and game rows older than 15 min, 1000 per table per run | `src/worker.ts`, `src/canccubot/retention.ts` |
| `*/5 * * * *` | Manager heartbeat check: alert once after 10 min of silence, once on recovery | `src/lib/manager-heartbeat.ts` |
| `*/5 * * * *` | Pizza reminders at +30/+60 min and auto-release after 2 h closed; only the latest due step, within 30 min; logged only after a successful post | `src/lib/pizza/reminders.ts` |
| Each request | Discord pizza posts run in `waitUntil` | `src/lib/pizza/announce.ts` |
| Bot-triggered | Stats fold on `POST /api/display/stats-history` | `src/lib/stats-history-refresh.ts` |
| Deploy | `wrangler d1 migrations apply --remote`, then build and deploy | `.github/workflows/deploy.yaml` |

No job expires tokens, admin sessions, polls, cover cache or pizza data.

## Data

All stores are D1 (SQLite) tables in one database. "Scope" says whether the data is per event, global, or belongs to a venue rather than to an event. Today only `users` has an event key; everything else is global to the deployment, so pizza, tournament and display data from different events mix unless reset by hand.

| Table | Columns or keys | Scope (as built → as meant) | Retention |
|---|---|---|---|
| `events` | `id`, `name` (unique slug), `display_name`, `is_active` (one active by app rule), `registration_opens`, `registration_closes`, `max_registrations`, `early_bird_price`, `price`, `early_bird_deadline`, `event_start_date`, `info_html`, payment fields (`payment_bank_account`, `payment_mobilepay`, `payment_reference_template`, `payment_html`), e-mail templates (`email_early_bird_html`, `email_regular_html`, `email_cancellation_html`), `venue_text`, `food_text`, `contact_text`, `thank_you_html`, `created_at` | the event entity; venue is free text | permanent |
| `users` (registrations) | `id`, `nick`, `name`, `email`, `hash`, `timestamp`, `event_id`; unique (`event_id`, `nick` nocase) | per event | permanent; orphaned when the event is deleted |
| `quick_links` | `id`, `name`, `url` (component key), `sort_order`, `always_show`, `visible_from`, `visible_until` | global → per event | permanent |
| `admin_sessions` | `token`, `created_at`, `expires_at` | global | never purged |
| `music_tracks` | `id`, `title`, `artist`, `filename` (unique), `track_order`, `duration_seconds`, timestamps | global → per event | permanent |
| `snake_hiscores` | `id`, `initials`, `score`, `achieved_at` | global | top 5 kept |
| `polls`, `poll_options`, `poll_votes` | poll: `id`, `question`, `created_by`, `created_at`, `expires_at`, `status`, `message_id`, `closed_at`; option: `id`, `poll_id`, `label`; vote: (`poll_id`, `user_id`) key, `option_id`, `voted_at` | global → per event | permanent (Discord user ids) |
| `presence_snapshots` | `timestamp` (PK, seconds), `online_count`, `idle_count`, `dnd_count` | global → per event (per guild) | 15 min |
| `voice_snapshots` | `timestamp`, `channel_name`, `user_count` | global → per event | 15 min |
| `game_snapshots` | `timestamp`, `game_name`, `user_count`, `application_id`, `activity_cover_url` | global → per event | 15 min |
| `game_cover_cache` | `game_name_normalized` (PK), `cover_image_url`, `source`, `resolved_at`, `igdb_game_id` | global (shared cache is fine) | TTL checked on read only (7 d hit, 1 h miss) |
| `lan_display_trend_state` | `context` (PK), `state_json`, `updated_at` | global → per screen or event | until lan-reset |
| `display_announce` | singleton: `message`, `sfx` | global → per event | until replaced |
| `lan_display_stats_history` | singleton: `payload_json` (hourly and daily presence, voice peaks, top games 96 h, fold cursor), `computed_at`, `updated_at` | global → per event | rolling windows |
| `lan_display_finals` | singleton: `payload_json`, `updated_at` | global → per event | until deleted |
| `manager_heartbeat` | singleton: `payload_json`, `received_at`, `stale_alerted` | global (platform) | last only |
| `tournament_events` | `id`, `game_name`, `event_link`, `steam_store_url`, `vc_mode`, `vc_channel_names`, `vc_created`, `vc_channel_ids`, `scoring_started`, `roster_json`, `cleanup_requested`, `vc_cleaned`, `create_now_requested`, `is_final` (one final by partial unique index), `starts_at`, `registration_closes_at`, `status`, `created_by`, `created_at` | global, not linked to `events` → per event | until deleted or `internal/clear` |
| `tournament_registrations` | `id`, `event_id`, `discord_user_id` (nullable), `discord_username`, `registered_at`; unique (`event_id`, `discord_user_id`) | per tournament session → per event | same |
| `tournament_scores` | `id`, `event_id`, `discord_user_id`, `discord_username`, `placement`, `points`, `recorded_at` | same | same |
| `tournament_final_results` | `id`, `event_id`, `discord_user_id`, `discord_username`, `final_rank`, `final_score` | same | same |
| `tournament_final_photos` | (`event_id`, `slot`) key, `content_type`, `bytes`, `etag`, `data` (BLOB ≤ 512 KB), `updated_at` | same → tenant files | same |
| `registration_tokens`, `admin_tokens` | `token` (plaintext UUID), `discord_user_id`, `discord_username`, `created_at`, `expires_at` | global per Discord user → replaced by sign-in | never purged (7-day validity) |
| `pizzerias` | `id`, `name` (unique), `phone`, `base_name`, `created_at` | global → **venue** | permanent; no delete route |
| `pizzeria_menu_items` | `id`, `pizzeria_id`, `number`, `name`, `sort_order`, `active`, `ingredients` (JSON); unique (`pizzeria_id`, `name`) | global → **venue** | permanent (soft deactivate) |
| `pizzeria_toppings` | `id`, `pizzeria_id`, `name` (nocase), `sort_order` | global → **venue** | hard-deleted on menu replace |
| `pizza_orders` | `id`, `date` (local date), `seq` (unique per date), `pizzeria_id`, `target_at`, `note`, `opened_at`, `opened_by_name`, `closed_at`, `orderer_discord_user_id`, `orderer_name`, `claimed_at`, `placed_at`, `payer_discord_user_id`, `payer_name`, `bill_total_cents`, `cancelled_at`, `cancelled_by_name`, `created_at`; partial unique index allows one open order | global by date → per event | permanent (for the bill system) |
| `pizza_order_log` | `id`, `order_id` (no FK), `at`, `discord_user_id`, `display_name`, `event`, `detail` (JSON) | per event | permanent; removed only by admin delete |
| `pizza_items` | `id`, `order_id`, `discord_user_id`, `display_name`, `kind`, `menu_item_id`, `custom_toppings`, `text`, `note`, `comment`, timestamps | per event | permanent |
| Dropped: `shoutbox_events`, `active_sessions` | — | — | dropped in migration 016 |
| Browser `localStorage` `lan-display-96h-trend` | rank-arrow memory | per screen device | none |

**Schema history.** 33 migrations (001–032; two are numbered 014). The base `events` table, `quick_links` and `users.event_id` were created by hand in production and are in no migration, so the migrations cannot build an empty database (they fail at 003); `src/db/schema.ts` is the only full description. Destructive migrations in the history: 015 (deleted duplicate registrations in production), 016 (dropped the shoutbox tables), 017 (dropped an index), 030 and 031 (table rebuilds by copy, drop and rename). This matters only as history: nothing is migrated ([0004](../decisions/0004-nothing-migrated.md)).

**Backups:** none described in the repo.

## Configuration

Secret values are never in the repo and none are copied here.

### Bindings and platform (`wrangler.jsonc`, `astro.config.mjs`)

| Key | Default | Meaning |
|---|---|---|
| `DB` | — | D1 binding; database name and id in `wrangler.jsonc` (event-specific, see below); `migrations_dir: migrations` |
| `ASSETS` | `./dist` | Static assets |
| `triggers.crons` | `0 * * * *`, `*/5 * * * *` | See Scheduled jobs |
| `compatibility_flags` | `nodejs_compat` | |
| `security.checkOrigin` | `false` | Off so the bot can POST |
| `vite.server.allowedHosts` | a tailnet suffix | Dev preview over the tailnet |
| Build integration | — | Deletes the album zip from the build (25 MiB asset limit) |

### Secrets

| Name | Default | Meaning |
|---|---|---|
| `API_SECRET` | unset rejects all | Bot bearer for every ingest and tournament bot route |
| `ADMIN_PASSWORD` | unset gives 500 | The single admin password (not in the README's list) |
| `MANAGER_HEARTBEAT_TOKEN` | unset gives 401 | Heartbeat bearer |
| `ADMIN_DISCORD_WEBHOOK_URL` | unset: no alert | Admin alert channel |
| `PIZZA_DISCORD_WEBHOOK_URL` | unset: no posts, reminders not logged | Pizza channel |
| `RESEND_API_KEY` | — | E-mail (registration side) |
| `REPLY_TO` | — | Reply-to and BCC on every registration mail |
| `TURNSTILE_SECRET_KEY` | unset: Turnstile skipped | Anti-spam |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | unset: IGDB step skipped | Cover art (never reached in production) |

### Plain variables

| Name | Default | Meaning |
|---|---|---|
| `PIZZA_DISCORD_CMD_ID_ORDER`, `PIZZA_DISCORD_CMD_ID_CLAIM` | unset: inline code | Discord command ids for clickable mentions |
| `FINALS_REGISTRATION_WINDOW_MINUTES` | 15 | Finals card window after registration opens |
| `FINALS_STARTED_WINDOW_MINUTES` | 10 | Finals card window after start |
| `TREND_WINDOW_SECONDS` | 600 (60–600) | Trend lookback; not declared in the `Env` type |
| `TURNSTILE_SITE_KEY` | unset: no widget | Registration side |
| `PUBLIC_TOURNAMENT_DEBUG_UI` (build) | on unless `false`; deploy sets `false` | Tournament debug buttons |
| `PUBLIC_API_URL` (build) | same origin | Tournament client base |
| `PUBLIC_MUSIC_ZIP_URL` (build, repo variable) | a static path | Album download |
| `DEBUG_LOGS`, `NODE_ENV`, `DEV`, `PROD` | — | Logging, cookie `secure` flag, error detail |
| Deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | — | GitHub secrets for the deploy action |

### LAN display URL parameters

`view`, `msg`, `sfx`, `season_id`, `season_name`, `window_end`, `demo`, `bg_fade_ms` (5000), `hot_game_min` (4), `busy_voice_min` (5), `spike_min` (5), `poll_result_line_min` (10), `tournament_soon_min` (30), `tournament_pre_min` (15), `trend_seconds`, `include`, `finals_registration_min`, `finals_started_min`, `api_base` or `api`.

### Hard-coded settings that become configuration

- The local time zone and locale (pizza, tournament, display, registration); euro currency with a decimal comma.
- Pizza: reminder steps 30 and 60 min, send window 30 min, auto-release 120 min, bill cap 500,000 cents, 1–4 toppings, text limits, poll intervals.
- Tournament: points 3/2/1/0 plus bonus (in the route, the admin UI and the rules text), registration closes at start − 1 h, current-session grace 10 min, team labels of one game, default solo channel name, photo limits, cover TTLs.
- Display: poll intervals, 120 s voice freshness, 15 s pulse dwell, 8 s carousel, 20 s tournament panel, heartbeat stale 10 min.
- Registration side: rate limit 5 per 15 min per isolate, session 4 h, BCC chunk 50, nick ≤ 20, a hard-coded sender address.

## External integrations

| Integration | Used for | Needs |
|---|---|---|
| Discord bot (separate repo, #69) | All ingest: polls, votes, snapshots, stats fold, announce, finals; tournament tokens, flags, roster, voice channels | `API_SECRET` shared with the bot |
| Discord webhooks | Pizza channel posts and reminders; admin heartbeat alerts | Two webhook URLs |
| Signage screen (separate repo, #71) | Embeds `/lan-display` in an iframe, receives `postMessage`, plays the sfx, polls `/api/pizza/status` | The site's fixed origin |
| Manager (separate repo, #70) | Pushes the heartbeat | `MANAGER_HEARTBEAT_TOKEN` |
| Steam store (no key) | Tournament covers: appdetails, header image, store search | Outbound HTTP, uncached on the display path |
| IGDB via Twitch OAuth | Cover fallback (unreachable in production) | Client id and secret |
| Discord CDN activity art | Game covers from bot snapshots | Bot sends URLs |
| Resend (registration side) | Confirmation, cancellation and bulk e-mail | API key, verified sender domain |
| Cloudflare Turnstile (registration side) | Anti-spam | Site key and secret |
| Cloudflare Workers, D1, static assets, cron | Hosting, database, schedules | Account, API token |
| Google Fonts | Pizza and display fonts | Outbound fetch from browsers |
| Third-party signage ticker | Polls RSS | Public URL |
| Files and media | Final photos as D1 BLOBs; 12 event-music mp3s (about 66 MB) and an album zip hosted outside; 4 sfx mp3s (licence provenance not recorded per file, one generated placeholder); 2 mascot PNGs; a static game-server text file | — |

## Tests

Vitest; CI runs `pnpm run test:run` only (no lint, typecheck or build). 83 test files. Pizza router tests run against `node:sqlite` with real migrations (006, 012, 028, 029, 030) through a D1 shim; nearly everything else mocks the DB.

| File(s) | Covers |
|---|---|
| `pizza-db` | One-open index, case-insensitive toppings |
| `pizza-routes` | Token 401 codes, status and CORS, phone only for holder, add/edit/delete rules, 415, holder semantics, view helpers |
| `pizza-orders` | Open, claim, release, close, reopen, placed, unplace, cancel (incl. stale), bill, `/me/bills`, summary, admin list, menu replace, payer validation, delete, report and CSV bytes |
| `pizza-announce` | Embed payloads, ping rules, command-id fallback, failures don't fail routes |
| `pizza-reminders` | 30/60 steps, latest only, send window, retry, auto-release, new holder clock |
| `pizza-report`, `pizza-summary`, `pizza-validate`, `pizza-menu-filter`, `pizza-client`, `pizza-day-redirect`, `lan-display-pizza` | Pure helpers, time-zone formatting across DST, CSV quoting, client content type, redirects, display block mapping and stale rule |
| `tournament-events`, `tournament-events-route`, `tournament-event-by-id-route` | Create (SECRET and admin), local-time parsing, link validation, postpone, voice-plan locks |
| `tournament-event-{cleanup,create-now-ack,vc,end,reopen,debug}-route`, `tournament-start-scoring-route`, `tournament-poll-flags` | Bot acknowledgements, flags the bot relies on, 409s |
| `tournament-roster-route`, `tournament-roster-autofill`, `tournament-registrants-admin` (real SQLite), `tournament-scores-{bonus,cleanup,nick-link}-route`, `tournament-score-merge`, `tournament-leaderboard-collapse` | Roster, autofill solo/team, add by name, bonus, cleanup rules, nickname linking, identity merge |
| `tournament-final`, `tournament-final-routes`, `tournament-final-delete`, `tournament-final-view-html` | Final ordering, validation, photos (413/415/ETag/304), delete order, HTML escaping |
| `tournament-tokens`, `tournament-token-routes`, `tournament-auth`, `tournament-api` | Token upsert, field aliases, expiry normalisation, bearer parsing |
| `tournament-display-payload`, `tournament-datetime-display`, `tournament-steam-cover`, `tournament-vc-plan`, `game-cover`, `game-name-match`, `igdb-client` | Screen payload, cover chain and TTLs, fuzzy match, IGDB token |
| `canccubot-{auth,polls,retention,routes,snapshots}` | Ingest auth, poll lifecycle, retention SQL and batch, route status codes |
| `display-{announce,finals,state,stats-history,trend-state}-*`, `stats-history-accumulator`, `snapshots-stats-games-96h` | Display routes, finals windows, state assembly incl. tournament and covers, fold rules |
| `lan-display-{alive,demo,finals-card,screen-cues,state}`, `trend-{arrow,state-payload,window}`, `snapshot-freshness` | Pure display logic, cue emitter and gate, demo overlays |
| `manager-heartbeat` | Route and the alert-once/recover-once state machine |
| `registration`, `registration-window`, `validation-registration-nick`, `delete-user`, `admin-reminder-routes`, `event-*`, `retro-terminal-*`, `snake-hiscore`, `terminal-ping` | Registration side (stays on the site) |

Gaps that matter for the port:

- No tests for the pages and their client logic: the pizza orderer checklist and time helpers, the 1433-line tournament admin page, the 1800-line display script (rendering, view switching, countdowns, ready and pages messages).
- Tournament: no tests for player routes, `admin/me`, leaderboard, public scores and registrants, the status route, `DELETE` event, internal registrations, `is_final` changes; no real-SQL tests of the leaderboard, score upsert or final.
- Display: no tests for the polls RSS, the cron dispatch, the stats fold against a database, the closed-poll winner logic, or real SQL for retention.
- Pizza: no race tests beyond the index backstop; admin delete never tested with an existing order and a non-admin.
- Admin auth, session expiry, cookie flags and the unauthenticated routes are untested.
- Tests do not run on the full schema (the hand-made tables cannot be built from migrations).
- Nothing tests the bot contract end to end. The pure helpers' tests port directly; route tests need new harnesses on Postgres.

## Known problems

From the code, the docs and the commit history. No TODO or FIXME markers exist in `src`.

**Incidents**

1. **Worker resource limit (error 1102), July 2026:** the display state endpoint did cover lookups, stats aggregation and tournament loading on every poll. Fixed by a fast cover path, bounded reads, a 30 s poll, `include=tournament` opt-in and a precomputed stats blob pushed by the bot.
2. **D1 free-tier write quota, September 2026:** the bot posted every voice channel (including empty ones) every 30 s, raw snapshots were kept 96 h, and the hourly cleanup never ran because of a misspelled cron key. About 7.6 M rows backed up. Fixed with occupied-only voice, 15-minute retention capped at 1000 deletes per table per hour, and a standing warning never to mass-delete the snapshot tables.
3. **Announce lost between isolates:** it lived in memory; now a D1 singleton.
4. **Bot restart wiped the 24 h and 96 h charts:** the blob was replaced from bot memory; it now folds from D1 rows.
5. **Migration 015 failed in production** on duplicate registrations and was changed to delete them.
6. **Ready handshake with signage raced:** background tabs run no animation frames, so a healthy page looked failed.

**Security and privacy**

7. Unauthenticated writes: `POST /api/events/set-max` (also runs `ALTER TABLE` at runtime) and `POST /api/display/trend-state` (no size limit; several screens overwrite each other).
8. Unauthenticated reads of admin data: `GET /api/admin/events`, `/api/events/manage`, `/api/admin/music`; `/api/events/current` returns the full event row with e-mail templates and payment details; an example route file is live.
9. Pizza comments are public: `/orders/current` and `/orders/:id` return notes and comments to anyone, and orders can be enumerated by id.
10. Tokens are plaintext UUIDs in URLs, never revoked or purged; one `API_SECRET` can wipe all tournament data (`internal/clear`); `DELETE` session also accepts tournament admin tokens.
11. Admin login has no throttle; the session token is logged and returned in the body; sessions never purged; the session check logs tokens at debug level.
12. A bot-supplied cover URL is put into a style attribute through `innerHTML` with only `'` escaped.
13. Registration side: derivable deletion hash with non-constant compare; regex HTML sanitizer; unescaped values in e-mails; CSV export without escaping; per-isolate rate limiter that does not work across isolates.
14. No retention for personal data: Discord ids, names, comments and bills (pizza), poll votes, tokens, registrations are kept forever.

**Correctness and races**

15. Pizza lifecycle routes (placed, close, cancel, bill, unplace) are read-then-write; double "placed" can post twice. Only open and claim are atomic.
16. Pizza: forced release posts the holder's name; an admin "placed" leaves the payer empty; an open order from an earlier day blocks new orders until cancelled; history labels follow live menu data; the display says "by" the holder, not the payer.
17. Tournament multi-row writes (scores, finalists, create plus final flag) are not transactional; a final-flag race gives 500.
18. Tournament dates compared as strings; seed data uses another format and sorts wrong; SQLite `lower()` is ASCII-only while the JS side is Unicode-aware.
19. The tournament registration deadline is enforced only by the bot closing the session; if the bot is down, registration stays open.
20. Players without a Discord id are keyed by lowercased name, so two people with one nickname merge on the leaderboard.
21. `PATCH` with only `is_final` returns 400 (the UI hides it by always sending every field).
22. `internal/clear` relies on a cascade that other code says D1 does not have.
23. Display: no freshness check for games and presence (only voice); presence timestamp is a primary key in seconds, so a retry in the same second gives 500; the fold skips late rows and is not atomic; retention falls behind beyond about 8 busy games or channels; charts freeze if the bot stops calling the fold.
24. Polls: creating is not atomic (two active polls possible); expiry is never enforced; close returns no options; cancel is indistinguishable from close.
25. Every display state call with the tournament included makes uncached Steam requests; the cover cache is written on a public GET; the full cover chain is dead in production.
26. The cron dispatcher sends any cron string other than the exact five-minute one to retention.
27. Registration side: the event box shows times 2–3 h off (formatted as UTC); terminal `DELETE` looks the nick up across all events; admin add-user skips all checks; deleting an event orphans its users; capacity and activation are not atomic.

**Fragile parts and drift**

28. The schema cannot be rebuilt from migrations; two migrations share a number; production migrations run before the build in the deploy.
29. Two very large string-built UIs (`tournament/admin.astro`, `lan-display.astro`) with hand-rolled escaping and inline types that drift from the libraries.
30. Dead code: the leaderboard fullscreen branch and its component, unused SQL aggregators, carousel and wash helpers, an in-memory announce fallback, a `scored` status that does not exist, IGDB in production.
31. Docs drift: the project description still lists the removed shoutbox and stops at migration 008; the tests doc says CI is disabled; several CONTEXT docs disagree on intervals and cover order; the README names scripts that do not exist; the stale generated `Env` type.
32. Removed over history: the shoutbox (SSE chat), per-day pizza pages linking to spreadsheets, the display's self-cycling (it must never pick its own view), the idle view, the HTML registration form.
33. Open items in docs: a pending production smoke test for the hot-game banner; an unsigned tournament screen review; a bot-side `/poll-edit` with no API; ideas filed but not built (tokenless LAN pizza page, an "Order a pizza" button, `/pizza status`, one admin with one login, several finals).

## Port recommendation

Targets use the roadmap's steps. "Drop" follows [0005](../decisions/0005-signup-site-stays-outside.md) and [0010](../decisions/0010-scope.md) unless said otherwise.

| Feature | Verdict | Reason | Target module | Roadmap step |
|---|---|---|---|---|
| P1–P5 pizza order lifecycle and router | port with changes | Router rules, status codes and tests are the spec; add `event_id`, one open order per tenant, Postgres transactions and conditional updates for every transition; sign-in identity instead of registration tokens; fix public comments | pizza | 5 |
| P2 validate, menu filter, summary, orderer view | port as-is | Pure TypeScript with tests | pizza | 5 |
| P6 Discord posts | port with changes | `pizza.order.*` events consumed by the bot instead of a webhook; command ids from the bot contract | pizza, bot | 5, 6 |
| P7 reminders and auto-release | port with changes | Scheduler inside the pizza container; the once-per-step and retry rules kept | pizza | 5 |
| P8–P9 pizza admin, pizzerias and menus | port with changes | Admin rights from sign-in; pizzerias and menus as venue data; hard delete becomes logged or soft | pizza, admin | 5 |
| P10 daily record and CSV | port as-is | Report and CSV with tests; time zone from settings | pizza | 5 |
| P11–P12 pizza block and status | port with changes | Screen consumes `pizza.order.*` instead of polling a status URL | screen, moments | 5, 9 |
| P13 per-day redirect | drop | Retired pages | — | — |
| T1–T4 schedule, rules, leaderboard, player registration | port with changes | Registration inside the module ([roadmap step 7](../roadmap.md#7-tournament)); rules text and points to settings; `timestamptz` and Unicode-safe names | tournament | 7 |
| T5–T6 session admin and registrants | rewrite | The admin page is a 1433-line string-built UI; logic (postpone, reopen, candidates) ported from `events.ts` and `registrations.ts` | tournament | 7 |
| T7 scoring, roster autofill, score merge | port with changes | Pure parts as-is; writes in transactions with row locks | tournament | 7 |
| T8 final and photos | port with changes | Pure parts as-is; photos to tenant files with the ETag scheme kept | tournament | 7 |
| T9 debug flags | drop | Replaced by events and an admin action if needed | — | — |
| T10 screen payload | port with changes | Becomes tournament events and a Screen widget; covers cached | tournament, screen | 7, 9 |
| T11 bot flag handshake and tokens | rewrite | Voice-channel handshake through events; tokens replaced by sign-in | tournament, bot | 7, 6 |
| T12 cover lookup | port with changes | Steam cover with a real cache; IGDB optional; shared with the hot-game banner | bot or games | 6 |
| D1–D4 LAN display page and views | rewrite | Screen views fed by events, built last; the views list and thresholds are the spec | screen | 9 |
| D3 alive chrome, D6 demo, trend helpers | port as-is | Pure helpers with tests (drop the dead carousel and wash parts) | screen | 9 |
| D5 `postMessage` cues | rewrite | The cue names and once-per-transition rules become Moments policy; the iframe protocol goes | moments | 4 |
| D7 polls | drop | Polls dropped ([0005](../decisions/0005-signup-site-stays-outside.md)) | — | — |
| D8 snapshots | port with changes | Bot presence, voice and game data as bot events or bot-owned tables | bot | 6 |
| D9–D10 stats fold and retention | rewrite | The D1 write-budget workarounds go; keep raw samples (for example 96 h) in Postgres and aggregate with SQL; retention as a scheduled job | bot | 6 |
| D11 announce and finals cards | port with changes | Become Moments takeovers from bot or games events | moments, games | 4, Games track |
| D12 browser trend state | drop | Trend arrows computed on the server | — | — |
| D13 polls RSS | drop | No ticker needs it | — | — |
| D14 manager heartbeat | drop | Dead-man's switch dropped; the alert-once/recover-once state machine is reused by admin operations and the hardening watchdog | admin | 8, 10 |
| D15 health | done | Kit health contract already exists | kit | 1 |
| D16 LAN reset | port with changes | Per-tenant admin action | admin | 8 |
| R1–R6 registration, home page, terminal, music, Snake, site admin, e-mail | drop (stays on the site) | Registration stays outside, no sync ([0005](../decisions/0005-signup-site-stays-outside.md)) | — | — |
| Admin password, admin cookie | drop | Discord sign-in through the central sign-in host | admin, sign-in | 2b (#52) |

## Tenancy questions

What this repo implies for the tenancy design (#48). Each is a question for the tenants contract or a module contract; none is decided here.

**Global (platform, superadmin)**

1. The cover cache (game name to image URL) is safe to share across tenants. Is it a global table on the RLS allow-list, and who may purge it?
2. The heartbeat and its alert channel are about the shared stack. Confirm platform alerts go to a platform channel, never to a tenant's.
3. The legacy bot writes with one secret for everything. Does each tenant's bot connection (#53) get its own credential scoped to that tenant's data?

**Per tenant (event)**

4. One open pizza order, one active poll, one final, one announce card, one finals season, one stats history: confirm each singleton becomes "one per tenant" and none stays global.
5. Pizza orders are keyed by local date with a sequence per day. With two events at once, are `date` and `seq` per tenant, and whose time zone defines "today"?
6. Tournament seasons: the legacy repo has one implicit season per database. Is a tenant one season, or can a tenant run several?
7. Identity: pizza and tournament share a per-user token issued by the bot. With central sign-in, does anything per tenant remain (display name per event, rights per event)?
8. Retention for personal data (Discord ids, names, comments, bills, votes): a per-tenant setting, a platform rule, or tied to the tenant's lifecycle (archive, delete)?
9. Settings that are hard-coded today: points table, close offset, rules text, reminder steps, auto-release, display thresholds, currency. All per-tenant settings?
10. Bot data per tenant: presence, voice and games are per Discord guild. Is a guild bound to one tenant, or can two events share a guild?

**Per venue**

11. Pizzerias, menus and toppings belong to the place. Are they venue rows (global, managed by the superadmin or an event admin) that each tenant at the venue reuses, or copied into each tenant?
12. The time zone and locale are hard-coded. Is the time zone a venue property (it follows the place) with the language a tenant setting?
13. Display state is per screen device in places (trend arrows, `localStorage`, the cue gate). Confirm these move to Screen's device rows (step 3) or to server-side Moments state.
14. A static game-server list with hosts and ports sits in the site. Is a venue or event "server list" a feature at all, or event-repo content only?

## Event-specific content

Named by kind and counted only; no value appears in this file. Exact values and their locations are listed in the PR, for a follow-up issue in the event repo. Counts are distinct values unless "occurrences" is said.

| Kind | Count | Where (by area) |
|---|---|---|
| The signup site's domain and its subdomains | 1 domain, 3 subdomains (finals card, game, files); about 125 occurrences in docs, a handful in code (display join strip and finals link, mail sender and link) and tests | docs, display, e-mail, tests |
| Event or brand name and its variants (wordmark, terminal name, music player name, package and database name, tagline) | 1 name, about 8 variants; about 40 source files plus about 50 doc occurrences | UI strings everywhere |
| A second private domain (game host) | 1 | static server list, one mp3 tag |
| Public IPv4 addresses (game servers) | 2, with about 14 host:port entries | static server list |
| Tailnet name and one tailnet host and IP | 1 tailnet, 1 host, 1 IP | dev config, docs |
| A game-server password | 1 (secret-like; not even listed in the PR) | static server list |
| Cloud database id | 1 | `wrangler.jsonc` |
| Venue name, venue URL, venue description | 1 each | terminal copy, mocks, admin placeholder |
| Cities | 2 | terminal copy, mock |
| Personal phone number of an organiser | 1 (two formats) | content defaults, terminal copy |
| Personal bank account with the holder's name | 1 | content defaults |
| Personal names and nicknames (authors, organisers, example attendees) | 3 authors, 1 organiser nick, about 15 example first names and nicknames | history, tests, mockups, placeholders |
| Personal e-mail addresses | 5 | git metadata and co-author trailers |
| Discord ids | 1 real-looking user id (13 occurrences in 2 test files); others are fakes | tests |
| Event edition names and dates (spring, autumn, summer, XL editions; first pizza day, rehearsal, fixtures) | about 7 editions, about 8 dates | branches, mocks, plans, placeholders |
| Real pizzeria branch with its district | 1 | pizza mockups |
| Example pizzerias, phones, menu items and local-language toppings | 3, 2, 6, about 8 | tests |
| Live spreadsheet links (retired per-day pizza sheets) | 3 | pizza context doc |
| Legacy repo owner accounts | 2 | docs, merge subjects |
| Developer machine paths | 29 occurrences | archived plan, docs |
| Event music (album of 12 tracks, about 66 MB) and the album zip name | 12 files, 1 name | `public/assets/` |
| Brand art: mascot PNGs and a liqueur-brand ASCII art file | 3 PNGs (2 in public, 1 in docs), 1 art file | public, docs, terminal |
| Screenshots and mockups showing the brand or hostname | 9 PNGs | docs |
| Game titles tied to the event (rules tie-breaker, finals tradition, team labels, server list) | 2 rules games, 1 finals game, 2 team labels, 16 server-list games | tournament, display, static file |
| Local time zone and locale | 1 each | pizza, tournament, display, registration |
| Local-language UI and e-mail phrases, committee sign-off | about 6 phrases, 1 sign-off | e-mail, countdown |

Menus and photos with real content: none in the repo (pizzerias, menus and final photos live only in the production database).
