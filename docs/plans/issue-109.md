# Plan: issue #109 — the Pulse player with push updates

Package `screen-pulse-player`, branch `109-feat-screen-the-pulse`. Step 3, wave 4 of the brief's package order ([step-3-screen.md](../briefs/step-3-screen.md#package-order-a-sketch-for-the-planner)). Sources of truth: the step 3 final plan (`docs/briefs/step-3-screen.md`, `## Plan`: L2, L3, L8–L13, U4, U6, U7, D3, D12, D16, E1, E3, E4, E8, E11, E13, O1–O3, O9, P5, P6), mockups [02](../briefs/step-3-screen/02-pulse-main.svg), [03](../briefs/step-3-screen/03-pulse-portrait.svg), [04](../briefs/step-3-screen/04-pulse-claims.svg), [05](../briefs/step-3-screen/05-device-states.svg), [06](../briefs/step-3-screen/06-flow-pairing.svg) and [16](../briefs/step-3-screen/16-flow-offline.svg), `contracts/screen.md` with `contracts/screen.openapi.yaml` and `contracts/screen/*.openapi.yaml`, `contracts/theming.md`, `contracts/agenda.md`, `contracts/notify.md`, the accepted plans [issue-108.md](issue-108.md) and [issue-190.md](issue-190.md), the lead's added criterion on #109 (the stream delivers `takeCommands` as `command` messages and reads the zone's `epoch`), and main at d7607b1. This plan changes no contract and no code.

