# Step 7 question bank

Every open question the research for [the step 7 brief](../step-7-tournament.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#126). IDs are stable, so the session can answer "U2: C" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope · **F** Finals beside the tournament (added for 0030). **Later: mini tournaments (after version 1)** at the end holds the questions that wait: kept, not asked now.

> **Revised for [0030](../../decisions/0030-finals-integrated-one-tourney-core.md) (2026-11-20, #682) and the product owner's lead round (2026-11-21, decision 0031, recorded in #695).** Finals is integrated as it is and stays apart; one tourney core is the engine of the cup, and it is still built fully general in step 7. Mini tournaments for any game wait until after version 1; the questions about them moved to [Later](#later-mini-tournaments-after-version-1). The earlier questions and their answers stay as they were. Where the core changes a question, a last bullet **Changed for 0030** says what changed and gives the recommendation now; a question the 0030 revision changed only for mini tournaments is back to its accepted answer, with one line saying so; new questions start with **New for 0030**. The core's design is the core plan of #681 (`docs/plans/tourney-core.md`, in PR #688 while this is written): its parameters, its API and THE FINALS preset; "the core plan" below means it.
> - **Changed (the core):** U1, U6, L2, L3, L5, D2, D3, D13, E13, P1, P2, P3, P4.
> - **Back to the accepted answer:** U8, U16, U18, D12, D15, D16, O6, P5.
> - **New:** D18, P9, F1 (F1 was M12).
> - **Changed by the lead round of 2026-11-21 (the second: the product owner reviewed the plan against that day's tournament and made six decisions):** U5 (no waiting list), U7, U10, E7, D11 (the waiting list goes), E2 (a manual delay), D2 (the scoring system is editable), D12 (a lead and a crew), P3. **New:** U19 (reopen registration for a while), D20 (named awards).
> - **Later:** D17, D19, O11 and M1–M11, M13–M15.

**Decide first** (they change the most): P1 (the direction), U1 (the competitive shape), U2 (solo, teams or both), P4 (brackets in step 7), U8 (who enters results), U9 and U10 (check-in and no-shows), P2 (the issue set), P5 (the screen and hub feed in step 7). Since 0030 also: F1 (where Finals and Tournament meet).

**Decided in the lead round of 2026-11-21 (the second):** no waiting list: places per session stay optional and off by default, and a full session shows "Full" (U5); the crew can reopen a closed session's registration for a while (U19); the crew can delay sessions by hand (E2); the tournament has a lead and helpers (D12); named awards such as MVP add points (D20); the lead edits the scoring system (D2). Each is folded into its question below as the answer, not asked again.

**Already decided, so not asked again:** check-in is optional, off by default, set per tournament and switchable per session, and matches inside a session are optional ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md), the catalog); the tournament builds on the signup site's code, not the tourney core, and the mini tourney is the Finals track's ([0025](../../decisions/0025-finals-and-games-modules.md); **superseded by 0030**, see below); registration lives in the module ([0005](../../decisions/0005-signup-site-stays-outside.md)); no tournament history is migrated ([0004](../../decisions/0004-nothing-migrated.md)); sign-in instead of tokens in URLs ([0010](../../decisions/0010-scope.md)); every account is a Discord account and attendees join by venue, link or QR (0027); one standings table across all competitions is backlog ([0022](../../decisions/0022-product-vision.md)); sessions appear in the run of show through the agenda's mirror, and the module follows `agenda.item.delayed` ([agenda.md](../../../contracts/agenda.md#tournament-sessions)).

**Decided since, by [0030](../../decisions/0030-finals-integrated-one-tourney-core.md):** the tourney core (finals-core generalised, THE FINALS one preset of it) is the one engine for brackets, team forming and scoring, and this module takes it as a pinned dependency; the Finals app is integrated as it is, keeps its own look and data, and a Finals champion adds no Tournament points. Not asked again either.

**Decided since, by the product owner's lead round (2026-11-21, decision 0031, recorded in #695):** mini tournaments for any game wait until after version 1 (the questions are kept under [Later](#later-mini-tournaments-after-version-1), not asked now); the THE FINALS mini tourney is integrated from day 1 as the Finals track's, unchanged; the core is still built fully general in step 7 and the cup runs on it; each game's competition rules (Games) and the rosters and rounds for casual play wait with the mini tournaments, because the cup needs neither (a session's team size and format are set by the organiser); and **things planned in time are a day schedule, not a card grid**: one day at a time, times down the side, items in time order like the run of show of `modules/agenda/src/canccu_agenda/day_view.py`, with a day picker, and the same list at phone width; a card grid stays only for like items with no time order.

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive (new fields, endpoints, events or settings), so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)). None removes or renames a name in the catalog's outlines.

## U · Who uses it and how

