# Plan: issue #108 — the content engine

Package `content-engine`, branch `108-feat-screen-the-content`. Step 3, wave 1 of the package plan. Sources of truth: `contracts/screen.md` with `contracts/screen.openapi.yaml` and `contracts/screen/content.openapi.yaml` as merged in #201, the step 3 final plan (`docs/briefs/step-3-screen.md`, `## Plan`), and the kit as on main at fea795f. This plan changes no contract; it names the contract gaps the lead has to settle first.

## Why a plan first
1. **Size.** The package plan already says this issue alone passes the package limit. In numbers, it is about 10,000 changed lines (estimate below), roughly seven times the limit of about 1,500 ([AGENTS.md](../../AGENTS.md#how-work-flows)). Most of that is the legacy code and tests the issue asks to port "with its tests as the spec". Workers may not split an issue, so the lead decides how to split it.
2. **No screen module yet.** `modules/screen/` is empty on main. This package would create it, while #107 (devices and zones, high risk, not started) builds on the same module and owns the zones that the content's windows, pushes and break playlists name.
3. **A contract gap.** The 2 GB storage quota per event, raised by the superadmin, has no contract: no field holds it, no path raises it, no error code refuses an upload over it, and theming's packages count against the same quota (`contracts/theming.md`). Under the contract rules the gap is closed in its own PR, merged before any code uses it.
4. **CI is `.github/`.** CI runs each module's checks by name (`.github/workflows/ci.yml`). Without a CI change the screen module's tests never run in CI, and a CI change makes a package high risk.

## Size by area (source plus tests, estimated)
Legacy figures are from `~/legacy/canccusignage` (TypeScript). Ported code shrinks a little in adaptation (clock, zone and storage injected; legacy-only branches dropped).

| Area | Legacy code | Legacy tests | New code and tests | Estimate |
|---|---|---|---|---|
| A. Module skeleton: Fastify on `@canccu/kit`, `pg`, migration runner, Dockerfile, Compose service, Caddy routes, README, health (`postgres`, `valkey`, `files`), settings declaration | — | — | 450 | 450 |
| B. Weekly windows and the winner choice; agenda-bound windows; simulate; daylight-saving tests | 400 | 810 | 350 | 1,450 |
| C. Playback engine and bookmarks (timing, "elapsed since saved", double-counted offset and lost slide position fixes) | 940 | 550 | 100 | 1,500 |
| D. Break playlists: window, gap, scheduler, chaining | 640 | 840 | 100 | 1,450 |
| E. Break playback: modes, play-once, slideshow, seeded shuffle | 400 | 1,730 | 100 | 2,000 (tests trimmed to ≈ 1,500) |
| F. Persistence and the tick: playlists, schedule windows and their validators, the per-zone tick (bookmarks in Postgres), push content, `agenda.*` consumer, simulate route | 200 | 300 | 1,100 | 1,500 |
| G. Assets I: upload, content checks, image normalisation, video and audio probes, content-addressed files, reference-counted delete, serving, quota | 470 | 650 | 500 | 1,500 |
| H. Assets II: replace and revert, name-check, YouTube normalisation and oEmbed health, web assets behind `screen.web` and `web_allowlist` | 900 | 570 | 150 | 1,500 (asset-catalog adapted, not copied) |
| I. Ticker and ticker windows; photos API with upload, new photos first | 690 | 650 | 300 | 1,400 (carousel tests trimmed to the API) |
| **Total** | **≈ 4,600** | **≈ 6,100** | **≈ 3,150** | **≈ 12,750, ≈ 10,000 after trimming** |

## Design (holds for every split)
| # | Decision | Reason |
|---|---|---|
| D1 | **TypeScript:** Node 22, Fastify 5, `pg`, vitest, on `@canccu/kit` with `@canccu/kit/fastify`, the same pins and lint setup as `modules/hello` | [0006](../decisions/0006-stack.md) makes TypeScript the module default; the legacy code and its vitest tests then port almost line for line, which is what "ported with its tests as the spec" asks. kit-ts already has tenancy, RLS helpers, rights, service identity and the Fastify adapter |
| D2 | **Migrations:** a `runMigrations` in kit-ts, the same behaviour as kit-py's `run_migrations` (ledger table `screen_migrations`, advisory lock, app role `canccu_screen_app`, grant to the login role), added in slice A | kit-ts has no runner yet; agenda and later TypeScript modules need the same one, so it belongs in the kit, not in each module |
| D3 | **Tables, all per tenant under RLS** (`TENANT_COLUMN_SQL`, `rlsSql`): `assets`, `asset_versions` (the current one and the kept undo version), `files` (sha256, ext, bytes, per tenant, the reference count's subject), `playlists` with `playlist_items`, `schedules`, `scheduler_state` (per zone: bookmarks, break state), `pushes`, `ticker` (one row), `ticker_windows`, `photos`, `agenda_items` (the screen's copy of each item's id and current `starts_at`/`ends_at`/state). The only global screen table, `devices`, is #107's and already on the allow-list | 0013 items 5–7; containers keep no state |
| D4 | **Zone keys are references to #107's zones.** Content stores `zone_key` strings; existence is checked against #107's `zones` table once it lands, and #107's `zone_in_use` reads the content tables | Zones, their revision and `screen.zone.*` events are #107's (Out of scope here) |
| D5 | **One tick per tenant and zone**, every second, in every container, each zone's tick guarded by a Valkey lock (`tenantKey("screen", "tick", zone)`, a few seconds TTL), so exactly one container advances a zone. The tick alone writes bookmarks and break state; reading state or simulate never writes | The brief's "reads that write was the legacy's worst design flaw"; several containers may run |
| D6 | **The scheduler core stays pure:** clock, zone and storage are injected (`now`, the zone's windows, the bookmark store), so the ported tests run unchanged in shape and the daylight-saving tests pass a time zone and fixed instants around both switches in `Europe/Berlin` and `America/New_York` | The brief's "port as is, with clock, zone and storage injected"; E12 |
| D7 | **Agenda-bound windows** follow `agenda.item.added`, `.changed`, `.delayed`, `.started`, `.ended`, `.cancelled`, `.removed` into `agenda_items`; on start, and when `agenda_version` jumps by more than one, the module reads `GET /api/agenda/items` again as a module | The kit's bus has no consumer groups yet ([0006](../decisions/0006-stack.md) consequences), so a restart would otherwise miss events; `contracts/agenda.md` defines the re-read |
| D8 | **Video:** MP4 (H.264 or H.265 video, AAC or no audio) and WebM (VP8, VP9 or AV1 video, Opus, Vorbis or no audio) only, probed with `ffprobe` at upload; anything else is refused 400 with a message naming what was found and what to export instead ("This file is QuickTime with ProRes video. Export it as MP4 (H.264)."). Audio: MP3 or OGG, ≤ 2 MiB, ≤ 30 s. Images through `sharp`: EXIF orientation applied, metadata dropped, at most 2560×1440 | D8 of the final plan; the legacy huge-photo fix; the image needs `ffprobe` (Debian `ffmpeg` package in the runtime stage) |
| D9 | **Files** are content-addressed under `tenantFile("screen", "files/<sha256>.<ext>")`, written to a temporary name and renamed; a file row is deleted, and the file unlinked, in the transaction that removes its last reference (asset version, render, photo, claim sound) | The contract's "deleted only when nothing of the tenant refers to it"; no partial file is ever served |
| D10 | **Decks:** a `pptx` or `pdf` upload is stored and listed with `render: pending`; submitting the render job is #184's | #184 owns the render job (Out of scope) |
| D11 | **Settings** declared in `modules/admin/declarations/screen.yaml` as in the contract's Settings list; read with the kit's `SettingsClient` | The admin settings API is the contract's source of settings |

## Proposed split (for the lead)
Each slice is one issue and one package of about 1,500 lines or less, normal risk unless named. The legacy modules each slice ports, with the tests that come with them, are listed so the PR can name them as the issue's last criterion asks.

| Slice | Content | Ports (code → tests) | Needs |
|---|---|---|---|
| 0. Contract (normal) | The storage quota: where it lives, how the superadmin raises it, the error code, how screen and theming count against one quota; the video refusal code | — | — |
| A + B | Skeleton (D1, D2, D11); weekly windows, the winner, agenda-bound windows (pure), simulate (pure), daylight-saving tests | `scheduler.ts`, `schedule-window.ts` → `scheduler.test.ts`, `schedule-window.test.ts` | — |
| C | Playback engine and bookmarks | `playback-engine.ts`, `playback-bookmark.ts` → `playback-bookmark.test.ts`, `playback-offset.test.ts`, `playback-timing.test.ts`, `catch-up.test.ts` | A + B |
| D | Break window, gap and scheduler | `advt-window.ts`, `advt-scheduler.ts`, `advt-gap-settings.ts` → `advt-window.test.ts`, `advt-scheduler.test.ts` | C |
| E | Break playback modes, play-once, slideshow, seeded shuffle | `advt-playback.ts`, `slideshow-playlist.ts` → `advt-play-once.test.ts`, `advt-playback-mode.test.ts`, `advt-slideshow-break.test.ts`, `advt-break-baseline.test.ts` | D |
| F | Persistence, the tick (D5), playlists and schedules API with validators, push content, the `agenda.*` consumer (D7), the simulate route, `break` playlists per zone with their region | `playlist-repo.ts`, `schedule-repo.ts`, `api-schemas.ts` (adapted) → `admin-api-schedules.test.ts`, `admin-api-advt.test.ts`, `playlist-builder.test.ts` (rules only) | E, #107's zones |
| G | Assets I (D8, D9), quota | `asset-upload.ts`, `image-resize.ts`, `image-orientation.ts`, `video-duration.ts` → `asset-upload.test.ts`, `image-resize.test.ts`, `image-orientation.test.ts`, `video-duration.test.ts`, `video-real-length.test.ts`, `audio-duration.test.ts` | A + B, slice 0 |
| H | Assets II | `asset-replace.ts`, `asset-catalog.ts`, `youtube-asset.ts`, `youtube-oembed.ts`, `web-asset.ts` → `asset-replace.test.ts`, `asset-catalog.test.ts`, `youtube-asset.test.ts`, `youtube-oembed.test.ts`, `web-asset.test.ts` | G |
| I | Ticker and ticker windows; photos API with upload | `ticker-store.ts` (kept in Postgres), `carousel/photos.ts`, `carousel/playlist.ts` → `ticker-store.test.ts`, `carousel-api.test.ts` (API part) | G (photos are files) |
| CI (high) | The screen module's checks and its Postgres tests in `ci.yml` | — | A + B |

Order: 0 and A + B in parallel; then C → D → E and G → H, I in parallel; F once E and #107's zones are merged. The issue's criteria map to the slices as: scheduler → B, C, F; playlists and assets → F, G, H; push and `break` playlists → D, E, F; photos → I; ticker → I; quota and shared files → 0, G; ported modules named → every slice.

Not ported, by the brief: `ticker-appearance.ts` beyond the four preset names (the player's), the carousel spotlight and featured break (Moments, step 4), directives (Moments), `baseline-web.ts` and the LAN presets (dropped), `measure-existing-videos.ts` and `resize-existing-assets.ts` (backfill CLIs, dropped).

## Questions
1. **Split:** split #108 into the slices above (or a coarser set the lead prefers), or keep one issue and accept a package far over the limit? Recommendation: split as above.
2. **Stack:** TypeScript (D1), or Python like the tenants and admin modules? Recommendation: TypeScript, by 0006 and because the legacy tests port as they are.
3. **The kit's migration runner (D2):** add it to kit-ts in slice A + B, or let the module carry its own until a kit issue does it? Recommendation: in the kit, in slice A + B.
4. **Storage quota (slice 0):** which module owns the quota and the usage count across screen and theming? Recommendation: tenants holds `storage_quota_bytes` (default 2 GiB) on the tenant, raised on the superadmin's tenant path, and each module reserves bytes through an internal tenants path before it writes a file and releases them when it deletes one; an upload over the quota is 413 `storage_quota_exceeded`.
5. **Zones (D4):** may slice F wait for #107's zones, or should the skeleton add a placeholder `zones` table? Recommendation: F waits; no placeholder, since zones are high risk and #107's.
6. **CI:** one small high-risk package that adds the screen module (and agenda's, if it is also new) to `ci.yml`, or a generic step that runs every module that has checks? Recommendation: the generic step, once, so later modules need no `.github/` change.

## After the answers
The lead rewrites #108 and opens the slice issues as the answers decide; each slice then runs as a normal package against this plan's design table.

## Answers
The user approved this plan on 2026-11-09, with every recommendation above: split #108 into the slices, TypeScript, the migration runner in kit-ts, the quota held by tenants with reserve and release, slice F waits for #107's zones, and one generic CI step.
