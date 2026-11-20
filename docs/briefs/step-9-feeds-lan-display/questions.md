# Step 9 question bank

Every open question the research for [the step 9 brief](../step-9-feeds-lan-display.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#168). IDs are stable, so the session can answer "D4: A" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), U2 (what "the LAN display" is now), P6 (pizza leaves step 9), D4 and D7 (where the history lives, and the legacy import), U4 (names on the screen), D12 (the finals cards), P2 (the issue set), P3 (the exit criterion).

**Already decided, so not asked again:** the screen is push-driven, composed of widgets placed by layouts as data, with Moments at the peaks ([0022](../../decisions/0022-product-vision.md)); no embedded pages and no frame protocol ([0010](../../decisions/0010-scope.md)); the ticker is manual ([0018](../../decisions/0018-ticker-manual.md)); the bus carries presence as counts only, names are read from the bot's API by callers allowed to see them ([bot.md](../../../contracts/bot.md#who-plays-what)); raw presence data is deleted 30 days after the event is archived and other personal data anonymised after 12 months ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md)); check-in is never mandatory (0027); the energy levels change the look, never the pace, and a box shows at most 4 rows (design amendments 1 and 2); grids scale with their content (amendment 3); the statistics widgets ship with "Collecting…" until the history exists (design Q16).

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive, so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)). None of the recommendations breaks a contract.

## U · Who uses it and how

### U1. Whom is the live data on the screens for?
- **A.** The people in the hall. Everything on a screen is what the hub shows a guest (one source, two surfaces); crew information (a feed is down, a box is empty and why) goes to the organiser's pages, never onto a screen.
- **B.** The hall and the crew: a small "feeds" corner on the screen for the crew.
- **Recommendation: A.** A screen is read by hundreds at 20 m; a crew corner is noise to them and tells a passer-by that something is broken. The crew gets Live data in Screen studio ([mockup 09](09-live-data.svg)).

### U2. What is "the LAN display page" now?
The legacy LAN display was one 1,800-line page, embedded in an iframe by the signage player, with views picked by URL (stats, hot game, tournament, finals, announce, polls). The roadmap says "the LAN display page comes last".
- **A.** A **built-in layout, the LAN board** (with a portrait twin): six data boxes and the alive chips, played by paired screens like any layout; a theme restyles it and an organiser changes its boxes ([mockup 05](05-lan-board.svg)). Its old views become widgets and Moments' takeovers, most of which exist already.
- **B.** A separate page beside Pulse that ports the legacy views one by one (direction B).
- **C.** A public web page at a link, for any browser or a stream PC, outside pairing.
- **Recommendation: A.** One renderer, one look, one rule set; B builds a second product, and C lets anyone show the event's live data without a paired device (see P7 for C as a later idea).

### U3. What do the screens show when nothing is scheduled, and at night?
In the legacy, the signage player fell back to the LAN display whenever nothing was scheduled.
- **A.** Pulse stays the default; a **night scene preset** (Moments' scenes can set a zone's layout) switches chosen zones to the LAN board from a set hour, off by default; quiet hours still win ([mockup 04](04-a-saturday.svg)).
- **B.** The LAN board becomes the default layout of every zone between agenda items.
- **C.** No switching: each zone keeps the layout it was given.
- **Recommendation: A.** Pulse with live boxes is already the "nothing scheduled" screen; the night board is a choice, and scenes already do layouts.

