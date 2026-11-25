# Plan: issue #777: airtime that is seen and nothing left out

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task by task in this session (the dispatcher's flow; no subagents). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Moments gives what it shows enough time to be seen, and nothing is dropped. A shown moment holds the hero for a floor of 90 s. A pushed-aside moment keeps its remaining on-air time. Moments wait in a queue per zone instead of being refused or dropped. "Pizza is here" is an announcement, and finals rank above stories.

**Architecture:** Today Moments sends every override at once and Screen's rank placement decides who holds the hero; patience and refusal drop the losers. After this change, Moments owns the hero and `full` per zone: a pure scheduler (`air-plan.ts`) decides each tick which one moment holds them. It decides which queued moment waits in the rail, which are held back, and when the breathing gap ends. The engine turns that into **one override per moment and zone**, each with its own `regions`, `expires_at` and `starts_at`. Screen stays as it is: it still places what it gets by rank, but it only ever gets one hero claimant per zone. A moment's TTL becomes an **on-air budget per zone** that only runs while it is on air.

**Tech stack:** TypeScript (Node, Fastify), Postgres under RLS, the kit's Outbox, vitest with a real Postgres (`*_test`), Playwright for the shots, the demo stack's bash runner.

**Spec:** issue #777 (its rules 1–10 and acceptance criteria), against `contracts/moments.md`, `contracts/moments.openapi.yaml` and `contracts/moments/storyboard.schema.json` as on main at eb0724a.

## Why a plan first
- The change redefines the arbiter's time model. TTL, patience, refusal, the tick's expiry pass, a crew's Extend, a renewal (E4), the story runner's patience, airtime cap and yield, and Screen's own `expires_at` all move together. Getting one wrong strands moments on screens or ends them early.
- It moves the decision of who holds the hero from Screen's placement (rank, then the *later* `starts_at`) into Moments (rank, then the *earlier* wait). Screen's contract allows that without a change (override ids are opaque, `regions` may change in `.changed`), but the lead should accept the boundary before about 3,000 lines rest on it.
- Risk is high (the moments contract, the screen arbiter). The issue asks the PR to say whether the contract change is breaking. This plan makes it additive (below), so the lead can confirm that before code exists.

## Is the contract change breaking? No, as planned
AGENTS.md calls a change breaking when it removes or renames anything a consumer may use. The plan keeps every field and code and only adds:

| Today | After | Why it is not breaking |
|---|---|---|
| `Moment.patience_seconds` (required, integer) | Kept, same type. It now means how long after its start (or its last new content) the moment may still wait before it ends `stale`: its class's `stale_after`. Marked deprecated in the OpenAPI | Same field and type, a narrower meaning; a consumer that reads it still gets a wait bound in seconds |
| `MomentRequest.patience_seconds` (optional) | Kept, accepted. It may shorten the moment's `stale_after` (never lengthen it). Deprecated | Still accepted; a module that sends it gets an earlier stale end, the nearest meaning |
| 409 `moment_refused` with `retry_after_seconds`, `held_by` | Kept for one owner per happening (WD1), its only cause now. Queued requests answer 201 | A response that comes less often; no consumer outside Moments handles it (`grep` over `modules/`) |
| Storyboard `Settings.airtime_percent` (required) | Kept in GET and PUT, out of `required`; stored and returned, caps nothing. Deprecated | Readers still get it; writers may still send it |
| Classes' default order | New default (rule 9). Events with a saved order (a `moments_priorities` row, written by `PUT` or a clone) keep theirs | A default value, not a removed field; the PR says it in words |
| Preset `pizza_arrived` ("Pizza orders ready") | Retired from the catalogue: no longer offered, and an event's stored copy is ignored on load, never deleted | Storyboards are event data, not an API field; no migration deletes anything |
| End reasons, history actions | Add `stale` (end reason) and `moved` (history action) | Added enum values in answers |

Removing the deprecated fields and the unused `moments_rule_retries` table comes later in its own PR (Follow-up lines in the PR).

## Decisions (the reviewer checks these)
| # | Decision | Reason |
|---|---|---|
| D1 | **Who is scheduled:** a moment whose chain (`regions`) holds `hero` or `full` is a *hero claimant*. Moments gives the hero to one claimant per zone. Every other moment (rail-, ticker-, venue-rail- or overlay-only chains: the food box, crew announcements' default chain, ticker lines) passes through with its own chain, and Screen ranks it as today | The rules speak of the hero; the rest already shares its regions at Screen without starving |
| D2 | **The emergency is not scheduled:** it keeps its one override `<id>` with `zones: []`. Everything under it is reported `hidden` by Screen, which pauses its clock (D5) | Nothing outranks it; it must reach zones saved later |
| D3 | **One override per moment and zone,** id `<moment id>.<zone key>` the first time, `<moment id>.<zone key>.<n>` (n = 2, 3, …) when it is sent again after being held back. Screen never brings an override back to a zone it left, so a new send needs a new id. The old shared `<id>` override and the split logic (`desiredOverrides`) go, except for D2 | Each zone needs its own `regions`, `expires_at` and `starts_at` |
| D4 | **What each zone override carries:** the holder gets its whole chain. The first queued claimant in queue order whose chain has `rail` and that has no `steps` gets its chain from `rail` on (`[hero, rail, ticker]` → `[rail, ticker]`): the waiting room (rule 4). Other queued claimants are not sent to that zone (held back). Steps would play on in the rail and leave the hero a used round, so a moment with `steps` (a story round, a condensed round) waits unsent | Rules 1 and 4; Screen plays steps from the override's `starts_at` (`screen/player/src/claims.ts`) |
| D5 | **The clock (rules 1–2):** each moment and zone has a budget (`ttl_seconds` × 1000, or null for no end), `played_ms` and `on_air_since`. It runs from the moment Moments gives the hero (claimants) or sends it (pass-through), and pauses when Screen reports it `hidden` or `unplaced` or Moments takes the hero back. It resumes when Screen reports it `placed` again. It ends there `expired` when `played_ms` reaches the budget. A zone no screen reports still counts from Moments' own grant, so its queue moves | Rule 2; reports arrive only while a screen is connected |
| D6 | **The floor:** the holder keeps the hero against everything but the emergency and a person's action until it has been on air `min(min_on_air, its budget)` in this tenure, counted in on-air time (so an emergency's pause does not use it up). After the floor it yields to a queued claimant of *higher* rank, and keeps its remaining budget; against equals and lower ranks it plays to its own end. Its own budget may end it before the floor (a 20 s sting is not stretched) | Rules 1 and 2; equals wait their turn instead of flip-flopping |
| D7 | **A person's action:** a claimant of origin `crew` (spotlight, an announcement from the composer) that ranks at or above the holder takes the hero at once, floor and gap ignored. "Clear" is `/end`, and it frees the hero. Below the holder it queues | Rule 1 names spotlight, clear and take |
| D8 | **The queue order** per zone: moved forward first (latest `forward_at` first), then rank (zone's order), then the earliest `queued_since`, then id. `queued_since` is when it first asked, or when it was pushed aside | Rule 3 and rule 7's "move forward" |
| D9 | **The breathing gap:** when the holder leaves the hero, the hero stays free `gap_seconds` (default 10) before the next claimant gets it; a crew claimant (D7) skips the gap; the waiting room (D4) fills at once | Rule 10 |
| D10 | **Stale:** a moment that is not on air on a zone ends there `stale` once `now ≥ fresh_at + stale_after(class)`. `fresh_at` is its start, moved to now by a renewal with new content. An on-air one plays out. A moment waiting in the rail is not on air, so it can go stale | Rule 3, "old news never comes back" |
| D11 | **Renewal (rule 5, E4):** a request with the `dedupe_key` of a running moment, queued or on air, replaces its `template`, `content` and `steps`. With new content, `fresh_at` moves to now; its queue place (`queued_since`) stays. Its remaining budget on each zone becomes `max(remaining, ttl)`, so it never shortens | One moment per key; a queued standings never piles up |
| D12 | **Condensing (rule 6):** routine moments are the `standings` and `hot_game` rules' moments. The hero goes to a routine claimant while more than 3 routine claimants wait on that zone. That holder's override then carries `steps`: one per waiting routine moment, in queue order (`template`, `content`, `duration_ms` = `max(8000, min_on_air / n)` capped at 60000). Its budget is their sum, and the others are marked as playing inside it. When it ends, they all end `expired` with the history outcome "played together". Announcements, finals, spotlights and stories never condense | One round, not one per 90 s |
| D13 | **Settings** (rule 1, rule 3, rule 10): `airtime` in `PriorityOrders`: `min_on_air_seconds` (60–120, default 90), `gap_seconds` (0–30, default 10), `stale_after_minutes` (each class → 1–240, default 30). An optional `airtime` on `PUT /api/moments/priorities` (absent keeps the stored one), audited with the order. The Priorities page edits them: two number fields, plus a "stale after" minutes field per class in the order list | One settings object for the arbiter, next to the order it ranks by |
| D14 | **Queue in the API (rule 7):** `GET /api/moments/moments` adds `queues`: per zone `zone_key`, `holder` (moment id or null), `free_until` (the gap's end or null), `waiting` (each `moment_id`, `title`, `class`, `since`, `in_rail`), `stale` (the last hour's, each `title`, `class`, `at`, newest first, at most 10). `POST /api/moments/moments/{id}/forward` with `zone_key` (right `moments.take`, `Idempotency-Key`, audited `moments.moment.moved`, history action `moved`) moves one to the front. **Skip** is the existing `POST …/end` with `zone_key` ("End in zone"); On air labels it "Skip" on a waiting moment | Rule 7, with the fewest new paths |
| D15 | **Stories:** the airtime cap (SO1), the yield, `UNCAPPED` and "its region was held past its patience" go (rules 3 and 10). A round queues like any claimant and is one unit (D4, D12). It carries `dedupe_key` `story:<run id>`, so a round still queued when the next is due is replaced by it (D11) and never piles up. `patienceMs` stays only where it bounds when a late trigger may still start a run (`triggers.ts`, `fire-words.ts`). A queued round plays late; its on-the-dot step holds only when the hero is free | Rules 3 and 10; the issue keeps the story sound cap and flood guard |
| D16 | **Pizza is here (rule 8):** on `pizza.order.arrived` the `pizza` rule starts a second moment of class `announcement`, template `announcement` (`title` "Pizza is here", `body` "Order {seq} · Collect at {pickup}", `level` `info`, `ticker_line` the two joined by " · "), chain `["hero", "rail", "ticker"]`, budget 180 s (#775's hold), cue `pizza.placed`, `dedupe_key` `pizza:<order id>:arrived`, happening `pizza.order.arrived:<order id>`, ending `source_ended` on `pizza.order.done` and `.cancelled`. The rule's food-box moment (`pizza_placed`, venue rail → ticker) stays as it is for placed, on the way and arrived. The `pizza_arrived` preset is retired (`RETIRED_PRESETS` in `story/presets.ts`: the picker hides it, `loadStories` skips a stored copy), and with it its `RULE_OF_PRESET` entry (SD6) | One path; the `announcement` template already degrades to the ticker with `ticker_line`. The #775 pizza art does not fit that template: Roadmap note (an image on the announcement view-model is a Screen contract change, out of scope) |
| D17 | **Default order (rule 9):** `DEFAULT_ORDER` becomes `emergency, stream, announcement, spotlight, finals, storyboard, tournament, hot_game, reactions, ticker` (finals 65, storyboard 60, tournament 55). `CLASSES` (the set) keeps its order; only `DEFAULT_ORDER` and the contract table change | An event's saved row keeps its order (`loadOrders`) |
| D18 | **Gone code:** `blockedOn`, `heldOn`, the refusal in `Engine.request` (except the happening), `rule-retries.ts` and its tick call, the tick's patience pass, `RULE_PATIENCE_SECONDS`, `REFUSAL_RETRY_SECONDS` (kept only as the happening's 30), the runner's `airtimeOver`, `yieldTo`, `UNCAPPED`, the builder's airtime meters (`builder-side.ts`, `pages.ts` `airtime()`), the airtime field in the settings form. `moments_rule_retries` stays in the schema, unused (dropping it is destructive: Follow-up) | Lean; no dead code |
| D19 | **Adoption at deploy:** no backfill. The first pass on a zone creates the slot of every running moment that has none: `queued_since` its `starts_at`, a budget from `expires_at − now` (or null), and the hero for the one Screen reports placed there. Their old `<id>` overrides are ended (`final: true`) as the per-zone ones start, in that order (`.started` first, as `reconcile` does today) | A restart with moments on air must not blank the screens |

## Global constraints
- Names: `canccu_` prefix in SQL roles and CSS, `CANCCU_` env vars (`scripts/check-naming`).
- About 400 lines at most per source file; `engine.ts` (344) and `tick.ts` (246) take no growth. New logic goes in new files (below); never add a size exemption.
- The comment rule: comment the why, never the what.
- No event names: the demo event only, in tests and fixtures.
- Every new behaviour has a test that fails without it; no test is skipped or weakened.
- Migration `009_airtime.sql` is additive only: new tables and columns, no drop, no rename, no type change.
- Contract changes are additive (the table above). If one turns out breaking during the work, stop and ask the PO.
- Default values: floor 90 s (60–120), gap 10 s (0–30), stale 30 min (1–240 per class), condense over 3, step length `max(8000, floor / n)` ms capped at 60000, Pizza is here's budget 180 s.

## Review focus
1. **A restart in the middle of a floor or a pause.** It resumes from the rows, and the hero does not change hands or blank. Test in Task 4 (`airtime.test.ts`: "a restart keeps the holder and its played time").
2. **A zone removed or a moment ended while it holds the hero.** The hero frees, the gap starts and the next one comes. Test in Task 4 ("ending the holder frees the hero after the gap").
3. **A zone with its own priority order.** The zone's rank orders its queue, and the override carries the zone's rank. Test in Task 3 (`air-plan.test.ts`: "a zone's own order ranks its queue").
4. **Extend on a paused or queued moment.** It adds to the budget; it never puts the moment on air. Test in Task 4 ("Extend adds to the budget of a waiting moment").
5. **Two containers ticking at once.** Each zone's pass runs under its `moments_zone_air` row lock (`FOR UPDATE SKIP LOCKED` in the tick, `FOR UPDATE` elsewhere), so the hero never goes to two claimants. Test in Task 4 ("two passes at once give the hero once").

## Files
- Create: `modules/moments/migrations/009_airtime.sql`. Tables `moment_slots` (`tenant_id`, `moment_id`, `zone_key`, `queued_since`, `forward_at`, `granted` (`hero`, `rail`, `pass`, `inside` or null), `inside_of` (the condensed round's moment id or null), `on_air_since`, `played_ms`, `tenure_from_ms`, `budget_ms`, `generation`, primary key (`tenant_id`, `moment_id`, `zone_key`)) and `moments_zone_air` (`tenant_id`, `zone_key`, `holder`, `free_since`, primary key (`tenant_id`, `zone_key`)), both with RLS and the policy and grants of `001_moments.sql`. Columns `moments.fresh_at timestamptz` (null means `starts_at`) and `moments_priorities.airtime jsonb NOT NULL DEFAULT '{}'`. The new tables go to `scripts/tenancy-global-tables.txt` only if `scripts/check-tenancy` asks (they are per tenant, so it should not).
- Create: `modules/moments/src/air-plan.ts` (pure scheduler), `src/air-store.ts` (slot and zone rows), `src/air.ts` (the engine's pass: plan, persist, send), `src/air-settings.ts` (settings, defaults and checks).
- Modify: `src/arbiter.ts` (D17, D18), `src/engine.ts` (request, end, extend and show go through `air.ts`), `src/reconcile.ts` (per-zone overrides, D3/D4), `src/placements.ts` (the clock, D5), `src/tick.ts` (the pass replaces the expiry and patience passes), `src/store.ts`, `src/rules.ts` (D16), `src/settings-routes.ts` and `src/settings-views.ts` (D13), `src/routes.ts` (forward), `src/on-air-data.ts` and `src/views.ts` (the queue), `static/on-air.css`, `src/story/runner.ts`, `round.ts`, `store.ts`, `routes.ts`, `builder-side.ts`, `pages.ts`, `presets.ts`, `presets-every.ts` (D15, D16), `README.md`.
- Delete: `src/rule-retries.ts` and its test cases.
- Contract: `contracts/moments.md`, `contracts/moments.openapi.yaml`, `contracts/moments/storyboard.schema.json`.
- Stack: create `modules/moments/ci/airtime.mjs`; modify `scripts/demo-stack-test`, `scripts/demo-screenshots-moments.mjs`, `modules/screen/test/stack/food.mjs` and `scripts/demo-screenshots-pizza.mjs` (Pizza is here is now an announcement card).

## Tasks

### Task 1: The contract
**Files:** `contracts/moments.md`, `contracts/moments.openapi.yaml`, `contracts/moments/storyboard.schema.json`.
- [ ] Words: replace **Patience** with **Queue** (each zone's waiting moments, in order), **On air** (holding its place, its clock running), **Floor** (`min_on_air_seconds`) and **Stale** (`stale_after`).
- [ ] Classes table and **The order**: the new default order and ranks (D17); the sentence "Events that saved their own order keep it".
- [ ] Rewrite **The arbiter's rules** as rules 1–10 in the contract's voice, from D1–D12. TTL becomes "its on-air time on each zone". Re-posting follows D11. "Refusal with retry" and "Share before you queue" become **Queue, never drop**. **Revert** follows D5. **Ends** adds `stale` and drops patience's `preempted`. Keep `preempted` in the enum as deprecated, sent no longer.
- [ ] **The overrides it emits:** one override per moment and zone (D3), the emergency's one override (D2), `starts_at` of a new send = the moment's grant minus its played time, so steps resume. Narrowing (D3) now applies only to the emergency.
- [ ] **Moments**, **Crew actions**, **Priorities**: D13 and D14; the deprecations table's lines on `patience_seconds`, 409 and `airtime_percent`.
- [ ] **Built-in rules** table: the `pizza` row adds the arrival moment of D16; the `Presets and the crew` line on Pizza orders ready goes.
- [ ] **Storyboards**: SO1's cap and yield and SE1's patience skip go (D15); the meters lose the airtime bars.
- [ ] OpenAPI: `PriorityOrders.airtime` and the `PUT` body's optional `airtime` (schema `AirtimeSettings`); `MomentList.queues` (schema `ZoneQueue`); path `/api/moments/moments/{moment_id}/forward`; `end_reason` adds `stale`; history `action` adds `moved`; `deprecated: true` on both `patience_seconds` and their new descriptions; 409's description.
- [ ] Schema: `airtime_percent` out of `Settings.required`, description "Deprecated: kept and returned, caps nothing (#777)".
- [ ] Run `scripts/check-contracts`. Expected: passes.
- [ ] Commit `docs(moments): airtime that is seen and nothing left out: the contract (#777)`.

### Task 2: Migration, settings and the default order
**Files:** `migrations/009_airtime.sql`, `src/air-settings.ts`, `src/arbiter.ts`, `src/store.ts`, `src/settings-routes.ts`, `src/settings-views.ts`; tests `test/routes.test.ts`, `test/arbiter.test.ts`, `test/pages.test.ts`.

**Interfaces (produces):**
- `interface AirSettings { min_on_air_ms: number; gap_ms: number; stale_after_ms: Record<Class, number> }`
- `const DEFAULT_AIR: AirSettings`; `function airOf(json: unknown): AirSettings` (stored JSON over the defaults); `function checkAir(body: unknown): string | null` (400's reason)
- `loadOrders(c)` also returns `air: AirSettings`
- `DEFAULT_ORDER` per D17

- [ ] Tests first:
  - `arbiter.test.ts`: "the default order puts finals above stories and the tournament": `rankOf(DEFAULT_ORDER, "finals") === 65`, `storyboard` 60, `tournament` 55.
  - `routes.test.ts`: "priorities carry the airtime settings": GET without a row answers `airtime` `{min_on_air_seconds: 90, gap_seconds: 10, stale_after_minutes: {…every class: 30}}`. A PUT with `min_on_air_seconds: 59` is 400 `invalid_request`. A PUT with 120 and gap 0 round-trips and writes one audit entry. A PUT without `airtime` keeps the stored one.
  - "an event's saved order keeps its order": save the old order, then GET answers it unchanged.
- [ ] Run `npm test -- test/arbiter.test.ts test/routes.test.ts`. Expected: the new cases FAIL.
- [ ] Implement the migration, `air-settings.ts`, `DEFAULT_ORDER`, `loadOrders`, the routes and the Priorities form fields (D13).
- [ ] Run the same tests. Expected: PASS. Then `npm run lint && npm run typecheck`.
- [ ] Commit `feat(moments): the airtime settings and the new default order (#777)`.

### Task 3: The pure scheduler
**Files:** create `src/air-plan.ts`; test `test/air-plan.test.ts`.

**Interfaces (produces):**
```ts
export type Grant = "hero" | "rail" | "pass" | "inside" | null;
export interface SlotIn {
  moment_id: string; class: Class; rank: number; chain: readonly string[];
  origin: Origin; rule_id: string | null; has_steps: boolean;
  fresh_at: number; queued_since: number; forward_at: number | null;
  granted: Grant; on_air_since: number | null; played_ms: number;
  tenure_from_ms: number; budget_ms: number | null;
}
export interface ZoneIn { holder: string | null; free_since: number | null }
export interface SlotOut { moment_id: string; granted: Grant; regions: string[] | null; inside_of: string | null }
export interface ZonePlan {
  zone: ZoneIn;
  slots: SlotOut[];
  ends: { moment_id: string; reason: "expired" | "stale" }[];
  condensed: { holder: string; inside: string[] } | null;
}
export function planZone(now: number, zone: ZoneIn, slots: readonly SlotIn[], air: AirSettings): ZonePlan;
export function playedNow(s: SlotIn, now: number): number; // played_ms plus the running stretch
export const ROUTINE_RULES: ReadonlySet<string>; // "standings", "hot_game"
export const CONDENSE_OVER = 3;
```
The algorithm, in order (everything else follows D1–D12):
1. `ends`: on air (`on_air_since !== null`) with `playedNow ≥ budget_ms` → `expired`. Not on air and `now ≥ fresh_at + stale_after_ms[class]` → `stale`. Ended slots take no further part.
2. Pass-through slots (D1) → `granted: "pass"`, `regions: chain`.
3. Queue = the other claimants, minus the holder, in D8's order.
4. Holder `H` (if `zone.holder` is still a live slot): `floorDone = playedNow(H) − H.tenure_from_ms ≥ min(air.min_on_air_ms, H.budget_ms ?? ∞)`. Let head `C` be the queue's first. If `C` is crew and `C.rank ≥ H.rank` → `C` takes the hero. Else if `floorDone` and `C.rank > H.rank` → `H` goes back to the queue (`queued_since = now`), the hero frees (`free_since = now`) and the gap applies.
5. No holder: once `now − free_since ≥ gap_ms` (or at once for a crew head, or when `free_since` is null) → the head takes the hero (`tenure_from_ms = its played_ms`); D12 applies when the head is routine and more than 3 routine claimants wait.
6. The waiting room: the first queued claimant with `rail` in its chain and `!has_steps` → `granted: "rail"`, `regions` = chain from `rail`. The other queued claimants → `granted: null`, `regions: null`.

- [ ] Tests first (`air-plan.test.ts`, times in ms from 0, `air` = `DEFAULT_AIR`):
  - "the floor holds against a higher rank": holder finals rank 65 on air since 0 with budget 120000, and an announcement rank 80 queued at 5000. At 89000: holder still finals, the announcement `granted: "rail"`. At 90000: `zone.holder === null`, `free_since === 90000`, finals `granted: null` with `queued_since` 90000.
  - "the gap, then the queue's head": from the state at 90000, at 99999 nobody holds the hero; at 100000 the announcement holds it with `regions` `["hero", "rail", "ticker"]`.
  - "a crew spotlight cuts the floor": holder finals at 10000 of its floor; a crew spotlight rank 70 queued → it holds the hero at once, finals queued.
  - "a lower rank waits for the holder's end": holder announcement 80 past its floor, a finals 65 queued → holder stays.
  - "equals wait their turn": holder tournament past its floor, another tournament queued → holder stays.
  - "stale after 30 minutes, never before": a queued `hot_game` with `fresh_at` 0 is not ended at 1799999 and is ended `stale` at 1800000. An on-air one at 1800000 is not ended.
  - "a budget shorter than the floor ends on its own": holder budget 20000 → `ends` has it `expired` at 20000.
  - "moved forward goes first": two queued, the lower-ranked with `forward_at` → it is the head.
  - "routine moments condense over three": a holder plus 4 queued `hot_game` (rule `hot_game`); at the hero's next grant `condensed.inside` lists the other 3 and the head holds.
  - "three do not condense": with 3 queued, `condensed` is null.
  - "a story round never waits in the rail": a queued claimant with `has_steps` and chain `[hero, rail]` gets `regions: null`, and the next one with `rail` gets the rail.
  - "a zone's own order ranks its queue": slots carry the zone's ranks, and the higher zone rank is the head.
- [ ] Run `npm test -- test/air-plan.test.ts`. Expected: FAIL (module missing).
- [ ] Implement `air-plan.ts`.
- [ ] Run again. Expected: PASS.
- [ ] Commit `feat(moments): the airtime scheduler, pure (#777)`.

### Task 4: The engine on the scheduler
**Files:** create `src/air-store.ts` and `src/air.ts`; modify `src/engine.ts`, `src/reconcile.ts`, `src/placements.ts`, `src/tick.ts`, `src/store.ts`, `src/arbiter.ts`; delete `src/rule-retries.ts`; tests create `test/airtime.test.ts`, update `test/engine.test.ts`, `test/lifecycle.test.ts`, `test/review-edges.test.ts`, `test/catch-up.test.ts`, `test/rules.test.ts`, and the story tests whose override ids or refusals change.

**Interfaces (produces):**
- `air-store.ts`: `loadZone(c, zone, lock: "wait" | "skip"): Promise<ZoneIn | null>`, `saveZone(c, zone, z: ZoneIn)`, `slotsOn(c, zone): Promise<SlotIn[]>` (creating the missing slots of D19), `saveSlot(c, zone, s: SlotIn & SlotOut)`, `pauseSlot(c, moment, zone, now)`, `resumeSlot(c, moment, zone, now)`, `addBudget(c, moment, ms)`.
- `air.ts`: `passZone(c, engine, zone, now, lock): Promise<void>` (plan, persist, end what `ends` says through `engine.end(…, zone)`, send through `reconcileZone`) and `passAll(c, engine, now)` (every known zone, `skip` lock, for the tick).
- `reconcile.ts`: `reconcileZone(outbox, c, m, zone, out: SlotOut, slot, actor, reason)`: `.started` when a send begins (new generation id per D3), `.changed` on `regions`, `expires_at`, `content`, `steps` or `rank`, `.ended` with `final: true` for that zone's id when `regions` turn null or the moment ends there. `expires_at` = on air: `now + budget − played`; not on air: `fresh_at + stale_after`. `starts_at` of a new send = `now − played_ms`. The emergency keeps `reconcile` as it is.
- `Engine.request` and `.end`, `.extend`, `.setContent` and `.show` call `passZone` for each zone the moment covers instead of `reconcile`. `.extend` → `addBudget`. `Engine.forward(c, m, zone, actor, now)` sets `forward_at` and writes history `moved`.
- `placements.ts` `applyClaims`: a granted slot reported `hidden` or `unplaced` → `pauseSlot`; reported `placed` → `resumeSlot`; then `passZone`.

- [ ] Tests first (`airtime.test.ts`, a real Postgres as `engine.test.ts` does, one zone `main`, the outbox read back as events):
  - "the 90 s floor holds against a higher rank": a `finals_result` card started at t0 and reported placed in `hero`; an announcement requested at t0+5 s answers 201 and its `main` override starts with `regions` `["rail", "ticker"]`. At t0+89 s the card's override is unchanged. At t0+90 s the card's override ends (`final: true`, generation 1). At t0+100 s the announcement's override changes `regions` to `["hero", "rail", "ticker"]`.
  - "an emergency still cuts in, and the clock pauses under it": card on air for 10 s, then an emergency, and Screen reports the card `hidden`. 30 s later the emergency ends and Screen reports the card placed. The card's `expires_at` is `now + 110 s` (±1 s).
  - "a pushed-aside moment comes back with its remaining time": the card (budget 120 s) yields at 90 s to a higher one whose own budget is 60 s. After that one ends and the gap, the card's new override `<id>.main.2` has `expires_at` `now + 30 s` and `starts_at` `now − 90 s`.
  - "nothing is dropped before stale_after or source_ended": a queued `hot_game` is still running at 29 min 59 s and ends `stale` at 30 min, with a history row `ended`/`stale`. Another ends `source_ended` on `games.surge.ended` while queued.
  - "the rail shows the next in line": while the card holds the hero, the first queued claimant with `rail` has `regions` from `rail` on, and the second has no override on `main`.
  - "a newer version replaces the queued one": two `standings` requests with the same `dedupe_key` → one running moment with the second content, its `queued_since` unchanged.
  - "routine moments condense past the threshold": 5 `hot_game` surges queued behind a holder → after the holder, one override with 4 `steps` of `max(8000, 90000/4)` ms, and when its budget ends all 4 end `expired`.
  - "a restart keeps the holder and its played time": rebuild the Engine mid-floor; the next pass sends nothing new.
  - "ending the holder frees the hero after the gap": `/end` on the holder → the head gets the hero 10 s later.
  - "Extend adds to the budget of a waiting moment": a queued one extended by 60 s gets 60 s more on air when it holds the hero.
  - "two passes at once give the hero once": two concurrent `passZone` calls on two connections → one `.changed` to `hero`.
  - "a request is refused only for one owner per happening".
- [ ] Run `npm test -- test/airtime.test.ts`. Expected: FAIL.
- [ ] Implement the files above. Delete `rule-retries.ts` and the tick's patience pass, and drop `blockedOn`/`heldOn` and their tests. Update the existing engine and lifecycle tests' expectations: per-zone override ids, no refusal or patience. Every test that asserted a refusal or a patience end now asserts the queue's behaviour; none is deleted without a replacement.
- [ ] Run `npm test -- test/airtime.test.ts test/engine.test.ts test/lifecycle.test.ts test/review-edges.test.ts test/catch-up.test.ts test/rules.test.ts test/arbiter.test.ts`. Expected: PASS.
- [ ] Commit `feat(moments): the arbiter queues, holds a floor and pauses the clock (#777)`; push.

### Task 5: Stories and Pizza is here
**Files:** `src/story/runner.ts`, `round.ts`, `store.ts`, `routes.ts`, `builder-side.ts`, `pages.ts`, `presets.ts`, `presets-every.ts`, `src/rules.ts`; tests `test/story-runs.test.ts`, `story-routes.test.ts`, `story-catalogue.test.ts`, `story-presets.test.ts`, `story-pizza-done.test.ts`, `story-builder-pages.test.ts`, `rules.test.ts`.
- [ ] Tests first:
  - `rules.test.ts`: "Pizza is here is an announcement on the hero": `pizza.order.arrived` (fixture) starts a moment of class `announcement`, template `announcement`, regions `["hero", "rail", "ticker"]`, `ttl_seconds` 180, content `{title: "Pizza is here", body: "Order 12 · Collect at Entrance table", level: "info", ticker_line: "Pizza is here · Order 12 · Collect at Entrance table"}`, and the food-box moment keeps `pizza_placed` in the venue rail. `pizza.order.done` ends the arrival moment `source_ended`.
  - `story-catalogue.test.ts`: the catalogue has 23 presets and no `pizza_arrived`; a stored `pizza_arrived` copy is not loaded.
  - `story-runs.test.ts`: "a round is never deferred by airtime" (four stories back to back all start their rounds); "a queued round is replaced by the next" (the round's `dedupe_key` is `story:<run id>`; round 2 due while round 1 still waits → one moment with round 2's steps); "a round waits instead of being skipped for a held region".
  - `story-routes.test.ts`: settings without `airtime_percent` save; with it, it is kept and returned.
- [ ] Run them. Expected: the new cases FAIL.
- [ ] Implement D15 and D16; remove `story-pizza-done.test.ts`'s preset cases or move them to the rule's arrival moment (the order's done still ends it).
- [ ] Run the story and rules tests. Expected: PASS.
- [ ] Commit `feat(moments): stories queue without a cap, and Pizza is here is an announcement (#777)`.

### Task 6: On air shows the queue
**Files:** `src/on-air-data.ts`, `src/views.ts` (or a new `src/queue-views.ts` if `views.ts` passes 400 lines), `src/routes.ts`, `static/on-air.css`; tests `test/on-air.test.ts`, `test/routes.test.ts`, `test/grids.browser.test.ts`; shots `scripts/demo-screenshots-moments.mjs`.
- [ ] Tests first:
  - `routes.test.ts`: "the list carries each zone's queue" (D14's shape, in queue order, `in_rail` on the waiting-room one, a stale one under `stale`); "forward moves one to the front, audited, once per key" (409-free; the same `Idempotency-Key` answers the same; history `moved`; a moment not waiting on that zone is 409 `not_running`).
  - `on-air.test.ts`: each zone's card lists "On air" (the holder, with its time left), then "Waiting" as a list (`ol`, one row each: title, class, waiting time, "In the rail" where so, buttons "Move forward" and "Skip"), then "Went stale" (the last hour). It does not use boxes: `.canccu-list` rows, as amendment 3's forms ask. Without waiting moments the zone says "Nothing waiting".
  - `grids.browser.test.ts`: the queue list fits at 390 px with no horizontal scroll.
- [ ] Run them. Expected: FAIL.
- [ ] Implement. The page's forms post to the API (`app.inject`) as the other crew actions do.
- [ ] Run them. Expected: PASS.
- [ ] Shots: keep `moments-on-air` and `moments-on-air-phone`. Their fixture's second spotlight now pushes the first into the queue, so both shots show a queue. Add a third request so the list has two rows and one "In the rail". Check `scripts/demo-screenshots-groups.mjs` needs no new path.
- [ ] Commit `feat(moments): On air shows each zone's queue, with Move forward and Skip (#777)`; push.

### Task 7: The stack test
**Files:** create `modules/moments/ci/airtime.mjs`; modify `scripts/demo-stack-test` (a new `TESTS` entry beside `moment_latency`), `modules/screen/test/stack/food.mjs`, `scripts/demo-screenshots-pizza.mjs`.
- [ ] Write `airtime.mjs`, run as `moment-latency.mjs` is (copied beside Screen's stack client into the screen container):
  1. `PUT /api/moments/priorities` with `airtime.min_on_air_seconds` 60 (the range's floor, to keep CI short) and gap 10; it puts the old settings back at the end.
  2. Pair a screen into `main` and keep its stream open.
  3. The winner card: the bash wrapper XADDs a `tournament.match.finished` of a final into the demo event's tournament stream in the kit's envelope (`packages/kit-ts/src/bus.ts`; the wrapper `exec`s `valkey-cli` in the valkey service). Wait for a hero claim with template `winner_card` (T0).
  4. At T0+5 s XADD `pizza.order.arrived` (fixture order, pickup "Stack table"). Within 5 s: a rail claim with the "Pizza is here" announcement, and the hero still the card.
  5. The hero turns to "Pizza is here" not before T0+58 s and by T0+75 s (floor 60 s, gap 10 s, a 5 s margin for a CI tick).
  6. XADD `pizza.order.done`; the card is back on the hero within 15 s. Its claim's `expires_at` minus now is the card's remaining 60 s (120 − 60) ± 5 s.
  It prints `airtime: card held <s> s, pizza in rail after <s> s, card back with <s> s left`.
- [ ] Update `food.mjs` and the pizza shots: "Pizza is here" is now the announcement card on the hero (D16), with no sting and no art.
- [ ] Run it on a local demo stack (memory: the local stack beside the shared one), `timeout 600 scripts/demo-stack-test moments`. Expected: the new check passes.
- [ ] Commit `test(moments): the stack holds a final's card for its floor, then Pizza is here, then the card again (#777)`; push.

### Task 8: Docs and the finish
- [ ] `modules/moments/README.md`: the arbiter paragraph, the legacy rules paragraph (replaced by the queue), the tick, Storyboards (no cap), the files list (`air-plan.ts`, `air-store.ts`, `air.ts`, `air-settings.ts`; `rule-retries.ts` gone).
- [ ] Run `cd modules/moments && npm run lint && npm run typecheck` and the touched test files, then `tests/run repo` (the repo checks: naming, file size, contracts, event names, tenancy). Expected: all pass, no file over 400 lines.
- [ ] PR body: `Closes #777`, the deprecation table above as the answer to "is it breaking" (no, additive), "Events that saved their own order keep it", the decisions D1–D19 under `Decisions made:`, `Risk: high — the moments contract and the screen arbiter`, `Tier: feature`, the Testing and Revert lines (`Revert: plain revert; migration 009 is additive and its tables stay unused`), `Follow-up: drop the deprecated patience_seconds, airtime_percent and moments_rule_retries in their own PR`, `Roadmap note: the hero's Pizza is here lost #775's art; an image on the announcement view-model needs a Screen contract change`, the 390 and 1280 px shots of On air.

About 3,000 changed lines with tests, under the 4,000 package limit.
