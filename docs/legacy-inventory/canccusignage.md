# Legacy inventory: canccusignage

The inventory of the legacy signage repo for roadmap step 2a ([epic #46](../roadmap.md#2a-legacy-inventory)), issue #71. It is the map of what Screen core (step 3) and Moments (step 4) port. It describes the legacy code and does not copy it. Event-specific values are named by kind and counted only (see [Event-specific content](#event-specific-content)).

- **Read at:** commit `c9d00e3` (2026-10-30), the read-only clone on the dev VM. 469 tracked files, 251 commits from 2026-03-31 to 2026-10-30.
- **Stack:** Node 22 (at least 22.23.4), Astro 7 with the Node adapter (server-rendered pages and API routes), TypeScript, SQLite through better-sqlite3, zod, sharp, jszip, argon2. Tests: vitest. Licence field: ISC, sole author (the platform owner).
- **Runtime shape:** three roles on one Windows laptop at the venue, inside WSL2: a supervisor starts a **worker** (adapter polls) and the **web** server (port 4321), all sharing one SQLite file. A full-screen Edge browser on the same laptop opens `http://127.0.0.1:4321/screen` and drives the projector. The Discord bot and the stream service reach it over Tailscale.
- **What it replaced:** a hosted PiSignage setup. That migration is finished; PiSignage is retired and its rollback runbooks are obsolete.

## Contents
1. [Coverage](#coverage)
2. [Features](#features)
3. [Interfaces](#interfaces)
4. [Data](#data)
5. [Configuration](#configuration)
6. [External integrations](#external-integrations)
7. [Tests](#tests)
8. [Known problems](#known-problems)
9. [Port recommendation](#port-recommendation)
10. [Tenancy questions](#tenancy-questions)
11. [Event-specific content](#event-specific-content)

## Coverage
Every tracked file was examined: source, config, scripts, migrations (inline in `src/lib/runtime/db.ts`; there is no migrations directory), tests, docs and the git history. Large DOM client files (`src/lib/admin/content/playlist-builder-client.ts`, `asset-picker-client.ts`, `asset-preview-client.ts`, parts of `asset-upload-client.ts` and `week-calendar-edit-client.ts`) were read in their core sections and searched for every API call, event and export. CSS was read by selectors and comments. The three HTML mockups in `public/` were read for what they show. Binary files (sounds, the fallback image, fonts) were listed and checksummed, not decoded. Docs were read in full for runbooks, the `ai/` area docs, ADRs and the glossary, and by structure plus their open, deferred and troubleshooting sections for the rest. All 251 commit subjects were read, plus the bodies and diffs of every fix-type commit.

**Nothing was skipped.**

| Directory | Files | Lines | What is in it |
|---|---|---|---|
| (root) | 12 | 8381 | `package.json`, `package-lock.json` (most of the lines), `.env.example`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`, `.gitignore`, `.gitattributes`, `README.md`, `CLAUDE.md` (agent workflow), `CONTEXT.md` (the domain glossary, about 45 terms) |
| `.github/` | 1 | 31 | CI workflow: `npm ci`, `astro check`, `vitest run` |
| `deployment/` | 5 | 244 | README, systemd unit for the supervisor under WSL2, install script, two Tailscale access scripts |
| `docs/` | 79 | 11531 | 2 ADRs, AI area docs, component guides, runbooks, plans and specs, an archive, a template (3 empty `.gitkeep`) |
| `ops/` | 4 | 369 | The supervisor (`phase1-supervisor/entry.mjs` and README) and two one-time backfill CLIs (image resize, video length) |
| `public/` | 26 | 7997 text lines + 13 binaries | The kiosk player `scripts/screen-client.js` (2211 lines), ticker scripts, CSS (tokens, admin, sound board, screen), 10 placeholder MP3s and their README, the fallback PNG, 2 font files with their OFL licence, 3 design mockup pages |
| `src/` | 238 | 34155 | Astro pages, API routes, middleware and `src/lib` (below) |
| `tests/` | 104 | 18449 | vitest unit and route tests |

`src/` by subdirectory:

| Subdirectory | Files | Role |
|---|---|---|
| `src/lib/signage` | 48 | Scheduler, ADVT, playback engine, bookmarks, directives, ticker, assets, PPTX/YouTube/web assets, settings, repositories |
| `src/lib/admin` | 35 | Admin view-models (pure) and DOM client scripts |
| `src/lib/sound` | 28 | Sound engine, cues, occasions, catch-up, sound log, uploads, board commands |
| `src/lib/adapter` | 16 | Worker poll of the signup site: display state, tournament, health, pizza; normalizers, freshness, persistence |
| `src/lib/screen` | 12 | Screen state payload, kiosk liveness, mirror mode, Ready check, scene transitions, playback offset |
| `src/lib/auth` | 8 | Admin password, sessions, cookies, Discord login links, guard |
| `src/lib/carousel` | 6 | Discord photo carousel, featured breaks, spotlight |
| `src/lib/runtime` | 6 | Config, SQLite schema and migrations, logging and alert webhook, storage dirs, trusted origins, JSON responses |
| `src/lib/pptx` | 3 | PPTX slide count, render, cache key |
| `src/lib/control` | 2 | Control-plane bearer tokens, target validation |
| `src/pages/api` | 55 | API routes (all listed under [Interfaces](#interfaces)) |
| `src/pages/admin` | 10 | Admin pages |
| `src/pages/sounds` | 1 | Serves uploaded cue sounds |
| other | 6 | `src/pages/index.astro`, `src/pages/screen.astro`, `src/middleware.ts`, `src/worker/entry.ts`, `src/layouts/` (2), `src/components/admin/` (1), `src/env.d.ts` |

## Features
"Reached by" names the page, endpoint, command or schedule. Paths are relative to the legacy repo.

### On the screen (user-visible)
| Feature | Where it lives | Reached by |
|---|---|---|
| **Scheduled playback.** Weekly windows (day, start and end minute, overnight allowed, 24:00 allowed), winner by schedule priority, later start, playlist priority, id. Evaluated in one venue time zone. | `src/lib/signage/scheduler.ts`, `schedule-window.ts`, `schedule-repo.ts` | Every `GET /api/screen/state` and the `/screen` first render |
| **Playlists:** `regular` (mixed timeline), `slideshow` (scheduled image carousel with image time and cycle), `advt` (breaks, never scheduled). Items have a duration (empty = the video's real length), PPTX slide range and slide interval. | `src/lib/signage/types.ts`, `playlist-builder.ts`, `slideshow-playlist.ts`, `playlist-repo.ts` | Admin Content page |
| **Playback engine and bookmarks.** A playlist becomes a timeline; the position is the bookmark plus wall-clock time since it was saved, wrapped by the cycle. Errored assets are skipped. One bookmark per playlist; the kiosk re-saves it at most every 30 s. While a directive is up, bookmarks are frozen (scheduled playback pauses). | `src/lib/signage/playback-engine.ts`, `playback-bookmark.ts` | `POST /api/screen/playback-progress` |
| **ADVT breaks.** A timed interrupt: period, break length, optional daily window, play-once, priority chaining (the next due ADVT starts at once), a minimum main-content gap between unchained breaks (default 60 s). The interrupted main position is saved and resumed. | `src/lib/signage/advt-scheduler.ts`, `advt-window.ts`, `advt-gap-settings.ts`, `advt-playback.ts` | Ticked lazily inside every state read; configured on Admin Schedule |
| **ADVT slideshow mode.** Images only, one dwell for the playlist (default 6 s), cut or crossfade, pan/zoom presets, ordered with a resume cursor or shuffled per break (seeded), a dwell overrun of at most 10 s. | `src/lib/signage/advt-playback.ts`, ADR 0001 | Playlist settings |
| **Directives (overrides).** External or ops takeovers with a source (bot, stream, ops, emergency), a kind (web, asset, stream), a label and a TTL (default 120 s, max 7200 s). The band comes from the source or label; rank: emergency 100, stream 90, announce 80, tournament 60, finals 55, hot_game 50, poll_result 40, ticker 10. One row per source and label; re-posting the same content extends the TTL. A lower hot_game or finals card is refused with retry after 30 s. Announce over a stream becomes an overlay. | `src/lib/signage/directive-*.ts`, `override-rank.ts` | `/api/control/override`, `/api/admin/override` |
| **Directive history.** Set, clear, expire and reject, with actor; 7 days or 500 rows. | `src/lib/signage/directive-history.ts` | Admin Diagnostics |
| **Scene precedence.** Directive base, then spotlight pin, then ADVT break, then scheduled playlist, then the baseline web page, then the fallback image. | `src/lib/signage/screen-snapshot.ts`, `scene-resolver.ts`, `scene-types.ts` | State read |
| **Readiness.** Healthy, degraded (upstream older than 240 s), offline fallback (600 s), from the adapter's age. | `src/lib/signage/readiness-timers.ts`, `scene-resolver.ts` | `/api/readiness`, state |
| **Baseline web page.** With nothing scheduled, the screen embeds the signup site's display page (env-configurable, can be turned off). Its URL is auto-registered as a web asset and auto-inserted into new playlists. | `src/lib/signage/baseline-web.ts`, `lan-web-view-presets.ts` | State read; "Add LAN web views" on Content |
| **Ready check and Ready fallback.** Opt-in per embedded view: if the embedded page does not post its Ready message within 8 s, a chosen fallback image replaces it until the slot ends. Outcomes are logged. | `src/lib/screen/lan-display-ready.ts`, `should-arm-ready-check.ts`, `src/lib/signage/ready-fallback-settings.ts`, `src/lib/screen/ready-log.ts` | Admin Ops (settings), `POST /api/screen/ready-log` |
| **Scene transitions.** Two scene slots; the incoming scene loads (Ready, iframe load, video data, image load, at most 5 s) and fades in over 700 ms; reduced motion or ADVT `cut` skips the fade. | `src/lib/screen/scene-transition.ts`, mirrored in `public/scripts/screen-client.js` | Kiosk |
| **Progress bars.** Scene and page bars; the page bar for web embeds is driven by the embedded page's pages message. On/off and opacity in settings. | `src/lib/screen/lan-display-pages.ts`, `settings-store.ts` | Kiosk; Admin Ops |
| **Ticker.** One lane: message, source (admin or bot), TTL, an optional poll countdown. Appearance presets (default, high-contrast, minimal, broadcast, custom) with clamped values as CSS variables. A pizza ticker fills in when no other ticker is up. | `src/lib/signage/ticker-store.ts`, `ticker-appearance.ts`, `public/scripts/ticker-marquee.js` | `POST /api/control/override` with label `ticker`, `POST /api/admin/ticker` |
| **Screen chrome.** Header and footer on or off; hidden cursor. | `src/pages/screen.astro`, `settings-store.ts` | Admin Ops |
| **Assets:** image, PPTX, video, web URL, YouTube. Images are scaled to at most 2560×1440 on upload with EXIF orientation applied; video length is read from MP4/MOV or WebM headers in JS (no ffprobe); PPTX slides are rendered to PNG by LibreOffice and poppler and cached per version. | `src/lib/signage/asset-*.ts`, `image-*.ts`, `video-duration.ts`, `src/lib/pptx/*` | `GET /api/asset`, `GET /api/pptx-slide` |
| **YouTube.** URLs normalized to embeds; an oEmbed probe on add sets health (ok, error when not embeddable, degraded when unknown); player errors mark the asset and skip it; an early end advances the bookmark. | `src/lib/signage/youtube-*.ts` | Content page; `POST /api/screen/youtube-playback-error` |
| **Photo carousel from Discord.** The bot posts photos from a channel; one ADVT slideshow playlist is "the carousel"; new photos are featured first in the next break, with a ring and a caption (channel, author, time); admin can clear Discord photos. | `src/lib/carousel/*` | `POST/DELETE /api/carousel/photos`; Content page |
| **Spotlight.** Pins one photo full screen for a set time (an existing asset, or a temporary upload deleted afterwards). Refused while a directive is up; gives way to a later directive. | `src/lib/carousel/spotlight.ts` | `POST /api/carousel/spotlight` |
| **Pizza ticker and cues.** Pizza order status (none, open, closed, placed, cancelled) polled from the signup site, shown as the fallback ticker (a placed order for 10 minutes) and cued once per order and state. | `src/lib/adapter/pizza-*.ts` | Worker poll every 15 s |
| **Sound engine.** One sound at a time on the projector's audio. 6 categories with priority and default files, 25 cue ids (announce, emergency, poll, now playing, ticker, photo, cast stubs, tournament moments, chips, strip cues, pizza). Per cue: on/off, level, cooldown, file. Rules: dedupe, cooldown, ambient gap, queue staleness, flood guard, chip coalescing (2 s), once per source (7 days, in the kiosk's local storage), emergency pre-emption, ambient paused under full-screen takeovers. Master volume and timed Mute all. | `src/lib/sound/*` (pure core bundled for the browser) | Kiosk, from state changes and embed messages |
| **Sound triggers.** (1) Diffs of successive screen states: announce appear and early clear (sound from the announce `sfx` parameter), emergency, poll open and result, now playing, operator ticker, spotlight and featured photo. (2) Cue messages from the embedded page (chips, strip cues, tournament moments). (3) Pizza cues from the server. (4) Tournament catch-up: a missed pre-start cue is played late, at most once per event, server-tracked. (5) Admin preview, sound check and stop (in-memory commands with a 15 s TTL). | `src/lib/sound/occasions.ts`, `screen-cue.ts`, `catch-up*.ts`, `board-commands.ts`; ADR 0002 | See [Interfaces](#interfaces) |
| **Mirror.** `/screen?mirror=1` is a silent copy that sends no reports and does not count as the kiosk. | `src/lib/screen/mirror-mode.ts` | Admin Ops live screen |
| **Kiosk player.** Polls state every second, builds scenes, plays video, YouTube and audio, unlocks audio on first input, reports progress, sound, Ready and YouTube outcomes. Keeps the last scene on fetch errors; no reload or watchdog. | `public/scripts/screen-client.js`, `src/pages/screen.astro` | `/screen` in a kiosk browser |

### For the operator (admin)
All admin pages need a session (see [Interfaces](#interfaces), auth).

| Page | Operator features | Calls |
|---|---|---|
| `/admin` | Active schedule, next change within 24 h, quick links, readiness, worker and upstream status lights | Server-rendered only |
| `/admin/login` | Password sign-in; says when auth is unconfigured | `POST /api/admin/auth/password` |
| `/admin/link` | Redeems a one-time Discord login link from the bot | Server-side redeem |
| `/admin/content` | Asset library (search, kind filter, sort, thumbnails, preview, rename, delete, reset health, undo replace, YouTube recheck); batch upload up to 100 files with name-conflict keep/replace; add web or YouTube URL; playlists (create, settings incl. ADVT slideshow, delete, priority); playlist builder (add from catalog, inline edit, reorder, bulk remove); "Add LAN web views"; designate and clear the photo carousel and its settings | `/api/admin/assets*`, `/api/admin/playlist*`, `/api/admin/carousel*`, `GET /api/asset` |
| `/admin/schedule` | Active window; ADVT interrupts table with predicted breaks and overlap warnings; ADVT edit dialog; minimum main gap; week calendar (drag to create, move, resize; 15-minute snap; overlap winner/loser) and list view with bulk delete; simulate at a date and time | `/api/admin/schedules*`, `/api/admin/advt-gap`, `/api/admin/playlists/:playlistId/advt`, `/api/admin/schedule/simulate` |
| `/admin/ops` | Screen display settings (chrome, bars, ticker appearance, Ready fallback per view); admin live screen (scaled mirror) with a ticker preview; active directives and compositor; clear one or all; set an ops directive (display-page preset, custom URL or stream URL, message, TTL); ticker set and clear | `/api/admin/screen-display`, `/api/admin/override`, `/api/admin/ticker` |
| `/admin/sounds` | Sound desk: live bar (screen and audio status, last on PA, master fader, Mute all with timer, sound check); Mixer (category faders, queue wait, flood guard, catch-up); Cues (per-cue on/off, level, cooldown, file, play here or on PA); Library (upload, assign, delete); Log (filters, incremental) | `/api/admin/sounds*` |
| `/admin/sounds/cue-test` | Developer page that posts synthetic cue messages inside `/screen`; exists only with `CANCCU_CUE_TEST=1` | postMessage |
| `/admin/triggers` | Bot thresholds (hot-game player count, banner time and cooldown, poll and announce times, finals times, test mode) and display-page parameters | `POST /api/admin/triggers` |
| `/admin/diagnostics` | Readiness, worker and upstream cards; runtime paths; directive counts and history by source; Ready-check log; scene and playback info; adapter details | Server-rendered only |

Other operator features: `GET /api/healthz` (platform health check), the supervisor with restart backoff, the image-resize and video-length backfill CLIs (`npm run assets:resize`, `npm run assets:measure-videos`, dry run by default, `--apply` needs backups), the Tailscale access scripts, manual SQLite backup and restore (runbooks only; nothing automated).

## Interfaces

### HTTP routes
Auth legend:
- **admin:** a valid admin session (middleware; API gets 401 JSON, pages redirect to the login page).
- **ctrl:** a control-plane bearer token; its source is its identity. A present `Origin` must be trusted.
- **carousel:** the carousel bearer token.
- **loopback:** the request URL's host must be loopback (taken from the Host header, not the socket).
- **none:** open.

Every POST, PUT, PATCH and DELETE also passes the trusted-origin check (see [Known problems](#known-problems)). Responses use `{ok}`, `{success}` or `{error}` inconsistently; form posts answer with a 303 redirect and a flash parameter.

**Admin API** (all admin, except where noted)

| Method | Path | Request | Response | Purpose |
|---|---|---|---|---|
| POST | `/api/admin/advt-gap` | form `minMainGapSeconds` (0–3600) | 303 with flash | Minimum main-content gap between ADVT breaks |
| PATCH | `/api/admin/assets/:id` | JSON `title` or `resetHealth` | `{ok}`, 400 | Rename, or reset YouTube health |
| DELETE | `/api/admin/assets/:id` | — | `{ok}`, 400 while referenced | Delete asset, files and PPTX cache |
| POST | `/api/admin/assets/:id/revert` | — | `{ok, asset, restored}` | One-step undo of a replace |
| GET | `/api/admin/assets` | query `q`, `kind`, `page`, `limit` (25), `sort` | paged list with usage | Asset library |
| POST | `/api/admin/assets/name-check` | JSON `names[]` (≤100) | `{ok, results}` | Same-name matches before upload |
| POST | `/api/admin/assets/upload` | multipart `title`, `asset`, `conflict`, `replaceAssetId` | JSON `{ok, asset}` or `{ok, replaced, asset, clamped}`, or 303 | Upload or replace one file (≤100 MiB) |
| POST | `/api/admin/assets/upload/batch` | multipart `titlePrefix`, `assets[]` (≤100) | `{ok, uploaded, failed}` | Batch upload |
| POST | `/api/admin/assets/web` | form `title`, `url` | 303 | Register a web or YouTube URL |
| POST | `/api/admin/assets/youtube/recheck` | — | `{ok, …}` | Re-probe every YouTube asset |
| POST | `/api/admin/auth/logout` | — | 204, cookies cleared | Sign out |
| POST | `/api/admin/auth/password` | **none**; JSON or form `password` | 204 or 303 with cookies; 401; 429 | Password sign-in |
| PUT | `/api/admin/carousel` | JSON `playlistId` | `{ok, playlistId}` | Designate the carousel (an ADVT slideshow) |
| POST | `/api/admin/carousel/clear` | — | `{ok, removed, filesDeleted, filesKept}`; 409 | Remove Discord photos |
| GET, PUT | `/api/admin/carousel/settings` | PUT JSON `dwellSeconds` (≥5), `breakCapSeconds` (≥10), `effectEnabled` | `{ok, settings}` | Featured photo and spotlight settings |
| POST | `/api/admin/override` | form `action` (set, clear one, clear all), `commandMode`, `preset`, `target`, `message`, `ttlSeconds` | 303 | Ops directive from admin (actor = signed-in user) |
| POST, DELETE | `/api/admin/playlist-items` | POST JSON one item or `items[]`, or form; DELETE JSON `playlistId`, `itemIds[]` | `{ok, id}` / `{ok, ids, items}` / `{ok, items}` | Add items; bulk remove |
| PATCH, DELETE | `/api/admin/playlist-items/:id` | PATCH JSON duration, slide range, slide interval | `{ok, items}` | Edit or remove one item |
| POST | `/api/admin/playlists` | form `name`, `priority`, `playlistType` | JSON `{ok, playlist}` or 303 | Create playlist |
| DELETE | `/api/admin/playlists/:playlistId` | — | `{ok}` | Delete (cascades) |
| POST | `/api/admin/playlists/:playlistId/advt` | form ADVT fields and window times | 303 | ADVT break settings |
| POST | `/api/admin/playlists/:playlistId/lan-web-views` | — | `{ok, items}` or 303 | Add the display-page preset items |
| POST | `/api/admin/playlists/:playlistId/priority` | form `priority` (0–999) | 303 | Set priority |
| PATCH | `/api/admin/playlists/:playlistId/reorder` | JSON `itemIds[]` (full set) | `{ok, items}` | Reorder |
| POST | `/api/admin/playlists/:playlistId/settings` | form name, priority, type, ADVT and slideshow fields | 303 | Playlist settings |
| GET | `/api/admin/ready-log` | — | `{ok, retention, rows}` | Ready-check log |
| GET | `/api/admin/schedule/simulate` | query `at` (ISO time) | simulation | What would play at that time |
| POST, DELETE | `/api/admin/schedules` | POST JSON or form playlist, day, start, end, priority; DELETE JSON `scheduleIds[]` | `{ok, schedules}` or 303 | Create; bulk delete |
| PATCH, DELETE | `/api/admin/schedules/:id` | PATCH JSON slot fields | `{ok, schedules}` | Edit or delete a slot |
| POST | `/api/admin/screen-display` | form chrome, bars, ticker appearance, Ready fallback | 303 | Screen display settings |
| GET | `/api/admin/session` | **none** | `{authenticated, …}` | Session probe |
| POST | `/api/admin/sounds/check` | JSON `cueIds[]` | `{ok, check}`; 409 when muted | Arm a sound check on the kiosk |
| POST | `/api/admin/sounds/check/stop` | — | `{ok, stop}` | Stop check or preview |
| GET, PATCH | `/api/admin/sounds` | PATCH any sound setting, `muteAllForSeconds`, cue files | sound board payload | Sound settings |
| GET | `/api/admin/sounds/live` | — | live status | Polled every 1.5 s by the desk |
| GET, POST | `/api/admin/sounds/log` | GET query `cueId`, `category`, `outcome`, `sinceId`; POST JSON a "play here" row | `{ok, retention, rows}` / `{ok}` | Sound log |
| POST | `/api/admin/sounds/preview` | JSON `cueId` | `{ok, preview}`; 409 when muted | Play a cue on the projector |
| POST, DELETE | `/api/admin/sounds/uploads` | POST multipart `file` (MP3/OGG, ≤2 MiB, ≤30 s); DELETE JSON `path` | payload | Upload or delete a cue sound |
| POST | `/api/admin/ticker` | form `action`, `message`, `ttlSeconds` | 303 | Admin ticker |
| POST | `/api/admin/triggers` | form bot and display-page fields | 303 | Trigger settings |

**Screen, control, carousel and public API**

| Method | Path | Auth | Request | Response | Purpose |
|---|---|---|---|---|---|
| GET | `/api/screen/state` | none | `?mirror=1` optional | state v2 (below) | The kiosk polls it every second; records liveness unless mirror |
| POST | `/api/screen/playback-progress` | loopback | JSON playlist, item, offset, image index, slide | `{ok, bookmark}` | Save the resume bookmark |
| POST | `/api/screen/ready-log` | loopback | JSON outcome, view, reason, elapsed, visibility | `{ok}` | Ready-check outcome |
| POST | `/api/screen/sound-log` | loopback | JSON cue, source, outcome, reason, time, `catchUp` | `{ok}` | Cue outcome; resolves catch-up |
| POST, DELETE | `/api/screen/sound-probe` | loopback | JSON `cueId` | `{ok, probe}` | Arm or clear a one-shot cue |
| POST | `/api/screen/sound-status` | loopback | JSON `audioUnlocked`, sound-check progress | `{ok}` | Audio unlock and check progress (kept in memory) |
| POST | `/api/screen/youtube-playback-error` | loopback | JSON asset, playlist, item, error code or `ended`, `mirror` | `{ok, applied}` | YouTube or video error or early end |
| GET | `/api/asset` | none | `?assetId=` | file bytes | Media for the screen |
| GET | `/api/pptx-slide` | none | `?assetId=&slide=` | PNG; 503 on render failure | Rendered PPTX slide |
| GET, POST, DELETE | `/api/control/override` | ctrl (GET also admin) | POST JSON `source`, `kind`, `target`, `message`, `ttlSeconds`, `label`, `actor`, `pollExpiresAt`; label `ticker` sets the ticker; DELETE `?label=&actor=` | GET `{ok, directives, compositor}`; POST `{success, id, source, compositor}` or 409 `override_rejected` with retry 30 s | External directives and ticker |
| GET | `/api/control/triggers` | ctrl or admin | — | bot trigger settings | The bot reads its thresholds |
| POST, DELETE | `/api/carousel/photos` | carousel | POST multipart `messageId`, `channelName`, `authorDisplayName`, `postedAt`, `photos`; DELETE `?messageId=` | `{ok, added, rejected}` / `{ok, removed, …}`; 409 duplicate or no carousel | Bot adds or removes Discord photos |
| POST | `/api/carousel/spotlight` | carousel | multipart one photo plus metadata, or JSON `assetId` | `{ok, assetId, expiresAt}`; 409 `screen_busy` | Pin a photo full screen |
| GET | `/api/health` | none | — | service, state root path, time zone, chrome, time | Liveness |
| GET | `/api/healthz` | none | — | status ok, degraded or down (503), version, uptime, checks | Platform health check (kiosk poll age: under 5 s ok, 30 s degraded) |
| GET | `/api/readiness` | none | — | active playlist and asset, readiness, timers, adapter summary | Readiness |
| GET | `/sounds/uploads/*` | none | file name (slug pattern) | audio, cached a day | Uploaded cue sounds; defaults are static under `/sounds/` |

**State v2 payload** (`GET /api/screen/state`, built in `src/lib/screen/build-screen-state.ts`): version, time, readiness, scene decision; `active.base` (layer, kind, embed or media URL, start offset, image index, audio policy, ADVT slideshow and spotlight details, Ready check, timing); `active.overlay` (announce); active directives and compositor; ticker and its appearance; chrome and bar settings; a revision hash; sound settings, probe, check, stop and catch-up; the pending pizza cue. This is the main thing a port must keep or replace.

**Pages:** `/` (redirects to admin), `/screen` (the kiosk page, none; renders the first frame on the server, including PPTX slides), and the admin pages in [Features](#features): `/admin`, `/admin/login`, `/admin/link`, `/admin/content`, `/admin/schedule`, `/admin/ops`, `/admin/sounds`, `/admin/sounds/cue-test`, `/admin/triggers`, `/admin/diagnostics`.

**Auth details**
- **Admin password:** argon2 hash; a single global rate limit (5 failures in 15 minutes locks out everyone).
- **Sessions:** cookies `cs_admin_sid` and `cs_admin_bind` (HttpOnly, SameSite Lax, no `Secure`, browser-session); the DB stores only hashes peppered with the session secret, bound to the exact User-Agent; idle 60 minutes (sliding), absolute 12 hours.
- **Discord login link:** the bot signs a short-lived token (HMAC-SHA256; issuer the bot, audience the admin, instance id, unique id, Discord user and role ids; at most 10 minutes). Redeemed once (replay table) if a role id is allowed.
- **Control tokens:** one bearer per source (bot, stream, ops, emergency); compared with plain string equality.
- **Carousel token:** one separate bearer for the photo endpoints.
- **Auth config** comes from an env file outside the repo, overridden by process env; without the password hash, session secret and instance id, admin is closed.

### Discord commands and event handlers
None in this repo. It holds no Discord client. Discord reaches it only through the bot's HTTP calls: control directives and ticker, the carousel photo and spotlight endpoints, the trigger settings read, and signed login links. The commands that make those calls are in the canccubot inventory (#69).

### WebSocket and SSE channels
None. The kiosk polls HTTP every second; the admin sound desk polls every 1.5 s.

### Messages between the screen and embedded pages (postMessage)
All version 1, from the embedded signup-site page to `/screen`; checked for the frame's window, one hardcoded origin and the version. `/screen` never posts to the embed.
- `canccu:screen-ready` (optional view): the page has built its view shell; drives the Ready check.
- `canccu:screen-pages` (page count, index, page seconds): drives the page progress bar.
- `canccu:screen-cue` (cue id, source): a sound cue from the page (chips, strip cues, tournament moments); flood guard and coalescing apply.

The embedded display page takes URL parameters `view` (announce, active_poll, poll_result, game_banner or hot_game, tournament_leaderboard, stats, idle), `msg`, `sfx`, `bg_fade_ms`, `window_end` and the trigger thresholds. The contract docs for this live in the legacy system repo (see the canccuplatform inventory, #68).

### Bus events
There is no bus. State changes are structured log events (`src/lib/runtime/log.ts`): `advt.break.start` and `.end` (with a reason), `directive.set`, `.clear`, `.expire`, `.reject`, `readiness.transition`, `scene.decision`, `fallback.activated`, `worker.*`, `adapter.poll_cycle_failed`, `adapter.pizza_poll_failed`, `adapter.pizza_cue_issued`, `admin.login_link.failure` and `.replay`. Every warn or error event is also posted to an optional alert webhook. Candidates for the event catalog (#34): directive set and clear (the Moments input), ADVT break start and end, readiness change, pizza order state (consumed), tournament events (consumed), photo added and removed (from the bot).

### Scheduled and background jobs
| Job | Interval | Where | Writes |
|---|---|---|---|
| Adapter display poll | 180 s (and at start) | `src/lib/adapter/worker-loop.ts`, `poll-cycle.ts` | `adapter_snapshot`, `worker_heartbeat` |
| Tournament events and leaderboard poll | 60 s configured, but only checked inside the display cycle, so effectively 180 s | `poll-cycle.ts` | snapshot |
| Upstream health probe | 30 s configured, same gating | `poll-cycle.ts` | snapshot |
| Pizza status poll | 15 s | `worker-loop.ts`, `pizza-poll.ts` | `pizza_status` |
| Supervisor restarts | backoff 1 s to 30 s, at most 10 per role | `ops/phase1-supervisor/entry.mjs` | lock file |
| ADVT tick, directive expiry, ticker expiry, spotlight expiry, mute timer | not timers: run on every state read (each kiosk poll, mirrors and admin) | `screen-snapshot.ts` and the stores | ADVT state, session, directives and history, ticker, bookmarks, settings |
| History pruning (directives, Ready log, sound log, catch-up) | on every write and list | the respective stores | deletes rows past 7 days or 500 |
| Log rotation | daily or 10 MiB; rotated files kept 14 days | `log.ts` | log files |
| Kiosk timers | poll 1 s; progress ≤30 s; sound status ≤2 s; catch-up 1 s; Ready 8 s; scene ready 5 s | `public/scripts/screen-client.js` | POSTs only |

## Data
One SQLite file (WAL, foreign keys on). The schema is created and migrated in code on first open (`src/lib/runtime/db.ts`): `CREATE TABLE IF NOT EXISTS`, then column checks with `ALTER TABLE ADD COLUMN`; there is no version table. Some upgrades **drop and recreate** a table whose shape is old (`ticker_state`, `advt_playback_state`, `playback_session`), and two rebuild a table (`playlist_items` with foreign keys off to make duration nullable; `directives` to a composite key).

"Scope" says where the data would belong on the new platform: **event** (per tenant), **device** (per screen), **venue** or **global**.

| Table | Columns (meaning) | Scope today → proposed | Retention |
|---|---|---|---|
| `assets` | `id`, `kind` (image, pptx, video, web, youtube), `title`, `file_name`, `mime_type`, `storage_path` (file, or URL for web), `slide_count`, `duration_seconds`, `file_size_bytes`, `source_url`, `health_status`, `health_message`, Discord photo fields (`discord_message_id`, `discord_channel_name`, `discord_author_display_name`, `discord_posted_at`, `carousel_featured_shown`), `temporary`, replace-undo snapshot (`prev_storage_path`, `prev_file_name`, `prev_mime_type`, `prev_size`, `prev_slide_count`, `prev_duration`, `prev_item_snapshot`, `prev_at`), `created_at`, `updated_at` | global → event (an organizer may want a library shared across its events: question 3) | Until deleted |
| `playlists` | `id`, `name`, `priority`, `playlist_type`, `advt_enabled`, `advt_period_seconds`, `advt_break_duration_seconds`, `advt_assets_per_break` (unused), `advt_play_once`, `advt_window_start_minute`, `advt_window_end_minute`, `advt_playback_mode`, `advt_slideshow_dwell_seconds`, `advt_slideshow_transition`, `advt_slideshow_pan_zoom`, `advt_slideshow_shuffle`, `slideshow_randomize`, `slideshow_duration_seconds`, `slideshow_image_duration_seconds`, times | global → event (per zone, step 3) | Until deleted |
| `playlist_items` | `id`, `playlist_id`, `asset_id`, `position`, `duration_seconds` (empty = auto), `slide_start`, `slide_end`, `slide_duration_seconds` | event | Cascades |
| `schedules` | `id`, `playlist_id`, `day_of_week`, `start_minute`, `end_minute`, `priority` | event (per zone) | Cascades |
| `overrides` | `id`, `kind`, `playlist_id`, `asset_id`, `slide_number`, `expires_at`, `created_at`, `start_at_ms` | unused (drop) | — |
| `settings` | `key`, `value` (keys below) | global → event, some device | — |
| `adapter_snapshot` | singleton: `version`, `fetched_at`, `payload_json`, `display_last_success_at`, `updated_at` | global → event (feeds become events, step 9) | Overwritten |
| `worker_heartbeat` | singleton: `last_seen_at`, `last_cycle_at`, `last_error` | global (platform health) | Overwritten |
| `admin_sessions` | `session_id`, `subject_type`, `discord_user_id`, `discord_username`, `user_agent_hash`, `binding_secret_hash`, created, last seen, idle and absolute expiry, `revoked_at` | global → dropped (central sign-in, 0013 item 10) | Never pruned |
| `admin_consumed_login_links` | `jti`, `discord_user_id`, `consumed_at`, `token_expires_at` | dropped | Never pruned |
| `admin_auth_rate_limit` | `key`, `failure_count`, `window_start_ms` | dropped | — |
| `directives` | key (`source`, `label_key`), `band`, `sub_rank`, `kind`, `target`, `label`, `message`, `created_at_ms`, `expires_at_ms` | global → event (Moments, step 4), optionally per zone | Deleted on expiry |
| `directive_history` | `id`, `event_at_ms`, `action`, `source`, `label`, `target`, `kind`, `actor` | event | 7 days or 500 rows |
| `playback_bookmarks` | `playlist_id`, `playlist_item_id`, `offset_seconds`, `image_index`, `slide_number`, `updated_at` | per playlist → event per zone | Cascades |
| `ticker_state` | singleton: `message`, `source`, `set_at`, `expires_at`, `poll_expires_at` | global → event (optionally per zone) | Deleted on expiry |
| `pizza_status` | singleton: `payload_json`, `fetched_at`, cue fields (`cue_order_id`, `cue_keys_json`, `cue_id`, `cue_source`, `cue_issued_at_ms`, `cue_expires_at_ms`) | global → event (from pizza events) | Overwritten |
| `advt_playback_state` | `playlist_id`, `next_due_at_ms`, `advt_item_id`, `advt_offset_seconds`, `last_break_started_at_ms`, `updated_at` | per playlist → event per zone | Cascades |
| `playback_session` | singleton: `in_advt_break`, `advt_playlist_id`, `main_playlist_id`, `main_item_id`, `main_offset`, `main_image_index`, `main_slide_number`, `updated_at` | global → event per zone | Overwritten |
| `sound_log` | `id`, `event_at_ms`, `cue_id`, `source`, `outcome`, `reason` | event (per device for "on the PA") | 7 days or 500 rows |
| `sound_catch_up` | key (`event_id`, `cue_id`), issued, expires, resolved, `outcome`, `reason` | event | 7 days |
| `ready_log` | `id`, `event_at_ms`, `outcome`, `view`, `reason`, `elapsed_ms`, `visibility` | event per device | 7 days or 500 rows |

**`settings` keys:** `screen_chrome`, `screen_duration_bars`, `screen_duration_bars_opacity`, `ticker_appearance`, `ready_fallback`, `triggers_bot`, `triggers_lan`, `advt.minMainGapSeconds`, `advt.chainEndedAtMs`, `carousel_playlist_id`, `carousel_featured_dwell_seconds` (old name), `carousel_spotlight_duration_seconds`, `carousel_featured_break_cap_seconds`, `carousel_featured_effect`, `carousel_break_featured_item_ids`, `carousel_spotlight_pin`, `sound` (the whole sound board as JSON, plus the unmute deadline). All are per event on the new platform; the transient ones (`advt.chainEndedAtMs`, `carousel_break_featured_item_ids`, `carousel_spotlight_pin`) are runtime state, not settings.

**Files under the state root:** `sqlite/` (DB, restore staging), `backups/sqlite/` (created, written only by hand), `assets/` (uploads; a replaced file keeps its previous version for undo), `cache/pptx/<asset>/<version>/` (rendered slides), `tmp/` (render scratch), `sounds/` (uploaded cues), `logs/`. The auth env file sits outside it. Default sounds, fonts and the fallback image ship in `public/`.

**Browser storage (kiosk and admin):** once-per-source cue memory (7 days) in the kiosk's local storage; admin section collapse state and the schedule view choice.

**In-process memory (lost on restart, wrong with more than one process):** kiosk liveness, the armed sound preview, check and stop, kiosk audio presence, the pizza "seeded" flag, adapter metadata, transition-log state.

**What would belong to a venue rather than an event:** the kiosk browser and its audio output (today "the laptop"), the projector resolution (fixed 1920×1080 design), the PPTX fonts installed on the render host, the Tailscale trusted hosts, the venue time zone (today one global setting for schedules, ADVT windows, captions and pizza times), and the identity of "the screen" (implicitly the loopback browser). Everything else (playlists, schedules, assets, directives, sound settings, triggers) is per event.

## Configuration
Env vars; no secret values are given. Defaults marked "event value" are a real event's site or locale and must not be carried over.

| Name | Default | Meaning |
|---|---|---|
| `SIGNAGE_HTTP_PORT` | 4321 | Port; also used to build trusted origins |
| `SIGNAGE_STATE_ROOT` | `.local/canccusignage` under the working dir | State root |
| `SIGNAGE_DB_PATH` | `<root>/sqlite/canccusignage.db` | SQLite file |
| `SIGNAGE_SQLITE_BACKUP_DIR` | `<root>/backups/sqlite` | Backup dir (created, not used by code) |
| `SIGNAGE_SQLITE_BUSY_TIMEOUT_MS` | 5000 | SQLite busy timeout |
| `SIGNAGE_LOG_DIR` | `<root>/logs` | Log dir |
| `SIGNAGE_FILE_LOGS` | off | `1`/`true` writes JSON log files |
| `SIGNAGE_LOG_ROTATE_MAX_BYTES` | 10 MiB | Rotation size |
| `SIGNAGE_LOG_RETENTION_DAYS` | 14 | Rotated log retention |
| `SIGNAGE_ROLE` | `signage-web` | Role name in logs and alerts |
| `SIGNAGE_ALERT_WEBHOOK_URL` | unset | Warn and error log events are posted here |
| `SIGNAGE_TIME_ZONE` | event value (a European zone) | Schedules, ADVT windows, captions |
| `SIGNAGE_TRUSTED_ADMIN_HOSTS` | empty | Extra trusted hosts (tailnet IP and name) |
| `SIGNAGE_GIT_COMMIT` | build-time short SHA | Version in healthz |
| `SIGNAGE_INSTANCE_ID` | required for admin (example `default`) | Server identity in login links |
| `SIGNAGE_WEB_ASSET_ALLOWED_HOSTS` | loopback plus event value (site domain) | Web asset and directive target allowlist |
| `SIGNAGE_YOUTUBE_ALLOWED_HOSTS` | the YouTube hosts | YouTube allowlist |
| `SIGNAGE_BASELINE_WEB_URL` | event value (site display page); `none`, `off`, `false` or empty disables | Baseline web page |
| `SIGNAGE_BASELINE_WEB_DURATION_SECONDS` | 90 | Baseline item length |
| `SIGNAGE_BASELINE_WEB_AUTO_INSERT` | on when baseline is on | Auto-add baseline to new playlists |
| `SIGNAGE_BASELINE_WEB_TITLE` | a generic title | Baseline asset title |
| `SIGNAGE_CONTROL_TOKEN_BOT`, `SIGNAGE_CONTROL_TOKEN_STREAM`, `SIGNAGE_CONTROL_TOKEN_OPS`, `SIGNAGE_CONTROL_TOKEN_EMERGENCY` | unset (secret) | Control bearer per source |
| `SIGNAGE_CAROUSEL_TOKEN` | unset (secret; endpoints then refuse) | Carousel bearer |
| `AUTH_ENV_FILE` | a file under `/etc` | Admin auth env file |
| `ADMIN_PASSWORD_HASH` | required (secret) | argon2 hash |
| `ADMIN_SESSION_SECRET` | required (secret) | Pepper for session hashes |
| `ADMIN_SESSION_IDLE_TTL_MINUTES` | 60 | Idle timeout |
| `ADMIN_SESSION_ABSOLUTE_TTL_HOURS` | 12 | Absolute timeout |
| `DISCORD_LOGIN_LINK_HMAC_SECRET` | unset (secret) | Login link key |
| `DISCORD_ALLOWED_ROLE_IDS` | unset | Role ids allowed to sign in by link |
| `ADAPTER_CLOUD_BASE_URL` | empty (adapter off) | Signup site base URL |
| `ADAPTER_CLOUD_AUTH_MODE` | `public` | `public` or `bearer` |
| `ADAPTER_CLOUD_BEARER_TOKEN` | unset (secret) | Required for `bearer` |
| `ADAPTER_FETCH_TIMEOUT_MS` | 10000 | Upstream timeout |
| `ADAPTER_POLL_DISPLAY_MS` | 180000 | Display poll; heartbeat freshness is 3× this |
| `ADAPTER_POLL_TOURNAMENT_MS` | 60000 | Tournament poll (ineffective, see jobs) |
| `ADAPTER_POLL_HEALTH_MS` | 30000 | Health poll (ineffective) |
| `ADAPTER_POLL_PIZZA_MS` | 15000 | Pizza poll (missing from `.env.example`) |
| `CANCCU_CUE_TEST` | off | `1` enables the cue-test page and its extra origin |
| `NODE_ENV`, `VITEST_WORKER_ID` | — | Silence logs under test |

Names that look like config but are code constants: `ADAPTER_CONTRACT` and `ADAPTER_SNAPSHOT_VERSION` (adapter contract labels), `ADMIN_FLASH_SAVED_PARAM` and `ADMIN_FLASH_ERROR_PARAM` (flash query names), `AUTH_KEYS` (the list of auth env names read from the file).

**Config keys stored in the DB:** the `settings` keys above, plus the sound board: `muteAll`, `masterVolume` (0.8), `ambientGapMs` (30000, no UI), `queueStaleMs` (4000), `floodPerSourceMs` (10000), `floodMaxPerMinute` (20), `catchUpEnabled` (off), per category on/off and level (0.8; urgent 1.0; ambient 0.35), per cue on/off, level, cooldown and file. Triggers: bot `gameThreshold` (4), `bannerDisplaySeconds` (120), `bannerCooldownSeconds` (900), `pollHighlightSeconds` (60), `pollResultSeconds` (180), `announceDefaultSeconds` (60), `finalsOpenSeconds` and `finalsStartSeconds` (60, deprecated), `testMode`; display page `hot_game_min` (4), `busy_voice_min` (5), `spike_min` (5), `poll_result_line_min` (10), `tournament_soon_min` (30), `tournament_pre_min` (15), `finals_registration_min` (15), `finals_started_min` (10), `bg_fade_ms` (optional).

**Constants worth keeping as settings in the port:** directive TTL 120 s and maximum 7200 s, rejection retry 30 s, directive frame 15 s; readiness 240 s and 600 s; Ready timeout 8 s; fade 700 ms; image cap 2560×1440; upload caps (100 MiB, 100 files, sound 2 MiB and 30 s); history 7 days and 500 rows; kiosk liveness 5 s and 30 s; pizza (placed shown 10 minutes, last good 2 minutes, cue 60 s); sound command TTL 15 s, chip coalescing 2 s, catch-up spacing 30 s.

## External integrations
| Integration | Used for | Needs |
|---|---|---|
| **Signup site API** (adapter) | Display state (polls, announce, presence, voice, games, stats), tournament events and leaderboard, health, pizza status | Base URL, optional bearer token; GET `/api/display/state`, `/api/tournament/events`, `/api/tournament/leaderboard`, `/api/health`, `/api/pizza/status` |
| **Signup site display page** (embedded) | Baseline screen, display-page views for directives, Ready, pages and cue messages | Its host on the web allowlist; one hardcoded origin for messages; deployed together with signage when cues change |
| **Discord bot** (canccubot) | Directives and ticker, photo carousel and spotlight, trigger settings, login links | Control token (bot), carousel token, login-link HMAC secret and role ids, Tailscale reachability |
| **Stream service** | Stream directives (kind `stream`) | Control token (stream); the stream transport was never built (placeholder only) |
| **Emergency client** | Emergency directives | Control token (emergency); no UI sends one |
| **YouTube** | oEmbed probe; IFrame player API on the kiosk | Outbound HTTPS from the server and the kiosk |
| **LibreOffice and poppler** | PPTX to PDF to PNG | `soffice` and `pdftoppm` on the host, fonts installed on the host |
| **sharp** | Image resize and orientation | Native module |
| **jszip** | PPTX slide count | npm |
| **Alert webhook** | Warn and error events | A URL; no auth |
| **Tailscale** | Admin and control access from the bot and operators | Tailnet; scripts write trusted hosts into `.env` |
| **Windows host** | Edge in kiosk mode with autoplay and occlusion flags, started by a scheduled task; WSL2 with systemd | The venue laptop |
| **Files and media** | Uploads, PPTX cache, sounds; bundled placeholder sounds, a fallback image (a 1×1 placeholder) and OFL fonts | Local disk under the state root |

## Tests
104 test files with 693 declared test cases (715 at run time, since 8 parameterised blocks expand). The suite was run once on a copy of the repo in a temp directory (nothing written to the clone): all 715 pass in about 13 s, with none skipped, also with the OS time zone set to four different zones. Line coverage of `src/` is about 52 %; the configured thresholds cover only `src/lib/signage` and `src/lib/adapter` and CI does not enforce them. CI runs `astro check` and `vitest run` on every PR and push to main; no build, lint or end-to-end test.

About half the files are pure-logic unit tests; 53 open a temp SQLite file and state root; some need sharp, jszip or argon2. There are no fake timers (time is passed in), no DOM library (hand-made stubs) and no network (fetch is stubbed or injected). Route tests call the handler functions directly; the kiosk script is run in a Node `vm` with fake globals or read as text.

| Area | Test file | Cases | What it covers |
|---|---|---|---|
| Scheduler, ADVT | `advt-break-baseline.test.ts` | 5 | ADVT over the baseline page or a schedule; a schedule change waits for the break |
| Scheduler, ADVT | `advt-edit.test.ts` | 7 | ADVT status labels and edit form values |
| Scheduler, ADVT | `advt-play-once.test.ts` | 9 | Play-once: stop after the last item, cadence, cap, warning |
| Scheduler, ADVT | `advt-playback-mode.test.ts` | 8 | Simple vs slideshow settings, image-only rule, cursor reset |
| Scheduler, ADVT | `advt-schedule-summary.test.ts` | 8 | Predicted breaks, overlaps, daily window, zone |
| Scheduler, ADVT | `advt-scheduler.test.ts` | 8 | Priority, tie-breaks, chaining, next due, minimum gap |
| Scheduler, ADVT | `advt-slideshow-break.test.ts` | 12 | Dwell, overrun, ordered and shuffled, transitions |
| Scheduler, ADVT | `advt-transition-logs.test.ts` | 1 | Break and scene log lines |
| Scheduler, ADVT | `advt-window.test.ts` | 16 | Daily window, validation, its route, migration of an old DB |
| Scheduler, ADVT | `scheduler.test.ts` | 11 | Active schedule, slide clamping, frames (two tests are exact duplicates) |
| Scheduler, ADVT | `schedule-window.test.ts` | 19 | Overnight windows, day segments, move and resize, 24:00 |
| Scheduler, ADVT | `schedule-insights.test.ts` | 3 | Active playlist, next change, simulate |
| Scheduler, ADVT | `week-calendar-model.test.ts` | 7 | Calendar blocks, overlaps, now marker, legend |
| Playback | `playback-bookmark.test.ts` | 4 | Bookmark and session rows |
| Playback | `playback-offset.test.ts` | 2 | Offset maths for progress posts |
| Playback | `playback-timing.test.ts` | 10 | Scene and page timing for PPTX and slideshows |
| Playback | `video-segment-length.test.ts` | 4 | Auto vs manual vs default video slot |
| Playback | `video-real-length.test.ts` | 5 | Measured length on upload, item migration, ended report, player handling |
| Playback | `scene-resolver.test.ts` | 10 | Precedence decisions, readiness thresholds |
| Playback | `repository-screen-snapshot.test.ts` | 3 | Snapshot degrades after 240 s; web directive wins |
| Directives, ticker | `directive-store.test.ts` | 10 | Pins, keepalive, expiry, clear, rejection, compositor |
| Directives, ticker | `directive-precedence.test.ts` | 10 | Base choice, overlay, compositor |
| Directives, ticker | `directive-history.test.ts` | 6 | History rows, expiry rows, filter, pruning |
| Directives, ticker | `ops-directive.test.ts` | 5 | Ops preset and custom targets |
| Directives, ticker | `ticker-store.test.ts` | 5 | Set, expire, extend, clear |
| Directives, ticker | `ticker-appearance.test.ts` | 4 | Presets, custom values, CSS variables |
| Directives, ticker | `ticker-lan-preview.test.ts` | 3 | Preview URL and sample |
| Directives, ticker | `pizza-ticker.test.ts` | 11 | Pizza ticker text across a DST change, stale handling, precedence |
| Assets | `asset-batch-upload.test.ts` | 6 | Batch titles, per-file failures, cap |
| Assets | `asset-catalog.test.ts` | 5 | Search, paging, rename, delete refusal, usage |
| Assets | `asset-path-guard.test.ts` | 1 | Paths cannot leave the assets dir |
| Assets | `asset-replace.test.ts` | 8 | Same-name replace and revert, slide clamps, cache cleanup |
| Assets | `asset-upload.test.ts` | 5 | Upload validation |
| Assets | `image-orientation.test.ts` | 3 | EXIF orientation, display copy |
| Assets | `image-resize.test.ts` | 14 | Size cap, animated GIF, backfill dry run and apply (slowest file) |
| Assets | `pptx.test.ts` | 1 | Slide count |
| Assets | `pptx-render.test.ts` | 3 | Render guards and cache hit (renderer never run) |
| Assets | `playlist-builder.test.ts` | 17 | Item add, remove, reorder, settings, delete |
| Assets | `web-asset.test.ts` | 6 | Host allowlist, env override, registration |
| Assets | `baseline-web.test.ts` | 6 | Baseline default, disable, auto-insert |
| Assets | `lan-web-view-presets.test.ts` | 5 | Display-page preset items |
| Assets | `youtube-asset.test.ts` | 6 | Embed URLs, register and recheck |
| Assets | `youtube-oembed.test.ts` | 7 | Health classification, timeout |
| Assets | `youtube-playback-error.test.ts` | 9 | Error codes, bookmark advance, mirror no-op |
| Assets | `video-duration.test.ts` | 6 | MP4 and WebM length parsing |
| Sound | `sound-engine.test.ts` | 28 | Categories, queue, mute, emergency, occasions, repeat announce |
| Sound | `sound-board.test.ts` | 14 | Settings patch, log, sound check, preview, library |
| Sound | `sound-uploads.test.ts` | 6 | Upload, assign, 30 s limit, path guards |
| Sound | `screen-cue.test.ts` | 25 | Cue messages, chips, finals cues, cooldown, flood guard |
| Sound | `catch-up.test.ts` | 11 | Catch-up issue, expiry, kiosk decision |
| Sound | `tournament-cue-migration.test.ts` | 7 | Old cue ids, once-per-event memory |
| Sound | `pizza-cues.test.ts` | 13 | Pizza state to cue, restart silence, expiry |
| Sound | `cue-test.test.ts` | 5 | Cue-test switch, guard, extra origin |
| Sound | `audio-duration.test.ts` | 3 | Decoded vs metadata length |
| Admin helpers | `admin-content-helpers.test.ts` | 5 | Library and picker labels |
| Admin helpers | `admin-flash.test.ts` | 9 | Flash messages |
| Admin helpers | `admin-format.test.ts` | 5 | Dates and times in a zone |
| Admin helpers | `admin-section-collapse.test.ts` | 8 | Collapse state |
| Admin helpers | `admin-status-line.test.ts` | 4 | Status line |
| Admin helpers | `asset-library-preview.test.ts` | 3 | Thumbnails and preview nav |
| Admin helpers | `asset-preview-nav.test.ts` | 4 | Preview URL and wrap |
| Admin helpers | `calendar-pointer.test.ts` | 4 | 15-minute snap, drag maths |
| Admin helpers | `diagnostics-summary.test.ts` | 2 | Diagnostics cards |
| Admin helpers | `live-screen-preview.test.ts` | 4 | Mirror frame and scale |
| Admin helpers | `playlist-add.test.ts` | 2 | Added items |
| Admin helpers | `playlist-item-preview.test.ts` | 3 | Item thumbnails |
| Admin helpers | `playlist-list.test.ts` | 8 | Playlist rows and selection |
| Admin helpers | `replace-plan.test.ts` | 6 | Keep or replace planning |
| Admin helpers | `sequential-asset-upload.test.ts` | 4 | Client filter, sequential uploads |
| API, auth | `admin-api-advt-gap.test.ts` | 3 | Gap route |
| API, auth | `admin-api-advt.test.ts` | 3 | ADVT form route |
| API, auth | `admin-api-assets-upload-batch.test.ts` | 2 | Batch route |
| API, auth | `admin-api-assets-upload.test.ts` | 6 | Upload, name check, replace, revert routes |
| API, auth | `admin-api-playlist-settings.test.ts` | 3 | Playlist settings route |
| API, auth | `admin-api-playlists-create.test.ts` | 2 | Create route |
| API, auth | `admin-api-schedules.test.ts` | 3 | Schedules route |
| API, auth | `admin-auth.test.ts` | 7 | Password session, rate limit, login link checks, logout |
| API, auth | `middleware.test.ts` | 3 | Path and origin helpers (does not load the middleware) |
| API, auth | `trusted-origins.test.ts` | 4 | Trusted origins |
| API, auth | `control-api.test.ts` | 12 | Tokens per source, origin, TTL, keepalive, 409, label delete |
| API, auth | `integration-bot-control.test.ts` | 6 | Bot-style ticker, leaderboard, announce, delete flows |
| API, auth | `carousel-api.test.ts` | 16 | Photo add and remove, dedupe, clear, designate |
| API, auth | `carousel-auth.test.ts` | 2 | Carousel token separate from control tokens |
| API, auth | `carousel-featured-break.test.ts` | 9 | Featured first, cap, ring, captions |
| API, auth | `carousel-featured-settings.test.ts` | 3 | Featured settings route |
| API, auth | `carousel-spotlight.test.ts` | 13 | Spotlight pin, busy, temporary asset, TTL |
| API, auth | `trigger-settings.test.ts` | 12 | Trigger validation, display-page params, both routes |
| Adapter | `adapter-normalize.test.ts` | 10 | Unwrap, normalize, freshness |
| Adapter | `adapter-persistence.test.ts` | 2 | Snapshot and heartbeat round-trip |
| Adapter | `adapter-readiness-summary.test.ts` | 2 | Summary, no secrets leaked |
| Adapter | `worker-loop.test.ts` | 2 | Polls only when configured |
| Screen, kiosk | `build-screen-state.test.ts` | 9 | State v2 shape |
| Screen, kiosk | `kiosk-poll-liveness.test.ts` | 10 | Poll age thresholds, health shape |
| Screen, kiosk | `lan-display-pages.test.ts` | 3 | Pages message |
| Screen, kiosk | `lan-display-ready.test.ts` | 8 | Display-page detection, Ready message checks |
| Screen, kiosk | `mirror-mode.test.ts` | 7 | Mirror effects, referrer policy |
| Screen, kiosk | `ready-log.test.ts` | 4 | Ready log route, pruning |
| Screen, kiosk | `scene-transition.test.ts` | 11 | Fade rules; player copy kept in sync |
| Screen, kiosk | `screen-client-fetch-drain.test.ts` | 2 | Player drains response bodies |
| Screen, kiosk | `screen-cursor-hidden.test.ts` | 2 | Cursor hidden |
| Screen, kiosk | `should-arm-ready-check.test.ts` | 5 | Ready-check arming |
| Screen, kiosk | `should-assign-iframe-src.test.ts` | 3 | Frame reload rule |
| Screen, kiosk | `settings-store.test.ts` | 4 | Chrome and bar settings |
| Screen, kiosk | `ready-fallback-settings.test.ts` | 3 | Ready fallback settings |

**Gaps that matter for the port**
- **No browser or end-to-end test of the kiosk.** `public/scripts/screen-client.js` (2211 lines, the most-changed file) is covered only by text checks and two `vm` harnesses. Nothing tests rendering, embed messages, crossfades, video, YouTube or audio.
- **37 of the 55 route files never run in a test,** among them `/api/screen/state` and every other kiosk endpoint, `/api/asset`, `/api/pptx-slide`, `/api/health`, `/api/healthz`, `/api/readiness`, all sound admin routes, playlist items, reorder, priority, admin override and ticker. `src/middleware.ts`, `src/worker/entry.ts` and the uploaded-sound route are never loaded; no `.astro` page runs.
- **Auth:** password sessions, rate limit and login-link checks are tested at library level; the sign-in, sign-out and session routes, a disallowed role, cookie flags and session expiry are not.
- **PPTX rendering** never runs the real renderer; the worker poll cycle and snapshot merge have almost no tests; the admin client scripts (calendar editor, sound desk, picker, upload) have none.
- **Migrations:** only four are tested (ADVT window columns, nullable item duration, pizza cue columns, old cue ids).
- **Time:** tests pass explicit times; daylight-saving days are covered only for the pizza ticker, not for the week calendar (fixed 24-hour days).
- **Flake risks:** the image-resize tests take up to about 3 s each against the 5 s default timeout; three tests use real 5 ms sleeps.

These gaps are where the port should write tests first: the state payload, the tick and its side effects, and the device-facing endpoints with tokens.

## Known problems
### From the code
1. **Reads that write.** Every state read (kiosk, mirror, admin live screen) ticks ADVT, purges directives, expires the ticker and spotlight, freezes bookmarks (an UPDATE of every bookmark per poll while a directive is up), auto-unmutes sound and marks carousel photos shown. Viewers change shared state.
2. **One screen by design.** Singleton rows (`playback_session`, `ticker_state`, `pizza_status`, `adapter_snapshot`, `worker_heartbeat`), process memory for liveness and sound commands, bookmarks per playlist.
3. **Kiosk trust by Host header.** The loopback check on the screen endpoints reads the URL host, which a client controls; duplicated in six route files.
4. **Tokens** compared with non-constant-time equality; **cookies** without `Secure`; a **global** password rate limit; trusted origins are `http://` only and a form post without `Origin` is trusted; `/api/health` exposes the state root path; media and slide endpoints are open.
5. **Logic copied by hand** between the TypeScript helpers and the static kiosk script ("keep in sync" comments in about seven files).
6. **PPTX** converts the whole deck for each uncached slide, inside the `/screen` server render, with an in-process lock only.
7. **Adapter intervals:** the tournament and health intervals never take effect (checked only inside the 180 s cycle).
8. **Dead code:** the `overrides` table and the override branch of the resolver, `advtAssetsPerBreak`, three readiness reasons never produced, the stream scene ("awaiting transport").
9. **Hardcoded event values:** the display page origin (in the Ready and cue checks), the site domain in defaults, the time zone in three places independent of the setting, English pizza ticker copy naming Discord commands.
10. **Destructive in-code migrations** (drop and recreate on shape mismatch; a table rebuild with foreign keys off).
11. **Sound:** a queued cue without a file is logged as played; emergency clears state without stopping audio; PATCH of sound settings is not validated; the 30 s upload limit contradicts the 10 s in the glossary and the "over guide" flag can never fire; the MP3 duration parser handles constant bit rate MPEG-1 Layer III only; the sound log mixes reason codes and sentences.
12. **Admin:** invalid JSON gives a 500 on four PATCH/POST routes; some forms work only with JavaScript; a table header with one column missing; heavy use of `confirm`, `alert` and `prompt`.
13. **Unbounded growth:** sessions and consumed login links are never pruned; the PPTX cache only on delete or replace.
14. **Placeholders:** the fallback image is 1×1; the 10 bundled sounds are 4 distinct files copied (several categories sound the same).
15. **No TODO or FIXME comments** anywhere; the only markers are two `@deprecated` notes.

### From the commit history and docs
| Commit | Date | Problem |
|---|---|---|
| `7f3fe1c` | 2026-06-17 | The framework's CSRF check broke admin over Tailscale (Windows to WSL forwarding); replaced by the trusted-hosts list |
| `e72d151` | 2026-06-17 | Adapter crashed on its first poll (a missing import) |
| `395b59a` | 2026-06-30 | Dev server refused tailnet hostnames used by the bot's integration tests |
| `5f08356` | 2026-07-02 | Ticker marquee flashed mid-loop |
| `436d7c2` | 2026-07-22 | Stream and bot directives got stuck (dead stream base); "Clear all overrides" added |
| `74e29ea` | 2026-07-23 | The signup site's serverless worker hit CPU limits; display poll slowed to 180 s |
| `cae0b10` | 2026-09-29 | Slideshow zoom restarted on every poll |
| `262f9a3` | 2026-09-30 | ADVT-only breaks forced offline readiness |
| `a8564e9` | 2026-10-01 | Large PPTX slides clipped |
| `cb60987` | 2026-10-03 | The Ready timer re-armed every poll, showing the fallback wrongly |
| `ea6d5da` | 2026-10-03 | Readiness thresholds too tight for the 180 s poll |
| `c5ef413` | 2026-10-04 | Broken or private YouTube embeds stalled playback |
| `8ab229d` | 2026-10-06 | A wrong import depth broke the venue build |
| `3b2db66` | 2026-10-11 | Ready messages missed: the sender posted late or inside animation frames that never run in hidden frames |
| `38e675c`, `1031acc`, `58c1a10` | 2026-10-16 to 19 | Sound: wrong queued outcomes; a reload replayed the last preview; a repeated announce was silent (two found in rehearsal) |
| `a4b4d40` | 2026-10-20 | Kiosk froze when a YouTube video ended early |
| `986dc8b` | 2026-10-21 | 24 dependency vulnerabilities, some critical; the upgrade forced a newer Node |
| `0ea05a2` | 2026-10-21 | healthz said down when no kiosk polled outside an event |
| `454eb74` | 2026-10-22 | Bookmark offset double-counted (up to 30 s ahead per save) |
| `ceedc5a` | 2026-10-22 | PPTX slide position lost on resume |
| `0de2f3b` | 2026-10-25 | **Kiosk browser resource leak** on Windows: unread response bodies held shared memory; fixed by draining them |
| `82e8e77` | 2026-10-25 | Huge photos strained the GPU; upload cap and a one-time resize |
| `2d2b497` | 2026-10-27 | Videos used a 30 s default length; now their real length (a table rebuild) |
| `6da8d19` | 2026-10-28 | Play-once ADVT wrapped instead of ending |
| `f244844` | 2026-10-29 | Schedule preview ignored the ADVT daily window |

Fragile parts recorded in the docs: the kiosk goes black or silent without the browser's occlusion and autoplay flags; signage and the signup site must be deployed together when cues change (otherwise a double or missing sound); the Ready check depends on the site's sender; the sound engine bundle is a build artifact that can be stale; SQLite tests fail on native Windows; uploads outside the repo are lost with a new state root; daily backups were a goal and were never automated. Doc inconsistencies: the precedence order differs across three docs, carousel defaults differ across two, the sound length limit differs, the backup runbook assumes a state path and a CLI the laptop does not have, and two runbooks disagree on remote admin. Open lists: a full sound test on the venue PA, rehearsal items never tested (stream with announce overlay, uploaded cues, spotlight, mirror silence), the unresolved stream transport.

## Port recommendation
Verdicts: **as-is** (port the code and its tests, inject clock, zone and storage), **with changes**, **rewrite**, **drop**. Steps refer to the [roadmap](../roadmap.md). Rows not in the roadmap's porting plan are marked **(new)** for the summary (#76).

| Feature | Verdict | Reason | Target module | Step |
|---|---|---|---|---|
| Schedule windows and active-schedule choice | as-is | Pure, well tested | screen | 3 |
| Playback engine, timing, bookmark maths | as-is | Pure; keep the "elapsed since saved" model | screen | 3 |
| Bookmark and session storage | with changes | Key by tenant and zone, not per playlist or singleton | screen | 3 |
| ADVT window, gap, slideshow maths, shuffle | as-is | Pure | screen | 3 |
| ADVT scheduler tick | with changes | Split the pure decision from the writes; run it once per zone on the server, not on every read | screen | 3 |
| Scene precedence and resolver, readiness timers | as-is | Pure; drop the dead override branch | screen | 3 |
| Snapshot orchestration (`screen-snapshot.ts`) and state v2 shape | rewrite | Side effects on read, globals; keep the v2 shape as the starting point of the screen contract (#35) | screen | 2c, 3 |
| Playlist builder, item and schedule validators (zod), duration parsers | as-is | Pure | screen | 3 |
| Asset upload validation, image normalize, video length parser, PPTX slide count | as-is | Pure or near-pure | screen | 3 |
| Asset catalog, replace and undo with slide clamps | with changes | Logic worth keeping; storage moves to Postgres and the files volume per tenant | screen | 3 |
| PPTX rendering | with changes | A render-job container: convert a deck once, all slides, stored outputs; fair per-tenant queue (0013 item 27) | screen | 3 |
| YouTube normalize, oEmbed health, player error rules | as-is | Pure | screen | 3 |
| Web asset allowlist | with changes | Allowlist per tenant, not env | screen | 3 |
| Baseline web page and display-page presets | with changes | Event values become tenant settings; no auto-registration on read | screen | 3 |
| Ready check, pages message, scene transitions, mirror, iframe and referrer rules | with changes | Origin per tenant setting; one shared source for server and player instead of copies | screen | 3 |
| Kiosk player | with changes | Keep scene slots, unlock and retry, body draining; add the device token, drop loopback trust and Windows-only assumptions | screen | 3 |
| Screen page first render and snapshot serving | rewrite | Astro-specific; render no PPTX in the request | screen | 3 |
| Device identity, liveness, health | rewrite | Does not exist (loopback browser, process memory); devices, zones and health per 0013 item 34 | screen | 3 |
| Directive model, bands, precedence, history | with changes | Becomes the Moments ranking; bands become settings (porting plan); scope per tenant and zone | moments | 4 |
| Control API for directives and ticker | with changes | Becomes events and the Moments API; per-sender tokens dropped (0010) | moments | 4 |
| Ticker store and appearance | with changes | Manual ticker stays (0010); per tenant | moments (lane), screen (appearance) | 4 |
| Sound engine, categories, occasions, screen cues, catch-up hold, once-per-source | as-is | Pure and well tested; cue catalog becomes data per tenant | moments | 4 |
| Sound settings, sound log, catch-up store, uploads | with changes | Postgres and files volume per tenant; validate PATCH | moments | 4 |
| Sound board commands and kiosk presence | rewrite | Process memory; per device on the server | moments | 4 |
| Cue-id migration | drop | Old cue ids exist only in the legacy DB, which is not migrated (0004) | — | — |
| Photo carousel and featured breaks **(new)** | with changes | Bot photo events instead of a bearer upload; per tenant | screen (bot sends events) | 3, 6 |
| Spotlight **(new)** | with changes | A Moments takeover rather than its own pin | moments | 4 |
| Pizza ticker and cues | with changes | Consume `pizza.order.*` events instead of polling; ticker copy from the profile | screen, moments | 5, 9 |
| Adapter: display state, tournament, health polls | rewrite | Becomes event consumers (porting plan); normalizers and freshness rules kept as the spec | screen | 9 |
| Trigger settings for the bot and display page **(new)** | with changes | Bot thresholds belong to the bot's settings schema; display-page parameters to the display page | bot, screen | 6, 9 |
| Admin pages | rewrite | Astro and string-HTML clients; the pure view-models (week calendar, schedule insights, ADVT overlap, replace plan, diagnostics summary, status line, flash) are kept | admin, screen | 3 |
| Admin auth (password, sessions, login links, rate limit) | drop | Central Discord sign-in and rights (0010, 0013 item 10) | — | 1, 2b |
| Diagnostics, readiness and health endpoints | with changes | Per-tenant status view (0013 item 28); healthz follows the platform contract | screen | 3, 10 |
| Alert webhook and log events | rewrite | Logs tagged with the tenant; alerts as events (step 8) | kit, admin | 8 |
| Runtime and SQLite layer, in-code migrations | drop | Postgres migrations with the kit (0010) | — | — |
| Supervisor, systemd, Tailscale scripts, Windows kiosk setup | drop | Containers and the hosted VM (0010, 0011) | — | — |
| Backfill CLIs (resize, video length) | drop | No legacy data is migrated (0004); the same logic runs at upload | — | — |
| Cue-test page | with changes | Keep as a test fixture, not a page in production | moments | 4 |
| Stream directive kind | drop for now | Never built; Cast is its own track | cast | Parallel |
| Design tokens and fonts | with changes | Become the demo theme (theming contract, #54); OFL licence kept | ui | 2b |
| Mockup pages, docs | drop | Never import legacy docs (0002) | — | — |

## Tenancy questions
What this repo implies for the tenancy design (#48), screens and Moments. For the product owner to confirm.

1. **Time zone per event or per venue?** Today one setting drives schedules, ADVT windows, photo captions and pizza times (and three hardcoded copies). Proposal: the venue has a zone; an event may override it.
2. **What does a schedule mean across events?** Schedules are weekly (day and minute), not dated. For a multi-day event per tenant that is fine; should the port add dated windows, or keep weekly windows inside the tenant's live period?
3. **Asset library scope:** per event only, or also per organizer so a sponsor loop is reused across events? The 0013 model has no organizer level; per event is the default.
4. **Zones and the singleton state:** bookmarks, ADVT state, the playback session, the ticker and directives are single today. Which are per zone (playback, ADVT, bookmarks) and which per event (ticker, directives with an optional zone target)? This shapes the screen contract (#35).
5. **Who drives the tick?** Today every reader drives it. On a shared stack one server-side scheduler per zone must own it, so a mirror or admin view never changes state.
6. **Sound per device:** the PA is a device property. Is sound played on every device of a zone, one chosen device, or per zone setting? Once-per-source memory is in one browser today; it should move to the server per device or zone.
7. **Emergency directives:** per event, or venue-wide for every event at the venue (a venue emergency affects all screens there)? If venue-wide, who may send one: the superadmin only?
8. **Embedded display page origin:** each tenant names its own display page origin (for Ready, pages and cue messages) and web allowlist. Confirm these are tenant settings, not platform config.
9. **Photo carousel channel:** which Discord channel feeds a tenant's carousel is a bot feature setting per tenant; confirm the carousel stays a Screen feature fed by bot events.
10. **Kiosk identity versus device tokens:** today the kiosk is "the loopback browser". The new device token plus venue IP model replaces it; confirm that the admin live screen (mirror) needs only an admin session, not a device.
11. **Fonts for PPTX:** fonts installed on the render host decide how decks look. Per tenant (uploaded with the theme) or platform-wide?
12. **Retention:** histories are kept 7 days or 500 rows. Per tenant for the life of the event, then archived with the tenant?

## Event-specific content
Counted by kind; no values here. The exact locations (legacy `file:line`) are in the PR body for a follow-up in the event repo. Nothing below was copied into this doc.

| Kind | Count (lines) | Where (by area) |
|---|---|---|
| Event site domain or origin | about 90 in docs; 14 in code, config, CSS and mockups; 2 commit messages | Defaults in code (baseline URL, web allowlist, Ready and cue origin, display-page host set), `.env.example`, admin pages, CSS comments, mockups, 36 doc files |
| Event name (brand) | 2 doc lines, 1 commit, 5 mockup lines | Docs, mockup page |
| Event date or season | 3 doc lines, 1 commit | Cutover worksheet, a rollback template |
| Time zone (event locale) | 3 in code and config, 11 in 7 doc files | Runtime default, pizza status, kiosk fallback, docs |
| Tailnet name and host names | 3 in config, 8 in docs, 1 commit | `.env.example`, Vite config, Tailscale runbook, startup runbook |
| IP addresses (tailnet, WSL internal) | 1 in config, 5 in docs | `.env.example`, Tailscale and admin runbooks, cutover worksheet |
| Venue host alias (also a legacy repo name) | 10 doc lines | Agent guide, runbooks, a plan |
| Personal OS user and home paths | 7 in deployment, about 12 in docs | systemd unit, deployment README, runbooks, cutover worksheet |
| Personal names and handles | about 10 doc lines; author identities in commits | Area docs, specs, cutover worksheet |
| Laptop paths and scheduled-task names | about 20 doc lines, 1 in the kiosk script | Startup runbook, sound docs |
| Game title (finals season cues) | 7 in code | Sound board copy, cue test, triggers and ops pages |
| Local-language sample content | 3 in code, 2 in docs | Ticker preview sample, weekday playlist names, a poll sample |
| Host evidence (kernel, versions, real asset and playlist ids) | about 15 doc lines | Cutover worksheet |
| Private repo links and deploy hashes of the site | about 10 doc lines | Area docs, control runbook |
| In tests | event site domain in about 25 files, time zone in 8, personal first names in 4, a pizzeria name in 2, a tailnet IP in 1, an internal host name in 1 | Fixtures and assertions on the hardcoded defaults; the port's tests use demo values |
| Discord ids, role names, channel names | none real | Only generic references |
| Pizzerias, venue name or address | none | — |