### U4. Whose names may a screen show?
- **A.** Tournament players and results (event-wide `public` events, as today), food holders as step 5 set; **now playing names only where a zone opts in** (the contract's `props.show_names`, off by default); **never** who is in a voice room, and never play-time leaders by name.
- **B.** As A, plus "most hours today" by name (the design's `player_spotlight`) for people who consented in the hub.
- **C.** Counts only on screens, tournament included.
- **Recommendation: A.** B needs a consent flow the App track has not planned (a Roadmap note); C would empty the tournament boxes the players want to see.

### U5. What does the organiser get for the feeds?
- **A.** Nothing new: an empty box just stays empty.
- **B.** **Screen studio → Live data:** one card per feed with its state in words (live, collecting, waiting, not used), its last update, which boxes use it, and a link to where it is fixed; a "Boxes showing nothing" panel with the reason for each, and a short log ([mockup 09](09-live-data.svg)).
- **C.** B plus per-feed switches to hide a feed from every screen.
- **Recommendation: B.** Before doors the crew's one question is "why is that box empty?"; B answers it without the Health page. Hiding a feed is already a box's or a widget's setting (C adds a second switch for the same thing).

### U6. What do venue staff get?
- **A.** The LAN board on a lobby or café TV, paired like any screen; nothing else.
- **B.** A staff view with feed health.
- **Recommendation: A.** Venue staff need a lively TV, not tools; the crew has Live data.

### U7. Does the hub show the new widgets too?
`GET /api/screen/now` serves the hub what a zone shows, for a list of widget types.
- **A.** Add the new counts-only types (`top_games`, `voice_rooms`, `tournament_progress`) to that list. **Contract** (additive).
- **B.** Leave the hub to the App track's own pages.
- **Recommendation: A.** One source, two surfaces: the hub's "on screen now" never disagrees with the hall. `now_playing` names stay members-only as today.

### U8. Milestones: which, and who sets them?
Moments' storyboards have a `milestone` trigger (a count crosses a value, or a new peak) for arrival check-ins, members online and photos; Record crowd (preset 14, off by default) uses it.
- **A.** Add the counts step 9 brings: **in voice**, **hours played tonight**, and **players of one game**. Values are automatic round numbers (100, 200, 250, 500, 1,000…) plus "new peak"; an organiser may switch each count off.
- **B.** The organiser types a list of values per count.
- **Recommendation: A.** Round numbers are what people cheer; a list is work nobody does before an event. **Contract:** additive counts on the `milestone` trigger ([mockup 08](08-alive-milestones-finals.svg)).

### U9. May the crew put a data widget in the spotlight?
The crew spotlight (Moments) already shows a leaderboard, a bracket or a photo.
- **A.** Add `top_games` and `today_numbers` to what a spotlight may show. **Contract** (additive).
- **B.** No.
- **Recommendation: A.** "Look how much we played tonight" is a crew moment; the spotlight's rules stay as they are.

### U10. Records across a series?
- **A.** Within the event only in step 9 (a new peak of this event).
- **B.** Compare with the last event of the series ("a record for this LAN").
- **Recommendation: A.** B needs the history of earlier events, which archiving and the 30-day rule delete; it belongs with the event report (backlog, N7) as a Roadmap note.

## L · Look and feel

### L1. The LAN board's look?
- **A.** The Pulse look: the same widgets and theme, denser boxes ([mockup 05](05-lan-board.svg)).
- **B.** A broadcast scoreboard look of its own (direction B's sheet).
- **Recommendation: A.** A theme already restyles everything; a second look doubles the theme work and the screenshots.

### L2. How many boxes on the LAN board?
- **A.** Six (3 × 2), with the alive chips in the header, like the Dashboard after amendment 2; the portrait twin stacks five.
- **B.** Eight smaller boxes, closer to the legacy stats view.
- **Recommendation: A.** Amendment 2 asked for more air on the six-box dashboard; eight boxes would break it.

### L3. Top games: which windows?
- **A.** One widget, `top_games`, with a `window` setting: **now** (players this minute), **tonight** (since the event day turned at 06:00), **96 h** (the legacy's), **whole event**; tonight's is the default on the LAN board, now on Pulse.
- **B.** Two widgets: now and 96 h, as the legacy.
- **Recommendation: A.** One widget, one template; tonight matches how a LAN night is lived, and 96 h stays for the legacy feel. **Contract:** the widget and its view-model (additive).

### L4. The activity graph: which metrics and windows?
Built: `online` and `in_voice` over 24 hours.
- **A.** Add the metric **games** (players by hour, each bar in the colour of that hour's top game) and the window **whole event** (an area); "hour by day" later ([mockup 06](06-data-widgets.svg)).
- **B.** As A with hour by day now.
- **C.** Keep it as built.
- **Recommendation: A.** The two the design drew first; hour by day is a nice-to-have for a four-day event. **Contract:** additive `metric` and `window` values.

### L5. Arrows on the new widgets?
- **A.** As widgets.md: `top_games` rank moves ▲n or ▼n against an hour ago, held 60 s, "new" for a first entry; `voice_rooms` and `now_playing` counts get the 10-minute arrow.
- **B.** No arrows on the new widgets.
- **Recommendation: A.** The design's rules exist; Screen computes them as it computes today's.

### L6. The legacy alive chrome: chips, pulse strip, cover wash?
- **A.** Keep the **chips** (HOT, VOICE, SPIKE), drawn on the box they describe and in the LAN board's header; drop the pulse strip (the countdown's chip and Moments do its job) and the cover wash (the stage's art layer does it) ([mockup 08](08-alive-milestones-finals.svg)).
- **B.** Port the strip as well.
- **Recommendation: A.** Chips are the part people read; the strip repeated what Pulse now says elsewhere.

### L7. Milestones at each energy level?
Amendment 1: calm has no celebrations; lively has milestones; party milestones, confetti and reactions.
- **A.** At calm a milestone only rolls the number and frames its box; at lively the story plays (a sweep, no sound by default); at party with confetti and its cue ([mockup 08](08-alive-milestones-finals.svg)).
- **B.** Milestones are off at calm altogether.
- **Recommendation: A.** The number still changes at calm; only the celebration follows the level.

### L8. Game art on the cards?
- **A.** The catalogue's cover as a banner on each top-games row and under the card's veil for the leader; the stage's blurred layer as built.
- **B.** No art on rows.
- **Recommendation: A**, falling back to the theme's colours when a game has no cover (D11).

### L9. The tournament on Pulse?
- **A.** The hero counts down to the next session with its game's art, `teams_left` (or players) and the "starts in" chip; standings in the rail; Moments' match called and champion as built ([mockup 07](07-tournament.svg)).
- **B.** A permanent tournament box in Pulse's rail during a tournament.
- **Recommendation: A.** The Director and Moments already give the tournament its moments; a fixed box would push out Right now or food.

### L10. The tournament's matches: a bracket tree or a list of heats?
The tournament (step 7) plays sessions of heats and scores points; elimination brackets are the Finals module's.
- **A.** `bracket` draws a session's matches as a list of heats with their state and top results ([mockup 07](07-tournament.svg)); the tree waits for the Finals track.
- **B.** A bracket tree now.
- **Recommendation: A.** It is the shape the tournament has; the design map already says the bracket family is planned with the Games system.

### L11. The finals cards' look?
- **A.** Cards in the theme's look, as drawn: season open with capacity and a QR, starts now, champions ([mockup 08](08-alive-milestones-finals.svg)).
- **B.** The legacy cards' look.
- **Recommendation: A**, built where D12 puts them.

### L12. Sound for the feeds?
- **A.** Only through Moments: milestones play their story's cue within the budget; the feeds themselves never play anything.
- **B.** A cue per chip.
- **Recommendation: A.** One sound engine with one budget (step 4); a chip that rang would be a flood.

## D · Data and integrations

### D1. How does Screen get the bot's data?
- **A.** As today's contract: counts by event (`bot.presence.counted`), names and voice by module reads, history by a module read.
- **B.** Everything by events, names included.
- **Recommendation: A.** The bus carries no names (already decided); B breaks it.

### D2. Now playing's source?
`now_playing` shows `empty` until the bot contract gives Screen a module path.
- **A.** The bot adds `GET /internal/bot/presence/playing` (a module identity, the same answer as the members' read), and Screen reads it on `bot.presence.counted`, at most every 30 s. **Contract** (additive, bot).
- **B.** Screen reads the public path with a crew right.
- **Recommendation: A.** Module reads are the platform's pattern (agenda, notify, tenants); a device never holds a right.

### D3. Voice rooms' source?
`voice_rooms` has no source and no view-model.
- **A.** An additive `voice_rooms` on `bot.presence.counted`: the busiest public rooms, each with its name and count (no members). **Contract** (additive, bot and screen).
- **B.** A module read of the bot's voice API, counts only.
- **Recommendation: A.** Counts only, public channels only, once a minute with the rest: no new read path. Room names are what every guild member already sees.

### D4. Where does the statistics history live?
- **A.** In the bot module, per tenant: the samples and hourly aggregates that #122 builds (step 6), with a read API for Screen; Screen keeps only its 24 hours of counts in Valkey.
- **B.** Screen keeps a long history itself from the events it receives.
- **C.** A separate statistics module.
- **Recommendation: A.** Presence data has one owner with one retention rule; Screen stays free of personal data.

### D5. The history read: which shape?
- **A.** Two module reads, counts and hours only, never names: `GET /internal/bot/stats/series?metric=online|in_voice|playing&window=24h|event&step=hour` (each hour's average and peak, and its top game) and `GET /internal/bot/stats/top-games?window=now|tonight|96h|event` (each game's player-hours, its rank an hour ago, first seen). Screen caches each per event for a minute. **Contract** (additive, bot).
- **B.** One read that returns the legacy's folded blob.
- **Recommendation: A.** The widgets ask for exactly these; the blob was a D1 workaround the inventory says to drop. `today_numbers` takes its hours played from the second read.

### D6. How are games ranked?
- **A.** "Now" by players this minute; every other window by player-hours (the legacy's 96 h measure).
- **B.** By peak players.
- **Recommendation: A.** Player-hours rewards what was really played; peaks reward a lobby that filled once.

### D7. The legacy history import (#389)
The legacy event site keeps the bot's raw snapshots for only 15 minutes; what lasts is one folded blob (24 hours hourly, 4 days daily, top games over 96 h). The bot keeps its own 96 h only in memory.
- **A.** Import that blob, and whatever snapshots exist at the time, into the event's tenant once, as part of the legacy bot data migration that step 6 builds and step 11 runs (#125). #389 then keeps the ongoing read API and its rules.
- **B.** #389 as written: a separate one-time import in step 9.
- **C.** No import: the history starts with the platform's own bot.
- **Recommendation: A.** One migration, tested on a copy, run once at the switch; a second importer for the same data doubles the risk. The blob gives the first night's graphs; after that the platform's own bot fills them. **Out of step 9** if taken (see P2).

### D8. The tournament feed: events only, or a catch-up read?
- **A.** Events keep the boxes live; a module read (`GET /internal/tournament/now`: the running and next sessions, their matches, the leaderboard's top 10) fills a zone after a restart or a new zone. **Contract** (additive, tournament).
- **B.** Events only, replayed from the stream.
- **Recommendation: A.** No box waits for the next event (E6); a stream replay depends on retention.

### D9. Several tournaments at once: which one does a box show?
- **A.** By default the tournament of the zone's current or next session; a box may pin one (`props.tournament_id`).
- **B.** Always one chosen per zone.
- **Recommendation: A.** Most events run one; the pin covers the rest.

### D10. Tournament progress and teams left
`teams_left` is in the Pulse hero's contract but the tournament gives no count, and there is no progress field.
- **A.** Additive on the Session: `matches_finished` and, where the format has eliminations, `teams_left`; Screen's `tournament_progress` draws heats done and live ([mockup 06](06-data-widgets.svg)). **Contract** (additive, tournament and screen).
- **B.** Leave both out.
- **Recommendation: A**, if step 7's plan agrees; else the widget waits.

### D11. Covers
- **A.** The games catalogue's `cover_url`; Screen's server blurs once and caches (as the design set); no cover means the theme's colours.
- **B.** Screen looks covers up itself (the legacy chain).
- **Recommendation: A.** The games module owns covers and their cache; one lookup chain.

### D12. The finals cards: which step builds them?
The `finals.*` events do not exist yet; the Finals track writes the finals contract.
- **A.** The Finals track builds them with its events: Moments' takeovers and Screen's widget, against the drawn cards ([mockup 08](08-alive-milestones-finals.svg)). A `Roadmap note:` moves them out of step 9.
- **B.** Step 9 builds them against a stub, before the events exist.
- **Recommendation: A.** A consumer before its emitter is guesswork; the track's PR ships the events and the cards together (0029).

### D13. Pizza on the screen
Step 5's plan has its own issue, "food on the screens and in alerts", which feeds `food_status`.
- **A.** Nothing left for step 9: the LAN board only places the food box.
- **B.** Step 9 reworks the food box.
- **Recommendation: A** (see P6).

### D14. Who computes a milestone?
- **A.** Moments, from the counts it already consumes and the history read (hours played), as its `milestone` trigger does today.
- **B.** The bot emits milestone events.
- **Recommendation: A.** One place decides what is worth celebrating, and it is the one that owns the sound budget.

### D15. The chips: computed where?
- **A.** Screen computes HOT, VOICE and SPIKE from the counts and the event's thresholds, with the arrows' hold rule.
- **B.** The games module's surge decides HOT; Screen the rest.
- **Recommendation: B for HOT, A for the others.** A game is HOT exactly while Games has a surge running (one truth for the hero, Moments and the chip); VOICE and SPIKE have no other owner. Games' `surge_threshold` already defaults to the legacy's 4.

## E · Edge cases and failure

### E1. The bot is slow or gone
- **A.** After 2 minutes without a count the values stay, dimmed with "as of"; after 15 minutes the box hides and its region closes up; Live data says why ([mockup 11](11-edge-states.svg)).
- **B.** Show "Bot offline" on the screen.
- **Recommendation: A.** Honest and calm; the hall never reads a technical message.

### E2. No Discord server bound, or the feed's flag off
- **A.** The bot answers `available: false`; the widget is empty and skipped in its box's rotation; Live data says "Bind a Discord server".
- **B.** Show "not available".
- **Recommendation: A.**

### E3. Less than 3 hours of history
- **A.** "Collecting…" with how far it is, on the LAN board and in a box that has nothing else; skipped in Pulse's rotations ([mockup 06](06-data-widgets.svg)).
- **B.** Hidden until ready.
- **Recommendation: A**, as design Q16 decided.

### E4. Privacy at a small event
Counts exclude the presence opt-out already. At a small event, "Pixel Arena · 1" next to a person at their desk names them.
- **A.** On screens, a game or room with fewer than 2 players folds into "Other games"; a setting per event (default 2) ([mockup 11](11-edge-states.svg)).
- **B.** No minimum.
- **Recommendation: A.** Privacy by default costs one line.

### E5. Duplicate or out-of-order events
- **A.** Event ids deduplicate; versions (`leaderboard_version`, `revision`, `counted_at`) decide which is newer; an older one is dropped.
- **Recommendation: A.**

### E6. A restart or a new zone
- **A.** Every feed has a catch-up read (counts from Screen's Valkey, names and history by module reads, the tournament's read, D8), so no box waits for the next event.
- **Recommendation: A.**

### E7. A result is corrected
- **A.** The standings update quietly: rows slide, "corrected" for 60 s, no sound, no story played again.
- **B.** Play the result moment again.
- **Recommendation: A.**

### E8. A session cancelled or postponed
- **A.** The next box strikes it through for a minute, then shows the next session; the countdown follows the agenda; Moments ends its claims (built).
- **Recommendation: A.**

### E9. A tournament without a game in the catalogue
- **A.** The hero uses the session's game name with the theme's colours; no art.
- **Recommendation: A.**

### E10. The screen loses its uplink
- **A.** As built: clocks run on, live numbers freeze with "as of", food and check-in hide; the new widgets follow the same rule.
- **Recommendation: A.**

### E11. Activities that match no game
- **A.** As the contract: unmatched activities are one "Other games" row (free text never reaches a screen); hidden games never appear.
- **Recommendation: A.**

### E12. A very large event
- **A.** Rows stay at 4 a box (amendment 2); the reads are cached per event (O2); now playing reads the top games only.
- **Recommendation: A.** The load harness (backlog) proves it later.

### E13. An archived event
- **A.** Feeds stop; Live data shows the event as archived; nothing is read or stored.
- **Recommendation: A.**

### E14. A Discord outage looks like an empty hall
- **A.** While the bot's client is not `ready`, its counts are not trusted: no zero is shown, no SPIKE and no new peak fire, and the history skips the gap; counts are trusted again after two good intervals ([mockup 11](11-edge-states.svg)).
- **B.** Show what comes in.
- **Recommendation: A.** A reconnect is not 200 people arriving at once.

## O · Operations and scale

### O1. How often may a screen change?
- **A.** At most one push a second per zone (feeds coalesced), and the choreographer's pace on the screen as built.
- **Recommendation: A.**

### O2. Load on the reads
- **A.** History reads cached per event for a minute; now playing at most every 30 s; the tournament's read only on catch-up.
- **Recommendation: A.**

### O3. Data for demos, CI and setup
- **A.** A **demo feed**: a script on the demo stack that publishes fixture bot, tournament, games and pizza events on the demo tenant, so screenshots and the gate show live boxes without Discord; and **"Preview with sample data"** in Screen studio, so an organiser sees a data box before the bot runs ([mockup 10](10-box-settings-and-layouts.svg)).
- **B.** Only the demo feed.
- **Recommendation: A.** The legacy had demo overlays (D6) for the same reason; sample data is drawn with a "Sample" mark and never reaches a real screen.

### O4. Watching the feeds
- **A.** Live data (U5), and each consumer's lag in Screen's `/health` checks.
- **Recommendation: A.**

### O5. What Screen keeps
- **A.** As today: counts for 24 hours in Valkey, names only in the composed state for 60 seconds, nothing in Postgres; the history is the bot's.
- **Recommendation: A.**

### O6. Order against the other steps and tracks
- **A.** Step 9 starts after steps 6 and 7 merge (its feeds' emitters); the Games-dependent parts (HOT from surges, covers) are wired against the games contract and light up when the module is on; the finals cards go to the Finals track (D12).
- **B.** Wait for the Games and Finals tracks too.
- **Recommendation: A.** The exit criterion needs the bot and the tournament, not the tracks.

### O7. Where do the thresholds live?
- **A.** Per event, in Screen's settings with the legacy defaults (VOICE 5 people, SPIKE 5 in 10 minutes, rows under 2 folded); HOT follows the games module's `surge_threshold`, which already defaults to the legacy's 4 players (D15); a box may switch its chip off ([mockup 10](10-box-settings-and-layouts.svg)).
- **B.** Fixed in code.
- **Recommendation: A.** The legacy had them as URL parameters for a reason.

### O8. Feature flags
- **A.** Each feed follows its module's flag: no tournament flag, no tournament boxes (skipped), and Live data says "not used".
- **Recommendation: A.**

## P · Plan and scope

### P1. The direction
- **A.** Plug in the feeds. **B.** The arena board. **C.** The living venue.
- **Recommendation: C** ([the brief](../step-9-feeds-lan-display.md#recommended-direction-the-living-venue)).

### P2. The issue set
- **A.** As the brief's [proposed issue changes](../step-9-feeds-lan-display.md#proposed-issue-changes): the plan issue, four build issues, #389 rewritten (or merged into #125, D7).
- **B.** One issue per feed (bot, tournament, games) and one for the LAN board.
- **Recommendation: A.** Issues by capability, not by source: a feed alone has no user-visible result.

### P3. The exit criterion
"Live data on the Main screen."
- **A.** Checkable: on the demo stack with the demo feed, each live box of the Main screen updates by push within about a second of its event (CI screenshots and a stack test); on the test server with the real bot, Right now and now playing follow real counts.
- **B.** As written.
- **Recommendation: A** ([proposed exit criteria](../step-9-feeds-lan-display.md#proposed-exit-criteria)).

### P4. Risk classes
- **A.** Normal for the screen widgets, the LAN board, Live data and the additive contracts; **high** for the parts that read or store personal data: now playing names (presence) and the bot's history and its import.
- **Recommendation: A.** AGENTS.md's high class names personal data; the counts-only work stays normal.

### P5. Building before every source exists
- **A.** Build against the contracts with fixture events; a widget whose source is off stays empty and Live data says so; the gate needs only what steps 5–7 built.
- **Recommendation: A.**

### P6. Pizza leaves step 9
- **A.** The roadmap's "wire pizza" is done by step 5's plan; step 9's text loses it (a roadmap update by the lead).
- **Recommendation: A.**

### P7. A public live link or a stream overlay
- **A.** Not in step 9: a `Roadmap note:` for a later step (a read-only board at a link, guest data only, for a stream PC or a TV outside pairing).
- **B.** In step 9.
- **Recommendation: A.** It is a new surface with its own access question; the LAN board covers the venue.

### P8. The plan issue
No `docs(briefs): step 9 (feeds and LAN display): plan` issue exists yet.
- **A.** The lead opens it (blocked by #168), and the build issues are blocked by it, as for every step.
- **Recommendation: A.**
