# Step 4 (Moments): deep review

The whole change of step 4, from the tag `step-3` to `origin/main` at `92b6cbd403d30b9376d3f0b904178f837bb2a2f0` (28 PRs, 548 files, about 52,600 lines added), read against [AGENTS.md](../../AGENTS.md), the step's accepted plan ([step-4-moments.md, ## Plan](../briefs/step-4-moments.md#plan)) and the contracts it relies on: `contracts/moments.md`, `contracts/moments*.yaml`, `contracts/moments/*`, `events.md`, `screen.md`, `notify.md`, `tenants.md` and `theming*`.

This review does not repeat the step's follow-up issues #529, #531, #534, #538, #569, #586, #592, #598, #605 and #608. Among them: #592 covers the Valkey counters inside the start transaction and the gates failing open when Screen's zone-sound call times out, and #586 covers the Priorities preview with split zones.

## Architecture

**What holds up**

- **One arbiter, as the plan says (D1).** The arbiter has a pure core (`modules/moments/src/arbiter.ts`, `cues/decide.ts`) inside a transactional engine. Every moment, override, placement, story run and announcement is a Postgres row. The tick owns every TTL, revert and patience. Events go out through a transactional outbox: the new `packages/kit-ts/src/outbox.ts`, which Screen now also uses for `screen.pin.changed`. Screen keeps the newest Moments event per zone by UUID-v7 event id, so a duplicate or reordered delivery does no harm. Screen still places, and Moments ranks, times, queues and refuses.
- **Serialised concurrency.** Each zone's sound decision takes a row lock (`FOR UPDATE`). Settings saves and the one-emergency-per-event rule use advisory locks. Every settings write checks a revision.
- **Pages go through the API.** The server-rendered pages make every action through the module's own API (`viaApi`), so a page gets the API's rights, idempotency key and audit for free.
- **Announcements and storyboards reuse the engine.**
  - An announcement is a row with up to two crew moments: the card on its level's chain, and the ticker line, a claim in the `ticker` role. Edits move through `setContent` with no cue.
  - A story round is one `storyboard` moment carrying `steps`. A video step becomes its own full-screen moment.
- **Screen stays the composer.** It folds Moments' events (`override.*`, `scene.changed`, `sound.played`, `prefetch.changed`) into `display.scene`, `sound.play` and `prefetch`, using new tenant tables (015–018).

**What a single PR could not see**

- **The inputs are less durable than the state.** Moments subscribes to every input stream from `$`, which means "from now". Its replay subscription keeps only zone events. So "a restart loses nothing" (E2) holds for what Moments writes, not for what it hears: placements and archiving that happen during a deploy are lost. See blocking 1.
- **Nobody owns `expires_at`.** Three paths write a moment's end time: renewal (E4), the crew's Extend, and the rules' re-asking. They disagree. A renewal resets the end to now + TTL, which undoes an Extend. See blocking 3.
- **The legacy "refusal with retry" became refusal without retry.** The 30 s retry is promised in the API answer and in the history row, but nothing re-asks. See blocking 2.
- **One transaction runs a whole event's tick.** That covers moment expiries, scheduled announcements, story runs and scenes. One exception in any of them rolls the whole tick back, every second, for that event. See blocking 7. The tick and crew actions also make HTTP calls to Screen, tenants and Valkey while row locks are held; part of that is already filed in #592.
- **Two copies of the item-visibility rule.** The announcement composer and the storyboard take each check a run-of-show item's visibility on their own. Only the composer applies `canSee` and refuses `{item.*}` from a non-public item. See blocking 5.
- **Hand-kept lists drift apart.**
  - The Studio menu (`packages/ui/src/menu.json`, mirrored in `canccu_kit/ui_base.py`) and the Studio's own page guard (`ANY_TAB`) are two lists of the same rights, and they already disagree. See blocking 10.
  - Screen's `REBUILDS` list in the push hub was not extended for `moments.prefetch.changed`. See blocking 9.
  - The CI screenshot list of built-in storyboards (`PRESET_SHOTS`) has no check against the preset catalogue.

## Security

**Checked and clean**

