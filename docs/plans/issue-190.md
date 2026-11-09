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
4. **Size.** About 5,000 changed lines (below), more than three times the package limit of about 1,500. Workers do not split issues; the lead does.

Building now would mean making up the APIs of #216, #217, #224 and #109, the Studio shell of #189, and a freeze contract: outside a worker's Room to design ([AGENTS.md](../../AGENTS.md#issues)).

## Proposed contract gaps
Both additive, in one contract PR (normal risk, [0024](../decisions/0024-additive-contract-docs-normal-risk.md)) that merges before any slice uses them.

| # | What is missing | Proposed additive change |
|---|---|---|
| G1 | Freeze with an end, and what is in effect | `Pin` gains `until` (date-time or `null`: no end), and three read-only fields: `in_effect` (`{bundle_version, theme_revision}`: what screens draw now, the nulls resolved to the platform version and theming's current revision), `changed_by` (user id or `null`) and `changed_at`. `PUT /api/screen/pin` accepts `until` (in the future, at most 14 days ahead, else 400 `invalid_request`). Screen's tick clears both pins at `until`: emits `screen.pin.changed` with `actor_user_id: null` and `reason: "expired"`, audited with the module as actor. `screen.pin.changed` gains `until` and `reason` (`set`, `cleared`, `expired`). "Freeze for the event" is then Studio's: `PUT` with `in_effect`'s values and `until` = the event's `ends_at` (asked for when the event has none). Clone copies no `until` |
| G2 | Audit for content | The screen Audit list adds: asset upload, replace, revert and delete; playlist create, change and delete; schedule window create, change and delete; push and clear; render job submit and cancel; ticker windows. Expired pushes and pins are audited with the module as actor |

Alternatives to G1: (a) Studio pins and someone unpins by hand, no contract change, at the cost of a frozen event that stays frozen at the next event of a series; (b) a separate `POST /api/screen/freeze` resource. Recommendation: G1, the smallest change that keeps O5's "unpins after" true without a person.

## Design (holds for every slice)
| # | Decision | Reason |
|---|---|---|
| S1 | **Studio's page technology, routing, Event menu, phone layout, message keys and language come from #189.** This issue adds pages to that shell and adds no second one | One admin, one look (the brief's Rebuild); P4 |
| S2 | **The week calendar shows the event's real days:** from `tenants` `starts_at` to `ends_at` in the event's `time_zone` (a draft event without dates: the coming week), one column per day, one lane per zone. It draws weekly windows, windows bound to run-of-show items (from `GET /api/agenda/items?from=&to=`, so a delay moves them), break playlists, and per time segment the winner, with the losers greyed below it | D4; mockup 09; E12 (days of 23 and 25 hours draw true) |
| S3 | **The winner in the calendar is computed by the same pure scheduler** the server uses (`modules/screen/src/schedule/winner.ts`), on a view-model built server-side: the legacy `week-calendar-model.ts` with `schedule-insights.ts` and `advt-overlap.ts`, ported with their tests (`week-calendar-model.test.ts`, `schedule-insights.test.ts`, `calendar-pointer.test.ts`). "What plays at…" calls `GET /api/screen/schedules/simulate?zone=&at=` and shows the answer with why it won | The brief's "port with changes: admin view-models"; one rule, never two copies that drift |
| S4 | **Window editor:** create, change and delete a window by drag on the calendar or a form; a window is weekly (days, start and end, overnight, 24:00) or bound to a run-of-show item (picked from the agenda list); priority, playlist and optional layout. Conflicts show who changed it ("changed by someone else, reload", E7) from the API's `revision`/409 | D4, E7; the legacy `week-calendar-edit-client.ts` is rebuilt, not copied (843 lines of string-built DOM) |
| S5 | **Content:** an asset library with drop-to-upload (many files, progress per file, the contract's refusals shown in words: "This file is QuickTime with ProRes video. Export it as MP4 (H.264)."), the storage use against the event's quota (O7), replace with the legacy replace plan (`replace-plan.ts` and its test) and one-step revert, and web and YouTube assets only while `screen.web` is on (D13) | D8, D13, O7; mockup 10 |
| S6 | **A deck renders slide by slide:** after a PPTX or PDF upload the asset shows its render job's state from `screen.render.*` (queued with its place in the fair queue, started, each slide as it lands, succeeded with font warnings, failed with the reason, cancel) | D9, D10, O8 |
| S7 | **Playlists:** build by drag from the library, per-item duration with the ported validators, order, the playlist's priority, and a preview of the run order; the rules of the legacy `playlist-builder.ts` with `playlist-builder.test.ts` | The brief's port table |
| S8 | **Push now:** a playlist or an asset, every zone or chosen zones, "until" (presets 15 min, 1 h, end of day, a time; at most 12 h by the contract); the active pushes listed with a clear button and their end | The issue's "push to every zone until a time" |
| S9 | **Pins and freeze:** a Pins page (`screen.bundle.write`) with the bundle version and theme revision in effect, the pinned values, who pinned and until when; a "Freeze for the event" switch (G1) and "Unfreeze". While frozen, every Studio page shows a plain banner: "Screens are frozen on bundle X and theme revision N until <time>, by <name>" | O5; "what is frozen shown plainly" |
| S10 | **Rights in pages:** each action shows only to holders of its right (`screen.content.read`/`write`, `screen.push.write`, `screen.bundle.write`), and the server checks it again; tests prove a 403 for each write without the right | The issue's last criterion |
| S11 | **Every string behind a message key** in #189's catalogue, English first | U11 |

## Size by area (source plus tests, estimated)
| Area | Ported (legacy code + tests) | New | Estimate |
|---|---|---|---|
| A. Week calendar view-model, insights, break overlap, pointer maths | 880 + 340 | 150 | 1,200 (trimmed) |
| B. Calendar page, window editor, bound windows, "what plays at…" | — | 900 | 900 |
| C. Asset library, upload with progress, quota, replace and revert, web and YouTube | 80 + 90 | 800 | 950 |
| D. Render progress slide by slide | — | 400 | 400 |
| E. Playlist builder and run-order preview | 120 + 550 | 450 | 900 (tests trimmed to ≈ 400) |
| F. Push now and active pushes | — | 350 | 350 |
| G. Pins, freeze, the frozen banner; screen's side of G1 (the fields, `until` in the tick, audit) | — | 600 | 600 |
| H. Rights and message keys across the pages, audit tests | — | 300 | 300 |
| **Total** | | | **≈ 5,000** |

## Proposed split (for the lead)
Each slice one issue and one package of about 1,500 lines or less. All high (admin actions with rights, as the issue says), except the contract.

| Slice | Content | Needs |
|---|---|---|
| 0. Contract (normal) | G1 and G2 | — |
| 1. Schedule | A, B with its share of H: the week calendar on the event's days, windows weekly and bound to run-of-show items, breaks, "what plays at…" | #189, #216 |
| 2. Content | C, D with their share of H: the library, upload, quota, replace and revert, render progress | #189, #217, #224, G2 |
| 3. Playlists and push | E, F with their share of H | slice 2, #216 |
| 4. Pins and freeze | G with its share of H: screen's API part of G1, the Pins page, the switch and the banner | #189, #109, slice 0 |

Slices 1, 2 and 4 can run in parallel once their needs merge; 3 follows 2. The issue's criteria map as: the week calendar → 1; content → 2 and 3; pins and freeze → 4 (and 0); rights, audit and message keys → every slice.

## Questions
1. **Split:** split #190 into slices 0–4 above (or a coarser set), or keep one issue and accept a package of about 5,000 lines? Recommendation: split as above.
2. **Freeze (G1):** add `until`, `in_effect`, `changed_by` and `changed_at` to the pin as proposed, so a freeze ends by itself at the event's end? Recommendation: yes, G1 in a contract PR before slice 4.
3. **Audit (G2):** extend screen's audit list to every content write, in the same contract PR? If yes, should #216 and #217 (not started) build the audit calls in, so slices 1–3 only test them? Recommendation: yes to both; auditing belongs to the API, not the page.
4. **Order:** block the slices on #189 (the shell) as well as on their APIs, rather than let #190 build a shell of its own? Recommendation: yes; two shells would mean two looks and a merge fight.
5. **Calendar range:** the event's `starts_at` to `ends_at` (a week shown when the event has no dates), as S2 says, or always a rolling week? Recommendation: the event's dates, as the issue asks ("on the event's real dates").

## After the answers
The lead rewrites #190 and opens the slice issues as the answers decide; each slice then runs as a package against this plan's design table.
