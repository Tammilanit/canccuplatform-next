# Step 7 question bank

Every open question the research for [the step 7 brief](../step-7-tournament.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#126). IDs are stable, so the session can answer "U2: C" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), U1 (the competitive shape), U2 (solo, teams or both), P4 (brackets in step 7), U8 (who enters results), U9 and U10 (check-in and no-shows), P2 (the issue set), P5 (the screen and hub feed in step 7).

**Already decided, so not asked again:** check-in is optional, off by default, set per tournament and switchable per session, and matches inside a session are optional ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md), the catalog); the tournament builds on the signup site's code, not the tourney core, and the mini tourney is the Finals track's ([0025](../../decisions/0025-finals-and-games-modules.md)); registration lives in the module ([0005](../../decisions/0005-signup-site-stays-outside.md)); no tournament history is migrated ([0004](../../decisions/0004-nothing-migrated.md)); sign-in instead of tokens in URLs ([0010](../../decisions/0010-scope.md)); every account is a Discord account and attendees join by venue, link or QR (0027); one standings table across all competitions is backlog ([0022](../../decisions/0022-product-vision.md)); sessions appear in the run of show through the agenda's mirror, and the module follows `agenda.item.delayed` ([agenda.md](../../../contracts/agenda.md#tournament-sessions)).

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive (new fields, endpoints, events or settings), so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)). None removes or renames a name in the catalog's outlines.

## U · Who uses it and how

### U1. The competitive shape
The legacy is a season: sessions in many games, coarse placements, points, a final. Esports platforms are brackets.
- **A.** The season only: one match per session, placements and points (direction A).
- **B.** Brackets for every session (direction B).
- **C.** The season as the spine; inside a session, matches and rounds are an option (heats, rounds, a small knock-out), drawn as a bracket on the screen (direction C).
- **Recommendation: C.** Any game fits the season because placements are coarse; rounds give the screen its bracket and Moments' Round start a reason to fire, without an engine (P4).

### U2. Solo, teams or both
The legacy registered players one by one; teams formed by voice channel at T−15.
- **A.** Solo only, as the legacy; teams form in voice.
- **B.** Teams only for team games, solo for the rest, chosen per session.
- **C.** B, plus solo players may register for a team session and be placed on a team (U6).
- **Recommendation: C.** A called match needs its teams before the voice room exists, and the screen needs their names; solo sign-ups keep the legacy's "just show up" for people without a group ([mockup 03](03-teams.svg)). **Contract:** teams and registrations in `contracts/tournament.md` (new).

### U3. How teams form
- **A.** A leader creates the team and shares a link or a short code; others join until the close (esports platforms).
- **B.** The leader types the members' names.
- **C.** The crew builds every team.
- **Recommendation: A**, with the crew able to edit any team. A link names a team, never a person, so no token in a URL identifies anyone (0010). The code works when the link cannot be shared (a Discord voice chat). One team per player per session.

### U4. What the player sees of the timeline
- **A.** Each session page shows its timeline (close, voice rooms, the call, results) from the scheduler's own times, and the For you card shows the next step.
- **B.** Only the start time, as the legacy; the rest by push.
- **Recommendation: A.** One set of times for the page, the screen, the bot and the pushes, so they never disagree as the legacy's 30 and 60 minutes did ([mockup 02](02-flow-register.svg)).

### U5. Capacity and the waiting list
- **A.** Places per session (players or teams), optional; a full session offers a waiting list that moves up by itself when a place frees before the close, with a push.
- **B.** A waiting list the crew moves by hand.
- **C.** No capacity, as the legacy.
- **Recommendation: A.** #127 asks for limits and a waiting list; moving up by itself saves the crew the busiest minutes. After the close the list moves only when no-shows are replaced (U10). **Contract:** `places`, `waiting_count` on the Session; `tournament.player.waitlisted` and `tournament.player.promoted` (personal).