- **Rights.** Every Moments route checks the right the plan's Rights table names: `read`, `announce` (urgent included, U3), `take`, `scenes.take`, `emergency` and `settings.write`.
- **Tenancy.** Every per-event table in Moments migrations 001–005 and Screen migrations 015–018 has ENABLE + FORCE RLS with the `canccu_tenant` policy. Every query runs inside `db.tenant`. The global tables (`moments_tenants`, `*_outbox_tenants`) are listed in `scripts/tenancy-global-tables.txt`.
- **Internal paths.** Screen's `/internal/screen/` requires the service token. Caddy routes no `/internal/*` path, and the new `/moments/*` strip has the hidden-path guard; the stack smoke checks it.
- **Requests and emergencies.**
  - Crew actions carry an idempotency key, stored in the action's own transaction.
  - The kit checks Origin on every request.
  - The venue-wide emergency is filtered by `venue_id` and skips archived events.
- **Escaping.** Organiser text is escaped by `@canccu/ui` `html`, `static/moments.js` writes only with `textContent`, and the video step builds YouTube embed URLs only from a validated id.
- **Kit and access fixes.**
  - Sign-in retry and return links are same-origin.
  - The draft-event answer is fetched again with the cookie and never cached.
  - `get_flags` now uses `is_member`, as tenants.md says.
- **Workflows.** No `pull_request_target`. `release-tag.yml` runs only for pushes to main, from main's own scripts. Tokens are scoped per job.

**Found**

- **A crew-only title can reach public screens.** A storyboard fired by hand accepts any run-of-show item, including crew-only ones, and fills `{item.title}` onto public screens. The "Moments crew" preset (no `agenda.crew.read`) can do this from the Fire form. This is blocking 5.
- **Actors' names outlive their retention.**
  - Moments does not consume `tenants.retention.reached`, so these keep actors' names and ids past the 12-month anonymisation tenants.md asks for: `moments.actor_name`, `moments.why` ("Name · spotlight"), `moments_announcements`, `moments_story_runs` and `moments_scene_crew`.
  - `forgetUser` also skips `moments_scene_crew` and the stored idempotency answers.
  - This is a platform-wide pattern (only Notify consumes the event), so it is listed as non-blocking.
- **`weekly.yml` interpolates a tag name into `run:`.** Only maintainers can push tags and the job's token is read-only, so it is non-blocking.

## Contracts

**Kept as written**

- **Priorities and timing:** the priority order and ranks; TTL 120 s by default and at most 7200 s; extend 1–3600 s, capped at 7200 s; the patience defaults; `final` on `.ended`.
- **Scenes, sound and the gates:**
  - the `moments.scene.changed` fields, and `play_at` in `ScreenState.sound`;
  - the order of the sound gates and their reason codes;
  - only urgent interrupts a playing sound;
  - the 4 s stale queue, 2 s coalescing, 10 s per source and once per source for 7 days;
  - never the same sound twice running;
  - the 1 MiB / 30 s upload limits.
- **Announcements:**
  - the event names `moments.announcement.sent`, `.changed` and `.withdrawn`, with `data.urgent`;
  - the level chains and the full-screen chain;
  - L4 (the ticker line and the degraded card both show);
  - Notify's `announcements` topic, whose JSON matches the contract block.