## Why a plan first
1. **Size.** About 8,700 changed lines (below), almost six times the package limit of about 1,500. Workers do not split issues; the lead does ([AGENTS.md](../../AGENTS.md#how-work-flows)).
2. **Half the widgets' sources are not on main.** The composed state draws what other modules and other screen issues serve:
   | Needed by #109 | Built by | State on 2026-11-10 |
   |---|---|---|
   | `playlist` widget: the tick's position, playlists, push, break playlists | #216 | open, ready |
   | Files and slides the playlist plays (`/api/screen/files/…`, `/api/screen/renders/…`) | #217, #224 | open, ready |
   | `ticker` and `photo` widgets, `screen.ticker.changed`, `screen.photo.*` | #218 | open, ready |
   | `checkin_qr`: `GET /internal/notify/check-in/code` | #227 (in PR #270) | open |
   | `embed` widget: the same-host sandbox | #186 (in PR #276) | open, awaiting accept |
   | Theme templates (the parsed tree) and the pinned revision (`GET /internal/theming/revisions/{revision}`) | #245, #241, #246 | open, blocked |
   | The `moved` frame: `GET /api/screen/device/home`, `POST /api/screen/device/transfer` | #221 | open, ready |
   On main today: devices, pairing, zones (with `epoch`), assignments and `takeCommands`, heartbeat and health, the pure scheduler and playback engine, the agenda's `GET /api/agenda/now`, tenants' venue info, and theming's `GET /api/theming/current` (layouts, tokens, logo; `templates` always empty).
3. **Four things the issue asks for have no contract yet** (below, G1–G4). Building them now would mean making up paths and fields, outside a worker's Room to design.

## Proposed contract gaps
All additive, in one contract PR (normal risk, [0024](../decisions/0024-additive-contract-docs-normal-risk.md)) that merges before any slice uses them.

| # | What is missing | Proposed additive change |
|---|---|---|
| G1 | **A zone's live state for a session.** The virtual-screen route (this issue) and Studio's Live multi-view (#189, U7) need a zone's state and stream for a signed-in person; the contract says "the admin's live view is a mirror for a session with `screen.devices.read`" but gives it no path. `POST …/zones/{zone_key}/preview` is a one-shot answer for an unsaved zone | `GET /api/screen/zones/{zone_key}/state` and `GET /api/screen/zones/{zone_key}/stream` (right `screen.devices.read`; `?orientation=portrait`): the zone's `ScreenState` and push messages as a mirror's (`device` `{"id": "mirror", "name": <zone name>, "mirror": true}`, no sound, no `command` messages, no heartbeat). `checkin_qr` is the sample without a code, as in preview, so a phone in someone's pocket never carries the live code out of the room. At most 20 open session streams per session (429 `rate_limited`) |
| G2 | **Motion.** L3 says motion per theme (moderate default, calm in quiet hours, reduced motion honoured). The theme has no motion token and the state says nothing about quiet hours | A theme token `motion` (`moderate` default, `calm`, `none`) in `theme.schema.json` and theming.md's token table. `ScreenState.display.motion` (`moderate`, `calm`, `none`): the theme's value, lowered to `calm` while a public `quiet_hours` agenda item of the zone runs (agenda.md: an event without such items has no quiet hours). A change reaches screens as a `state`. The player lowers it again to `none` under `prefers-reduced-motion: reduce` |
| G3 | **Burn-in drift.** L11 says optional; there is no setting | A screen setting `burn_in_drift` (boolean, `false`) and `ScreenState.display.drift` (boolean). When on, the player shifts the whole layout by at most the theme's `safe_inset` / 4 in a slow cycle (one step a minute, a full cycle in an hour), from the server clock so mirrors agree |
| G4 | **The parsed template tree.** `ScreenState.theme.templates[].template` is "object"; the player must render it, and the player's own default templates must have the same shape so a theme template replaces a default one-for-one | theming.md defines the tree theming serves (#245 builds the parser): nodes `{"el", "class", "attrs", "children"}`, `{"text"}`, `{"var": "a.b"}`, `{"section": "name", "inverted": bool, "children"}`, with the allowed elements and attributes as they are today. Recommendation: in this contract PR, so #245 and the player build to one shape |

Alternatives: G1 could reuse `GET /api/screen/device/state` with `?mirror_zone=` and a session; rejected because device paths check device token and venue address, and mixing in sessions there blurs the one rule they keep. G2 and G3 could be fixed in the player with no contract (always moderate, never drift); that drops two of the issue's criteria.

## Design (holds for every slice)
| # | Decision | Reason |
|---|---|---|
| S1 | **One composed state per zone, built on the server and cached in Valkey** (`t:<tenant>:screen:zone:<key>:state`, with `state_version` and the change log); per-device parts (`device`, `sound`, `sound.sounded_claims`) are added when a device reads it. A builder is a pure function of its inputs (zone, layout, theme, view-models, claims, time) | Every screen of a zone agrees; 100 screens cost one build; pure code is tested without a stack |
| S2 | **Bus events → affected zones → rebuild → diff → messages.** One consumer per tenant stream maps each event type to the zones and widgets it touches (`agenda.item.*` → `agenda_now`, `countdown`, `idle: next`; `tenants.venue_info.changed` → `venue_info`; `theming.theme.published` → `theme`; `screen.zone.saved` → `state`; `moments.override.*` → claims). It coalesces changes for up to 100 ms, then diffs the new state against the cached one and emits the smallest messages (`widget`, `region`, `ticker`, `theme`, else `state`) | The contract's message set; O2's 1 s budget leaves ~900 ms for the network and the bus |
| S3 | **SSE fan-out across containers through Valkey pub/sub** (one channel per tenant and zone); the change log is a Valkey stream per zone trimmed to 5 minutes, which serves `Last-Event-ID` resume. Commands come from `takeCommands` (`src/assignments.ts`) on connect and on a per-device channel, as `command` messages | Containers keep no state; resume and commands work whichever container a screen reconnects to |
| S4 | **The player is plain TypeScript and DOM, no framework,** bundled with esbuild into one ES module and one CSS file per version, served at `/screen/b/<version>/` (immutable) with `/screen/` a tiny loader that picks the pinned or current version. The screen module copies its bundle into the shared files volume at start and keeps the last 5 versions plus any pinned or restored one | A kiosk runs one page for days: a small, framework-free page leaks less (the legacy's drained-bodies fix comes with it); the repo has no client framework; retention is in the contract |
| S5 | **Templates render from the tree (G4), never from strings** (`createElement`, `textContent`, attribute allow-list). The player ships a default template for every widget and claim template in the same tree, used when the theme has none | theming.md's rule; the default theme draws with no templates until #245 |
| S6 | **Rotation, countdowns and the clock run on the device from `cycle_started_at`, the dwell list and the clock offset from the heartbeat's `server_time`;** a claim ends at its `expires_at` or `ends_at` on the device too | Mirrors agree, also offline (contract: Composed state) |
| S7 | **Region transitions use two slots, load then fade** (the legacy scene transition), `none` motion swaps at once; the ticker is one calm line that fades between texts (L13, `ticker_appearance`) | Ported technique, proven on the venue kiosk |
| S8 | **Device-state frames are the player's own pages,** drawn from the answer codes: no cookie → pairing (code and QR of the pair dialog, built in the browser, contract Pairing); `zone: null` → not assigned (name); stream lost → the small "offline since" mark (`canccu-is-offline` after 10 s); 403 `venue_ip_refused` → refused, with the steps E4 names; `tenant.status` `archived` → archived notice (E8); 409 `device_moved` → `device/home` and the transfer; 401 `device_unknown` → pairing. Each frame uses the platform's mark (L6), the event's name and the theme's tokens | Never blank (principle 1); mockup 05 |
| S9 | **A service worker scoped to `/screen/`** caches the bundle by version, the last `ScreenState` (Cache Storage, not localStorage), the files it names and `prefetch`, and evicts files no longer named; on a cold boot without network the loader draws the last state and marks it offline | E11; not offline-first: nothing new starts offline |
| S10 | **Sound:** video plays with sound only when `sound.enabled` (the zone's sound device) and audio is unlocked; the check page unlocks it once with a tap and the heartbeat reports `audio_unlocked` | L12; the legacy's audio unlock |
| S11 | **Resolution:** the layout's grid is drawn in CSS grid at the screen's size; type scales with the viewport height (`clamp` on `vh`), images pick 1080p or 4K renditions by `devicePixelRatio × viewport`. Tests and screenshots at 1920×1080 and 3840×2160, landscape and portrait; nothing below 1080p | L9 as changed in the session |
| S12 | **Claim placement is a pure function** of the zone's layout roles and its active claims (the contract's algorithm, tie-breakers and `hidden`/`unplaced`), fed in step 3 by fixture `moments.override.*` events; it emits `screen.claims.changed` only when placement changes | P5; deterministic, so screens agree and regions do not flap |
| S13 | **Widgets whose source is not on main render `empty: true`,** like `hot_game`, `bracket`, `leaderboard`, `food_status`, `stats` and `now_playing`, and each fills in when its source issue merges (the slice table says which) | The issue's own rule for missing sources, so the player does not wait on six other issues |
| S14 | **The kiosk guide** is `docs/screen-kiosk.md` (Chromium flags the legacy found: autoplay without a gesture, no first-run and no translate bars, no throttling of background timers, kiosk mode, disabled pinch zoom), and the check page is `/screen/check` (audio unlock, the clock offset against the server, the viewport and DPR, the device's state) | E1; the legacy's black and silent screens came from browser flags |

## Size by area (source plus tests, estimated)
| Area | Ported (legacy) | New | Estimate |
|---|---|---|---|
| A. Composed-state builder: layouts (built-ins, theme, fallback), region roles, rotation with seeded shuffle, idle rules (`next`, logo, event name), view-models for `clock`, `agenda_now`, `countdown`, `venue_info`, `qr` (server SVG), `logo` and the empty types; `GET /api/screen/device/state` | `build-screen-state`, `scene-resolver` ideas | 1,500 | 1,500 |
| B. Push: the bus consumer, coalescing, diff, the Valkey change log and pub/sub, `GET /api/screen/device/stream` with resume and ping, commands; the demo-stack latency test (p95 under 1 s) | — | 1,100 | 1,100 |
| C. Claims: the `moments.override.*` consumer, placement, expiry, steps, `screen.claims.changed`; fixture events and tests | — | 700 | 700 |
| D1. Player core: bundle build, `/screen/` loader and `/screen/b/<version>/`, retention, Caddy route, CSP; state and stream client with backoff and poll fallback; heartbeat and clock offset; device-state frames | `screen-client.js` techniques, `kiosk-poll-liveness`, fetch drain | 1,400 | 1,400 |
| D2. Player rendering: grid, regions, template tree renderer, default templates for 15 widgets and 4 claim templates, rotation, transitions, motion (G2), drift (G3), ticker, 1080p/4K, portrait | `scene-transition`, `ticker-appearance` | 1,500 | 1,500 |
| E. Content widgets: `playlist` playback (image, video, slides, web with ready timeout and fallback, YouTube), sound device; `photo`, `ticker` feed, `checkin_qr`, `embed` | YouTube rules, ready check | 900 | 900 |
| F. Offline service worker; virtual-screen route (G1); kiosk guide and check page | — | 800 | 800 |
| G. Accelerated soak with a heap budget, the 100-screen two-event load script, the real 24-hour run's script and report | — | 800 | 800 |
| **Total** | | | **≈ 8,700** (≈ 8,900 with the lead's additions below) |

## Proposed split (for the lead)
Each slice one issue and one package of about 1,500 lines or less. Normal risk, unless it changes `.github` (high).

| Slice | Content | Needs |
|---|---|---|
| 0. Contract (normal), #303 | G1–G4 | — |
| 1. Composed state, #109 (≈ 1,600) | A; criterion 1 (builder, roles, rotation, idle) and the server half of criterion 3 for the widgets whose sources are on main; the lead's L3, L5 and L6 below (`ScreenState.theme`, `GET /api/screen/now`, the schedule window's layout fallback) | — |
| 2. Push, #304 (≈ 1,200) | B; criterion 2, the lead's `takeCommands` and `epoch` criterion, and L1 below (`state_lag`, an open stream counts as seen) | slice 1 |
| 3. Player core, #305 (≈ 1,400) | D1; criterion 5 (every device-state frame) and the offline mark of criterion 7; `moved` waits on #221 or shows "moved, ask the crew" until it lands | slice 2, #221 for the transfer |
| 4. Player rendering, #306 (≈ 1,500) | D2; criterion 6 (20 m, resolutions, motion, drift, ticker) and the client half of criterion 3 | slice 3, slice 0 (G2–G4) |
| 5. Claims, #307 (≈ 700) | C; criterion 4 with the claim templates drawn by slice 4's renderer; L2 below (`claims_sounded` kept for `sound.sounded_claims`) | slices 1, 4 |
| 6. Content widgets, #308 (≈ 900) | E; the rest of criterion 3; L4 below (the `embed` widget through `embedWidget()`) | slice 4, #216, #217, #218, #224, #227, #186 |
| 7. Offline, virtual screen, kiosk, #309 (≈ 950) | F; criteria 7, 8 and 10; the preview path (question 7); L4 below (sandbox files cached offline like revision files) | slice 4, slice 0 (G1) |
| 8. Soak and load, #310 (≈ 800) | G; criterion 9 (the real 24-hour run is the lead's on the test VM before the step's exit). High if it adds a CI job under `.github`; normal if it runs inside `scripts/demo-stack-test` | slices 2, 4; a second event on the CI stack |

Slices 1–4 run in order; 5, 6 and 7 can run in parallel after 4; 8 last. #189 (Live), #191 (screenshots) and #265 (bundle retention) wait for slices 4 and 7 rather than all of #109. The issue's criteria map: 1 → slice 1; 2 → 2; 3 → 1, 4 and 6; 4 → 5; 5 → 3; 6 → 4; 7 → 3 and 7; 8 → 7; 9 → 8; 10 → 7.

## Questions
1. **Split:** split #109 into slices 0–8 above (or a coarser set), or keep one issue and accept a package of about 8,700 lines? Recommendation: split as above.
2. **G1 (a zone's state and stream for a session):** add it, so the virtual-screen route and #189's Live use one path? Recommendation: yes, in the contract PR.
3. **G2 and G3 (motion and drift):** add the theme token `motion`, `ScreenState.display` and the setting `burn_in_drift`? Recommendation: yes; quiet hours come from the agenda's `quiet_hours` items, so no new setting is needed for them.
4. **G4 (the template tree):** define it now in theming.md, ahead of #245? Recommendation: yes, so the player's defaults and #245's parser meet.
5. **Content widgets:** wait in slice 6 for their sources (#216, #217, #218, #224, #227, #186), or let slices 1–4 ship them `empty` and slice 6 fill them? Recommendation: ship them `empty` first (S13); slice 6 waits.
6. **Two events on the CI stack:** the load script (O1) needs 100 screens across two events, and the IP-mode stack serves the demo tenant only. Add a second demo tenant to `deploy/compose.ci.yml` in slice 8, or a separate issue? Recommendation: in slice 8, as CI data only.
7. **The preview path** (`POST /api/screen/zones/{zone_key}/preview`): build it here, or leave it to #189? Recommendation: here, in slice 7 with the virtual screen (both draw a zone for a session); it is a few lines on top of slice 1's builder, and #189 then only draws it. It moved from slice 1 to slice 7 when L3 and L6 put `GET /api/screen/now` and the layout fallback into slice 1.

## Added to scope (the lead, 2026-11-10)
From worker notes; each goes to the slice issue named when #109 is split.

| # | Criterion | Slice | Note |
|---|---|---|---|
| L1 | The composed state adds `state_lag` to `DeviceHealth` from the zone's state version, and an open stream counts as seen by moving the device's deadline as a heartbeat does (PR #266) | 2 | The stream knows the zone's `state_version` and the device's connection; `health.ts` keeps its deadline rule, the stream calls it on connect and on each `ping` |
| L2 | Keep the heartbeat's `claims_sounded` for `sound.sounded_claims` (Moments, step 4); the route validates and drops them for now (PR #266) | 5 | `sound.sounded_claims` stays `[]` until step 4; slice 5 tests that the route still validates and drops them |
| L3 | Paired screens get the theme through screen (`ScreenState.theme`), since theming cannot check a device token (PR #232) | 1 (server), 4 (player) | Slice 1 reads the revision in effect as a module and fills `ScreenState.theme`; the player takes its tokens, CSS, logo and templates only from there and never calls theming's API (S1, S5) |
| L4 | Render the `embed` widget with `embedWidget()` and cache sandbox files offline like revision files (PR #276) | 6 (render), 7 (offline) | Needs #186 (PR #276) merged; the service worker (S9) treats sandbox files as immutable, as it does the theme's revision files |
| L5 | `GET /api/screen/now` (the hub's view of a zone) comes out of slice 1's builder (PR #281) | 1 | The builder's view-models filtered to the contract's list, `now_playing` names only for a signed-in member |
| L6 | An unknown `layout_id` on a schedule window falls back to `pulse`, as the contract says (PR #282) | 1 | The builder's one layout rule: window, then zone, then theme or built-in, then `pulse` (`pulse_portrait` on a portrait device) |

The sizes in the split above include these: slice 1 is about 1,600, slice 2 about 1,200, slice 7 about 950; the total stays ≈ 8,900.

## Answers (the lead, 2026-11-10)
All as recommended; the lead approved the technical plan and the product owner the split.
1. **Split:** slices 0–8. Slice 1 (composed state) is #109 itself; slice 0 is #303, 2 is #304, 3 is #305, 4 is #306, 5 is #307, 6 is #308, 7 is #309 and 8 is #310. #189, #191 and #265 wait on #306 and #309.
2. **G1:** yes, in the contract PR (#303).
3. **G2 and G3:** yes: the theme token `motion`, `ScreenState.display` and the setting `burn_in_drift`; quiet hours come from the agenda's `quiet_hours` items.
4. **G4:** yes, the template tree goes into theming.md now (#303).
5. **Content widgets:** ship them `empty` first; slice 6 (#308) waits for their sources.
6. **Second CI tenant:** in slice 8 (#310), as CI data only.
7. **Preview path:** in slice 7 (#309).

## After the answers
The lead rewrites #109 and opens the slice issues as the answers decide; each slice then runs as a package against this plan's design table.