### U6. Solo players in a team session
- **A.** They register alone; at the close the crew places them on short teams, by hand or by "fill from the standings" (balanced by points).
- **B.** Random teams made by the module at the close.
- **C.** Not allowed: a team session needs a team.
- **Recommendation: A.** The crew knows who sits together; a balanced fill is one button, not a rule. Random teams surprise friends sitting side by side.

### U7. Giving up a place
- **A.** "I can't make it" until the close frees the place at once; after the close it asks the crew (the legacy's wording), and before the start the crew can still promote from the list.
- **B.** Free until the start.
- **Recommendation: A.** Matches are made at the close; a late drop-out needs a person to decide ([mockup 02](02-flow-register.svg)).

### U8. Who enters results
#129 asks for "results agreed by both sides where the format has two sides".
- **A.** The crew enters every result, autofilled from the voice roster (the legacy), on the desk or the crew phone.
- **B.** Each side reports and the other confirms; a dispute goes to the crew.
- **C.** A, with B as a per-session setting for formats with two sides.
- **Recommendation: A for step 7, C later if wanted.** The legacy never had disputes because the crew scored; two-side reporting adds states, timeouts and a dispute queue for the rare serious match, which the Finals track covers with its own reporting. A player can "Report a problem" from the match page ([mockup 04](04-session-evening.svg)).

### U9. The check-in window
Check-in is off by default (0027). When on:
- **A.** Opens at T−15, closes at T−5, both settings; by the hub's button or the stage QR; the crew marks others present.
- **B.** Opens when registration closes, closes at T.
- **Recommendation: A.** The legacy's T−15 is when players gather and the voice rooms appear; closing at T−5 leaves five minutes to replace no-shows and still start on time ([mockup 11](11-lifecycle.svg)).

### U10. No-shows
With check-in on, at its close:
- **A.** Players not checked in are moved out; the waiting list moves up into their places (team: a substitute first, then the list); each gets a push (and a DM in step 6); the crew can undo until the session ends.
- **B.** The crew decides one by one.
- **C.** Only flagged; nothing moves.
- **Recommendation: A**, as #129 says. With check-in off nobody is a no-show; the legacy's 0-point "no-show" row stays for registrants who never played (from the roster). A team below its size after replacements goes to the crew (E7).

### U11. The final
The legacy flagged one session as the final; finalists were picked outside the system and validated against the leaderboard.
- **A.** The final's size is a setting (top 10 by default); the module proposes the cut from the standings and the tie-break chain, an organiser confirms it (finalists notified), and the final's ranks lead the standings once scored.
- **B.** The organiser picks finalists by hand, as the legacy.
- **Recommendation: A.** The rule is the legacy's; only the picking moves into the system, with the crew's confirmation ([mockup 08](08-standings-and-final.svg)). **Contract:** `tournament.final.confirmed` (finalists; personal).

### U12. Players without an account
Every account is a Discord account (0027), but a walk-in friend may have none.
- **A.** The crew adds a guest by name; a guest Person has its own id and no user id; the crew marks them present; they never scan a QR or get a push.
- **B.** Only members can play.
- **Recommendation: A.** The lead's note asks for it; the catalog's Person already allows `user_id: null`. Each guest is a row, so two people with one nickname never merge (the legacy's `lower(name)` bug).

### U13. The match page
- **A.** The match page shows the opponents, where (a stage or station), the voice rooms, an optional lobby id and password hint, the state and the result; "Report a problem" opens a note to the crew.
- **B.** Only the opponents and the time.
- **Recommendation: A**, as the App track's mockup 12 drew it. Calling a match sets where and the lobby id ([mockup 09](09-crew-phone.svg)). **Contract:** `where`, `lobby_id`, `voice_channels` on the Match (D8).

### U14. The crew phone
- **A.** The desk works at 390 px: what to do next first, then what needs the crew, the stage QR, mark present, a quick result, the champion photo.
- **B.** A separate crew app.
- **C.** Desk only.
- **Recommendation: A.** One page that reflows, as step 5's crew Food page; the stage crew rarely has a laptop.

### U15. Spectators
- **A.** Standings, a live session and the champions page are readable by anyone at the event (members and guests of the hub), without signing in.
- **B.** Members only.
- **C.** Public on the internet.
- **Recommendation: A.** Public results are a non-goal for this round (roadmap); inside the event they are the point.

### U16. Champions page
- **A.** One page per event: the final's top three with photos, then each session's winner, kept after the event.
- **B.** A hall of fame across the series.
- **Recommendation: A** now; B is a roadmap note for the series (step 8's clone and series).

### U17. Walk-ins
The legacy added "present, not registered" players from the roster at scoring.
- **A.** The roster flags them; the crew may add them as registered with one tap (the legacy's `add_as_registered`).
- **B.** Never: only registrants score.
- **Recommendation: A**, flagged and never automatic ([mockup 07](07-results-and-corrections.svg)).

### U18. What the bot needs from the module
Step 6 (#123) builds the bot's tournament side against the catalog.
- **A.** The bot's `/tournament register`, `schedule`, `my-registrations` and `leaderboard` link to or read the module's API with the person's rights; its DMs follow the same events as Notify.
- **B.** The bot keeps its own registration flow.
- **Recommendation: A**, as the catalog says ("bot admin commands that change tournament data are API calls made with the person's rights").

## L · Look and feel

### L1. Where the tournament lives in the hub
- **A.** A Tournament page in the hub's frame, reached from Play, For you, the session's run-of-show item and the screen's QR.
- **B.** Under More only (the App track's mockup 09).
- **Recommendation: A.** Players look for it under Play; More keeps "My matches" as a shortcut.

### L2. The organiser pages
- **A.** One Tournament entry in "Run the event": tabs Sessions, Standings and final, Players and teams, Settings; each session opens its desk (Desk, Matches, Players and teams, Results, History).
- **B.** One long page per session, as the legacy.
- **Recommendation: A.** Sessions and matches are card grids at card size, players and history stay tables, crew actions in one band above (amendment 3) ([mockup 05](05-sessions.svg), [06](06-session-desk.svg), [15](15-grids.svg)).

### L3. The screen during a session
- **A.** The Pulse shows the bracket (when the session has rounds) or the standings as the hero, with the check-in QR while it is open; Moments' rules and presets do the peaks.
- **B.** The legacy's leaderboard pin from T−15 to T+10.
- **Recommendation: A.** The Director already orders `bracket` and `leaderboard` first; step 4 rebuilt the pin as Starting soon and Match called ([mockup 10](10-venue-screen.svg)).

### L4. Match called on the screen
- **A.** Moments' built rule (and preset 3): the teams, where, the voice rooms and a countdown, 30 s, then the rail until the match starts.
- **B.** Only a rail card.
- **Recommendation: A**, built; step 7 fills `voice_channels` and `where` (D8).

### L5. The champion moment
- **A.** Moments' Champion preset on the final's result: sting, winner card with the photo, the bracket, a QR to the photos.
- **B.** A plain standings update.
- **Recommendation: A**, built; the crew takes the photo first, or the card falls back to the occasion photo, then to none (the legacy order).

### L6. Game art
- **A.** From the games catalogue's cover, when the session's game is linked; the organiser may upload one.
- **B.** A Steam store URL per session, as the legacy.
- **Recommendation: A.** Screen's Pulse hero already reads the catalogue's cover for `game`.

### L7. Names on the screen
- **A.** Display names by default; a setting for initials only; a player who hides their name from screens is shown as "Player 7".
- **B.** Always full names.
- **Recommendation: A**, as the App track's privacy flags suggest. Team names are always shown.

### L8. The rules page
- **A.** The organiser writes it as text; points, ties and the final's size are inserted from the settings.
- **B.** Free text only, as the legacy.
- **Recommendation: A.** The page never disagrees with the scores ([mockup 14](14-follow-and-champions.svg)).

### L9. When results show
- **A.** Each match's result shows when saved; the session's points when the session ends.
- **B.** Everything at the end, for a reveal.
- **Recommendation: A**, with the reveal as a crew spotlight of the standings when the crew wants a moment.

## D · Data and integrations

### D1. Tournaments, sessions, matches
- **A.** Tournament → Session → Match → Result, with Team and Registration; one tournament per event by default, several allowed.
- **B.** Sessions only, as the legacy's one implicit season.
- **Recommendation: A.** The catalog already has `tournament_id` and matches; TB4 asked for a season id from the start. **Contract:** the Tournament (`id`, `name`) (P8).

### D2. Formats and points
- **A.** Three shapes: solo, teams, final. Points per placement are an event setting (3, 2, 1, 0 by default) with an optional bonus; a session may override.
- **B.** Points by rank for solo games (for example 10, 8, 6 …).
- **Recommendation: A**, with B as a later option. Coarse placements are why any game fits; a per-rank table invites arguments about game modes.

### D3. Standings and tie-breaks
The legacy sorted by points only.
- **A.** Points, then more first places, then more sessions played, then a tie-break game the crew records.
- **B.** Points, then the earlier registration.
- **Recommendation: A.** The rules page already asked for tie-break games; this makes the last step a record, not a guess. **Contract:** `tie_break` on a standings row.

### D4. The voice handshake
- **A.** As the catalog: `tournament.scoring.started` → the bot's `bot.voice_roster.captured` (members with `dwell_seconds`); `bot.voice_channels.created` and `.removed`. The qualifying dwell (10 minutes) is a tournament setting sent with `scoring.started`.
- **B.** The tournament reads the bot's live voice API.
- **Recommendation: A.** The handshake is outlined and built on the consumer side; one setting moves from the bot's env into the event. **Contract:** `dwell_seconds_min` on `tournament.scoring.started`.

### D5. Presence opt-out and check-in
Review finding 1 of #137: does a tournament check-in count as presence data under the opt-out?
- **A.** A check-in the player makes is an action, not tracking: it is allowed under the opt-out, stored as presence data (deleted 30 days after archiving) and never on the bus beyond counts and the player's own events.
- **B.** The opt-out blocks check-in; the crew marks such players present.
- **Recommendation: A.** The opt-out is about being watched (voice rosters, who plays what); refusing a button the player presses would punish them. Opted-out players are still left out of voice rosters and ticked by hand ([mockup 12](12-edge-states.svg)).

### D6. Check-in through Notify
- **A.** The hub's button and the stage QR both go through Notify's check-in with purpose `tournament:<session id>`; the module consumes `notify.checkin.recorded`, checks the session and the registration, and emits `tournament.player.checked_in`.
- **B.** The button posts to the tournament directly; only the QR goes through Notify.
- **Recommendation: A.** One path, already built and tested in Notify; the button calls the same API without the code (a check-in the module requests on the player's behalf, with their session).

### D7. Corrections and the history
- **A.** A result is versioned; a correction needs a reason, emits `tournament.result.corrected` with the whole new list, recomputes the standings and shows a note on the match; the session's History lists every crew and scheduler action.
- **B.** Corrections overwrite, with an audit row only.
- **Recommendation: A**, as #129 says ([mockup 07](07-results-and-corrections.svg)). Corrections stay open until the event is archived; after the final is crowned they need `tournament.final.manage` (E5).

### D8. The built contracts' gaps
The brief lists six gaps between the catalog and its built consumers (Moments' `{session.name}` and `{winner.name}`, Screen's `teams_left`, `match_called.voice_channels`, the tournament's name, the call's where and lobby id).
- **A.** Add the fields in #127's contract (additive), and fix the consumers in the package that first emits.
- **B.** Change the consumers to work with the outline as it is.
- **Recommendation: A.** Each field has a real use on a screen or a phone; none renames anything. **Contract:** Session `name`, `tournament`, `teams_left`; Result `name`; Match `where`, `lobby_id`, `voice_channels`.

### D9. Photos
- **A.** Four slots per final (winner, second, third, the moment), in the tenant's files volume, taken on the crew phone or uploaded; a consent tick before saving; deleted with the player's data on request.
- **B.** As the legacy (a BLOB column).
- **Recommendation: A.** Containers keep no state; photos of people are personal data.

### D10. The hub's reads
- **A.** `GET /api/tournament/me/matches` (my sessions and matches with state, where and when) and `GET /api/tournament/me/summary` (For you cards); pages update by server-sent events from the module, keyed by the session's `revision`.
- **B.** Pages poll.
- **Recommendation: A**, as step 5 settled for pizza. **Contract:** both endpoints and the stream.

### D11. Pushes and DMs
- **A.** Notify's tournament topic as declared (registration opened; check-in opened; match called, urgent), plus "you moved up", "you're out (no-show)" and "session moved or cancelled" in the personal part; the bot's DMs (step 6) follow the same events.
- **B.** Only what Notify declares today.
- **Recommendation: A.** Each added push answers a question the player would otherwise ask the crew. **Contract:** triggers added to the topic (notify.md, additive).

### D12. Rights
- **A.** `tournament.sessions.write`, `tournament.desk.run`, `tournament.players.manage`, `tournament.results.write`, `tournament.final.manage`; a `tournament_crew` preset; settings through `admin.settings.write`.
- **B.** One `tournament.manage` right.
- **Recommendation: A** ([mockup 13](13-settings-and-rights.svg)). The stage crew can run the desk without editing sessions; defined and tested in #127 (high), so the other packages stay normal.

### D13. Seeding
- **A.** From the event series' earlier results (#150's series) when the session has rounds, else from this event's standings, else random; the crew may reorder.
- **B.** Manual only.
- **Recommendation: A**, as #129 asks. Seeding only matters where there are rounds (U1); for a one-match session it is the order of the list.

### D14. Clone and series
- **A.** `POST /api/tournament/clone` copies the tournament, its sessions (shifted) and settings, not registrations, teams or results (tenants contract).
- **B.** No clone in step 7.
- **Recommendation: A.** The tenants contract already has every module clone; the agenda expects the tournament's own clone to bring the sessions back.

### D15. The games catalogue
- **A.** A session links a catalogue game (`game.id`) when there is one; otherwise a name only.
- **B.** Name only.
- **Recommendation: A**, as the catalog's Session already allows; the cover and the hot-game link come with it.

### D16. Export and personal data
- **A.** `GET /api/tournament/me/export` and `DELETE /api/tournament/me` (registrations, check-ins, results as the player's own); anonymisation after 12 months keeps counts and totals.
- **B.** Later, with the privacy centre.
- **Recommendation: A.** The contract convention requires both; the App track's privacy centre reads them.

## E · Edge cases and failure

### E1. Races
Two players take the last place; two players join a team with one place left; the crew saves a result while another corrects it.
- **Recommendation:** every write in one transaction under `SELECT … FOR UPDATE` on the session (and the team), an idempotency key on every POST, and a race test for each case (#127's criterion). No options: the roadmap fixes it.

### E2. A session moves
- **A.** On `agenda.item.delayed` the module moves the start and keeps the close's offset (the legacy's `computePostpone`), only while the times still match the item's; registrants get a push; places are kept.
- **B.** The organiser moves sessions by hand.
- **Recommendation: A**, as agenda.md says ([mockup 12](12-edge-states.svg)). A move after check-in opened reopens nothing; the crew decides.

### E3. The bot is down
- **A.** Every step has a manual path: no voice rooms means results by hand; the desk shows the bot's health and a "ask the bot again".
- **B.** The session waits for the bot.
- **Recommendation: A.** The legacy's worst failure was a bot that held registration open; the scheduler now owns the times.

### E4. The module restarts mid-session
- **Recommendation:** the scheduler keeps due rows in Postgres and catches up on start (the bot's `_should_catch_up_vc_create` rule as the spec): a missed close closes, a missed reminder is skipped when late, a missed call is never sent twice.

### E5. A correction after the final cut
- **A.** Allowed with `tournament.final.manage`; the standings change, but confirmed finalists stay unless the organiser re-confirms.
- **B.** Locked once finalists are confirmed.
- **Recommendation: A.** Wrong results should be fixable; the final's field should not shift under players who were told they are in.

### E6. A called team does not come
- **A.** The crew decides: wait, forfeit or rematch; no automatic forfeit.
- **B.** Auto-forfeit after a timer (matchmaking services).
- **Recommendation: A.** A LAN party's timing is soft; a timer the crew forgets is worse than a decision.

### E7. A team short at the close
- **A.** It goes to the crew: fill from solo players (U6), play short, or move to the waiting list.
- **B.** Dropped automatically.
- **Recommendation: A** ([mockup 03](03-teams.svg)).

### E8. A team member leaves mid-session
- **Recommendation:** the substitute steps in, or the team plays short; points go to whoever played (the roster), not to everyone registered.

### E9. A session cancelled or ended early
- **A.** Cancelled: no points, registrants told with the crew's reason. Ended early: results saved so far count.
- **B.** Cancelled sessions keep 1 point for showing up.
- **Recommendation: A**, as the catalog's `status` distinguishes them.

### E10. Overlapping sessions
- **A.** Warn, never block; the crew sees overlaps on the desk.
- **B.** Block.
- **Recommendation: A.** Players often play two things in an evening ([mockup 12](12-edge-states.svg)).

### E11. A check-in by someone not registered
- **Recommendation:** Notify records it (it does not know registrations); the module ignores it for the session and the hub says "You're not registered for this session". No event.

### E12. Duplicate events
- **Recommendation:** every consumer applies by `revision` or id (at-least-once delivery, the catalog's rule); the module's own consumers (check-ins, rosters, delays) are idempotent by the event id.

### E13. The format mix-up bug and other legacy bugs
#129 asks for a regression test of "the legacy's format mix-up bug". The inventory's only format bug (summary N10, "a full season could take a wrong format") is the mini tourney's `four`/`fourqc` capacity lookup, which is the Finals track's code.
- **A.** Move that test to the Finals track; in step 7, add regression tests for this module's own legacy bugs: the first room pre-picked as the winner, the close time that differed by path, dates compared as strings, name-keyed identity merging two players, no tie-break.
- **B.** Keep the criterion and ask the author which bug was meant.
- **Recommendation: A**, unless the product owner remembers a tournament-side format bug.

### E14. The uplink drops
- **Recommendation:** screens keep the last standings and bracket (Screen, built); the crew's phones on the venue Wi-Fi lose the desk too, so the crew phone shows "offline, last updated 19:31" and queues nothing.

### E15. A tie in the final itself
- **Recommendation:** the final's ranks must be unique (the legacy rule); a tie is played off and the crew records the order.

## O · Operations and scale

### O1. The scheduler
- **A.** A scheduler in the container with due rows in Postgres, taken with `FOR UPDATE SKIP LOCKED`, as step 5's plan settled for pizza; it publishes the timeline and survives restarts and replicas.
- **B.** Cron.
- **Recommendation: A** (#127's criterion).

### O2. Scale: the large event
About 1,000–2,000 attendees: a session of 64 players or 16 teams, several sessions an hour on several stages.
- **Recommendation:** standings recomputed incrementally per saved result; `tournament.leaderboard.changed` carries the top 10 only; pages read the full standings from the API. A load test is the backlog's load harness, not step 7.

### O3. Timeline defaults
- **A.** Reminder T−60, close T−30, check-in T−15 to T−5, voice rooms T−15, cleanup backstop T+3 h; each an event setting, a session may override the close and check-in.
- **B.** Close at T−60 (the site's default).
- **Recommendation: A** ([mockup 13](13-settings-and-rights.svg)). The bot's 30 minutes was what players were told.

### O4. Time zone and event days
- **Recommendation:** the event's time zone for every time shown and every day heading; a day turns at 06:00, as step 5 settled, so a 01:00 session sits under Saturday night.

### O5. Several stages at once
- **A.** `where` on a match (a free name from a per-event list), and the desk filters by place.
- **B.** Stations as entities.
- **Recommendation: A.** A name is enough for a call and a screen; stations can follow if events need them.

### O6. Retention
- **Recommendation:** registrations, results and standings lines are personal data, anonymised after 12 months (counts and totals stay); check-ins and voice rosters are presence data, deleted 30 days after archiving (tenants contract).

### O7. Demo data
- **Recommendation:** `events/demo/` gets a Demo Game Cup with five sessions (solo, team, rounds, a final), demo players and teams, loaded by the profile; the demo stack's screenshots show every view in this pack.

### O8. The manual path
- **Recommendation:** a short crew runbook in the module's README: what to do when the bot, Notify or the uplink is down, all from the desk.

### O9. Copy from the last event
- **Recommendation:** the Sessions page's "Copy from the last event" calls the clone (D14) for an event in the same series; it shows what will be copied first.

### O10. After the event
- **A.** A CSV of the standings and every result for the organiser; the champions page stays.
- **B.** Nothing.
- **Recommendation: A.** The legacy had none; organisers post results after events.

## P · Plan and scope

### P1. The direction
- **A.** The LAN cup, ported. **B.** Brackets everywhere. **C.** The cup, live.
- **Recommendation: C** (the brief argues it).

### P2. The issue set
- **A.** Keep #127, #128 and #129 as written.
- **B.** Rewrite them and add two: the player's pages in the hub, and the tournament on the screens and in Notify (the brief's proposal).
- **Recommendation: B.** It keeps the high-risk package (#127) small and the rest normal, and it puts the whole venue in the step's exit.

### P3. The exit criterion
- **A.** "A test tournament runs end to end" as it stands.
- **B.** The brief's concrete run on the demo event with a fake bot: register, a team, a waiting list, check-in, a called match on a phone and a screen, results, a correction, the standings live, a crowned final.
- **Recommendation: B.** It is testable in CI's demo stack.

### P4. Brackets in step 7
#127's Out of scope says "brackets for any game (the Games track)"; experience-map.md says the tournament's bracket is "to be planned later".
- **A.** No brackets: one match per session.
- **B.** Matches and rounds as data (0027 allows them), "winners advance" fills the next round, the crew edits any match; Screen's `bracket` widget draws them. No elimination engine, no double elimination.
- **C.** A bracket engine in the module.
- **Recommendation: B.** It is what the catalog and Moments' Round start already expect, and what the screen design draws; an engine stays the Finals track's.

### P5. The screen and hub feed in step 7
Step 9 is to wire tournament events into Screen.
- **A.** Feed Screen's `bracket` and `leaderboard` and `checkin_qr` in step 7 (a new issue), and register Notify's topic.
- **B.** Leave them to step 9.
- **Recommendation: A**, as step 5 did for food. Moments and the templates are built; without the feed, the exit "runs end to end" stops at the admin page.

### P6. The bot's side and the order
- **Recommendation:** #123 (step 6) builds against the catalog with contract tests; #128's end-to-end test uses a fake bot that answers `scoring.started` with a roster; the live handshake is checked when #123 lands (OC8).

### P7. The hub pages
- **Recommendation:** the tournament owns its pages in the hub's frame (App track P4, A), in their own issue, so they can run beside #128.

### P8. Several tournaments per event
- **A.** One by default; a second ("Demo Kids Cup") is possible from the start, each with its own standings.
- **B.** Exactly one per event.
- **Recommendation: A.** TB4's "a season id from the start" costs one column and one select; the screens show the tournament of the running session.
