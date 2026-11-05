# Legacy inventory: canccubot

The Discord bot of the old system, inventoried for roadmap step 2a ([#46](../roadmap.md#2a-legacy-inventory)) so the product owner can confirm what exists before the tenancy foundation and the contracts are designed. Nothing here is copied from the legacy repo: code and docs are described, and only short identifiers (commands, routes, env var names, JSON keys) are named. Event-specific values are counted by kind only (see [Event-specific content](#event-specific-content)).

- **Source:** the read-only clone of `canccubot` on the dev VM, at its last commit of 2026-10-30. History: 201 commits from 2026-02-15 to 2026-10-30, mostly February–March and October 2026.
- **Stack:** Python 3.10+, discord.py 2.x, aiohttp (HTTP client and two small HTTP listeners), python-dotenv, python-dateutil. Tests use pytest with pytest-asyncio, and formatting uses black. A TypeScript Cloudflare Worker stub (`worker/`) is also in the repo, but it is not deployed.
- **Runs as:** one process per event (`python -m bot.main`), from a systemd unit as root in a Proxmox LXC. It is bound to one guild through `GUILD_ID` and configured entirely from `.env`.
- **Tests run for this inventory:** the unit suite on a temp copy, `pytest tests` → **496 passed, 5 skipped, 8 deselected** (the deselected 8 are the live integration tests, which are off by default). Line coverage of `bot/` is **73 %** (6175 statements).

## Contents
1. [What the bot is](#what-the-bot-is)
2. [Features](#features)
3. [Interfaces](#interfaces)
4. [Data](#data)
5. [Configuration](#configuration)
6. [External integrations](#external-integrations)
7. [Tests](#tests)
8. [Known problems](#known-problems)
9. [Port recommendation per feature](#port-recommendation-per-feature)
10. [Tenancy questions](#tenancy-questions)
11. [Event-specific content](#event-specific-content)
12. [Coverage](#coverage)

## What the bot is
canccubot is the event's Discord bot and also the glue between the old system's pieces:
- It **counts** guild activity (presence, voice occupancy, games played and message counts) every 30–60 s. It keeps the counts in memory and pushes them to the signup site's API, whose LAN display shows them.
- It **drives the venue screen** (canccusignage) through a control API. It sets full-screen "directives" (an announcement, a hot-game banner, a poll, the tournament leaderboard, finals cards) and the ticker overlay, and it uploads photos to the carousel.
- It is the **Discord face of the tournament and pizza features** of the signup site. It hands out personal links (tokens), sends reminders by DM, creates and cleans up per-game voice channels, and posts a dwell-based roster.
- It **posts the mini-tourney's seasons and champions** and mirrors the open season to the signup site.
- It **relays canccumanager alerts** to admins (DMs and a channel post with an Acknowledge button) and shows platform status.

The bot owns almost no durable data. Its own stores are in memory, plus two small JSON state files. Everything durable lives in the signup site's hosted database behind its API, which is a different repo (see [Data](#data)).

## Features
"Admin" means a member who has a role whose **name** equals `ADMIN_ROLE_NAME` (default `LAN Admin`). Replies are ephemeral unless noted. A feature that depends on optional config is loaded only when that config is set; the gate is shown in the "Reached by" column.

### User-visible features
| Feature | Where it lives | Reached by |
|---|---|---|
| Command help | `bot/cogs/help_cog.py` | `/help [command]` |
| Polls with button voting, a live poll on the screen, the poll line in the ticker and a full-screen result | `bot/cogs/polls.py`, `bot/services/poll_manager.py`, `bot/services/poll_ticker.py`, `bot/utils/formatters.py` | `/poll` (admin), `/poll-status`, vote buttons on the poll message |
| Tournament registration link | `bot/cogs/tournament.py`, `bot/services/tournament_manager.py` | `/tournament register`; needs `TOURNAMENT_CHANNEL_ID` |
| Tournament schedule, own registrations, leaderboard | `bot/cogs/tournament.py` | `/tournament schedule`, `/tournament my-registrations`, `/tournament leaderboard` |
| Tournament reminders by DM (registration closed, starting now) and a public "starts in 1 hour" post | `bot/services/tournament_manager.py` | Scheduled per tournament event |
| Tournament voice channels (a `Tournament` category with one channel per entry in the event's `vc_plan`) | `bot/services/tournament_discord_channels.py`, `tournament_manager.py` | Created at T−15 min or on "create now"; deleted on cleanup |
| Pizza order and orderer links | `bot/cogs/pizza.py` | `/pizza order`, `/pizza claim`; needs `TOURNAMENT_CHANNEL_ID` because the links reuse the tournament token |
| Mini-tourney announcements (new season, season started, champion) | `bot/cogs/tourney_watcher.py`, `bot/services/tourney_watcher.py` | Posts in the finals channel (or the test channel for seasons whose name starts with "test"); needs `FINALS_CHANNEL_ID` |
| On the venue screen (not in Discord): hot-game banner, poll views, tournament leaderboard pin, finals open/start cards, ticker, photo carousel, and the stats on the signup site's LAN display | See the operator features and the integrations below | Automatic |
| Casting | `bot/cogs/stream.py` | `/stream help/on/off/spotlight/auto/status`; every subcommand only answers "not available" |

### Operator features
| Feature | Where it lives | Reached by |
|---|---|---|
| Close, cancel or edit the active poll | `bot/cogs/polls.py`, `poll_manager.py` | `/poll-close`, `/poll-cancel`, `/poll-edit` (admin) |
| Screen announcement with a sound effect (`bell`, `fanfare`, `alert`, `cancel`) for N seconds; clear; hard reset to the scheduled content | `bot/cogs/signage.py`, `bot/services/signage_state.py`, `display_control.py` | `/signage-announce`, `/signage-clear`, `/signage-reset` (admin); needs the signage control URL and token |
| Manual ticker: set lines with a TTL, stop, status | `bot/cogs/ticker.py`, `bot/services/ticker_ops.py` | `/ticker set`, `/ticker stop`, `/ticker status` (admin); needs signage control or an RSS port |
| Scheduled ticker windows (start/end local time) | `bot/cogs/ticker.py`, `bot/services/ticker_schedule.py` | `/ticker schedule add/list/remove` (admin) |
| Ticker as RSS 2.0 feed | `bot/services/ticker_rss.py`, `ticker_rss_server.py` | `GET <TICKER_RSS_PATH>` when `TICKER_RSS_PORT` > 0 |
| Photo carousel: add a message's images, add and show now, showcase a single image (temporary pin), remove | `bot/cogs/photo_carousel.py`, `bot/services/canccusignage_carousel.py`, `carousel_photo_naming.py` | Message context menus (admin); needs the carousel token |
| Hot-game banner: when ≥ threshold members play the same game, pin a banner for a while, then cool down | `bot/services/game_detector.py`, `trigger_settings.py` | Automatic every `GAME_INTERVAL`; the thresholds come from signage's trigger settings, or from env as a fallback |
| Tournament admin link | `bot/cogs/tournament.py` | `/tournament admin` (admin) |
| Tournament event add, remove, list and wipe all data (with a confirm step) | `bot/cogs/tournament.py`, `tournament_manager.py` | `/tournament add`, `/tournament remove`, `/tournament list`, `/tournament clear` (admin) |
| Tournament automation from the site admin: start scoring (posts the dwell roster), cleanup, create VCs now, reschedule on schedule changes | `tournament_manager.py`, `tournament_dwell.py` | Polls the site every 5 s (pending work) or 60 s (idle) |
| Tournament leaderboard pin on the screen, from T−15 to T+10 | `tournament_manager.py` | Scheduled |
| Finals season open/start takeover cards | `bot/cogs/finals_cards.py`, `bot/services/finals_cards.py` | Polls the site's display state every 30 s; needs signage control |
| Finals season summary mirrored to the site's pulse strip | `bot/services/tourney_watcher.py` | Every watcher sync |
| Signage admin login link (HMAC, single use, 5 min) | `bot/cogs/admin_link.py`, `bot/utils/admin_link.py` | `/adminlink` (admin); needs the HMAC secret, the instance id and an admin URL |
| Platform status from canccumanager | `bot/cogs/platform.py`, `bot/alerts.py` (`ManagerClient`) | `/platform status [subsystem]` (admin) |
| Manager alerts to admins: DMs and a channel post, each with an Acknowledge button | `bot/alerts.py` | `POST /alert` from canccumanager |
| Manager heartbeat watcher: DMs when the heartbeat is stale and when it recovers | `bot/alerts.py` | Every 60 s; stale after 180 s |
| Bot health for the platform | `bot/services/health_server.py` | `GET /healthz` when `HEALTH_PORT` > 0 |
| Activity stats in the log (peak online, top game, banner state) | `bot/main.py` | Every 5 min |
| Roster nick backfill (one-off repair of raw ids in a stored roster) | `bot/services/roster_nick_backfill.py`, `scripts/backfill_roster_nicks.py` | CLI with `ADMIN_TOKEN` in env |

## Interfaces

### Discord slash commands (34) and context menus (4)
All are registered **per guild**: at start-up the bot copies its global tree to `GUILD_ID` and syncs it. Admin checks are made in the handler; Discord's default permissions are not used.

| Command | Parameters | Who | Effect |
|---|---|---|---|
| `/help` | `command?` | all | Lists the commands, or the usage of one command |
| `/poll` | `question`, `option1`, `option2`, `option3`–`option10?`, `duration?` (s, default 300), `highlight_seconds?`, `result_seconds?` | admin | Creates the single active poll: a message with buttons, plus the screen and ticker |
| `/poll-status` | – | all | Says whether a poll is active and how much time is left |
| `/poll-close` | – | admin | Closes the poll and posts the results |
| `/poll-cancel` | – | admin | Cancels the poll without results |
| `/poll-edit` | `question?`, `duration?` | admin | Edits the active poll |
| `/signage-announce` | `message`, `sfx?` (bell/fanfare/alert/cancel), `duration?` | admin | Full-screen announcement, with auto-revert |
| `/signage-clear` | – | admin | Clears the bot directive and reverts |
| `/signage-reset` | – | admin | Hard reset: clears every bot directive so the schedule resumes |
| `/adminlink` | – | admin | Single-use signage admin login URL |
| `/platform status` | `subsystem?` (5 fixed choices) | admin | Overview, or one subsystem's checks and last 5 events |
| `/pizza order` | – | all | Link button to the pizza page (`<site>/pizza?token=`) |
| `/pizza claim` | – | all | Link button to the orderer page (`<site>/pizza/orderer?token=`) |
| `/stream help`, `on`, `off`, `spotlight`, `auto`, `status` | – | all | Stubs that answer "not available" |
| `/ticker set` | `content` (one segment per line), `ttl_seconds?` (1–7200) | admin | Ticker on the screen and/or RSS |
| `/ticker stop` | – | admin | Clears the ticker |
| `/ticker status` | – | admin | Targets, current lines, TTL, schedules |
| `/ticker schedule add` | `start`, `end` (`YYYY-MM-DD HH:MM`, event timezone), `content` | admin | Schedules a window |
| `/ticker schedule list` | – | admin | Lists the windows |
| `/ticker schedule remove` | `schedule_id` | admin | Cancels a window |
| `/tournament register` | – | all | Personal registration link (token, 7 days) |
| `/tournament schedule` | – | all | Events by day, with counts and status |
| `/tournament my-registrations` | – | all | The caller's registrations |
| `/tournament leaderboard` | – | all | Points table |
| `/tournament admin` | – | admin | Admin page link (admin token, 7 days) |
| `/tournament add` | `game_name`, `datetime_str` (`YYYY-MM-DD HH:MM`, event timezone), `link?` | admin | Creates an event; registration closes `REGISTRATION_CLOSE_MINUTES` before the start |
| `/tournament remove` | `event_id` | admin | Deletes the event and its registrations |
| `/tournament list` | – | admin | Admin overview |
| `/tournament clear` | – | admin | Confirm/Cancel buttons, then wipes all tournament data |

Message context menus (admin only): **Add to photo carousel**, **Add to carousel and show now**, **Showcase photo**, **Remove from photo carousel**.

Components:
- **Poll option buttons** (`custom_id` `poll_<poll>_option_<option>`): votes; one vote per user, which can be changed.
- **Acknowledge** on alerts: a persistent `DynamicItem` with `custom_id` `alert_ack:<eventId>`. It posts the ack to the manager as `discord:<user id>`.
- **Clear confirm/cancel** buttons (120 s, only the requester can use them).
- **Link buttons** that carry the personal URLs.

### Discord gateway event handlers
| Handler | Where | Does |
|---|---|---|
| `setup_hook` | `main.py` | Loads the cogs, the RSS and health listeners, the alert watcher and trigger settings; syncs commands to the guild |
| `on_ready` | `main.py` | Checks the site's health, hydrates the active poll from the site, starts the trackers, schedules tournament reminders and starts the schedule poll |
| `on_message` | `main.py` | Counts the message for the top-chatter stats (author id and display name only; bots and DMs skipped) |
| `on_voice_state_update` | `cogs/tournament.py` | Feeds the tournament VC dwell tracker |
| `on_error` | `main.py` | Logs |

Gateway **intents**: default plus `members`, `presences` (both privileged), `message_content` (privileged, and **not used**: no code reads message text), and `voice_states`.

Discord **permissions** used: send messages and embeds in the configured channels, DM members, manage channels (category and voice channels), move members (to disconnect before a VC is deleted), and read message attachments (carousel).

### HTTP routes served by the bot
| Method and path | Listener | Auth | Request | Response |
|---|---|---|---|---|
| `GET /healthz` | `HEALTH_HOST:HEALTH_PORT` (off by default) | none | – | `{status: ok\|degraded\|down, version, uptimeSeconds, checks: [{name: discord\|api\|signage, status, message?}]}`; 503 when down, `Cache-Control: no-store` |
| `POST /alert` | same listener, only when `MANAGER_ALERT_TOKEN` is set | `Authorization: Bearer <MANAGER_ALERT_TOKEN>` | `{eventId: int, subsystem, since, link: string, state: ok\|degraded\|down, failingCheck: string\|null}` | `{dms, posted}`; 401 `unauthorized`, 400 `invalid_body`, 502 `undeliverable` (`{error: {code, message}}`) |
| `GET <TICKER_RSS_PATH>` (default `/ticker.rss`) | `TICKER_RSS_HOST:TICKER_RSS_PORT` (off by default) | none, public | – | RSS 2.0 with one item per ticker line (or a filler item) |
| `GET /api/health` | `worker/` stub, **not deployed** | none | – | `{status: "ok"}` |

### HTTP calls made by the bot
**The signup site's API** (`API_URL`, `Authorization: Bearer <API_SECRET>`, 10 s timeout). Every call is best effort: a failure is logged and returns nothing.

| Method and path | Body or result | Used by |
|---|---|---|
| `GET /api/health` | → `{status: "ok"}` | Start-up, `/healthz` |
| `POST /api/polls` | `{question, options[], created_by, expires_at}` → poll with option ids | Polls |
| `PATCH /api/polls/:id` | `{message_id}` | Polls |
| `POST /api/polls/:id/votes` | `{user_id, option_id}` | Polls |
| `POST /api/polls/:id/close` | `{}` | Polls |
| `GET /api/polls/active` | → active poll (hydrated at start-up) | Polls |
| `POST /api/snapshots/presence` | `{timestamp, online_count, idle_count, dnd_count}` | Presence, every 60 s |
| `POST /api/snapshots/voice` | `{timestamp, channels: [{channel_name, user_count}]}` (occupied channels only) | Voice, every 30 s |
| `POST /api/snapshots/game` | `{timestamp, games: [{game_name, user_count, application_id?, cover_image_url?}]}` | Games, every 30 s |
| `POST /api/display/stats-history` | `{statsHistory: {presenceHourly, presenceDaily, voicePeakHourly, voicePeakDaily, gamesTop96h}, computed_at?}` | Stats publisher, every 300 s |
| `POST` and `DELETE /api/display/announce` | `{message, sfx}` | `/signage-announce` |
| `GET /api/display/state?finals_registration_min&finals_started_min` | → `{success, data: {finals: {phase, seasonId, name, createdAt, startedAt}}}` | Finals cards |
| `PUT` and `DELETE /api/display/finals` | `{seasonId, name, state, format, mode, createdAt, startedAt, capacity, registered, link}` | Tourney watcher |
| `GET` and `POST /api/tournament/internal/token` | `?user_id=` → `{token}`; `{token, user_id, username, discord_user_id, discord_username, expires_at}` | Registration and pizza links |
| `GET` and `POST /api/tournament/internal/admin-token` | same shape | `/tournament admin` |
| `GET /api/tournament/events` | → `{events: [{id, game_name, starts_at, registration_closes_at, status, created_by, registrant_count, event_link?, vc_plan?, vc_created?, vc_channel_ids?, vc_cleaned?, cleanup_requested?, create_now_requested?, scoring_started?, roster_ready?}]}` | Schedule, reminders, the poll loop |
| `POST /api/tournament/events` | `{game_name, starts_at, registration_closes_at, created_by, event_link?}` | `/tournament add` |
| `DELETE /api/tournament/events/:id` | – | `/tournament remove` |
| `PATCH /api/tournament/events/:id/status` | `{status: open\|closed\|started}` | Reminders |
| `GET /api/tournament/events/:id/registrants` | → `{registrants: [{discord_user_id\|null, discord_username}]}` | DMs, roster |
| `PATCH /api/tournament/events/:id/vc` | `{vc_created: true, vc_channel_ids: {name: id}}`; 409 = already set | VC create-once |
| `PATCH /api/tournament/events/:id/cleanup` | `{vc_cleaned: true}`; 409 counts as success | VC cleanup ack |
| `PATCH /api/tournament/events/:id/create-now` | `{create_now_requested: false}` | Debug create-now |
| `POST /api/tournament/events/:id/roster` | `{channels, assignments: [{discord_user_id, discord_username, channel, dwell_seconds, tie}], leftovers: {registered_not_qualified, present_not_registered}}`; 409 = event cancelled | Start scoring |
| `GET` and `PATCH /api/tournament/events/:id/roster` | `{present_not_registered: [{discord_user_id, discord_username}]}`; the GET needs an admin token | Nick backfill script |
| `GET /api/tournament/leaderboard` | → `{leaderboard: [{discord_username, total_points, events_played}]}` | `/tournament leaderboard` |
| `GET /api/tournament/internal/users/:id/registrations` | → registrations | `/tournament my-registrations` |
| `DELETE /api/tournament/internal/clear` | – | `/tournament clear` |

**canccusignage** (`CANCCUSIGNAGE_CONTROL_URL`):

| Method and path | Auth | Body | Used by |
|---|---|---|---|
| `POST /api/control/override` | Bearer control token | `{source: "bot", kind: web\|asset\|stream, label, target, message?, ttlSeconds?}`; a repeat POST is a keepalive; 409 = rejected (busy) | All screen takeovers |
| `POST /api/control/override` (ticker) | same | `{source: "bot", label: "ticker", message, ttlSeconds?, pollExpiresAt?}`; an empty message clears | Ticker, poll line |
| `DELETE /api/control/override[?label=]` | same | – | Revert, one label or all bot rows |
| `GET /api/control/override` | same | → active directives | Reset, tests |
| `GET /api/control/triggers` | same, 2 s timeout | → `{ok, gameThreshold, testMode, bannerDisplaySeconds, bannerCooldownSeconds, pollHighlightSeconds, pollResultSeconds, announceDefaultSeconds, finalsOpenSeconds?, finalsStartSeconds?}` | Trigger settings |
| `GET /api/healthz` | none | – | `/healthz` reachability check |
| `POST /api/carousel/photos` | Bearer **carousel** token | multipart: `photos` (files), `messageId`, `channelName`, `authorDisplayName`, `postedAt` | Add to carousel |
| `DELETE /api/carousel/photos?messageId=` | carousel token | – | Remove |
| `POST /api/carousel/spotlight` | carousel token | JSON `{assetId}` (show now), or multipart with one photo (showcase); 409 `screen_busy` | Show now, showcase |

The directive labels (one row per label on signage) are `announce`, `poll_active`, `poll_result`, `hot_game`, `tournament`, `finals_open`, `finals_start` and `ticker`. A `web` target is a URL on the signup site's LAN-display page with `?view=` set to `announce`, `active_poll`, `poll_result`, `game_banner`, `tournament_leaderboard`, `finals_open` or `finals_start`, plus parameters (`sfx`, `msg`, `season_id`, `season_name`, `window_end`, …).

**canccumanager** (`MANAGER_URL`; `Authorization: Bearer <MANAGER_TOKEN>`, `X-Caller: discord:<id>` or `discord:bot`):
- `GET /api/status` and `GET /api/subsystems/<name>`, used by `/platform status`.
- `POST /api/events/<id>/ack`, sent by Acknowledge.
- `GET /api/heartbeat` → `{at}`, used by the watcher.

According to the bot's own comments, the ack and heartbeat endpoints were not yet shipped by the manager.

**Mini-tourney** (`TOURNEY_BASE_URL`, no auth):
- `GET /api/seasons` and `GET /api/seasons/:id` (season, teams or individuals, capacity).
- **SSE** `GET /api/events`: every `data: update` line triggers a re-sync. It reconnects with a backoff from 5 to 60 s, and a 60 s poll runs as a backstop.

**Steam store** (no auth): `GET /api/storesearch/` and `GET /api/appdetails`. These find a game's header image when Discord gives no cover. Results are cached in memory for 7 days (a hit) or 1 hour (a miss).

### WebSocket and SSE channels, bus events
- **Served:** none. **Consumed:** the Discord gateway (WebSocket, through discord.py) and the mini-tourney SSE stream above.
- **Bus events:** none. There is no message bus: the bot pushes over HTTP and polls the site and signage. The ports in the platform would replace each push and poll with a bus event (see [Port recommendation](#port-recommendation-per-feature)).

### Scheduled and background jobs
| Job | Interval or trigger | Where |
|---|---|---|
| Presence snapshot | `PRESENCE_INTERVAL` (60 s) | `presence_tracker.py` |
| Voice snapshot | `VOICE_INTERVAL` (30 s) | `voice_tracker.py` |
| Game snapshot, Steam cover lookup, hot-game banner episode | `GAME_INTERVAL` (30 s, wall-clock aligned) | `game_detector.py` |
| Stats history build and push | `STATS_HISTORY_PUBLISH_SECONDS` (300 s, after a 15 s delay) | `stats_history.py` |
| Stats log line | 300 s | `main.py` |
| Tournament schedule poll: cleanup, create-now, scoring flags, reschedule on change | 5 s while work is pending, else 60 s | `tournament_manager.py` |
| Per tournament event: "starts in 1 h" post at T−60, close at `registration_closes_at` (status and DMs), start at T (status and DMs), T−15 VC create and screen pin until T+10, cleanup backstop at T+3 h | One-shot asyncio tasks, rebuilt at start-up and on every schedule change | `tournament_manager.py` |
| Finals card sync | 30 s | `cogs/finals_cards.py` |
| Tourney watcher sync | 60 s and on SSE `update` | `cogs/tourney_watcher.py` |
| Manager heartbeat check | 60 s | `alerts.py` |
| Ticker schedule windows | One-shot tasks at start and end | `ticker_schedule.py` |
| Poll expiry, highlight phase, ticker refresh (15 s) and a vote-debounced refresh (2 s) | Per poll | `poll_manager.py` |
| Signage auto-revert | Per announcement | `signage_state.py` |

## Data
The bot has **no database**. The stores below are everything it keeps; "per event" means it would belong to one tenant on the shared stack.

| Store | Keys or columns | Scope | Retention |
|---|---|---|---|
| `MemoryStore` polls | poll `{id, question, created_by, created_at, expires_at, status, message_id, channel_id, api_poll_id}`, options `{id, poll_id, label, api_option_id}`, votes `{poll_id: {user_id: option_id}}`, last closed poll | Per event | Process lifetime; the active poll is re-read from the site at start-up |
| `MemoryStore` presence snapshots | `{timestamp, online_count, idle_count, dnd_count}` | Per event (guild) | Pruned to `RETENTION_HOURS` (96 h); lost on restart |
| `MemoryStore` voice snapshots | `{timestamp, channel_name, user_count}` | Per event | 96 h; lost on restart |
| `MemoryStore` game snapshots | `{timestamp, game_name, user_count, interval_seconds}` | Per event | 96 h; lost on restart |
| `MemoryStore` messages | per-user `message_counts`, the `nicks` (user id → display name) and message events `{timestamp, user_id}` | Per event; **personal data** | The events are pruned to 96 h; counts and nicks are **never pruned** until restart |
| `MemoryStore` ticker | items `[{title, description}]`, signage TTL, schedules `{id, start_at, end_at, items, created_by}` | Per event | Lost on restart, including scheduled windows |
| `TournamentMemoryStore` | tokens, admin tokens, events, registrations, roster flags | Per event | Used only when `API_URL` is unset (tests and local runs) |
| Dwell tracker | event id → channel → user id → seconds; channel id → name | Per event | In memory; after a restart, tracking resumes from the event's create-once flag, but open segments are lost |
| Hot-game state, cooldowns, signage mode, admin-ping throttle, Steam cover cache | in memory | Per event (the Steam cache could be global) | Process lifetime |
| `data/tourney_watcher.json` | `{seasons: [id], champions: [id], started: [id]}` (written via a temp file) | Per event | Kept for good |
| `data/finals_cards.json` | `{seasonId, phase, shown, ended}` | Per event | Kept for good |
| `logs/canccubot.log` | log lines (user ids, usernames, game names) | Per event | No rotation in the app |
| `worker/migrations/0001_initial_schema.sql`, `0002_add_indexes.sql` | **empty** (one comment line each) | – | – |

**Durable data lives elsewhere.** Polls, votes, the presence, voice and game snapshots, stats history, the announce state, the finals summary, and all tournament data (tokens, admin tokens, events, registrations, statuses, the VC flags and channel ids, rosters, scores and the leaderboard) are kept by the signup site's API in its hosted database. That database belongs to the signup-site inventory. The bot only sees the shapes in the [HTTP calls](#http-calls-made-by-the-bot) above.

**Venue rather than event:**
- signage's trigger settings, which the bot's own comments call "venue-editable" (game threshold, banner, poll and finals card durations);
- the signage control URL and the venue display itself;
- the "on the venue network only" wording of the mini-tourney link;
- the event timezone (it follows the venue's location).

The guild, channels, admin role and Discord users belong to the organizer's community, not to a venue.

## Configuration
Everything comes from environment variables (`bot/config.py`, which loads `.env` from the working directory and then from the install root). Only `DISCORD_TOKEN` and `GUILD_ID` are required. Secret values are not given here.

| Variable | Default | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | required | Bot token (secret) |
| `GUILD_ID` | required | The one guild the bot serves and syncs commands to |
| `ADMIN_ROLE_NAME` | `LAN Admin` | Role **name** that grants admin commands |
| `GAME_DETECTION_ENABLED`, `PRESENCE_TRACKING_ENABLED`, `VOICE_TRACKING_ENABLED`, `MESSAGE_TRACKING_ENABLED` | `true` | Feature toggles for the trackers |
| `PRESENCE_INTERVAL`, `VOICE_INTERVAL`, `GAME_INTERVAL` | 60, 30, 30 | Snapshot intervals (s) |
| `GAME_THRESHOLD` | 4 | Players needed for the hot-game banner (≥ 2, or ≥ 1 in test mode); a signage setting overrides it |
| `GAME_BANNER_DISPLAY_SECONDS`, `GAME_BANNER_COOLDOWN_SECONDS` | 120, 900 | Banner episode length and per-game cooldown |
| `GAME_BANNER_TEST_MODE` | `false` | Allows a threshold of 1 |
| `MAX_POLL_OPTIONS`, `MIN_POLL_DURATION`, `MAX_POLL_DURATION` | 10, 30, 3600 | Poll limits |
| `RETENTION_HOURS` | 96 | In-memory snapshot window |
| `STATS_HISTORY_PUBLISH_SECONDS` | 300 | Stats history push interval |
| `EVENT_COUNTDOWNS_JSON` | `[]` | Parsed but **never used** |
| `API_URL`, `API_SECRET` | unset | Signup site API base and its bearer token (secret); unset = no site calls, and tournament uses the in-memory store |
| `TOURNAMENT_CHANNEL_ID` | unset | Enables tournament and pizza; public posts and admin pings go here |
| `FRONTEND_URL` | an event-domain URL | Tournament site base for the links; its origin is used for the pizza links |
| `FINALS_CHANNEL_ID`, `FINALS_TEST_CHANNEL_ID` | unset | Enable the tourney watcher; target channels |
| `TOURNEY_BASE_URL` | the internal mini-tourney host on port 3000 | Mini-tourney API |
| `TOURNEY_PUBLIC_URL` | an event-domain URL | Link in the announcements |
| `TOURNEY_WATCHER_STATE_PATH`, `FINALS_CARD_STATE_PATH` | `data/tourney_watcher.json`, `data/finals_cards.json` | JSON state files |
| `FINALS_REGISTRATION_MIN`, `FINALS_STARTED_MIN` | 15, 10 | Finals card windows (min) |
| `TOKEN_EXPIRY_DAYS` | 7 | Registration token lifetime (admin tokens are hard-coded to 7 days) |
| `REGISTRATION_CLOSE_MINUTES` | 30 | Close offset for `/tournament add` |
| `EVENT_TIMEZONE` | the event's IANA zone | Parses and shows local times |
| `TOURNAMENT_SCHEDULE_POLL_SECONDS` | 30 | Fixed poll interval: legacy, unused in production |
| `TOURNAMENT_POLL_ACTIVE_SECONDS`, `TOURNAMENT_POLL_IDLE_SECONDS` | 5, 60 | Adaptive schedule poll |
| `TOURNAMENT_DWELL_SECONDS` | 600 | Cumulative VC time to qualify for the roster |
| `TOURNAMENT_CLEANUP_BACKSTOP_HOURS` | 3 | VC cleanup after the start if nobody cleaned up |
| `TOURNAMENT_CLEANUP_ACK_PING_COOLDOWN_SECONDS` | 600 | Throttle on admin pings when the cleanup ack fails |
| `LAN_DISPLAY_URL` | an event-domain URL | Base of the LAN-display page used as directive targets |
| `POLL_RESULT_DISPLAY_SECONDS`, `POLL_HIGHLIGHT_SECONDS`, `POLL_TICKER_REFRESH_SECONDS` | 180, 60, 15 (min 5) | Poll screen timings |
| `ANNOUNCE_DEFAULT_SECONDS` | 60 | Announcement duration fallback |
| `CANCCUSIGNAGE_CONTROL_URL`, `CANCCUSIGNAGE_CONTROL_TOKEN` | unset | Signage control API and bearer token (secret) |
| `CANCCUSIGNAGE_CONTROL_ENABLED` | `true` | Kill switch for control |
| `CANCCUSIGNAGE_CAROUSEL_TOKEN` | unset | Carousel bearer token (secret) |
| `DISCORD_LOGIN_LINK_HMAC_SECRET` | unset | HMAC key for `/adminlink` (secret) |
| `SIGNAGE_INSTANCE_ID` | unset | `instance_id` claim in the admin link |
| `SIGNAGE_ADMIN_URL` | the control URL | Browser-reachable signage admin base |
| `TICKER_RSS_PORT`, `TICKER_RSS_HOST`, `TICKER_RSS_PATH` | 0 (off), `0.0.0.0`, `/ticker.rss` | RSS listener |
| `TICKER_RSS_CHANNEL_TITLE`, `TICKER_RSS_CHANNEL_DESCRIPTION`, `TICKER_RSS_PUBLIC_URL`, `TICKER_RSS_CHANNEL_LINK` | `LAN Ticker`, `LAN event ticker`, unset, unset | RSS channel metadata |
| `HEALTH_PORT`, `HEALTH_HOST` | 0 (off), `127.0.0.1` | Health and alert listener |
| `BOT_VERSION` | `unknown` | Reported by `/healthz` |
| `MANAGER_URL`, `MANAGER_TOKEN` | unset | canccumanager API and bearer token (secret) |
| `MANAGER_ALERT_TOKEN` | unset | Token the manager sends to `POST /alert` (secret) |
| `MANAGER_ALERT_DM_USERS` | empty | Discord user ids for alert DMs (comma-separated) |
| `MANAGER_ALERT_CHANNEL_ID` | unset | Admin channel for alert posts |
| `BOT_TICKER_TTL_SECONDS` | 1800 (clamped to 1–7200) | Default `/ticker set` TTL |
| `LOG_LEVEL`, `LOG_FILE` | `INFO`, `logs/canccubot.log` | Logging |
| `ADMIN_TOKEN` | unset | Backfill script only: a site admin token (secret) |
| `INTEGRATION_CANCCUSIGNAGE_URL`, `INTEGRATION_CANCCUSIGNAGE_TOKEN`, `INTEGRATION_LAN_DISPLAY_URL` | fall back to the variables above | Live integration tests only |

Other config files:
- `.env.example` and `deployment/configs/environment.example`: examples with placeholders and event-domain URLs in comments.
- `worker/wrangler.toml`: Worker name and a placeholder `API_SECRET` in `[vars]`.
- `pyproject.toml`: the package and the pytest markers `integration` and `tailscale`; integration tests are deselected by default.

## External integrations
| Integration | What the bot needs | Notes |
|---|---|---|
| Discord | A bot token; one guild; the privileged intents `members` and `presences` (and `message_content`, unused); permissions to send, embed, DM, manage channels, move members and read attachments; a role named like `ADMIN_ROLE_NAME`; channel ids for tournament, finals, finals test and alerts | Commands are synced per guild at every start |
| The signup site's API (Cloudflare Worker with a hosted database, in another repo) | `API_URL` and a shared bearer secret; the routes above | The bot polls it; the site never calls the bot (legacy ADR 0001: the bot runs behind NAT) |
| The signup site's LAN-display page | Its URL (`LAN_DISPLAY_URL`), used as the target for screen directives | The screen loads that page; the bot only builds URLs |
| canccusignage | Control URL, control token, carousel token, an HMAC secret and instance id for admin links | Override rows keyed by `source`+`label`; the trigger settings live there |
| canccumanager | URL, a bot→manager token, a manager→bot token, DM user ids, an alert channel | The ack and heartbeat endpoints were not yet live |
| Mini-tourney (thefinals_mini_tourney) | Base URL on the internal network; no auth; SSE | Read only |
| Steam store web API | Outbound HTTPS; no key | Cover-image fallback |
| Files and media | Downloads Discord image attachments (png, jpg, gif, webp) and re-uploads them to signage. Writes two JSON files and a log file locally. Sounds are named only (`bell`, `fanfare`, `alert`). | The bot keeps no media |
| Devices | None directly: the venue screen is reached only through signage | – |
| Host | Proxmox LXC, Python venv, a systemd unit running as root, `/opt/canccubot/.env`; private-network hostnames for the other services | Scripts `setup_lxc.sh`, `deploy.sh`, `update.sh` |

## Tests
- **Setup:** pytest with `asyncio_mode = auto` and `pythonpath = bot, tests`. CI (`.github/workflows/ci.yml`) runs `black --check`, `pytest tests/bot` on Python 3.10, and the Worker's vitest.
- **Fixtures:** `tests/conftest.py` builds a fake config, a mock bot and an in-memory store.
- **Live tests:** the integration tests need a live signage dev stack and are deselected unless asked for.
- **Result:** run for this inventory: 496 passed, 5 skipped (the dev-URL guard tests without integration env), 8 deselected.

| Test file | Tests | Covers |
|---|---|---|
| `tests/bot/test_admin_link.py` | 4 | HMAC link signer and the `/adminlink` cog |
| `tests/bot/test_alerts.py` | 10 | `POST /alert` fan-out, the ack round-trip, the heartbeat watcher |
| `tests/bot/test_api_client.py` | 27 | Site API client: paths, payloads, the disabled no-op, errors |
| `tests/bot/test_canccusignage_carousel.py` | 15 | Carousel upload, remove, spotlight and showcase client |
| `tests/bot/test_canccusignage_control.py` | 13 | Control client: directives, ticker, triggers parsing |
| `tests/bot/test_canccusignage_control_409.py` | 4 | Hot-game 409 handling and episode dedup |
| `tests/bot/test_carousel_photo_naming.py` | 10 | Upload filenames and metadata |
| `tests/bot/test_config.py` | 7 | Env loading and derived properties |
| `tests/bot/test_display_control.py` | 4 | Directive and URL helpers |
| `tests/bot/test_event_tracking.py` | 8 | Message counts, time series, game duration, last closed poll |
| `tests/bot/test_finals_cards.py` | 9 | Finals card watcher (show, end, TTL, restart state) |
| `tests/bot/test_formatters.py` | 6 | Poll and stats embeds |
| `tests/bot/test_game_detection.py` | 15 | Game counting, banner episodes, cooldown, cover choice |
| `tests/bot/test_game_play_duration.py` | 5 | Time-weighted play duration |
| `tests/bot/test_health_server.py` | 11 | `/healthz` checks and status codes |
| `tests/bot/test_help_cog.py` | 4 | `/help` listing and per-command help |
| `tests/bot/test_memory_store.py` | 18 | `MemoryStore` against the storage interface |
| `tests/bot/test_photo_carousel_cog.py` | 16 | Context-menu flows, admin check, busy screen |
| `tests/bot/test_pizza_cog.py` | 4 | `/pizza` links |
| `tests/bot/test_platform_cog.py` | 9 | `/platform status` formatting and the unreachable case |
| `tests/bot/test_poll_ticker.py` | 7 | Poll ticker line formatting |
| `tests/bot/test_polls.py` | 21 | Poll manager lifecycle and storage |
| `tests/bot/test_polls_cog.py` | 5 | Poll command admin and no-poll flows |
| `tests/bot/test_roster_nick_backfill.py` | 4 | Backfill PATCH seam and name resolution |
| `tests/bot/test_signage_cog.py` | 9 | Announce, clear and reset flows |
| `tests/bot/test_signage_state.py` | 13 | Mode tracking and auto-revert |
| `tests/bot/test_stats_history.py` | 7 | Stats history aggregation and publish |
| `tests/bot/test_steam_cover.py` | 7 | Steam search, appdetails, cache |
| `tests/bot/test_stream_cog.py` | 3 | `/stream` stubs |
| `tests/bot/test_ticker_cog.py` | 6 | Ticker helpers and command wiring |
| `tests/bot/test_ticker_ops.py` | 7 | Ticker delivery to RSS and signage |
| `tests/bot/test_ticker_rss.py` | 6 | RSS XML builder |
| `tests/bot/test_ticker_rss_server.py` | 1 | RSS HTTP handler |
| `tests/bot/test_ticker_schedule.py` | 4 | Scheduled ticker windows |
| `tests/bot/test_tournament_api_client.py` | 7 | VC and roster calls against a fake site |
| `tests/bot/test_tournament_cog.py` | 20 | `/tournament` commands |
| `tests/bot/test_tournament_discord_channels.py` | 7 | VC naming, create and reuse, name clash |
| `tests/bot/test_tournament_dwell.py` | 5 | Dwell tracking and the roster |
| `tests/bot/test_tournament_manager.py` | 39 | Tokens, reminders, T−15, scoring, cleanup, backstop, the poll loop |
| `tests/bot/test_tournament_memory_store.py` | 20 | In-memory tournament backend |
| `tests/bot/test_tourney_watcher.py` | 17 | Announcements, restart safety, test-channel routing, summary push |
| `tests/bot/test_trigger_settings.py` | 15 | Trigger fetch, fallback, validation, precedence |
| `tests/bot/test_validators.py` | 16 | Admin role, poll validation, durations, game names, links |
| `tests/bot/test_voice_tracker.py` | 2 | Voice snapshot (occupied channels only) |
| `tests/integration/test_canccusignage_live.py` | 8 | Live directives, ticker and revert against a signage dev stack |
| `tests/integration/test_dev_guard.py` | 2 | Refuses non-dev URLs in the integration tests |
| `tests/worker/test_api.ts` | 1 | Worker stub health route |

Support files without tests: `tests/conftest.py`, `tests/integration/__init__.py`, `conftest.py`, `signage_client.py` and `url_guard.py`.

**Gaps that matter for the port:**
- `bot/main.py` (start-up wiring, cog loading, guild sync, `on_message`) has **0 %** coverage.
- The two polling cogs, `cogs/finals_cards.py` and `cogs/tourney_watcher.py` (including the SSE reconnect loop), have 0 %.
- `presence_tracker.py` has 25 %, with no own test file. `voice_tracker.py` has 58 % and `ticker_rss_server.py` 51 %.
- `cogs/ticker.py` has 44 %, and `cogs/polls.py` and `help_cog.py` 52 % each.
- No test covers a restart (what is lost from memory), several guilds, or rights by role id.
- Everything against Discord is mocked; there is no contract test against the real site API (it is in another repo).

The well-tested pure parts are the best port candidates:
- tournament manager, dwell, channels (77–91 %);
- game detector (86 %), stats history (83 %), Steam cover (86 %);
- tourney watcher service (93 %), finals cards service (91 %);
- trigger settings (96 %), memory store logic (91 %).

## Known problems
From the code:
1. **All bot-side state is in memory.** A restart loses the following:
   - the 96 h stats buffers, so the published stats history shows a gap;
   - message counts;
   - ticker lines and **scheduled ticker windows**;
   - open dwell segments;
   - hot-game cooldowns.
2. **Admin is a role name match.** Anyone who can create a role with that name gets every admin command. No role id is checked, and no Discord permission defaults are set.
3. **One guild, one event per process.** `GUILD_ID` is hard-wired. Channels, the role and URLs are all env.
4. The **`message_content` privileged intent** is requested but unused.
5. **Event-specific defaults are in code:**
   - three config defaults point at the event's domain;
   - the "registration closed" DM has the tournament URL hard-coded (it ignores `FRONTEND_URL`);
   - `/platform status` choices and the watcher post wording name the event.
6. **Dead config and code:** `EVENT_COUNTDOWNS_JSON` (never read), `TOURNAMENT_SCHEDULE_POLL_SECONDS` (only the test path), the `worker/` stub with empty migrations, and the `/stream` stubs.
7. Admin tokens ignore `TOKEN_EXPIRY_DAYS` (hard-coded 7 days).
8. **Heartbeat false alarm (likely).** When `MANAGER_URL` and `MANAGER_TOKEN` are set but the manager has no `/api/heartbeat` yet, the watcher counts from start-up. It then DMs "heartbeat is stale" after 3 minutes.
9. **Poll buttons stop working after a restart.** The poll view is attached only when the poll is created; resuming a hydrated poll does not re-register it.
10. **Best-effort HTTP everywhere.** Snapshots, votes and roster calls that fail are logged and dropped: there is no retry and no queue, so the site silently misses data while it is down.
11. **The contract lives in two repos.** Token calls send both `user_id`/`username` and `discord_user_id`/`discord_username` "for Worker compatibility". The site API is documented in this repo but implemented in the signup site.
12. **Signage coupling by URL:** directive targets are URLs of the site's LAN-display page with query parameters (the screen-embed protocol that [0010](../decisions/0010-scope.md) drops).
13. The systemd unit runs the bot **as root**. The log file is not rotated by the app.
14. Naive UTC datetimes (`datetime.utcnow()`) are used throughout.
15. The mini-tourney test-channel routing is by **season name prefix** ("test").

From the commit history (fixes and incidents, mostly in the October 2026 burst):
- **Tournament:**
  - dwell lost after a restart;
  - the T−15 screen pin missed after a restart (catch-up added);
  - the VC cleanup ack returning 409 and admin-ping spam (made idempotent and throttled);
  - registrants with a null Discord id breaking reminders and the roster;
  - the roster listing raw ids instead of names (fixed, and a one-off backfill script for one stored roster);
  - tournament times shown in UTC (fixed to the event timezone);
  - the site's admin-token endpoint returning 500 (a legacy context doc tracks it);
  - `my-registrations` missing event links.
- **Finals:** the display-state envelope was not unwrapped, so finals cards never fired, and the card TTL was wrong (fixed to the time left in the window).
- **Pizza:** links were built from the wrong base (fixed to use the `FRONTEND_URL` origin).
- **Alerts and health:**
  - alert DMs lacked the Acknowledge button;
  - `POST /alert` rejected the contract body;
  - the signage health check misread the signage body (four fixes).
- **Runtime:**
  - game activities without an application id crashed detection;
  - `CANCCUSIGNAGE_CONTROL_ENABLED` was ignored;
  - `.env` was not found under systemd;
  - poll lifecycle problems (expiry after a resume, close cleanup, the vote sync to the site's ids).
- **Retired:** PiSignage control was retired in favour of canccusignage, and the canccustream integration was removed (now the `/stream` stubs).
- **TODO and FIXME:** none in the code.

## Port recommendation per feature
This follows the porting plan in the [roadmap](../roadmap.md#porting-plan) and [0010](../decisions/0010-scope.md). Rows marked **(new)** are features the porting plan does not name yet; the summary (#76) should take them up. Steps: 3 Screen core, 4 Moments, 5 Pizza, 6 Bot, 7 Tournament, 8 Admin operations, 9 Feeds, 10 Hardening; "Games" is the Games track.

| Feature (legacy paths) | Recommendation | Reason | Target module · step |
|---|---|---|---|
| Runtime: `main.py`, `config.py`, cog loading, guild sync | Rewrite | A pool of clients (shared bot or the tenant's own token), commands per guild from feature flags, settings per tenant instead of env ([0013](../decisions/0013-multi-tenant-core.md) items 14–15, 18) | bot · 6 |
| Admin check by role name (`utils/validators.has_admin_role`) | Rewrite | Rights from role-to-rights sync by role **id** (roadmap step 6), checked in the backend | bot · 6 (rights model from step 1 sign-in) |
| Intents | Port with changes | Keep `members` and `presences` (presence and game counts need them); drop `message_content`; on the shared bot, drop the data of tenants without the feature (0013 item 16) | bot · 6 |
| Presence snapshots (`presence_tracker.py`) | Port with changes | Postgres per tenant, a bus event instead of the site push, a test for the tracker | bot · 6 |
| Voice snapshots (`voice_tracker.py`) | Port with changes | Same as presence | bot · 6 |
| Game snapshots and play duration (`game_detector.py`, `storage/game_play_duration.py`) | Port with changes | The pure logic is well tested; store per tenant | bot · 6 |
| Steam cover fallback (`steam_cover.py`) | Port as-is | Pure, tested, no event content; the cache can be shared across tenants | bot · 6 |
| Hot-game banner (episode logic in `game_detector.py`) | Port with changes **(new)** | The bot publishes a "hot game" event and Moments decides the takeover; no direct screen calls | bot · 6, moments · 4, wired in 9 |
| Message counts and top chatters (`message_tracker.py`, `on_message`) | Port with changes | Personal data: needs a retention period and per-tenant deletion (0013 item 31); counts must be pruned too | bot · 6 |
| Stats history aggregation (`stats_history.py`) | Port with changes | Built from Postgres, served through the bot API or events to the screen widgets | bot · 6, screen · 9 |
| In-memory storage (`storage/memory_store.py`, `abstract.py`) | Port with changes (logic), drop the layer | 0010 drops the in-memory layer; the queries and aggregations become Postgres | bot · 6 |
| Polls (`cogs/polls.py`, `poll_manager.py`, `poll_ticker.py`, poll formatters and validators) | Drop | [0010](../decisions/0010-scope.md) | – |
| Screen announce, clear and reset (`cogs/signage.py`) | Rewrite **(new)** | Bot commands that publish screen-override events; the TTL and revert live in Moments | bot · 6, moments · 4 |
| Signage state and auto-revert timers (`signage_state.py`, `display_control.py`, the lan-display URL builder) | Drop | Moments owns the ranking, TTL and revert on the server; the screen-embed URLs are dropped (0010) | – |
| Signage control client (`canccusignage_control.py`) | Rewrite | Porting plan; it becomes bus events | bot · 6 |
| Trigger settings (`trigger_settings.py`) | Rewrite **(new)** | Become per-tenant settings (Moments or bot settings schema) instead of a fetch from signage | moments · 4 |
| Manual ticker (`cogs/ticker.py`, `ticker_ops.py`) | Port with changes | The ticker stays manual only (0010); the commands publish to Screen or Moments | bot · 6, screen · 3 |
| Scheduled ticker windows (`ticker_schedule.py`) | Port with changes, into Screen's scheduler windows | They are lost on restart today; Screen already ports scheduler windows. See the question below | screen · 3 |
| RSS ticker (`ticker_rss.py`, `ticker_rss_server.py`) | Drop | 0010 | – |
| Photo carousel menus (`cogs/photo_carousel.py`, `canccusignage_carousel.py`) | Port with changes **(new)** | Files go to the tenant's files volume through the Screen API; no separate token | bot · 6, screen · 3 |
| Carousel photo naming (`carousel_photo_naming.py`) | Port as-is | Porting plan; pure and tested | bot · 6 |
| Signage admin link (`/adminlink`, `utils/admin_link.py`) | Drop | Replaced by the central sign-in (0013 item 10); 0010 drops the old login-link format | – |
| `/platform status` (`cogs/platform.py`) | Rewrite **(new)** | Reads the admin health and status view; event admins see their tenant only, the superadmin the stack | admin · 8 |
| Manager alerts and Acknowledge (`alerts.py`) | Rewrite | Porting plan: alerts are events the bot consumes; ack and mute through admin | bot · 8 |
| Manager heartbeat watcher (`alerts.py`) | Drop | 0010 (the hardening watchdog covers it) | – |
| Health endpoint (`health_server.py`) | Rewrite | On the kit's health contract (`/api/bot/health`) | bot · 6 |
| `/help` (`help_cog.py`) | Drop | Porting plan; Discord lists the registered commands itself | – |
| `/stream` stubs (`cogs/stream.py`) | Drop | Cast is a new build with its own commands | cast (track) |
| Pizza links (`cogs/pizza.py`) | Rewrite | Porting plan; links rely on the platform sign-in, not tournament tokens (0010 drops registration tokens) | pizza · 5 |
| Tournament read commands (register, schedule, my-registrations, leaderboard) | Port with changes | They read the tournament API; registration lives in the module (roadmap step 7), so `register` becomes a sign-in link | tournament · 7 (bot side in 6) |
| Tournament admin commands (admin, add, remove, list, clear) | Port with changes | Through the tournament API with backend rights; the admin link is replaced by sign-in | tournament · 7 |
| Tournament reminders (T−60 post, close and start DMs, status changes) | Port with changes | Scheduler in the tournament module; the bot sends DMs on events | tournament · 7, bot · 6 |
| Tournament VCs: create-once, dwell roster, cleanup, backstop, create-now (`tournament_manager.py`, `tournament_dwell.py`, `tournament_discord_channels.py`) | Port with changes | Porting plan "tournament pure parts"; the polling of site flags becomes the voice handshake through events (roadmap step 7); keep the three legacy ADR rules (polling not push, create-once, disconnect → delete → ack) as the spec | bot · 6, tournament · 7 |
| Tournament screen pin T−15..T+10 | Rewrite | An event consumed by Moments and Screen | moments · 4, wired in 9 |
| `TournamentMemoryStore` | Drop | Test double for the site API; the port tests against Postgres | – |
| Mini-tourney watcher posts and finals summary (`tourney_watcher.py`) | Port with changes **(new)** | The Games module publishes season and champion events; the bot posts them; the restart-safe "announced ids" become rows | games (track), bot · 6 |
| Finals cards (`finals_cards.py`) | Rewrite **(new)** | A Moments takeover driven by Games events | moments · 4, games (track) |
| Roster nick backfill (`roster_nick_backfill.py`, `scripts/`) | Drop | A one-off repair | – |
| Site API client (`api_client.py`) | Drop as a client | Each call becomes a contract endpoint or a bus event of the owning module | – |
| Validators and formatters (`utils/`) | Port as-is (the surviving parts) | Porting plan; the poll validators and poll embeds go with polls, and `has_admin_role` is replaced | bot · 6 |
| Worker stub (`worker/`) | Drop | Porting plan and 0010 | – |
| Deployment (LXC, systemd, scripts) | Drop | 0010; the platform is containers | – |
| Live integration tests (`tests/integration/`) | Drop | Porting plan | – |
| Activity log line (`_stats_logger`) | Drop | Replaced by metrics and the status view (0013 item 28) | – |

Candidate bus events for the event catalog (#34), named here only as a starting point: presence, voice and game snapshots; hot game started and ended; a screen announce request; ticker set and clear; carousel photo added and removed; tournament reminder due, VC created and cleaned, roster posted; Games season opened, started and champion. The names and payloads are #34's to decide.

## Tenancy questions
What this repo implies for the tenancy design (#48), as questions for the product owner and the tenants contract:
1. **Guild ↔ tenant.** Legacy is one guild per process. Can one Discord guild serve two tenants (for example a community running two events)? If so, every guild-level record (snapshots, channels, VCs) needs the tenant, not just the guild id.
2. **Shared bot and privileged intents.** `members` and `presences` arrive for every guild the shared bot is in. Is presence/game tracking a feature flag whose data is dropped when off (0013 item 16)? Is `message_content` dropped for good?
3. **Rights.** Legacy grants admin by role name. Confirm that role-to-rights sync maps role **ids** per tenant, and that `/platform status` splits into a per-tenant view and a superadmin view.
4. **Channels and recipients per tenant:** the tournament channel, the finals channels (main and test), the alert channel and the alert DM users. Are platform alerts (a stack problem) global, going to the superadmin, while event alerts go to the tenant?
5. **Venue or event:**
   - the hot-game, poll and finals trigger settings (legacy: "venue-editable" on signage);
   - the timezone;
   - the "venue network only" link hint.

   Do these become venue attributes, or tenant settings with venue defaults?
6. **Global data:** the Steam cover cache, and the Discord user identity (users are global, 0013 item 30). The activity snapshots, message counts and tournament data are per tenant.
7. **Retention and GDPR:** legacy keeps 96 h of snapshots and never prunes message counts and nicks. Pick a per-tenant retention, and decide whether stats outlive the event (archived tenants are read-only).
8. **Legacy bot data migration (0004, 0013).** The bot itself holds almost nothing durable: two small JSON state files and its token. The activity, poll and tournament data the old system shows are in the signup site's hosted database. The step 6 migration therefore needs a decision on whether "the legacy bot data" means the site-side snapshots and tournament rows (which 0004 otherwise leaves behind) or only the token and the bot's settings.
9. **Bot token per tenant.** At the switch, the legacy token moves into the tenant (0013). The legacy process must be stopped first (never two bots on one token).
10. **Scheduled ticker windows:** 0010 keeps the ticker "manual only" and drops "automatic ticker posts". Do operator-scheduled windows count as manual (port into Screen's scheduler) or as automatic (drop)?

## Event-specific content
Counted by kind; the exact values are listed in the PR body for a follow-up in the event repo. The search covered the event and organization name, its domain and subdomains, IP addresses, Discord snowflakes, tailnet hostnames, channel names and timezone names, over every tracked file.

| Kind | Count | Where (by kind of file) |
|---|---|---|
| Event or organization name | 169 lines in 44 files | 14 lines in 8 bot source files, 21 lines in 8 test files, 9 lines in 2 env examples, the rest in docs |
| Event web hostnames | 2 (the event domain and one subdomain) | Defaults of 3 config variables, 1 hard-coded URL in a DM, env examples, tests, docs |
| Private-network (tailnet) hostname | 1 | A runbook and an integration-test guard |
| Internal service hostnames with ports | 3 (bot RSS, signage, mini-tourney) | Config default, env example, docs: platform names, not event names |
| Real Discord ids | 1 channel id | A planning doc (the others are placeholders) |
| Discord channel names | 2 | A cog docstring and a planning doc |
| Event edition title and slogan | 1 | The RSS filler item title |
| "Event network only" wording | 2 strings | Mini-tourney announcement posts |
| Event name as a subsystem choice | 1 | `/platform status` choices |
| Event schedule | 1 file, 10 `/tournament add` lines (game names and dates) | `docs/` |
| Event timezone (IANA name) | 33 lines in 16 files | Config default, docstrings, tests, docs |
| Event-year phase label | 4 lines in 4 files | Comments and docs |
| IP addresses | 0 event-specific | Only private-range examples and public DNS servers in the LXC guide |
| Secrets | 0 committed | Placeholders only (`your_bot_token_here`, a placeholder Worker secret) |

## Coverage
Every tracked file (175 files, 30,580 lines) was examined:
- all source, config, migration, script and test files were read;
- all docs were opened and classified;
- the unit test suite was run, with coverage.

Nothing was skipped. `worker/package-lock.json` (2,794 lines) was checked only as a dependency lock, and the two `.gitkeep` files and the two migrations are empty. Line counts include blank lines.

| Directory | Files | Lines | Content |
|---|---|---|---|
| (root) | 11 | 1,911 | README, agent and context notes, phase summary, structure, tournament plan, `.env.example`, `pyproject.toml`, `requirements.txt`, git config |
| `.github/workflows` | 1 | 53 | CI: black, pytest, Worker vitest |
| `bot` | 6 | 1,516 | `main.py`, `config.py`, `alerts.py`, `requirements.txt`, `README.md`, `__init__.py` |
| `bot/cogs` | 13 | 2,576 | 12 cogs and `__init__.py` |
| `bot/services` | 27 | 6,247 | 26 services and `__init__.py` |
| `bot/storage` | 4 | 1,379 | Storage interface, memory stores, play duration |
| `bot/utils` | 4 | 430 | Validators, formatters, admin-link signer |
| `deployment` | 2 | 330 | LXC guides |
| `deployment/configs` | 1 | 69 | Env example |
| `deployment/scripts` | 3 | 76 | Setup, deploy, update |
| `deployment/systemd` | 1 | 24 | Unit file |
| `docs` | 13 | 2,097 | Context, API contract, testing, tournament and retirement notes, event schedule |
| `docs/adr` | 4 | 85 | 3 ADRs (tournament VCs) and `.gitkeep` |
| `docs/agents` | 2 | 96 | Agent notes |
| `docs/ai` | 2 | 65 | Docs index and bot rules |
| `docs/ai/areas` | 5 | 195 | Area notes: finals cards, carousel, polls, tournament, tourney watcher |
| `docs/diagrams` | 1 | 52 | Tournament timeline |
| `docs/handoffs` | 1 | 0 | `.gitkeep` |
| `docs/plans` | 3 | 65 | Two issue plans and `.gitkeep` |
| `docs/research` | 1 | 0 | `.gitkeep` |
| `docs/runbooks` | 1 | 87 | Signage integration testing |
| `docs/superpowers/plans` | 3 | 779 | Implementation plans |
| `docs/superpowers/specs` | 2 | 281 | Design specs |
| `scripts` | 1 | 12 | Backfill entry point |
| `tests` | 1 | 54 | `conftest.py` |
| `tests/bot` | 44 | 8,801 | Unit tests |
| `tests/integration` | 6 | 392 | Live signage tests and helpers |
| `tests/worker` | 1 | 14 | Worker test |
| `worker` | 5 | 2,849 | Worker package, lock, tsconfig, vitest and wrangler config |
| `worker/migrations` | 2 | 2 | Empty schema and index files |
| `worker/src` | 4 | 43 | Health route only; auth and db files are empty stubs |
| **Total** | **175** | **30,580** | |
