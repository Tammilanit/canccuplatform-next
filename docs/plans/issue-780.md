# Plan: issue #780: announcements that pop and stay alive

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task by task in this session (the dispatcher's flow; no subagents). Steps use checkbox (`- [ ]`) syntax. Start only after the PO has accepted the sheets below and the lead has answered [the questions](#questions-for-the-lead-and-the-po).

**Goal:** announcements say "look at me": three levels (Info, Important, Urgent), a placement the organiser picks (rail, hero or full screen), a role-based place on every layout with the grow rule, a full screen that stays alive for minutes, and phone looks that mirror the level.

**Architecture:** Moments keeps deciding *what* an announcement asks for: its level, its placement, its chain of roles, and its content (icon, art, second line, end time). Screen keeps deciding *where* it lands. Its placement walk learns two additive Override fields: `hero_min_share` (the grow rule) and `keep_ticker` (the ticker runs under a non-emergency full screen). For a full-screen announcement it composes the nearby content (`aside`). The player draws the new looks and motion from the claim's `starts_at`, so every screen of a zone is in the same beat. The phone's cards come from a new guest read of Moments' live announcements, drawn on the hub's front door ("What's on").

**Tech stack:** TypeScript (Fastify, the screen player), Postgres under RLS, vitest (with a real `*_test` Postgres), Python (Starlette) for Notify's front door, pytest, Playwright for the CI shots.

**Spec:** [issue #780](https://github.com/Tammilanit/canccuplatform-next/issues/780) (the PO's decisions of 2026-11-23 and its acceptance criteria), against [contracts/moments.md](../../contracts/moments.md#announcements-115) and [contracts/screen.md](../../contracts/screen.md) (Layouts and regions, The hero role and the showcase, Moments drive it: claims) as on main at ac3781c.

## Why a plan first
- **The issue asks for it:** design first, a script-built pack of key sheets that the PO accepts (`manual-accept`), then the build. The sheets are below; `scripts/pack-page docs/plans/issue-780.md --out issue-780.html` builds the page.
- **Size:** about 4,700 changed lines (below), past the package limit of about 4,000. The issue says "the lead may split it"; a worker may not, so Q1 proposes the split.
- **Six choices the issue leaves open** touch the contracts or an earlier PO rule (Q2–Q7).

## What already exists (and is kept)
- **Roles, not pixels:** Screen already maps regions to roles (`hero`, `rail`, `ticker`, `full`, …) by a zone's `regions.<id>.role`, the region's id, or `main`/`side`. Every built-in already has the roles the issue lists (Pulse hero 8×10 and rail 4×6; Split 7×10 and 5×5; Hero 12×10 and the bottom strip; Dashboard 4×5 boxes; Ambient centre 10×6 and the strip 10×2; Portrait 6×6 and 6×3). A custom layout already "only has to say which region is hero and which is rail". **No new mapping mechanism is needed;** the work is the grow rule, the ticker under full screen and the looks.
- **The 2 × 2 grow** is Screen's showcase: any claim placed in the hero region grows Dashboard's hero to 8×10 cells, keeps `rail` and one more box at 4×5 beside it, and pauses the rest (`compose/showcase.ts`). Sheet 3 draws exactly that.
- **Chains degrade:** a layout without a rail sends `["rail", "ticker"]` to the ticker already.
- **The 90 s floor, queue and gap** (#777) apply to every hero claimant, so Important gets them by taking the hero.

## Size by part (source plus tests, estimated)
| Part | What | Lines | Risk |
|---|---|---|---|
| A. Contracts and server | `contracts/moments.md` and `moments/announcements.openapi.yaml` (the level, the placement, the icon, the live read), `contracts/screen.md` and `screen.openapi.yaml` (`hero_min_share`, `keep_ticker`, `aside`, the view-model's new fields), the migration, Moments' chains, cues and the pizza rule, Screen's placement and compose | 1,900 | high (both contracts; the issue says so) |
| B. The player | the announcement templates per level and role, the entrances, the full screen's motion, the living details, the readability floors, reduced motion; the CI shots | 2,000 | normal (one module's internals) |
| C. The phone and the composer | the guest read, the front door's cards and banner, the composer's level, placement and icon controls, push on by default for Important and Urgent | 800 | normal |
| **Total** | | **≈ 4,700** | **high** |

## Global constraints
- **Additive only:** no field, value, path or event is removed or renamed. `full_screen` stays (deprecated, kept consistent with `placement`); `level` gains `important` beside `info` and `urgent`. If any change turns out to be breaking, stop: it would need its own PR, merged first (AGENTS.md, Contracts).
- **Migration:** `modules/moments/migrations/010_announcement_look.sql`, `ADD COLUMN` only: `moments_announcements.placement text NULL`, `moments_announcements.icon text NULL`, `moments_announcement_templates.icon text NULL`. No drop, rename or type change.
- **Readable across a hall:** at 1080p, wherever an announcement card is drawn other than in the ticker, its title is at least 6 % of the screen height (65 px) and its body at least 3.5 % (38 px). Label, title and body share one left edge. Contrast stays computed per ground.
- **The ticker keeps running** under Info and Important in every placement; under Urgent and the emergency the instruction takes the ticker's place.
- **Motion follows the zone's level** (`none`, `calm`, `lively`, `party`) and `prefers-reduced-motion` (the player's `none`). Every timed effect counts from the claim's `starts_at` on the server clock, so screens agree and a reload lands in the same beat.
- **No internal words on screens:** no level codes, ids or cue names in text a person reads.
- The demo event only, in fixtures and shots. English throughout.
- About 400 lines per source file; `templates.ts` (400), `claims.css` (373), `widgets.css` (398), `player.ts` (390) and `hero.css` (439) take no growth. New looks go in new files (`announce.css`, `announce-motion.ts`). Never add a size exemption.
- The comment rule: comment the why, never the what.

## Decisions (the reviewer checks these)
| # | Decision | Reason |
|---|---|---|
| D1 | **Levels:** `info`, `important` (new), `urgent`. The PO's third row, "Urgent / emergency", is the `urgent` level in amber and the Emergency button in its fixed red. Both are full screen on every zone, a hard cut, a pulsing border, the urgent sound, no decoration | The PO's table has three levels; the Emergency button (`POST /emergency`) keeps its own path and rank 100 |
| D2 | **Placement:** `Announcement.placement` (`rail`, `hero`, `full`, or null for the level's default: Info `rail`, Important `hero`, Urgent `full`). `full_screen: true` on input means `placement: full`; when both are sent, `placement` wins. Answers carry both, with `full_screen` = (`placement` is `full`) | The organiser picks; the level only sets the default |
| D3 | **Chains:** `rail` → `["rail", "ticker"]`; `hero` → `["hero", "full", "rail", "ticker"]` for Important and Urgent, `["hero", "rail", "ticker"]` for Info; `full` → `["full", "hero", "rail", "ticker"]`. Ticker lines (`channels.ticker`) are unchanged | A hero too small for Important falls to full screen (D4); everything still degrades |
| D4 | **The grow rule, in Screen:** an Override may carry `hero_min_share` (0–1, or null). For such a claim the `hero` role counts as offered only if the hero region's share of the layout grid's cells is at least that: its own area, or, on a zone with `grow_for_showcase: true` whose hero can grow, its grown area (`showcase.ts`'s growth, computed without placing anything). Otherwise the walk tries the claim's next role. Moments sends `0.35` for Important and Urgent in `hero`. Built-ins: Pulse 56 %, Split 49 %, Hero 83 %, Ambient 42 %, Portrait 38 % fit; Dashboard is 14 %, grown 56 %, so it grows, or goes full screen with growing off | The PO's "about 40 %", set at 35 % so Portrait's biggest box counts (Q5); Screen knows the layout, Moments does not |
| D5 | **The ticker under full screen:** an Override may carry `keep_ticker` (boolean, default false). A placed `full` claim with it leaves the regions whose role is `ticker` drawn, and a lower claim in the `ticker` role is placed, not hidden. `_full` then spans the grid less the ticker's rows when the ticker spans the grid's full width along its top or bottom edge; otherwise the ticker draws above `_full` (layer 12). Moments sets it for Info and Important at full screen, never for Urgent or the emergency | "The ticker keeps running under every announcement except an emergency" |
| D6 | **The instruction band:** at Urgent and the emergency the `announcement` template draws its own bottom band with the body (or `ticker_line` when set) in the ticker's place, on every layout, also on Hero and Ambient, which have no ticker | "The ticker carries the instruction" with no claim race over the ticker |
| D7 | **The view-model** (`announcement`, additive): `level` adds `important`; new `placement`, `icon` (`info`, `wifi`, `food`, `trophy`, `clock`, `door`, `search`, `megaphone`; default `info`), `art` (`kind` `food` or `game`, `url` or null; null for none), `expires_at` (the time bar), `countdown_at` (or null: a time-bound one counts down to it), `second_line` (or null: the second beat's text), `qr` (the existing per-view-model `qr`, here the details' link). "Posted 3 min ago" is drawn from `starts_at` | Living details and art by source, from the claim alone |
| D8 | **Where they come from:** the composer's icon picker (a template carries an icon: `starting_soon` clock, `food` food, `lost_found` search, `doors_close` door); `countdown_at` = the run-of-show item's start for an announcement sent with `when.mode: item`; `art`, `second_line` and `qr` from the source. Pizza is here: `level: important`, `icon: food`, `art: {kind: food}`, `second_line` "Collect at {pickup}", `qr` the order's hub page. A finals announcement from the tournament rule, once it has one, `art: {kind: game, url: <cover>}` | The PO's "pizza art for Food, the game's art for a tournament" |
| D9 | **Nearby content** (`aside`, additive on the state's `Claim`): for a placed `full` claim with template `announcement` at Info or Important, Screen composes `aside`: the zone's `food_status` view-model when the override's `source.module` is `pizza` and the food box has content, else the zone's `agenda_now` view-model. The template draws the clock itself (the device clock, as `clock` does) and the claim's `qr` | The issue's "clock, now and next, a QR, or the source's own status"; only Screen holds those view-models |
| D10 | **Entrances** (player, per level and motion level): Info slides in and glows the frame for 2 s; Important's 1 s break-in dims the rest of the screen to 55 %, scales the card from 0.9 with one sweep in the theme's `accent`, and plays its cue; Urgent and the emergency cut hard. `calm` fades instead of sliding and scaling, with no sweep; `none` cuts every one | The PO's table |
| D11 | **The full screen stays alive** (Info and Important, full): at `lively` and `party` a slow gradient drift (one cycle per 120 s), soft particles in the accent (`party` 26, `lively` 14), and a breathing glow on the frame (8 s). Re-emphasis every 25 s from `starts_at`: the title pulses once (0.8 s) and the sweep replays at 40 %. The second beat: `second_line` fades in at 12 s past each 30 s for 8 s. `calm`: no particles, glow and drift at half pace, re-emphasis a soft fade, the second beat fades. `none`: nothing moves; the second line stays shown under the body; "Posted …", the time bar and the countdown still update, as values | The PO's five points; reduced motion follows the level |
| D12 | **The look:** announcement blocks keep one left edge (badge or label, title, body, details) in every role, also in the hero, where the step 4 hero rule centred them; the other hero templates stay centred. A card in a region has no inner box (amendment 3). The frame takes the level's colour: Info `primary`, Important `accent`, Urgent amber, emergency red | The PO: "label, title and body sit on one grid with one left edge" (Q4) |
| D13 | **Sound:** a new built-in cue `announce.important` (category `attention`, the `chime-bright` sound, picture `sweep`), added to the seed catalogue as the `story.*` cues were; Info keeps `announce.attention`, Urgent `announce.urgent` | "One sound" per Important break-in |
| D14 | **Phone, read:** `GET /api/moments/announcements/live` (no right; it follows the event's info-page mode as the hub's other reads do): the live announcements whose `channels.screen` is on, newest first, each `id`, `level`, `title`, `body`, `icon`, `art`, `sent_at`, `expires_at`, `zones`. Nothing about who sent it | The hub's announcements read the contract left for later ("a read for the hub comes with the App track") |
| D15 | **Phone, looks** on the front door's "What's on" (`modules/notify`, the hub's start page until the App track's Now): Urgent a full-width banner pinned above everything until withdrawn; Important a large card at the top with its art and time bar; Info a quiet row above Now and next. One left edge, the theme's colours, no box inside a box | The PO's phone table; the hub has no Now page yet (Q6) |
| D16 | **Push:** the composer's "Push to phones" is on by default for Important and Urgent, off for Info; the organiser can switch it. Notify's `announcements` topic already sends it, urgent for Urgent | The PO: "Important: a push" (Q7) |
| D17 | **Composer:** the level as three chips (Info, Important, Urgent), the placement as a three-way switch (Rail, Hero, Full screen) that follows the level until the organiser touches it, the icon as chips; Preview shows the chosen placement in the real player | No typed values; the existing preview |

## Contract changes (all additive)
| Contract | Change |
|---|---|
| `contracts/moments.md`, `moments/announcements.openapi.yaml` | `level` adds `important`; `placement`, `icon` on `Announcement`, `AnnouncementInput` and `AnnouncementTemplate`; `full_screen` deprecated (kept); the chains of D3; Important's cue; Pizza is here becomes Important with its art, second line and QR; `GET /api/moments/announcements/live` |
| `contracts/screen.md`, `screen.openapi.yaml` | Override: `hero_min_share`, `keep_ticker`; placement rules for both; `Claim.aside`; the `announcement` view-model's new fields and `level` value; the instruction band; the motion of D10–D11 under Motion and burn-in drift |
| `contracts/notify.md` | The hub table's Announcements row names the live read |

## Questions for the lead and the PO
Each has a recommendation; the plan above follows it.
- **Q1. Split.** Three PRs in order, A → B → C, from branches not linked to #780 (`pkg-780-<part>`), bodies `Part <n> of #780` and `Refs #780`; only C says `Closes #780`. A merges first because B and C read its fields. *Recommended:* yes. Alternative: A+C (≈ 2,700) then B (≈ 2,000).
- **Q2. Dashboard's other boxes.** The PO said "the other boxes shrink to headlines". The design guideline's amendment 2 says a showcase never squeezes the rest into headline strips: two boxes stay at full size beside the grown hero (the rail first), the rest pause. *Recommended:* keep amendment 2, as sheet 3 draws it.
- **Q3. Urgent and the emergency.** One look (sheet 5): Urgent in amber, the Emergency button in red. Urgent stays in the `announcement` class (rank 80), so a `stream` (90, the Cast track, later) would still degrade it. *Recommended:* yes; a `Roadmap note:` for the stream.
- **Q4. One left edge in the hero.** The step 4 hero rule centres the hero's block; the PO now wants one left edge. *Recommended:* left edge for announcements only (sheets 2–4); other hero templates stay centred.
- **Q5. "About 40 %".** *Recommended:* 35 % of the grid's cells, so Portrait's hero (38 %) and Ambient's (42 %) take Important in place; only Dashboard grows.
- **Q6. Where the phone shows them.** The hub's Now does not exist yet; the front door's "What's on" is the hub's start page. *Recommended:* there (sheet 6), and the App track's Now takes the same three looks later.
- **Q7. Push for Important.** *Recommended:* on by default for Important and Urgent, a switch the organiser can turn off.

## Review focus
- **Two announcements at once:** an Important in the hero and a second one queued behind it: the second waits (the #777 queue), its Info sibling in the rail is unaffected. Test in Task A3.
- **A zone with `hidden` regions or custom `area`s:** the grow rule reads the composed regions after areas and hides, not the layout's. Test in Task A2.
- **An edit of a live Important** (`PATCH`): no new break-in, no new sound, "Updated" chip; the re-emphasis clock keeps counting from `starts_at`. Test in Tasks A3 and B2.
- **A long title** at 4K and in portrait: it steps down to fit but never under the 6 % floor; past the floor it wraps to a second line. Test in Task B1.
- **Withdraw while full screen:** the screen goes back to the rotation at once (no exit animation blocks the ticker). Test in Task B2.

---

## Part A: contracts and server (PR 1)

### Task A1: the contracts
**Files:** `contracts/moments.md`, `contracts/moments/announcements.openapi.yaml`, `contracts/screen.md`, `contracts/screen.openapi.yaml`, `contracts/notify.md`.
- [ ] Write the changes of [Contract changes](#contract-changes-all-additive) and D1–D17 into the contract texts; add the examples: an Important in the hero (`regions` `["hero", "full", "rail", "ticker"]`, `hero_min_share` 0.35) and an Info at full screen (`keep_ticker` true).
- [ ] Run `scripts/check-contracts`; expected: the contract diff reports additive changes only.
- [ ] Commit `docs(contracts): announcements by level and placement: the grow rule, the ticker under full screen, the live read (#780)`.

### Task A2: Screen's placement and compose
**Files:** modify `modules/screen/src/compose/claims.ts` (`Override`, `overrideOf`, `placeClaims`), `modules/screen/src/compose/showcase.ts`, `modules/screen/src/compose/build.ts`; create `modules/screen/src/compose/aside.ts`; tests `modules/screen/test/claims-placement.test.ts`, `modules/screen/test/compose-aside.test.ts`.
**Interfaces:**
- Produces: `Override.hero_min_share: number | null`, `Override.keep_ticker: boolean`; `heroShare(regions: readonly RegionView[], grid: {columns: number; rows: number}, grow: boolean): number` in `showcase.ts` (the hero's own share, or its grown share when `grow` and it can grow); `placeClaims(regions, overrides, opts: { heroShare: number })`; `asideOf(claim: Claim, override: Override, views: ZoneViews): WidgetView | null` in `aside.ts`; `Claim.aside`.
- [ ] **Failing tests** in `claims-placement.test.ts`, one per built-in with an Important (`hero_min_share: 0.35`, chain `["hero","full","rail","ticker"]`): `pulse`, `split`, `hero`, `ambient`, `pulse_portrait` → role `hero`; `dashboard` with `grow_for_showcase: true` → role `hero` and the hero's area 8×10; `dashboard` with it false → role `full`; a custom layout whose zone gives region `big` the role `hero` → `hero`; a zone with the Pulse hero hidden → `full`.
- [ ] **Failing tests** for `keep_ticker`: an Info full claim with it on Pulse → the ticker region stays in the state, a rank-10 ticker claim is placed with `hidden: false`, `_full` spans rows 1–11; the emergency (no `keep_ticker`) → the ticker claim is `hidden: true` and `_full` spans all 12 rows; on `hero` (no ticker region) → nothing kept, nothing fails.
- [ ] **Failing tests** in `compose-aside.test.ts`: a pizza-sourced Important at full with an order in the food box → `aside` is the `food_status` view-model; the food box empty → `agenda_now`; an Urgent → no `aside`; a claim in the hero → no `aside`.
- [ ] Run `npx vitest run test/claims-placement.test.ts test/compose-aside.test.ts` in `modules/screen`; expected: the new tests fail.
- [ ] Implement: `overrideOf` reads both fields (malformed → the override drops, as for every field); `placeClaims` skips `hero` for a claim whose `hero_min_share` exceeds `opts.heroShare`; `build.ts` computes `heroShare` once per zone from the composed regions (after areas, hides and the trade) and applies `keep_ticker` to `_full`'s area and to hiding; `asideOf` per D9.
- [ ] Run the module's check (its README); expected: green.
- [ ] Commit `feat(screen): the grow rule, the ticker under full screen and nearby content for announcements (#780)`.

### Task A3: Moments' levels, placement and the live read
**Files:** create `modules/moments/migrations/010_announcement_look.sql`; modify `modules/moments/src/announce/service.ts` (`chainOf`, `CUE`, the card's content), `store.ts`, `templates.ts`, `routes.ts`, `modules/moments/src/rules.ts` (Pizza is here), `modules/moments/src/cues/catalog.ts`, `cues/names.ts`; create `modules/moments/src/announce/live.ts`; tests `modules/moments/test/announce.test.ts`, `announce-routes.test.ts`, `rules` tests where Pizza is here is pinned.
**Interfaces:**
- Produces: `type Level = "info" | "important" | "urgent"`; `type Placement = "rail" | "hero" | "full"`; `placementOf(level: Level, placement: Placement | null, fullScreen: boolean): Placement`; `chainOf(level: Level, placement: Placement): { regions: string[]; hero_min_share: number | null; keep_ticker: boolean }`; `GET /api/moments/announcements/live` answering `{ announcements: LiveAnnouncement[] }`.
- [ ] **Failing tests:** `chainOf` for each level × placement equals D3, with `hero_min_share` 0.35 only for Important and Urgent in `hero` and `keep_ticker` only for Info and Important in `full`; a send with `full_screen: true` and no placement stores `placement: full`; an Urgent sent with no placement goes to every zone at full; an Important plays `announce.important`; a `PATCH` of a live Important emits no cue; a template saved with `icon: food` fills the composer's icon; `GET …/live` as a guest lists live screen announcements without `actor`, and answers as the other guest reads do while the info pages are closed; Pizza is here is `level: important` with `art`, `second_line` and `qr`; the migration adds the three columns and nothing else.
- [ ] Run `npx vitest run test/announce.test.ts test/announce-routes.test.ts` in `modules/moments`; expected: the new tests fail.
- [ ] Implement per D1–D3, D7, D8, D13, D14.
- [ ] Run the module's check; expected: green, including the leak tests.
- [ ] Commit `feat(moments): Important, the placement choice and the live read of announcements (#780)`, push, and open PR 1 (Q1).

## Part B: the player (PR 2)

### Task B1: the looks per level and role, readable across a hall
**Files:** create `modules/screen/player/src/announce.css`; modify `modules/screen/player/src/templates.ts` (only to split the `announcement` template's parts into a new `announce-template.ts` and import it, so `templates.ts` shrinks), `modules/screen/player/src/widget.ts` (level classes); tests `modules/screen/player/test/templates.test.ts`, `modules/screen/test/player-readable.test.ts`, `modules/screen/test/stack-readability.test.ts`.
- [ ] **Failing tests:** each level renders its label ("Info", "Important", "Urgent", "Emergency"), its icon, and `art` when set; badge, title and body share one left x in the rail, the hero and full (measured in the stack test at 1920×1080, 3840×2160 and 1080×1920); title ≥ 6 % and body ≥ 3.5 % of the screen height outside the ticker; Urgent and the emergency draw the instruction band; a long title steps down, then wraps, never under the floor.
- [ ] Run `npx vitest run player/test/templates.test.ts test/player-readable.test.ts`; expected: fail.
- [ ] Implement D6, D7's drawing and D12 in `announce-template.ts` and `announce.css`, sizes in `vh`-based floors.
- [ ] Run the module's check; commit `feat(screen): announcement looks per level, on one left edge, readable across a hall (#780)`.

### Task B2: entrances, staying alive, reduced motion
**Files:** create `modules/screen/player/src/announce-motion.ts` (the beat clock), `announce-motion.css`; modify `modules/screen/player/src/claims.ts` (hook the claim's start); tests `modules/screen/player/test/announce-motion.test.ts`, `modules/screen/player/test/motion.test.ts`.
**Interfaces:** `beatAt(startsAtMs: number, nowMs: number): { entering: boolean; reemphasis: boolean; secondBeat: boolean }` (pure; D10–D11's timings).
- [ ] **Failing tests:** `beatAt` at 0.5 s → `entering`; at 25.2 s → `reemphasis`; at 43 s → `secondBeat`; at 60 s → none; the same answers after a simulated reload; at motion level `none` (and under `prefers-reduced-motion`) no animation class is set and the second line is shown steadily; at `calm` no particles; a `PATCH` (new content, same `starts_at`) restarts nothing; a withdrawn claim leaves at once.
- [ ] Run `npx vitest run player/test/announce-motion.test.ts`; expected: fail.
- [ ] Implement D10 and D11; particles and drift in CSS only (no canvas), paused at `none`.
- [ ] Run the module's check; commit `feat(screen): announcements break in and stay alive, following the motion level (#780)`.

### Task B3: the CI shots
**Files:** modify `scripts/demo-screenshots-announce.mjs` (or split a new `scripts/demo-screenshots-announce-levels.mjs` if it passes 400 lines; add it to `scripts/demo-screenshots-groups.mjs`).
- [ ] Add a shot for every sheet's state: Info in the rail (Pulse), Important in the hero (Pulse), Important on Dashboard (grown), Important full screen at 0 s, 25 s and 60 s (by sending with a `starts_at` offset of the shot's clock), Urgent full screen, the emergency in portrait; each in the `default` and `level-up` themes, at 1920×1080, 3840×2160 and 1080×1920.
- [ ] Run the shots against a local demo stack once (see the memory note on a stack beside the shared one); expected: every PNG written, none blank.
- [ ] Commit `test(screen): CI shots of every announcement level, both themes, three screen sizes (#780)`, push, open PR 2 with the shots linked next to the sheets.

## Part C: the phone and the composer (PR 3)

### Task C1: the front door's cards
**Files:** modify `modules/notify/src/canccu_notify/hub.py` (read `GET /api/moments/announcements/live` with the caller's cookie, as `agenda_now` does), `front_door.py`, `front_door_views.py` (`announcements(items) -> str`), `static/notify.css`; tests `modules/notify/tests/test_front_door.py`.
- [ ] **Failing tests:** an Urgent renders a full-width banner before "What's on" with "Stays here until the crew lifts it"; an Important a large card first under "What's on" with its art and time bar; an Info a quiet row; two Importants newest first; Moments down → the page renders without them; a closed info-page mode shows none.
- [ ] Run `pytest tests/test_front_door.py`; expected: fail. Implement D15. Run the module's check (README).
- [ ] Commit `feat(notify): the front door mirrors the announcement's level (#780)`.

### Task C2: the composer
**Files:** modify `modules/moments/src/announce/pages.ts`, `views.ts`, `list-views.ts`; tests `modules/moments/test/announce-pages.test.ts`.
- [ ] **Failing tests:** the form offers three level chips and the placement switch; choosing Important sets the placement to Hero and Push on; an organiser's own placement survives a level change; the icon chips post `icon`; the list labels "Important" and "Urgent".
- [ ] Run `npx vitest run test/announce-pages.test.ts`; expected: fail. Implement D16 and D17. Run the module's check.
- [ ] Add the phone shots at 390 px and the composer at 390 and 1280 px to `scripts/demo-screenshots-announce.mjs`.
- [ ] Commit `feat(moments): the composer picks the level, the placement and the icon (#780)`, push, open PR 3 with `Closes #780`.

## Every mockup
Drawn in the Demo night theme, at full size; numbered markers refer to the notes.

| Sheet | What it shows | Notes |
|---|---|---|
| [1 · Info in the rail](issue-780/01-info-rail-pulse.svg) | Pulse at 1080p with an Info in the rail | 1 the short glow as it slides in · 2 icon, label, title and line on one left edge (title 68 px, line 40 px) · 3 the ticker keeps running and carries the line |
| [2 · Important in the hero](issue-780/02-important-hero-pulse.svg) | Pulse at 1080p with Important in the hero, and the 1 s break-in in three frames | 1 badge, 150 px title and one line on one left edge, over the source's art · 2 posted, and the bar of its time left · 3 the rail and the ticker stay |
| [3 · Important on Dashboard](issue-780/03-important-dashboard.svg) | The hero grown to 2 × 2 boxes, before and during | 1 the grown hero with a countdown to a time-bound one and the game's art · 2 Now and next and Online stay at full size (amendment 2; Q2) · 3 the countdown |
| [4a · Full screen at 0 s](issue-780/04a-important-full-0s.svg) | Important at full screen as it breaks in | 1 the sweep across the title · 2 nearby content: clock, the food orders, the QR to the details · 3 the ticker runs under it |
| [4b · Full screen at 25 s](issue-780/04b-important-full-25s.svg) | The re-emphasis and the second beat | 1 the title pulses once · 2 the pickup place fades in for about 8 s |
| [4c · Full screen at 60 s](issue-780/04c-important-full-60s.svg) | Calm and still alive | 1 posted 1 min ago, 2 min left; the gradient has drifted, the particles moved |
| [5 · Emergency in portrait](issue-780/05-emergency-portrait.svg) | The emergency at 1080 × 1920, and Urgent in amber beside it | 1 the pulsing border · 2 a huge title (176 px, 9 % of the height) and a short instruction · 3 the ticker's place carries the instruction |
| [6 · The phone](issue-780/06-phone-three-levels.svg) | The three phone looks at 390 px | Info a quiet row in What's on; Important a push and a large card on top; Urgent a full-width banner pinned until withdrawn |
