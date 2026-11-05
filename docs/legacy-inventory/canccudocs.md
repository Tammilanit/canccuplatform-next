# Legacy inventory: canccudocs

The retired planning and docs repo of the legacy signage work, read in full so the product owner can confirm what exists before the tenancy foundation ([#47](../roadmap.md#2b-tenancy-foundation)) and the contracts ([#36](../roadmap.md#2c-event-catalog-and-screen-contract)) are designed. Roadmap step 2a, issue #74. Other legacy repos are out of scope here; each has its own inventory (#68 canccuplatform, #69 canccubot, #70 canccumanager, #71 canccusignage, #72 the signup site, #73 thefinals_mini_tourney, #75 canccustream), and the summary (#76) joins them.

Nothing here is copied from the legacy repo: it is described. Short identifiers (route paths, table and column names, env var names, cue ids, file names) are kept so the port can find them. Event-specific values are named by kind and counted only (see [Event-specific content](#event-specific-content)). People are named by role, and the event's own signup and LAN-display website is "the signup site", as in the roadmap.

## In short

- **What it is.** A docs-only repo: 18 numbered plans, a master plan with 7 subplans for the spring 2026 event, a cross-repo API map, a capabilities guide, one design, two implementation plans, one spec, an editor workspace and three editor rules. It holds no code, no config for any service, no migrations, no scripts and no tests. Its later role (the cross-repo plans for casting and the manager) moved into the legacy `canccuplatform` repo, which carries newer copies of two of its plans.
- **What it describes.** Three running systems and their links: the signage server on a venue laptop (WSL2 with a Windows kiosk), the Discord bot on a home server, and the signup site on a hosted serverless platform; plus the retired PiSignage, the never-finished stream service and the planned manager and cast relay. The links are bearer-token HTTP, a tailnet, and a browser `postMessage` protocol between the embedded LAN-display page and `/screen`.
- **Why it matters now.** It records many plans, decisions and requirements that exist in no code: scope tiers, the no-blank-screen rule, auth and session rules, storage and backup policy, observability and retention, cutover and rollback thresholds, the sound system, casting and the manager. [Plans, decisions and requirements](#plans-decisions-and-requirements) lists each one and says whether the roadmap or a decision record already covers it; [Gaps](#gaps-not-covered-by-the-roadmap-or-the-decision-records) lists the 17 that are not covered.
- **Size.** 40 tracked files, 7050 lines; 83 commits (32 of them merges) from 2026-03-31 to 2026-10-13, by two authors (the legacy repo owner and the signup site's maintainer). Read at commit `57fffcfb5e` (`main`, 2026-10-13).
- **Port verdict.** Nothing ports as code, since there is none. The docs are not imported ([0002](../decisions/0002-no-legacy-history-or-docs.md)); their requirements feed the module contracts and the roadmap steps named in [Port recommendation](#port-recommendation).

## Coverage

Every tracked file was read in full; nothing was skipped. "Lines" is `wc -l`. The commit history was read too (all 83 subjects); no file was ever deleted or renamed, and there are no untracked files.

| Directory | Files | Lines | Files read |
|---|---|---|---|
| `/` (root) | 34 | 6310 | `.gitignore`, `AGENTS.md`, `README.md`, `WORKSPACE.md`, `canccusignage.code-workspace`, `CROSS_REPO_STRATEGY_AND_API_MAP.md`, `TRINITY_CAPABILITIES_AND_CONNECTIVITY.md`, `DESIGN_2026-07-23_DISPLAY_STATE_WORKER_1102_RELIEF.md`, `PLAN_01_COMPATIBILITY_MATRIX_AND_BOT_TRAFFIC_MODEL.md`, `PLAN_02_ADAPTER_CONTRACT_AND_SELECTIVE_INGESTION_MAPPING.md`, `PLAN_03_FEATURE_CATALOG_AND_PRIORITY_MATRIX.md`, `PLAN_04_DOCUMENTATION_GOVERNANCE_AND_ENFORCED_COMPLETION_RULE.md`, `PLAN_05_PLATFORM_BLUEPRINT_AND_RUNTIME_TOPOLOGY.md`, `PLAN_06_SQLITE_STORAGE_POLICY_AND_ADMIN_STATE_API_CONTRACT.md`, `PLAN_07_AUTH_AND_DISCORD_LOGIN_LINK_INTEGRATION.md`, `PLAN_08_CANCCUBOT_NEW_SIGNAGE_COMPATIBILITY_AND_CONFIG_STRATEGY.md`, `PLAN_09_NORMAL_SIGNAGE_MVP_1080P_SLIDE_CYCLE_SCHEDULER_AND_CONFIG.md`, `PLAN_10_SCENE_ENGINE_BIGSCREEN_RENDERER_AND_FALLBACK_PATH.md`, `PLAN_11_OBSERVABILITY_BASELINE_AND_RUNBOOK_PACKAGE.md`, `PLAN_12_DIRECT_CUTOVER_CHECKLIST_AND_ROLLBACK_ASSET_VALIDATION.md`, `PLAN_13_DEFERRED_WEBRTC_SFU_DESIGN_PACKAGE.md`, `PLAN_14_ANNOUNCE_CRT_AND_SFX_VOICE_PACK.md`, `PLAN_15_LOW_LATENCY_CASTING.md`, `PLAN_16_PHOTO_CAROUSEL.md`, `PLAN_17_CANCCUMANAGER_REBUILD.md`, `PLAN_18_SCREEN_SOUND_SYSTEM.md`, `PLAN_MASTER_2026_EVENT_ALL_IN_SIGNAGE.md`, `SUBPLAN_EVENT2026_01_ADAPTER_AND_DATA_PATH.md`, `SUBPLAN_EVENT2026_02_WORKER_AND_PROCESS_SPLIT.md`, `SUBPLAN_EVENT2026_03_ADMIN_AUTH_AND_SESSION.md`, `SUBPLAN_EVENT2026_04_SCREEN_AND_ADMIN_UX.md`, `SUBPLAN_EVENT2026_05_SUPERVISOR_PRODUCTION_HARDENING.md`, `SUBPLAN_EVENT2026_06_EVENT_BURN_IN_AND_REHEARSAL.md`, `SUBPLAN_EVENT2026_07_CROSSREPO_LAN_DISPLAY_AND_BOT_MIGRATION.md` |
| `.cursor/rules/` | 3 | 69 | `.cursor/rules/git-feature-branch-workflow.mdc`, `.cursor/rules/plan-questions-required.mdc`, `.cursor/rules/plan-todo-prefix.mdc` |
| `docs/superpowers/plans/` | 2 | 546 | `docs/superpowers/plans/2026-07-23-display-state-worker-1102-relief.md`, `docs/superpowers/plans/2026-10-01-steam-cover-fallback.md` |
| `docs/superpowers/specs/` | 1 | 125 | `docs/superpowers/specs/2026-10-01-steam-cover-fallback-design.md` |
| **Total** | **40** | **7050** | |

By kind: source 0; config 5 (`.gitignore`, the editor workspace file, three editor rule files); migrations 0; scripts 0; tests 0; docs 35. The implementation plans quote code sketches for other repos (TypeScript, Python, SQL, PowerShell, YAML); they are described below, not counted as source. The year label in seven file names is counted under [Event-specific content](#event-specific-content); paths are kept as they are because the coverage table must name them.

## Plans, decisions and requirements

Each document, what it decided or required, how far the legacy work got, and whether this repo's [roadmap](../roadmap.md) or [decision records](../decisions/README.md) already cover it. "Covered" means the roadmap or a decision states it or replaces it on purpose; "partly" means the topic is there but the legacy requirement's rule or number is not; "no" means neither says anything. Status words: shipped, partly shipped, planned, abandoned, superseded.

| Document | What it decided or required | Legacy status | Covered by the new plan? |
|---|---|---|---|
| `PLAN_01_COMPATIBILITY_MATRIX_AND_BOT_TRAFFIC_MODEL.md` | Bot writes only to the signup site; signage reads through an adapter; no bot-to-venue calls; full matrix of the site's bot-facing routes | Superseded in June 2026 by direct bot control over the tailnet | Covered: modules talk only through API and bus ([0008](../decisions/0008-contract-first.md)); the site stays outside ([0005](../decisions/0005-signup-site-stays-outside.md)) |
| `PLAN_02_ADAPTER_CONTRACT_AND_SELECTIVE_INGESTION_MAPPING.md` | One adapter parses cloud data; tolerant parsing (ISO and Unix-second times, unknown fields ignored); last-known-good snapshot with freshness per source; a dedicated read token never reused from a write secret; eight compatibility fixture tests | Shipped in signage | Covered: the adapter "becomes event consumers" (porting plan); secrets rule in [0013](../decisions/0013-multi-tenant-core.md) item 29 |
| `PLAN_03_FEATURE_CATALOG_AND_PRIORITY_MATRIX.md` | Scope tiers: must F01–F12 (asset library, PPTX, playlists with slide ranges, day/hour schedules, deterministic resolver, 1080p renderer, admin UI, auth, no-blank fallback, kiosk startup, diagnostics, backup and rollback); should F13–F18 (overrides, zoned layouts, emergency and info tools, richer schedule rules, data overlays, admin preview and simulation); optional F19–F23 (cloud parity views, direct bot ingest, other resolutions, WebRTC, RSS bridges) | Must and most should shipped; F16, F21 not | Partly: F01–F06 by [step 3](../roadmap.md#3-screen-core-incl-pptx); F13 by Moments; F14 by zones and layouts as data (0013 items 19, 34); F17/F19 by [step 9](../roadmap.md#9-feeds-and-lan-display); F22 by the Cast track; F23 dropped ([0010](../decisions/0010-scope.md)). **No:** F16 schedule exceptions and dwell rules, F18 preview, duplicate and simulate-at-time, F21 resolutions other than 1080p, F15 who may send an emergency |
| `PLAN_04_DOCUMENTATION_GOVERNANCE_AND_ENFORCED_COMPLETION_RULE.md` | A task is done only when its behaviour and operator docs change in the same work item; a stated reason when no doc changes; cross-repo map as source of truth | Followed | Partly: contracts replace the map ([0008](../decisions/0008-contract-first.md)); AGENTS.md has no "docs in the same PR" rule |
| `PLAN_05_PLATFORM_BLUEPRINT_AND_RUNTIME_TOPOLOGY.md` | WSL supervisor, web and worker; one port 4321; loopback-only kiosk and admin; Windows scheduled task starts WSL, waits for health, opens a kiosk browser; heavy work never on the request path; persistence-first rendering | Shipped | Covered: remote VM and containers ([0011](../decisions/0011-hosting-on-remote-vm.md), [0007](../decisions/0007-stateless-containers.md)); PPTX in a render-job container ([0010](../decisions/0010-scope.md)); Windows and WSL dropped |
| `PLAN_06_SQLITE_STORAGE_POLICY_AND_ADMIN_STATE_API_CONTRACT.md` | One SQLite file on WSL-native storage, WAL and fixed pragmas; online backup daily plus before changes, keep 7 daily and 4 weekly, integrity check; a nine-step restore with a safety snapshot. The admin/state API half was deferred and never written | Storage shipped; API contract never written | Partly: SQLite dropped (0010); backups in 0013 item 26 and [#55](../roadmap.md#2b-tenancy-foundation), but no retention count and no "integrity check before restore" rule |
| `PLAN_07_AUTH_AND_DISCORD_LOGIN_LINK_INTEGRATION.md` | Two ways into one admin session: a local password (hash in a host file) and a Discord login link (5 min, single use, role ids in the token); server-side sessions with idle 60 min and absolute 12 h, a second binding cookie and a user-agent hash; 5 failed logins per 15 min; admin fails closed while `/screen` stays up; never log tokens or passwords | Shipped | Partly: Discord sign-in through the central host replaces the link ([0013](../decisions/0013-multi-tenant-core.md) item 10, #52); rate limits in item 27. **No:** a break-glass way into admin when Discord or the sign-in host is down; session idle and absolute lifetimes; "admin failure never affects screens" |
| `PLAN_08_CANCCUBOT_NEW_SIGNAGE_COMPATIBILITY_AND_CONFIG_STRATEGY.md` | Keep bot env names and meanings; new keys optional and off by default; three rollout postures with PiSignage as rollback | Superseded (PiSignage retired, the control plane added new keys) | Covered: the bot is ported with its own contract ([step 6](../roadmap.md#6-bot)); per-tenant feature flags (0013 item 17) |
| `PLAN_09_NORMAL_SIGNAGE_MVP_1080P_SLIDE_CYCLE_SCHEDULER_AND_CONFIG.md` | 1920×1080 baseline; PNG, JPG, PPTX; weekday windows that may cross midnight (end before start means next day, shown as such in admin); overlap tie-break: higher priority, then newest update; local time zone | Shipped | Covered by porting the scheduler as-is (porting plan); the rules themselves are not restated. Time zone source: see tenancy question 12 |
| `PLAN_10_SCENE_ENGINE_BIGSCREEN_RENDERER_AND_FALLBACK_PATH.md` | Precedence: override, then schedule, then default, then fallback (last good frame, then a static emergency image); overrides must expire; readiness states healthy, degraded, offline-fallback | Shipped | Partly: Moments ranks overrides ([step 4](../roadmap.md#4-moments)); screens cache their last state (0013 item 25). **No:** a static fallback image and the rule that a screen never shows an empty frame |
| `PLAN_11_OBSERVABILITY_BASELINE_AND_RUNBOOK_PACKAGE.md` | Local-first logs per role with required fields and redaction; health and readiness fields; a signal catalogue; local logs kept at least 14 days with rotation; remote alerts optional and never blocking | Shipped | Partly: logs and metrics tagged with the tenant and a status view (0013 item 28); admin health view (step 1). **No:** log retention period and the minimum signal list |
| `PLAN_12_DIRECT_CUTOVER_CHECKLIST_AND_ROLLBACK_ASSET_VALIDATION.md` | Readiness gates before a switch; rollback triggers (boot, blank frame, crash loop, database loss) with times set per event; a 30-minute target to restore the display path | Not used for the spring 2026 event (all-in) | Partly: [step 11](../roadmap.md#11-freeze-dress-rehearsal-and-switch) has the freeze, dress rehearsal and switch; the fallback laptop (0011). **No:** rollback triggers and a recovery-time target |
| `PLAN_13_DEFERRED_WEBRTC_SFU_DESIGN_PACKAGE.md` | WebRTC only after a stability gate; six design deliverables | Superseded by PLAN_15 | Covered: the [Cast track](../roadmap.md#cast) |
| `PLAN_14_ANNOUNCE_CRT_AND_SFX_VOICE_PACK.md` | CRT-style announce card full screen and as an overlay on a stream; sting ownership (attention default, urgent, positive, cancel); local sound copies so the kiosk needs no cloud; a six-line voice pack (Phase B) | Phase A shipped; Phase B superseded by PLAN_18 | Partly: themes (0013 items 19–20); Voices is "not scheduled yet" |
| `PLAN_15_LOW_LATENCY_CASTING.md` | Anyone on the LAN casts over WebRTC through MediaMTX; takeover by hooks; stall guard 5 min; End cast; HTTPS on a LAN hostname; H.264 required; measured about 0.2 s | Latency spike done; rest planned | Covered: the Cast track, with its open question about a remote VM. A newer copy is in the legacy `canccuplatform` repo (#68) |
| `PLAN_16_PHOTO_CAROUSEL.md` | Moderated Discord photos into one designated slideshow; a carousel-only token; new photos first with a featured ring; Clear removes only Discord photos; a spotlight that takes the screen for 60 s | Shipped | Covered: carousel and spotlight in the porting plan (X6 in #68: bot uploads into tenant files, Screen playlist) |
| `PLAN_17_CANCCUMANAGER_REBUILD.md` | Manager on the home server: health poll, alerts via the bot with a webhook fallback, heartbeat watched by the site, event mode, restart/update/deploy over SSH, logs, config view, action log, `/platform` commands | Planned; the newer plan in the legacy `canccuplatform` repo drops event mode | Covered: [step 8](../roadmap.md#8-admin-operations) (debounce, alerts as events, ack, mute, restart policy); the heartbeat watchdog in step 10. Dropped: SSH catalogue, laptop reboot, Proxmox actions |
| `PLAN_18_SCREEN_SOUND_SYSTEM.md` | One sound family in six categories; a sound engine on the kiosk only; cue catalogue, priority, cooldowns, coalescing, flood guard; sound board with Mute all, sound check, asset directory and sound log; three tournament moments; ducking later; a shared admin console look | Phases 1–2 shipped; 3–6 planned; questions 14, 15, 22 open | Partly: Moments has "the sound engine and its budget" ([step 4](../roadmap.md#4-moments)); Voices not scheduled; the embed message protocol is dropped (0010). **No:** sound board, Mute all, sound check, uploadable cue files, sound log, ducking |
| `PLAN_MASTER_2026_EVENT_ALL_IN_SIGNAGE.md` | Seven sequences to make signage the only screen system for the spring 2026 event; open questions on freeze date and login link | Sequences 1–5 done, 6 not started, 7 in progress (last update 2026-07-18) | Covered: the roadmap replaces it; freeze 2027-03-01 |
| `SUBPLAN_EVENT2026_01_ADAPTER_AND_DATA_PATH.md` | Adapter module, `AdapterSnapshotV1`, real freshness signals | Done | Covered (adapter becomes event consumers) |
| `SUBPLAN_EVENT2026_02_WORKER_AND_PROCESS_SPLIT.md` | Worker owns polling and writes; web reads SQLite only; PPTX stays in web by default | Done (its own text still says "merge pending") | Covered (stateless containers, render job) |
| `SUBPLAN_EVENT2026_03_ADMIN_AUTH_AND_SESSION.md` | Password and link sessions; CSRF deferred until admin is exposed beyond loopback | Done | Partly: CSRF is not named in 0013 item 10 |
| `SUBPLAN_EVENT2026_04_SCREEN_AND_ADMIN_UX.md` | Multi-page admin, traffic-light diagnostics, active-now schedule view and simulate-at-time, asset library with video and web URLs, embed compositor, playlist reorder with duplicates allowed | Done | Partly: the admin UI is rewritten "with its view-models kept" (porting plan); simulate-at-time not named |
| `SUBPLAN_EVENT2026_05_SUPERVISOR_PRODUCTION_HARDENING.md` | Supervisor with restart backoff, WSL autostart, file logs, optional alert webhook | Done | Covered: containers and boot survival ([0011](../decisions/0011-hosting-on-remote-vm.md)) |
| `SUBPLAN_EVENT2026_06_EVENT_BURN_IN_AND_REHEARSAL.md` | At least one 8-hour supervised run on final hardware; failure scenarios; an evidence bundle; written risk acceptance; freeze | Not started | Partly: dress rehearsal in step 11. **No:** burn-in length, failure scenarios, evidence bundle |
| `SUBPLAN_EVENT2026_07_CROSSREPO_LAN_DISPLAY_AND_BOT_MIGRATION.md` | LAN-display page shows only the view it is told; bot drives the screen through the control API; PiSignage removed; stream path and burn-in open | Phases A–E done; stream path and Phase F open | Covered: Screen consumes events; the stream service is dropped |
| `DESIGN_2026-07-23_DISPLAY_STATE_WORKER_1102_RELIEF.md` | After the site's display-state route hit the host's resource limit: the bot precomputes stats history every 5 min, tournament data only on request, no heavy cover lookups on the read path, slower polls, and the page always shows a view when a fetch fails | Shipped | Partly: "nothing polls" (roadmap), bot stats (step 6). **No:** a rule that a public read path does no heavy aggregation |
| `docs/superpowers/plans/2026-07-23-display-state-worker-1102-relief.md` | Six tasks across three repos implementing the design, with tests and a production check | Shipped | As the design |
| `docs/superpowers/specs/2026-10-01-steam-cover-fallback-design.md` | Bot fills missing game cover URLs from Steam (name match ≥ 0.85, 3 s budget, cache 7 days for hits and 1 hour for misses); never hosts images | Shipped (bot side) | Covered: `steam_cover` is "port as-is" for the bot (porting plan) |
| `docs/superpowers/plans/2026-10-01-steam-cover-fallback.md` | Four tasks for the spec above | Shipped | As the spec |
| `CROSS_REPO_STRATEGY_AND_API_MAP.md` | Ownership cards, the contract matrix, the two `postMessage` contracts, precedence, adapter and admin secret policy, the October 2026 build order and workflow, integration-test tiers | Kept current to 2026-10-13 | Covered: `contracts/` and [0008](../decisions/0008-contract-first.md). **No:** the live-test safety rules (see Tests) |
| `TRINITY_CAPABILITIES_AND_CONNECTIVITY.md` | Narrative of the three systems, scenarios (announce, poll, hot game, tournament, ticker), precedence bands, secrets, failure domains, open gaps | Current to 2026-07-23 | Covered: roadmap "How the system fits together"; scenarios feed #34 and #35 |
| `AGENTS.md`, `.cursor/rules/plan-questions-required.mdc` | Every plan has "Questions to resolve", requirement analysis, specification and plan; unanswered questions need a stated default, its risk and what is deferred | Followed | Partly: AGENTS.md here has a plan tier but no required plan structure |
| `.cursor/rules/git-feature-branch-workflow.mdc` | No pushes to main; feature branches and PRs | Followed | Covered: AGENTS.md |
| `.cursor/rules/plan-todo-prefix.mdc` | Every plan to-do tagged by effort class | Followed | Not needed (tool-specific) |
| `README.md`, `WORKSPACE.md`, `canccusignage.code-workspace`, `.gitignore` | Plan index; sibling repos opened as one editor workspace with sync commands and git discipline | Used | Covered: the monorepo replaces sibling repos |

### Gaps: not covered by the roadmap or the decision records

Each is a legacy requirement with no counterpart yet. They are listed for the product owner to keep, reword or drop; none is decided here.

1. **Break-glass admin access** when Discord or the central sign-in host is down (PLAN_07 kept a local password for this).
2. **Admin session lifetimes** (legacy: idle 60 min, absolute 12 h) and binding beyond the cookie.
3. **CSRF protection** for state-changing admin routes (deferred in the legacy code while admin was loopback-only; the new admin is on the internet).
4. **Screens never show an empty frame**, with a static fallback image as the last resort (PLAN_10, F09). Item 25 of 0013 covers only offline caching.
5. **Screen resolution policy:** 1080p-first, with other resolutions deferred (F21). With several screens per event this needs a decision.
6. **Richer schedule rules:** exceptions such as holidays, dwell rules, temporary rule windows (F16).
7. **Admin preview tools:** simulate the schedule at a given time, preview a playlist, duplicate a schedule (F18; simulate-at-time shipped).
8. **Who may trigger an emergency takeover** and how (the legacy API had no sender).
9. **Sound board:** Mute all with auto-unmute, per-cue and per-category volume and on/off, sound check through the PA, uploadable cue files with reset, a sound log with drop reasons.
10. **Ducking** of cast and video audio under announce sounds and spoken lines.
11. **Log retention** (legacy: at least 14 days) and the minimum signal list for diagnostics.
12. **Backup retention and restore checks** (legacy: 7 daily and 4 weekly, integrity check before a restore, a safety copy of the live data first).
13. **Rollback triggers and a recovery-time target** for the switch (legacy: per-event thresholds, 30 minutes).
14. **Burn-in:** length (legacy: at least 8 hours supervised), failure scenarios to run, and an evidence bundle.
15. **Cheap public read paths:** no heavy aggregation on a route that screens or pages poll (the lesson of the 1102 incident).
16. **Docs change with behaviour** in the same PR, or the PR says why not (PLAN_04).
17. **Live integration-test safety:** tests refuse production URLs, mark their content, and clean up after themselves.

## Features

This repo serves nothing. Its own features are workflow aids; everything else is a feature of another repo that these docs define, plan or record. "Status" is the legacy state at the last commit.

### Operator features (implemented here)

| # | Feature | Where | Reached by |
|---|---|---|---|
| O1 | Plan index and reading order | `README.md` | Reading |
| O2 | Multi-root editor workspace for four sibling repos, with search and watcher excludes and the terminal starting in the signage repo | `canccusignage.code-workspace`, `WORKSPACE.md` | Opening the workspace file |
| O3 | Sync loop for the sibling clones and git discipline across repos | `WORKSPACE.md` | Manual shell commands |
| O4 | Plan structure rule (questions, analysis, specification, plan; stated defaults) | `AGENTS.md`, `.cursor/rules/plan-questions-required.mdc` | Editor agent sessions |
| O5 | Feature-branch rule | `.cursor/rules/git-feature-branch-workflow.mdc` | Editor agent sessions |
| O6 | To-do tagging rule for plans | `.cursor/rules/plan-todo-prefix.mdc` | Editor agent sessions |
| O7 | Documentation completion rule and update triggers for the API map and the capabilities guide | `PLAN_04_DOCUMENTATION_GOVERNANCE_AND_ENFORCED_COMPLETION_RULE.md`, `CROSS_REPO_STRATEGY_AND_API_MAP.md`, `TRINITY_CAPABILITIES_AND_CONNECTIVITY.md` | Reviews |
| O8 | Cross-repo contract map and templates for new system cards and contract rows | `CROSS_REPO_STRATEGY_AND_API_MAP.md` | Reading |
| O9 | Workflow of the October 2026 plans: an outside bot turns plans into epics; the editor agent implements; the signup site is built directly because the bot's token cannot reach its repo | `CROSS_REPO_STRATEGY_AND_API_MAP.md` | Reading |

### Features defined here, implemented elsewhere

"Who" is the audience: everyone at the venue (the big screen), attendees, admins, crew, operators.

| # | Feature | Who | Defined in | Implemented by | Status | Reached by |
|---|---|---|---|---|---|---|
| X1 | Scheduled signage: image, PPTX, video and web assets; playlists with slide numbers and ranges; weekday windows across midnight; week calendar; simulate-at-time | Everyone, admins | PLAN_03, PLAN_09, SUBPLAN 04 | signage | Shipped | `/screen`, `/admin/content`, `/admin/schedule` |
| X2 | PPTX slide rendering with a cache | Everyone, admins | PLAN_03, PLAN_09 | signage | Shipped | Asset upload |
| X3 | Embed compositor with lanes: schedule, bot overrides, stream, ticker overlay; precedence bands; `409` for a hot-game banner under a higher band; crossfade | Everyone | CROSS_REPO, TRINITY, SUBPLAN 04, 07 | signage | Shipped | `/api/control/override` |
| X4 | No-blank fallback: last good frame, then a static image; Ready check with an 8 s fallback image for embedded pages, opt-in per target | Everyone | PLAN_10, CROSS_REPO | signage, signup site (sender) | Shipped | `/screen`, `canccu:screen-ready` |
| X5 | Playback bookmarks and ADVT breaks (periodic slideshow breaks with their own period and length) | Everyone | SUBPLAN 04, PLAN_16 | signage | Shipped | Schedule; `/api/screen/playback-progress` |
| X6 | Ticker overlay, last writer wins, appearance presets; poll countdown ticker | Everyone, admins | TRINITY | bot, signage | Shipped | `/ticker`, `/admin/ops` |
| X7 | Announce: full-screen card, or overlay on a stream; one sting per appearance | Everyone, admins | PLAN_14, TRINITY | bot, site, signage | Shipped | `/signage-announce`, `/signage-clear`, `/signage-reset` |
| X8 | Polls on screen: full screen for a while, then ticker, then results | Everyone, voters | TRINITY, PLAN_01 | bot, site, signage | Shipped (dropped in the new plan) | Poll commands |
| X9 | Hot-game banner: up to four top games with covers; one banner per episode, cooldown per game | Everyone | TRINITY, CROSS_REPO | bot, site, signage | Shipped | Automatic |
| X10 | Game cover art chain (cache, Discord art, Steam by name, IGDB) | Everyone | Steam spec, TRINITY | bot, site | Shipped | Automatic |
| X11 | Stats view: presence, voice, games now and trends, hourly and daily history, top games over 96 hours | Everyone | 1102 design, TRINITY | bot, site | Shipped | LAN-display page (default view) |
| X12 | Tournament view on screen: pinned 15 minutes before start until 10 minutes after; panels cycle inside the page | Everyone, players | TRINITY, PLAN_18 | bot, site, signage | Shipped | Automatic pin |
| X13 | Tournament automation: registration tokens, reminders by DM, status changes, roster, leaderboard, clear | Players, admins | PLAN_01 | bot, site | Shipped | `/tournament …` commands |
| X14 | Photo carousel: Add and Remove from a Discord message menu; new photos first with a featured ring; admin Clear | Everyone, admins | PLAN_16 | bot, signage | Shipped | Message commands, `/admin/content` |
| X15 | Photo spotlight: add and show now, or a one-off showcase; 60 s; refused while a higher band holds the screen | Everyone, admins | PLAN_16, CROSS_REPO | bot, signage | Shipped | Message commands |
| X16 | Sound system: cue engine on the kiosk, categories, cooldowns, flood guard; sound board with Mute all, sound check, asset directory, sound log | Everyone, admins | PLAN_18 | signage, site (cue sender) | Phases 1–2 shipped | `/screen`, the admin Sounds page |
| X17 | Tournament sound moments (before start, start, after first score), once per event | Everyone | PLAN_18 | site (sender), signage | Planned | `canccu:screen-cue` |
| X18 | Admin sign-in: password or Discord login link; sessions | Admins | PLAN_07, SUBPLAN 03 | bot (issuer), signage | Shipped | `/admin/login`, `/admin/link` |
| X19 | Health, readiness, manager-shaped health, diagnostics page, file logs, optional alert webhook | Operators | PLAN_11, PLAN_17, SUBPLAN 05 | signage | Shipped | `/api/health`, `/api/readiness`, `/api/healthz`, `/admin/diagnostics` |
| X20 | Supervisor, WSL autostart, kiosk launcher with a health wait | Operators | PLAN_05, SUBPLAN 05 | signage | Shipped | Host boot |
| X21 | Database backup and restore | Operators | PLAN_06 | signage | Shipped | Runbook |
| X22 | Cutover to and rollback from PiSignage | Operators | PLAN_08, PLAN_12 | bot, signage | Abandoned (PiSignage retired) | Runbook |
| X23 | Emergency takeover (highest band) | Crew | CROSS_REPO, PLAN_18 | signage | API only, no sender | `/api/control/override` |
| X24 | Admin live screen (a mirror of `/screen` that never plays sound) | Admins | PLAN_16, PLAN_18 | signage | Shipped | `/admin/ops` |
| X25 | Directive history, broken-YouTube detection, admin console look | Admins | CROSS_REPO, PLAN_18 | signage | Shipped or decided | `/admin/ops`, `/api/screen/youtube-playback-error` |
| X26 | Site admin reset of snapshots and the active poll | Admins | PLAN_01 | site | Shipped | `/api/admin/lan-reset` |
| X27 | RSS feeds of polls and of the bot ticker | Legacy readers | PLAN_01, PLAN_08 | site, bot | Legacy | `/api/display/polls-rss`, bot RSS path |
| X28 | Stream takeover through a stream service | Everyone | PLAN_01, SUBPLAN 07 | stream service, bot | Abandoned | Bot webhook |
| X29 | Low-latency casting | Attendees, crew | PLAN_15 | signage relay, bot | Planned | Cast page, `/cast stop` |
| X30 | Manager: health, alerts, actions, logs, `/platform` commands | Operators, admins | PLAN_17 | manager, bot, site | Planned | Tailnet dashboard, Discord |

## Interfaces

This repo serves no HTTP, has no Discord client, no socket and no bus. Below, every interface its documents define, grouped by provider. "planned" marks interfaces written before code. The provider's own inventory (#69–#73, #75) is the authority on the implementation; this list is what the docs promised.

### A. HTTP routes

**Signup site (provider: the signup site; it stays outside the platform, [0005](../decisions/0005-signup-site-stays-outside.md)).** "Secret" means `Authorization: Bearer <API_SECRET>`, compared by plain equality.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/polls` | secret | `question`, `options[]`, `created_by`, optional `expires_at` | `201` poll with option ids; `409` when one is active |
| `PATCH /api/polls/{id}` | secret | `message_id` | `{ok:true}`; `404` |
| `POST /api/polls/{id}/votes` | secret | `user_id`, `option_id` | `{ok:true}`; `404` for a wrong poll or option |
| `POST /api/polls/{id}/close` | secret | empty | closed poll with `vote_counts`, `total_votes`; `404`. Close and cancel both use it |
| `GET /api/polls/active` | public | none | the poll, or `404` "no active poll" (a normal state) |
| `POST /api/snapshots/presence` | secret | `timestamp`, `online_count`, `idle_count`, `dnd_count` | `201 {ok:true}` |
| `POST /api/snapshots/voice` | secret | `timestamp`, `channels[]` (`channel_name`, `user_count`; only channels with a non-bot member) | `201 {ok:true}` |
| `POST /api/snapshots/game` | secret | `timestamp`, `games[]` (`game_name`, `user_count`, optional `application_id`, `cover_image_url`) | `201 {ok:true}` |
| `POST /api/display/announce`, `DELETE /api/display/announce` | secret | `message`, `sfx` (`bell`, `fanfare`, `alert`, `cancel`) | `{ok:true}`; the delete needs no CSRF token |
| `POST /api/display/stats-history` | secret | `{statsHistory, computed_at?}`; arrays `presenceHourly`, `presenceDaily`, `voicePeakHourly`, `voicePeakDaily`, `gamesTop96h` (`game_name`, `totalPlayerTime`, `player_hours`); body capped at about 500 kB | `200`; `401` |
| `GET /api/display/state` | public | `include=tournament`, `trend_seconds` | `activePoll`, `latestClosedPoll`, `presence`, `voiceChannels`, `games`, `announce`, `server_now`; optional `statsHistory`, trend state, `tournament` (only with the include). `null` for missing live parts |
| `GET /api/display/polls-rss` | public | none | RSS of polls, cached 60 s |
| `POST /api/display/trend-state` | public (no auth) | `games_now`, `games_96h` arrow and rank state | writes trend rows |
| `POST /api/admin/lan-reset` | site admin cookie | `{snapshots?, polls?}` | deleted-row counts; may close the active poll |
| `GET /api/health` | public | none | `{status:"ok"}` |
| `GET /api/tournament/events` | public | none | `{events:[…]}`: `id`, `game_name`, `starts_at`, `registration_closes_at`, `status`, `created_by`, `registrant_count`, `scored_count`, optional `event_link` |
| `POST /api/tournament/events` | secret, or admin token | secret: `game_name`, `starts_at`, `registration_closes_at`, `created_by`, `event_link?`; admin token: `game_name`, `starts_at`, `event_link?` | `201` event. Two request shapes keyed by auth |
| `GET /api/tournament/events/{id}/registrants` | secret or admin token | none | `event_id`, `registrants[]` (`discord_user_id`, `discord_username`, `registered_at`) |
| `PATCH /api/tournament/events/{id}/status` | secret | `status` `open`\|`closed`\|`started` | `{ok:true}` |
| `DELETE /api/tournament/events/{id}` | secret or admin token | none | deletes with its registrations |
| `GET /api/tournament/leaderboard` | public | none | `{leaderboard:[…]}` |
| `GET`/`POST /api/tournament/internal/token` | secret | `GET ?user_id=`; `POST` token, user id and name in two alias sets, `expires_at` | `{token}` or `404` |
| `GET`/`POST /api/tournament/internal/admin-token` | secret | as above | as above |
| `GET /api/tournament/internal/users/{user_id}/registrations` | secret | none | `{registrations:[…]}` |
| `DELETE /api/tournament/internal/clear` | secret | none | `200`/`204`; deletes events, scores, registration and admin tokens |
| `GET /lan-display` (page) | public | `view` (`stats`, `active_poll`, `poll_result`, `game_banner` with alias `hot_game`, `announce`, `tournament_leaderboard`), `msg`, `sfx` | HTML; polls the state every 30 s |
| `POST /api/manager-heartbeat` (planned) | manager token | health shape | stale heartbeat alerts through a webhook |

**Signage server (provider canccusignage; port 4321).**

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /screen` | none (loopback in the plans; later reached over the tailnet too) | none | the kiosk page |
| `GET /admin`, `/admin/content`, `/admin/schedule`, `/admin/ops`, `/admin/diagnostics`, and the Sounds page | admin session | none | pages; redirect to `/admin/login` |
| `GET /admin/login` | none | none | password form and link instructions |
| `GET /admin/link?token=` | the token | token claims `iss`, `aud` (`canccusignage-admin`), `instance_id`, `jti`, `discord_user_id`, `discord_username`, `role_ids`, `iat`, `exp`; HMAC | session, redirect to `/admin` without the token; generic failure page |
| `POST /api/admin/auth/password` | none | password | `204` and cookies; `401`; `429` after 5 failures in 15 min |
| `GET /api/admin/session` | optional | none | session summary, or `authenticated: false` |
| `POST /api/admin/auth/logout` | session | none | `204`; `401` |
| other `/api/admin/**` | session, binding cookie; CSRF planned | | `401` no session; `403` missing role; `409` conflict |
| `POST /api/admin/assets/upload`, `POST /api/admin/assets/upload/batch` | session | multipart; PNG, JPEG, GIF, WebP up to 100 MiB (plus PPTX, video and web URL assets) | asset rows |
| `POST /api/admin/playlist-items`, `DELETE /api/admin/playlist-items`, `DELETE /api/admin/playlist-items/{id}` | session | one item or `items[]`; item ids | |
| `PATCH /api/admin/playlists/:playlistId/reorder` | session | order | duplicates allowed |
| `POST /api/control/override` | bearer per source (`SIGNAGE_CONTROL_TOKEN_BOT`, `_STREAM`, `_OPS`, `_EMERGENCY`); `Origin` in the trusted list | `source`, `kind` (`web`, `asset`, `stream`), `target`, `label`, `ttlSeconds`, `message`, optional `actor`; `label: ticker` sets the ticker | `200`; `409` for `hot_game` under a higher band; `401` |
| `DELETE /api/control/override[?label=]` | as above | none | clears one label, or all of the caller's |
| `GET /api/control/override` | as above | none | directives |
| `POST /api/carousel/photos` | carousel bearer only | multipart `photos`, `messageId`, `channelName`, `authorDisplayName`, `postedAt` | `200 {ok, added[{id,fileName}], rejected[{fileName,error}]}`; `400`; `401`; `409` not set up or duplicate message id |
| `DELETE /api/carousel/photos?messageId=` | carousel bearer | none | `200 {ok, removed, filesDeleted, filesKept}`; `400` unknown id; `409` not set up |
| `POST /api/carousel/spotlight` | carousel bearer | `{assetId}`, or one photo plus the metadata | `200 {ok, assetId, expiresAt}`; `409 {error:"screen_busy", currentBase}` |
| `POST /api/screen/playback-progress` | loopback | playlist, item, offset, image index | not specified |
| `POST /api/screen/youtube-playback-error` | loopback; mirror reports ignored | asset, error code | marks the asset `health_status=error` |
| `GET /api/screen/state` | none | none | the screen state the kiosk polls; also carries sound settings |
| `GET /api/health` | none | none | `ok`, `service`, `timestamp`, `stateRoot`, `scheduleTimeZone` |
| `GET /api/readiness` | none | none | `ok`, `timestamp`, `activePlaylistId`, `activeAssetId`, `frameKind`, `scheduleTimeZone`; later worker heartbeat age, adapter freshness, fallback reason, queue backlog |
| `GET /api/healthz` | none | none | `service`, `status` (`ok`\|`degraded`\|`down`), `version`, `uptimeSeconds`, `checks[]` (`name`, `status`, `detail`); one `screen-poll` check: under 5 s ok, 5–30 s degraded, over 30 s down; mirror polls ignored |

**Bot (provider canccubot).**

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `POST {STREAM_WEBHOOK_PATH}` | `STREAM_WEBHOOK_TOKEN` | `stream_active` with `active_slots` and optional `spotlight`, or `stream_idle` | `200`, acknowledged before work |
| `GET {TICKER_RSS_PATH}` | public | none | RSS of ticker items |
| Health endpoint and alert endpoint (planned, PLAN_17) | manager token | alert with subsystem, failing check, since, link | posts with an Acknowledge button |

**PiSignage (retired).** Player API `GET /api/status`, `POST /api/play/playlists/{name}`, `POST /api/reboot` with HTTP Basic auth; a cloud API with a session token for group tickers and deploys.

**Cast relay (planned, MediaMTX).** WHIP publish on port 8889 path `cast`; WebRTC playback; UDP 8189; local API on loopback port 9997 (`/v3/paths/get/cast` for `inboundBytes`, `/v3/webrtc/sessions/kick/{id}`).

**Manager (planned, PLAN_17).** A tailnet-only dashboard and API: overview, detail, actions (restart, update, deploy with rollback), logs, config view, action log, event mode. The newer contract is in the legacy `canccuplatform` repo (#68).

### B. Discord commands and handlers

Implemented in canccubot (#69); named here only.

| Command or handler | Purpose | Source |
|---|---|---|
| `/signage-announce`, `/signage-clear`, `/signage-reset` | Announce with a chosen sting (default attention), clear, reset | TRINITY, PLAN_14 |
| `/ticker` (`set` and clear) | Ticker overlay | TRINITY |
| Poll commands, `/poll-close`, `/poll-cancel` | Poll lifecycle; both end commands close the poll | PLAN_01, TRINITY |
| `/tournament my-registrations`, `/tournament clear`, registration token minting | Tournament automation | PLAN_01 |
| Tournament timers | DM reminders, status changes, the screen pin 15 minutes before start; start DM at start time | PLAN_18 |
| Add to photo carousel, Remove from photo carousel, Add to carousel and show now, Showcase photo (message menu) | Carousel and spotlight; limited to the bot's admin role (`ADMIN_ROLE_NAME`) | PLAN_16 |
| Login-link issuer | Mints the admin login link after a role check | PLAN_07 |
| `/stream` → `/cast status`, `/cast stop` | Stream commands repurposed for casting (planned) | PLAN_15 |
| `/platform status [subsystem]`, `/platform logs`, `/platform restart`, `/platform update`, `/platform deploy`, `/platform event-mode on\|off` | Manager through the bot (planned) | PLAN_17 |
| Acknowledge button | Acks a manager alert (planned) | PLAN_17 |
| Presence, voice and game watchers; hot-game detector; stats-history publisher | Snapshots and banners | TRINITY, 1102 design |

### C. WebSocket, SSE and streams

- No WebSocket and no SSE in any document of this repo.
- Cast: WHIP in, WebRTC out (planned).
- Manager actions stream their output (planned; transport not specified).

### D. Messages and events

There is no bus. The messages are browser `postMessage` from the embedded LAN-display page to `/screen`, version 1, sent to `*` only when embedded; the receiver checks the iframe source, a fixed site origin, `type` and `version`:

- `canccu:screen-ready` `{view?}`: once per page load, as soon as the view shell is built (not inside an animation frame, so hidden frames work). The `view` echoes the URL's `view` exactly or is absent for the default page.
- `canccu:screen-cue` `{cue, source}`: only for changes after the first render; `source` is the box id for chip cues and the tournament event id for strip and tournament cues. Cue ids `chrome.hot`, `chrome.voice`, `chrome.spike`, `strip.tournament_next`, `tournament.pre`, `tournament.start`, `tournament.post`; unknown ids are logged and ignored.

The sound engine's own cue ids (signage events, no message): `announce.attention`, `announce.urgent`, `announce.result`, `announce.ended`, `announce.cleared`, `emergency.start`, `poll.open`, `poll.result`, `nowplaying.start`, `ticker.message`, `photo.showcase`, `cast.live`, `cast.ended`. Rules: one cue at a time with a short priority queue; priority urgent, tournament moments, result, attention, something new, ended, ambient; an emergency drops all else; per-chip cooldown at least 10 min; one ambient sound per 30 s; 2 s coalescing; flood guard 1 per cue and source per 10 s and 20 per minute; the mirror never plays.

### E. Scheduled and background jobs

| Job | Cadence | Runs in | Source |
|---|---|---|---|
| Presence, voice and game snapshots | about 30–60 s | bot | TRINITY |
| Stats history publish | 300 s (`STATS_HISTORY_PUBLISH_SECONDS`), once soon after start | bot | 1102 design |
| Hot-game episodes | each game snapshot; banner 120 s; cooldown 15 min | bot | TRINITY |
| Tournament reminders, status change, screen pin until 10 min after start | timers per event; scoring flags polled from the site | bot | PLAN_18 |
| Adapter polls | display state 180 s (was 5 s), tournament about 60 s, health about 30 s | signage worker | 1102 design, TRINITY |
| Schedule resolution, fallback derivation, PPTX queue, asset integrity scan, heartbeat | continuous | signage worker | PLAN_05 |
| SQLite backup | daily, plus before changes | signage host | PLAN_06 |
| Log rotation | by size or date; keep 14 days | signage host | PLAN_11 |
| Sound log and directive history caps | by age or row count | signage | PLAN_18 |
| LAN-display page poll | 30 s | browser | 1102 design |
| Kiosk liveness (screen-state poll) | continuous | kiosk browser | CROSS_REPO |
| Manager poll, two agreeing polls, reminder, heartbeat push (planned) | 30 s; 30 min; 60 s | manager | PLAN_17 |
| Stale-heartbeat check (planned) | scheduled | signup site | PLAN_17 |
| Cast hook refresh and stall guard (planned) | 5 s; 15 s TTL; stall 300 s | relay host | PLAN_15 |
| Steam cover cache expiry | hits 7 days, misses 1 hour | bot | Steam spec |

## Data

This repo stores no data and has no migrations. The stores below are the ones its documents name; the owning repo's inventory has the full schema. "Scope" says whether the data is per event, global, or belongs to a venue (or a device at a venue) rather than to an event.

| Store | Owner | Columns or keys | Scope | Retention |
|---|---|---|---|---|
| `admin_sessions` (SQLite) | signage | `session_id`, `subject_type` (`password`\|`discord`), `discord_user_id`, `discord_username`, `user_agent_hash`, `binding_secret_hash`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at` | per event (users are global) | idle 60 min, absolute 12 h |
| `admin_consumed_login_links` | signage | `jti`, `discord_user_id`, `consumed_at`, `token_expires_at` | per event | not stated |
| Login rate-limit buckets | signage | failures per bucket | per device | 15 min window |
| `assets` | signage | id (UUID), kind, file under `{SIGNAGE_STATE_ROOT}/assets/`, health status, Discord message id and metadata for carousel photos | per event (media); the files belong to the event repo ([0003](../decisions/0003-event-content-scrubbed.md)) | until deleted |
| Playlists and items | signage | id, name, enabled, priority, type (`advt` for breaks), playback mode, `advtPeriodSeconds`, `advtBreakDurationSeconds`, resume cursor `advtItemId`, `advtOffsetSeconds`; items with slide numbers or ranges | per event | until deleted |
| Schedules | signage | playlist id, weekdays, start and end time, optional priority override | per event | until deleted |
| Directives and directive history | signage | key (`source`, `label`), kind, target, TTL, message, `actor`, band | per event | history capped |
| Ticker state, ticker appearance | signage | message, expiry, `pollExpiresAt`; presets | per event | TTL |
| `adapter_snapshot`, `worker_heartbeat` | signage | normalized `AdapterSnapshotV1` groups (`clock`, `poll`, `announce`, `presence`, `voice`, `games`, `stats`, `tournament`, `sourceStatus`, `recommendedFallback`); freshness | per event | last only |
| Carousel settings | signage | `carousel_playlist_id`, featured dwell (15 s, 10–20), break cap (90 s), effect on/off, `spotlightDurationSeconds` (60) | per event | |
| `carousel_featured_shown` | signage | photos already featured | per event | |
| Sound settings, cue file assignments, uploaded sounds, sound log, played tournament cues | signage | volumes, on/off, cooldowns, flood guard, Mute all; log rows with cue, source, outcome, reason | settings per event; uploaded sounds per event; log per event | log capped; played cues remembered across restarts |
| Ready opt-in per LAN-display target, fallback image | signage | flags; one image | per event | |
| Kiosk liveness | signage | last non-mirror screen poll | per device at a venue | not stated |
| Logs | signage host | `timestamp`, `level`, `service`, `event`, `message`, `requestId`/`jobId` | per host | at least 14 days |
| Backups | signage host | timestamped database copies | per host | 7 daily, 4 weekly |
| `lan_display_stats_history` (site database, migration `022`) | signup site | `id` (always 1), `payload_json`, `computed_at`, `updated_at` | per event | last only |
| `lan_display_trend_state` | signup site | arrow and rank state for games now and over 96 h | per event | not stated |
| Polls, options, votes; presence, voice and game snapshots; announce; cover cache; tournament events, registrations, scores; registration and admin tokens | signup site | named only | per event (cover cache could be global) | not stated; admin reset deletes snapshots |
| Bot memory | bot | 96 h of snapshots for the stats history; hot-game cooldowns; Steam cover cache | per event | 96 h; 7 days; 1 h |
| Manager database (planned) | manager | state history, events, acknowledgements, action log; a subsystem and action config file | global | not stated |
| Host secret files | hosts | `auth.env`, `adapter.env` under the signage host's config directory; bot env file | per host | until changed |

## Configuration

Secret values are never in the repo and none are copied here. "Default" is as the documents state it.

### Signage server

| Name | Default | Meaning |
|---|---|---|
| `SIGNAGE_STATE_ROOT` | the runtime root under `/var/lib/canccusignage` | Writable state: database, assets, caches, logs |
| `SIGNAGE_DB_PATH` | under the state root | Optional database path |
| `SIGNAGE_FILE_LOGS` | off | `1` turns on file logs with rotation |
| `SIGNAGE_ALERT_WEBHOOK_URL` | unset | Optional best-effort alert webhook |
| `SIGNAGE_BASELINE_WEB_*` | not stated | The default LAN-display item added to new playlists |
| `SIGNAGE_CONTROL_TOKEN_BOT`, `SIGNAGE_CONTROL_TOKEN_STREAM`, `SIGNAGE_CONTROL_TOKEN_OPS`, `SIGNAGE_CONTROL_TOKEN_EMERGENCY` | secrets | One control token per source; the token fixes the source |
| `SIGNAGE_TRUSTED_ADMIN_HOSTS` | empty | Extra hosts allowed in `Origin` on control calls |
| `SIGNAGE_WEB_ASSET_ALLOWED_HOSTS` | includes the site | Hosts allowed as web assets and directive targets |
| `SIGNAGE_CAROUSEL_TOKEN` | secret | Carousel and spotlight bearer |
| `ADMIN_PASSWORD_HASH` | secret (Argon2id hash) | Local password |
| `ADMIN_SESSION_SECRET` | secret | Session signing |
| `DISCORD_LOGIN_LINK_HMAC_SECRET` | secret | Login-link signature key |
| `DISCORD_ALLOWED_ROLE_IDS` | none | Role ids allowed to sign in |
| `SIGNAGE_INSTANCE_ID` | none | This host's id in the login link |
| `ADAPTER_CLOUD_BASE_URL` | the site | Cloud base URL |
| `ADAPTER_CLOUD_AUTH_MODE` | `public` | `public` or `bearer` |
| `ADAPTER_CLOUD_BEARER_TOKEN` | secret, only with `bearer` | Dedicated read token, never a write secret |
| `ADAPTER_POLL_DISPLAY_MS` | 180000 (was 5000) | Display-state poll; freshness live up to 540 s, stale after 30 min |
| Tournament and health poll intervals | about 60 s and 30 s; freshness live 120 s and 60 s | Adapter |

Settings (not env): schedule time zone (local); playlist ADVT period and break length; carousel featured dwell, break cap, effect; `spotlightDurationSeconds` 60; sound board settings (master and category volumes, per-cue on/off, volume, cooldown, file; per-chip cooldown 10 min; ambient gap 30 s; coalescing 2 s; flood guard 1 per 10 s and 20 per minute; Mute all with auto-unmute; `ticker.message` cooldown 2 min); Ready opt-in per target and the fallback image; ticker appearance presets. Fixed values: the one web port 4321; login link 5 min; session idle 60 min and absolute 12 h; 5 failed logins per 15 min; upload limit 100 MiB; SQLite WAL, `synchronous=NORMAL`, foreign keys on, busy timeout 5000 ms.

### Bot

| Name | Default | Meaning |
|---|---|---|
| `API_URL`, `API_SECRET` | none; secret | Site base URL and shared write secret; the client does nothing when `API_URL` is unset |
| `CANCCUSIGNAGE_CONTROL_URL`, `CANCCUSIGNAGE_CONTROL_TOKEN` | none; secret | Venue control; both needed |
| `CANCCUSIGNAGE_CAROUSEL_TOKEN` | secret | Carousel bearer |
| `LAN_DISPLAY_URL` | the site's LAN-display page | Base of embed targets (earlier the PiSignage-era display URL; its meaning changed) |
| `POLL_HIGHLIGHT_SECONDS`, `POLL_RESULT_DISPLAY_SECONDS`, `POLL_TICKER_REFRESH_SECONDS` | 60, 180, not stated | Poll timing |
| `GAME_THRESHOLD`, `GAME_BANNER_DISPLAY_SECONDS`, `GAME_BANNER_COOLDOWN_SECONDS`, `GAME_BANNER_TEST_MODE` | 4, 120, 900, off | Hot-game policy |
| `BOT_TICKER_TTL_SECONDS`, `ANNOUNCE_DEFAULT_SECONDS` | not stated | Ticker and announce lifetimes |
| `STATS_HISTORY_PUBLISH_SECONDS` | 300 | Stats publish cadence |
| `EVENT_TIMEZONE` | the event's local time zone | Times in carousel file names and metadata |
| `ADMIN_ROLE_NAME` | the bot's admin role name | Role allowed to use admin commands |
| `STREAM_WEBHOOK_PATH`, `STREAM_WEBHOOK_TOKEN`, other `STREAM_*` | not stated; secret | Stream webhook server (abandoned) |
| `TICKER_RSS_*` | optional | Bot ticker RSS (legacy) |
| `PISIGNAGE_PLAYER_*`, `PISIGNAGE_CLOUD_*`, `PISIGNAGE_GROUP_NAME`, `PISIGNAGE_PLAYLIST_*` | none | PiSignage control (retired) |
| `INTEGRATION_CANCCUSIGNAGE_URL`, `INTEGRATION_CANCCUSIGNAGE_TOKEN` | none | Live integration tests; only a dev port is accepted |

### Signup site, relay, manager

| Name | Owner | Default | Meaning |
|---|---|---|---|
| `API_SECRET` | site | secret | Write secret checked by equality |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | site | secrets | Cover art lookup |
| `POLL_INTERVAL_MS` | site page | 30000 | LAN-display state poll |
| `STREAM_TOKEN`, `CONTROL_URL`, `CAST_DIRECTIVE`, `STALL_SECONDS` | cast hooks (planned) | secret, none, none, 300 | Hook environment |
| MediaMTX keys (`api`, `apiAddress`, `webrtcAddress`, `webrtcEncryption`, `webrtcServerKey`, `webrtcServerCert`, `webrtcLocalUDPAddress`, `webrtcAdditionalHosts`, `authInternalUsers`, `overridePublisher`, `runOnAvailable`, `runOnAvailableRestart`, `runOnUnavailable`) | relay (planned) | as in the plan | Relay config |
| SSH keys, Proxmox and Cloudflare API tokens, webhook URLs, manager tokens | manager (planned) | secrets | Kept only on the manager |

## External integrations

| Integration | Used for | Needs |
|---|---|---|
| Discord | Commands, message menus, presence, voice and game data, role checks for login links and admin commands, alerts, DMs | The bot's token and intents (#69); role ids; an admin channel; webhooks for fallback alerts |
| Hosted serverless platform of the signup site | The site, its SQL database, scheduled checks, logs API | Its account (held by the site's maintainer); deploys on merge through CI |
| Tailscale | Bot to signage control, operator access, the manager's reach | Tailscale inside WSL only (the Windows side is not on the tailnet); WSL and Tailscale must start at Windows boot |
| Windows and WSL2 | Kiosk browser (Edge in kiosk mode), scheduled-task launcher, systemd in WSL, MediaMTX natively on Windows | Localhost forwarding from Windows into WSL; firewall rules for WebRTC ports |
| PiSignage | Old player and cloud | Retired |
| Steam store APIs | Cover art by name and by app id (`storesearch`, `appdetails`) | Network access from the bot and the site; no key |
| IGDB | Cover art fallback on the site | Client id and secret |
| YouTube | Video assets; IFrame Player API for error reports and later ducking | `enablejsapi=1`; `origin=` recommended but not set |
| MediaMTX, WebRTC, WHIP | Casting (planned) | A trusted certificate on a LAN hostname (DNS validation through the DNS provider), H.264 senders |
| ElevenLabs, jsfxr, Audacity | Producing sounds and spoken lines | Accounts and a fixed processing chain (loudness about −16 LUFS, peaks −1 dBTP) |
| Venue PA | Sound from the kiosk's audio output | Sound check per event |
| Proxmox | Bot container and manager guest; planned container restart | API token on the manager |
| GitHub Actions | Site deploys on merge; the manager shows the last run | |
| Files and media | Assets, carousel photos, PPTX renders, sound files on the signage host; fallback images | Signage storage (#71); media belong to the event repo ([0003](../decisions/0003-event-content-scrubbed.md)) |

## Tests

There are no test files in this repo. The documents define tests that other repos must have; they are listed because they are the spec for the port.

| Test named in a document | Covers | Repo | Source |
|---|---|---|---|
| Adapter compatibility fixtures (8 cases) | Missing tournament and stats blocks, missing `event_link`, unknown fields, ISO and Unix-second times, `null` sections, bad array items, last-known-good until expiry | signage | PLAN_02 |
| Schedule, fallback and PPTX tests | Overlaps, cross-midnight windows, slide selection, no blank output | signage | PLAN_09, PLAN_10 |
| Auth tests | Password login, link validation, replay, session TTLs | signage | SUBPLAN 03 |
| Control handler mirror (`tests/integration-bot-control.test.ts`) | Bot-shaped bodies against the control route: ticker and announce | signage | CROSS_REPO |
| Bot unit tests (`pytest tests/bot`) | Mocked cogs and services, the control client | bot | CROSS_REPO, SUBPLAN 07 |
| Live integration tier (`pytest -m integration`, `tests/integration/test_canccusignage_live.py`) | Eight scenarios: ticker set and clear, announce, clear, poll to ticker, scheduled ticker window, wrong token `401`, round-trip latency; refuses production ports, marks content, cleans up | bot against a dev signage stack | CROSS_REPO |
| Display-state route tests | Tournament only with the include, no heavy aggregation, stats blob read, ingest auth | site | 1102 plan |
| Stats history aggregation tests | Empty store, known fixtures, hourly buckets, matching the old site results | bot | 1102 plan |
| Steam cover tests | Name normalisation, match threshold, a sequel not chosen, hashed header URL, cache, timeout | bot, site | Steam spec |
| Burn-in and rehearsal | 8-hour run, restarts, cloud loss, override lifecycle | ops | SUBPLAN 06 |

Gaps that matter for the port:

- The cross-repo contracts were checked by hand; the only machine check across repos was a manual live tier with no CI job. The new contract tests in CI replace this.
- No test covered the `postMessage` contracts end to end; the Ready misses (below) were found at the venue.
- Burn-in (SUBPLAN 06) and the cross-repo Phase F never ran, so no evidence exists that the whole system held for an event day.
- Sound phase 2 still lacked a synthetic test for chips, strip, mirror, flood guard and Mute all at the last commit.
- The hot-game banner's end-to-end smoke was never done.

## Known problems

From the documents and the commit history.

1. **Incident: display-state route hit the host's resource limit** (error 1102). Heavy stats aggregation, tournament queries and cover lookups ran on a route polled every 5 s by two clients; the page then showed only its header. Fixed by moving the aggregation to the bot, slower polls and a fallback view.
2. **Incident: Ready messages missed.** An older page sent Ready after its data fetch, a later one inside animation frames, which never run in hidden frames. Fixed by sending once the view shell is built.
3. **Bug: Clear carousel deleted the whole playlist,** curated items included; fixed so it removes only Discord photos.
4. **Scheduler quirk:** when two ADVT breaks are due, the later due time wins rather than the higher priority, and a playlist with no saved state waits one full period before its first break.
5. **Emergency band without a sender:** the token and band exist, but no admin page or command can start an emergency, and the manager's "emergency active" warning does not exist.
6. **Unfinished paths:** the stream service's venue path was never finished and the repo is to be scrapped; burn-in (SUBPLAN 06) and Phase F never ran; the hot-game smoke test is open; sound phases 3–6 and the tournament cues are open; open questions 14, 15 and 22 on spoken lines and final sound defaults.
7. **Plans contradict later practice:** PLAN_01 and PLAN_08 forbid direct bot control and new required bot keys, which the June 2026 control plane added; PLAN_08 forbids reinterpreting `LAN_DISPLAY_URL`, which later became the base of embed targets; PLAN_05 makes `/screen` and `/admin` loopback-only, while SUBPLAN 05 added operator access over the tailnet without the separate auth plan PLAN_05 asked for.
8. **Stale status text:** SUBPLAN 02 still says "merge pending" while the master plan says done; the master plan's progress table stops at 2026-07-18; PLAN_15 and PLAN_17 never got their epic links; the admin/state API half of PLAN_06 was never written.
9. **Two copies of two plans:** PLAN_15 and PLAN_17 also live, newer, in the legacy `canccuplatform` repo, and the manager plans disagree on event mode, alert DMs and the laptop's name.
10. **Weak write paths on the site:** one shared write secret for every bot write, compared by plain equality; trend-state writes need no auth; best-effort bot writes are dropped on failure with no retry or reconciliation, so vote counts can drift low; a site admin reset can wipe snapshots the screen reads.
11. **CSRF deferred** on admin routes while they were loopback-only.
12. **Hard-coded origin:** the screen accepts messages only from one fixed site origin.
13. **Ducking impossible with the relay's own player page,** and the YouTube embed lacks `origin=`.
14. **Single points:** one venue laptop runs signage and the planned relay; the bot to signage control path depends on the tailnet; the stats history freezes when the bot is down.
15. **Doc links that rot:** links into personal and private repos and a reference to a private chat; most `~/…` paths point at sibling clones.
16. **Time-bound plans:** the master plan and subplans target the spring 2026 event; the feature-freeze date was never set (left as "TBD").
17. **No TODO or FIXME markers** in the repo; the only "TBD" is that freeze date.

## Port recommendation

Targets use the roadmap's steps. "Drop" follows [0010](../decisions/0010-scope.md) unless said otherwise. The docs themselves are not imported ([0002](../decisions/0002-no-legacy-history-or-docs.md)); "port" below means the feature as the docs define it.

| Feature | Verdict | Reason | Target module | Roadmap step |
|---|---|---|---|---|
| O1–O3 plan index, editor workspace, sync loop | drop | The monorepo and AGENTS.md replace them | — | — |
| O4 plan structure rule | port with changes | Worth adding to the plan tier in AGENTS.md: questions with stated defaults and risks | — | any (process) |
| O5 feature-branch rule | done | Already in AGENTS.md | — | — |
| O6 to-do tagging | drop | Tool-specific | — | — |
| O7 docs-with-behaviour rule | port with changes | A line in AGENTS.md, step 5 (gap 16) | — | any (process) |
| O8 contract map | rewrite | `contracts/` and the event catalog replace it | all | 2c |
| O9 outside-bot workflow | drop | The dispatcher and AGENTS.md replace it | — | — |
| X1 scheduled signage | port as-is | Scheduler and windows are "port as-is" in the porting plan; add gaps 5–7 when the contract is written | screen | 3 |
| X2 PPTX rendering | port with changes | Separate render-job container | screen | 3 |
| X3 compositor and precedence | rewrite | Moments ranks takeovers, blocks and overlays from bus events; keep bands, TTL and `409` as the spec | moments, screen | 2c (#35), 4 |
| X4 no-blank fallback and Ready check | port with changes | Keep the last-frame and static-image rule (gap 4); the Ready message goes with the embed protocol (dropped) | screen | 3 |
| X5 bookmarks and ADVT breaks | port as-is | Playback timing and bookmarks are "port as-is"; fix the due-time quirk | screen | 3 |
| X6 ticker | port with changes | Manual only ([0010](../decisions/0010-scope.md)); poll ticker dropped with polls | moments, screen | 4, 9 |
| X7 announce | port with changes | An admin or bot action becomes a Moments takeover or overlay with a sound; the card look moves to the theme | moments, bot, ui | 4, 6 |
| X8 polls on screen | drop | Polls dropped ([0005](../decisions/0005-signup-site-stays-outside.md), 0010) | — | — |
| X9 hot-game banner | port with changes | Bot emits game events; Moments decides | bot, moments | 6, 9 |
| X10 cover art | port with changes | Steam fallback is "port as-is" in the bot; the site's chain goes with the site; IGDB only if wanted | bot | 6 |
| X11 stats view | port with changes | Bot stats as events; precompute aggregates, never on a polled read (gap 15) | bot, screen | 6, 9 |
| X12 tournament view and pin | port with changes | Tournament events ranked by Moments | tournament, moments | 7, 9 |
| X13 tournament automation | port with changes | Registration inside the module; tokens rewritten | tournament, bot | 7 |
| X14 photo carousel | port with changes | Bot uploads into tenant files; keep new-first, featured and Clear rules | bot, screen | 6, 9 |
| X15 photo spotlight | port with changes | A Moments takeover with a TTL | bot, moments | 6, 4 |
| X16 sound system | port with changes | Engine, categories, priority and cooldowns into Moments; the sound board (gap 9) into admin; cues from bus events instead of page messages | moments, admin | 4 |
| X17 tournament sound moments | rewrite | Source becomes tournament events, not the embedded page; once per event | tournament, moments | 7, 9 |
| X18 admin sign-in | drop (the link), rewrite (sessions) | Central Discord sign-in replaces the link; keep fail-closed admin, rate limits, session lifetimes (gap 2) and add break-glass access (gap 1) | admin, sign-in | 2b (#52) |
| X19 health and diagnostics | port with changes | Kit health; logs and metrics tagged with the tenant; retention (gap 11) | kit, admin | 1, 8 |
| X20 supervisor and kiosk launcher | drop | Containers on the VM; the projector PC runs a browser only | — | — |
| X21 backup and restore | port with changes | Off-VM backups and restore drills; add retention and checks (gap 12) | setup | 2b (#55), 10 |
| X22 PiSignage cutover | drop | Retired | — | — |
| X23 emergency takeover | port with changes | Moments' top band, with a defined sender and right (gap 8) | moments, admin | 4 |
| X24 admin live screen | port with changes | A silent mirror per zone in admin | screen, admin | 3 |
| X25 directive history, broken-video detection, console look | port with changes | History becomes the Moments log; detection stays in Screen; the look moves to `packages/ui` | moments, screen, ui | 3, 4, 10 |
| X26 site admin reset | drop | Site stays outside; a per-tenant reset belongs to the tenants lifecycle | — | — |
| X27 RSS feeds | drop | RSS ticker dropped (0010) | — | — |
| X28 stream service takeover | drop | Replaced by casting | — | — |
| X29 casting | port with changes | Relay placement open with a remote VM | cast | Cast track |
| X30 manager | port with changes | Alerts as events, ack, mute, restart policy; SSH catalogue and laptop reboot dropped | admin, bot | 8 |
| Cutover thresholds, burn-in | rewrite | Write them for the switch (gaps 13, 14) | — | 11 |

## Tenancy questions

What this repo implies for the tenancy design (#48). Each is a question for the tenants contract or a module contract; none is decided here.

**Global (platform, superadmin)**

1. The legacy system had one admin channel and one alert route for everything. Platform alerts (manager) and event alerts (an event's own screen or bot) need separate routes: which go to the superadmin only, which to a tenant's admins?
2. A break-glass way into admin (gap 1): is it superadmin-only and global, or can a tenant have its own?
3. Cover-art caches and the Steam lookup cache are about public game data. Global cache, or per tenant like every other cache (0013 item 7)?
4. Sound files: does the platform ship one default sound family that tenants override per cue, with the defaults global and the uploads per tenant?

**Per tenant (event)**

5. Everything the legacy kept per instance is per tenant: schedules, playlists, directives, ticker, carousel settings, sound settings, the Ready opt-in, the fallback image. Confirm that the sound log and directive history are tenant rows with their own caps.
6. Singletons: one carousel playlist, one active spotlight, one emergency, one stats-history blob. Confirm each is "one per tenant", and whether "one per zone" is needed for the carousel and spotlight once events have several zones.
7. The bot's admin role name, the allowed role ids and `EVENT_TIMEZONE` are bot settings per tenant (0013 items 14–18)?
8. Who may trigger an emergency takeover in a tenant (gap 8), and does an emergency cover all its zones at once?
9. Retention: sound log, directive history, logs (legacy 14 days), backups (7 daily, 4 weekly). Platform-wide numbers, or per-tenant settings within a platform maximum?

**Per venue**

10. The kiosk, its liveness check, the Ready fallback and the cast relay are per device or per venue. Kiosk liveness maps to Screen's device health (0013 item 34); does a venue-level setting remain for casting, which assumed a LAN hostname and "anyone on the LAN may cast"?
11. The venue PA and its levels: the sound check sets levels against one venue's PA. Are master volume and category levels a device (venue) property, kept across events at the same venue, or per tenant?
12. Time zone: the schedule uses the local time zone and the bot uses an event time zone. Is the time zone a venue property or a tenant setting?
13. Display resolution (gap 5) is a property of the device at a venue. Is it stored on the device row, and does a layout choose by it?

## Event-specific content

Named by kind and counted only; no value appears in this file. The location of each value is listed in the PR, for a follow-up issue in the event repo.

| Kind | Distinct values | Lines | Files |
|---|---|---|---|
| The signup site's domain (in URLs, the fixed origin, and as the site repo's name) | 1 | 235 | 27 |
| Venue laptop host name | 1 | 8 | 2 |
| Personal GitHub accounts (the legacy repo owner, the site maintainer), including links into their private repos | 2 | 27 | 6 |
| Personal first name (the site maintainer, also named as the sound designer) | 1 | 4 | 2 |
| Discord role names (the bot's admin role, an older admin role, the bot's own role) | 3 | 16 | 3 |
| Discord channel name (the admin channel) | 1 | 10 | 1 |
| Event date (the month of the spring 2026 event) | 1 | 2 | 2 |
| Event-year label (in 7 file names and many headings) | 1 | 86 | 13 |
| Event locale (time zone name, and its UTC offset in an example time) | 2 | 2 | 1 |
| Reference to a private chat | 1 | 1 | 1 |
| Discord ids, IP addresses (other than loopback and the any-address), MAC addresses, venue names | 0 | — | — |

Commit metadata (author names and emails) is not in any file and is not counted. Game titles and Steam app ids in the cover spec are public data, not event content. Menus, photos, sounds and other media: none in this repo.
