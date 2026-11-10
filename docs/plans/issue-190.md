# Plan: issue #190 — Studio planning: schedule, content and freeze

Package `studio-planning`, branch `190-feat-screen-studio-planning`. Step 3, wave 5 of the brief's package order ([step-3-screen.md](../briefs/step-3-screen.md#package-order-a-sketch-for-the-planner)). Sources of truth: the step 3 final plan (`docs/briefs/step-3-screen.md`, `## Plan`: U5, U11, D4, D8–D10, D13, E7, E12, O5, O7, O8, P2, P4), mockups [09](../briefs/step-3-screen/09-studio-schedule.svg) and [10](../briefs/step-3-screen/10-studio-content.svg), `contracts/screen.md` with `contracts/screen.openapi.yaml` and `contracts/screen/*.openapi.yaml`, `contracts/agenda.md`, `contracts/theming.md`, the accepted plans [issue-108.md](issue-108.md) and [issue-184.md](issue-184.md), and main at d0a4ff4. This plan changes no contract and no code.

## Why a plan first
1. **What Studio planning drives is not on main yet.** On main the screen module has devices, pairing, zones, assignments and the pure scheduler (windows, the winner, simulate). The pages of this issue sit on APIs that open issues build:
   | Needed by #190 | Built by | State on 2026-11-09 |
   |---|---|---|
   | Schedules API (`/api/screen/schedules*`, simulate route), playlists API, push, break playlists, the `agenda.*` consumer | #216 (slice F of #108) | open, blocked by #215 |
   | Assets: upload, replace and revert, name-check, web and YouTube, the storage quota | #217 (slices G, H) | open |
   | Render jobs inside screen, `screen.render.*` events, slides | #224 (slice B of #184) | open |
   | Bundle versions (`/screen/b/<version>/`, the pin's `available`), the `reload` command on a pin change | #109 (the player) | open |
   | The Studio shell: where its pages are served (`/admin/*` goes to the admin module today), the Event menu (P4), the phone layout, rights in pages, message keys and the per-event language (U11) | #189 (Studio essentials) | open |
2. **"Freeze for the event" has no contract.** O5 chose "a switch in Studio that pins the current bundle and theme revision, and unpins after". `PUT /api/screen/pin` holds two values and nothing else: no end, so nobody unpins "after" unless a person remembers; no field says which bundle and theme revision screens draw now, so Studio cannot show "what is frozen" plainly, nor pin exactly what is on screen; no field says who froze it and when.
3. **"Audit on every action" passes the contract's audit list.** `contracts/screen.md` (Audit) audits pins and `web_allowlist` changes, but not assets, playlists, schedule windows, pushes or render jobs. The issue's criterion asks for audit on every action Studio planning offers.
4. **Size.** About 5,600 changed lines (below), more than three times the package limit of about 1,500. Workers do not split issues; the lead does.

Building now would mean making up the APIs of #216, #217, #224 and #109, the Studio shell of #189, and a freeze contract: outside a worker's Room to design ([AGENTS.md](../../AGENTS.md#issues)).

## Proposed contract gaps
All additive, in one contract PR (#262: G1–G4) (normal risk, [0024](../decisions/0024-additive-contract-docs-normal-risk.md)) that merges before any slice uses them.

| # | What is missing | Proposed additive change |
|---|---|---|
| G1 | Freeze with an end, and what is in effect | `Pin` gains `until` (date-time or `null`: no end), and three read-only fields: `in_effect` (`{bundle_version, theme_revision}`: what screens draw now, the nulls resolved to the platform version and theming's current revision), `changed_by` (user id or `null`) and `changed_at`. `PUT /api/screen/pin` accepts `until`: in the future, and no later than the event's `ends_at` or 14 days ahead, whichever is later (else 400 `invalid_request`). It also takes a server-side freeze form, `freeze: true` with `until`, which pins what is in effect in the same step, so a theme publish between a read and a write cannot freeze a revision screens no longer draw. A pin with `until` keeps the pin that was in place before it (or none) as read-only `restores` (`{bundle_version, theme_revision}` or `null`); at `until`, screen's tick restores that pin, so a deliberate pin made earlier survives the freeze. What `restores` names counts as pinned: theming keeps that revision and the platform keeps that bundle, as they keep the current pin's, so the restore never names a pruned revision or a dropped bundle; slice 4 (#265) builds that retention. A freeze set while a freeze is active replaces it and keeps the original `restores`, so an expired freeze is never restored. A plain `PUT` (no `until`) during a freeze ends the freeze and drops `restores`. The tick emits `screen.pin.changed` with `actor_user_id: null` and `reason: "expired"`, audited with the module as actor. `screen.pin.changed` gains `until`, `restores` and `reason` (`set`, `cleared`, `expired`); theming learns `restores` from it. `GET /api/screen/pin` is also allowed with `screen.content.read`, so everyone who edits content can see that screens are frozen. "Freeze for the event" is then Studio's: the freeze form with `until` = the event's `ends_at` (asked for when the event has none). Clone copies no pin that has an `until`; it copies a pin without one as today, and, when the current pin has an `until`, the `bundle_version` of `restores`. So a cloned event never inherits a freeze but keeps a deliberate pin |
| G2 | Audit for content | The screen Audit list adds: asset upload, replace, revert and delete; playlist create, change and delete; schedule window create, change and delete; push and clear; render job submit and cancel; ticker windows. Expired pushes and pins are audited with the module as actor. Each API issue builds its own audit calls: #216 (playlists, schedules, push), #217 (assets), #224 (render jobs), #218 (ticker windows) |
| G3 | The calendar view-model, built where the scheduler is | `GET /api/screen/schedules/calendar?from=&to=` (right `screen.content.read`): per zone, the time segments between `from` and `to` in the event's time zone, each with its winner and the windows it beat (and why), break playlists and agenda-bound windows at their items' current times. Built in screen with `schedule/winner.ts`, so Studio's pages never import screen's code (modules talk only through their API). Screen reads the agenda as a module, so a window bound to a crew-only item keeps its place; the answer names that item only when the caller holds `agenda.crew.read`, and otherwise shows "a crew item". `from` to `to` spans at most 31 days, else 400 `invalid_request` |
| G4 | Conflicts on schedule windows | `Schedule` gains read-only `revision`, `changed_by` and `changed_at`. `PUT` and `DELETE /api/screen/schedules/{schedule_id}` take `revision` and answer 409 `version_conflict` with the current window, as zones do. Built by #216 with the schedules API |

Alternatives to G1: (a) Studio pins and someone unpins by hand, no contract change, at the cost of a frozen event that stays frozen at the next event of a series; (b) a separate `POST /api/screen/freeze` resource. Recommendation: G1, the smallest change that keeps O5's "unpins after" true without a person.

## Design (holds for every slice)
| # | Decision | Reason |
|---|---|---|
| S1 | **Studio's page technology, routing, Event menu, phone layout, message keys and language come from #189.** This issue adds pages to that shell and adds no second one | One admin, one look (the brief's Rebuild); P4 |
| S2 | **The week calendar shows the event's real days:** from `tenants` `starts_at` to `ends_at` in the event's `time_zone` (a draft event without dates: the coming week), one column per day, one lane per zone. It draws weekly windows, windows bound to run-of-show items (at their items' current times, through G3 only, so a delay moves them and crew items keep their place), break playlists, and per time segment the winner, with the losers greyed below it | D4; mockup 09; E12 (days of 23 and 25 hours draw true) |
| S3 | **The winner in the calendar is computed by the same pure scheduler** the server uses (`modules/screen/src/schedule/winner.ts`), on a view-model built in the screen module and served by G3: the legacy `week-calendar-model.ts` with `schedule-insights.ts` and `advt-overlap.ts`, ported with their tests (`week-calendar-model.test.ts`, `schedule-insights.test.ts`, `calendar-pointer.test.ts`). "What plays at…" calls `GET /api/screen/schedules/simulate?zone=&at=` and shows the answer with why it won | The brief's "port with changes: admin view-models"; one rule, never two copies that drift |
| S4 | **Window editor:** create, change and delete a window by drag on the calendar or a form; a window is weekly (days, start and end, overnight, 24:00) or bound to a run-of-show item (picked from the agenda list); priority, playlist and optional layout. Conflicts show who changed it ("changed by someone else, reload", E7) from G4's `revision` and 409 | D4, E7; the legacy `week-calendar-edit-client.ts` is rebuilt, not copied (843 lines of string-built DOM) |
| S5 | **Content:** an asset library with drop-to-upload (many files, progress per file, the contract's refusals shown in words: "This file is QuickTime with ProRes video. Export it as MP4 (H.264)."), the storage use against the event's quota (O7), replace with the legacy replace plan (`replace-plan.ts` and its test) and one-step revert, and web and YouTube assets only while `screen.web` is on (D13) | D8, D13, O7; mockup 10 |
| S6 | **A deck renders slide by slide:** after a PPTX or PDF upload the asset shows its render job's state from `screen.render.*` (queued with its place in the fair queue, started, each slide as it lands, succeeded with font warnings, failed with the reason, cancel) | D9, D10, O8 |
| S7 | **Playlists:** build by drag from the library, per-item duration with the ported validators, order, the playlist's priority, and a preview of the run order; the rules of the legacy `playlist-builder.ts` with `playlist-builder.test.ts` | The brief's port table |
| S8 | **Push now:** a playlist or an asset, every zone or chosen zones, "until" (presets 15 min, 1 h, end of day, a time; at most 12 h by the contract, so "end of day" is hidden when the day ends more than 12 h away); the active pushes listed with a clear button and their end | The issue's "push to every zone until a time" |
| S9 | **Pins and freeze:** a Pins page (read with `screen.devices.read` or `screen.content.read`, written with `screen.bundle.write`) with the bundle version and theme revision in effect, the pinned values, who pinned and until when; a "Freeze for the event" switch (G1's freeze form) and "Unfreeze". While frozen, every Studio page shows a plain banner: "Screens are frozen on bundle X and theme revision N until <time>, by <name>" | O5; "what is frozen shown plainly" |
| S10 | **Rights in pages:** each action shows only to holders of its right (`screen.content.read`/`write`, `screen.push.write`, `screen.bundle.write`), and the server checks it again; tests prove a 403 for each read and write without its right | The issue's last criterion |
| S11 | **Every string behind a message key** in #189's catalogue, English first | U11 |

## Size by area (source plus tests, estimated)
| Area | Ported (legacy code + tests) | New | Estimate |
|---|---|---|---|
| A. Week calendar view-model (in screen, behind G3), insights, break overlap, pointer maths | 880 + 340 | 150 | 1,200 (trimmed) |
| B1. The read-only calendar page | — | 300 | 300 |
| B2. Window editor, bound windows, "what plays at…" | — | 600 | 600 |
| C. Asset library, upload with progress, quota, replace and revert, web and YouTube | 80 + 90 | 800 | 950 |
| D. Render progress slide by slide | — | 400 | 400 |
| E. Playlist builder and run-order preview | 120 + 550 | 450 | 900 (tests trimmed to ≈ 400) |
| F. Push now and active pushes | — | 350 | 350 |
| G. Pins, freeze, the frozen banner; screen's side of G1 (the fields, `until` in the tick, audit) | — | 600 | 600 |
| H. Rights and message keys across the pages, audit tests | — | 300 | 300 |
| **Total** | | | **≈ 5,600** |

## Proposed split (for the lead)
Each slice one issue and one package of about 1,500 lines or less. All high (admin actions with rights, as the issue says), except the contract.

| Slice | Content | Needs |
|---|---|---|
| 0. Contract (normal), #262 | G1, G2 and G3 | — |
| 1a. Calendar, #190 (≈ 1,500) | A, B1 with its share of H: the read-only week calendar on the event's days, with weekly and bound windows, breaks and each segment's winner; rights, with 403 tests for callers without `screen.content.read` (a read-only calendar has no audited action) | #189, #216, slice 0 (#262) |
| 1b. Window editor, #267 (≈ 700) | B2 with its share of H: create, change and delete windows, bound windows, "what plays at…" | slice 1a, slice 0 (#262: G4) |
| 2. Content, #263 | C, D with their share of H: the library, upload, quota, replace and revert, render progress | #189, #217, #224, slice 0 (#262) |
| 3. Playlists and push, #264 | E, F with their share of H | slice 2, #216, slice 0 (#262) |
| 4. Pins and freeze, #265 | G with its share of H: screen's API part of G1; the retention of a freeze's `restores` (theming keeps the revision `restores` names, learned from `screen.pin.changed`, and the platform's bundle retention keeps its bundle, next to the last 5 and the current pin's); the Pins page, the switch and the banner | #189, #109 (bundle versions and their retention), #246 (theming's pinned revisions), slice 0 (#262) |

Slices 1a, 2 and 4 can run in parallel once their needs merge; 1b follows 1a and 3 follows 2. The issue's criteria map as: the week calendar → 1a and 1b; content → 2 and 3; pins and freeze → 4 (and 0); rights, audit and message keys → every slice.

## Questions
1. **Split:** split #190 into slices 0–4 above (or a coarser set), or keep one issue and accept a package of about 5,600 lines? Recommendation: split as above.
2. **Freeze (G1):** add `until`, `in_effect`, `changed_by` and `changed_at` to the pin as proposed, so a freeze ends by itself at the event's end? Recommendation: yes, G1 in a contract PR before slice 4.
3. **Audit (G2):** extend screen's audit list to every content write, in the same contract PR? If yes, should #216 and #217 (not started) build the audit calls in, so slices 1–3 only test them? Recommendation: yes to both; auditing belongs to the API, not the page.
4. **Order:** block the slices on #189 (the shell) as well as on their APIs, rather than let #190 build a shell of its own? Recommendation: yes; two shells would mean two looks and a merge fight.
5. **Calendar range:** the event's `starts_at` to `ends_at` (a week shown when the event has no dates), as S2 says, or always a rolling week? Recommendation: the event's dates, as the issue asks ("on the event's real dates").

## After the answers
The lead rewrites #190 and opens the slice issues as the answers decide; each slice then runs as a package against this plan's design table.

## Answers (the lead, 2026-11-09)
1. **Split:** as proposed. Slice 0 (contract G1 and G2) is #262; slice 1 (schedule) is #190 itself; slice 2 (content) is #263; slice 3 (playlists and push) is #264; slice 4 (pins and freeze) is #265. Each slice waits for its needs as GitHub dependencies. The fix rounds below update this: slice 0 is G1–G4, and slice 1 is 1a = #190 and 1b = #267.
2. **Freeze (G1):** yes, in #262. The product owner confirms the UX side, that a freeze ends by itself at the event's end.
3. **Audit (G2):** yes, in #262. #216 and #217 build the audit calls into the API; the slices only test them.
4. **Order:** yes. Every slice waits for #189's shell.
5. **Calendar range:** the product owner's call (UX). The recommendation stands unless they say otherwise: the event's own dates, and a week when it has none.

## Review fix round (the lead, 2026-11-09)
The independent review of this plan asked for changes; the lead decided each finding, and the sections above now say so:
1. **Closes:** this plan's PR says "Plan for #190" and leaves #190 open.
2. **Size:** the total is ≈ 5,600. Slice 1 is split: **1a = #190** (the read-only calendar: area A plus the calendar view) and **1b = #267** (the window editor, bound windows and "what plays at…").
3. **Clone:** copies no pin that has an `until` (G1).
4. **The cap on `until`:** the event's `ends_at` or 14 days ahead, whichever is later (G1).
5. **When a freeze ends:** the tick restores the pin in place before it, or none (G1).
6. **Audit owners:** #216 (playlists, schedules, push), #217 (assets), #224 (render jobs), #218 (ticker windows); #262 lists them all (G2).
7. **The calendar view-model** is built in screen and served by a new additive gap, **G3** `GET /api/screen/schedules/calendar?from=&to=`, in #262.
8. **Order:** #190 and #264 also wait for #262; #190's criteria include rights and the audit test.

Non-blocking, all adopted: the push preset "end of day" is hidden when it is more than 12 h away (S8); the server-side freeze form, `PUT /api/screen/pin` with `freeze: true` and `until`, goes in #262 (G1).

## Review fix round 2 (2026-11-09)
The second review's findings, fixed above:
1. **Closes:** the PR body says "Plan for #190"; the PR closes no issue.
2. **The restored pin:** G1's `restores` counts as pinned for theming and bundle retention; a freeze during a freeze keeps the original `restores`; a plain `PUT` ends a freeze and drops it; clone keeps the `bundle_version` of `restores`.
3. **Schedule conflicts:** new gap G4 (`revision`, `changed_by`, `changed_at`, 409 `version_conflict`), built by #216; #267 needs it. The code is `version_conflict` rather than a new one, because zones already answer it.
4. **The frozen banner:** `GET /api/screen/pin` is also allowed with `screen.content.read` (G1); the Pins page reads with either read right (S9).

Non-blocking, all adopted: the size is ≈ 5,600 throughout; the Answers point to the fix rounds; slice 1a's tests are 403s on reads, with no audit test; the calendar's agenda data comes only through G3, which names crew items only to holders of `agenda.crew.read`; G3 spans at most 31 days; every slice row names "slice 0 (#262)".

## Review fix round 3 (the lead, 2026-11-09)
The third review's finding 2: slice 4 (#265) owns the retention of a freeze's `restores`. Theming keeps the revision `restores` names, and the platform's bundle retention keeps its bundle, so the tick's restore at `until` never names a pruned revision or a dropped bundle. #265 builds it on #246 (theming's pinned revisions) and #109 (bundle versions). Finding 1 needed no change to this file: the PR body says "Plan for #190" and the PR closes no issue. The lead left the review's non-blocking items to #262.
