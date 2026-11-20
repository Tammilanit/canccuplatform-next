# Finals track question bank

Every open question the research for [the Finals track brief](../track-finals.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#172, epic #161). IDs are stable, so the session can answer "U3: B" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), U1 (what Finals is at an event), D4 (where rankings live), D6 (a Discord sign-up by someone who never signed in), D7 (how the bot reaches this event's Finals), U7 (who enters results), E4 (corrections), P2 (the issue set), P5 (the order against the bot and the hub).

**Already decided, so not asked again:** `finals` is its own module, apart from `games` and the tournament, on a shared tourney core taken as a pinned dependency, with the core's ISC licence and attribution kept ([0025](../../decisions/0025-finals-and-games-modules.md)); the standalone off-LAN app stays independent with no data sync, and the bot's `/finals` talks to either through one provider contract ([contracts/finals.md](../../../contracts/finals.md)); on the platform, admin rights come only from sign-in, never from Discord role ids, and the page link is a plain hub URL with no token (the stub, [0010](../../decisions/0010-scope.md)); a person becomes a member of an event only at the venue, through the event's link or QR, or when an admin adds them, and every account is a Discord account ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md)); personal data is anonymised 12 months after archiving (0027); nothing is migrated from the legacy except the bot's own data at cutover ([0004](../../decisions/0004-nothing-migrated.md)); the Finals track registers `/finals` under its own flag on the bot's command framework (step 6 pack, P8); the finals cards are built by this track, against the step 9 pack's drawings (step 9 pack, D12).

A question marked **contract** needs a contract change if the recommendation is taken. The full `finals` contract is new, so most of it is additive by nature; the one change to a published name is flagged where it comes up (D7, L7).

## U · Who uses it and how

### U1. What Finals is at an event
The legacy mini tourney runs one team game, teams of three, in seven fixed formats; the tournament (step 7) is the event's multi-game cup.
- **A.** The night's side event for one team game, as the legacy: teams of three, the core's formats.
- **B.** A generic bracket tool for any game and team size.
- **C.** A, with the game (its name, arenas and round names) as data, so a second game of the same shape needs no code.
- **Recommendation: C.** The core is built for teams of three and its seven formats; B would rebuild what 0025 keeps out (the tournament owns the multi-game cup, the Games track owns casual rounds). C keeps the door open without an abstraction nobody uses yet (L5, D13).

### U2. How people join a season
- **A.** On the hub only.
- **B.** On the hub, with `/finals register` in Discord, the screen's QR and the crew adding a person; one entry per person across all four.
- **Recommendation: B** ([mockup 02](02-flow-join.svg), [mockup 03](03-discord.svg)). The exit criterion asks for the `/finals` sign-up; the QR is how the hall finds it; the crew add covers people at the stage.

### U3. Solo, teams or both
The legacy sets a mode per season: `individual` (drawn teams) or `teams`; the team builder makes a third path.
- **A.** Keep the two modes and the builder: "solo sign-ups, drawn teams", "teams register", "from the team builder".
- **B.** One mixed mode: teams register, solo players fill the gaps.
- **C.** A, and a teams season may also take solo sign-ups to fill short teams.
- **Recommendation: C.** The modes are proven; filling a short team from the solo list saves a team at the start ([mockup 04](04-teams.svg), step 5). **Contract:** the season's `mode` and an `allow_fill` flag.

### U4. How teams form in a teams season
The legacy's captain typed three nicknames and held the only edit token.
- **A.** The captain names the team and invites by a link, a QR or a short code; each teammate joins with their own sign-in.
- **B.** The captain types names, as the legacy.
- **Recommendation: A**, with the crew able to add a guest by nickname (U5). Each player then sees the match and can report from their own phone ([mockup 04](04-teams.svg)). The invite names a team, never a person (0010).

### U5. Players without an account
- **A.** Only signed-in members play.
- **B.** The crew may add a guest player by nickname to a team or the solo list; guests cannot report or vote.
- **Recommendation: B.** A friend without Discord still plays the final; the crew speaks for them. A guest is a row of this module with its own id, never merged by name (E8, D5).

### U6. Voting to start early
The legacy lets solo sign-ups vote; at 6 votes the season starts with the largest size the sign-ups fill.
- **A.** Keep, with the threshold a setting (6 by default, 0 turns it off).
- **B.** Drop; the crew starts early.
- **Recommendation: A** ([mockup 02](02-flow-join.svg), [mockup 16](16-settings-and-rights.svg)). It is the legacy's best social mechanic: the room decides it has waited long enough.

### U7. Who enters results
The legacy: the teams in a match report the order; two matching reports from different teams decide; differing reports wait for the admin; the admin can always decide. Builder teams had no tokens, so only the admin reported for them.
- **A.** As the legacy, with every player able to report for their team.
- **B.** The crew enters every result.
- **C.** A by default; a season setting switches to B.
- **Recommendation: C** ([mockup 05](05-my-match.svg), [mockup 08](08-new-season.svg)). Self-reporting is what lets a few crew run nine teams; a builder or show season may want the crew alone.

### U8. The lobby code
- **A.** Any player in the match sets it; it shows on the match's phones and the crew's desk, never on a venue screen; a series keeps it.
- **B.** The crew sets every code.
- **Recommendation: A** ([mockup 05](05-my-match.svg)). On a screen anyone in the hall could join a private lobby. The crew may set it too ([mockup 11](11-crew-phone.svg)).

### U9. Notifications
- **A.** A `finals` topic in Notify: event-wide "Finals are open" and "Champions"; personal "your team", "your match is on", "lobby code set", "your report differs", "you're swapped in".
- **B.** Only Discord posts, as the legacy.
- **Recommendation: A**, plus the Discord posts the legacy watcher made (new season, started, champion) ([mockup 03](03-discord.svg)). People choose their channels in the hub. **Contract:** the topic in notify.md's registry.

### U10. Spectators
- **A.** The bracket, teams, champions and rules are info pages: whoever the event's info-page mode lets in may read them, signed in or not.
- **B.** Members only.
- **Recommendation: A** ([mockup 06](06-bracket.svg)). The bracket is the show; the hall's friends follow from home.

### U11. The crew
- **A.** A "Finals crew" role preset with the module's rights; the desk and the crew phone show what the rights allow.
- **B.** Event admins only.
- **Recommendation: A** ([mockup 16](16-settings-and-rights.svg)). The legacy had one shared password; the people who run the finals are often not the event's admins.

### U12. Public start
The legacy let anyone start a season in two month windows, and on by default.
- **A.** Drop it: seasons are opened by the crew.
- **B.** A setting, off by default: when no season is open, a member may start a pick-up season named by the event.
- **Recommendation: B.** It keeps the spirit (players start their own fun late at night) without the hard-coded windows or the open door ([mockup 16](16-settings-and-rights.svg)).

### U13. The team builder
- **A.** The crew picks players from tonight's sign-ups or the roster; the builder balances teams by ranking; the crew swaps, names and starts ([mockup 09](09-team-builder.svg)).
- **B.** Builder only behind the scenes, when a solo season starts.
- **Recommendation: A, and B too:** a solo season's draw uses the same balancing, so the reveal gives even teams ([mockup 02](02-flow-join.svg)).

### U14. Substitutes and the left-out list
The legacy listed players left out when a season started early, and had a live swap until the first result.
- **A.** Keep both; the left-out list becomes a substitutes' list the crew draws from, and a swap may bring a substitute in.
- **B.** Live swap only between teams.
- **Recommendation: A** ([mockup 11](11-crew-phone.svg), [mockup 15](15-edge-states.svg)).

### U15. How many seasons at once
- **A.** One open season per event at a time, any number one after another.
- **B.** Several at once.
- **Recommendation: A.** The legacy's rule, and an event has one stage for its finals. Two at once would only matter for two games (U1 C), which no event has asked for. **Contract:** `season_open` (409) on a second.

### U16. A player's own view after the event
- **A.** "My finals": the ranking with its move and why, the seasons played, titles ([mockup 13](13-champions-and-rankings.svg)), and the module's part of the person's export.
- **B.** Nothing personal; only public champions.
- **Recommendation: A.** The legacy's ranking changes were the reason people came back.

## L · Look and feel

### L1. Where the player's pages live
- **A.** In the hub's frame, owned by this module, as the App track pack proposes for the tournament (App track P4).
- **B.** A standalone Finals site, as the legacy.
- **Recommendation: A** ([mockup 02](02-flow-join.svg)). One frame, one sign-in, one place for notifications.

### L2. One bracket renderer
The legacy has seven hand-drawn renderers, one per format, 1,028 lines, untested, the source of most of its fixes.
- **A.** One renderer drawing any format from the core's round table (columns of groups, places, connectors), with a test per format.
- **B.** Port the seven renderers.
- **Recommendation: A** ([mockup 06](06-bracket.svg)). Rounds as data make the eighth format free and the screen's widget the same code.

### L3. The bracket on a phone
- **A.** "My path" first, then each round's groups as swipeable cards.
- **B.** The full bracket, scrolled sideways.
- **Recommendation: A** ([mockup 06](06-bracket.svg)). A phone cannot show six columns; the player's own route is what they look for.

### L4. Tracing a team's route
- **A.** Keep the legacy's hover tracing as a tap that works on phones and the desk.
- **B.** Drop it.
- **Recommendation: A.** It was the bracket's best touch.

### L5. Round names
The legacy uses the game's own mode names for its rounds.
- **A.** Plain words by default ("Group of 3", "Second chance", "Semi-final", "Final · best of 3"); a game may bring its own names as data.
- **B.** The game's names everywhere.
- **Recommendation: A.** Plain words read for newcomers and other games; the names live with the game (D13).

### L6. What the venue screen shows
- **A.** Four moments: "Finals are open" (count and QR, at the open and before the close), "Teams drawn", the bracket as the Pulse hero while the season runs, "Champion" ([mockup 12](12-venue-screen.svg)).
- **B.** The legacy's two cards only (open, started).
- **C.** A, plus a takeover for every decided group.
- **Recommendation: A.** C would crowd the screen every few minutes; the hero bracket shows each result as it lands. **Contract:** Moments rules and presets, a `bracket` view-model for a tree (D9).

### L7. Moments' `finals` class
moments.md already has a `finals` class (rank 55), used today by the built-in `finals_result` rule for the tournament's final (`session.is_final`).
- **A.** Keep one class for "a final is being decided", shared by the tournament's final and this module's moments.
- **B.** Rename the existing use, or add a second class for this module.
- **Recommendation: A.** One class keeps the priority order simple and nothing is renamed (B would be a breaking change to a published enum, high risk, its own PR). The new rules are `finals_open`, `finals_drawn` and `finals_champion`, each with a preset. **Contract:** additive rules and presets.

### L8. Ranking changes on show
The legacy shows each nickname's change (+3, −2) in a finished season, on by default, with a setting to hide.
- **A.** Each player always sees their own; everyone sees all when the setting is on (default on).
- **B.** Only one's own.
- **Recommendation: A** ([mockup 13](13-champions-and-rankings.svg), [mockup 16](16-settings-and-rights.svg)).

### L9. The champion moment
- **A.** A takeover with the team and its three players, then the hall of champions in rotation ([mockup 12](12-venue-screen.svg)).
- **B.** A, plus a photo the crew takes at the stage, with the players' consent.
- **Recommendation: A now, B later.** Photos are personal data with consent and storage rules; the tournament's photo slots (step 7) can be reused once they exist.

### L10. The organiser pages
- **A.** A Finals item in the shell's "Run the event": the seasons page (a card grid), the season desk, the team builder, results and history, settings; every page also at phone width ([mockups 07–11](07-season-desk.svg), [17](17-grids.svg)).
- **B.** The legacy's three admin pages as they were.
- **Recommendation: A.** Amendment 3's grids for seasons; tables for registrations, roster and history.

### L11. The reveal
- **A.** When a solo season starts, each phone shows its own team as a full hero, and the screen shows every team ([mockup 02](02-flow-join.svg), [mockup 12](12-venue-screen.svg)).
- **B.** A list on the page.
- **Recommendation: A.** "Name revealed at start" was the legacy's tease; the reveal pays it off.

### L12. The finals cards' look
- **A.** The step 9 pack's drawings (season open with capacity and QR, starts now, champions), in the theme's look, as Moments takeovers.
- **Recommendation: A** ([mockup 12](12-venue-screen.svg)).

## D · Data and integrations

### D1. The shared tourney core
0025: the bracket engine, rankings and the team builder come from one small public library, ISC, used by the off-LAN app and this module, pinned to a release.
- **A.** The author publishes it (npm preferred, else a tagged git repo); this track pins the first release and fixes go upstream first.
- **B.** The platform forks it until the author publishes.
- **Recommendation: A.** A fork is the vendored copy 0025 rules out. The release must carry the fixes of [E9](#e9-the-format-mix-up-and-the-reshuffle), a seeded random source, and the round tables as data.

### D2. If the core is not released when the track starts
- **A.** The track's first package pins a git tag of the author's repository (0025's fallback); moving to npm is one bump PR.
- **B.** Wait for npm.
- **Recommendation: A.** 0025 names it; the lockfile records the tag. Agreeing the core's API with its author is the track's first step (P4).

### D3. Storage
- **A.** Per tenant under RLS, the kit's way: seasons, teams, entries, matches, match teams, reports, the roster, drafts and corrections, each operation one transaction with row locks; versioned additive migrations.
- **Recommendation: A.** The legacy's in-process queue, unenforced foreign keys and in-code schema upgrades are its known problems 2, 4 and 11. **Contract:** the module's tables in its migrations; no global table (D4).

### D4. Where rankings live
The legacy keeps one global roster keyed by nickname, adjusted by every finished season. Users are global; events are tenants; a series groups an organiser's events.
- **A.** Per event: the roster and rankings belong to the event, and the series clone carries them, with the champions list, into the next event.
- **B.** Per series: a global table keyed by series and user.
- **C.** Global per user.
- **Recommendation: A.** It keeps every row in a tenant under RLS (no new global table for `check-tenancy`), fits "clone the last event" (tenants.md), and lets the 12-month anonymisation of an old event run without touching the next event's copy. B is the natural model but a new global table and a cross-tenant write; C mixes organisers. **Contract:** a clone endpoint in finals.md.

### D5. Identity of a player
- **A.** Entries, team members, roster rows and titles point to a user id; a guest (U5) is a row of this module with its own id.
- **B.** Nicknames, as the legacy.
- **Recommendation: A.** The legacy's problem 6: a rename started a new player, two people with one nickname shared a ranking. The display name in a season is the user's, editable per season, unique in the season (E8).

### D6. A Discord sign-up by someone who never signed in
The stub: one entry per (season, `discord_user_id`); the link between a user and a Discord id is kept only in tenants; "how a Discord user who never signed in is held is the Finals track's". Today a user row exists only after a sign-in.
- **A.** The entry holds the Discord id and name until that person signs in; at sign-in (or at the next read) tenants resolves the id to the user and the entry becomes theirs.
- **B.** The tenants module creates a user for a Discord identity on request (a user who has never signed in), and the entry is that user's.
- **C.** `/finals register` needs a signed-in member: the bot answers with the hub link.
- **Recommendation: A**, held as personal data under the same retention, with tenants' internal lookup by Discord id (an additive internal path). C fails the exit criterion's spirit; B creates accounts nobody asked for. The membership rule still holds: the entry plays, but the person sees attendee data only after joining (E13). **Contract:** an internal lookup in tenants.md, and the entry's `discord_user_id` in finals.md.

### D7. How the bot reaches this event's Finals
The stub puts the platform's base at `https://<event host>/api/finals` and answers the entries and links paths "only for the platform's bot module". The kit's service identity proves "a module of this stack", not which one, and guards internal paths.
- **A.** On the platform the bot calls `/internal/finals/provider/…` with `tenant_id` and the service header; the shapes stay the provider contract's; `GET status` stays public too.
- **B.** The public paths, with the service header.
- **Recommendation: A.** Internal paths are what the kit guards; a public path that acts for a Discord user would be one leaked header away from abuse. This changes the platform row of the stub's base-URL table, which the stub marks provisional; the off-LAN app's row is untouched ([mockup 14](14-lifecycle.svg)). **Contract:** the platform base in finals.md.

### D8. The full finals contract
- **A.** `contracts/finals.md` and `finals.openapi.yaml` (shared components): the hub and admin API, the provider part, the events, the rights, the settings, the clone and privacy endpoints.
- **Recommendation: A**, split by part and shipped with the package that first uses each part ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)).

### D9. Events
- **A.** `finals.season.opened`, `.started`, `.finished`, `.cancelled`; `finals.entry.added`, `.withdrawn`; `finals.match.ready`, `.decided`, `.disputed`, `.corrected`; `finals.rankings.changed` ([mockup 14](14-lifecycle.svg)). Payloads carry ids, names and counts; never a lobby code or a Discord id.
- **Recommendation: A.** They replace the legacy's payload-less SSE `update`; Screen, Moments, Notify and the bot react without polling.

### D10. The screen's bracket widget
step 9's pack draws `bracket` as a session's heats and says "the tree waits for the Finals track".
- **A.** Extend `bracket` additively with a tree view-model (rounds, groups, places, connectors, the live round), fed by this module.
- **B.** A new `finals_bracket` widget.
- **Recommendation: A.** One widget, one look; the tournament's heats and this tree are the same picture at different depths. **Contract:** additive fields in screen.md.

### D11. The run of show
- **A.** A season can be placed in the run of show (its open, its close, its final), mirrored the way the tournament's sessions are.
- **B.** No link; the crew adds an agenda item by hand.
- **Recommendation: B now.** The mirror is the tournament's pattern and costs a contract part; finals nights are short and often unplanned (U12). A `Roadmap note:` if the session wants A.

### D12. Legacy data
- **A.** Nothing (0004); rankings start at 50 at the first event.
- **B.** A one-time roster import (nicknames and rankings) the crew matches to users.
- **Recommendation: A.** 0004 allows only the bot's data; the step 6 pack's import of the bot's finals state file covers the cards' last state, which nothing on the platform needs. B would need a new record.

### D13. The game and its arenas
- **A.** Until the Games track's catalogue holds them, the game's name, arenas and round names are a module setting; then they come from the catalogue.
- **B.** Wait for the catalogue.
- **Recommendation: A** ([mockup 08](08-new-season.svg)). The legacy's arena list is a constant; a setting is the smallest step, and the catalogue replaces it later (Roadmap note).

### D14. Two providers, one contract
- **A.** The provider contract's examples are fixtures; the bot's tests run them against the platform's module, and the off-LAN app runs the same fixtures.
- **B.** Test the platform only.
- **Recommendation: A** (0025's known limit). The fixtures live in `contracts/`; the off-LAN app's author is told of any change before it ships.

### D15. The Apps track
0027: Finals may become the Apps track's first app (one codebase, off-LAN or installed); until that track decides, 0025 stands.
- **A.** Build per 0025 now; keep the core pure and the provider contract clean, nothing more.
- **B.** Build the app interface now (direction B).
- **Recommendation: A.** Lean scope: no abstraction for a track that has not had its session.

### D16. Privacy
- **A.** The module's export and delete (`me/export`, `DELETE me`), entries and results as personal data, anonymised 12 months after archiving; titles and rankings carried by the clone are personal data of the new event.
- **Recommendation: A.** As every module ([contracts/README.md](../../../contracts/README.md#privacy-export-and-delete)). A deleted user's titles read "a former player".

## E · Edge cases and failure

### E1. Races
- **A.** The last place, a double sign-up (hub and Discord at once), two reports at once, a swap during a report: each one transaction with row locks, idempotent by key, with race tests.
- **Recommendation: A.** The legacy had no concurrency test.

### E2. A dispute nobody settles
- **A.** The next round waits; the desk's queue shows it; after a delay (5 minutes by default) the crew on duty is pinged ([mockup 07](07-season-desk.svg)).
- **B.** Auto-decide by the first report.
- **Recommendation: A.** A wrong result is worse than a wait.

### E3. A player leaves
- **A.** Before the team's first result the crew swaps in a substitute or another player; after it the team plays short or withdraws, the crew decides.
- **Recommendation: A** ([mockup 11](11-crew-phone.svg)). The legacy locked swaps at the first result for fairness.

### E4. Correcting a result
The legacy could not; its README asked for it.
- **A.** A correction with a reason, allowed while no later match built from it has a result; the page shows what it changes (who goes through, which drawn round is redrawn, who is told) before it is made ([mockup 10](10-results-and-corrections.svg)).
- **B.** Corrections anywhere, replaying later rounds.
- **C.** No corrections; the crew cancels the season.
- **Recommendation: A**, and a later round with a result must be reopened first, itself a correction. B can silently undo a played final.

### E5. Rankings after a correction or a deletion
The legacy did not revert ranking changes when a season was deleted.
- **A.** Deltas are stored per season; a correction after the finish or a deletion reverts them and applies the new ones.
- **Recommendation: A.**

### E6. A season that does not fill
- **A.** Keep the legacy: start early with the largest size the sign-ups fill (left-out players become substitutes), change the size, or cancel.
- **Recommendation: A.**

### E7. The bot is down, or cannot reach Finals
- **A.** `/finals` says so and points to the hub; the hub, the QR and the crew work without the bot.
- **Recommendation: A** ([mockup 15](15-edge-states.svg)).

### E8. Names
- **A.** One display name per season, unique case-insensitively across hub and Discord sign-ups, the legacy's limits (team 24, player 18); `name_taken` offers a suggestion.
- **Recommendation: A** ([mockup 15](15-edge-states.svg)).

### E9. The format mix-up and the reshuffle
The legacy's bug 1: a full solo `fourqc` season is saved as `four` (the capacity lookup takes the first match); bug 5: the eight-team round 2 reshuffle has no bound. Step 7's pack moved the "format mix-up" regression test here.
- **A.** Fixed in the core, with regression tests in the core and in the module.
- **Recommendation: A.**

### E10. Debug fill
- **A.** Fake teams and votes only on the demo event and in tests, behind the superadmin; never a tenant setting.
- **Recommendation: A.** The demo data lives in `events/demo/` (O7).

### E11. A cancelled season
- **A.** Everyone signed up is told (push, Discord) with the crew's reason; rankings are untouched.
- **Recommendation: A** ([mockup 15](15-edge-states.svg)).

### E12. Late arrivals
- **A.** A started season takes no sign-ups; late players can follow and join the substitutes' list.
- **Recommendation: A** ([mockup 15](15-edge-states.svg)).

### E13. Not a member
- **A.** The hub says to join the event first (at the venue or with its link); `/finals register` holds the entry (D6) and the answer says the same.
- **Recommendation: A.** Finals never adds people to an event.

### E14. Clone and archive
- **A.** The clone copies the roster, rankings and champions, never seasons; an event archived with a season open finishes it as cancelled.
- **Recommendation: A.**

## O · Operations and scale

### O1. Scale
A season is 9 to 36 players; an event of 2,000 may run a few seasons. The load is the spectators' reads and the screen.
- **A.** Push through events to Screen and the hub's live channel; no polling; reads cached per revision.
- **Recommendation: A.** The legacy's every-write-wakes-everyone SSE and 5 s polling are its problem 10.

### O2. Live updates on phones
- **A.** The hub's live channel (App track), keyed to the season's revision.
- **Recommendation: A.** No module-owned stream.

### O3. Crew pings
- **A.** Pings for a long dispute or a missing lobby code go to the crew on duty, through Notify's crew delivery once step 8's alerts exist; until then on the desk only.
- **Recommendation: A** ([mockup 11](11-crew-phone.svg)).

### O4. Settings and their defaults
- **A.** Per event: show ranking changes (on), members may start a season (off), votes to start early (6), the open and started takeovers (15 and 10 minutes, the legacy's card windows), the dispute ping (5 minutes), results by teams or crew (teams), names on the screen (display names), the game and its arenas (D13).
- **Recommendation: A** ([mockup 16](16-settings-and-rights.svg)). **Contract:** settings in finals.md.

### O5. Rights
- **A.** `finals.seasons.run` (open, start, cancel, swap), `finals.results.decide` (settle, correct), `finals.roster.write` (roster, rankings, builder), `finals.settings.write`; the preset "Finals crew" holds the first three.
- **Recommendation: A** ([mockup 16](16-settings-and-rights.svg)). **Contract:** rights in finals.md and admin's preset list.

### O6. Audit
- **A.** Every crew act (open, start, cancel, swap, decide, correct, roster edit) is audited with its reason and shown in the season's History ([mockup 10](10-results-and-corrections.svg)).
- **Recommendation: A.** The legacy had no audit.

### O7. Demo data
- **A.** `events/demo/`: the game and arenas, a roster of 27 demo players with rankings, a finished season with a champion, an open one; loaded by the profile.
- **Recommendation: A.** The screenshots and the exit demo need it.

### O8. Upgrading the core
- **A.** A bump PR with the core's release notes and the module's tests; bumps land between events, never during one.
- **Recommendation: A** (0025).

### O9. The provider switch
- **A.** A Discord setting per event: "This event's Finals" (default) or "An outside Finals app", the second set up by the superadmin with the outside base URL and its secret ([mockup 03](03-discord.svg)).
- **Recommendation: A.** An organiser picks; the secret stays with the superadmin. **Contract:** the setting in bot.md.

## P · Plan and scope

### P1. The direction
- **A.** The mini tourney, moved in. **B.** One app, two homes. **C.** Finals night.
- **Recommendation: C** ([the brief](../track-finals.md#recommended-direction-finals-night)).

### P2. The issue set
- **Recommendation:** as the brief's [Proposed issue changes](../track-finals.md#proposed-issue-changes).

### P3. The exit criterion
- **Recommendation:** as the brief's [Proposed exit criteria](../track-finals.md#proposed-exit-criteria): the roadmap's, made concrete.

### P4. Aligning with the core's author
The stub copies the off-LAN app's provider shapes and is "aligned with the off-LAN app's provider contract when its draft exists".
- **A.** The track's first step agrees with the author: the core's API and first release (D1), and the provider shapes and fixtures (D14).
- **Recommendation: A.** Both sides change together or not at all.

### P5. Order against the bot and the hub
The bot module (step 6) and the hub's frame (App track) are not built yet; Moments, Screen and Notify are.
- **A.** Build the module, its organiser pages and its screen moments first; the hub pages when the hub's frame exists; `/finals` when the bot's command framework exists. The exit waits for both.
- **B.** Wait for both before starting.
- **Recommendation: A.** Most of the track needs neither; the provider endpoints are tested with fixtures until the bot calls them.

### P6. The plan issue
The pack's issue exists (#172); the plan issue ("docs(briefs): Finals track: plan") does not, so nothing is blocked by it yet.
- **Recommendation:** the lead opens it and blocks the track's build issues on it, as the briefs README says.

### P7. The module label
#172 carries `module:games`.
- **Recommendation:** a `module:finals` label for the track's issues.
