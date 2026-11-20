# Plan: the general tourney core

Issue #681. The design and test plan for the one tourney core of [0030](../decisions/0030-finals-integrated-one-tourney-core.md): finals-core becomes the platform's single engine for brackets, team forming and scoring, and THE FINALS becomes one preset of it. This file changes no code and no contract. The code goes to the core's own repo afterwards, as the tickets in [Order and size](#order-and-size).

**Read:** `glyzer/finals-core` at `9d65a84` (`main`, tag `v1.0.1`): `ladder`, `rankings`, `teambuilder`, the typings, its 20 tests and the release workflow. The mini tourney at `1a4fe2a` (`main`), how its `src/service.js` calls the core and its suite: `npm test` now runs **99 tests**, not the 61 of the first inventory, all passing on Node 22.23.4 ([inventory, Tests](../legacy-inventory/thefinals_mini_tourney.md#tests)). The [mini tourney inventory](../legacy-inventory/thefinals_mini_tourney.md) as refreshed in #679. [Step 7's pack](../briefs/step-7-tournament.md) and [question bank](../briefs/step-7-tournament/questions.md) (U1, U6, D2, D3, D13, P4, E13). [contracts/games.md](../../contracts/games.md), [contracts/events.md, Tournament](../../contracts/events.md#tournament), [0025](../decisions/0025-finals-and-games-modules.md) and [0030](../decisions/0030-finals-integrated-one-tourney-core.md).

**Checked by a prototype.** The seven THE FINALS formats below were written as data and run by a small engine built from the rules in [The API](#the-api). It was compared with v1.0.1 using a seeded random source: 3,000 seasons per format with random results, and every draw, every `nextRound`, the champion and the ranking deltas came out identical. The team builder, generalised to any team size, gave the same teams as v1.0.1 for every team count from 3 to 36 at team size 3. The prototype is not committed; the equivalence tests below make it permanent.

## What the core is today
- **`ladder`:** seven formats, each a `ROUNDS_*` table (name, game mode, placements recorded) plus a hand-written `nextRound` branch per format, with a fixed capacity each (`CAPACITY`). Groups are lobbies of 3 or 4 teams, and the final is a first-to-two series.
- **`rankings`:** one non-stacking delta per team (champion, lost final, a "semifinal tier", everyone else) from a per-format table, and `clamp` to 0..100.
- **`teambuilder`:** teams of exactly 3 with the most even rating sums: the best of 20 random starts, each improved by pairwise swaps.
- **Randomness:** an optional `rng` (`() => number`, `Math.random` by default) on the functions that draw. The app never injects one, so its tests check properties, not exact draws.
- **What is fixed to THE FINALS:** team size 3, the seven capacities, game modes, the series length, the delta tables and the 0..100 range. Everything else is already pure, small and free of I/O.

## Parameters
Each value THE FINALS fixes today becomes a parameter. The table shows which ones each of the three users needs. "Official" is Tournament's official tournament, following step 7's recommended direction C: a season of sessions, with heats or rounds inside a session as an option. Step 7's plan is not written yet. Where that plan settles a question differently, the generator's defaults follow the plan; the parameters themselves stay.

| Parameter | What it is | Official tournament (Tournament) | Mini tournament, any catalogue game (Tournament) | THE FINALS preset |
|---|---|---|---|---|
| **Team size** | Players per team | 1 for solo sessions, or the game's team size (U2, U6) | The game's `team_size` from Games (1 for 1v1, 5 for 5v5) | 3 |
| **Teams per match** | `{min, max}` teams in one game | One match for everyone by default; heat size within the game's range | The game's `teams_per_match` (2 for 1v1 and 5v5) | 2–4: Cashout 4, Quick Cash 3; HEAD2HEAD and the final are 2-team games, so the issue's "3–4" covers only the qualifying rounds |
| **Entrants** | How many teams or players start | Any count from 2; the generator builds rounds for that count | Any count from 2, with byes where the bracket needs them | Fixed: 3, 4, 6, 8, 9 or 12 |
| **Format** | Rounds as data (see [Formats as data](#formats-as-data)) | `heats` with "winners advance"; one match when no rounds are set (P4 B) | The game's default format, which an organiser may change: `single_elimination`, `groups_knockout`, `heats`, `open_heats`, or a preset's format | Its seven tables |
| **Arrangement** | How a round fills its groups: `keep` (seeded order), `shuffle`, `shuffle_no_repeat`, `round_robin` | `keep` for seeded heats (D13), `shuffle` otherwise | `keep` for brackets (standard seeding), `round_robin` for 2-team groups | `shuffle`, `keep`, and `shuffle_no_repeat` in `eight` round 2 |
| **Advance** | Placements a game records | Top *k* of each heat | 1 per game; group places in `groups_knockout` | 1–3 per round |
| **Series** | `{first_to, max_games}` on a round | None by default | Best of *n* per round, with a separate best of *n* for the final | Final: first to 2, at most 3 games; `four` round 2: first to 2, no limit |
| **Placement matches** | A round that takes the losers of an earlier round | — | `third_place` in `single_elimination` | HEAD2HEAD and the Second Chance rounds are such rounds |
| **Placement bands** | The format's tiers in final order: champion, finalist, then tiers named in the format | The crew's coarse placement: 1st, 2nd, participant, no-show (D2) | Champion, finalist, losing semi-finalists | Champion; lost final; a "semifinal tier" (in `four` the Quick Cash game winners, in `fourqc` the Quick Cash teams, none in `three`) |
| **Scoring table** | Band to points: `{ranks: [..], rest, no_show}` | Season points 3, 2, 1, 0 (D2); a session may override them | Rating deltas, if ratings are on | Deltas +3/+2/+1/−2; `twelve` +4/+3/+2/−2; `three` +2/+1/–/−1; `nine` written out with `eight`'s values |
| **Standings** | Sum across games or sessions, then a tie-break chain | Points, then more first places, then more sessions played, then a recorded tie-break order (D3) | Only for `open_heats` (best or sum) | — |
| **Rating** | `{min, max, start}` and a clamp | Not used for points; it may seed (D13) | Used by the team builder; updated by the deltas when a competition finishes | 0..100, start 50 |
| **Team builder** | Team size, number of tries, objective | Placing solo sign-ups on teams (U6) | Balanced random teams from ratings | Size 3, 20 tries, smallest spread, then smallest sum of squares |
| **Randomness** | An `rng` the caller passes in; `rng_from_seed(seed)` builds one | The seed is stored with each draw, so the draw can be replayed and audited | Same | Same; the compat layer keeps `Math.random` as its default |

## Formats as data
A **format** is `{id, name, entrants, teams_per_match, rounds, bands}`. A **round** is `{name, mode, pool | groups, arrange, size, advance, series?}`:
- `pool` lists the round's entrants as **selections**, concatenated in order, and is then arranged and cut into groups of `size`. `groups` is the explicit form: one list of selections per group. Brackets use it, so that a group can name "the winner of game 3 of round 1".
- **Selections:** `entrants` (all, or one by seed index) · `losers(k)`: the teams of round *k* that its results do not list, in game order · `places(k, a..b)`: places *a* to *b* of each game of round *k*, in game order (all recorded places by default) · `winner(k)`: the series winner of round *k* · `teams(k)` and `game_winners(k)` (bands only). Each takes an optional `group`.
- `mode` is an opaque label for the game mode (`cashout`, `quickcash`, `final`); the core never reads it.
- **Series:** while a group's series has no team at `first_to` wins and has not reached `max_games`, the next game repeats that group's teams. The champion is the final round's series winner, or its first place when the final has no series.
- **`round_robin`:** a group of *g* plays every pairing once, *g(g−1)/2* two-team games. The group's places are ordered by wins, then by the head-to-head game of two tied teams, then by seed.
- **Bands** are evaluated in order and do not stack: a team takes the first band it falls in.

THE FINALS' seven formats in that language. *E* = entrants, *L(k)* = losers of round *k*, *P(k)* = places of round *k*, *P(k, a..b)* = places *a* to *b*, *W(k)* = series winner. "keep" keeps the order, "shuffle" shuffles. Each final is `P(…)`, keep, size 2, advance 1, first to 2 at most 3.

| Format | Rounds: pool → arrange, size, advance | Tier band |
|---|---|---|
| `three` | E → shuffle 3, adv 1 · L(1) → keep 2, adv 1 (HEAD2HEAD) · final P(1)+P(2) | none |
| `four` | E → shuffle 4, adv 1 · L(1) → keep 3, adv 1, first to 2 with no limit (Quick Cash Series) · final P(1)+W(2) | `game_winners(2)` |
| `fourqc` | E → shuffle 4, adv 1 · L(1) → keep 3, adv 1 · final P(1)+P(2) | `teams(2)` |
| `six` | E → shuffle 3, adv 1 · L(1) → keep 4, adv 2 · P(1)+P(2) → keep 4, adv 2 · final P(3) | `teams(3)` |
| `eight` | E → shuffle 4, adv 1 · L(1) → shuffle_no_repeat 3, adv 1 · P(1)+P(2) → keep 4, adv 2 · final P(3) | `teams(3)` |
| `nine` | E → shuffle 3, adv 2 · L(1) → keep 3, adv 2 · P(1)+P(2) → shuffle 4, adv 2 · P(3) → keep 4, adv 2 · final P(4) | `teams(4)` |
| `twelve` | E → shuffle 4, adv 2 · L(1) → shuffle 3, adv 1 · P(1)+P(2) → shuffle 4, adv 3 · P(3, 2..3) → shuffle 4, adv 2 · P(3, 1..1)+P(4) → keep 4, adv 2 · final P(5) | `teams(5)` |

`shuffle_no_repeat` reshuffles until no group equals a group of round *k*'s losers (`eight` round 2). It is now **bounded** (inventory problem 5): after 1,000 tries it swaps one team between the first two groups. The bound changes nothing for any random source v1 finishes with: the chance of one try failing is 1 in 10, so reaching the bound with a real random source would take 10^-1000 luck. A broken random source (a constant one) no longer hangs.

## The API
The general major version is **2.0.0**. Everything stays pure: no storage, no I/O, no clock, no `Math.random` in the general API, and zero runtime dependencies. It stays ESM with TypeScript declarations and Node ≥ 22.12, so CommonJS callers like the app can still `require()` it. Ids are `number | string`.

| Export | Does |
|---|---|
| `check_format(format)` | Validates a format: selections point back to earlier rounds, sizes are within `teams_per_match`, a series sits only on rounds whose groups are fixed in advance (one group, or the explicit `groups` form), and the capacities add up. Throws `TourneyError` |
| `build_format(template, entrants)` | Turns a template (`{kind: 'single_elimination', best_of, final_best_of, third_place}`, `{kind: 'groups_knockout', group_size, advance_per_group, …}`, `{kind: 'heats', heat_size, advance, final_size}`, `{kind: 'preset', preset: 'finals', format: 'eight'}`) into a format for that many entrants; byes for brackets that are not a power of two |
| `check_rules({team_size, teams_per_match, default_format})` | Says whether a game's competition rules are coherent and whether its default template can run for at least one entrant count (Games uses it) |
| `draw(format, entrant_ids, rng)` | Round 1's groups |
| `validate_result(format, game, order)` | Returns `order` or throws `TourneyError` with a `code` (`unknown_round`, `wrong_count`, `duplicate`, `not_in_game`) and v1's English message, fit for an admin |
| `next(format, games, rng)` | `{round, games: [{group, teams}]}` or `null`: the next round once every game of the current one is decided, or the next game of each open series |
| `champion(format, games)` | The champion's id or `null` (an id of 0 is a champion here; v1 returned `null` for it) |
| `bands(format, games, entrant_ids)` | The band per entrant (1 = champion, 2 = finalist, 3… = the format's tiers, `null` = rest) |
| `points(table, band, {no_show})` | Points or delta for one band |
| `standings(rows, chain, {tie_break_order, aggregate})` | Sorted rows with `rank` and `tied`; `chain` from `points`, `firsts`, `played`, `tie_break`; `aggregate` `sum` or `best` |
| `open_heat(pool, size, rng)` | The next open heat: the entrants with the fewest heats played, ties shuffled |
| `rate(current, delta, rating)` | Clamped to `{min, max}` |
| `build_teams(players, {size, rng, tries = 20})` | Teams of `size` with the most even sums; extra fields kept; `RangeError` unless the count is a multiple of `size` |
| `rng_from_seed(seed)` | A 32-bit seeded generator (mulberry32) |
| `presets.finals` | THE FINALS: `team_size`, `teams_per_match`, `rating`, `formats` (the seven), `tables` (the deltas), `format_for_teams(n, current)` |

A **Game** is `{round, group, teams, result}`. `group` is new: it says which games of a round belong to one series, so a bracket round can run several best-of-three pairings at once.

**The name: `tourney-core`.** The engine now serves every competition, and "finals" reads as one game. Both names are free on the npm registry today. The repo is renamed in the same release (`glyzer/finals-core` → `glyzer/tourney-core`). GitHub redirects the old slug, so the app's `v1.x` pin keeps resolving until the app chooses to move. The docs already say "tourney core".

**What stays compatible.** `tourney-core/ladder`, `/rankings` and `/teambuilder` keep v1.0.1's exact exports, signatures, defaults and messages, built over the preset: `Format` strings, `Math.random` defaults and v1's fallback for an unknown format string (to `eight` in `roundsFor`, `finalRound`, `validateResult` and `nextRound`, and v1's empty tier in `rankingDeltas`). Installed under the name `finals-core`, the app runs unchanged. Its compat `Match` has no `group`: series rounds map to group 0, any other game to its index in the round.

**What breaks** (hence 2.0.0):
- The package name.
- The root entry now exports the general API instead of v1's names.
- `TEAMS_PER_SEASON` goes; nothing uses it.
- In the general API, an unknown format throws instead of falling back.
- `build_teams` throws on a count that is not a multiple of the team size; v1 then threw a `TypeError` or returned a short team.
- Unchanged at any valid input: the bounded reshuffle, and a champion id of 0.

## THE FINALS preset
- **Its seven formats:** the table in [Formats as data](#formats-as-data), with v1's round names and modes kept as data.
- **Its ranking rules:** the bands above and these tables: `eight`, `four`, `fourqc`, `six` and `nine` `{ranks: [3, 2, 1], rest: −2}`; `twelve` `{ranks: [4, 3, 2], rest: −2}`; `three` `{ranks: [2, 1, 0], rest: −1}`. `nine` is written out with `eight`'s values: the same numbers v1 reached by fallback (inventory problem 12).
- Rating 0..100 starting at 50, team size 3, 20 tries.
- `format_for_teams(n, current)` (below).
- **Who runs it:** a platform mini tournament for a game whose rules fit (team size 3, two to four teams per match) can pick these formats. The Finals app runs them through the compat subpaths.

### The `four`/`fourqc` bug (E13)
The app picks a season's format as "the first key of `CAPACITY` with this many teams" in `startIndividuals`, `startEarlyTeams`, `generateDraft` and `getDraft`, and `four` comes before `fourqc`. So a full individual-only `fourqc` season is drawn as `four` ([inventory, problem 1](../legacy-inventory/thefinals_mini_tourney.md#known-problems); [step 7, E13](../briefs/step-7-tournament/questions.md#e13-the-format-mix-up-bug-and-other-legacy-bugs)). **The fix goes into the core first:**
- **v1.1.0** adds `formatForTeams(n, current)` to `finals-core/ladder`: it returns `current` when its capacity is `n`, otherwise the first format with that capacity in the documented order `twelve, nine, eight, six, four, three` (so `fourqc` is only ever kept, never guessed), otherwise `null`. The release is additive, so the app can take it without moving to 2.0.0.
- **Its test:** `formatForTeams(4, 'fourqc')` is `'fourqc'`, `formatForTeams(4, 'eight')` and `formatForTeams(4)` are `'four'`, `formatForTeams(5)` is `null`, and every capacity maps back to itself.
- **The app's own fix** (a PR to the author) calls it on the four lines, with the regression test the inventory found missing: "an individual-only `fourqc` season that fills stays `fourqc` and plays one Quick Cash". The team builder (`generateDraft`) has no current format, so 12 players still give `four`; a way to choose `fourqc` there is the author's feature, not part of this fix.
- 2.0.0 carries the same function in `presets.finals` and in the compat `ladder`.

## Equivalence tests
They prove that THE FINALS behaves the same through the preset. All run in the core's CI on every PR (a new `test` workflow), except Q4, which needs the app's private repo.

| # | What | How | Pass when |
|---|---|---|---|
| Q1 | v1's own tests, unchanged | The 20 tests of `test/ladder.test.js`, `rankings.test.js` and `teambuilder.test.js` stay as they are and import the compat subpaths | 20 of 20 pass with no line changed but the import paths |
| Q2 | The same tests on the general API | A copy that runs the same flows through `draw`, `next`, `validate_result`, `champion`, `bands` and `points` with `presets.finals`, and `build_teams` at size 3 | Same assertions pass |
| Q3 | Differential against v1.0.1 | `test/equivalence.test.js`. v1 is a dev dependency pinned to its tag (`"finals-core-v1": "github:glyzer/finals-core#v1.0.1"`; the lockfile pins the commit). For each of the 7 formats and seeds 1–1000, v1 and v2 each get `rng_from_seed(seed)`; a third generator from the same seed picks valid random results (applied to both). At every step it compares `drawRound1` and `draw`, `validateResult` (and the error message for a wrong count, a duplicate, a foreign team and an unknown round), `nextRound` and `next`, and `champion`; at the end `rankingDeltas`, and the bands × tables. It also compares `CAPACITY`, `roundsFor`, `finalRound` for the 7 formats and one unknown string, every compat function with that unknown string, `clamp` from −50 to 150, and `buildTeams` for 3, 6, 9, 12, 18, 24, 27 and 36 players × 200 seeds with ratings 0–100 (ties included) | Deep-equal everywhere. Any extra or missing call on the random source shows up as a difference, which is what makes the draws "identical", not merely valid. About 7,000 seasons; a few seconds |
| Q4 | The app's suite | Before tagging 2.0.0: clone the app at its `main`, `npm ci`, install the candidate tarball under the old name (`npm install --no-save "finals-core@file:../tourney-core-2.0.0.tgz"`), `npm test`. The release PR records the run in its `Verification run:` line. After the tag, the app's own bump PR runs the suite again in the app's CI | 99 of 99 (or the app's count at that time) pass with no app code changed. The procedure was tried with v1.0.1 repacked as `tourney-core` 2.0.0: the app resolved `finals-core/ladder` to it and passed 99 of 99 |
| Q5 | E13 and the bound | The `formatForTeams` tests above; `shuffle_no_repeat` with `() => 0` ends and returns valid groups | Pass |

Q3 is the test the prototype above already passed in a throwaway form (3,000 seeds per format).

## Who uses it
| User | Reads from the core | Keeps itself |
|---|---|---|
| **Tournament: the official tournament** (step 7) | `build_format({kind: 'heats', …})` for sessions with rounds; `draw`, `next`, `validate_result` for "winners advance" (P4 B); `points` with the season table (D2); `standings` with the D3 chain, whose ranks are also the final's cut (U11); `build_teams` for solo sign-ups in a team session (U6); `rng_from_seed` with the seed stored per draw | Sessions, registration, check-in, the crew's results, corrections and their audit, the final, events (`tournament.round.started` from `next`'s round). A session with no rounds never calls the engine: its one match's placements go straight to `points` |
| **Tournament: mini tournaments** (step 7) | The game's rules from Games; `build_format` from the default template (an organiser may change it) at the entrant count when sign-up closes; `build_teams` from stored ratings; `draw`, `next`, `validate_result`, `champion`, `bands`, `points` and `rate` at the end | Ratings per player (their scope is step 7's question), the stored format (a frozen copy, so a later core version never changes a running competition), games, results, events |
| **Games** (Games track) | `check_rules` when a moderator sets a game's rules, so the catalogue never offers a format that cannot run | The rules as catalogue data: `team_size`, `teams_per_match` `{min, max}`, `default_format` (a template). An additive change to [games.md](../../contracts/games.md) that ships with the Games code that uses it ([0029](../decisions/0029-additive-contracts-ship-with-consumers.md)); this plan changes no contract |
| **The Finals app** | The compat subpaths, through 1.x, until it moves to 2.0.0 | Everything else, as today. 0030 point 6: no Tournament points |

Screen, Moments and the bot never import the core; they read Tournament's events.

## Process
- **Licence and attribution.** ISC stays. The 2.0.0 `LICENSE`, README and `package.json` (`contributors`) name the origin: the bracket engine, rankings and team builder of THE FINALS mini tourney by its author, c22dragoon. This fixes inventory problem 19, with the wording the author agrees to. The platform modules that depend on the core name the library, the author's project and the licence in their READMEs ([0025](../decisions/0025-finals-and-games-modules.md)).
- **Changes go to the author before they ship.** Each core release (1.1.0, 2.0.0 and later) is shown to the mini tourney's author before it is tagged, and the tag waits for their OK, recorded in the release PR. The app's fix for E13 is a PR to the author's repo, merged by them. The app moves to 2.0.0 only when the author chooses ([0030](../decisions/0030-finals-integrated-one-tourney-core.md) point 3).
- **The release** is the core's existing manual `release` workflow: bump `version` in a PR, run the workflow from `main`, and it tests, packs and tags `vX.Y.Z`. It does not run the app's suite (the app's repo is private, which is why that job was dropped in the core's PR #6), so Q4 runs by hand before the tag, as above.
- **The tag pin on the platform.** `modules/tournament` (and `modules/games` for `check_rules`) depend on `"tourney-core": "github:glyzer/tourney-core#v2.0.0"`, an exact tag with the commit in the lockfile. A bump is a normal platform PR whose module checks run against it; the step 10 audit covers it ([0015](../decisions/0015-dependency-auditing.md)). Publishing to the npm registry, which 0025 prefers, is one later bump PR once the core's release workflow publishes.
- **The app's bump workflow.** The app's CI accepts only `github:glyzer/finals-core#vX.Y.Z`, and its daily bump job reads `glyzer/finals-core`'s tags. Both keep working for 1.x through GitHub's redirect. Moving to 2.0.0 means changing the dependency to `tourney-core` (three `require` lines), or keeping the old name as an alias, plus the pin check and the bump job: one PR in the author's repo, when they choose.

## Order and size
Tickets for the core repo, in order. The lead opens them there. Each one goes through the core's own PR flow and `npm test`.

| # | Ticket | Size (with tests) | Needs |
|---|---|---|---|
| C1 | `formatForTeams` and its tests (E13); a `test` workflow on PRs; release 1.1.0 | ~80 lines | Nothing. Start now; it unblocks the app's fix |
| C2 | The general engine: types, `check_format`, `draw`, `next` (selections, arrangements with the bounded no-repeat, series, groups), `validate_result` with `TourneyError`, `champion`, `bands`, `points`, `standings`, `rate`, `build_teams` at any size, `rng_from_seed`; unit tests per function | ~900 | C1 |
| C3 | The THE FINALS preset, the compat subpaths over it, and Q1–Q3, Q5 | ~600 | C2 |
| C4 | Templates: `single_elimination` (seeding, byes, best of *n*, third place), `groups_knockout` (`round_robin` for 2-team groups), `heats`, `open_heats`; `check_rules`; unit tests, including a 5v5 and a 1v1 bracket for 3–16 entrants | ~700 | C2. Defaults from step 7's accepted plan (D2, D3, D13, P4, U6) |
| C5 | Rename to `tourney-core`; licence, README and attribution; Q4; the author's OK; release 2.0.0 | ~100 | C3, C4 |

About 2,400 lines in all, with tests.
- **When it must be ready:** 2.0.0 is tagged before step 7's first build package starts. Step 7's build issues wait for its plan anyway, so C1–C3 can run now and C4 follows the plan.
- **On the platform side:** taking the core is part of step 7's packages (Tournament) and the Games track's competition-rules issue. Neither is a core ticket.

## Decisions made
- **Formats as data with one engine,** rather than one `nextRound` function per format. All seven THE FINALS formats fit a small selection language (checked by the prototype). Brackets, heats and groups become templates that generate the same data, so there is one engine to test.
- **Placement bands plus scoring tables** serve both THE FINALS' rating deltas and Tournament's season points: one mechanism for "placements to points".
- **Keep v1's subpaths as a compat layer** in 2.0.0, so the app's whole suite proves equivalence with no app change, and the app can move without touching its service code.
- **The fix for E13 ships in 1.1.0 first,** additive, so the app is not forced onto 2.0.0 to get it.
- **A seeded random source the caller passes in,** with no default in the general API, so a stored seed replays a draw.
- **The name `tourney-core`.**
- **THE FINALS' teams per match is 2–4,** because two of its round types are 2-team games.
