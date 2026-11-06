# Legacy inventory: summary

The summary of the eight per-repo inventories of roadmap step 2a ([epic #46](../roadmap.md#2a-legacy-inventory)), issue #76. It says what is ported, where it lands and in which step, how the legacy pieces worked together, and what the product owner still has to decide before the tenants contract (#48) and the event catalog (#34) are written.

- **Status:** a proposal, waiting for the product owner's confirmation. Every "proposed answer" below is a default to confirm, reword or reject; none is decided here. A confirmed change to a decision record goes through its own issue and a new record ([decisions](../decisions/README.md)).
- **Sources:** the per-repo inventories in this folder. Each row below names its source by the per-repo feature id (for example `P7`) where the inventory has one, otherwise by the feature's name. Details, paths and reasons are in the per-repo file.
- **Verdicts:** **as-is** (port the code and its tests; inject clock, zone and storage), **with changes**, **rewrite**, **drop**. Steps are the [roadmap](../roadmap.md#steps)'s: 1 Skeleton, 2b Tenancy foundation, 2c Event catalog and screen contract, 3 Screen core, 4 Moments, 5 Pizza, 6 Bot, 7 Tournament, 8 Admin operations, 9 Feeds and LAN display, 10 Hardening, 11 Switch, **Games** and **Cast** the parallel tracks. "—" means nothing is built.

| Inventory | Issue | What the repo is | Verdict in one line |
|---|---|---|---|
| [canccusignage](canccusignage.md) | #71 | The venue screen: scheduler, playlists, directives, sound, kiosk | Core logic ports as-is to Screen and Moments; persistence, pages and auth are rewritten or dropped |
| [canccubot](canccubot.md) | #69 | The Discord bot and the glue between the legacy pieces | Trackers and pure helpers port; every push and poll becomes a bus event; polls dropped |
| [the signup site](signup-site.md) | #72 | Registration (stays outside), pizza, tournament, the LAN display page, bot ingest | Pizza and tournament port with changes; the display page is rewritten as Screen views; registration stays |
| [canccumanager](canccumanager.md) | #70 | Health poller, alerts, ack, mute, ssh actions | Debounce and alert rules port to admin; the executor is redesigned; ssh dropped |
| [thefinals_mini_tourney](thefinals_mini_tourney.md) | #75 | Brackets, rankings and team builder for one team game (ISC, another author) | Pure engine ports as-is to Games after its author's OK; the rest is rewritten |
| [canccuplatform](canccuplatform.md) | #68 | The legacy system repo: contracts, scripts, runbooks | No code ports; its contracts are the spec for the new contracts |
| [canccudocs](canccudocs.md) | #73 | Plans and requirements, no code | No code; 17 requirements are not yet in the roadmap ([Gaps](#gaps-from-the-legacy-plans)) |
| [canccustream](canccustream.md) | #74 | An RTMP multi-camera compositor, decommissioned | Drop all code; ideas go to the Cast track |

## Contents
1. [Feature map](#feature-map)
2. [Cross-repo flows](#cross-repo-flows)
3. [Tenancy questions](#tenancy-questions)
4. [Conflicts with the decision records](#conflicts-with-the-decision-records)
5. [Gaps from the legacy plans](#gaps-from-the-legacy-plans)
6. [Changes to the porting plan and order](#changes-to-the-porting-plan-and-order)

## Feature map
Every feature of the per-repo inventories, one table per repo, in the order of that inventory's port recommendation. Where an inventory grouped features, so does this table. **(new)** marks a feature the roadmap's porting plan did not name before this summary.

### canccusignage
| Feature | Target module | Step | Verdict |
|---|---|---|---|
| Schedule windows and active-schedule choice | screen | 3 | as-is |
| Playback engine, timing and bookmark maths | screen | 3 | as-is |
| Bookmark and playback-session storage (key by tenant and zone) | screen | 3 | with changes |
| ADVT windows, minimum gap, slideshow maths, shuffle | screen | 3 | as-is |
| ADVT scheduler tick (one server-side tick per zone, no writes on read) | screen | 3 | with changes |
| Scene precedence, scene resolver, readiness timers | screen | 3 | as-is |
| Snapshot orchestration and the state v2 shape (the shape seeds the screen contract) | screen | 2c, 3 | rewrite |
| Playlist builder, item and schedule validators, duration parsers | screen | 3 | as-is |
| Asset upload validation, image normalize, video length parser, PPTX slide count | screen | 3 | as-is |
| Asset catalog, replace and undo with slide clamps | screen | 3 | with changes |
| PPTX rendering (a render-job container, fair per-tenant queue) | screen | 3 | with changes |
| YouTube normalize, oEmbed health, player error rules | screen | 3 | as-is |
| Web-asset allowlist (per tenant) | screen | 3 | with changes |
| Baseline web page and display-page presets (become tenant settings; see [conflict C1](#conflicts-with-the-decision-records)) | screen | 3 | with changes |
| Ready check, pages message, scene transitions, progress bars, mirror (the embed message protocol goes, [DR1](#conflicts-with-the-decision-records)) | screen | 3 | with changes |
| Screen chrome and display settings (header, footer, cursor, bar opacity) | screen | 3 | with changes |
| Kiosk player (device token, no loopback trust) | screen | 3 | with changes |
| Screen page first render and snapshot serving | screen | 3 | rewrite |
| Device identity, liveness and health (do not exist today) | screen | 3 | rewrite |
| Directive model, bands, precedence and history (the Moments ranking) | moments | 4 | with changes |
| Control API for directives (becomes events and the Moments API; per-sender tokens dropped) | moments | 4 | with changes |
| Ticker store and appearance (Screen owns the ticker, [0018](../decisions/0018-ticker-manual.md); [DR2](#conflicts-with-the-decision-records)) | screen | 3 | with changes |
| Sound engine, categories, occasions, screen cues, catch-up hold, once-per-source | moments | 4 | as-is |
| Sound settings, sound log, catch-up store, sound uploads | moments | 4 | with changes |
| Sound board commands and kiosk presence (per device, on the server) | moments | 4 | rewrite |
| Cue-id migration | — | — | drop |
| Photo carousel and featured breaks **(new)** | screen (bot sends) | 3, 6 | with changes |
| Spotlight (a Moments takeover) **(new)** | moments | 4 | with changes |
| Pizza ticker and pizza cues (consume `pizza.order.*`; not the ticker lane, [DR3](#conflicts-with-the-decision-records)) | screen, moments | 5, 9 | with changes |
| Adapter: display state, tournament and health polls (become event consumers; normalizers and freshness rules are the spec) | screen | 9 | rewrite |
| Trigger settings for the bot and the display page **(new)** | bot, moments | 4, 6 | with changes |
| Admin pages (the pure view-models are kept) | admin, screen | 3 | rewrite |
| Admin auth: password, sessions, login links, rate limit | — | 1, 2b | drop |
| Diagnostics, readiness and health endpoints | screen | 3, 10 | with changes |
| Alert webhook and log events (logs tagged with the tenant; alerts as events) | kit, admin | 8 | rewrite |
| Runtime and SQLite layer, in-code migrations | — | — | drop |
| Supervisor, systemd, Tailscale scripts, Windows kiosk setup | — | — | drop |
| Backfill CLIs (image resize, video length) | — | — | drop |
| Cue-test page (kept as a test fixture) | moments | 4 | with changes |
| Stream directive kind (never built) | cast | Cast | drop |
| Design tokens and fonts (become the demo theme; OFL licence kept) | ui | 2b | with changes |
| Mockup pages, docs | — | — | drop |

### canccubot
| Feature | Target module | Step | Verdict |
|---|---|---|---|
| Runtime, config, cog loading, guild sync (a pool of clients, commands per guild from feature flags) | bot | 6 | rewrite |
| Admin check by role name (becomes role-to-rights sync by role id) | bot | 6 | rewrite |
| Intents (keep members and presences, drop message content) | bot | 6 | with changes |
| Presence snapshots | bot | 6 | with changes |
| Voice snapshots | bot | 6 | with changes |
| Game snapshots and play duration | bot | 6 | with changes |
| Steam cover fallback | bot | 6 | as-is |
| Hot-game banner: the bot publishes, Moments decides **(new)** | bot, moments | 6, 4; wired in 9 | with changes |
| Message counts and top chatters (with retention and deletion) | bot | 6 | with changes |
| Stats history aggregation (from Postgres; widgets in step 9) | bot, screen | 6, 9 | with changes |
| In-memory storage layer (the queries become Postgres; the layer goes) | bot | 6 | with changes |
| Polls, poll ticker, poll formatters and validators | — | — | drop |
| Screen announce, clear and reset commands (publish screen-override events) **(new)** | bot, moments | 6, 4 | rewrite |
| Signage state and auto-revert timers, the display-page URL builder | — | — | drop |
| Signage control client (becomes bus events) | bot | 6 | rewrite |
| Trigger settings fetch (becomes per-tenant settings) **(new)** | moments | 4 | rewrite |
| Manual ticker commands `/ticker set`, `stop`, `status` (publish to Screen) | bot, screen | 6, 3 | with changes |
| Scheduled ticker windows (into Screen's scheduler windows) | screen | 3 | with changes |
| RSS ticker | — | — | drop |
| Photo carousel menus (upload through the Screen API into tenant files) **(new)** | bot, screen | 6, 3 | with changes |
| Carousel photo naming | bot | 6 | as-is |
| Signage admin login link `/adminlink` | — | — | drop |
| `/platform status` (tenant view and superadmin view) **(new)** | admin | 8 | rewrite |
| Manager alerts and Acknowledge (alerts are events the bot consumes) | bot, admin | 8 | rewrite |
| Manager heartbeat watcher | — | 10 (watchdog) | drop |
| Bot health endpoint (kit health contract) | bot | 6 | rewrite |
| `/help` | — | — | drop |
| `/stream` stubs | — | — | drop |
| Pizza links (sign-in instead of registration tokens) | pizza | 5 | rewrite |
| Tournament read commands: register, schedule, my-registrations, leaderboard | tournament, bot | 7 (bot side 6) | with changes |
| Tournament admin commands: admin, add, remove, list, clear | tournament | 7 | with changes |
| Tournament reminders: T−60 post, close and start DMs, status changes | tournament, bot | 7, 6 | with changes |
| Tournament voice channels: create-once, dwell roster, cleanup, backstop, create-now | bot, tournament | 6, 7 | with changes |
| Tournament screen pin T−15 to T+10 (an event Moments consumes) | moments | 4; wired in 9 | rewrite |
| `TournamentMemoryStore` test double | — | — | drop |
| Mini-tourney watcher posts and finals summary (Games publishes, the bot posts) **(new)** | games, bot | Games, 6 | with changes |
| Finals cards (a Moments takeover driven by Games events) **(new)** | moments, games | 4, Games | rewrite |
| Roster nick backfill | — | — | drop |
| Signup-site API client (each call becomes a contract endpoint or a bus event) | — | — | drop |
| Validators and formatters (the surviving parts) | bot | 6 | as-is |
| Worker stub | — | — | drop |
| Deployment: LXC, systemd, scripts | — | — | drop |
| Live integration tests | — | — | drop |
| Activity log line (metrics and the status view replace it) | — | — | drop |

### The signup site
Registration and the site itself stay outside the platform ([0005](../decisions/0005-signup-site-stays-outside.md)); only pizza, tournament, the LAN display page and the bot ingest are ported or replaced.

| Feature | Target module | Step | Verdict |
|---|---|---|---|
| P1–P5 pizza order lifecycle and router (`tenant_id`, transactions, sign-in identity) | pizza | 5 | with changes |
| P2 validate, menu filter, summary, orderer view | pizza | 5 | as-is |
| P6 Discord posts (`pizza.order.*` events the bot posts) | pizza, bot | 5, 6 | with changes |
| P7 reminders and auto-release (scheduler in the pizza container) | pizza | 5 | with changes |
| P8–P9 pizza admin, pizzerias and menus (menus per tenant from the profile, [DR11](#conflicts-with-the-decision-records)) | pizza, admin | 5 | with changes |
| P10 daily record and CSV | pizza | 5 | as-is |
| P11–P12 pizza block and public status (Screen consumes events) | screen, moments | 5, 9 | with changes |
| P13 per-day redirect | — | — | drop |
| T1–T4 schedule, rules, leaderboard, player registration (registration inside the module) | tournament | 7 | with changes |
| T5–T6 session admin and registrants (logic ported, the page rewritten) | tournament | 7 | rewrite |
| T7 scoring, roster autofill, score merge | tournament | 7 | with changes |
| T8 final and final photos | tournament | 7 | with changes |
| T9 debug flags | — | — | drop |
| T10 screen payload (tournament events and a Screen widget) | tournament, screen | 7, 9 | with changes |
| T11 bot flag handshake and tokens (voice handshake through events) | tournament, bot | 7, 6 | rewrite |
| T12 cover lookup (Steam with a real cache, IGDB optional) | bot | 6 | with changes |
| D1–D4 LAN display page and views (Screen views, last) | screen | 9 | rewrite |
| D3 alive chrome, D6 demo overlays, trend helpers | screen | 9 | as-is |
| D5 `postMessage` cues (the cue rules become Moments policy) | moments | 4 | rewrite |
| D7 polls | — | — | drop |
| D8 presence, voice and game snapshots | bot | 6 | with changes |
| D9–D10 stats fold and snapshot retention (SQL aggregates, a scheduled retention job) | bot | 6 | rewrite |
| D11 announce and finals cards (Moments takeovers) | moments, games | 4, Games | with changes |
| D12 browser trend state | — | — | drop |
| D13 polls RSS | — | — | drop |
| D14 manager heartbeat (its alert-once and recover-once rule is reused) | admin | 8, 10 | drop |
| D15 health (the kit health contract exists) | kit | 1 (done) | rewrite |
| D16 LAN reset (a per-tenant admin action) | admin | 8 | with changes |
| R1–R6 registration, home page, terminal, music, Snake, site admin, e-mail | — (stays on the site) | — | drop |
| Admin password and admin cookie | — | 2b | drop |

### canccumanager
| Feature | Target module | Step | Verdict |
|---|---|---|---|
| F2 debounce state machine | admin | 8 | as-is |
| Log redaction (into the kit, for every module's log view) | kit | 8 | as-is |
| F1 health polling and parse (every module's `/api/<module>/health`) | admin | 8 | with changes |
| F3 state-change events (a bus event; history in Postgres) | admin | 8 | with changes |
| F7, F9 alerts and reminders (published as events the bot consumes) | admin, bot | 8, 6 | with changes |
| F8 webhook fallback | admin | 8 | with changes |
| F6 event history and ack, F10 mute (actor from sign-in) | admin | 8 | with changes |
| F14 auto-restart policy | admin | 8 | with changes |
| F12, F13 action catalog and action log (the executor is designed first) | admin | 8 | rewrite |
| F11 log sources | admin, kit | 8 | rewrite |
| DB layer | admin | 8 | rewrite |
| F4 status page (the admin health view) | admin | 1, 8 | rewrite |
| F5, F16 status and heartbeat API | admin | 8 | with changes |
| Kiosk display restart and the `screen-poll` trigger (a device command) | screen, admin | 3, 8 | rewrite |
| Live-cast guard | admin | 8, Cast | with changes |
| F15 heartbeat push to the signup site | — | 10 (watchdog) | drop |
| Hosted worker log source | — | — | drop |
| Cast relay subsystem entry and its seeded mute | — | — | drop |
| Bearer tokens and `X-Caller` | — | — | drop |
| F17 tailnet-only bind | — | — | drop |
| F18 systemd unit, deploy notes, CI | — | — | drop |

### thefinals_mini_tourney
Everything here waits for its author's OK; licence and attribution are kept (AGENTS.md, Porting).

| Feature | Target module | Step | Verdict |
|---|---|---|---|
| Bracket engine: formats, draws, next round, result validation, champion | games | Games | as-is |
| Team builder (A14 balancing) | games | Games | as-is |
| A16 rankings and P10 ranking-change marks (keyed by user id; tables as data) | games | Games | with changes |
| Service rules: P4–P5 registration, P6 and A5 early start and votes, P8 and A9 lobby id, A3–A4 format and arena changes, A6 individual registrations, A7 live swap, A10–A11 cancel and delete | games | Games | with changes |
| P7 and A8 result reporting by two matching team reports, admin override | games | Games | with changes |
| Result correction (missing today) | games | Games | rewrite |
| P9 public start (a per-tenant setting, no calendar windows) | games, admin | Games | with changes |
| A12 debug fill and votes (demo seed and tests only) | games | Games | with changes |
| Arena list (data in the games list) | games | Games | with changes |
| A13 player roster, A15 add to registration (on global users) | games | Games | with changes |
| A17 settings (per-tenant module settings) | games, admin | Games | rewrite |
| A2 create a season | games | Games | with changes |
| Storage (SQLite, in-code upgrades) | games, kit | Games | rewrite |
| HTTP API (a tenant-aware contract first) | games | Games | rewrite |
| SSE `update` (bus events) | games | Games, 9 | rewrite |
| A1 admin password | — | 2b | drop |
| Team and individual tokens | — | — | drop |
| A18 health endpoint | kit | 1 (done) | drop |
| P1–P3, P12–P13 public pages: season list, bracket, hover tracing, toasts, dialogs | games, ui | Games | rewrite |
| Admin, team builder and settings pages | games, admin | Games, 8 | rewrite |
| P11 champions page and trophy ranking | games | Games | with changes |
| Bracket on the big screen and finals cards | screen, moments | 9 | with changes |
| README systemd example, agent tool config | — | — | drop |

### canccuplatform
| Feature | Target module | Step | Verdict |
|---|---|---|---|
| O1–O4 status, logs, restart and deploy scripts | — | — | drop |
| O5 deploy guard | — | — | drop |
| O6 Node check | — | — | drop |
| O7 bot version and health binding | — | — | drop |
| O8 kiosk reload (a per-device action) | screen, admin | 3, 8 | rewrite |
| O9 manager deploy and sudoers check | — | — | drop |
| O10 SSH timeout and step naming (the named-step idea is kept for `setup/`) | setup | 1 | drop |
| O11 tourney unit, venue runbook | — | — | drop |
| O12 CI checks (link check and shellcheck kept) | ci | 1 | with changes |
| O13 workflow rules (already in AGENTS.md) | — | 1 (done) | drop |
| O14 upstream rules for the tourney repo | — | — | drop |
| O15 system map (the roadmap and `contracts/` replace it) | — | 1 (done) | rewrite |
| X1 health shape | kit | 1 (done) | with changes |
| X2 admin login link | — | 2b | drop |
| X3 screen control, band ranking, ticker | moments, screen | 2c, 3, 4 | rewrite |
| X4 trigger settings | moments, bot | 4, 6 | with changes |
| X5 hot-game banner | bot, moments | 6, 9 | with changes |
| X6 photo carousel and spotlight | bot, screen | 6, 3 | with changes |
| X7 finals cards | games, moments | Games, 9 | with changes |
| X8 LAN display page | screen | 9 | rewrite |
| X9 `postMessage` protocol | — | — | drop |
| X10 catch-up cues (Moments policy) | moments | 4 | rewrite |
| X11 pizza ordering | pizza | 5 | with changes |
| X12 pizza ticker and cues | screen, moments | 5, 9 | with changes |
| X13 tournament routes | tournament | 7 | with changes |
| X14 polls | — | — | drop |
| X14 stats snapshots | bot | 6 | with changes |
| X15 tourney read API and SSE | games | Games | rewrite |
| X16 manager | admin | 8 | with changes |
| X17 heartbeat to the signup site | — | 10 (watchdog) | drop |
| X18 low-latency casting | cast | Cast | with changes |
| X19 tourney on a venue LAN hostname | — | — | drop |

The legacy contracts in this repo (health, admin login link, signage control API, LAN display views, screen messages, site API, tourney API, manager API, manager heartbeat) are not imported ([0002](../decisions/0002-no-legacy-history-or-docs.md)); they are read as the spec when the event catalog (#34), the screen contract (#35) and each module's contract are written.

### canccudocs
This repo holds plans, not code. Its "X" features are the same features as in the repos that implement them; the verdicts agree with those rows.

| Feature | Target module | Step | Verdict |
|---|---|---|---|
| O1–O3 plan index, editor workspace, sync loop | — | — | drop |
| O4 plan structure rule (questions with stated defaults) | — | any (process) | with changes |
| O5 feature-branch rule (already in AGENTS.md) | — | done | drop |
| O6 to-do tagging | — | — | drop |
| O7 docs-with-behaviour rule ([gap 16](#gaps-from-the-legacy-plans)) | — | any (process) | with changes |
| O8 contract map | all | 2c | rewrite |
| O9 outside-bot workflow | — | — | drop |
| X1 scheduled signage | screen | 3 | as-is |
| X2 PPTX rendering | screen | 3 | with changes |
| X3 compositor and precedence | moments, screen | 2c, 4 | rewrite |
| X4 no-blank fallback and Ready check | screen | 3 | with changes |
| X5 bookmarks and ADVT breaks | screen | 3 | as-is |
| X6 ticker (manual only) | screen | 3 | with changes |
| X7 announce | moments, bot, ui | 4, 6 | with changes |
| X8 polls on screen | — | — | drop |
| X9 hot-game banner | bot, moments | 6, 9 | with changes |
| X10 cover art chain | bot | 6 | with changes |
| X11 stats view | bot, screen | 6, 9 | with changes |
| X12 tournament view and pin | tournament, moments | 7, 9 | with changes |
| X13 tournament automation | tournament, bot | 7 | with changes |
| X14 photo carousel | bot, screen | 6, 3 | with changes |
| X15 photo spotlight | bot, moments | 6, 4 | with changes |
| X16 sound system and sound board | moments, admin | 4 | with changes |
| X17 tournament sound moments | tournament, moments | 7, 9 | rewrite |
| X18 admin sign-in (the link goes; session rules are kept) | admin | 2b | rewrite |
| X19 health and diagnostics | kit, admin | 1, 8 | with changes |
| X20 supervisor and kiosk launcher | — | — | drop |
| X21 backup and restore | setup | 2b, 10 | with changes |
| X22 PiSignage cutover | — | — | drop |
| X23 emergency takeover | moments, admin | 4 | with changes |
| X24 admin live screen (a silent mirror per zone) | screen, admin | 3 | with changes |
| X25 directive history, broken-video detection, console look | moments, screen, ui | 3, 4, 10 | with changes |
| X26 site admin reset | — | — | drop |
| X27 RSS feeds | — | — | drop |
| X28 stream service takeover | — | — | drop |
| X29 low-latency casting | cast | Cast | with changes |
| X30 manager | admin, bot | 8 | with changes |
| Cutover thresholds and burn-in ([gaps 13–14](#gaps-from-the-legacy-plans)) | — | 11 | rewrite |

### canccustream
Decommissioned before this inventory; nothing ports as code. The Cast track inherits ideas only.

| Feature | Target module | Step | Verdict |
|---|---|---|---|
| U1 RTMP ingest | — | — | drop |
| U2 automatic multi-view layout, U4 slot placeholders | — | — | drop |
| U3 waiting slate (Screen shows its normal content) | — | — | drop |
| U5 stream-name overlay (idea kept: name the caster from sign-in) | cast, moments | Cast | drop |
| U6 spotlight, U7 cycle mode, O6 modes | — | — | drop |
| U8 silent audio track, O5 encode presets (findings kept for the uplink measurement) | cast | Cast | drop |
| U9 watching or restreaming the composite | — | — | drop |
| O1 stream discovery, O2 offline grace (the grace rule is kept for Cast's stall guard) | cast | Cast | drop |
| O3 self-healing workers, O4 mixer start guard | — | — | drop |
| O7 status print, O11 state files and event log | — | — | drop |
| O8 control API (Cast's own contract with kit auth) | cast | Cast | rewrite |
| O9 publish info (becomes the cast page) | cast, bot | Cast, 6 | rewrite |
| O10 webhooks `stream_active` and `stream_idle` (become cast events) | cast | Cast | rewrite |
| O12 terminal dashboard | — | — | drop |
| O13–O15 bring-up, restart and publish-IP scripts, O17 units | — | — | drop |
| O16 synthetic test publishers (idea kept: a WHIP test sender) | cast, ci | Cast | drop |
| O18 nginx tuning | — | — | drop |
| O19 docs | — | — | drop |
| Tests (the fake-upstream shape is kept) | cast | Cast | drop |
| The bot's `/stream` consumer | bot | 6, Cast | rewrite |
| The manager's stream subsystem | — | — | drop |

## Cross-repo flows
How the legacy pieces worked together, end to end, and what replaces each hop. Legacy: no bus anywhere; everything is HTTP push or polling with shared bearer tokens over the tailnet. Platform: modules talk through their API and the bus, every message carries `tenant`, and nothing polls. Event names are the event catalog's to decide (#34); the names below only say what kind of event it is.

### Flow 1. A pizza order, from Discord to the screen
**Legacy**
1. An attendee runs `/pizza order` in Discord. The bot asks the signup site for a per-user registration token (`/api/tournament/internal/token`) and replies with a page link carrying `?token=`.
2. On the site the attendee opens or joins the one open group order (`/api/pizza/*`); the holder claims, closes, calls and marks it placed.
3. The site posts each state change and each reminder (cron every 5 min: +30 and +60 min, auto-release after 2 h) to a Discord webhook.
4. The signage worker polls the site's public `GET /api/pizza/status` every 15 s and turns a state change into the fallback ticker line and a one-time pizza sound cue (`pizzaCue`) in the screen state.
5. The kiosk polls the screen state every second, shows the ticker and plays the cue. Separately, the embedded LAN display page polls the same status every 10 s for its pizza block.

**Platform**
1. `/pizza order` (bot, step 6) links to the pizza page on the tenant's hostname; the attendee is identified by the central sign-in, not a token.
2. The pizza module (step 5) runs the order with transactions and its own reminder scheduler, and publishes `pizza.order.*` events.
3. The bot consumes them and posts to the tenant's pizza channel (the webhook goes).
4. Moments ranks the order's moment and its sound cue; Screen shows a pizza widget (step 9, see [order change OC2](#changes-of-order-flagged)). Nothing polls.

### Flow 2. A tournament session, from schedule to leaderboard
**Legacy**
1. An admin adds a session with `/tournament add` (the bot posts to the site) or on the site's admin page, reached by a bot-issued admin token.
2. The bot polls the site's session list every 5 s while work is pending, else every 60 s, and plans one-shot tasks per session: a public post at T−60, closing registration (status and DMs), start (status and DMs), voice channels at T−15, a cleanup backstop at T+3 h.
3. Players register on the site with a bot-issued token (`/tournament register`).
4. At T−15 the bot creates the voice channels, writes their ids back (`PATCH …/vc`, create-once), and pins the tournament leaderboard on the screen from T−15 to T+10 (a directive whose target is the site's LAN display page, `view=tournament_leaderboard`).
5. The embedded page posts `tournament.pre`, `tournament.start` and `tournament.post` sound cues to the screen; the screen plays a missed pre-start cue late (catch-up).
6. The admin presses "Start scoring": the site sets a flag; the bot sees it on its next poll, measures voice-channel dwell and posts a roster; the site autofills placements and points; the leaderboard updates.
7. Cleanup: the admin's end sets `cleanup_requested`; the bot deletes the channels and acks with `PATCH …/cleanup`.
8. Separately, the signage worker polls the site's tournament events and leaderboard (effectively every 180 s) for its own state.

**Platform**
1. The tournament module (step 7) owns sessions, registration (signed-in users), scoring, the leaderboard and the final, with row locks on writes. Admins work on its pages; the bot's admin commands call its API with backend rights.
2. The module's scheduler publishes session events (registration closing, starting, voice channels due, scoring requested, cleanup requested).
3. The bot (step 6) consumes them: it sends DMs and posts, creates and deletes voice channels, measures dwell, and publishes "voice channels created", "roster posted" and "cleaned up" events that the tournament module consumes. This is the voice handshake through events. The legacy rules stay as its spec: create once; disconnect, then delete, then ack.
4. Moments (step 4) turns the session events into the pinned leaderboard takeover and the three tournament sound moments, once per session; Screen shows the leaderboard widget (step 9).

### Flow 3. A screen announcement from Discord
**Legacy:** `/signage-announce` makes the bot store the card on the site (`POST /api/display/announce`). It also posts a `web` directive to signage (`POST /api/control/override`, label `announce`), whose target is the site's LAN display page with `view=announce&sfx=…`. Signage ranks it (announce band 80; over a stream it becomes an overlay) and the kiosk embeds the page. The page sends `canccu:screen-ready`, and the kiosk plays the sting. The bot's own timer reverts it after N seconds; `/signage-clear` deletes it.
**Platform:** the bot publishes a screen-override request with its text, sound and TTL (step 6). Moments (step 4) ranks it, owns the TTL and the revert, and picks the sound within the budget. Screen renders the announce card from the theme. No page is embedded and no message crosses frames ([0010](../decisions/0010-scope.md)).

### Flow 4. The hot-game banner
**Legacy:** every 30 s the bot counts the members who play the same game. It reads its threshold and banner times from signage (`GET /api/control/triggers`). On a new episode it posts a `hot_game` directive whose target is the site page's `game_banner` view. That page draws the games from the snapshots the bot pushed to the site. Signage refuses a lower card with 409 and a 30 s retry; the bot keeps a per-game cooldown.
**Platform:** the bot publishes game snapshots and "hot game started" and "ended" events (step 6). Its threshold is a bot setting; the banner time and cooldown are Moments settings. Moments decides the takeover. Screen draws the banner from the bot's events, using covers from the shared cover cache (step 9).

### Flow 5. Discord stats on the screen
**Legacy:** the bot pushes presence (60 s), voice (30 s) and game (30 s) snapshots to the site, plus a stats-history request every 300 s. The site folds them into one JSON blob and deletes raw rows after 15 minutes. The LAN display page's default stats view polls the display state every 30 s. Signage embeds that page as its baseline whenever nothing is scheduled.
**Platform:** the bot keeps raw samples (for example 96 h) and aggregates in its own tables per tenant, and publishes snapshot events (step 6). Screen's stats widgets read the bot's API or consume its events; the aggregates are computed ahead, never on a polled read path ([gap 15](#gaps-from-the-legacy-plans)). This is step 9, last.

### Flow 6. Photo carousel and spotlight
**Legacy:** an admin uses a message context menu in Discord. The bot uploads the images to signage (`POST /api/carousel/photos`, a carousel-only token) with the channel, author and time. Signage puts them first in the next ADVT slideshow break with a ring and a caption. "Show now" and "showcase" pin one photo full screen (`POST /api/carousel/spotlight`); signage refuses it with 409 while a directive is up.
**Platform:** the bot (step 6) sends the files through the Screen API into the tenant's files volume. Screen (step 3) keeps the carousel playlist and the new-first and featured rules. The spotlight is a Moments takeover with a TTL (step 4).

### Flow 7. Mini-tourney seasons and finals cards
**Legacy:** the bot listens to the mini-tourney's SSE stream (no auth) with a 60 s backstop poll. It posts "new season", "season started" and "champion" to the finals channel, and mirrors the open season to the site (`PUT /api/display/finals`). A second bot loop polls the site's display state every 30 s and posts `finals_open` or `finals_start` takeover cards to signage. Their target is the site page's finals views.
**Platform:** the games module (Games track) publishes season events. The bot posts them to the tenant's finals channel and keeps the "already announced" ids as rows. Moments turns them into finals takeovers; Screen shows the card and the bracket widget (step 9). The site detour goes.

### Flow 8. Platform alerts
**Legacy:** the manager polls five health endpoints every 30 s and debounces each change over two polls. On an incident it posts to the bot (`POST /alert`). The bot DMs the crew and posts in the admin channel with an Acknowledge button, which calls the manager's ack endpoint. A Discord webhook is the fallback when the bot is the subject or refuses. Reminders follow every 30 min. The manager also pushes a heartbeat to the site; a site cron alerts a webhook when it stops.
**Platform:** admin (step 8) polls the modules' health, debounces, and publishes alert events. The bot consumes them and posts to the audience: platform alerts to the superadmin's channel, tenant alerts to the tenant's (see [T-I](#t-i-platform-health-alerts-and-operations)). Acknowledge and mute go through the admin API with the signed-in actor. The webhook fallback stays for when the bot is down. The heartbeat becomes the outside watchdog of step 10.

### Flow 9. The ticker
**Legacy:** `/ticker set` posts a directive with label `ticker` to signage; `/ticker schedule add` keeps windows in the bot's memory, so they are lost on restart; signage's admin page sets the ticker too. A poll line and the pizza status fill the lane automatically. An RSS feed mirrors it.
**Platform:** Screen owns the ticker and its scheduled windows and keeps them in Postgres (step 3, [0018](../decisions/0018-ticker-manual.md)). The bot's `/ticker` and schedule commands publish to Screen (step 6). The poll line and RSS are dropped; the pizza line is [conflict C3](#conflicts-with-the-decision-records).

### Flow 10. Admin sign-in from Discord
**Legacy:** `/adminlink` signs a one-time, five-minute HMAC link with the member's role ids; signage redeems it at `/admin/link` into an admin session. The other apps each had their own password or token.
**Platform:** dropped. Every admin page signs in with Discord through the central sign-in host, with rights from role-to-rights sync (steps 1, 2b, 6).

### Flow 11. Casting
**Legacy:** the stream service sent `stream_active` and `stream_idle` webhooks to the bot, and the bot's `/stream` commands answered "not available"; the planned path to the screen (a `stream` directive) was never built. The newer plan was a MediaMTX relay on the venue LAN with a takeover by hooks.
**Platform:** the Cast track (open question: the relay across a remote VM, roadmap). Cast publishes cast started, stalled and ended events; Moments ranks the takeover; Screen plays it.

## Tenancy questions
All 90 tenancy questions of the per-repo inventories, grouped by theme, each with a proposed answer for the tenants contract (#48) and the module contracts. The "Asked in" column names each source question as `<repo>-<number>`, numbered as in the source file:

- `SG`: [canccusignage](canccusignage.md#tenancy-questions)
- `BT`: [canccubot](canccubot.md#tenancy-questions)
- `SU`: [the signup site](signup-site.md#tenancy-questions)
- `MG`: [canccumanager](canccumanager.md#tenancy-questions)
- `MT`: [thefinals_mini_tourney](thefinals_mini_tourney.md#tenancy-questions)
- `PL`: [canccuplatform](canccuplatform.md#tenancy-questions)
- `DC`: [canccudocs](canccudocs.md#tenancy-questions)
- `ST`: [canccustream](canccustream.md#tenancy-questions)

Rows are numbered by theme (`TA1` to `TJ5`). The common principle behind the answers: per tenant by default; global only for public, non-personal reference data and for the shared stack itself; nothing per organizer, because [0013](../decisions/0013-multi-tenant-core.md) has no organizer level.

### T-A. Time zone and locale
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TA1 | Is the time zone a venue property or a tenant setting? Today one setting drives schedules, ADVT windows, captions, pizza dates and the bot. | SG-1, BT-5, SU-12, PL-12, DC-12 | The venue has an IANA time zone. A tenant may override it, for an online event or one with no venue. Every module reads the tenant's effective zone from the tenants API. This adds a field to venues ([TC7](#conflicts-with-the-decision-records)). |
| TA2 | Language and number format? | SU-12, PL-12 | Tenant settings (language pack from step 10; CSV number format follows the language). |
| TA3 | Pizza orders are keyed by local date with a sequence per day: are `date` and `seq` per tenant, and whose zone defines "today"? | SU-5 | Both per tenant; "today" is the date in the tenant's effective zone (TA1). |

### T-B. Singletons and their scope
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TB1 | One open pizza order, one active poll, one final, one announce card, one finals season, one stats history, one carousel playlist, one spotlight, one emergency: do they become one per tenant? | SU-4, PL-5, DC-6 | Yes, all per tenant; none stays global. Polls are dropped. For screens see TB2. |
| TB2 | Which screen state is per zone and which per tenant? | SG-4, DC-6 | Per zone: playback session, bookmarks and ADVT state. Per tenant, each with an optional zone target: ticker, directives, carousel playlist, spotlight and emergency (default: all zones). This shapes the screen contract (#35). |
| TB3 | Who drives the tick (ADVT, expiry)? | SG-5 | One server-side scheduler per tenant and zone through the kit's tenant-keyed scheduler (0013 item 7). Reads, mirrors and admin views never change state. |
| TB4 | Tournament seasons: one per tenant, or several? | SU-6 | One season per tenant in the first port, but the tables carry a season id from the start, so more seasons later are an additive change. |
| TB5 | Mini-tourney: one open season per tenant, or per tenant and game? | MT-1 | One open season per tenant and game, so one event can run several games at once. |

### T-C. Settings that are hard-coded or app-wide today
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TC1 | Points table, close offset, rules text, reminder steps, auto-release, display thresholds, currency: per-tenant settings? | SU-9 | Yes. Each is a setting in its module's settings schema (0013 item 18), with defaults in `events/demo/`. |
| TC2 | Discord role ids, admin channel, pizza channel, trigger and sound settings, `catchUpEnabled`, thresholds and cadences? | PL-4 | Per tenant: role ids and channels are bot bindings ([#53](../roadmap.md#2b-tenancy-foundation)); the rest are module settings of Moments, the bot or Screen. |
| TC3 | Is per-instance state per tenant (schedules, playlists, directives, ticker, carousel, sound settings, Ready opt-in, fallback image), with the sound log and directive history as tenant rows with their own caps? | DC-5 | Yes. For the caps see T-H. |
| TC4 | Are the bot's admin role name, allowed role ids and event time zone bot settings per tenant? | DC-7 | Role ids per tenant (the role name goes, by-id sync); the time zone comes from TA1, not a bot setting. |
| TC5 | Hot-game, poll and finals trigger settings: venue attributes, or tenant settings with venue defaults? | BT-5 | Tenant settings. The player-count threshold is a bot setting; banner and card times are Moments settings. No venue defaults (polls are dropped). |
| TC6 | Mini-tourney settings (show ranking changes, debug tools, public start): per-tenant module settings? Debug tools a tenant setting? | MT-3 | Ranking changes and public start are per-tenant Games settings. Debug fill is not a tenant setting: it exists only as test fixtures and the demo seed. |
| TC7 | Public start: a per-tenant setting with no calendar logic? | MT-2 | Yes. The season name comes from the event; the month windows go. |
| TC8 | The embedded display page's origin and the web allowlist: tenant settings? Which origins does a screen trust? | SG-8, PL-8 | The web-asset allowlist is a per-tenant Screen setting. No origin is trusted for messages: the embed message protocol is dropped ([0010](../decisions/0010-scope.md), [TC1](#conflicts-with-the-decision-records)), and Screen's own widgets replace the embedded page. |
| TC9 | Auto-restart policies: global config, or per tenant for the tenant-scoped kinds (device restarts)? | MG-8 | Global config owned by the superadmin in step 8. A per-tenant device policy can come later as an additive setting. |

### T-D. Identity and rights
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TD1 | Rights by role name today: does role-to-rights sync map role ids per tenant? Does `/platform status` split into a tenant view and a superadmin view? | BT-3 | Yes to both: role ids per tenant mapped to `<module>.<right>` rights, checked in the backend. `/platform status` shows the tenant view to event admins and the stack view to the superadmin (T-I). |
| TD2 | With central sign-in, does any per-tenant identity remain (display name, rights per event)? | SU-7, PL-7 | Users are global (0013 item 30). Per tenant: membership, rights and an optional display name, which is additive later and not needed for the first ports. Registration tokens go. |
| TD3 | Does each tenant's bot connection get its own credential scoped to its data? | SU-3 | There is no shared ingest secret: the bot writes only its own tables and publishes events with `tenant`; other modules accept them through the bus, and service calls use kit service auth. A tenant's own bot token is a per-tenant encrypted secret (0013 items 14, 29). |
| TD4 | Is a team member a global user linked to the tenant? Can a player without Discord play? | MT-10 | Yes, a global user linked to the tenant. An admin can also enter a player by nickname only (no user), as the team builder does today; such a player cannot report results. |
| TD5 | Who may start, cancel or delete a season, or swap live players? | MT-11 | Event admins, plus anyone holding a tenant-granted `games` operator right. |
| TD6 | Who may cast, and who may end or take over a cast? | ST-3 | Any signed-in member of the tenant with the cast right (granted to members by default, so a tenant can restrict it). The caster or an event admin can end a cast; only an event admin can take one over. |
| TD7 | The name shown with a cast: moderation or a display-name override? | ST-5 | The user's display name from sign-in (TD2). No moderation in the first version; an admin can end the cast. |
| TD8 | Who may trigger an emergency takeover, and does it cover all zones? Is an emergency venue-wide? | SG-7, DC-8 | Per tenant, with a Moments emergency right that event admins hold. The superadmin can trigger one in any tenant, audited. It covers all of the tenant's zones by default. It is not venue-wide: one tenant's action never reaches another tenant's screens ([TC9](#conflicts-with-the-decision-records)). |
| TD9 | Break-glass admin access when Discord or the sign-in host is down: superadmin-only and global, or per tenant? | DC-2 | Superadmin only and global: a one-time code created from a shell on the VM gives a superadmin session, audited. Tenants get none. This needs a decision ([DR12](#conflicts-with-the-decision-records)). |

### T-E. Discord: guilds, intents, channels, the legacy bot
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TE1 | Can one Discord guild serve two tenants? | BT-1, SU-10 | Not at once: a guild is bound to one tenant at a time and re-bound for the next event. Every guild-level row still carries `tenant_id`, so allowing more later is additive. |
| TE2 | Is presence and game tracking a feature flag whose data is dropped when off? Is message content dropped for good? | BT-2 | Yes: the stats feature flag; on the shared bot, the data of tenants without it is dropped and never stored (0013 item 16). Keep the members and presences intents; drop the message-content intent for good (message counts need only message events). |
| TE3 | Channels and recipients per tenant (tournament, finals main and test, alert channel, alert DM users)? Are platform alerts global? | BT-4 | Channels and DM recipients are per-tenant bot bindings, held as ids. Platform alerts are global and go to the superadmin (T-I). |
| TE4 | Is the alert channel a platform setting (a superadmin guild), separate from tenant channels? Which alerts go where? | PL-2, DC-1 | Yes: platform alerts go to a platform channel through the shared bot (setting of the superadmin), tenant alerts to the tenant's alert channel through the tenant's bot connection. |
| TE5 | The heartbeat and its alert channel concern the stack: do platform alerts go only to a platform channel? | SU-2 | Yes, never to a tenant's channel. |
| TE6 | What does "the legacy bot data" mean for the migration: the site-side snapshots and tournament rows, or only the token and the bot's settings? | BT-8 | Only what the legacy bot holds: its token, its settings and its two small state files (for example the announced season ids). The site-side data stays behind ([0004](../decisions/0004-nothing-migrated.md), [0005](../decisions/0005-signup-site-stays-outside.md)). This narrows 0004 ([TC4](#conflicts-with-the-decision-records)). |
| TE7 | At the switch the legacy token moves into the tenant: is the legacy process stopped first? | BT-9 | Yes, always stopped first; two processes never share one token (0013 item 14, roadmap step 11). |
| TE8 | Do scheduled ticker windows count as manual? | BT-10 | Already answered by [0018](../decisions/0018-ticker-manual.md): yes, ported into Screen's scheduler windows. |

### T-F. Global data, caches and catalogs
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TF1 | The game cover cache (Steam lookups): a global table on the allow-list? Who may purge it? | SU-1, BT-6, DC-3 | Global and owned by the bot module: it is public game data with no tenant data. It goes on the allow-list; only the superadmin purges it. This is an exception to "caches keyed by tenant" ([TC8](#conflicts-with-the-decision-records)). |
| TF2 | Which bot data is global? | BT-6 | Global: the cover cache and the Discord user identity (0013 item 30). Per tenant: activity snapshots, message counts, tournament data. |
| TF3 | The arena list is game data: a global games catalog maintained by the superadmin? | MT-7 | Yes: a global games catalog (games and their arenas) owned by the games module, on the allow-list, maintained by the superadmin. Tenants choose from it. |
| TF4 | Rankings, the champions page and trophy counts: global per user and game, per tenant, or per organizer? | MT-5 | Per tenant. Global rankings would carry one tenant's results into shared rows, and per organizer needs an organizer entity 0013 does not have ([TC10](#conflicts-with-the-decision-records)). |
| TF5 | If rankings are global, who may edit them? | MT-6 | Rankings are per tenant (TF4), so the tenant's event admins edit them. |
| TF6 | On tenant deletion, what happens to its effect on rankings? | MT-8 | Rankings are per tenant (TF4), so they are deleted with the tenant. |
| TF7 | Asset library: per event, or also per organizer for reuse? | SG-3 | Per tenant. Reuse goes through the per-tenant export and import (0013 item 26) or the event repo. |
| TF8 | Sound files: global defaults that tenants override per cue? | DC-4 | Yes. The platform ships one default sound family in the image (read-only, licences recorded); tenants upload overrides per cue into their files. |
| TF9 | Fonts for PPTX rendering: per tenant or platform-wide? | SG-11 | Platform-wide for the first port: an OFL font set in the render image. Tenant theme fonts can be added to the render job later. |

### T-G. Venues and devices
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TG1 | Sound per device: is sound played on every device of a zone, one chosen device, or per zone setting? Where does the once-per-source memory live? | SG-6 | A per-zone setting names one audio device (default: the zone's first device). The once-per-source memory moves to Moments on the server, per tenant and zone. |
| TG2 | Master volume and category levels are set against one venue's PA: a device property kept across events, or per tenant? | DC-11 | Per tenant, on the tenant's device assignment. The global device row stays as 0013 item 34 defines it ([TC6](#conflicts-with-the-decision-records)). |
| TG3 | Display resolution: on the device row, and does a layout choose by it? | DC-13 | On the tenant's device assignment too (TG2). Layouts are 1080p-first ([gap 5](#gaps-from-the-legacy-plans)). |
| TG4 | Does the admin live screen (mirror) need only an admin session, not a device? | SG-10 | Yes: a silent mirror per zone for signed-in admins. It is not a device and never plays sound. |
| TG5 | The kiosk, its reload action, the instance id and the cue memory are per device: do they map to Screen's device rows? Who may reload? | PL-10 | Yes. Reload is a device command. The admin of the device's current tenant may reload it; the superadmin may always. |
| TG6 | Who may restart a device at a venue? | MG-5 | As TG5: the admin of the device's current tenant, or the superadmin. Changing the current tenant stays superadmin-only (0013 item 34). |
| TG7 | Kiosk liveness, the Ready fallback and the cast relay are per device or venue: does a venue-level setting remain, for example for casting? | DC-10 | Kiosk liveness is Screen's per-tenant device health. The Ready fallback becomes Screen's static fallback image per tenant. Casting: see TG9. |
| TG8 | Display state that lives in one browser today (trend arrows, `localStorage`, the cue gate): to device rows or server-side Moments state? | SU-13 | Server-side. Trend arrows are computed by the bot or Screen; the cue gate and cue memory move into Moments per tenant and zone. Nothing stays in a browser. |
| TG9 | Does any per-venue network setting survive besides the venue IP addresses? Is a per-venue relay device needed for Cast? | PL-11, ST-7 | None beyond the venue IP addresses (0013 item 33). Whether Cast needs a relay at the venue is the roadmap's open question. If it does, the relay is a global device row like Screen's, which needs a decision. |
| TG10 | Two events at one venue share its address. If casting is for "people at the venue", how are casts kept apart? | ST-8 | By sign-in on the tenant's hostname, not by IP. The venue IP is only a soft hint for the cast page (0013 item 11), the same for both events. |
| TG11 | The publish URL came from the host's LAN address: does a per-venue network setting survive? | ST-9 | No. The cast page lives on the tenant's hostname. |
| TG12 | Pizzerias, menus and toppings belong to the place: venue rows reused by each tenant, or copied into each tenant? | SU-11, PL-9 | Copied into each tenant, loaded from the event profile. [0003](../decisions/0003-event-content-scrubbed.md) puts pizzeria menus in the event repo, and global venue rows hold no module data ([TC11](#conflicts-with-the-decision-records)). |
| TG13 | A static game-server list with hosts and ports: a feature, or event-repo content? | SU-14 | Event-repo content only; not a platform feature. |
| TG14 | Is anything in the mini-tourney per venue? | MT-9 | No. Games needs no venue setting. |

### T-H. Retention, GDPR and history
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TH1 | Retention of personal data (Discord ids, names, comments, bills, message counts and nicks): per-tenant setting, platform rule, or the tenant's lifecycle? | BT-7, SU-8 | A platform rule with a per-tenant setting below a platform maximum. Raw presence, voice and game samples roll over 96 h. Aggregates and event data are kept for the tenant's life; after archiving they are read-only and deleted or pseudonymised after the tenant's retention period (default 12 months, to confirm). Deleting a tenant or user deletes it at once (0013 item 31). |
| TH2 | Retention of operational history (sound log, directive history, Ready log; legacy 7 days or 500 rows): per tenant for the life of the event, then archived with the tenant? | SG-12, DC-5 | Per tenant, kept while the tenant is live with a row cap, then archived with the tenant. |
| TH3 | Sound log 7 days, tokens 7 days, pizza records permanent for an outside bill system: per-tenant retention? Does the per-tenant export cover the pizza daily record? | PL-6 | Retention as TH1 and TH2 (tokens go). The per-tenant export includes the pizza daily record and its CSV. |
| TH4 | Retention numbers (sound log, directive history, logs 14 days, backups 7 daily and 4 weekly): platform-wide or per tenant within a maximum? | DC-9 | Logs and backups: platform-wide numbers (logs 14 days, backups 7 daily and 4 weekly, [gaps 11–12](#gaps-from-the-legacy-plans)). Histories: per tenant (TH2). |
| TH5 | Logs tagged with the tenant: may an event admin read their own tenant's lines? Are untagged lines superadmin-only? | MG-6 | Yes to both. Redaction patterns are global. |
| TH6 | `acked_by`, mute actor and action callers become user ids: under the audit-log pseudonymisation rule? Retention of health history? | MG-7 | Yes, the same pseudonymisation as the audit log (0013 item 31). Health history is global and kept 90 days. |

### T-I. Platform health, alerts and operations
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TI1 | Whose health is it? Is there a per-tenant status view, and what does it show? | MG-1, PL-1 | Module health is global and for the superadmin. The per-tenant status view (0013 item 28) shows the tenant's own facts (its bot connection, devices, cast, queues) and one coarse platform line (ok, degraded, down) with no internals. |
| TI2 | Should health endpoints carry per-tenant checks? | PL-3 | No. Health stays outside tenant resolution (0013 item 2) and global. |
| TI3 | Who receives alerts, through which bot connection and guild? | MG-2 | Global alerts go to the superadmin through the shared bot in the platform guild. Tenant-scoped alerts go to that tenant's admins through the tenant's bot connection. The webhook fallback is per audience. |
| TI4 | Mute and ack scope? | MG-3 | Tenant admins mute and ack their tenant-scoped alerts; the superadmin handles the global ones. |
| TI5 | Container restarts interrupt every tenant: superadmin-only, with a guard across all tenants? | MG-4 | Yes to both. The guard checks for a live cast or emergency in any tenant, like the deploy hold (0013 item 22). |
| TI6 | Does the outside watchdog expose per-tenant status to organizers? | MG-9 | No. The watchdog is the superadmin's; tenants see the coarse line of TI1. |
| TI7 | Is the cast relay one shared service, and can a tenant change encoder settings? | ST-1 | One shared service with sessions tagged by tenant. Encoder and relay settings are global; no tenant changes them. |
| TI8 | Relay health and restarts: superadmin only, or visible to admins of live tenants? | ST-2 | Health and restarts are superadmin-only (TI5). Live tenants see "casting available" or "unavailable" in their status view. |

### T-J. Screens, schedules and casting details
| # | Question | Asked in | Proposed answer |
|---|---|---|---|
| TJ1 | Schedules are weekly, not dated: keep weekly windows inside the tenant's live period, or add dated windows? | SG-2 | Port the weekly windows as-is, valid inside the tenant's live period. Dated windows and exceptions come later through their own issue ([gap 6](#gaps-from-the-legacy-plans)). |
| TJ2 | Is the carousel's Discord channel a per-tenant bot setting, with the carousel a Screen feature fed by bot events? | SG-9 | Yes to both. |
| TJ3 | The team-builder draft is one global table: per tenant, per admin, or transient? | MT-4 | One draft per tenant, stored in Postgres (containers keep no state, [0007](../decisions/0007-stateless-containers.md)). |
| TJ4 | Cast instructions: a tenant setting or part of the event profile? | ST-4 | The platform generates the cast page. A tenant can add a short note as a Cast setting, which the profile can carry. |
| TJ5 | A tenant has several screens: which one does a cast go to? | ST-6 | One zone, which the caster picks from the zones the tenant allows for casting (default: the main zone). Moments ranks the takeover there. |

## Conflicts with the decision records
Where an inventory's recommendation, or a proposed answer above, does not fit a decision record or the rules. They are listed for the product owner: each needs a "follow the record" or "change the record". A changed record goes through its own issue and a new record.

| # | Conflict | Record | Proposed resolution |
|---|---|---|---|
| DR1 | The canccusignage inventory ports the baseline web page, display-page presets, the Ready check and the pages message "with changes", with the embed origin as a tenant setting. 0010 drops the screen-embed message protocol, and the canccuplatform inventory drops it too (X9). | [0010](../decisions/0010-scope.md) | Follow 0010. Screen widgets replace the embedded page; plain web assets stay (an iframe with no messages). The "Ready or fallback image" rule is kept for Screen's own scenes. |
| DR2 | The canccusignage inventory puts the ticker lane in Moments (step 4). 0018 says Screen core owns the ticker and its scheduled windows (step 3). | [0018](../decisions/0018-ticker-manual.md) | Follow 0018. The feature map above already does. |
| DR3 | Signage fills the ticker lane from the pizza status, and from polls, when nobody has set a ticker. These are system-generated lines; 0010 and 0018 drop automatic ticker posts. | [0010](../decisions/0010-scope.md), [0018](../decisions/0018-ticker-manual.md) | The poll line goes with polls. The pizza status is a Screen widget and a Moments overlay fed by `pizza.order.*`, not the ticker lane. The product owner confirms, or allows it as an exception. |
| DR4 | 0004 migrates "the legacy bot's data". The bot holds almost nothing durable: the activity, poll and tournament data it produced live in the signup site's database, which 0004 and 0005 leave behind. | [0004](../decisions/0004-nothing-migrated.md) | Narrow it: migrate the bot's token, settings and state files only (TE6). If the site-side stats or tournament rows should come along, that is a new decision, and step 6 needs a copy of the site's database. |
| DR5 | AGENTS.md (Porting) and roadmap steps 0 and 7 say the tournament module waits for the mini-tourney author's OK. The tournament code comes from the signup site, whose git history shows no commit by that author. That author's ISC code is the mini-tourney, which goes to the Games track. | AGENTS.md, [0001](../decisions/0001-port-dont-rewrite.md), roadmap | Only the Games track waits for the OK; step 7 does not. AGENTS.md's wording changes in its own PR ([order change OC1](#changes-of-order-flagged)). |
| DR6 | Inventories ask for per-device properties: audio output, PA levels, resolution, reload. 0013 item 34 says the global device row holds only the name, the token hash, the venue id and the current tenant. | [0013](../decisions/0013-multi-tenant-core.md) item 34 | Follow 0013. These properties live on the tenant's device assignment (TG1–TG3, TG5); no change to the record is needed if this is confirmed. |
| DR7 | Several inventories make the time zone a venue property. 0013 item 33 gives a venue only a name and its addresses. | [0013](../decisions/0013-multi-tenant-core.md) item 33 | Change the record: a venue also has a time zone, which a tenant may override (TA1). |
| DR8 | The proposals add global tables: the game cover cache (TF1) and the games catalog (TF3). 0013 item 6 lists the global tables, and item 7 keys caches by tenant. | [0013](../decisions/0013-multi-tenant-core.md) items 6–7 | Add both to the allow-list; item 6 already allows this through a change to the list. The cover cache is a named exception to item 7: public data, no tenant data, superadmin purge. |
| DR9 | A venue-wide emergency (SG-7) would let one tenant's action reach another tenant's screens, against the isolation of 0013 items 5–8. | [0013](../decisions/0013-multi-tenant-core.md) items 5–8 | Follow 0013: an emergency is per tenant (TD8). The superadmin can raise one in each tenant at a venue. |
| DR10 | Reuse across an organizer's events (asset library, rankings, champions) needs an organizer level, which 0013 does not have. | [0013](../decisions/0013-multi-tenant-core.md) | Follow 0013: everything per tenant (TF4, TF7). An organizer level would be a new decision. |
| DR11 | The signup-site and canccuplatform inventories propose pizzerias and menus as venue rows. 0003 puts pizzeria menus in the event repo. | [0003](../decisions/0003-event-content-scrubbed.md) | Follow 0003: per tenant, loaded from the event profile (TG12). |
| DR12 | Break-glass admin access (gap 1, TD9) is a way into admin without the central sign-in. 0013 item 11 says admin always needs sign-in. | [0013](../decisions/0013-multi-tenant-core.md) items 10–11 | Decide: either no break-glass (recovery only through the VM shell), or the superadmin-only one-time code of TD9 as a named exception. |
| DR13 | The mini-tourney inventory keeps "debug fill and votes". 0010 drops "the debug UI". | [0010](../decisions/0010-scope.md) | No UI: debug fill is kept only as test fixtures and the demo seed (TC6). |

Known and already open in the roadmap, not repeated as conflicts: casting across a remote VM ([0011](../decisions/0011-hosting-on-remote-vm.md), Cast track) and deploys while tenants are live (0013 item 22).

## Gaps from the legacy plans
The canccudocs inventory lists 17 legacy requirements that neither the roadmap nor a decision covers ([its list](canccudocs.md#gaps-not-covered-by-the-roadmap-or-the-decision-records)). Proposed handling, for the product owner to keep, reword or drop:

| # | Requirement | Proposed handling |
|---|---|---|
| 1 | Break-glass admin access | Decide with [DR12](#conflicts-with-the-decision-records); it belongs to the central sign-in host (#52) |
| 2 | Admin session lifetimes (legacy: idle 60 min, absolute 12 h) | Keep: an acceptance criterion of #52 |
| 3 | CSRF protection for admin writes | Keep: an acceptance criterion of #52 and the kit |
| 4 | A screen never shows an empty frame; a static fallback image last | Keep: a step 3 exit criterion |
| 5 | Screen resolution policy (1080p first) | Keep 1080p first in the screen contract (#35) |
| 6 | Richer schedule rules (exceptions, dwell, dated windows) | Later, through a new issue after step 3 (TJ1) |
| 7 | Admin preview tools (simulate at a time, preview, duplicate) | Port simulate-at-time with the schedule view-models in step 3; the rest later |
| 8 | Who may trigger an emergency | Answered by TD8; goes into the Moments contract (step 4) |
| 9 | Sound board (Mute all, levels, sound check, uploads, log) | Keep: Moments (step 4) with its admin pages |
| 10 | Ducking of cast and video audio | Later, after Moments and Cast |
| 11 | Log retention (legacy at least 14 days) and minimum signals | Keep: 14 days (TH4); the signal list with step 8 |
| 12 | Backup retention and restore checks | Keep: 7 daily and 4 weekly, integrity check and safety copy, in #55 and step 10 |
| 13 | Rollback triggers and a recovery-time target for the switch | Keep: step 11 |
| 14 | Burn-in length, failure scenarios, evidence | Keep: the dress rehearsal of step 11 |
| 15 | No heavy aggregation on polled read paths | Keep: a rule in the bot and Screen contracts (flow 5) |
| 16 | Docs change with behaviour in the same PR | Process: propose a line in AGENTS.md in its own PR |
| 17 | Live integration-test safety | Process: a rule for CI tests that touch Discord (step 6) |

## Changes to the porting plan and order
The [porting plan](../roadmap.md#porting-plan) in the roadmap is updated to match this summary: rows for every legacy repo and the new features marked **(new)** above.

### Changes of order (flagged)
Each is a proposal for the product owner. The step texts of the roadmap change only once it is confirmed.

- **OC1. Tournament no longer waits for the mini-tourney author's OK** ([DR5](#conflicts-with-the-decision-records)). Step 7 ports the signup site's tournament code, which that author did not write. Only the Games track waits. The roadmap's step 0 "postponed" item and step 7, and AGENTS.md (Porting), change with it.
- **OC2. Pizza on the screen.** Step 5's exit criterion is "an order runs end to end and shows on the screen", but Screen consumes pizza events only in step 9. Either Screen's pizza widget becomes a child of the pizza epic (#59), or the screen part of the exit criterion moves to step 9. Proposed: move it to step 9, and let step 5's exit be "an order runs end to end and the bot posts it".
- **OC3. Ticker in step 3, not 4.** It follows [0018](../decisions/0018-ticker-manual.md) and is already in the step 3 text; only the canccusignage inventory said step 4 (DR2).
- **OC4. The bot's alert relay and `/platform status` land in step 8,** with admin operations, not in step 6. Step 6 needs only the bot's side of the event contract.
- **OC5. New work in existing steps** (no change of order, but new children):
  - the photo carousel in Screen (step 3), with its bot menus in step 6;
  - the spotlight and the hot-game banner in Moments (step 4), fed by the bot in step 6 and wired in step 9;
  - trigger settings in the Moments and bot settings schemas (steps 4 and 6);
  - device reload and restart as Screen device commands (step 3), with the restart policy in step 8;
  - log redaction in the kit (step 8 or earlier);
  - the mini-tourney watcher and finals cards after Moments and the bot, once the Games track publishes season events.
- **OC6. Legacy bot data migration scope.** If the product owner widens it beyond the bot's own state (DR4), step 6 also needs a copy of the signup site's database.
- **OC7. Tenancy answers before #48.** The answers above (T-A to T-J) are inputs to the tenants contract (#48), which is blocked by this summary. TA1 (venue time zone) and DR8 (allow-list) change what #48 contains.
