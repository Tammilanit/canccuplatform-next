# Legacy inventory: thefinals_mini_tourney

The mini-tourney repo, read in full so the product owner can confirm what exists before the tenancy foundation ([#47](../roadmap.md#2b-tenancy-foundation)) and the contracts ([#36](../roadmap.md#2c-event-catalog-and-screen-contract)) are designed. Roadmap step 2a, issue #73. Other legacy repos are out of scope here; each has its own inventory (#68 canccuplatform, #69 canccubot, #70 canccumanager, #71 canccusignage, #72 the signup site, #74 canccudocs, #75 canccustream), and the summary (#76) joins them.

Nothing here is copied from the legacy repo: it is described. Short identifiers (route paths, table and column names, env var names, setting keys) are kept so the port can find them. Event-specific values are named by kind and counted only (see [Event-specific content](#event-specific-content)). This inventory describes the code; porting it waits for its author's OK (AGENTS.md, Porting).

## In short

- **What it is.** A small web app for in-house tournaments of one team game, with teams of three: a season is created, teams or single players register, the app draws the opening lobbies, results come in from the admin or from the teams themselves, later rounds are built automatically and a best-of-three final crowns a champion. It also keeps a player roster with a 0–100 ranking that a finished season adjusts, a team builder that forms even teams from that roster, and a champions page.
- **Stack.** Node.js (≥ 22.22.1 per the README), Express 5, `sqlite3` (one file), plain browser JavaScript and CSS with no build step. One process, one SQLite connection; live updates by Server-Sent Events plus 5 s polling.
- **Size.** 34 tracked files, 8162 lines (6582 without `package-lock.json`); 151 commits from 2026-10-04 to 2026-11-04. Read at commit `87d7c81004` (`main`, 2026-11-04).
- **Refreshed** on 2026-11-20 at commit `1a4fe2a495` (`main`, 2026-11-16), issue #677: the 37 commits since, their diffs and the files they add, read in a fresh clone; the suite run again. Now 41 tracked files, 9902 lines (8313 without `package-lock.json`); 188 commits to 2026-11-16. What changed is in [Refresh 2026-11-20](#refresh-2026-11-20); the sections below carry it in place, each changed fact with its commit or file, and facts without a link hold at both commits. The shared core it now depends on, `glyzer/finals-core`, is described [there too](#the-shared-core-glyzerfinals-core).
- **Licence and attribution.** `package.json` declares `"license": "ISC"` and an empty `author`. There is no `LICENSE` file and no copyright line anywhere in the repo. The code is the upstream author's (the one AGENTS.md names): 149 of the 151 commits are his (two git identities); two are a platform maintainer's (`GET /api/healthz` and its merge, upstream PR #2). The upstream remote is the author's own GitHub repo. At the refresh: 170 of 188 commits are the author's and 18 a platform maintainer's (16 of the 37 new ones: the provider API, the hardening, finals-core, CI and deploy); still no `LICENSE` file. The author gave the OK to reuse the code on 2026-11-07 ([0025](../decisions/0025-finals-and-games-modules.md)).
- **Port verdict.** As the roadmap says ([Games](../roadmap.md#games) track, epic #66): the bracket engine (`src/ladder.js`), rankings (`src/rankings.js`) and team builder (`src/teambuilder.js`) are pure functions with good tests and port almost as-is; the service rules port onto Postgres transactions; storage, API, auth and the frontend are rewritten; the shared admin password is dropped. Two real bugs were found (see [Known problems](#known-problems) 1 and 2). Since [0025](../decisions/0025-finals-and-games-modules.md) the target is the `finals` module (Finals track), and since [1a3cc3a] the three pure files live in `glyzer/finals-core` v1.0.1, which the app pins; both bugs are still there at the refresh.

## Refresh 2026-11-20

The 37 commits from `87d7c81004` to `1a4fe2a495` (2026-11-07 to 2026-11-16) turn the LAN app into a public one that the Discord bot fronts. By theme:

- **Provider API and Discord link session** ([1ff0a83], `src/provider.js`): a bearer-protected API under `/api/provider` for the bot's `/finals` (status, individual sign-up by Discord user, withdraw, page links), following the canccuplatform contract `docs/contracts/finals-provider-api.md` ([its inventory](canccuplatform.md#refresh-2026-11-20)). A link is `<PUBLIC_BASE_URL>/#d=<token>`: a stateless HMAC-signed token (15 min) that the page swaps through `POST /api/session` for a 7-day `HttpOnly; SameSite=Lax` session cookie (`Secure` on an `https:` base), then drops from the address. Individuals gain a `discord_user_id`, unique per season; a session stands in for the browser's edit token, so a signed-in player can find, rename, vote, withdraw and report from any device.
- **Discord sign-in and roles; the password goes** ([96925b2]): admin is a session whose link carried a role id in `ADMIN_ROLE_IDS`, decided when the link is made; `ADMIN_PASSWORD` and the `x-admin-password` header are gone. A host-only `npm run admin-link` (`scripts/admin-link.js`) prints a 15-minute admin link when the bot is down. The same commit adds a fixed-window write limit (30 a minute per client address, the bot exempt, `429` with `Retry-After`), `413` for bodies over 10 kB and `TRUST_PROXY`.
- **The read gate** ([5a490fe]): `READ_GATE=1` makes public reads, the SSE stream and the public writes (sign-up, public start) need a session or the bot's bearer; off by default. Independently, the pages show nothing but "open the link from Discord" until a session exists ([c5a358d], layout fix [0237491]); the Administration link shows only to admins.
- **Individual-only seasons** ([567c556]): `INDIVIDUAL_ONLY=1` rejects team mode and makes individual the default; the admin page hides the mode picker ([fd16dd6]). The register form is prefilled from the session's Discord name ([0bfe3f8], [cc052aa]) and says when the player is already registered ([55ca01e]).
- **Availability voting** ([72ac1fb], [1a4fe2a]): each individually registered player ticks the days that suit them, from today through the next 20 days of one fixed time zone; the page shows the count per day, who said yes and who no, who has not voted, and marks up to five days tied for the most votes. Totals and names are visible to every viewer of the season. An admin can lock and unlock it; the first team report or confirmed result closes it for good and clears the votes; left-out players' votes go at the draw.
- **Running seasons: cancel and rename** ([f7b4a75], [9fd6e11]): an admin can cancel a season in `register` or `active`; it is kept with the new state `cancelled` (ladder and results hidden, no ranking changes) instead of being deleted, and it frees the open-season slot. An admin can rename a season while it is open. Reports and results need the season `active`.
- **Nickname edits in finished seasons** ([aec85f9], [9cec70e]): a new admin page `/admin-seasons.html` lists finished seasons and saves a retyped player name per team slot as you type; the individual's row follows. Roster rankings and trophy counts stay keyed by the old nickname.
- **SSE keepalive** ([5313b2d]): `: ping` every 30 s so an idle proxy keeps the stream; `POST /api/session` and `POST /api/provider/links` no longer wake the clients.
- **finals-core as a dependency** ([1a3cc3a], [8b6758d]): `src/ladder.js`, `src/rankings.js`, `src/teambuilder.js` and `test/ladder.test.js` are deleted; the service imports `finals-core/ladder`, `/rankings` and `/teambuilder`, pinned as `github:glyzer/finals-core#v1.0.1`.
- **CI and deploy on merge** ([292ac9a], [83a8ecb], [7a2b4ff], [af42654], [f1805fb]; actions bumped in [c8dcea0]): a `test` job on every PR and push checks that the finals-core pin is a `vX.Y.Z` tag, then runs `npm ci` and `npm test`; a daily workflow opens a bump PR when finals-core has a newer tag; every push to `main` deploys after a green `test`, from a runner that joins the operators' private network and calls the host's forced-command deploy (the host side is in the [canccuplatform inventory](canccuplatform.md#refresh-2026-11-20)). A deliberately failing test checked that a red `test` blocks the deploy and was removed ([4f48816], [bbe9364]). There is no branch protection.
- **Fixes and upkeep:** dependency updates for `npm audit` findings ([d7e367a]); an undefined parameter in page API calls ([5d08e50]); the README's local test steps, and its arena list replaced by a pointer to `src/arenas.js` ([22e2253]).

### The shared core: glyzer/finals-core

A public repo made by a platform maintainer on 2026-11-08 ([0025](../decisions/0025-finals-and-games-modules.md), canccuplatform plan `docs/plans/issue-163.md`), read at `9d65a846a2` (`main`, 2026-11-12, tag `v1.0.1`; `v1.0.0` is `f03e0ac423`). 5 commits, 846 lines of source and tests.

- **What it exports:** `finals-core/ladder` (`CAPACITY`, the seven `ROUNDS_*` tables, `roundsFor`, `finalRound`, `shuffle`, `drawRound1`, `validateResult`, `nextRound`, `champion`, and the unused `TEAMS_PER_SEASON`), `finals-core/rankings` (`rankingDeltas`, `clamp`), `finals-core/teambuilder` (`buildTeams`), and the root with everything but `shuffle`. ESM with TypeScript declarations (`src/*.d.ts`), Node 22.12 or newer, no runtime dependencies. The logic is the app's three files at `87d7c81004` line for line; only the module format changed, so [Known problems](#known-problems) 1 and 5 travel with it.
- **Its tests:** `node --test`, 20 tests: the app's 10 ladder tests (imports changed) plus 6 for rankings and 4 for the team builder, which had none of their own before. Run at the refresh: 20 passed.
- **Licence and attribution:** an ISC `LICENSE` with "Copyright (c) 2026 finals-core contributors"; `package.json` says ISC and has no `author`. Neither the licence, the README nor `package.json` names the mini tourney or its author; the code's origin shows only in the canccuplatform plan and the app's commit [1a3cc3a]. 0025 asks that the core keep its author's attribution.
- **Releases and pinning:** only a manual `release` workflow tags: it checks the version and that the tag is new, runs the tests, packs a candidate, then tags `vX.Y.Z` and makes a GitHub release. Nothing is on the npm registry. The app pins the tag (`github:glyzer/finals-core#v1.0.1`; its lockfile resolves the commit), its CI refuses any other pin, and the daily bump workflow proposes new tags as PRs.
- **Also in the repo:** a `CLAUDE.md` for agent sessions that points to the canccuplatform repo for hosts and contracts.

## Coverage

Every tracked file was read: the server, the bracket, rankings and team-builder code, all HTML pages and page scripts, the tests and the README in full; the seven bracket renderers (`public/format-*.js`) were read in full for one (`format-four.js`) and by every function and comment for the other six (they share its structure); the stylesheet by its sections and every comment; `package-lock.json` for its dependency tree only. Nothing was skipped. "Lines" is `wc -l`.

| Directory | Files | Lines | Files read |
|---|---|---|---|
| `/` (root) | 4 | 1769 | `.gitignore`, `README.md`, `package.json`, `package-lock.json` (1580 lines, lockfile v3) |
| `.pi/` | 1 | 5 | `.pi/settings.json` (an AI coding-agent tool setting, not read by the app) |
| `src/` | 8 | 1745 | `src/server.js`, `src/app.js`, `src/service.js`, `src/db.js`, `src/ladder.js`, `src/rankings.js`, `src/teambuilder.js`, `src/arenas.js` |
| `public/` | 19 | 3283 | `public/index.html`, `public/app.js`, `public/admin.html`, `public/admin.js`, `public/admin-teams.html`, `public/admin-teams.js`, `public/admin-settings.html`, `public/admin-settings.js`, `public/champions.html`, `public/champions.js`, `public/common.js`, `public/format-three.js`, `public/format-four.js`, `public/format-fourqc.js`, `public/format-six.js`, `public/format-eight.js`, `public/format-nine.js`, `public/format-twelve.js`, `public/style.css` |
| `test/` | 2 | 1360 | `test/ladder.test.js`, `test/api.test.js` |
| **Total** | **34** | **8162** | |

The refresh read every diff of the 37 commits after `87d7c81004` (33 files changed, 2598 lines added, 861 removed) and the 10 files they add in full: `src/provider.js`, `scripts/admin-link.js`, `public/admin-seasons.html`, `public/admin-seasons.js`, four test files and three workflows under `.github/workflows/`. The three deleted engine files and `test/ladder.test.js` were compared line by line with `glyzer/finals-core`. The table above is the first read's.

By kind: source 27 (server 8 files, 1745 lines; browser 13 scripts, 2362 lines, of which 7 are bracket renderers with 1028 lines; 5 HTML pages, 268 lines; `public/style.css`, 653 lines); config 4 (`package.json`, `package-lock.json`, `.gitignore`, `.pi/settings.json`); migrations 0 as files (the schema and its upgrades run from `src/db.js` at start-up, see [Data](#data)); scripts 0 (only the npm scripts `start` and `test`); tests 2; docs 1 (`README.md`). The git history was read too: all 151 commit subjects, the bodies and diffs of the `fix` commits and of the two README "TODO" commits. No file was ever deleted. There is one branch (`main`) and no tags.

## Features

"Where" is the path in this repo; "Reached by" is how a person gets to it. Every page is a static file under `public/`, served at the site root.

### Player features (public, no sign-in at the first read)

Since [c5a358d] the pages show only "open the link from Discord" until the browser holds a session from a `/finals` link (P15); with `READ_GATE=1` the API refuses too ([5a490fe]).

| # | Feature | Where | Reached by |
|---|---|---|---|
| P1 | Season picker: every season with state and format, newest first; deep link to one season | `public/app.js`, `public/index.html` | `/` (`index.html`), query `?season=<id>` |
| P2 | Bracket ("ladder") of the selected season: one renderer per format with round columns, cards per match, SVG connector lines, a champion column, the arena per phase, the lobby id on pending cards, "Results submitted: N" under a pending card with reports, a format description while registering or running | `public/common.js`, `public/format-*.js`, `public/app.js`, `public/style.css` | `/` |
| P3 | Hover a team: its players in a tooltip; in a finished season its whole route, its lines and (if champion) the badge light up while the rest fades; hovering the badge traces the champion | `public/common.js` (`renderLadder`, `markLines`), `public/style.css` | `/`, desktop only |
| P4 | Team registration: team name (≤ 24) and three nicknames (≤ 18); edit or cancel it from the same browser until registration closes | `public/app.js`, `src/service.js` (`registerTeam`, `updateTeam`, `cancelTeamRegistration`) | `/` while a season is `register` |
| P5 | Individual registration: one nickname; change it or cancel until the start; anonymous boxes ("Name revealed at start", dashed when incomplete) in the team list; "left out" list after the start. Since [1ff0a83] a sign-up made with a session stores the Discord user (one per season) and the session replaces the browser's token on any device; since [0bfe3f8] the nickname box is prefilled from the Discord name; since [55ca01e] the form says when the player is already registered | `public/app.js`, `src/service.js` (`registerIndividual`, `updateIndividual`, `cancelIndividual`, `individualStatus`, `myRegistration`) | `/`; also by `/finals` in Discord (P16) |
| P6 | Vote to start early: a registered individual votes or withdraws; at 6 votes (`MIN_VOTES`) the season starts with the largest fitting size | `public/app.js`, `src/service.js` (`voteStart`, `earlyTeams`) | "Vote to start early" button on `/` |
| P7 | Report results: the browser that registered a team (or any member who registered as an individual) reports the placements of its pending match; two matching reports from different teams decide it; differing reports wait for the admin; a team can re-report until decided | `public/app.js` (`renderReporting`), `public/common.js` (`attachPicker`), `src/service.js` (`reportResult`, `getReport`) | "Report results" on own pending card |
| P8 | Lobby id: a team sets a 4-character code for its pending match; shown above the teams, hidden once decided, inherited by the next game of a series | `public/common.js` (`addLobbyButton`), `src/service.js` (`setLobbyId`, `createRound`, `loadMatches`) | "Set lobby id" on own pending card |
| P9 | Public tournament start: when no season is open, in two month windows (or off-season if allowed), anyone may start an individual-only season with a server-chosen name, a format and arenas | `public/app.js`, `public/index.html`, `src/service.js` (`getPublicStart`, `publicStartSeason`) | "Start a new tournament" section on `/` |
| P10 | Ranking change marks: in a finished season each nickname shows its change (green +N, red −N) unless the admin hides them | `public/app.js`, `src/service.js` (`getSeason` → `rankingChanges`) | `/` |
| P11 | Champions page: every finished season with its champion team and finish date; below, players ranked by trophies (one per title) | `public/champions.js`, `public/champions.html` | `/champions.html` |
| P12 | Toasts: "new tournament created" with a link, "the tournament you were viewing was cancelled", errors | `public/common.js` (`toast`), `public/app.js` | All pages |
| P13 | In-page modal dialogs instead of native `confirm`/`prompt` (phones block those); validation inside the dialog | `public/common.js` (`modal`, `confirmModal`) | All pages |
| P14 | Availability voting ([72ac1fb], [1a4fe2a]): an individually registered player ticks the days that suit them, today through 20 days ahead in one fixed time zone, saved as they tick; per day the count, who said yes and who no, who has not voted; up to five days tied for the most votes highlighted. Visible to every viewer of the season. Closes for good at the first report or result | `public/app.js` (`renderAvailability`), `src/service.js` (`getAvailability`, `voteAvailability`) | "Your availability" on `/` while a season is open |
| P15 | Sign in from a Discord link ([1ff0a83]): the `#d=` token becomes a 7-day session; the Administration link shows to admins only ([c5a358d]) | `public/common.js` (`discordSignIn`), `src/provider.js` | The link from `/finals` |
| P16 | Discord sign-up, withdraw and page link through the bot ([1ff0a83]); see the provider routes below | `src/provider.js`, `src/service.js` (`providerStatus`, `entryByDiscord`, `cancelByDiscord`) | `/finals` in Discord |

### Operator (admin) features

| # | Feature | Where | Reached by |
|---|---|---|---|
| A1 | Admin login with one shared password, kept in the browser's `sessionStorage` and sent on every call; log out. **Replaced** in [96925b2]: admin is a session whose `/finals` link was made for a member of an `ADMIN_ROLE_IDS` role, fixed when the link is made; no password, no log out | `public/common.js` (`adminSession`), `src/app.js` (`requireAdmin`), `src/provider.js` | `/admin.html`, `/admin-teams.html`, `/admin-settings.html`, `/admin-seasons.html` |
| A2 | Create a season: name (≤ 60, pre-filled from the month, see [Event-specific content](#event-specific-content)), registration mode (`individual` or `teams`), format, qualifying and final arena (explicit or random; a random final arena never repeats the qualifying one) | `public/admin.js` (`suggestName`), `src/service.js` (`createSeason`), `src/arenas.js` | `/admin.html` "Start new season" (hidden while a season is open) |
| A3 | Change the format while registering; starts at once if the new size is already full; refused if more teams than the new capacity | `src/service.js` (`updateSeasonFormat`) | `/admin.html` "Change format" |
| A4 | Change the arenas: qualifying until the first result, final until the first final result | `src/service.js` (`updateSeasonArena`) | `/admin.html` "Arenas" |
| A5 | Start now (early start) with the largest size the registrations fill; individual mode leaves out the latest registrations, teams mode turns full batches of individuals into "Random Team N" | `src/service.js` (`startEarly`, `startIndividuals`, `startEarlyTeams`, `formTeams`) | `/admin.html` "Start now" |
| A6 | Individual registrations: list with registration time, rename, clear (until assigned to a team) | `public/admin.js` (`renderIndividuals`), `src/service.js` (`listIndividualRegistrations`, `adminUpdateIndividual`, `adminCancelIndividual`) | `/admin.html` "Individual registrations" |
| A7 | Live team swap: drag a player onto another to swap them between teams of the running season, until the first result or report | `public/admin.js` (`showLiveTeams`), `public/common.js` (`swapButtons`), `src/service.js` (`getLiveTeams`, `swapLivePlayers`) | `/admin.html` "Team players" |
| A8 | Submit a result: click teams in order on a pending card, confirm; always allowed, overrides differing team reports; each team's report is listed under the card | `public/admin.js` (`submit`, `voteText`), `src/service.js` (`submitResult`, `decide`, `getMatchReports`) | `/admin.html` |
| A9 | Set the lobby id of any pending match | `src/service.js` (`setLobbyId`) | `/admin.html` |
| A10 | Cancel a season still in registration (deleted with its teams and individuals). Since [f7b4a75] also a running season, and it is kept as `cancelled` (ladder and results hidden, no ranking changes) instead of deleted | `src/service.js` (`cancelSeason`) | `/admin.html` "Cancel season" |
| A11 | Delete a finished season with all its matches, reports, teams and individuals; ranking changes are not reverted (the dialog says so) | `src/service.js` (`deleteSeason`) | `/admin.html` "Delete season" |
| A12 | Debug: generate fake teams (from a built-in list of joke team and player names) to fill or start a season; add early-start votes | `src/service.js` (`debugFillRegistrations`, `debugAddVotes`, `DEBUG_TEAM_NAMES`, `DEBUG_PLAYER_NAMES`) | `/admin.html` "Debug" (hidden by a setting) |
| A13 | Player roster: add, rename, re-rank (0–100), delete; select all, clear, reset the selected to one ranking, save all edits at once | `public/admin-teams.js`, `src/service.js` (`listPlayers`, `addPlayer`, `updatePlayer`, `deletePlayer`) | `/admin-teams.html` "Players" |
| A14 | Team builder: select 9/12/18/24/27/36 players, generate teams of three with ranking sums as even as possible, re-roll, swap players by drag, name the teams, start the tournament (blocked while a season is open); those teams have no token, so only the admin reports their results | `public/admin-teams.js`, `src/teambuilder.js`, `src/service.js` (`generateDraft`, `getDraft`, `renameDraftTeam`, `swapDraftPlayers`, `clearDraft`, `startDraftSeason`) | `/admin-teams.html` "Teams" |
| A15 | Add selected roster players to the open registration as individuals (skips taken nicknames, stops when the season starts) | `src/service.js` (`addPlayersToRegistration`) | `/admin-teams.html` "Add selected to registration" |
| A16 | Ranking adjustment when a season finishes: one change per player, clamped 0–100; unknown nicknames join the roster at 50 first; debug names ignored | `src/rankings.js`, `src/service.js` (`applyRankings`, `playerDeltas`) | Automatic on the deciding final result |
| A17 | Settings: show ranking changes, show admin debug tools, allow public start, allow public start off-season | `public/admin-settings.js`, `src/service.js` (`getSettings`, `setSettings`) | `/admin-settings.html` |
| A18 | Health check (database probe, git short sha as version) | `src/app.js` | `GET /api/healthz` |
| A19 | Rename an open season ([9fd6e11]) | `src/service.js` (`renameSeason`) | `/admin.html` "Season name" |
| A20 | Fix player nicknames in a finished season, per team slot, saved as typed; the individual's row follows; rankings and trophies stay under the old name ([aec85f9], [9cec70e]) | `public/admin-seasons.js`, `src/service.js` (`renameSeasonPlayer`) | `/admin-seasons.html` "Edit past seasons" |
| A21 | Lock or unlock availability voting until the first result ([72ac1fb]) | `src/service.js` (`setAvailabilityLock`) | `/admin.html` |
| A22 | Host admin link when the bot is down: a 15-minute admin link signed with the app's secret ([96925b2]) | `scripts/admin-link.js` | `npm run admin-link` on the host |
| A23 | Individual-only server: no team-mode seasons, the mode picker hidden ([567c556], [fd16dd6]) | `src/app.js`, `public/admin.js` | `INDIVIDUAL_ONLY=1` |

### Tournament formats (the bracket engine)

All in `src/ladder.js`; one renderer per format in `public/format-*.js`. "Cashout" groups are four teams, "Quick Cash" groups three, the final is a head-to-head series where the first to two wins is champion (at most three games). `advance` is how many placements a result records.

| Format key | Teams | Rounds (`advance`) |
|---|---|---|
| `three` | 3 | Quick Cash (1) → HEAD2HEAD of the two losers (1) → final with the Quick Cash winner |
| `four` | 4 | Cashout (1; winner to the final) → Quick Cash series of the other three until one has 2 wins → final |
| `fourqc` | 4 | Cashout (1) → one Quick Cash of the other three (1) → final |
| `six` | 6 | Two opening Quick Cashes (1) → losers Cashout (2) → semifinal Cashout (2) → final |
| `eight` (default) | 8 | Two Cashouts (1) → the six losers reshuffled into two Quick Cashes, never an unchanged losers group (1) → semifinal Cashout (2) → final |
| `nine` | 9 | Three Quick Cashes (2) → Second Chance Quick Cash of the three last places (2) → eight advancers drawn into two Cashouts (2) → semifinal (2) → final |
| `twelve` | 12 | Three Cashouts (2) → six losers drawn into two Quick Cashes (1) → eight advancers drawn into two Cashouts (3: winner to the semifinal, 2nd and 3rd to the Second Chance) → Second Chance Cashout (2) → semifinal (2) → final |

Ranking deltas (`src/rankings.js`; champion / lost final / "semifinal tier" / everyone else): `three` +2/+1/–/−1; `four`, `fourqc`, `six`, `eight` and (by fallback) `nine` +3/+2/+1/−2; `twelve` +4/+3/+2/−2. The tier is the semifinal round's teams, in `four` the teams that won a series game, in `fourqc` the Quick Cash teams.

## Interfaces

### A. HTTP routes

48 routes in `src/app.js`, all JSON under `/api`, plus the static files of `public/` (served with `Cache-Control: no-cache`). Request bodies are JSON, at most 10 kB. Errors are `{error: "<message>"}` with the status from the service (`400` invalid input or bad JSON, `401` admin auth, `403` token or not your match, `404` not found, `409` state conflict, `500` "Internal error"). Path ids must be positive integers (`400 Invalid id`).

Auth kinds: **none**; **admin** = header `x-admin-password` equal to `ADMIN_PASSWORD` (SHA-256 then constant-time compare; `401 {error:"Admin authentication failed"}`); **team** = header `x-team-token` equal to the team's `edit_token`; **individual** = `x-team-token` equal to the individual's `token`; **member** = team token, or the token of any individual placed in that team. Tokens are 32 hex characters, returned once at registration.

**At the refresh** (`1a4fe2a495`): **62 routes**, the 48 below plus 9 more in `src/app.js` and 5 under `/api/provider` (`src/provider.js`). Auth changes:
- **admin** = a session cookie `tsession` whose payload says admin (`401 {error:"Open the admin link from Discord"}`); the password header grants nothing ([96925b2]).
- **individual** and **member** also accept a session whose Discord user owns the row: the server looks the token up itself ([1ff0a83]).
- **gate** = with `READ_GATE=1`, a session or the bot bearer, else `401 {error:"Sign in with the Discord link"}`; on the public reads, `GET /api/events`, the report read, `POST /api/public-start` and the two sign-up routes ([5a490fe]). Off by default.
- **bearer** = `Authorization: Bearer <PROVIDER_TOKEN>` (constant-time compare); every provider route, fail-closed when unset.
- Writes under `/api` without the bearer are limited to 30 a minute per client address (`429`, `Retry-After`); a body over 10 kB is `413` ([96925b2]).

**Public and player routes (18)**

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/events` | none | none | SSE stream (section C) |
| `GET /api/healthz` | none | none | `{status: ok\|down, version, uptimeSeconds, checks:[{name:"database", status}]}`; `503` when down |
| `GET /api/arenas` | none | none | Array of the 12 arena names |
| `GET /api/public-start` | none | none | `{eligible, name}` (`name` empty when not eligible) |
| `POST /api/public-start` | none | `{format, arenaOther?, arenaFinal?}` (a `name` is ignored) | `{id}`; `403` not available now (also while a season is open); `400` format or arena |
| `GET /api/seasons` | none | none | Array, newest first: `id`, `name`, `state` (`register`\|`active`\|`finished`), `format` (the seven keys above), `created_at`, `team_count`, `mode` (`teams`\|`individual`) |
| `GET /api/seasons/:id` | none | none | `{season` (all columns: `id`, `name`, `state`, `format`, `created_at`, `started_at`, `finished_at`, `arena_other`, `arena_final`, `mode`), `teams:[{id, name, players[3]}]`, `matches:[{id, round, slot, format` (`cashout`\|`quickcash`\|`final`), `status` (`pending`\|`done`), `teams[]`, `lobbyId` (pending only), `result` (team ids by place, done only), `reportedBy[]`, `disputed}]`, `rounds` (the format's round table), `capacity`, `champion` (team id or `null`), `individuals` (while registering `{count, votes, minVotes, earlyTeams}`, after `{count:0, leftOut:[names]}`), `rankingChanges` (`{nickname-lowercase: delta}` or `null`)`}`; `404`. Tokens are never included |
| `POST /api/seasons/:id/teams` | none | `{name, players:[3]}` | `{id, token}`; `409` closed, individual-only, name taken; may start the season |
| `PUT /api/seasons/:id/teams/:teamId` | team | `{name, players}` | `{ok}`; `403`; `409` closed or name taken |
| `DELETE /api/seasons/:id/teams/:teamId` | team | none | `{ok}`; `403`; `409` closed |
| `POST /api/seasons/:id/individuals` | none | `{name}` | `{id, token}`; `409` closed or nickname taken (also against team members); may start the season |
| `GET /api/seasons/:id/individuals/:iid` | individual | none | `{name, teamId, voted, leftOut}` |
| `PUT /api/seasons/:id/individuals/:iid` | individual | `{name}` | `{ok}`; `409` closed or taken |
| `DELETE /api/seasons/:id/individuals/:iid` | individual | none | `{ok}`; `409` closed |
| `POST /api/seasons/:id/individuals/:iid/vote` | individual | `{vote: boolean}` | `{ok, started}`; `409` not enough registrations |
| `POST /api/matches/:id/report` | member | `{teamId, order:[team ids by place]}` | `{ok, decided}`; `403` not in this match; `409` already decided; `400` wrong count, duplicate or foreign team |
| `GET /api/matches/:id/report/:teamId` | member | none | `{order}` (own report or `null`) |
| `PUT /api/matches/:id/lobby` | member | `{teamId, lobbyId}` (`^[A-Z0-9]{4}$` after upper-casing; empty clears) | `{ok, lobbyId}`; `409` decided |
| `POST /api/session` (new, [1ff0a83]) | none (the link token) | `{token}` | `{discord_user_id, discord_username, is_admin, expires_at}` and `Set-Cookie: tsession=…`; `401` link expired or invalid |
| `GET /api/session` (new) | session | none | the same shape; `401` not signed in |
| `GET /api/config` (new, [567c556]) | none | none | `{individualOnly}` |
| `GET /api/seasons/:id/me` (new, [1ff0a83]) | session | none | `{registration: {id, name, teamId} \| null}` |
| `GET /api/seasons/:id/availability` (new, [72ac1fb]) | gate | none | `{adminLocked, resultsStarted, open, noVotes[], days: [{date, count, names[], nok[]}]}`; `days` empty when closed |
| `PUT /api/seasons/:id/individuals/:iid/availability` (new) | individual | `{dates[]}` (unique, inside the window) | `{ok}`; `409` closed; `403` left out |

**Admin routes (30)**, all `admin` auth.

| Method and path | Request | Response |
|---|---|---|
| `GET /api/admin/check` | none | `{ok:true}` (the login probe) |
| `GET /api/admin/settings` | none | `{showRankingChanges, showAdminDebug, publicStart, publicStartOffSeason}` |
| `PUT /api/admin/settings` | any subset of the four booleans | the settings; `400` non-boolean or none known |
| `POST /api/admin/seasons` | `{name, format?` (default `eight`), `arenaOther?, arenaFinal?, mode?` (default `teams`)`}` | `{id}`; `409` a season is not finished |
| `POST /api/admin/seasons/:id/format` | `{format}` | `{ok}`; may start the season |
| `POST /api/admin/seasons/:id/arenas` | `{phase: qualifying\|final, arena}` (`random` allowed) | `{ok}`; `409` locked |
| `POST /api/admin/seasons/:id/start` | none | `{ok, format}`; `409` too few or already started |
| `POST /api/admin/seasons/:id/cancel` | none | `{ok}`; `409` not registering |
| `DELETE /api/admin/seasons/:id` | none | `{ok}`; `409` not finished |
| `POST /api/admin/seasons/:id/debug-fill` | `{count?}` (default: fill) | `{ok, added}` |
| `POST /api/admin/seasons/:id/debug-votes` | `{count?}` (default: up to 6) | `{ok, added, votes}` |
| `GET /api/admin/seasons/:id/individuals` | none | `{registrations:[{id, name, registeredAt, teamId}]}` |
| `PUT /api/admin/seasons/:id/individuals/:iid` | `{name}` | `{ok}`; `409` assigned or closed |
| `DELETE /api/admin/seasons/:id/individuals/:iid` | none | `{ok}`; `409` assigned or closed |
| `GET /api/admin/seasons/:id/reports` | none | `[{matchId, teamId, order}]` (pending reports only) |
| `POST /api/admin/matches/:id/result` | `{order}` | `{ok}`; `409` already submitted |
| `PUT /api/admin/matches/:id/lobby` | `{lobbyId}` | `{ok, lobbyId}` |
| `POST /api/admin/registration/players` | `{playerIds[]}` | `{added, skipped[], started}`; `409` no season registering |
| `GET /api/admin/players` | none | `[{id, name, ranking}]`, best first |
| `POST /api/admin/players` | `{name, ranking}` | `{id}`; `409` name exists |
| `PUT /api/admin/players/:id` | `{name, ranking}` | `{ok}` |
| `DELETE /api/admin/players/:id` | none | `{ok}` |
| `GET /api/admin/draft` | none | `{teams:[{id, name, players, sum}], format, seasonOpen}` |
| `POST /api/admin/draft` | `{playerIds[]}` (9, 12, 18, 24, 27 or 36, no duplicates) | `{ok, format}`; replaces the draft |
| `DELETE /api/admin/draft` | none | `{ok}` |
| `PUT /api/admin/draft/teams/:id` | `{name}` (≤ 24, empty clears) | `{ok}` |
| `POST /api/admin/draft/swap` | `{a:{team, slot}, b:{team, slot}}` (slot 0–2) | `{ok}`; recomputes the sums |
| `POST /api/admin/draft/start` | `{name, arenaOther?, arenaFinal?}` | `{id}`; `409` season open, no draft, unnamed or duplicate names |
| `GET /api/admin/live-teams` | none | `{season:{id, name}\|null, editable, teams:[{id, name, players, sum}]}` |
| `POST /api/admin/live-teams/swap` | `{a, b}` as above | `{ok}`; `409` no running season or locked |
| `PUT /api/admin/seasons/:id/name` (new, [9fd6e11]) | `{name}` (≤ 60) | `{ok}`; `409` not open |
| `PUT /api/admin/seasons/:id/players/:teamId` (new, [aec85f9]) | `{slot` (0–2)`, name}` | `{ok, from, to}`; `409` not finished or name used |
| `PUT /api/admin/seasons/:id/availability-lock` (new, [72ac1fb]) | `{locked: boolean}` | `{ok}`; `409` after results |

Changed admin routes: `POST /api/admin/seasons` defaults the mode to `individual` and refuses `teams` under `INDIVIDUAL_ONLY=1` ([567c556]); `POST /api/admin/seasons/:id/cancel` accepts `active` seasons and keeps the row as `cancelled` ([f7b4a75]); a season "open" for the one-season rule is now `register` or `active` (a `cancelled` one does not block).

**Provider routes (5, new in [1ff0a83])**, all `bearer`, under `/api/provider`, errors `{error: {code, message}}` with the codes `no_season`, `registration_closed`, `name_taken`, `not_registered`, `invalid_request`, `unauthorized`, `internal`:

| Method and path | Request | Response |
|---|---|---|
| `GET /status` | none | `{season: {id, name, state, mode, format, registered, capacity, champion} \| null}`: the newest open season, else the newest finished one; ids as strings; `capacity` in players for individual mode |
| `POST /seasons/:id/entries` | `{discord_user_id` (17–20 digits)`, name}` | `201 {id, created: true}`, or `200 {id, created: false}` when that user already has an entry; never the edit token; `409 registration_closed` for team mode |
| `GET /seasons/:id/entries/by-discord/:uid` | none | `{id, name, team_id}`; `404 not_registered` |
| `DELETE /seasons/:id/entries/by-discord/:uid` | none | `204`; `409 registration_closed` once placed in a team |
| `POST /links` | `{discord_user_id, discord_username, role_ids?}` | `{url: <PUBLIC_BASE_URL>/#d=<token>, expires_at}` (15 min); admin when a role id is in `ADMIN_ROLE_IDS` |

Of these, the bot uses `GET /api/seasons`, `GET /api/seasons/:id`, `GET /api/events` and `GET /api/healthz` (the read-only tourney contract described in the [canccuplatform inventory](canccuplatform.md#b-http-routes)). That contract lists five formats; `fourqc` and `three` were added afterwards (2026-11-03), so a consumer following it would not know them. At the refresh the contract lists all seven and the read gate; since [f7b4a75] the app also returns the state `cancelled`, which neither contract lists. The bot also uses the five provider routes.

### B. Discord commands and handlers

None. The repo has no Discord client, no webhook and no bot code. A commented-out hint on the registration form asks players to use their Discord names; nothing reads them.

### C. WebSocket, SSE and streams

- `GET /api/events`: Server-Sent Events. On connect the server writes the comment `: connected`; after every non-GET request under `/api` that ends with a status below 400 it writes `data: update` to every client. No event id, no payload, no replay, no keep-alive comment, no auth. Clients re-read what they show. Since [5313b2d] a `: ping` comment every 30 s, and `POST /api/session` and `POST /api/provider/links` no longer trigger `update`; since [5a490fe] behind the read gate when it is on.
- Consumers: `public/app.js` and `public/admin.js` (each also polls every 5 s), and the bot's finals watcher (other repo).
- No WebSocket.

### D. Messages and events

There is no bus. The only message is the SSE `update` above. Browser-side state: `localStorage` `myTeams` (per season, the team ids and tokens this browser registered) and `myIndividuals` (per season, the individual id, token and name); `sessionStorage` `adminPw` (the admin password in clear). At the refresh `adminPw` is gone; the `tsession` cookie (HttpOnly, 7 days, a signed payload with the Discord id, name and admin flag) carries sign-in ([1ff0a83], [96925b2]).

### E. Scheduled and background jobs

| Job | Cadence | Runs in | Source |
|---|---|---|---|
| Schema creation and upgrades | each start | server | `src/db.js` (`openDb`) |
| Page refresh: public page and admin page reload seasons (skipped while a dialog, a pick or a select is active) | 5 s plus each SSE `update` | browser | `public/app.js`, `public/admin.js` |
| Champions page reload (fetches every finished season) | 10 s | browser | `public/champions.js` |
| Connector redraw | on render and window resize | browser | `public/common.js` |
| Next round, season finish, ranking adjustment | on the deciding result, inside its transaction | server | `src/service.js` (`decide`) |

Nothing runs on a timer on the server. Since [5313b2d] each open SSE connection gets a `: ping` every 30 s.

## Data

One SQLite file (`DB_FILE`). Schema and upgrades live in `src/db.js` as `CREATE TABLE IF NOT EXISTS` plus checks of `PRAGMA table_info` that add missing columns, and one table rebuild of `seasons` (copy, drop, rename, with foreign keys switched off) when its `format` check lacks `three`. Timestamps are SQLite `CURRENT_TIMESTAMP` text in UTC without a zone. "Scope" says whether the data belongs to one event, is global, or belongs to a venue.

| Table | Columns or keys | Scope | Retention |
|---|---|---|---|
| `seasons` | `id`, `name` (≤ 60), `state` (`register`\|`active`\|`finished`; `cancelled` since [f7b4a75]), `format` (7 keys, default `eight`), `created_at`, `started_at`, `finished_at`, `arena_other`, `arena_final`, `mode` (`teams`\|`individual`, default `teams`), `availability_locked` (0/1, since [72ac1fb]) | per event (a season is one tournament at one event) | Until an admin cancels it (registering) or deletes it (finished); a running season cannot be removed. Since [f7b4a75] a cancel keeps the row as `cancelled`, so seasons are deleted only when finished |
| `teams` | `id`, `season_id`, `name` (case-insensitive, unique per season), `p1`, `p2`, `p3` (nicknames), `edit_token` (clear text; `NULL` for builder, random and individual-formed teams) | per event | With its season |
| `matches` | `id`, `season_id`, `round`, `slot`, `format` (`cashout`\|`quickcash`\|`final`), `status` (`pending`\|`done`), `lobby_id` | per event | With its season |
| `match_teams` | `match_id`, `team_id` (key), `placement` (1..n for the recorded places, else `NULL`) | per event | With its season |
| `match_reports` | `match_id`, `team_id` (key), `order_json` | per event | Deleted when the match is decided |
| `individuals` | `id`, `season_id`, `name` (unique per season, case-insensitive), `token` (clear text), `team_id`, `registered_at`, `vote` (0/1), `discord_user_id` (since [1ff0a83]; unique per season through the index `individuals_season_discord`, `NULL` for sign-ups without a session) | per event; the Discord id is **personal data** keyed to a global user | With its season |
| `availability_votes` (new, [72ac1fb]) | `individual_id`, `day` (`YYYY-MM-DD`), key both | per event; **personal data** shown by name to every viewer | Cleared at the first report or result, at a cancel, for left-out players at the draw, with the individual and with its season |
| `players` | `id`, `name` (unique, case-insensitive, ≤ 18), `ranking` (0–100) | **global** (one roster across all seasons; identity is the nickname) | Permanent until deleted |
| `draft_teams` | `id`, `name`, `p1`, `p2`, `p3`, `ranking_sum` | global (one draft for the whole app) | Until discarded, replaced or started |
| `settings` | single row `id = 1`: `show_ranking_changes` (default 1), `show_admin_debug` (1), `public_start` (1), `public_start_offseason` (0) | global | Permanent |

At the refresh the upgrade code also adds `availability_locked`, `discord_user_id`, its unique index and `availability_votes`, and rebuilds `seasons` when its state check lacks `cancelled`, now keeping the autoincrement counter across the rebuild ([f7b4a75]).

Singletons that matter for tenancy: **one non-finished season at a time** (since [f7b4a75] one season in `register` or `active`) for the whole app (every create path checks it), one draft, one settings row, one roster. Champions and trophy counts are derived from all finished seasons. Nothing in this repo belongs to a venue: no hosts, rooms, devices or addresses. Foreign keys are declared but not enforced at run time (see [Known problems](#known-problems) 2). There is no backup, export or archive.

## Configuration

Secret values are never in the repo and none are copied here.

### Environment

| Name | Default | Meaning |
|---|---|---|
| `ADMIN_PASSWORD` | none; the server exits with a message when unset | The one shared admin password (secret). **Removed** in [96925b2] |
| `PORT` | `3000` | HTTP port (all interfaces) |
| `DB_FILE` | `tourney.db` (relative to the working directory) | SQLite file |
| `PROVIDER_TOKEN` (new, [1ff0a83]) | unset: every provider route answers `401` | Bearer the bot sends (secret); also passes the read gate and skips the write limit |
| `LINK_SECRET` (new) | unset: links, sessions and admin fail | HMAC key for link tokens and session cookies (secret); rotating it signs everyone out |
| `PUBLIC_BASE_URL` (new) | unset: links fail | Origin of the page links; `https:` marks the cookie `Secure` |
| `ADMIN_ROLE_IDS` (new, [96925b2]) | empty | Comma-separated Discord role ids whose holders get admin links |
| `READ_GATE` (new, [5a490fe]) | off | `1` = public reads, SSE and public writes need a session or the bearer |
| `INDIVIDUAL_ONLY` (new, [567c556]) | off | `1` = no team-mode seasons |
| `TRUST_PROXY` (new, [96925b2]) | unset | Express `trust proxy` value, so the write limit sees client addresses behind a proxy |

### Settings (database, `/admin-settings.html`)

| Key (API / column) | Default | Meaning |
|---|---|---|
| `showRankingChanges` / `show_ranking_changes` | on | Show the per-player ranking change in finished seasons (the change is applied either way) |
| `showAdminDebug` / `show_admin_debug` | on | Show the debug block on the admin page (the routes stay open either way) |
| `publicStart` / `public_start` | on | Let anyone start a season in the two month windows |
| `publicStartOffSeason` / `public_start_offseason` | off | Also outside the windows, named "Off-season #N" |

### Constants in code

`MIN_VOTES` 6; at the refresh also link 15 min and session 7 days ([1ff0a83]), write limit 30 a minute per address ([96925b2]), SSE ping 30 s ([5313b2d]), availability window 21 days in one hard-coded time zone (`AVAILABILITY_DAYS`, [72ac1fb], see [Event-specific content](#event-specific-content)); season name ≤ 60, team name ≤ 24, nickname ≤ 18; lobby id 4 of `A–Z0–9`; ranking 0–100, new players 50; team builder 20 random attempts; draft and builder sizes 9/12/18/24/27/36 players; `CAPACITY` per format; JSON body limit 10 kB; refresh 5 s (pages), 10 s (champions); toasts 3 s, 5 s (error), 8 s (with a link); `TEAMS_PER_SEASON` 8 (unused). The 12 arena names are a constant in `src/arenas.js`. The two month windows and the season-name words are in [Event-specific content](#event-specific-content). Page query: `?season=<id>`. `.pi/settings.json` configures an AI coding tool (`defaultTools`) and is not read by the app.

## External integrations

| Integration | Used for | Needs |
|---|---|---|
| Node.js, npm | Runtime and install | Node ≥ 22.22.1 per the README (no `engines` field); `npm install` |
| `express` ^5.2.1 | HTTP, JSON, static files | — |
| `sqlite3` ^6.0.1 | Storage | A native module (prebuilt binary or a build toolchain on the host) |
| `git` | `version` in health (`git rev-parse --short HEAD`), falling back to `package.json` `version` (`1.0.0`) | `git` and the checkout on the host |
| systemd | README example unit for a cloud VM (`Restart=always`, password in the unit's `Environment=`; at the refresh `LINK_SECRET` and `PUBLIC_BASE_URL` there instead, while the README's bot section says to keep secrets in the service's environment) | Manual setup; the live host's units are in the canccuplatform repo |
| Browser features | `EventSource`, `localStorage`, `sessionStorage`, drag and drop, SVG | A modern browser |
| Fonts | System UI fonts, a narrow display font if installed | None bundled |
| The bot (other repo) | Reads seasons and SSE for the finals cards | Network reach to the app; no auth. Since [1ff0a83] also the provider API for `/finals` (sign-up, withdraw, links), with the bearer on every call |
| Discord (through the bot, new) | Identity and admin rights: the bot puts the user id, name and role ids into the link request; the app never calls Discord | `PROVIDER_TOKEN`, `LINK_SECRET`, `ADMIN_ROLE_IDS` |
| `finals-core` (new, [1a3cc3a], [8b6758d]) | Ladder, rankings, team builder | A git dependency pinned to tag `v1.0.1`; see [the shared core](#the-shared-core-glyzerfinals-core) |
| GitHub Actions (new, [292ac9a], [83a8ecb], [7a2b4ff]) | `test` on PRs and pushes; a daily finals-core bump PR; deploy on every push to `main` | A bump token (a fine-grained PAT) and, for the deploy, an OAuth client of the private network, a deploy key and the pinned host key, all as repo secrets |

Discord, feeds, devices, third-party APIs, uploads and media: none. The only images are emoji characters. (At the refresh Discord is reached only through the bot, above.)

## Tests

`npm test` runs `node --test test/*.test.js`: 61 tests (10 in `test/ladder.test.js`, 51 in `test/api.test.js`). Run for this inventory in a scratch copy at the read commit with Node 22.23.4: 61 passed, 0 failed, 5.4 s.

**At the refresh** (`1a4fe2a495`, Node 22.23.4, after `npm ci`): **99 passed, 0 failed, 7.0 s**, in five files. `test/ladder.test.js` moved to finals-core ([1a3cc3a]); `test/api.test.js` has 62 (the password test became "admin routes require an admin session", the cancel test became two, plus availability, rename, nickname edit, `INDIVIDUAL_ONLY` and SSE ping tests); four files are new:

| File | Tests | Covers |
|---|---|---|
| `test/provider.test.js` ([1ff0a83], [96925b2], [5a490fe]) | 26 | Bearer on every provider route and fail-closed config; status per mode and state; idempotent sign-up without the token; the error codes; team read at query time; cancel only in `register`; links (base URL, 15 min, validation); the session swap (7 days, tamper-proof, `Secure` only on https); page sign-up stores the Discord id; read gate on and off for reads and public writes; the `discord_user_id` migration; admin by role ids; the password header grants nothing; the host admin link and its script; a session player without a local token (status, rename, vote, cancel, report); the write limit; the 10 kB limit; one open season |
| `test/availability-ui.test.js` ([72ac1fb], [1a4fe2a]) | 5 | The voting strip in a fake DOM: weekday, checkbox, count and voter details; the five-day highlight; week shading; batched saves; a failed save kept and retried |
| `test/prefill.test.js` ([0bfe3f8], [cc052aa]) | 5 | The nickname prefill from the session: 18-character cap, empty for the host link, never over typed text |
| `test/admin-seasons.test.js` ([9cec70e]) | 1 | The past-seasons editor keeps the chosen season after a save |

These are the first frontend tests (P14, the prefill and the past-seasons editor); the bracket renderers still have none.

| File | Covers |
|---|---|
| `test/ladder.test.js` | Pure engine: the 8-team opening draw (two unique groups of 4, wrong count throws); `validateResult` (count, duplicates, membership); full flows to a champion for `eight`, `four`, `fourqc`, `three`, `six`, `nine`, `twelve`, with series lengths and who meets whom; `twelve` round 3 needs three places |
| `test/api.test.js` | Through HTTP on an in-memory database with a fixed password: admin auth (`401` without or with a wrong password); individual registrations admin view/edit/clear while open; arena choice (explicit, random, invalid) and edit windows; debug fill with long names; validation and auto-start at capacity; name limits; full seasons to a champion for every format; foreign team in a result; early start for each size and format switching; format change during registration only and auto-start on change; the `seasons` table rebuild keeps old rows (a hand-made old database file); cancel and owner edit/cancel windows; debug fill and debug votes; team reports, matching reports decide, admin overrides a dispute, reports listed for the admin; lobby id set, hidden, inherited in a final series and a quick cash series; player validation and duplicates; team builder (invalid sizes, balance, start, no team reporting, live team swap and lock); ranking deltas for `eight`, `four`, `twelve`, `three`, `fourqc`, clamping, unknown players at 50, debug names ignored; settings toggles; public start (windows mocked by date, name ignores the request, off-season); individuals (validation, hidden names, edit/cancel, full teams first, left out, members report, voting, individual-only balanced "Team N", latest left out, admin early start, roster players added to registration); health shape |

Gaps that matter for the port:

- **No frontend tests** (at the first read; three small ones at the refresh, above). 2362 lines of browser script (bracket rendering, connector routing per format, the result picker, the modal, hover tracing, refresh races) are untested; the commit history shows most changes and fixes landed there.
- **Untested routes:** `GET /api/events` (SSE), `GET /api/admin/check`, `DELETE /api/admin/seasons/:id` (delete a finished season), `POST /api/admin/draft/swap`.
- **No concurrency test** for the one-open-season rule, double registration, or two reports arriving together; the in-process queue is the only guard.
- **No test of an individual-only `fourqc` season filling up**, which is where bug 1 below lives; the `fourqc` tests use teams mode.
- **No test with a deterministic random source in the `eight` round 2 reshuffle** (bug 5).
- **No tests of `teambuilder.js` and `rankings.js` on their own**; both are covered only through the API. At the refresh finals-core has 6 and 4 of their own.
- At the refresh: no test of a link or session after `LINK_SECRET` rotation, or of `TRUST_PROXY` behind a real proxy; `GET /api/events` is now tested only for its ping.

## Known problems

Each item says where it stands at the refresh (`1a4fe2a495`). In short: the shared password (7) is gone, three are eased (6, 8, 9), and the rest still hold, the two bugs included; six new ones follow (14–19).

From the code, the README and the commit history. The history has 37 commits with "fix" in the subject; they touched browser files 70 times and server files 3 times (mostly layout, connector and refresh-race fixes); no incident is recorded.

1. **Bug: a full individual-only `fourqc` season becomes `four`.** `startIndividuals` and `startEarlyTeams` pick the format as the first key whose capacity matches the team count, and `four` comes before `fourqc`, so the season is drawn and saved as `four` (a Quick Cash series instead of one Quick Cash). Public starts are always individual-only, so a public `fourqc` start hits it. Reproduced on the read commit. The team builder has the same mapping (12 players → `four`), so it can never build a `fourqc` season. **At the refresh: still there.** The service's start paths still take the first matching key, and `CAPACITY` in finals-core v1.0.1 keeps the same order; no test covers it. `INDIVIDUAL_ONLY=1` makes every season individual, so every `fourqc` season that fills hits it.
2. **Bug: foreign keys are not enforced.** SQLite starts with foreign keys off; `openDb` turns them on only in the `finally` of the one-off `seasons` rebuild, so on a normal start they stay off (confirmed: `PRAGMA foreign_keys` is 0). Deletes keep integrity only by their hand-written order. **At the refresh: still there.** The rebuild added in [f7b4a75] runs once on an old database, so foreign keys are on for that one start only.
3. **Results cannot be corrected.** A decided match is final; the next round is already built from it. The README's former TODO list asked for "change results afterwards"; it was never built. Deleting a finished season does not revert its ranking changes. **At the refresh: still there.** Only names in finished seasons can be fixed ([aec85f9]); a cancelled running season ([f7b4a75]) is the only way out of a wrong result.
4. **Transactions are an in-process promise queue over one shared connection.** Writes outside `transaction()` (player add, edit and delete, draft rename and clear, settings) and every read can run while another request's transaction is open; they then see, or become part of, its uncommitted work. `addPlayersToRegistration` and `debugFillRegistrations` loop over separate transactions. Only one process may run. **At the refresh: still there**; the new availability, rename and provider writes use the same queue.
5. **Fragile: the `eight` round 2 reshuffle** loops until no group equals a round 1 losers group; with real randomness it ends quickly, but nothing bounds it. **At the refresh: still there**, now in finals-core's `nextRound`.
6. **Identity is a nickname string.** Rankings, the roster and trophy counts are matched by nickname (case-insensitive). A rename starts a new player; two people with one nickname share a ranking; a real player whose nickname is on the debug list never gets ranking changes; if one nickname plays in two teams it takes the better change. **At the refresh: eased, not solved.** Individuals carry the Discord user ([1ff0a83]), but rankings, the roster and trophies are still keyed by nickname; a nickname fixed in one finished season splits a champion's trophies in two (the README says so).
7. **Weak admin auth.** One shared password for everything, sent in a header on every call and kept in clear in `sessionStorage`; no rate limit, no lockout, no audit of admin actions; the debug routes stay reachable when hidden. `ADMIN_PASSWORD` is put in the systemd unit itself in the README example. **At the refresh: replaced** ([96925b2]): no password; admin comes from Discord roles through a signed link, and writes are rate-limited. What remains: admin is fixed when the link is made and lasts the 7-day session, the only revocation is rotating `LINK_SECRET` (everyone signed out), there is still no audit of admin actions, and the debug routes stay open to admins.
8. **Player rights live in one browser.** Team and individual tokens are stored only in `localStorage`; another device or a cleared browser loses them (the admin must then report). Tokens are stored in clear in the database. **At the refresh: eased for individuals** ([1ff0a83]): a Discord session finds their row and acts for them on any device. Teams registered as teams still depend on the browser's token, and tokens are still stored in clear.
9. **Public start is open to anyone and on by default** in the two windows, and there is only one open season app-wide, so anyone can take the slot until an admin cancels it. Its windows use the server's local month, the admin's name suggestion uses the browser's. **At the refresh: eased** when `READ_GATE=1` ([5a490fe]): only someone with a Discord session can start one. The setting is still on by default and the windows unchanged.
10. **Server-sent updates are untargeted:** every write (admin included) wakes every client, which then refetches; pages also poll every 5 s; the champions page fetches every finished season every 10 s. Fine for one LAN party, not for many tenants. **At the refresh: still there**, plus a 30 s ping per connection ([5313b2d]); two non-data POSTs no longer wake clients.
11. **Schema upgrades in code:** column checks and a destructive table rebuild run on every start, with no version table and no down path. **At the refresh: still there**, with one more destructive `seasons` rebuild ([f7b4a75]).
12. **Small issues:** the champions page has two elements with the same id; the lobby id inheritance is computed in two places (`createRound`, `loadMatches`); the debug team list has duplicates (deduplicated at use); `TEAMS_PER_SEASON` is unused; `nine` has no entry in the ranking table and falls back to `eight` (same values, by accident or design); health needs `git` on the host. **At the refresh: still there**; `TEAMS_PER_SEASON` is now a public export of finals-core.
13. **Code markers:** no `TODO` or `FIXME`; four `shortcut:` comments name known limits (static-file caching by size and time, settings read once per login, champion ties broken alphabetically, shared connector segments not traced on hover). At the refresh still no `TODO` or `FIXME`; one more `shortcut:` (a nickname fix does not move the roster ranking).
14. **Names on show** ([72ac1fb], [1a4fe2a]): availability shows, to every viewer of the season, who can and cannot come on which day and who has not answered. The day window follows one hard-coded time zone (see [Event-specific content](#event-specific-content)).
15. **The page gate is cosmetic** ([c5a358d]): with `READ_GATE` off (the default) the pages hide everything without a session, but the API answers anyone; with it on, the API does too. Only the second is access control.
16. **A state the contracts do not know** ([f7b4a75]): `cancelled` is returned by `/api/seasons` but is not in the canccuplatform tourney contract; the provider's `status` skips cancelled seasons.
17. **Links are bearer tokens for 15 minutes:** a `/finals` link is reusable until it expires, so whoever gets a copy signs in as that player, or as an admin if the link was an admin's. The contract allows the reuse.
18. **Every merge is a production deploy** ([7a2b4ff]): guarded only by a green `test` and the people with merge rights; the repo has no branch protection.
19. **Attribution of the extracted core:** finals-core's licence names "finals-core contributors", and nothing in it names this repo or its author (see [the shared core](#the-shared-core-glyzerfinals-core)); 0025 asks that the core keep its author's attribution.

## Port recommendation

Target module `games` ([Games](../roadmap.md#games) track, epic #66) unless said otherwise. At the refresh: [0025](../decisions/0025-finals-and-games-modules.md) moved all of this to the `finals` module and the Finals track, with the pure core taken as a pinned dependency; read `games` below as `finals`. Everything waited for the author's OK, given on 2026-11-07; licence and attribution are kept ([Porting plan](../roadmap.md#porting-plan): bracket engine, rankings and team builder ported; service layer on Postgres transactions; storage, API, auth and frontend rewritten; shared admin password dropped).

| Feature | Verdict | Reason | Target module | Roadmap step |
|---|---|---|---|---|
| Bracket engine: formats, draws, `nextRound`, `validateResult`, `champion` (`src/ladder.js`; since [1a3cc3a] `finals-core/ladder`) | port as-is (at the refresh: take `finals-core` as a pinned dependency, 0025; bugs 1 and 5 are still in it, so they are fixed there) | Pure, small, tested per format; becomes "rounds as data" by turning the round tables into data; fix bug 1's format lookup and bound the reshuffle (5) while porting; drop `TEAMS_PER_SEASON` | games | Games track |
| Rankings (`src/rankings.js`; since [1a3cc3a] `finals-core/rankings`) | port with changes | Keep the delta tables and clamp; key players by user id instead of nickname (6); make the tables data per format | games | Games track |
| Team builder (`src/teambuilder.js`; since [1a3cc3a] `finals-core/teambuilder`) | port as-is | Pure balancing with a seeded random source; reused by individual-only start | games | Games track |
| Service rules (registration, early start and votes, reports, lobby id, arena locks, cancel and delete, live swap) | port with changes | Keep the rules and their tests; run each operation in one Postgres transaction with row locks; replace token checks with signed-in users; one open season per tenant (or per tenant and game, see [Tenancy questions](#tenancy-questions)) | games | Games track |
| Result reporting by two matching team reports, admin override | port with changes | Reporter is a signed-in team member; keep reports private to the admin | games | Games track |
| Result correction | rewrite (new) | Missing today (3); needs a rule for rounds already built from the result | games | Games track |
| Public start | port with changes | A per-tenant setting for signed-in users, not month windows; the name comes from the event, not a hard-coded word | games, admin | Games track |
| Debug fill and votes | port with changes | Keep for the demo tenant and tests only, behind superadmin or a dev flag | games | Games track |
| Arena list | port with changes | Becomes data of the game in the games list ("the list of games people play"), not a constant | games | Games track |
| Player roster | port with changes | Built on global users, not a nickname table; ranking scope is a tenancy question | games | Games track |
| Settings table | rewrite | Per-tenant module settings through admin ([0013](../decisions/0013-multi-tenant-core.md) item 18) | games, admin | Games track, 2b |
| Storage (`src/db.js`, SQLite, in-code upgrades) | rewrite | Postgres with tenant columns, RLS and versioned additive migrations | games, kit | Games track |
| HTTP API (`src/app.js`) | rewrite | A tenant-aware contract written first ([0008](../decisions/0008-contract-first.md)); keep the route set as the starting list | games, contracts | Games track |
| SSE `update` | rewrite | Bus events with payloads, so Screen, Moments and the bot react without polling; the read API stays for pages | games, screen, moments | Games track, 9 |
| Admin password auth (already gone upstream, [96925b2]) | drop | Discord sign-in through the central sign-in host and roles ([0013](../decisions/0013-multi-tenant-core.md) items 3, 10) | admin | 2b |
| Team and individual tokens | drop | Signed-in users replace them | — | 2b |
| Health endpoint | drop | The kit's health route | kit | 1 (done) |
| Public pages: season list, bracket, registration, reporting, lobby id, hover tracing | rewrite | New frontend on the theme tokens; keep the per-format layouts and connector routing as the visual spec | games, ui | Games track |
| Admin pages, team builder page, settings page | rewrite | Inside the admin module's UI | games, admin | Games track, 8 |
| Champions page and trophy ranking | port with changes | Read from finished seasons; scope (per tenant or across an organizer's events) is a tenancy question | games | Games track |
| Bracket on the big screen and finals cards | port with changes | Screen widgets fed by games events, ranked by Moments | screen, moments | 9 |
| README systemd and cloud VM example, `.pi/settings.json` | drop | Containers on the platform VM ([0011](../decisions/0011-hosting-on-remote-vm.md)); agent tool config is not product | — | — |
| Provider API for `/finals` (`src/provider.js` router; [1ff0a83]) **(new at the refresh)** | port with changes | The contract is the shared interface for `/finals` (0025, [contracts/finals.md](../../contracts/finals.md)): the module serves the same shapes at `/api/finals` with no bearer (the bot calls it inside the stack), the event from the hostname | finals, bot | Finals track, 6 |
| Discord link token and session cookie, host admin link, `ADMIN_ROLE_IDS` ([1ff0a83], [96925b2]) **(new at the refresh)** | drop | The platform's Discord sign-in and role-to-rights sync replace them; the provider's `links` returns a hub URL there | — | 2b (done) |
| Read gate and the page's sign-in wall ([5a490fe], [c5a358d]) **(new at the refresh)** | drop | Access follows the tenant's join and info-page rules on the platform | — | — |
| Write rate limit, body limit ([96925b2]) **(new at the refresh)** | rewrite | The stack's limits, not a per-module map | kit | 10 |
| `INDIVIDUAL_ONLY` ([567c556]) **(new at the refresh)** | port with changes | A per-tenant setting of the module, not an env var | finals, admin | Finals track |
| Availability voting ([72ac1fb], [1a4fe2a]) **(new at the refresh)** | port with changes | Picking a day with the players is useful off-LAN; the names on show and the fixed time zone change: the event's zone, and a decision on who sees whose answers (problem 14) | finals | Finals track |
| Cancel and rename a running season, `cancelled` kept in history ([f7b4a75], [9fd6e11]) **(new at the refresh)** | port with changes | Good rules; `cancelled` becomes a contract state | finals | Finals track |
| Nickname fixes in finished seasons, `/admin-seasons.html` ([aec85f9]) **(new at the refresh)** | rewrite | With players keyed by id the name is the user's; what remains is the correction with an audit (problem 3) | finals | Finals track |
| SSE keepalive ([5313b2d]) **(new at the refresh)** | drop | Bus events replace the stream | — | — |
| CI, finals-core bump PRs, deploy on merge ([292ac9a], [83a8ecb], [7a2b4ff]) **(new at the refresh)** | drop | The platform's CI, dependency updates and auto-deploy; the bump-PR idea matches the deliberate upgrades of 0025 | — | — |

## Tenancy questions

What this repo implies for the tenancy design (#48). Each is a question for the tenants contract or the games contract; none is decided here.

**Per tenant (event)**

1. The app allows one non-finished season in total. On the platform, is it one open season per tenant, or per tenant and game (several games at one event at once)?
2. The season-name words and the two month windows encode an organizer's two yearly events. With one tenant per event, the name should come from the event and the windows go. Confirm "public start" becomes a per-tenant setting with no calendar logic.
3. Settings (`show_ranking_changes`, `show_admin_debug`, `public_start`) are app-wide today. Confirm they become per-tenant module settings ([0013](../decisions/0013-multi-tenant-core.md) item 18), and that debug tools are not a tenant setting at all.
4. The draft (team builder) is one global table. Is it per tenant, per admin, or a transient state that never needs storing?

**Global or across tenants**

5. The player roster and rankings span every season ever played, keyed by nickname. Users are global ([0013](../decisions/0013-multi-tenant-core.md) item 30). Is a ranking global per user and game, per tenant, or per organizer across its events? The same for the champions page and trophy counts: one event's history, or an organizer's?
6. If rankings are global, a tenant admin who edits a ranking changes it for every event; who may edit, the superadmin only?
7. The arena list is game data, not event data. Confirm it lives in a global games catalog the superadmin maintains, with tenants choosing from it.
8. A ranking change from a finished season writes to shared data. If a tenant is deleted (GDPR, item 31), are its effects on global rankings kept, recomputed or removed?

**Per venue**

9. Nothing in this repo is per venue. The legacy deployment ran it on a venue machine on the LAN with plain HTTP (see the canccuplatform inventory); on the remote VM that ends. Confirm no venue setting is needed for games. (At the refresh the live instance already left the venue for a public cloud host, [canccuplatform inventory](canccuplatform.md#refresh-2026-11-20).)

**Identity and rights**

10. Rights come from browser tokens today: any member of a team may report and set the lobby id. With sign-in, is a team member a global user linked to the tenant, and may a player without a Discord account still play (an admin-entered nickname, like the team builder's teams)?
11. Who may start, cancel, delete a season or swap live players: the tenant's event admins only, or also a "games operator" role?

**Raised by the refresh**

12. Availability voting picks days in one hard-coded time zone and shows everyone's answers by name ([72ac1fb]). On the platform: the event's time zone, and who may see whose answers (the season's viewers, its players, or the admins only)?
13. A season now runs between events, off the LAN, and 0025 keeps that standalone app apart from the platform with no data sync. Is a platform `finals` season always inside one event (tenant), or can a tenant hold seasons that run between its events?

## Event-specific content

Named by kind and counted only; no value appears in this file. The exact values and their locations are listed in the PR, for a follow-up issue in the event repo.

| Kind | Distinct values | Lines | Files |
|---|---|---|---|
| Names of the organizer's two seasonal events, used for the season-name suggestion and the public-start name | 2 | 5 | 4 |
| The two month windows tied to those events (public start and name suggestion) | 2 | 5 | 4 |
| Organizer name in the page header ("… presents:") | 1 | 5 (6 at the refresh, [aec85f9]) | 5 (6) |
| Event locale (a date locale tag and a local-language word stripped from dates) | 2 | 2 | 2 |
| Event time zone (an IANA zone, and the country named beside it in the README), new at the refresh ([72ac1fb]) | 1 | 5 | 3 |
| A private-network host name with the network's name, in the deploy workflow, new at the refresh ([7a2b4ff]) | 1 | 1 | 1 |
| A platform maintainer's account (repo slugs of finals-core and canccuplatform, and a sample name in a test), new at the refresh | 1 | 24 | 6 |
| The upstream author's account (in repository URLs) | 1 | 3 | 1 |
| Personal name and e-mail of the author, maintainer account | 3 | git metadata only, not in files | — |
| Discord ids, venue names, IP addresses, venue hostnames | 0 | — | — |

The game's own content (its title, the 12 arena names, the match type names) and the fictional debug team and player names are not event-specific. Menus, photos and other media: none in this repo.

[1ff0a83]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/1ff0a83
[96925b2]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/96925b2
[567c556]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/567c556
[0bfe3f8]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/0bfe3f8
[1a3cc3a]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/1a3cc3a
[cc052aa]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/cc052aa
[5313b2d]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/5313b2d
[5a490fe]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/5a490fe
[5d08e50]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/5d08e50
[c5a358d]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/c5a358d
[292ac9a]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/292ac9a
[83a8ecb]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/83a8ecb
[8b6758d]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/8b6758d
[7a2b4ff]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/7a2b4ff
[af42654]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/af42654
[f1805fb]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/f1805fb
[4f48816]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/4f48816
[bbe9364]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/bbe9364
[0237491]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/0237491
[22e2253]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/22e2253
[d7e367a]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/d7e367a
[c8dcea0]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/c8dcea0
[f7b4a75]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/f7b4a75
[fd16dd6]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/fd16dd6
[9fd6e11]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/9fd6e11
[aec85f9]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/aec85f9
[9cec70e]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/9cec70e
[55ca01e]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/55ca01e
[72ac1fb]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/72ac1fb
[1a4fe2a]: https://github.com/c22dragoon/thefinals_mini_tourney/commit/1a4fe2a