- **Screen:** the `transition` step field.
- **Moved, not removed:** the paths taken out of `theming.openapi.yaml` all moved to `theming/revisions.openapi.yaml`. The changes to `screen/content.openapi.yaml` and `events.md` are rewordings or additions.
- **The one breaking change:** D2, several overrides of a kind per zone, came in its own PR (#587) with the maintainer's accept, as the Contracts rules ask.

**Not kept**

- **Refusal with retry** (`moments.md:51`): "The answer, and the rule, wait 30 s before asking again." No rule is ever asked again. This is blocking 2.
- **Override ids** (`moments.md:38`): the contract says one override per rank, with the id `<moment id>.<rank>`. The code makes one per zone, with the id `<moment id>.<zone>`. This is blocking 4.
- **Preload** (`screen.md:236`): "adds each file to the `prefetch` of those zones … so the players hold the file before any run". Screens that are already connected never get the new list. This is blocking 9.
- **Storyboard schema** (#114): "stored as data validated by a JSON schema". `check.ts` is a hand-written subset of `storyboard.schema.json`. It accepts unknown properties, and an unknown `until_event.kind`, which is then treated as `item_ends`. A missing `rounds` gives a 500 instead of a 400. This is blocking 8.
- **Re-posting extends it** (`moments.md:50`): a renewal also shortens a moment that the crew extended or that had a longer TTL. This is blocking 3.

## Test quality

**Checked and clean**

- **Nothing skipped or weakened.** No quarantine and no `.only` in the step. Every skip depends on an environment variable (DB, Valkey, browser, node), and CI sets those for every leg.
- **Moved, not weakened.**
  - The 29 assertions that left `studio.browser.test.ts` moved intact to `studio-brand.browser.test.ts`.
  - The other changed assertions follow behaviour changes (`sounded_claims`, the page-style 403).
- **Real tests.** The Moments tests run on real Postgres with an in-memory bus and a movable clock. Most of them are meaningful.

**Found**

- **The Moments stack smoke cannot fail on a wrong status.** Its "without a session is 401" and sound-pack checks use `[ … ] && jq …` under `set -e`, which never fails on the first test. An auth regression answering 200 would pass. This is blocking 11.
- **Gate items whose tests can pass while the behaviour is broken:**
  - The 50-trigger burst test starts exactly on a minute boundary, so it cannot see that the counters use fixed clock windows: 6 sounds can play in 14 s across a boundary.
  - The refusal test checks only `retry_after_seconds: 30`, never that a retry happens.
  - Every storyboard test-fire uses `sound: false` and never reads the sound log, so "silent unless chosen" is untested (blocking 6).
  - Prefetch is tested only through a fresh `GET /state`, never on an open stream (blocking 9).
- **The stack tests are weaker than they read.**
  - `sound-sync.mjs` uses screen A's `play_at` for both screens, so any two arrivals within the 400 ms lead give a spread of 0.
  - Both Moments stack tests run only under the `moments` tag, so a Screen-only PR skips them.
  - The new kit-ts outbox has no test of its concurrent paths.

Blocking:
1. [correctness] modules/moments/src/main.ts:115 — Moments hears its inputs only from "now", so placements and archiving that happen while it restarts are lost (E2, E10)
   Evidence: `subscribeTenants(TENANT_STREAMS, …)` takes the kit's default `fromId: "$"` (`packages/kit-ts/src/bus.ts:161`), and the replay subscription (`fromId: "0"`, line 116) keeps only zone events. Sequence: a rule moment (patience 120 s) is unplaced on `main` at t0. Moments restarts at t0+30…40 (every merge redeploys). At t0+35 Screen places it and emits `screen.claims.changed`, which Moments never reads. At t0+120 the tick ends the moment as `preempted` while it is on screen. Archiving: an event archived during the restart never gets `archived_at` (only `consumer.ts:51` sets it), so its rules keep firing, its history is never deleted 30 days later (D21), and its emergency cannot be ended (409 `event_archived`).
   Fix: catch up at boot. Re-read Screen's current placements per zone, or apply the newest `screen.claims.changed` per zone from the replay, for live overrides. In the tick, compare `tenants.byId(t).status` with `moments_tenants.archived_at` and run `endAll` for an event that is archived. Add a restart test for each.
2. [contract] modules/moments/src/rules.ts:227 — a refused rule moment is never asked again; the 30 s retry exists only in the answer
   Evidence: moments.md:51 "The answer, and the rule, wait 30 s before asking again". `applyRules` drops the refusal ("refused requests are left for the next event to ask"), and nothing stores or re-asks it. A `tournament.match.called` refused behind a full-screen announcement that ends 5 s later is never shown, yet the history says "refused, retry in 30 s". The test (`engine.test.ts:117`) checks only `retry_after_seconds: 30`.
   Fix: store refused rule requests with `retry_at = now + 30 s` and re-run them from the tick; hold back the rule's own re-asks until then. Test that a refused rule starts once the holder ends and 30 s have passed.
3. [correctness] modules/moments/src/engine.ts:134 — a renewal (E4) sets `expires_at = now + ttl`, which shortens a moment and undoes the crew's Extend
   Evidence: a standings rule moment (TTL 120) starts at t=0. At t=10 the crew extends it by 3600 s, to t=3720. At t=60 a `tournament.leaderboard.changed` renews it, and `expires_at` becomes t=180: the extension is lost. A module that posts `ttl_seconds: 3600` and re-posts the same `dedupe_key` without a TTL gets 120 s. Contract moments.md:50 says "Re-posting extends it".
   Fix: `expires_at = max(running.expires_at, now + ttl)`, taking the moment's own TTL when the request has none. Test an Extend followed by a renewal.
4. [contract] modules/moments/src/arbiter.ts:96 — overrides for zones with their own order get the id `<moment id>.<zone>`, one per zone; the contract fixes `<moment id>.<rank>`, one per rank
   Evidence: moments.md:38 "a moment whose zones rank it differently is shown by one override per rank … one for a zone's own rank has `<moment id>.<rank>`". The code: `wanted.push({ id: \`${moment.id}.${z}\`, zones: [z], rank: … })`. Two zones with the same own rank get two overrides with different ids instead of one.
   Fix: amend moments.md:38 to say what the code, store, tests and pages rely on: one override per own-ranked zone, id `<moment id>.<zone key>`. Screen treats ids as opaque, so no consumer changes.
5. [security] modules/moments/src/story/routes.ts:304 — firing a storyboard by hand accepts a crew-only run-of-show item and puts its title on public screens
   Evidence: `items.find((i) => i.id === body.item_id)` checks nothing else, and `takeStory` fills `{item.title}` from that item into the round on screen. The Fire form (`story/pages.ts:34`, `story/views.ts:169`) lists every scheduled item. So the "Moments crew" preset, which has `moments.take` but not `agenda.crew.read`, sees crew-only titles and can show them. The automatic trigger skips non-public items (`triggers.ts:53`). The composer refuses this exact case with `canSee` and "not public: its `{item.…}` fields cannot go into an announcement" (`announce/routes.ts:128-135`).
   Fix: filter the form's list and the route's lookup with `canSee(item, rights)`, and refuse a non-public item when the story's texts use `{item.*}`, as `announce/routes.ts` does. Add a route test with a crew-only item.
6. [correctness] modules/moments/src/story/round.ts:170 — a test-fire with "with sound" off still plays a video step's own sound
   Evidence: #114 "test-fire on one zone, silent unless chosen". `@test_sound` gates only step cues (`runner.ts:221`). `startSegment` always calls `engine.sound.video(...)`, which mutes only for master off, timed mute, no sound screen or calm/quiet. Test-firing Premiere with `{test:{zone:"main", sound:false}}` on a lively zone plays the film's audio. That counts against the minute and hour budget and holds every non-urgent sound for the video's length. No test reads the sound log for a test-fire (`story-routes.test.ts:203`).
   Fix: when `run.test && run.facts["@test_sound"] !== "1"`, put every zone in `muted_zones` and skip `sound.video`. Add tests for `sound: false` and `sound: true` that read the sound log.
7. [correctness] modules/moments/src/story/fill.ts:134 — a free placeholder named after an `Object.prototype` key (`{constructor}`) passes validation and then throws, halting the event's whole tick
   Evidence: `FREE = /^[a-z][a-z0-9_]{0,31}$/` (`story/model.ts:260`) accepts `constructor`, and `ctx.facts[name] ?? ""` returns the `Object` function, so `.trim()` throws "v.trim is not a function". With a clock trigger, `buildRound` throws inside `tickTenant`'s single transaction every second. That rolls back the event's expiries, scheduled announcements and story runs, and leaves only a log warning. The composer has the same lookup (`announce/text.ts:117`): `{constructor}` answers 500 instead of "Fill in {constructor}".
   Fix: look up only own keys (`Object.hasOwn`), or build `facts` and `variables` with `Object.create(null)` or a `Map`. Run each story run's tick work in a savepoint, so one bad run cannot stop the rest. Test `{constructor}` in both places.
8. [criterion] modules/moments/src/story/check.ts:205 — storyboards are not validated by their JSON schema, only by a hand-written subset
   Evidence: #114 "stored as data validated by a JSON schema". `storyboard.schema.json` sets `additionalProperties: false` in 18 places. `checkStory` never rejects unknown properties, never checks the types of `message`, `on_the_dot` or `preset`, and never checks the `until_event.kind` enum: `{kind:"foo"}` is saved and then treated as `item_ends`. A body without `rounds` throws a TypeError, so the client gets a 500, not a 400. `story-model.test.ts:289` compares only the presets' key sets with the schema.
   Fix: validate the PUT body against `contracts/moments/storyboard.schema.json` (Ajv, for example) before `checkStory`'s plan limits. Test an unknown property, a bad enum and a missing `rounds`, each answering 400.
9. [correctness] modules/screen/src/push/hub.ts:35 — `moments.prefetch.changed` never reaches a screen that is already connected
   Evidence: screen.md:236 "adds each file to the `prefetch` of those zones … so the players hold the file before any run". `REBUILDS` lists `moments.override.`, `moments.sound.` and `moments.scene.` but not `moments.prefetch.`, so `handleEvent` returns at line 150. When a later event rebuilds the zone, `diffZone` (`push/diff.ts:52-58`) sends a whole `state` only when the zone, sound, display or bundle changed, and `prefetch` exists only in `state`. Open screens keep the old list until they reconnect. The test (`moments-sound.test.ts:265-277`) reads only a fresh `GET /state`.
   Fix: add `"moments.prefetch."` to `REBUILDS`; in `diffZone`, return `null` when `before.prefetch` and `after.prefetch` differ. Add a stream test.
10. [correctness] packages/ui/src/menu.json:43 — the "Screen studio" menu item is shown for `screen.content.write` alone, and leads that role to the "no access" page
   Evidence: #571 added `screen.content.write` to the item's rights (`menu.json:43`, `canccu_kit/ui_base.py:58`), and tests assert that the item shows. `/admin/screen/` is guarded by `pageNeeds(deps.rights, ANY_TAB)` (`modules/screen/src/studio/page.ts:71`), and `ANY_TAB` has no `screen.content.write`: the Schedule and Content tabs need `screen.content.read` (screen.md "content.read for reads"). A session with only `{"screen.content.write"}` sees the item and gets 403.
   Fix: drop `screen.content.write` from the item in both menus, or accept it in `ANY_TAB` and on the Schedule and Content pages. Add a Screen test that the Studio landing answers for every right the menu lists.
11. [test] modules/moments/ci/stack-smoke.sh:12 — the "API without a session is 401" checks (lines 12, 15, 18) and the sound-pack check (line 32) cannot fail
   Evidence: `[ "$code" = 401 ] && jq -e '.error.code == "not_signed_in"' "$t/r.json"` under `set -euo pipefail`. Bash does not exit when the first command of an `&&` list fails. `bash -c 'set -euo pipefail; code=200; [ "$code" = 401 ] && echo jq; echo continued'` prints "continued" and exits 0. An API answering 200 without a session (an auth regression) passes the smoke.
   Fix: split each into `[ "$code" = 401 ]` and `jq -e …` on separate lines, or append `|| exit 1`. Run the script once against a stack where the check fails, and confirm it fails.

Non-blocking:
- [test-gap] modules/moments/src/cues/counters.ts:47 — the minute and hour sound counters are fixed clock windows (`floor(now/60 s)`), so 3 sounds at 18:00:50–54 plus 3 at 18:01:00–04 play 6 in 14 s. The E14 burst test starts exactly at 18:00:00 (`test/helpers.ts:102`); use a sliding window and a burst test that starts mid-minute.
- [other] modules/moments/src/consumer.ts:255 — Moments ignores `tenants.retention.reached`. Actors' names and ids stay past the 12-month anonymisation (tenants.md) in `moments`, `moments_announcements` and `moments_story_runs`. `forgetUser` also skips `moments_scene_crew` and the stored idempotency answers. Only Notify consumes the event, so this is platform-wide.
- [other] modules/moments/src/cues/service.ts:95 — a rule's cue sounds on every zone of the request before placement is known, so a `hot_game` placed only on `stage` also sounds on `main` behind a full-screen announcement. Story steps already log `hidden` for this case.
- [other] modules/moments/src/tick.ts:22 — two containers' ticks can deadlock: the expiry pass locks with `SKIP LOCKED`, then the patience pass waits on `lockMoment`. Postgres aborts one and the next tick heals it, but the comment at `store.ts:78-83` says the waits cannot deadlock.
- [other] packages/kit-ts/src/outbox.ts:93 — a writer whose flush finds the tenant's advisory lock taken returns 0, trusting the holder, but the holder loops again only after a pass that sent something. A holder that read 0 rows before the writer committed leaves the event to the next timer pass, about 1 s late against O2's "<1 s p95".
- [test-gap] packages/kit-ts/test/outbox.integration.test.ts:1 — no tests of the concurrent paths: two flushes at once, a writer committing during `forget`, and one tenant's flush never sending another's rows.
- [test-gap] scripts/demo-stack-test:79 — `moment-latency` and `sound-sync` are tagged `moments` only, so a PR that changes only `modules/screen/src/moments-sound.ts` skips them; tag them `moments screen`.
- [test-gap] modules/moments/ci/sound-sync.mjs:80 — the 200 ms check uses screen A's `play_at` for both screens, and with the 400 ms lead any two arrivals give a spread of 0; read each screen's own `play_at` and assert that they are equal.
- [test-gap] scripts/demo-screenshots-stories.mjs:63 — `PRESET_SHOTS` is a hand-kept list with no check against the preset catalogue (it matches today: 24 keys), so a new built-in would ship without its CI screenshot.
- [other] .github/scripts/regressions.mjs:64 — `per_page=1` goes through `list()`, which always passes `--paginate` (`gh.mjs:13`), so the call walks every successful scheduled run, one API request per run; use `get(...).workflow_runs[0]`.
- [other] .github/workflows/weekly.yml:117 — `${{ steps.base.outputs.tag }}` is interpolated into `run:` (a tag name may hold `$(…)`); pass it through `env:`. Only maintainers push tags and the token is read-only.
- [other] modules/moments/src/story/views.ts:169 — the Fire form's item times are `starts_at.slice(11, 16)` of a UTC string, so "19:00" in Helsinki shows as "16:00" or "17:00"; format them with `hhmm(starts_at, time_zone)`.
- [other] modules/moments/src/story/routes.ts:321 — a refused take ("it already runs", "once per event") still writes the audit entry `moments.storyboard.fired`; audit after the check, or record the outcome.
- [other] modules/moments/src/story/pages.ts:59 — the builder's "All stories on <zone>" airtime meter leaves out the filters the cap applies (`template <> 'video'`, `left_zones`, `runner.ts:146`), so it can show more than the cap counts; share one query.
- [other] packages/ui/src/menu.json:40 — the "Moments crew" preset (no screen rights) cannot reach On air or Scenes from the menu, because the Screen studio item does not list `moments.read`, which `ANY_TAB` accepts.
- [style] modules/screen/src/health.ts:238 — `soundedOf` sits between `forgetHealth`'s doc comment and `forgetHealth`, and `forgetHealth` does not delete `keys.sounded(id)`, which its comment promises ("starts afresh").
- [docs] docs/ci.md:58 — the API tests list does not name Moments' two stack tests (latency p95 < 1 s, sound sync within 200 ms), and `scripts/demo-screenshots-groups.mjs:104` still says demo-stack-test covers admin, agenda, notify and screen only.

Pre-existing:
- [other] packages/kit-py/src/canccu_kit/outbox.py:117 — the same lock-busy shortcut as the kit-ts port (`pg_try_advisory_xact_lock`, return when taken), with the same late-delivery window.

Risk: high — the step's packages include a breaking contract change (#587), `.github/` gates and `AGENTS.md` (#585), each needing the maintainer's accept; the rest are normal (new module, additive contracts and migrations).
Findings: 11 blocking, 17 non-blocking, 1 pre-existing
Review verdict: changes 92b6cbd403d30b9376d3f0b904178f837bb2a2f0
