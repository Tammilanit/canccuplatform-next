# Finals track brief (research pack)

The research pack for the product owner's brainstorming session on the [Finals track](../roadmap.md#finals) (epic #161), issue #172. It follows the [outline of a research pack](README.md#outline-of-a-research-pack) and its mockup rules, and is built like [step 7's pack](step-7-tournament.md), the nearest relative. After this merges, the lead runs the session over as many rounds as it takes, writes the final plan into this brief (`## Plan`) and writes the track's issues; the product owner accepts the plan before any build starts.

**In this pack**
- This file: goal, what was read, what the platform already has, how others solve it, the legacy in one paragraph, three directions and the recommended one, the key flows, port / drop / invent, what the stub and the built contracts need, proposed issues and exit criteria, roadmap notes.
- [track-finals/questions.md](track-finals/questions.md): the question bank, 74 questions in six themes, each with options and a recommendation. IDs (U3, D6, …) are used throughout.
- [track-finals/](track-finals/): 17 SVG mockups, drawn new, with the demo event only. Organiser pages are drawn in the organiser shell with `packages/ui`'s default tokens and its Event menu (Finals marked new), each also at phone width; attendee pages in the hub's frame with the demo theme's "Demo night" colours; the venue screen in the screen look. Each sheet states its use case. Every text that sits in a box carries `data-box` (its box's left and right edge), and a headless Chromium check found no text outside its box (see [Every mockup](#every-mockup)).

## Goal
The Finals mini tourney runs on the platform for an event: players and teams register, the bracket runs, and champions are crowned ([roadmap](../roadmap.md#finals)). In it: the `finals` module (seasons, registration of teams and individuals on the hub and by Discord through the bot's `/finals`, brackets, rankings, champions and the team builder), result reporting and correction, the full `finals` contract replacing the provisional provider stub, and the finals cards on the screen. It builds on the shared tourney core, a public library the standalone off-LAN app also uses, taken as a pinned dependency; storage, API, sign-in and the frontend are built new on the kit. Exit: a season runs end to end on the demo tenant, with a sign-up through the bot's `/finals` against the platform as its provider.

The epic's planned items: the full `contracts/finals.md`; the module on the kit with the core as a pinned dependency; screen widgets and Moments for brackets and the final. No child issues exist yet; this pack proposes them ([P2](track-finals/questions.md#p2-the-issue-set)).

## What was read
- **Decisions:** [0025](../decisions/0025-finals-and-games-modules.md) (finals and games apart; the shared core, its licence and how it is pinned; the off-LAN app independent with no sync; the provider contract), [0027](../decisions/0027-product-decisions-2026-11-07-08.md) (joining by venue, link or QR; Discord accounts; 12-month anonymisation; Finals as the Apps track's possible first app), [0022](../decisions/0022-product-vision.md) (the screen is the heart; the phone hub; 1,000–2,000 attendees), [0020](../decisions/0020-best-of-old-freely-new.md), [0004](../decisions/0004-nothing-migrated.md), [0010](../decisions/0010-scope.md) (no tokens in URLs), [0013](../decisions/0013-multi-tenant-core.md), [0015](../decisions/0015-dependency-auditing.md), [0026](../decisions/0026-briefs-are-research-packs.md), [0029](../decisions/0029-additive-contracts-ship-with-consumers.md) and [0024](../decisions/0024-additive-contract-docs-normal-risk.md).
- **The roadmap:** the [Finals track](../roadmap.md#finals), its neighbours (Games, App), step 7 ("the mini tourney is not part of it") and the reuse table's mini-tourney and canccubot rows.
- **Legacy inventories:** [the mini tourney](../legacy-inventory/thefinals_mini_tourney.md) in full (features P1–P13 and A1–A18, the seven formats, the 48 routes, data, tests, the 13 known problems, the port table and the tenancy questions), [canccubot](../legacy-inventory/canccubot.md) (the tourney watcher's posts, the finals cards and their 15 and 10 minute windows), the [summary](../legacy-inventory/README.md).
- **The legacy itself** (read-only): the mini tourney's repository at its last commit (layout and tests), the bot's `finals_cards.py` and `tourney_watcher.py`. The legacy bot has no `/finals` command; the stub's commands come from the off-LAN app's provider design.
- **Contracts it builds on:** [finals.md](../../contracts/finals.md) (the provider stub), [tenants.md](../../contracts/tenants.md) (users and identities, joining, series and clone, retention, the info-page mode), [README.md](../../contracts/README.md) (internal paths and the kit's service identity, privacy export and delete), [bot.md](../../contracts/bot.md) (commands per flag), [moments.md](../../contracts/moments.md) (the `finals` class and the `finals_result` rule), [screen.md](../../contracts/screen.md#widgets) (`bracket`), [notify.md](../../contracts/notify.md) (topics), [admin.md](../../contracts/admin.md) (settings, rights, presets) and [games.md](../../contracts/games.md) (the catalogue to come).
- **Briefs and design:** step 7's pack (the tournament kept apart; its #129 "format mix-up" test sent here), step 6's pack (P8: `/finals` under its own flag; D9: the legacy import), step 9's pack (D12 and L11: the finals cards are this track's; L-question: "the tree waits for the Finals track"), the App track pack (P4: modules own their pages in the hub's frame), the [design guideline](../design/README.md) with amendment 3's grids, [widgets.md](../design/widgets.md).
- **The epic and its issues:** #161, #172, the closed #148 (the split and the stub) and #158.

## What the platform already has
- **Built and waiting:** Moments' `finals` class (rank 55) and its `finals_result` rule (today fed by the tournament's final); Screen's `bracket` template (heats, step 9 proposes); Notify's topic registry; the organiser shell and its menu; the kit's outbox, settings client, rights check, tenant transactions and service identity; sign-in and rights (#52).
- **Not built:** the `finals` module (no folder yet), its contract beyond the stub, the bot module (step 6: the `/finals` command framework), the hub's frame (App track), the games catalogue (Games track), and the shared tourney core's first release.

So most of the track (the module, its organiser pages, its screen moments) can start on what exists; the hub pages and `/finals` light up when their hosts land ([P5](track-finals/questions.md#p5-order-against-the-bot-and-the-hub)).

## How comparable products solve it
| Field | What they do | What we take |
|---|---|---|
| **Esports bracket platforms** | Every bracket shape, check-in, team invites, self-reported scores confirmed by the opponent, a dispute queue for admins | Invites by link, QR or code (U4); two matching reports decide, a queue for the rest (U7, E2); not every bracket shape (U1) |
| **Custom lobbies in team games** | A host makes a private lobby and shares a short code with the other teams | The lobby code on the match's phones, never on a public screen (U8) |
| **Team balancer bots in game communities** | Pick tonight's players, balance teams by a rating, re-roll, swap | The team builder, which the core already has (U13) |
| **Club ladders and rating systems** | A rating per player that moves after each event, with the rule shown | Rankings with "why it moved" (L8, [mockup 13](track-finals/13-champions-and-rankings.svg)) |
| **Sports league apps** | A hall of champions across seasons, titles per player | Champions of the series, carried by the clone (D4) |
| **Arena screens and broadcast overlays** | A draw reveal, a live bracket, a champion moment | The reveal, the bracket as the Pulse hero, the champion takeover (L6, L11) |

The lesson across them: the good ones **let players run their own matches** (codes, reports) and keep a referee for the disputes, **show the bracket as the story** (where am I, who is next, who won), and **make the draw feel fair** (balanced teams, rules shown). The legacy got the first and the third right in a small app; the platform adds the stage.

## The legacy in one paragraph
A small Node app for one team game with teams of three ([inventory](../legacy-inventory/thefinals_mini_tourney.md)). One season is open at a time; an admin (one shared password) creates it with a format of 3 to 12 teams and a mode: players sign up solo and are drawn into teams, or captains register teams of three nicknames. Solo players can vote to start early (6 votes). The app draws the opening groups; teams report the order of each match from the browser that registered them, two matching reports decide, differing ones wait for the admin; a team sets a 4-character lobby code; later rounds are built automatically and a best-of-three final crowns a champion. A finished season moves each nickname's 0–100 ranking; a team builder forms even teams from that global roster; a champions page counts titles. Live updates are a payload-less SSE ping plus 5 s polling. It works and is loved; its problems are identity by nickname, tokens kept in one browser, no result correction, no audit, an in-process write queue, and two real bugs (a full solo `fourqc` season becomes `four`; an unbounded reshuffle). The bot watched it to post new seasons and champions and to show two screen cards.

## Three directions
The same moment in each: 20:40, the groups of four are being played, the final is next.

![Three directions side by side](track-finals/01-directions.svg)

### A · The mini tourney, moved in
The legacy rebuilt one-to-one on the kit: the public page (season picker, bracket, sign-up, reporting) in the hub, the three admin pages in the shell, sign-in instead of tokens and the password, one open season per event, the provider endpoints for `/finals`, the step 9 cards on the screen.
- **Attendees:** the same pages they know, now signed in; the bracket on the phone.
- **Organisers and crew:** the legacy's admin pages, safe (locks, audit) but as dense as before.
- **Venue staff:** the screen shows the open and started cards and nothing while the bracket runs.
- **Trade-offs:** the cheapest; the legacy tests are the spec. But the screen stays quiet for the hour that matters, the seven renderers come along with their fragility, and correction is the minimum the roadmap asks.
- **Cost: S–M.**

### B · One app, two homes
Finals as the first app of the Apps track (0027): one codebase that runs as the off-LAN app and as an installed module, through an app interface the platform offers (sign-in, storage, events, pages); seasons, rankings and champions follow the app wherever it runs.
- **Attendees:** one Finals online between events and at the LAN, the same look in both.
- **Organisers:** one tool all year.
- **Venue staff:** as C on the screen.
- **Trade-offs:** it designs the Apps track's interface before that track has had its session; it has two sign-in models (a bearer secret off-LAN, the platform's sign-in at the event); the off-LAN app's author owns half the code; 0025 says the off-LAN app stays independent with no sync, so B needs a new record first.
- **Cost: L–XL**, and it waits for the Apps track.

### C · Finals night
The module on the kit with the shared core, made into the night's show. Sign-ups from the screen's QR, the hub, Discord or the crew; a balanced draw revealed on every phone and on the screen; the bracket as the Pulse hero while the season runs; lobby codes and "your match is on" on the phones; teams report by dragging the order, the crew settles disputes and corrects with a reason; rankings that move and say why, carried to the next event; champions on the screen, in Discord and in the series' hall.
- **Attendees:** join in seconds; see their own team the moment it is drawn; one match card with the code; report from their own phone; a champion moment.
- **Organisers and crew:** a season desk led by the next action, the team builder, a queue of what needs them, corrections that show their impact, a crew phone at the stage.
- **Venue staff:** the screen tells the story: open (count and QR), teams drawn, the bracket live, champion.
- **Trade-offs:** more than A: events, three Moments rules, a tree view-model for Screen's `bracket`, a correction rule, invites and guests. Parts wait for the bot (`/finals`) and the hub's frame.
- **Cost: M.**

## Recommended direction: Finals night
**C.** The mini tourney is already the best-loved thing in the legacy because it gives a group of friends a real bracket in ten minutes. What it never had was the room: the screen showed two cards and went dark, the phones had a page you had to refresh, Discord had a bot polling a URL. The platform has spent seven steps building exactly that room (Pulse, Moments, Notify, the hub, the bot), and all of it is waiting for an emitter. C plugs the mini tourney into it.

A would ship the legacy's silence on a new stack and port its most fragile code (seven renderers) while dropping the chance to fix its two real gaps (identity and correction). B is the right question asked too early: it would design the Apps track's interface from one app, before that track's own session, and against 0025's "no sync". C does not close B's door: the core stays pure and shared, the provider contract stays clean, and a later Apps track can host the same core ([D15](track-finals/questions.md#d15-the-apps-track)).

C also costs less than it looks. The bracket engine, the rankings and the builder come from the core with their tests; Moments, Screen, Notify, the shell, the kit's transactions and rights exist. The track builds the module that holds seasons per event and emits `finals.*`, its pages, and three Moments rules.

**Design principles**
1. **Players run their own matches.** Codes and reports are on the players' phones; the crew is the referee, not the scorer (U7, U8).
2. **The draw is fair and visible.** Balanced teams from the core, revealed at once, the rules on the page (U13, L11).
3. **The bracket is the story.** One renderer for every format, on the phone ("my path"), the desk and the Pulse (L2, L3, L6).
4. **Trust the results.** Two matching reports or the crew decide; a correction needs a reason, shows its impact first and stays in History; rankings follow corrections (E4, E5, O6).
5. **A person, not a nickname.** Entries, rankings and titles belong to people; guests have ids; renaming never starts a new player (D5).
6. **Everything stays in the event.** Seasons, roster and rankings are per tenant under RLS; the clone carries rankings and champions to the next event of the series (D4).
7. **The bot helps, never blocks.** `/finals` is one more door; the hub, the QR and the crew work without it (E7).
8. **Lean.** No app interface, no run-of-show mirror, no second game until someone needs them (D11, D15, U1).

## Key flows
Each flow names its users and its mockup. The mockups use the demo event's names only (Demo Event, Demo Finals, Arena North, Arena South, Team Alpha … Team Iota, Demo Player, Player Two …).

### Joining a season (attendee)
The season-open card on the screen, the Finals page in the hub, joined with the vote to start early, the reveal of the drawn team, left out as a substitute ([U2](track-finals/questions.md#u2-how-people-join-a-season), [U6](track-finals/questions.md#u6-voting-to-start-early), [L11](track-finals/questions.md#l11-the-reveal), [U14](track-finals/questions.md#u14-substitutes-and-the-left-out-list)).

![Joining a season](track-finals/02-flow-join.svg)

### Discord (attendee, organiser)
`/finals status`, `register`, a taken name, `link`; the posts for a new season, the start and the champions; the per-event switch between this event's Finals and an outside app ([D6](track-finals/questions.md#d6-a-discord-sign-up-by-someone-who-never-signed-in), [D7](track-finals/questions.md#d7-how-the-bot-reaches-this-events-finals), [O9](track-finals/questions.md#o9-the-provider-switch)).

![Discord](track-finals/03-discord.svg)

### Registering a team (captain, teammates)
Name the team, invite by QR, link or code, a teammate joins, the full team, short at the start ([U3](track-finals/questions.md#u3-solo-teams-or-both), [U4](track-finals/questions.md#u4-how-teams-form-in-a-teams-season)).

![Registering a team](track-finals/04-teams.svg)

### My match (player)
The match card with the lobby code as its hero, setting the code, reporting by dragging, decided, disputed ([U7](track-finals/questions.md#u7-who-enters-results), [U8](track-finals/questions.md#u8-the-lobby-code)).

![My match](track-finals/05-my-match.svg)

### The bracket (attendees, spectators)
The public page at 1280 px with a team's route traced; "my path" on a phone ([L2](track-finals/questions.md#l2-one-bracket-renderer), [L3](track-finals/questions.md#l3-the-bracket-on-a-phone), [L4](track-finals/questions.md#l4-tracing-a-teams-route), [U10](track-finals/questions.md#u10-spectators)).

![The bracket](track-finals/06-bracket.svg)

### The season desk (organiser, crew)
The crew band led by the next action, live counts, the bracket with crew marks, the "Needs you" queue; the same at phone width ([L10](track-finals/questions.md#l10-the-organiser-pages), [E2](track-finals/questions.md#e2-a-dispute-nobody-settles)).

![The season desk](track-finals/07-season-desk.svg)

### A new season (organiser)
The form with the size chosen by picture, arenas as chips, a time picker and a vote stepper; at phone width ([U3](track-finals/questions.md#u3-solo-teams-or-both), [D13](track-finals/questions.md#d13-the-game-and-its-arenas)).

![A new season](track-finals/08-new-season.svg)

### The team builder (organiser, crew)
Tonight's players with their rankings, six balanced teams with their sums, drag to swap, a ranking slider ([U13](track-finals/questions.md#u13-the-team-builder), [D4](track-finals/questions.md#d4-where-rankings-live)).

![The team builder](track-finals/09-team-builder.svg)

### Results, disputes and corrections (crew, organiser)
Two differing reports side by side; a correction with its reason and what it changes; the season's History ([E4](track-finals/questions.md#e4-correcting-a-result), [O6](track-finals/questions.md#o6-audit)).

![Results and corrections](track-finals/10-results-and-corrections.svg)

### The crew phone (crew, venue staff)
Start when full, Now, settle a dispute, swap in a substitute, a missing lobby code ([U14](track-finals/questions.md#u14-substitutes-and-the-left-out-list), [O3](track-finals/questions.md#o3-crew-pings)).

![The crew phone](track-finals/11-crew-phone.svg)

### The venue screen (attendees in the hall)
Finals are open, teams drawn, the bracket as the Pulse hero from the live round on, champion ([L6](track-finals/questions.md#l6-what-the-venue-screen-shows), [L7](track-finals/questions.md#l7-moments-finals-class), [D10](track-finals/questions.md#d10-the-screens-bracket-widget)).

![The venue screen](track-finals/12-venue-screen.svg)

### Champions and rankings (attendees, players)
Champions of the series and most titles; "My finals" with the ranking, its move and why ([D4](track-finals/questions.md#d4-where-rankings-live), [L8](track-finals/questions.md#l8-ranking-changes-on-show), [U16](track-finals/questions.md#u16-a-players-own-view-after-the-event)).

![Champions and rankings](track-finals/13-champions-and-rankings.svg)

### A season's life (everyone, implicitly)
The states, what each surface does in each, the events emitted, and the two providers behind `/finals` ([D9](track-finals/questions.md#d9-events), [D14](track-finals/questions.md#d14-two-providers-one-contract)).

![A season's life](track-finals/14-lifecycle.svg)

### Edge states (player, crew)
Not a member, a taken name, a cancelled season, swapped in, a long dispute, too late ([E13](track-finals/questions.md#e13-not-a-member), [E8](track-finals/questions.md#e8-names), [E11](track-finals/questions.md#e11-a-cancelled-season), [E12](track-finals/questions.md#e12-late-arrivals), [E7](track-finals/questions.md#e7-the-bot-is-down-or-cannot-reach-finals)).

![Edge states](track-finals/15-edge-states.svg)

### Settings and rights (organiser, event admin)
Every rule per event with the legacy's values as defaults; the "Finals crew" role; at phone width ([O4](track-finals/questions.md#o4-settings-and-their-defaults), [O5](track-finals/questions.md#o5-rights), [U12](track-finals/questions.md#u12-public-start)).

![Settings and rights](track-finals/16-settings-and-rights.svg)

### Grids that scale (organiser)
The seasons page with one and twelve seasons at 1280 and 1920 px and on a phone ([L10](track-finals/questions.md#l10-the-organiser-pages)).

![Grids that scale](track-finals/17-grids.svg)

### Every mockup
| File | What it shows | For whom |
|---|---|---|
| [01-directions.svg](track-finals/01-directions.svg) | The three directions side by side | the session |
| [02-flow-join.svg](track-finals/02-flow-join.svg) | Screen card → Finals page → joined → the reveal; left out | attendee |
| [03-discord.svg](track-finals/03-discord.svg) | `/finals` commands, the channel posts, the provider switch | attendee, organiser |
| [04-teams.svg](track-finals/04-teams.svg) | Name a team, invite, join, full, short at the start | captain, teammates |
| [05-my-match.svg](track-finals/05-my-match.svg) | Match card and lobby code, setting the code, reporting, decided, disputed | player |
| [06-bracket.svg](track-finals/06-bracket.svg) | The public bracket at 1280 px with a traced route; my path on a phone | attendees, spectators |
| [07-season-desk.svg](track-finals/07-season-desk.svg) | The season desk at desktop and phone width | organiser, crew |
| [08-new-season.svg](track-finals/08-new-season.svg) | The new-season form at 1280 px and on a phone | organiser |
| [09-team-builder.svg](track-finals/09-team-builder.svg) | Players and rankings, balanced teams, swap, ranking slider | organiser, crew |
| [10-results-and-corrections.svg](track-finals/10-results-and-corrections.svg) | A dispute, a correction with its impact, History | crew, organiser |
| [11-crew-phone.svg](track-finals/11-crew-phone.svg) | Start, Now, settle, swap, a missing code | crew, venue staff |
| [12-venue-screen.svg](track-finals/12-venue-screen.svg) | Open, teams drawn, the bracket on the Pulse, champion | attendees in the hall |
| [13-champions-and-rankings.svg](track-finals/13-champions-and-rankings.svg) | Champions of the series, most titles, My finals | attendees, players |
| [14-lifecycle.svg](track-finals/14-lifecycle.svg) | States, surfaces, events, the two providers | everyone |
| [15-edge-states.svg](track-finals/15-edge-states.svg) | Six edge states | player, crew |
| [16-settings-and-rights.svg](track-finals/16-settings-and-rights.svg) | Finals settings and the crew role, desktop and phone | organiser, event admin |
| [17-grids.svg](track-finals/17-grids.svg) | The seasons grid with one and twelve seasons at three widths | organiser |

The sheets were drawn by a throwaway script kept out of the repo, as in earlier packs. Rendered in headless Chromium (the Playwright image's fonts), no text with `data-box` runs outside its box on any sheet. Screens carry no question numbers, event or path names, ids or typed numbers; notes for the reader sit in captions and note boxes outside the screens (the [mockup rules](README.md#outline-of-a-research-pack)). The lifecycle sheet is a diagram for the reader, so it names events and paths.

## Port, drop or invent
Each with its reason ([0020](../decisions/0020-best-of-old-freely-new.md)). The pure parts come through the shared core (0025), not as copied code.

### Port as is (through the shared core, with its tests)
| Legacy | Where it goes | Why |
|---|---|---|
| The bracket engine (`src/ladder.js`): the seven formats, draws, next rounds, result validation, the champion | the core, pinned by the module | Pure, small, tested per format; fixed upstream for E9 |
| The ranking table and clamp (`src/rankings.js`) | the core | The legacy's numbers are the rules players know (L8) |
| The team builder (`src/teambuilder.js`) | the core, with a seeded random source | Pure balancing, used by the builder and the solo draw (U13) |

### Port with changes
| Legacy | Becomes | Why |
|---|---|---|
| The service rules (registration, early start, votes, reports, lobby code, arena locks, cancel, live swap) | Each operation one Postgres transaction with row locks, per tenant | Known problems 2 and 4; RLS (D3, E1) |
| Two matching team reports, admin override | Every signed-in player reports for their team; the crew's queue; a season may set "crew enters every result" | Tokens in one browser were problem 8 (U7) |
| Solo and team modes | Both, plus filling short teams from the solo list, invites, guests | U3, U4, U5 |
| Vote to start early (6) | A setting, 0 turns it off | U6 |
| The "left out" list | The substitutes' list for live swaps | U14 |
| Public start in two month windows, on by default | "Members may start a season when none is open", off | Event-specific windows dropped, open door closed (U12) |
| Global roster and rankings by nickname | Per event, by person, carried by the clone | Problem 6; everything in the tenant (D4, D5) |
| Champions page and trophy counts | Champions of the series and titles per person | D4, [mockup 13](track-finals/13-champions-and-rankings.svg) |
| Settings table (four booleans) | Per-event settings with the legacy's defaults | O4 |
| The arena constant | A setting, then the games catalogue | D13 |
| The SSE `update` ping and 5 s polling | `finals.*` events; Screen and the hub's live channel | Problem 10 (D9, O1) |
| The bot's two finals cards (polled every 30 s, 15 and 10 minute windows) | Moments rules and presets: open, drawn, champion; the windows as durations | One happening, one owner (L6, L7) |
| The bot's tourney watcher posts | The bot posts on `finals.*` events under the Finals flag | Nothing polls (U9) |
| Seven bracket renderers | One renderer from round data | L2 |
| In-page dialogs instead of native ones (the legacy's P13) | The shared dialog of `packages/ui` | Phones block native dialogs |
| Debug fill and votes | Demo data and tests only, behind the superadmin | E10, O7 |

### Drop
| Legacy | Why |
|---|---|
| The shared admin password, team and individual tokens | Sign-in and rights replace them |
| The two month windows and the season-name words | Event-specific; the name comes from the event |
| Deleting a finished season without reverting rankings | E5 |
| The health endpoint, the systemd example, the coding-agent config, `TEAMS_PER_SEASON` | The kit's health; containers; not product; unused |

### Invent
| New | Why |
|---|---|
| Team invites by QR, link or code; guests added by the crew | Every player is a person with their own phone (U4, U5) |
| The Discord sign-up held until the person signs in | The exit criterion's `/finals` path (D6) |
| The reveal on phones and the screen | The legacy's "name revealed at start", paid off (L11) |
| "My path" and a tap-to-trace bracket | The phone's view of the bracket (L3, L4) |
| Corrections with their impact, History, rankings that follow | The legacy's missing feature (E4, E5, O6) |
| The season desk, the "Needs you" queue and the crew phone | The crew runs nine teams from the stage (L10) |
| A "Finals crew" role | People who run the finals need not be event admins (U11, O5) |
| The `finals` Notify topic | Pushes people choose (U9) |
| A tree view-model for Screen's `bracket` | The bracket as the Pulse hero (D10) |
| Champions and rankings carried by the clone | The series' history without a global table (D4) |
| "My finals" with "why it moved" | The ranking explained (U16) |

## What the stub and the built contracts need
Found while reading the consumers against the stub; each is a proposal for the session, not a change made here.
1. **The platform's provider base.** The stub has the bot call `https://<event host>/api/finals` and the module answer the entries and links paths only for the bot module. The kit's service identity proves "a module of this stack", not which one, and guards internal paths. Proposed: on the platform the bot calls `/internal/finals/provider/…` with `tenant_id`; the off-LAN app's row is unchanged ([D7](track-finals/questions.md#d7-how-the-bot-reaches-this-events-finals)). The stub is provisional, so this is not a breaking change to a released contract, but it is a change to a published row and the review should look at it.
2. **A Discord user who never signed in.** The stub leaves it to this track; tenants creates a user only at sign-in and offers modules no lookup by Discord id. Proposed: the entry holds the Discord id until the person signs in, with an additive internal lookup in tenants ([D6](track-finals/questions.md#d6-a-discord-sign-up-by-someone-who-never-signed-in)).
3. **Moments' `finals` class** is already used by the tournament's final. Proposed: one class for both, new rules beside `finals_result`, nothing renamed ([L7](track-finals/questions.md#l7-moments-finals-class)).
4. **Screen's `bracket`** draws heats only. Proposed: an additive tree view-model ([D10](track-finals/questions.md#d10-the-screens-bracket-widget)).
5. **The bot's provider setting** (one base URL per event) needs an organiser-facing switch and a superadmin-held secret for an outside app ([O9](track-finals/questions.md#o9-the-provider-switch)).

All other parts of the full contract (API, events, rights, settings, clone, privacy) are new, so additive; each part ships with the package whose code first uses it ([0029](../decisions/0029-additive-contracts-ship-with-consumers.md)).

## Proposed issue changes
The epic's planned items are input ([P2](track-finals/questions.md#p2-the-issue-set)). Proposed, not applied: the lead writes the issues after the session.
- **Epic #161 · keep**, its Planned list rewritten to the issues below. "The full `contracts/finals.md`" is not an issue of its own: its parts travel with the issues that use them (0029). "The module on the kit" becomes issues 1–3; "Screen widgets and Moments" becomes issue 5.
- **New 1 · `feat(finals)`: the finals contract, seasons, sign-ups and rights.** The module on kit-ts with the core pinned (D1, D2); storage per tenant under RLS (D3); seasons (open, change size, start early by votes or by the crew, cancel; one open at a time); entries solo, as teams with invites, fill from solo, guests (U3–U6); the provider part on internal paths with the Discord hold (D6, D7) and its fixtures (D14); rights and the "Finals crew" preset (O5); settings (O4); `me/export`, `DELETE me`, the clone (D4, D16); the seasons page and the new-season form; race tests (E1). Risk: **high** (sign-in, rights, personal data, service auth).
- **New 2 · `feat(finals)`: matches, results, corrections and rankings.** Matches from the core; reports by players, the crew's queue and decisions, the crew-only setting (U7); lobby codes (U8); live swaps and substitutes (U14, E3); corrections with their impact and History (E4, O6); rankings and their reverts (E5); champions; the season desk and the crew phone (L10). Risk: normal.
- **New 3 · `feat(finals)`: the roster and the team builder.** The roster per event with ranking sliders, the builder page, the solo draw's balancing (U13, D4). Risk: normal. Could share a package with 2 (same files).
- **New 4 · `feat(finals)`: the player's pages in the hub.** The Finals page, join, teams and invites, my match and reporting, the bracket ("my path", tracing), champions and My finals, mobile-first in the hub's frame (L1–L4, U16). Waits for the hub's frame. Risk: normal.
- **New 5 · `feat(finals,screen,moments,notify)`: Finals on the screens and in Notify.** The tree view-model for `bracket` (D10), the `finals_open`, `finals_drawn` and `finals_champion` rules and presets (L6, L7), the `finals` topic (U9), demo data in `events/demo/` (O7), screenshots. Risk: normal.
- **New 6 · `feat(bot,finals)`: `/finals` and the finals posts.** The commands under the Finals flag on step 6's framework, the provider switch and the outside app's secret (O9), the channel posts (U9), the bot's tests against both providers (D14). Waits for the bot module. Risk: **high** (a secret; acting for a Discord user).

**Order sketch:** 1 (high, alone) → 2 and 3 (one package) → 5 → 4 when the hub's frame exists → 6 when the bot's command framework exists. Before 1: the core's first release, agreed with its author (P4, a `Follow-up:` for the lead).

## Proposed exit criteria
On the demo event: a Demo Finals season opens and shows on the screen with its count and QR; 27 demo players join (one through `/finals register` against the platform as the provider, a team through an invite, a guest added by the crew); the season starts early by vote with balanced teams revealed on phones and the screen; groups are reported by the teams, one dispute is settled and one result corrected with its trail; the bracket runs live on the Pulse; the final crowns Team Delta on the screen, in Discord and in the hub; rankings move, and a clone of the event carries them and the champions; every write race-tested ([P3](track-finals/questions.md#p3-the-exit-criterion)).

## Roadmap notes found
- The Finals track's plan issue ("docs(briefs): Finals track: plan") does not exist yet, so nothing waits for it ([P6](track-finals/questions.md#p6-the-plan-issue)).
- The game and its arenas live in a module setting until the Games track's catalogue holds them; then the catalogue replaces the setting ([D13](track-finals/questions.md#d13-the-game-and-its-arenas)).
- Finals seasons are not mirrored into the run of show; if wanted, it is a later addition like the tournament's mirror ([D11](track-finals/questions.md#d11-the-run-of-show)).
- Step 7's #129 lists the "format mix-up" regression test; it belongs here, fixed in the core ([E9](track-finals/questions.md#e9-the-format-mix-up-and-the-reshuffle)).
- 0027 leaves Finals as the Apps track's possible first app; this pack builds per 0025 and keeps that door open without an interface ([D15](track-finals/questions.md#d15-the-apps-track)).

## The question bank
All of them are in the [question bank](track-finals/questions.md): 74 in six themes, each with options and a recommendation. **Decide first:** P1 (the direction), U1 (what Finals is at an event), D4 (where rankings live), D6 (the Discord sign-up), D7 (how the bot reaches this event's Finals), U7 (who enters results), E4 (corrections), P2 (the issue set), P5 (the order).
