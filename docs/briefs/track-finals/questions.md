# Finals track question bank

Every open question the research for [the Finals track brief](../track-finals.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#172, epic #161). IDs are stable, so the session can answer "U2: A" and the mockups can point here.

**The product owner's direction of 2026-11-20 (decision 0030, written in parallel in #680) changed the bank.** Finals is integrated as it is, not rebuilt. Of the 80 questions, **47 are marked "Dropped (0030)"** (they asked how to redesign the app; each stays as the record of what was weighed), **31 are kept or reworded for the integration** (two of them, P1 and D15, are now decided) and **2 are new** (D17 and D18).

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): D18 (sign-in through the platform), D17 (how the platform gets the app's news), D9 (what the app must expose), D7 (how the bot reaches the app), U17 (the `/finals` command), P2 (the issue set), P5 (the order).

**Already decided, so not asked again:** Finals is integrated as the existing app, unchanged, as an external app at the Apps track's level 3, the pilot of #193; hosting is the host's choice (its own server, or a container beside the platform; we never host it for other events) and the platform connects per event, with the app's address and a write-only bearer secret set by an event admin, no app set meaning Finals is off (#683); Finals and Tournament stay apart (a champion shows on the screen and in Moments, no Tournament points); the general core for Tournament and Games is its own later issue and the app stays on its current core until it chooses to move (0030). There is no `finals` module on the kit, no storage and no pages of our own. The standalone app stays independent with no data sync, and the bot's `/finals` talks to it through the provider contract ([0025](../../decisions/0025-finals-and-games-modules.md), [contracts/finals.md](../../../contracts/finals.md)); the platform's page link carries no token ([0010](../../decisions/0010-scope.md)); every account is a Discord account ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md)); the Finals track registers `/finals` under its own flag on the bot's command framework (step 6 pack, P8); the finals cards are built by this track against the step 9 pack's drawings (step 9 pack, D12).

A question marked **contract** needs a contract change if the recommendation is taken; all of them are additive except the removal of the stub's provisional platform base (D7).

## U · Who uses it and how

### U1. What Finals is at an event
> **Dropped (0030):** Finals stays the mini tourney for one game, THE FINALS, as the app is; nothing here makes it generic. Kept below as the record of what was weighed.
The legacy mini tourney runs one team game, teams of three, in seven fixed formats; the tournament (step 7) is the event's multi-game cup.
- **A.** The night's side event for one team game, as the legacy: teams of three, the core's formats.
- **B.** A generic bracket tool for any game and team size.
- **C.** A, with the game (its name, arenas and round names) as data, so a second game of the same shape needs no code.
- **Recommendation: C.** The core is built for teams of three and its seven formats; B would rebuild what 0025 keeps out (the tournament owns the multi-game cup, the Games track owns casual rounds). C keeps the door open without an abstraction nobody uses yet (L5, D13).

### U2. How people join a season
Joining happens in the app. The platform adds doors to it, never a second sign-up.
- **A.** Four doors to the app's own page: a tile or link in the hub, `/finals` and its Register button in Discord, the QR on the screen's "Finals are open" card, and the crew's word. The app keeps one entry per person; the platform holds none.
- **B.** The hub's tile only.
- **Recommendation: A** ([mockup 03](03-discord.svg), [mockup 12](12-venue-screen.svg)). The exit criterion asks for the `/finals` sign-up; the QR is how the hall finds the app. Every link is the app's plain public page, with no token in it (0010).

### U3. Solo, teams or both
> **Dropped (0030):** The app keeps its modes and its team builder as they are. Kept below as the record of what was weighed.
The legacy sets a mode per season: `individual` (drawn teams) or `teams`; the team builder makes a third path. The off-LAN host now allows solo seasons only (`INDIVIDUAL_ONLY`), and the live `/finals` signs up solo players only.
- **A.** Keep the two modes and the builder: "solo sign-ups, drawn teams", "teams register", "from the team builder".
- **B.** One mixed mode: teams register, solo players fill the gaps.
- **C.** A, and a teams season may also take solo sign-ups to fill short teams.
- **Recommendation: C, with solo first in the form.** The modes are proven; solo is what players use today; filling a short team from the solo list saves a team at the start ([mockup 04](04-teams.svg), step 5). A per-season mode replaces the server-wide switch. **Contract:** the season's `mode` and an `allow_fill` flag.

### U4. How teams form in a teams season
> **Dropped (0030):** The app keeps its own way of forming teams. Kept below as the record of what was weighed.
The legacy's captain typed three nicknames and held the only edit token.
- **A.** The captain names the team and invites by a link, a QR or a short code; each teammate joins with their own sign-in.
- **B.** The captain types names, as the legacy.
- **Recommendation: A**, with the crew able to add a guest by nickname (U5). Each player then sees the match and can report from their own phone ([mockup 04](04-teams.svg)). The invite names a team, never a person (0010).

### U5. Players without an account
> **Dropped (0030):** The app keeps its own rules for who plays. Kept below as the record of what was weighed.
- **A.** Only signed-in members play.
- **B.** The crew may add a guest player by nickname to a team or the solo list; guests cannot report or vote.
- **Recommendation: B.** A friend without Discord still plays the final; the crew speaks for them. A guest is a row of this module with its own id, never merged by name (E8, D5).

### U6. Voting to start early
> **Dropped (0030):** The app keeps the vote to start early as it is. Kept below as the record of what was weighed.
The legacy lets solo sign-ups vote; at 6 votes the season starts with the largest size the sign-ups fill.
- **A.** Keep, with the threshold a setting (6 by default, 0 turns it off).
- **B.** Drop; the crew starts early.
- **Recommendation: A** ([mockup 02](02-flow-join.svg), [mockup 16](16-settings-and-rights.svg)). It is the legacy's best social mechanic: the room decides it has waited long enough.

### U7. Who enters results
> **Dropped (0030):** The app keeps its own reporting and its referee. Kept below as the record of what was weighed.
The legacy: the teams in a match report the order; two matching reports from different teams decide; differing reports wait for the admin; the admin can always decide. Builder teams had no tokens, so only the admin reported for them.
- **A.** As the legacy, with every player able to report for their team.
- **B.** The crew enters every result.
- **C.** A by default; a season setting switches to B.
- **Recommendation: C** ([mockup 05](05-my-match.svg), [mockup 08](08-new-season.svg)). Self-reporting is what lets a few crew run nine teams; a builder or show season may want the crew alone.

### U8. The lobby code
> **Dropped (0030):** The lobby code stays the app's. Kept below as the record of what was weighed.
- **A.** Any player in the match sets it; it shows on the match's phones and the crew's desk, never on a venue screen; a series keeps it.
- **B.** The crew sets every code.
- **Recommendation: A** ([mockup 05](05-my-match.svg)). On a screen anyone in the hall could join a private lobby. The crew may set it too ([mockup 11](11-crew-phone.svg)).

### U9. Notifications
- **A.** A `finals` topic in Notify for event-wide news only ("Finals are open", "Champions"), fed by what the app exposes (D9, D17), plus the Discord posts the legacy watcher makes (new season, started, champion): no link, ending with "use `/finals`" ([mockup 03](03-discord.svg)). Personal pushes stay the app's.
- **B.** Only the Discord posts, as the legacy.
- **Recommendation: A.** People choose their channels in the hub. **Contract:** the topic in notify.md's registry.

### U10. Spectators
The app closes every page and read to anyone without a session (its read gate), because it is public on the internet.
- **A.** The venue screen and the hub's tile show the bracket and the champion from the app's reads, to whoever is in the hall or on the hub; the app's own pages keep their gate. The platform sends the app no viewer.
- **B.** Only members see Finals on the platform.
- **Recommendation: A** ([mockup 12](12-venue-screen.svg)). The bracket is the show; the screen has no viewer to sign in. The reads the screen needs are public data (names, places, round), never a lobby code or a Discord id (D9).

### U11. The crew
> **Dropped (0030):** The app keeps its admins (by Discord role); no "Finals crew" role on the platform. Kept below as the record of what was weighed.
- **A.** A "Finals crew" role preset with the module's rights; the desk and the crew phone show what the rights allow.
- **B.** Event admins only.
- **Recommendation: A** ([mockup 16](16-settings-and-rights.svg)). The legacy had one shared password; the people who run the finals are often not the event's admins.

### U12. Public start
> **Dropped (0030):** The app keeps its public start as it is. Kept below as the record of what was weighed.
The legacy let anyone start a season in two month windows, and on by default.
- **A.** Drop it: seasons are opened by the crew.
- **B.** A setting, off by default: when no season is open, a member may start a pick-up season named by the event.
- **Recommendation: B.** It keeps the spirit (players start their own fun late at night) without the hard-coded windows or the open door ([mockup 16](16-settings-and-rights.svg)).

### U13. The team builder
> **Dropped (0030):** The app keeps its team builder. Kept below as the record of what was weighed.
- **A.** The crew picks players from tonight's sign-ups or the roster; the builder balances teams by ranking; the crew swaps, names and starts ([mockup 09](09-team-builder.svg)).
- **B.** Builder only behind the scenes, when a solo season starts.
- **Recommendation: A, and B too:** a solo season's draw uses the same balancing, so the reveal gives even teams ([mockup 02](02-flow-join.svg)).

### U14. Substitutes and the left-out list
> **Dropped (0030):** The app keeps its left-out list and its swaps. Kept below as the record of what was weighed.
The legacy listed players left out when a season started early, and had a live swap until the first result.
- **A.** Keep both; the left-out list becomes a substitutes' list the crew draws from, and a swap may bring a substitute in.
- **B.** Live swap only between teams.
- **Recommendation: A** ([mockup 11](11-crew-phone.svg), [mockup 15](15-edge-states.svg)).

### U15. How many seasons at once
> **Dropped (0030):** The app keeps its one open season at a time. Kept below as the record of what was weighed.
- **A.** One open season per event at a time, any number one after another.
- **B.** Several at once.
- **Recommendation: A.** The legacy's rule, and an event has one stage for its finals. Two at once would only matter for two games (U1 C), which no event has asked for. **Contract:** `season_open` (409) on a second.

### U16. A player's own view after the event
> **Dropped (0030):** The app keeps its rankings and its pages; no "My finals" on the platform. Kept below as the record of what was weighed.
- **A.** "My finals": the ranking with its move and why, the seasons played, titles ([mockup 13](13-champions-and-rankings.svg)), and the module's part of the person's export.
- **B.** Nothing personal; only public champions.
- **Recommendation: A.** The legacy's ranking changes were the reason people came back.

### U17. The `/finals` command
- **A.** Keep the live shape exactly: one command, the status line, Register and Withdraw (Yes / No), the name dialog, the link button; only the provider behind it changes (D7, O9).
- **B.** Subcommands, as the stub reads.
- **Recommendation: A** ([mockup 03](03-discord.svg)). Players already use it; buttons need no typing on a phone; the stub's words follow the code. The switch to the new bot (#121) needs the same shape so nothing is lost. If the app later adds the person's team and next match to its status read, the line may show it; nothing waits for that.

### U18. Availability voting
> **Dropped (0030):** The app keeps availability voting. Kept below as the record of what was weighed.
The off-LAN app lets solo players tick the days they can play over the next three weeks; the page shows each day's count, the leading days and who voted; the crew can lock it; it closes at the first result. It exists because off-LAN seasons fill over days and are played when enough people can.
- **A.** Port it as a season option.
- **B.** Leave it to the off-LAN app: an event's season is played on the night; the season's start time and the vote to start early (U6) answer "when".
- **Recommendation: B.** No event night needs a three-week calendar; if the Apps track (D15) ever runs seasons between events, it comes with the core's app, not this module.

## L · Look and feel

### L1. Where the player's pages live
> **Dropped (0030):** The app keeps its own pages; the platform adds no Finals pages in the hub. Kept below as the record of what was weighed.
- **A.** In the hub's frame, owned by this module, as the App track pack proposes for the tournament (App track P4).
- **B.** A standalone Finals site, as the legacy.
- **Recommendation: A** ([mockup 02](02-flow-join.svg)). One frame, one sign-in, one place for notifications.

### L2. One bracket renderer
> **Dropped (0030):** The app keeps its seven renderers; the platform draws only its own screen card (D10). Kept below as the record of what was weighed.
The legacy has seven hand-drawn renderers, one per format, 1,028 lines, untested, the source of most of its fixes.
- **A.** One renderer drawing any format from the core's round table (columns of groups, places, connectors), with a test per format.
- **B.** Port the seven renderers.
- **Recommendation: A** ([mockup 06](06-bracket.svg)). Rounds as data make the eighth format free and the screen's widget the same code.

### L3. The bracket on a phone
> **Dropped (0030):** The app keeps its own phone views. Kept below as the record of what was weighed.
- **A.** "My path" first, then each round's groups as swipeable cards.
- **B.** The full bracket, scrolled sideways.
- **Recommendation: A** ([mockup 06](06-bracket.svg)). A phone cannot show six columns; the player's own route is what they look for.

### L4. Tracing a team's route
> **Dropped (0030):** The app keeps its own tracing. Kept below as the record of what was weighed.
- **A.** Keep the legacy's hover tracing as a tap that works on phones and the desk.
- **B.** Drop it.
- **Recommendation: A.** It was the bracket's best touch.

### L5. Round names
> **Dropped (0030):** The app keeps its own round names. Kept below as the record of what was weighed.
The legacy uses the game's own mode names for its rounds.
- **A.** Plain words by default ("Group of 3", "Second chance", "Semi-final", "Final · best of 3"); a game may bring its own names as data.
- **B.** The game's names everywhere.
- **Recommendation: A.** Plain words read for newcomers and other games; the names live with the game (D13).

### L6. What the venue screen shows
- **A.** Four moments from the app's news: "Finals are open" (count and QR, at the open and before the close), "Teams drawn", the bracket as the Pulse hero while the season runs, "Champion" ([mockup 12](12-venue-screen.svg)).
- **B.** The legacy's two cards only (open, started).
- **C.** A, plus a takeover for every decided group.
- **Recommendation: A.** C would crowd the screen every few minutes; the hero bracket shows each result as it lands. "Teams drawn" and the bracket need the app to expose them (D9); without them the screen shows B. **Contract:** Moments rules and presets, a `bracket` view-model for a tree (D10).

### L7. Moments' `finals` class
moments.md already has a `finals` class (rank 55), used today by the built-in `finals_result` rule for the tournament's final (`session.is_final`).
- **A.** Keep one class for "a final is being decided", shared by the tournament's final and this module's moments.
- **B.** Rename the existing use, or add a second class for this module.
- **Recommendation: A.** One class keeps the priority order simple and nothing is renamed (B would be a breaking change to a published enum, high risk, its own PR). The new rules are `finals_open`, `finals_drawn` and `finals_champion`, each with a preset. **Contract:** additive rules and presets.

### L8. Ranking changes on show
> **Dropped (0030):** Rankings stay in the app; the platform shows none. Kept below as the record of what was weighed.
The legacy shows each nickname's change (+3, −2) in a finished season, on by default, with a setting to hide.
- **A.** Each player always sees their own; everyone sees all when the setting is on (default on).
- **B.** Only one's own.
- **Recommendation: A** ([mockup 13](13-champions-and-rankings.svg), [mockup 16](16-settings-and-rights.svg)).

### L9. The champion moment
- **A.** A takeover with the team and its players, from the champion the app reports (D9) ([mockup 12](12-venue-screen.svg)).
- **B.** A, plus the champions list in rotation, once the app exposes it.
- **Recommendation: A now, B when the app offers the list.** Photos stay out: personal data with consent and storage rules the app does not have.

### L10. The organiser pages
> **Dropped (0030):** No organiser pages on the platform; the app keeps its admin pages. Kept below as the record of what was weighed.
- **A.** A Finals item in the shell's "Run the event": the seasons page (a card grid), the season desk, the team builder, results and history, settings; every page also at phone width ([mockups 07–11](07-season-desk.svg), [17](17-grids.svg)).
- **B.** The legacy's three admin pages as they were.
- **Recommendation: A.** Amendment 3's grids for seasons; tables for registrations, roster and history.

### L11. The reveal
> **Dropped (0030):** The reveal on phones would be a new app page; the app keeps its own look. Kept below as the record of what was weighed.
- **A.** When a solo season starts, each phone shows its own team as a full hero, and the screen shows every team ([mockup 02](02-flow-join.svg), [mockup 12](12-venue-screen.svg)).
- **B.** A list on the page.
- **Recommendation: A.** "Name revealed at start" was the legacy's tease; the reveal pays it off.

### L12. The finals cards' look
- **A.** The step 9 pack's drawings (season open with capacity and QR, starts now, champions), in the theme's look, as Moments takeovers.
- **Recommendation: A** ([mockup 12](12-venue-screen.svg)).

## D · Data and integrations

### D1. The shared tourney core
> **Dropped (0030):** The Finals app stays on its current core until it chooses to move; the platform pins nothing. The general core for Tournament and Games is its own later issue (0030). Kept below as the record of what was weighed.
0025: the bracket engine, rankings and the team builder come from one small public library, ISC, used by the off-LAN app and this module, pinned to a release. **It exists:** `finals-core` v1.0.1 (12 Nov), pure ESM with typings and tests, released only by a manual workflow as git tags (no npm yet); the off-LAN app pins `github:…/finals-core#v1.0.1`, its CI fails on any other pin, and a daily workflow opens a bump PR for a new tag. Every draw takes an optional random source, and the round tables are exported as data (`ROUNDS_*`, `roundsFor`).
- **A.** Pin a release tag the same way; fixes go upstream first as a new tag.
- **B.** The platform forks it.
- **Recommendation: A.** A fork is the vendored copy 0025 rules out. v1.0.1 lacks the reshuffle's bound and still exports `TEAMS_PER_SEASON` ([E9](#e9-the-format-mix-up-and-the-reshuffle)); those go upstream in a new tag.

### D2. Git tag or npm
> **Dropped (0030):** See D1: the platform pins no core. Kept below as the record of what was weighed.
The core is released as git tags only; npm publishing is "decided later" in its extraction plan.
- **A.** Pin the git tag now (0025's fallback); moving to npm is one bump PR.
- **B.** Wait for npm.
- **Recommendation: A.** 0025 names it; the lockfile records the tag, and dependency auditing (0015) reads it like any other. Nothing waits.

### D3. Storage
> **Dropped (0030):** No storage on the platform; the app keeps its own database. Kept below as the record of what was weighed.
- **A.** Per tenant under RLS, the kit's way: seasons, teams, entries, matches, match teams, reports, the roster, drafts and corrections, each operation one transaction with row locks; versioned additive migrations.
- **Recommendation: A.** The legacy's in-process queue, unenforced foreign keys and in-code schema upgrades are its known problems 2, 4 and 11. **Contract:** the module's tables in its migrations; no global table (D4).

### D4. Where rankings live
> **Dropped (0030):** Rankings and champions stay in the app; there is no clone or series on the platform for them. Kept below as the record of what was weighed.
The legacy keeps one global roster keyed by nickname, adjusted by every finished season. Users are global; events are tenants; a series groups an organiser's events.
- **A.** Per event: the roster and rankings belong to the event, and the series clone carries them, with the champions list, into the next event.
- **B.** Per series: a global table keyed by series and user.
- **C.** Global per user.
- **Recommendation: A.** It keeps every row in a tenant under RLS (no new global table for `check-tenancy`), fits "clone the last event" (tenants.md), and lets the 12-month anonymisation of an old event run without touching the next event's copy. B is the natural model but a new global table and a cross-tenant write; C mixes organisers. **Contract:** a clone endpoint in finals.md.

### D5. Identity of a player
> **Dropped (0030):** The app keeps its own identity rules; its Discord id arrives with each sign-up, as today. Kept below as the record of what was weighed.
- **A.** Entries, team members, roster rows and titles point to a user id; a guest (U5) is a row of this module with its own id.
- **B.** Nicknames, as the legacy.
- **Recommendation: A.** The legacy's problem 6: a rename started a new player, two people with one nickname shared a ranking. The display name in a season is the user's, editable per season, unique in the season (E8).

### D6. A Discord sign-up by someone who never signed in
> **Dropped (0030):** The app holds the Discord id itself, as today; the platform holds no entry. Kept below as the record of what was weighed.
The stub: one entry per (season, `discord_user_id`); the link between a user and a Discord id is kept only in tenants; "how a Discord user who never signed in is held is the Finals track's". Today a user row exists only after a sign-in.
- **A.** The entry holds the Discord id and name until that person signs in; at sign-in (or at the next read) tenants resolves the id to the user and the entry becomes theirs.
- **B.** The tenants module creates a user for a Discord identity on request (a user who has never signed in), and the entry is that user's.
- **C.** Register in `/finals` needs a signed-in member: the bot answers with the hub link.
- **Recommendation: A**, held as personal data under the same retention, with tenants' internal lookup by Discord id (an additive internal path). C fails the exit criterion's spirit; B creates accounts nobody asked for. The membership rule still holds: the entry plays, but the person sees attendee data only after joining (E13). **Contract:** an internal lookup in tenants.md, and the entry's `discord_user_id` in finals.md.

### D7. How the bot reaches the Finals app
The live provider (the app) answers under `/api/provider` with a bearer secret; the live bot keeps one root and always adds `/api/provider` to it. The stub also describes a platform provider at `https://<event host>/api/finals`, which this direction no longer builds. The four sides are compared row by row in [the brief](../track-finals.md#the-provider-contract-four-sides).
- **A.** The bot module holds one full base per provider: the app's `https://<app host>/api/provider` with its bearer and its public origin, taken from the event's connection (O4, O9). The paths after the base and every shape stay the live provider's; `GET status` stays public too. The stub's platform base is removed in the contract issue.
- **B.** Keep one root and the fixed suffix.
- **Recommendation: A.** It is the smallest change to the live client (it drops the fixed suffix) and the one place that knows the app's address and secret. The stub marks its base provisional, so removing it is not a breaking change to a released contract, but the review should look at it ([mockup 14](14-lifecycle.svg)). **Contract:** finals.md.

### D8. The full finals contract
- **A.** `contracts/finals.md` becomes the contract of an external Finals app: the provider part as the app answers it today, with fixtures (D14); the reads and events the app exposes (D9); the events the platform republishes; the settings (O4). Shared OpenAPI components keep it small.
- **B.** Keep the stub as it is.
- **Recommendation: A**, split by part and shipped with the package that first uses each part ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)).

### D9. What the app must expose
Today the app's provider API gives the bot a status, sign-up and a link, and its other reads sit behind the read gate with a payload-less SSE ping. The screen and Moments need more.
- **A.** Events: season opened, started, finished (with the champion) and cancelled; match decided. Reads: the season's bracket (rounds, groups, places, the live round) and the champions list. Public data only: names, places, counts; never a lobby code or a Discord id. They reach the platform as `finals.season.opened`, `.started`, `.finished`, `.cancelled`, `finals.match.decided` ([mockup 14](14-lifecycle.svg)).
- **B.** Only status: the screen shows "open", "started" and "champion" cards, no bracket.
- **Recommendation: A.** The bracket on the Pulse is the point of the screen part. The additions go to the app's author as a request and into the provider contract as additive fields (P4, D17).

### D10. The screen's bracket widget
step 9's pack draws `bracket` as a session's heats and says "the tree waits for the Finals track".
- **A.** Extend `bracket` additively with a tree view-model (rounds, groups, places, connectors, the live round), fed by the app's bracket read (D9).
- **B.** A new `finals_bracket` widget.
- **Recommendation: A.** One widget, one look; the tournament's heats and this tree are the same picture at different depths. **Contract:** additive fields in screen.md.

### D11. The run of show
> **Dropped (0030):** Finals seasons are not mirrored into the run of show. Kept below as the record of what was weighed.
- **A.** A season can be placed in the run of show (its open, its close, its final), mirrored the way the tournament's sessions are.
- **B.** No link; the crew adds an agenda item by hand.
- **Recommendation: B now.** The mirror is the tournament's pattern and costs a contract part; finals nights are short and often unplanned (U12). A `Roadmap note:` if the session wants A.

### D12. Legacy data
> **Dropped (0030):** Nothing to import: the app keeps its data and the bot's own data follows step 6. Kept below as the record of what was weighed.
- **A.** Nothing (0004); rankings start at 50 at the first event.
- **B.** A one-time roster import (nicknames and rankings) the crew matches to users.
- **Recommendation: A.** 0004 allows only the bot's data; the step 6 pack's import of the bot's finals state file covers the cards' last state, which nothing on the platform needs. B would need a new record.

### D13. The game and its arenas
> **Dropped (0030):** The game and its arenas stay the app's. Kept below as the record of what was weighed.
- **A.** Until the Games track's catalogue holds them, the game's name, arenas and round names are a module setting; then they come from the catalogue.
- **B.** Wait for the catalogue.
- **Recommendation: A** ([mockup 08](08-new-season.svg)). The legacy's arena list is a constant; a setting is the smallest step, and the catalogue replaces it later (Roadmap note).

### D14. The provider contract and its tests
The app's `test/provider.test.js` already pins the live behaviour: the bearer on every route (and a missing secret failing closed), status with no season, in both modes and finished with a champion, idempotent sign-up that never returns a token, the sign-up errors (a teams season, a name taken by a page or a team player), the team read at query time, withdraw only while open, the link's validation and 15 minutes.
- **A.** The provider contract's examples are fixtures taken from those cases; the bot module's provider tests run them against the app at a pinned commit (`1a4fe2a` or newer); the contract's "verified against" names that commit.
- **B.** Test the bot's client against a hand-made stub only.
- **Recommendation: A** (0025's known limit). The fixtures live in `contracts/`; the app's author is told of any change before it ships.

### D15. The Apps track
- **Decided (0030).** Finals is an external app at the Apps track's level 3, the pilot of #193; the platform talks to it through the provider contract and what D9 adds. The platform builds no app interface for it here, and the app stays independent of the platform with no data sync (0025).

### D16. What the platform sends the app, and what leaves with a person
- **A.** The platform sends the app only what `/finals` already sends (the Discord id and the display name) and nothing else. The app's data stay in the app, outside the platform's export, delete and 12-month anonymisation (0027); the hub's privacy page says so beside the tile.
- **B.** The contract adds a call the platform makes when it erases a user, and the app deletes or anonymises that person.
- **Recommendation: A now.** B is a request to the app's author and a new record, not this track's; a `Roadmap note:` if the product owner wants it.

### D17. How the platform gets the app's news
- **A.** The app posts signed events to a platform endpoint (the Apps track's level-3 connection, #193), which republishes them as `finals.*`.
- **B.** The platform reads the app's status and bracket (every 30 seconds while a season runs), as the legacy watcher does.
- **Recommendation: B until the pilot's connector exists, then A.** B needs only the reads of D9 and is proven by the legacy watcher; A is the clean end state. The contract names the events either way.

### D18. Sign-in through the platform
Today the bot's link button opens the app already signed in, through a 15-minute link the app makes (the person's Discord id, name and role ids go to the app).
- **A.** The platform's Discord sign-in hands the app a signed assertion (who, display name) under the Apps track's level-3 interface (#193); the app's own link session stays for people who come from outside the platform.
- **B.** The link button stays the only door, as live; the platform adds nothing.
- **Recommendation: A, built in the pilot; B until then.** B works today. A is sign-in work, so its issue is high risk and waits for #193 (P5). The platform stops sending role ids either way.

## E · Edge cases and failure

### E1. Races
> **Dropped (0030):** Races are the app's to guard; its write queue is its own known problem. Kept below as the record of what was weighed.
- **A.** The last place, a double sign-up (hub and Discord at once), two reports at once, a swap during a report: each one transaction with row locks, idempotent by key, with race tests.
- **Recommendation: A.** The legacy had no concurrency test.

### E2. A dispute nobody settles
> **Dropped (0030):** The app keeps its own dispute handling. Kept below as the record of what was weighed.
- **A.** The next round waits; the desk's queue shows it; after a delay (5 minutes by default) the crew on duty is pinged ([mockup 07](07-season-desk.svg)).
- **B.** Auto-decide by the first report.
- **Recommendation: A.** A wrong result is worse than a wait.

### E3. A player leaves
> **Dropped (0030):** The app keeps its own swaps. Kept below as the record of what was weighed.
- **A.** Before the team's first result the crew swaps in a substitute or another player; after it the team plays short or withdraws, the crew decides.
- **Recommendation: A** ([mockup 11](11-crew-phone.svg)). The legacy locked swaps at the first result for fairness.

### E4. Correcting a result
> **Dropped (0030):** The app keeps its own results; corrections are a request to its author, not this track. Kept below as the record of what was weighed.
The legacy could not; its README asked for it.
- **A.** A correction with a reason, allowed while no later match built from it has a result; the page shows what it changes (who goes through, which drawn round is redrawn, who is told) before it is made ([mockup 10](10-results-and-corrections.svg)).
- **B.** Corrections anywhere, replaying later rounds.
- **C.** No corrections; the crew cancels the season.
- **Recommendation: A**, and a later round with a result must be reopened first, itself a correction. B can silently undo a played final.

### E5. Rankings after a correction or a deletion
> **Dropped (0030):** Rankings stay in the app. Kept below as the record of what was weighed.
The legacy did not revert ranking changes when a season was deleted.
- **A.** Deltas are stored per season; a correction after the finish or a deletion reverts them and applies the new ones.
- **Recommendation: A.**

### E6. A season that does not fill
> **Dropped (0030):** The app keeps its own early start. Kept below as the record of what was weighed.
- **A.** Keep the legacy: start early with the largest size the sign-ups fill (left-out players become substitutes), change the size, or cancel.
- **Recommendation: A.**

### E7. The bot is down, or the app cannot be reached
- **A.** `/finals` says "try again later" (one sentence for every failure); the screen shows the last Finals card until its window ends and nothing else for Finals; the hub tile still links; the app works without the platform.
- **Recommendation: A** ([mockup 03](03-discord.svg)).

### E8. Names
- **A.** The bot cleans the nickname to the live rule (letters, digits, spaces, `_ - .`, 18 at most) and sends it; the app is the final judge, and its reason or the name dialog is shown. The platform keeps no name rule of its own.
- **Recommendation: A** ([mockup 03](03-discord.svg)).

### E9. The format mix-up and the reshuffle
> **Dropped (0030):** The mix-up and the reshuffle live in the app and the core; they go to their author as a follow-up (brief, Roadmap notes). Kept below as the record of what was weighed.
The inventory's bug 1: a full solo `fourqc` season is saved as `four`; its problem 5: the eight-team round 2 reshuffle has no bound. Both are still open at the current heads: the off-LAN app finds the format by team count in five places, and finals-core v1.0.1 lists `four` before `fourqc` in `CAPACITY` (both hold 4) and keeps the unbounded `do … while`. Step 7's pack moved the "format mix-up" regression test here.
- **A.** The module stores the season's chosen format and never derives it from a team count (an early start picks among the formats the organiser allowed); the reshuffle gets a bound in a new core tag; regression tests in the module and the core.
- **B.** Fix both in the core only (a helper that maps a count and a preference to a format).
- **Recommendation: A.** The mix-up is in the consumer's lookup, so only the consumer can guard it; the bound belongs in the core because both consumers run it. The off-LAN app's author hears of both (P4).

### E10. Debug fill
> **Dropped (0030):** The app keeps its own debug fill. Kept below as the record of what was weighed.
- **A.** Fake teams and votes only on the demo event and in tests, behind the superadmin; never a tenant setting.
- **Recommendation: A.** The demo data lives in `events/demo/` (O7).

### E11. A cancelled season
The app cancels a season while open or running and keeps it in history.
- **A.** The app reports it (D9); the screen card is removed at once and the channel post says the season was cancelled.
- **Recommendation: A** ([mockup 14](14-lifecycle.svg)).

### E12. Late arrivals
> **Dropped (0030):** The app keeps its own late-arrival rules. Kept below as the record of what was weighed.
- **A.** A started season takes no sign-ups; late players can follow and join the substitutes' list.
- **Recommendation: A** ([mockup 15](15-edge-states.svg)).

### E13. Not a member
- **A.** `/finals` and the hub tile work for any Discord user of the server, as today; the platform gates nothing by event membership, because the app also serves people between events.
- **B.** Only event members.
- **Recommendation: A.**

### E14. Clone and archive
> **Dropped (0030):** No clone or archive: the platform holds no Finals data. Kept below as the record of what was weighed.
- **A.** The clone copies the roster, rankings and champions, never seasons; an event archived with a season open finishes it as cancelled.
- **Recommendation: A.**

### E15. Renaming a season and fixing a name afterwards
> **Dropped (0030):** The app keeps its own renaming and fixing. Kept below as the record of what was weighed.
The off-LAN app renames a season while it is open or running, and fixes player names in a finished season; because its rankings and titles are keyed by nickname, a name fixed in one season moves no ranking and splits a champion's titles.
- **A.** The crew renames a season at any time before Finished, and fixes a person's display name in any season; both audited (O6). Rankings and titles belong to the person (D5), so nothing splits.
- **B.** No edits after the start.
- **Recommendation: A.** Typos in names on a big screen happen every night; with identity by person the fix is only a label.

## O · Operations and scale

### O1. Scale
An event of 2,000 may watch a season. The load is the spectators' reads and the screen.
- **A.** The platform reads the app once per change (D17) and serves the screen and the hub from its own cache; no viewer connects to the app through us, and the app's own SSE stays its own.
- **Recommendation: A.**

### O2. Live updates on phones
> **Dropped (0030):** The app keeps its own live updates; the platform reads through its cache (O1). Kept below as the record of what was weighed.
- **A.** The hub's live channel (App track), keyed to the season's revision.
- **Recommendation: A.** No module-owned stream.

### O3. Crew pings
> **Dropped (0030):** The app keeps its own crew tools. Kept below as the record of what was weighed.
- **A.** Pings for a long dispute or a missing lobby code go to the crew on duty, through Notify's crew delivery once step 8's alerts exist; until then on the desk only.
- **Recommendation: A** ([mockup 11](11-crew-phone.svg)).

### O4. Settings and their defaults
- **A.** Per event: the connection (the app's address, its bearer secret write-only and encrypted, a "test connection" check; none set means Finals is off), show Finals on the screen (on), the open and started card windows (15 and 10 minutes, the legacy's), the hub tile (on), which app (O9).
- **Recommendation: A.** **Contract:** settings in finals.md.

### O5. Rights
- **A.** No new right or role: the settings (O4) use the event admin's existing settings right.
- **B.** A `finals.settings.write` right of its own.
- **Recommendation: A.** Four settings do not need a role. B costs a preset and a contract part.

### O6. Audit
> **Dropped (0030):** No audit on the platform; the app has its own admin trail, if any. Kept below as the record of what was weighed.
- **A.** Every crew act (open, start, cancel, swap, decide, correct, roster edit) is audited with its reason and shown in the season's History ([mockup 10](10-results-and-corrections.svg)).
- **Recommendation: A.** The legacy had no audit.

### O7. Demo data
- **A.** `events/demo/` carries a fixed feed of the app's events and reads (a season open, one decided bracket, a champion) so screens, Moments and screenshots work without the live app. The exit's end-to-end run is on a test instance of the app, which the demo event points at.
- **Recommendation: A.** The screenshots and CI need data that never changes.

### O8. Upgrading the core
> **Dropped (0030):** The platform pins no core (D1). Kept below as the record of what was weighed.
- **A.** A bump PR with the core's release notes and the module's tests; bumps land between events, never during one; the module's tests fail on a pin that is not a release tag, as the off-LAN app's CI does.
- **Recommendation: A** (0025). A daily bump workflow like the off-LAN app's is not needed: the core changes rarely and the lead opens the bump.

### O9. The provider switch
The live bot holds three values for its one provider: the root, the bearer, and the public origin its guard allows links to.
- **A.** The Discord side follows the event's connection (O4): no app set means `/finals` is off; otherwise the bot uses the app's address and secret that the event admin set ([mockup 03](03-discord.svg)). There is no separate bot-side secret.
- **B.** The same without "off".
- **Recommendation: A.** One place holds the address and secret; the secret is write-only. **Contract:** the setting in finals.md and bot.md.

### O10. Discord roles and the Finals crew
> **Dropped (0030):** The app keeps its admins by Discord role as it is. Kept below as the record of what was weighed.
The off-LAN app makes anyone holding a listed Discord role an admin, decided when their link is made; #121 plans rights by role id inside the bot. On the platform, admin rights come only from sign-in (already decided).
- **A.** No mapping: event admins give people the "Finals crew" role in the admin pages (O5).
- **B.** The event maps a Discord role to "Finals crew", synced at sign-in.
- **Recommendation: A.** B is a platform-wide feature (every module's roles), not this track's; if wanted, a `Roadmap note:` for the admin module.

## P · Plan and scope

### P1. The direction
- **Decided (0030).** Integration: the existing app unchanged, plus what the platform adds around it ([the brief](../track-finals.md#recommended-direction-integration)). Directions A, B and C are the record of what was weighed; C is not chosen.

### P2. The issue set
- **Recommendation:** as the brief's [Proposed issue changes](../track-finals.md#proposed-issue-changes): the integration only.

### P3. The exit criterion
- **Recommendation:** as the brief's [Proposed exit criteria](../track-finals.md#proposed-exit-criteria): a season runs end to end on the app (the demo event points at a test instance), with a `/finals` sign-up through the new bot, its bracket on a venue screen and the champion in Moments.

### P4. Aligning with the app's author
The core is released and the provider contract is implemented and live; what is left is what the app must expose (D9), the fixtures (D14) and, for the author, the two core fixes (the reshuffle's bound and the unused export).
- **A.** Before the screen package, the lead agrees D9's reads and events with the app's author, who ships them in the app; the fixtures are agreed the same way; the core's two fixes go to the author as a `Follow-up:`.
- **B.** The platform builds only on what the app answers today.
- **Recommendation: A.** B gives the screen cards and no bracket (D9 B).

### P5. Order against the bot, the hub and the Apps track
The bot module (step 6), the hub's frame (App track) and the pilot (#193) are not built; Moments, Screen and Notify are.
- **A.** The contract first, then the screen and Moments on the demo feed (O7), then `/finals` when the bot's command framework exists, then the hub tile and the sign-in with the pilot. The exit waits for the bot and the app's additions.
- **B.** Wait for all three before starting.
- **Recommendation: A.** The screen part needs neither the bot nor the hub.

### P6. The plan issue
The pack's issue exists (#172); the plan issue ("docs(briefs): Finals track: plan") does not, so nothing is blocked by it yet.
- **Recommendation:** the lead opens it and blocks the track's build issues on it, as the briefs README says.

### P7. The labels
#172 carries `module:games`; no `finals` module will exist.
- **A.** Each issue carries the label of the module it touches (`module:screen`, `module:moments`, `module:bot`, `module:kit` for the contract).
- **B.** A `module:finals` label for the track.
- **Recommendation: A.** 0030 builds no module, and a label for none would be an empty one.