### U1. The competitive shape
The legacy is a season: sessions in many games, coarse placements, points, a final. Esports platforms are brackets.
- **A.** The season only: one match per session, placements and points (direction A).
- **B.** Brackets for every session (direction B).
- **C.** The season as the spine; inside a session, matches and rounds are an option (heats, rounds, a small knock-out), drawn as a bracket on the screen (direction C).
- **Recommendation: C.** Any game fits the season because placements are coarse; rounds give the screen its bracket and Moments' Round start a reason to fire, without an engine (P4).
- **Changed for 0030:** The core now gives the bracket: "rounds without an engine" becomes rounds filled by the core's `next`, and a full bracket (single elimination, groups then knock-out) costs a template, not a module engine. **Recommendation now: C**, with each session choosing placements only (the default, as the legacy) or a bracket from the core ([P4](#p4-brackets-in-step-7)).

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

### U5. Capacity
**Decided (lead round, 2026-11-21): places optional, no waiting list.** The legacy had no capacity and no waiting list, and the product owner keeps the list out.
- **A.** Places per session (players or teams), optional and off by default, as today; a full session just shows "Full".
- **B.** No capacity, as the legacy.
- **Recommendation: A**, the decided answer. A freed place (a player gives up, U7) is open for the next to register while registration is open; once it is closed the crew may reopen it for a while ([U19](#u19-reopening-registration-for-a-while)). **Contract:** `places` on the Session; no `waiting_count`, and no `tournament.player.waitlisted` or `.promoted` events. ([Mockup 02](02-flow-register.svg).)
- **Changed by the lead round:** the earlier option "a waiting list that moves up by itself, with a push" is dropped everywhere: the `waiting_count` field, the two events, the "moved up" push and replacing no-shows from a list at the close of check-in (U10, U7, E6, E7).

### U6. Solo players in a team session
- **A.** They register alone; at the close the crew places them on short teams, by hand or by "fill from the standings" (balanced by points).
- **B.** Random teams made by the module at the close.
- **C.** Not allowed: a team session needs a team.
- **Recommendation: A.** The crew knows who sits together; a balanced fill is one button, not a rule. Random teams surprise friends sitting side by side.
- **Changed for 0030:** B no longer means a random draw: the core's team builder makes balanced teams (the most even sums). **Recommendation now: A**, and the crew's "fill" button calls the builder. Its input is one number per player: the player's season points so far, which the builder sums like a rating (it needs no rating scale). At the first session everyone has 0, so the fill is then a seeded shuffle, not a balance. The builder needs a player count that is a multiple of the team size, so the button fills the teams that complete and leaves the rest to the crew (E7). The seed is stored, so a fill is repeatable. Random teams still never form by themselves in an official session.

### U7. Giving up a place
- **A.** "I can't make it" until the close frees the place at once; after the close it asks the crew (the legacy's wording), and before the start the crew can still free the place or reopen registration ([U19](#u19-reopening-registration-for-a-while)).
- **B.** Free until the start.
- **Recommendation: A.** Matches are made at the close; a late drop-out needs a person to decide ([mockup 02](02-flow-register.svg)).
- **Changed by the lead round:** there is no list to promote from; a freed place is simply open again while registration is open, and the crew may reopen it ([U19](#u19-reopening-registration-for-a-while)).

### U8. Who enters results
#129 asks for "results agreed by both sides where the format has two sides".
- **A.** The crew enters every result, autofilled from the voice roster (the legacy), on the desk or the crew phone.
- **B.** Each side reports and the other confirms; a dispute goes to the crew.
- **C.** A, with B as a per-session setting for formats with two sides.
- **Recommendation: A for step 7, C later if wanted.** The legacy never had disputes because the crew scored; two-side reporting adds states, timeouts and a dispute queue for the rare serious match, which the Finals track covers with its own reporting. A player can "Report a problem" from the match page ([mockup 04](04-session-evening.svg)).
- **Back to its accepted answer** (A for step 7, C later): the 0030 change rested on the mini tournaments' reports and queue, which wait until after version 1.

### U9. The check-in window
Check-in is off by default (0027). When on:
- **A.** Opens at T−15, closes at T−5, both settings; by the hub's button or the stage QR; the crew marks others present.
- **B.** Opens when registration closes, closes at T.
- **Recommendation: A.** The legacy's T−15 is when players gather and the voice rooms appear; closing at T−5 leaves five minutes to replace no-shows and still start on time ([mockup 11](11-lifecycle.svg)).

### U10. No-shows
With check-in on, at its close:
- **A.** Players not checked in are marked no-show (0 points); each gets a push (and a DM in step 6); the crew can undo until the session ends. Nobody is replaced from a list; the crew may reopen registration ([U19](#u19-reopening-registration-for-a-while)) to fill places, and a team gets a substitute from its own roster first.
- **B.** The crew decides one by one.
- **C.** Only flagged; nothing moves.
- **Recommendation: A**, as #129 says. With check-in off nobody is a no-show; the legacy's 0-point "no-show" row stays for registrants who never played (from the roster). A team below its size after a no-show goes to the crew (E7). **Changed by the lead round:** the waiting list no longer moves up at the close of check-in.

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
- **Back to its accepted answer** (A): the 0030 change added mini tournament champions, which wait; the Finals app keeps its own champions page, linked from the hub's Finals tile, and this page never lists it.

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
- **Back to its accepted answer** (A): the 0030 change added mini tournaments to `/tournament`, which wait; `/finals` stays the Finals app's command, through its provider contract.

### U19. Reopening registration for a while
**New for the lead round (2026-11-21).** The legacy had a reopen on its admin page; its logic is ported.
- **A.** A crew action on a closed session: "Reopen registration" until a time or for N minutes, and "Close now". It closes by itself through the scheduler; registrants and the tournament's followers get a push ("Registration for {session} is open again until {time}"); the screen and the hub show it; the session's history records who reopened it and until when.
- **B.** The organiser edits the close time of the session by hand.
- **Recommendation: A** (decided; [mockup 20](20-reopen-and-delay.svg)). It replaces the waiting list as the way to fill a late place (U5, U10, E7). The legacy's reopen logic is ported, and the close is a due row in the scheduler like the others (O1). Right: `tournament.desk.run`. **Contract (additive):** `registration_reopened_until` (string or null) on the Session; a new event `tournament.registration.reopened` (event-wide, `public`, for followers and the screen, and personal to the session's registered players; `data`: `session`, `until`, `actor_user_id`), declared as a trigger of Notify's `tournament` topic ([D11](#d11-pushes-and-dms)); the automatic close emits the catalog's existing `tournament.registration.closed`; `POST /api/tournament/sessions/{id}/registration/reopen` (`until` or `minutes`) and `/close`. The alternative, a `reopened_until` field on `tournament.registration.opened`, would reuse Notify's declared trigger but blurs a first opening with a reopening, so the pack recommends the new event.

## L · Look and feel

### L1. Where the tournament lives in the hub
- **A.** A Tournament page in the hub's frame, reached from Play, For you, the session's run-of-show item and the screen's QR.
- **B.** Under More only (the App track's mockup 09).
- **Recommendation: A.** Players look for it under Play; More keeps "My matches" as a shortcut.

### L2. The organiser pages
- **A.** One Tournament entry in "Run the event": tabs Sessions, Standings and final, Players and teams, Settings; each session opens its desk (Desk, Matches, Players and teams, Results, History).
- **B.** One long page per session, as the legacy.
- **Recommendation: A.** Sessions and matches are card grids at card size, players and history stay tables, crew actions in one band above (amendment 3) ([mockup 05](05-sessions.svg), [06](06-session-desk.svg), 15 (the card-grid mockup, replaced by 15-day-schedule)).
- **Changed for 0031 (the day schedule rule):** Sessions and a session's matches are things planned in time, so they are no longer card grids. **Recommendation now: A**, with sessions and a session's matches as a day schedule: one day at a time, times down the side, items in time order like the run of show, with a day picker, and the same list at phone width. Players and history stay tables, crew actions sit in one band above ([mockup 05](05-sessions.svg), [06](06-session-desk.svg), [15](15-day-schedule.svg)).

### L3. The screen during a session
- **A.** The Pulse shows the bracket (when the session has rounds) or the standings as the hero, with the check-in QR while it is open; Moments' rules and presets do the peaks.
- **B.** The legacy's leaderboard pin from T−15 to T+10.
- **Recommendation: A.** The Director already orders `bracket` and `leaderboard` first; step 4 rebuilt the pin as Starting soon and Match called ([mockup 10](10-venue-screen.svg)).
- **Changed for 0030:** The Finals app can run beside a session. **Recommendation now: A**, with the order in [F1](#f1-where-finals-and-tournament-meet): the official session leads the Pulse while it runs; a Finals card never shares a widget with the tournament.

### L4. Match called on the screen
- **A.** Moments' built rule (and preset 3): the teams, where, the voice rooms and a countdown, 30 s, then the rail until the match starts.
- **B.** Only a rail card.
- **Recommendation: A**, built; step 7 fills `voice_channels` and `where` (D8).

### L5. The champion moment
- **A.** Moments' Champion preset on the final's result: sting, winner card with the photo, the bracket, a QR to the photos.
- **B.** A plain standings update.
- **Recommendation: A**, built; the crew takes the photo first, or the card falls back to the occasion photo, then to none (the legacy order).
- **Changed for 0030:** Two champions now reach the screen: the official final's and the Finals app's. **Recommendation now: A** for the official final; a Finals champion keeps the app's own graphics and theming (0030 point 1) and is the Finals track's ([F1](#f1-where-finals-and-tournament-meet)).

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
- **A.** Three shapes: solo, teams, final. Points per placement are an editable table in the tournament's settings (3, 2, 1, 0 by default: 1st, 2nd, took part, no-show); more places can be added (3rd, 4th …); a session may override the table.
- **B.** Points by rank for solo games (for example 10, 8, 6 …).
- **Recommendation: A, editable, with B available** (decided in the lead round, 2026-11-21). Coarse placements are why any game fits, and the core supports a per-rank table as data, so B is a choice of the table's shape, not code. **Who:** the tournament lead edits the table in settings (right `tournament.settings.write`, [D12](#d12-rights)). **Changing it after results exist** recalculates the standings, asks for a reason (shown on the rules page and kept in the History) and shows which standings change before saving. The rules page always shows the table in force ([mockup 19](19-crew-scoring-awards.svg)).
- **Changed for 0030:** Points are the core's scoring tables (`points` with `{ranks, rest, no_show}`), so B is a table in data, not code. The season's default table is 3, 2, 1, 0 and a session may override it.
- **Changed by the lead round:** the table is editable by the lead, with a reason and a recalculation; the plain "bonus" is replaced by named awards ([D20](#d20-awards)).

### D3. Standings and tie-breaks
The legacy sorted by points only.
- **A.** Points, then more first places, then more sessions played, then a tie-break game the crew records.
- **B.** Points, then the earlier registration.
- **Recommendation: A.** The rules page already asked for tie-break games; this makes the last step a record, not a guess. **Contract:** `tie_break` on a standings row.
- **Changed for 0030:** The standings and their tie-break chain are the core's `standings` (chain `points`, `firsts`, `played`, `tie_break`), whose ranks are also the final's cut. **Recommendation now: A**, computed by the core; the module keeps the crew's recorded tie-break order.

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
- **A.** Notify's tournament topic as declared (registration opened; check-in opened; match called, urgent), plus "registration open again" (a reopening, to registrants and the tournament's followers), "you're out (no-show)" and "session moved or cancelled" in the personal part; the bot's DMs (step 6) follow the same events.
- **B.** Only what Notify declares today.
- **Recommendation: A.** Each added push answers a question the player would otherwise ask the crew. **Contract:** triggers added to the topic (notify.md, additive).

### D12. Rights
- **A.** A tournament lead and a crew of helpers. Rights: `tournament.sessions.write`, `tournament.settings.write` (settings, the scoring system and the award types), `tournament.crew.manage` (who is in the crew, and the lead), `tournament.final.manage`, `tournament.desk.run` (check-in, call and start matches, reopen or delay a session), `tournament.players.manage` and `tournament.results.write` (results, corrections and awards). Presets `tournament_lead` (all of them) and `tournament_crew` (`desk.run`, `players.manage`, `results.write`, `notify.checkin.display`, the moments spotlight).
- **B.** One `tournament.manage` right.
- **Recommendation: A** ([mockup 13](13-settings-and-rights.svg), [mockup 19](19-crew-scoring-awards.svg)), decided in the lead round (2026-11-21). The **tournament lead** is the main responsible person, set per tournament by the organiser, named on the rules page and in the hub as the contact; they hold every tournament right. **Tournament crew** are helpers added by the lead or the organiser: they run the desk and the crew phone, check in, enter results and awards, and reopen or delay sessions; they do not change settings, the scoring system, the final or the crew. The settings page has a crew list (add or remove a helper, change the lead; `GET` and `PUT /api/tournament/crew`, additive). The event admin role still holds every right. Defined and tested in #127 (high), so the other packages stay normal.
- **Changed by the lead round:** the earlier answer had one `tournament_crew` preset and settings through `admin.settings.write`; the lead is new, and the settings and crew rights are the lead's. The `tournament.minis.manage` of the 0030 revision still waits with the mini tournaments.

### D13. Seeding
- **A.** From the event series' earlier results (#150's series) when the session has rounds, else from this event's standings, else random; the crew may reorder.
- **B.** Manual only.
- **Recommendation: A**, as #129 asks. Seeding only matters where there are rounds (U1); for a one-match session it is the order of the list.
- **Changed for 0030:** Seeds now feed the core's draw (arrangement `keep` for seeded rounds, `shuffle` with a stored seed otherwise), and a random seeding replays from its seed. **Recommendation now: A**, unchanged.

### D14. Clone and series
- **A.** `POST /api/tournament/clone` copies the tournament, its sessions (shifted) and settings, not registrations, teams or results (tenants contract).
- **B.** No clone in step 7.
- **Recommendation: A.** The tenants contract already has every module clone; the agenda expects the tournament's own clone to bring the sessions back.

### D15. The games catalogue
- **A.** A session links a catalogue game (`game.id`) when there is one; otherwise a name only.
- **B.** Name only.
- **Recommendation: A**, as the catalog's Session already allows; the cover and the hot-game link come with it.
- **Back to its accepted answer** (A): the 0030 change read a game's competition rules, which wait with the mini tournaments; the cup needs none, because a session's team size and format are set by the organiser, with or without a linked game.

### D16. Export and personal data
- **A.** `GET /api/tournament/me/export` and `DELETE /api/tournament/me` (registrations, check-ins, results as the player's own); anonymisation after 12 months keeps counts and totals.
- **B.** Later, with the privacy centre.
- **Recommendation: A.** The contract convention requires both; the App track's privacy centre reads them.
- **Back to its accepted answer** (A): the 0030 change added mini tournament sign-ups, reports and ratings, which wait.

### D18. The core as a dependency
**New for 0030.** The core is a pure library ([0030](../../decisions/0030-finals-integrated-one-tourney-core.md) point 3), pinned to a release.
- **A.** Pin the core's 2.0.0 tag; when a competition starts, store the built format (the core's data) and each draw's seed with it, so a running competition never changes under a later core version and every draw can be replayed.
- **B.** Store only the template and the entrant count, and rebuild the format with the core at each step.
- **Recommendation: A**, as the core plan has it. A core bump is a normal platform PR whose module tests run against it; THE FINALS preset's equivalence tests stay in the core's repo.

### D20. Awards
**New for the lead round (2026-11-21).** The legacy's plain "bonus" (a non-negative number added to a result) becomes named awards.
- **A.** The tournament lead keeps a list of award types in settings (default: MVP; examples: best play, sportsmanship), each with default points. The crew gives an award to a participant in a session, with editable points and an optional note; a participant may get several. Award points add to the session's points (the legacy's base plus a non-negative bonus, ported); the standings show the breakdown (placing + awards), and the player's page and the champions page show the award names.
- **B.** Keep one bonus number per result.
- **Recommendation: A** ([mockup 19](19-crew-scoring-awards.svg), [07](07-results-and-corrections.svg), [08](08-standings-and-final.svg), [14](14-follow-and-champions.svg)). Giving, changing or taking back an award is a **result change**: one transaction under the row lock, a History line, and the correction rules of [D7](#d7-corrections-and-the-history) (a reason to change one; after the final is crowned it needs `tournament.final.manage`, E5). The award types and their default points are the lead's (`tournament.settings.write`); giving one needs `tournament.results.write`. **Contract (additive):** `awards` (type, points, note) and `points_placing` on the Result (`points` stays the total, so no consumer changes) and `award_types` in the tournament's settings; `tournament-scores-bonus` stays as the points rule's test, now over awards.

## E · Edge cases and failure

### E1. Races
Two players take the last place; two players join a team with one place left; the crew saves a result while another corrects it.
- **Recommendation:** every write in one transaction under `SELECT … FOR UPDATE` on the session (and the team), an idempotency key on every POST, and a race test for each case (#127's criterion). No options: the roadmap fixes it.

### E2. A session moves
- **A.** On `agenda.item.delayed` the module moves the start and keeps the close's offset (the legacy's `computePostpone`), only while the times still match the item's; registrants get a push; places are kept.
- **B.** The organiser moves sessions by hand.
- **C.** A plus the manual delay: a crew action "Delay by N minutes" for one session, or for it and every later session that day, with the same effect.
- **Recommendation: C** (decided in the lead round, 2026-11-21: "A plus the manual delay", [mockup 20](20-reopen-and-delay.svg)). The close keeps its offset (`computePostpone`) either way; registrants get a push; the agenda item moves too, so the run of show stays one (the module asks the agenda to delay the item, and recognises the `agenda.item.delayed` that follows as its own change, already applied); places and check-ins are kept; History records it. The right is `tournament.desk.run`, so a helper can do it. **Contract (additive):** `POST /api/tournament/sessions/{id}/delay` (`minutes`, `scope`: `session` or `session_and_later`); it emits the catalog's `tournament.session.changed` (`changed` names the start and the close). A move after check-in opened reopens nothing; the crew decides.

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
- **A.** It goes to the crew: fill from solo players (U6), play short, or remove the team (registration may be reopened, U19, to bring a replacement).
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
- **Changed for 0030:** The core plan settles it: the `four`/`fourqc` fix is `formatForTeams` with its test in the core's 1.1.0 (its ticket C1), then the app's own fix, and the core's 2.0.0 that this module pins carries it. **Recommendation now: A**, unchanged; the format test lives in the core, and this module's own legacy bugs keep their regression tests here.

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
- **Back to its accepted answer:** the 0030 change added mini tournament data and ratings, which wait.

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
- **Changed for 0030:** The brief re-weighs the three directions with the core ([Re-weighed for 0030](../step-7-tournament.md#re-weighed-for-0030)). **Recommendation now: C**, with rounds and brackets from the core as its engine.

### P2. The issue set
- **A.** Keep #127, #128 and #129 as written.
- **B.** Rewrite them and add two: the player's pages in the hub, and the tournament on the screens and in Notify (the brief's proposal).
- **Recommendation: B.** It keeps the high-risk package (#127) small and the rest normal, and it puts the whole venue in the step's exit.
- **Changed for 0030:** **Recommendation now: B**, unchanged; the core itself is not a step 7 issue (its tickets live in the core's repo, the core plan's C1–C5), and no issue is added for mini tournaments, which wait.

### P3. The exit criterion
- **A.** "A test tournament runs end to end" as it stands.
- **B.** The brief's concrete run on the demo event with a fake bot: register, a team, a full session reopened for a while, check-in, a called match on a phone and a screen, results with an award, a correction, the standings live, a crowned final.
- **Recommendation: B.** It is testable in CI's demo stack.
- **Changed for 0030:** **Recommendation now: B**, plus one session played as a bracket from the core, so the exit shows the engine the cup runs on.

### P4. Brackets in step 7
#127's Out of scope says "brackets for any game (the Games track)"; experience-map.md says the tournament's bracket is "to be planned later".
- **A.** No brackets: one match per session.
- **B.** Matches and rounds as data (0027 allows them), "winners advance" fills the next round, the crew edits any match; Screen's `bracket` widget draws them. No elimination engine, no double elimination.
- **C.** A bracket engine in the module.
- **Recommendation: B.** It is what the catalog and Moments' Round start already expect, and what the screen design draws; an engine stays the Finals track's.
- **Changed for 0030:** C is gone as a cost: the core is the engine, and "winners advance" is the core's `next`. **Recommendation now: B, widened:** a session chooses **placements only** (one match for everyone, the default, as the legacy) or **a bracket from the core** (heats with winners advance, single elimination, or groups then knock-out, from the game's default format or the organiser's choice); the crew can still edit any match, and the core then builds the next round from the stored results. No double elimination in step 7.

### P5. The screen and hub feed in step 7
Step 9 is to wire tournament events into Screen.
- **A.** Feed Screen's `bracket` and `leaderboard` and `checkin_qr` in step 7 (a new issue), and register Notify's topic.
- **B.** Leave them to step 9.
- **Recommendation: A**, as step 5 did for food. Moments and the templates are built; without the feed, the exit "runs end to end" stops at the admin page.
- **Back to its accepted answer** (A): the 0030 change fed a running mini tournament's bracket and champion card, which wait.

### P6. The bot's side and the order
- **Recommendation:** #123 (step 6) builds against the catalog with contract tests; #128's end-to-end test uses a fake bot that answers `scoring.started` with a roster; the live handshake is checked when #123 lands (OC8).

### P7. The hub pages
- **Recommendation:** the tournament owns its pages in the hub's frame (App track P4, A), in their own issue, so they can run beside #128.

### P8. Several tournaments per event
- **A.** One by default; a second ("Demo Kids Cup") is possible from the start, each with its own standings.
- **B.** Exactly one per event.
- **Recommendation: A.** TB4's "a season id from the start" costs one column and one select; the screens show the tournament of the running session.

### P9. The core before the first build package
**New for 0030.** The core plan's tickets C1–C5 live in the core's own repo and end with its 2.0.0 tag, which step 7's packages pin; C4 (the templates) takes its defaults from this step's accepted plan.
- **A.** Step 7's first build package starts only after 2.0.0 is tagged; until then the module's packages may write their contract and model but no code that calls the core.
- **B.** The module starts on a pre-release of the core and moves to 2.0.0 later.
- **Recommendation: A**, as the core plan says: C1–C3 can run now, C4 right after this step's plan, so the wait is short, and the module is never built against an API that still moves.

## F · Finals beside the tournament

### F1. Where Finals and Tournament meet
**New for 0030** (was M12 in the first 0030 revision).
0030 keeps them apart: the Finals app has its own data, look and champions, and adds no points.
- **A.** **The screen:** never in one widget; a THE FINALS card (the app's bracket or champion, in its own graphics and theming) is its own claim, ranked below a live official session and the cup's Champion (55). **Moments:** a Finals champion is a moment of its own, started through the external-app hooks of the Apps track (#193), never by a `tournament.*` event; the official final's Champion stays Tournament's (`finals_result`). **The hub:** one Play list with the official tournament and a THE FINALS tile that opens the app with the platform's sign-in link. **Champions:** separate pages.
- **B.** The Finals app's results are shown as a competition of the platform.
- **Recommendation: A** ([mockup 18](18-finals-and-tournament.svg)). B would need a data sync, which 0030 rules out. Moments' `finals` class today means the official tournament's final, not the Finals app; how a Finals app moment is classed is the Finals track's question, and the brief notes the clash as a roadmap note.

## Later: mini tournaments (after version 1)
The product owner decided on 2026-11-21 (decision 0031, recorded in #695) that **mini tournaments for any game wait until after version 1**. These questions are kept for that time and are **not asked now**; their recommendations stand as written and are not part of step 7's plan, issues or exit. The THE FINALS mini tourney is not among them: it is integrated from day 1 as the Finals track's, unchanged. The core is still built fully general in step 7, so a mini tournament later runs on it without a new engine; the core plan's mini tournament row is its later user.

What they were: mini tournaments for any catalogue game, run by the players like the Finals app: sign-up, a balanced draw, lobby codes and a match card, self-reported placements, a crew queue for disputes ([0030](../../decisions/0030-finals-integrated-one-tourney-core.md) point 4; the [Finals app's features](../../legacy-inventory/thefinals_mini_tourney.md#features) as the model). They would be new pages in the platform's design. Mockups [16](16-mini-player.svg) and [17](17-mini-crew.svg) are kept and marked later, not redrawn. Where they meet Finals is asked now, as [F1](#f1-where-finals-and-tournament-meet). The Games track's per-game competition rules (D19, M2) and the rosters and rounds for casual play (M13) wait with them.

### D17. Mini tournaments in the contract
**New for 0030.** The catalog's Session, Match and Result outlines and the 17 `tournament.*` events were written for the official tournament, and built consumers act on them: the agenda mirrors every session into the run of show, Moments' `match_called` rule calls a match to the floor, `finals_result` fires on a final.
- **A.** A mini tournament is a Session with a `kind` (`official` or `mini`) on the same events; every consumer filters by `kind`.
- **B.** Mini tournaments reuse the Match and Result outlines but have their own events (`tournament.mini.opened`, `.started`, `.match.ready`, `.result.reported`, `.result.disputed`, `.result.decided`, `.finished`, `.cancelled`), which only the consumers that want them follow.
- **Recommendation: B.** It is additive, and no built consumer starts acting on player-run matches by surprise: a mini tournament never lands in the run of show or calls the hall to a stage unless a consumer chooses to follow it ([M11](#m11-mini-tournaments-on-the-screen)). **Contract:** the MiniTournament outline and its events in `contracts/tournament.md`, with the mini tournaments issue.

### D19. Reading a game's competition rules
**New for 0030.** Games owns the rules as catalogue data; the Games track adds them to its contract with the code that uses them ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)).
- **A.** Tournament reads a game's rules from the catalogue's API when a session or a mini tournament is created, and keeps a copy with it (as D18 keeps the format).
- **B.** Tournament follows a rules event from Games and keeps a cache of every game's rules.
- **Recommendation: A.** The copy is needed anyway, so that a rules change never alters a running competition; a cache would be a second store of the catalogue. When the catalogue has no rules for a game, or is not live yet, see [M2](#m2-which-games).

### O11. Many mini tournaments at once
**New for 0030.** At the large event, players may start many.
- **A.** Any number at once, but one open sign-up per game at a time (a second start joins the open one); sizes from 2 entrants up to what the format allows (the core's templates take any count, with byes).
- **B.** A per-event cap set by the crew.
- **Recommendation: A**, with B as a setting (off by default). The crew queue and the screen order ([M11](#m11-mini-tournaments-on-the-screen)) keep many small ones from crowding the official tournament.

### M1. Who starts a mini tournament
**New for 0030.**
- **A.** Any signed-in member of the event, from a game's page or the Tournament page; a per-event setting can restrict it to the crew.
- **B.** The crew only.
- **C.** Any member, held until the crew approves it.
- **Recommendation: A.** "Run by the players" is the point (the Finals app's public start); the starter becomes its host, with no crew right. The setting covers events that want control, and the crew can cancel any one (M15).

### M2. Which games
**New for 0030.**
Each game's rules come from the catalogue: team size, teams per match, a default format. The Games track builds them; it is a parallel track and may land after step 7.
- **A.** A member can start one only for a game whose rules are set and pass the core's `check_rules`; the crew can start one for any game and set the rules in the form, for that tournament only; when the catalogue is not live, the crew's form is the only way.
- **B.** Any game, with the rules typed by whoever starts it.
- **C.** Step 7's mini tournaments wait for the Games track's rules.
- **Recommendation: A.** Players see only games that can really run; the crew is never blocked by the parallel track, and its rules are kept with that one tournament (D19), never written back to the catalogue.

### M3. Sign-up and the draw
**New for 0030.**
- **A.** Solo sign-up, with balanced teams drawn at the start by the core's team builder from the players' ratings (M4); a game with team size 1 has no draw.
- **B.** Teams sign up as teams (a name, its players by invite, as U3).
- **C.** Both, chosen by the starter: solo with a balanced draw by default, teams when friends want to play together.
- **Recommendation: C**, solo by default. Solo sign-up with a balanced draw is how the Finals app is run most; team sign-up reuses U3's invites. Players left over when the count does not fill the last team are listed as "left out", first in line for the next one (the Finals app's rule).

### M4. Ratings
**New for 0030.**
The balanced draw needs a rating per player and game; the Finals app keeps a 0–100 roster across seasons.
- **A.** Per game per event, starting at 50 each event.
- **B.** Per game across the event series (#150), updated by the core's bands and scoring table when a mini tournament finishes, clamped 0–100.
- **C.** No ratings: a random draw.
- **Recommendation: B.** Balance improves with history, and the series is the group that plays together; a player sees their own rating and its change after each tournament, others see only the change marks (the Finals app's setting, on by default). Ratings are personal data (D16, O6). Mini tournaments never touch season points (M10).

### M5. The format: placements only or a bracket
**New for 0030.**
- **A.** The game's default format, which the starter may change to any format the core can run for the count: single elimination, groups then knock-out, heats, open heats, or a preset's formats for a game that fits it (THE FINALS' seven for a game with teams of three and 2–4 teams per match).
- **B.** Always the game's default.
- **C.** Placements only: one match, no bracket.
- **Recommendation: A**, with the choice shown as cards with a small drawing of each format, not a list of names; the format is built when sign-up closes, for the count that signed up, and frozen (D18). Placements only is one of the choices.

### M6. When it starts
**New for 0030.**
- **A.** The starter sets a start time and a minimum; at the time it starts with the largest count the format allows; the starter or the crew can start it early once the minimum is in.
- **B.** It starts when full.
- **C.** A vote to start early and availability voting, as the Finals app.
- **Recommendation: A.** At a LAN party the players are in the hall; the Finals app's votes serve its off-LAN seasons, which it keeps. A mini tournament that has not reached its minimum at the time stays open for 30 minutes and is then cancelled with a push (the only automatic cancel before it starts; once running, only the event's end cancels it, M15).

### M7. The match card and the lobby code
**New for 0030.**
- **A.** Each player's current match has a card: the teams with their players, the lobby code (set by any player of the match or the crew, 4–8 characters, kept for the next game of a series), the voice room when the bot makes one, and "Report placements"; it is the For you card while the match is open.
- **B.** The lobby code from the crew only.
- **Recommendation: A**, as the Finals app's lobby id ([mockup 16](16-mini-player.svg)). A code is not a secret: it is shown to the players of that match only.

### M8. Self-reported placements
**New for 0030.**
- **A.** Any player of a team in the match reports the order of the teams; two matching reports from different teams decide it; differing reports go to the crew queue; a team can re-report until it is decided (the Finals app's rule).
- **B.** One report decides; the other teams can dispute within five minutes.
- **C.** The crew enters every result.
- **Recommendation: A**, plus a timer: a match with one report and no second after 10 minutes reaches the crew queue as "one report, waiting" for a one-tap confirm. Two-team games need the other team's report, so nobody crowns themselves. The crew can always decide (M9).

### M9. The crew queue
**New for 0030.**
- **A.** A queue on the Tournament page and the crew phone: differing reports side by side, single reports waiting, problem notes from a match card; the crew picks a report, or sets the order by dragging the teams, with a note the teams see.
- **B.** The starter settles disputes.
- **C.** The starter first, then the crew.
- **Recommendation: A.** The starter is a player and may be in the disputed match. Every decision is kept in the tournament's history with who decided it, as D7 does for corrections ([mockup 17](17-mini-crew.svg)).

### M10. Mini tournaments and the season
**New for 0030.**
- **A.** Mini tournaments never add season points; their champions are their own.
- **B.** An organiser may make one count as a session.
- **C.** Bonus points for mini tournament champions.
- **Recommendation: A.** The season stays the official tournament's, and its rules stay visible (L8). A game the organiser wants in the season runs as an official session with a bracket from the core (P4). The Finals app adds no points either (0030 point 6).

### M11. Mini tournaments on the screen
**New for 0030.**
- **A.** A running mini tournament feeds Screen's `bracket` widget and gets a small winner card for its champion (in the platform's screen theme), both ranked below the official session: its bracket takes the Pulse hero only when no session runs, and its champion is a moment from a rule set to the `hot_game` class (rank 50), below the `tournament` class (60, a live official session) and the `finals` class (55, the cup's Champion); the rule fires only when no session is live; no match is called to the floor.
- **B.** Mini tournaments are on the phones only.
- **C.** Mini tournaments get the same moments as a session.
- **Recommendation: A.** The screen shows that the hall is playing, without a call to the floor for a match the players run themselves. **Contract:** a Moments rule on `tournament.mini.finished` with its class set to `hot_game` (additive, D17). A rule picks one of the ten classes and a class's rank is the rank of its place in the event's order ([moments.md](../../../contracts/moments.md#classes-and-the-priority-order)), so there is no new class and no rank number of its own; where a Finals card sits is the Finals track's ([F1](#f1-where-finals-and-tournament-meet)).

### M13. Rosters and rounds for casual play
**New for 0030.**
Moved from Games by 0030 (the product owner's decision of 2026-11-07). A casual round is people playing a game together with no bracket or champion, wanting only teams and a rotation.
- **A.** A mini tournament with the format "open heats" and no ratings change: a roster of who is in, balanced or random teams per round, the next round drawn from who is waiting (the core's `open_heat`), no reports needed, no champion.
- **B.** A separate "casual session" entity.
- **C.** Leave it out of step 7.
- **Recommendation: A**, as one of the format cards (M5), named "Casual rounds". It is the same sign-up and draw, so it costs a format, not a feature.

### M14. Rights for mini tournaments
**New for 0030.**
- **A.** Membership to start, sign up, report and set a lobby code; the starter (host) may edit the start time, start early, cancel before the start and remove a player before the draw; `tournament.minis.manage` for the crew queue, editing any result, cancelling and setting rules for one tournament (D12).
- **B.** One right for everything.
- **Recommendation: A.** Player-run means players need no rights; the crew's right goes in the `tournament_crew` preset. The rights are in the high-risk package with D12's.

### M15. A mini tournament nobody finishes
**New for 0030.**
- **A.** A match with no report for 60 minutes, and a mini tournament whose host leaves, go to the crew queue; the crew decides or cancels; a cancelled one is kept as cancelled, with no rating effect (the Finals app's rule); at the event's end any running one is cancelled. Cancel before it starts: one below its minimum is cancelled 30 minutes after its start time (M6).
- **B.** Cancelled automatically after a timer.
- **Recommendation: A**, with the event's end as the only automatic cancel of a running mini tournament; the one earlier automatic cancel is M6's, for one that never reaches its minimum and so never starts.
