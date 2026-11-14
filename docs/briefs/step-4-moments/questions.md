# Step 4 question bank

Every open question the research for [the step 4 brief](../step-4-moments.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (the lead's comment on #111, 2026-11-08). IDs are stable, so the session can answer "D2: B" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): L1, P1, D1, D2, U1, U3, D4, P4, D16.

A question marked **contract** needs a contract change if the recommendation is taken. An additive one ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)); **D2** is the only recommendation that is treated as breaking, so it would be its own PR, merged first, with the maintainer's accept. The design guideline's open questions that belong to Moments ([docs/design/README.md](../../design/README.md#questions-for-the-product-owner), Q17–Q22) are carried here as L11, L14, D5, D16 and E7; if the product owner has already answered one, that answer stands.

## U · Who uses it and how

### U1. Who runs Moments on the day?
- **A.** The organisers, from their phones, between other jobs; the autopilot does the rest.
- **B.** A dedicated show operator at a desk (direction B).
- **C.** Nobody: rules and scenes only, no crew actions.
- **Recommendation: A.** The crew remote ([mockup 04](04-crew-remote.svg)) carries the five crew moments; the On air page ([mockup 03](03-on-air.svg)) serves someone at a desk when there is one, but nothing needs them.

### U2. Which rights does Moments have, and which preset do crew get?
- **A.** One right, `moments.write`, for everything.
- **B.** A right per kind of action: `moments.announce`, `moments.announce.urgent`, `moments.take` (spotlight, storyboards, ending a crew moment), `moments.scenes.take` (Peak now and other scene buttons), `moments.emergency`, `moments.settings.write` (priorities, rules, scenes, storyboards, cues, templates), `moments.read`. A "Moments crew" preset grants announce, take and scenes.take.
- **Recommendation: B.** It matches the per-action rights of the step 3 modules, and the urgent and emergency rights must be separate anyway (U3, U4).

### U3. Who may mark an announcement urgent?
The lead's step 2 note: Notify's urgent exception (pushed in quiet hours and over the hourly cap) relies on it.
- **A.** Anyone who may announce.
- **B.** A separate right, `moments.announce.urgent`, held by the event admin role and grantable to crew; the API answers 403 when a request without it asks for urgent, and `moments.announcement.sent` carries `urgent: true` only when the sender held it.
- **C.** The event admin only, not grantable.
- **Recommendation: B.** Contract (moments.md, and notify.md's topic row).

### U4. Who may start an emergency?
- **A.** The event admin (`moments.emergency` with the role), grantable to named crew.
- **B.** Any crew member.
- **C.** A plus the superadmin, venue-wide across the events at the venue (step 3's E9).
- **Recommendation: C.** One hold to start, one tap to end ([mockup 07](07-flow-emergency.svg)).

### U5. Where does the organiser compose an announcement?
- **A.** Screen studio → Moments (screen-first).
- **B.** Run the event → Announcements, a page beside Run of show and Notifications, plus the phone's quick action and "Announce this" on a run-of-show item.
- **C.** Both A and B as separate forms.
- **Recommendation: B.** An announcement is not only a screen thing (Discord, push, ticker); one form, reachable from three places. [Mockup 05](05-announce-composer.svg) draws it inside Studio's frame only to keep the set small.

### U6. Where do the crew moments sit on the phone?
- **A.** The Screens tab: On air, Announce, Spotlight, Storyboard, Peak now, Emergency.
- **B.** A new Moments tab in the bottom bar.
- **C.** Spread across tabs (announce under Notifications, spotlight under Screens).
- **Recommendation: A**, with Announce also in Quick add. The bottom bar stays as the design drew it (design Q7).

### U7. What do attendees meet of Moments outside the screens?
- **A.** Nothing.
- **B.** Announcements in the hub's inbox and as pushes (Notify's `announcements` topic), and later reactions (P4).
- **Recommendation: B.** Notify already owns delivery; Moments only emits the event.

### U8. May venue staff who are not organisers trigger anything?
- **A.** Only through the superadmin's venue-wide emergency.
- **B.** Whatever an event grants them with the "Moments crew" preset.
- **Recommendation: A plus B.** The event decides; the venue keeps its safety button.

### U9. What does Studio → Moments open on?
- **A.** On air during a live event, Priorities before it.
- **B.** Always On air.
- **C.** A list of rules.
- **Recommendation: A**, like Studio's Live home in step 3 (U5 there).

### U10. How do organisers rehearse before the doors open?
- **A.** A preview on the virtual screen for everything, and test-fire on one zone for storyboards and cues, silent unless chosen, marked "test" in the history.
- **B.** A rehearsal mode that runs the whole event's rules on one test zone against a clock they can move.
- **Recommendation: A** now; B is 0022's "dry run", which stays on the later list.

### U11. Do crew moments need a confirmation?
- **A.** Announce and spotlight: a preview step, then send; Peak now: one tap; emergency: hold 2 s.
- **B.** A confirm dialog on every action.
- **C.** No confirmation at all, with undo.
- **Recommendation: A.** Withdraw and End are always one tap.

### U12. What may a crew member end?
- **A.** Any moment on any zone.
- **B.** Crew moments (their own and others'), plus "End in zone" for any rule moment; never an emergency without `moments.emergency`.
- **Recommendation: B.** Ending a rule moment ends it for this occurrence only; the rule fires again next time.

## L · Look and feel

### L1. Which direction?
- **A.** Conductor: one queue, the legacy rules.
- **B.** Director's desk: a show someone runs.
- **C.** The Autopilot with a crew remote.
- **Recommendation: C**, with A's rules as the arbiter's core and B's preview and take grammar ([the brief](../step-4-moments.md#recommended-direction-the-autopilot-with-the-conductors-engine-and-the-desks-grammar)).

### L2. How does each announcement level look?
- **A.** As [mockup 06](06-announce-on-screen.svg): info a card in the rail with a draining line; urgent the warning colour, a ripple and the screen's spotlight once; emergency the fixed-colour full-screen takeover.
- **B.** Every level full screen, like the legacy.
- **Recommendation: A.** The emergency's red stays outside the theme on purpose (design README, Known limits).

### L3. What is an announcement's degrade chain?
- **A.** Info: rail → ticker. Urgent: rail → hero → ticker. Emergency: full.
- **B.** Everything rail → ticker.
- **C.** The organiser picks per announcement.
- **Recommendation: A.** Urgent may take the hero on a layout without a rail rather than shrink to a ticker line.

### L4. When the composer's "Ticker line" channel is on and the card itself degrades to the ticker on a zone, what shows?
- **A.** The line once.
- **B.** Both.
- **Recommendation: A.** One message, one line.

### L5. Which storyboards are built in?
- **A.** Doors open, Starting soon, Champion, Midnight, Match called ([mockup 11](11-storyboards-on-screen.svg)).
- **B.** Fewer: Starting soon and Champion.
- **C.** More: also a lunch call, a raffle draw, a sponsor sting, a closing ceremony.
- **Recommendation: A**, with the full set designed with the product owner when #114 starts, as the issue says.

### L6. How do storyboards play at each energy level?
- **A.** Party and lively: the full motion and confetti; calm: fades and the cards only; none: cuts. Rotations elsewhere keep their pace (amendment 1).
- **B.** Storyboards ignore the level; peaks are peaks.
- **Recommendation: A.** A quiet scene still wins over a storyboard's sound (E11).

### L7. How is a cue's effect picked?
- **A.** At random from the kind's pool, never the same twice running (design sheet 14).
- **B.** A fixed effect per kind.
- **Recommendation: A**, as drawn.

### L8. How long does a cue hold?
- **A.** 60–120 s per kind, an event setting, fading over 10 s (design change 2).
- **B.** A fixed 90 s.
- **Recommendation: A**, as drawn.

### L9. Where does the default sound pack come from?
The repo is AGPL; its assets need a licence that allows that, with attribution kept.
- **A.** CC0 sounds chosen from public libraries, edited to one loudness, with a credits file.
- **B.** A small commissioned pack under CC BY.
- **C.** Sounds generated by a synthesiser script in the repo.
- **Recommendation: A**, covering the six categories, each built-in storyboard's stings and a countdown tick, each at most 10 s; B if A cannot reach the polish wanted.

### L10. Where does the visual heartbeat's rate come from in step 4?
The design draws a slow pulse whose rate follows how busy the event is (sheet 14).
- **A.** From check-ins and the day's phase now; from presence (online, in voice) once the bot lands (step 6).
- **B.** Wait for presence; no heartbeat until step 6.
- **Recommendation: A.** Moments computes the rate; Screen draws it (an additive field on the scene state).

### L11. Reactions: what may attendees send? (design Q20)
- **A.** A fixed set: heart, star and four short words, at most one a second per screen, off in quiet scenes.
- **B.** Free emoji with moderation.
- **Recommendation: A**, whenever reactions are built (P4).

### L12. Full screen or hero for a storyboard?
- **A.** The hero, falling back to full screen on a layout without one; full screen only where the storyboard says so (Midnight, 20 s).
- **B.** Always full screen, like the legacy takeovers.
- **Recommendation: A.** Share before you queue.

### L13. What do an edit and a withdraw look like?
- **A.** An edit changes the card and the ticker line in place with an "Updated" chip for 60 s and no new sound; a withdraw ends it everywhere silently.
- **B.** An edit replays the arrival; a withdraw plays the "ended" sound.
- **Recommendation: A** ([mockup 06](06-announce-on-screen.svg)).

### L14. May a scene switch the theme? (design Q19)
- **A.** The palette only in step 4; whole themes later.
- **B.** Both now.
- **Recommendation: A.**

### L15. Does a crew spotlight show who started it?
- **A.** "From the crew", no name.
- **B.** The crew member's name.
- **Recommendation: A**, as drawn on sheet 13; the history keeps the name.

## D · Data and integrations

### D1. Who places a moment in a zone's regions?
- **A.** Screen, as built in step 3: it walks claims by rank and degrade chain, deterministically, also offline; it reports placed, hidden and unplaced claims in `screen.claims.changed`. Moments ranks, times, queues and refuses, and follows that report.
- **B.** Moments computes placement itself and tells Screen exactly where each claim goes.
- **Recommendation: A.** One placement algorithm, already tested; B would duplicate it and need every layout in Moments. Moments uses Screen's zone preview path for its previews.

### D2. The catalog's "at most one override of each kind per zone" (contract)
[events.md](../../contracts/events.md#screen-overrides) promises it, but region sharing needs several blocks at once (standings in the hero and an announcement in the rail are both `block`).
- **A.** Keep it: one block per zone, the rest queue. The issue's goal fails.
- **B.** Lift it in its own contract PR, merged first, with the maintainer's accept, as a breaking change: a consumer may rely on the promise. Screen already places any number and needs no change.
- **C.** Lift it inside #112's package as additive, since the only consumer handles it.
- **Recommendation: B.** The safest reading of the contract rules; the lead and the reviewer may judge C acceptable.

### D3. A partial end of an override that held several zones (contract)
The lead's step 2 note: with `zones: []` (every zone), "the zones it still holds" cannot be listed.
- **A.** `.ended` gains `remaining_zones`.
- **B.** Before a partial end Moments emits `.changed` with `zones` narrowed to the explicit list it still holds, then `.ended` for the zones it left; `.ended` gains `final` (true only when the override is gone everywhere).
- **C.** End the override and start a new one for the remaining zones.
- **Recommendation: B.** Additive; C loses the override's identity and its sound-once memory.

### D4. What are the announcement's events called? (contract)
#115 names `announce.*`, but the catalog names an event by its emitter.
- **A.** `announce.sent`, `announce.changed`, `announce.withdrawn`.
- **B.** `moments.announcement.sent`, `.changed`, `.withdrawn`.
- **Recommendation: B.** The bot and Notify consume them later with no new API, as #115 asks.

### D5. How does a scene reach the screen? (contract; design Q17)
- **A.** Moments emits `moments.scene.changed` per zone with the scene's settings; Screen composes them into `display` where it uses the day's phase today, and keeps the phase as the fallback while no scene is known.
- **B.** Screen evaluates scenes itself.
- **Recommendation: A.** Scenes belong to Moments with their page in Screen studio, as the design proposes; Screen only renders.

### D6. Which scene conditions exist in step 4?
- **A.** Time per event day, the agenda's kinds, check-ins (Notify), the crew button. Presence and games when their emitters land; the outside signal stays planned.
- **B.** Only time and the crew button.
- **Recommendation: A**, tested with fixture events for the later inputs.

### D7. Rules on domain events whose emitters do not exist yet
Pizza (step 5), the bot (step 6), the tournament (step 7) and Games (a track) emit later.
- **A.** Ship the built-in rules now, generic over the catalog, tested on fixture events; they fire when the events appear.
- **B.** Each later step adds its own rules.
- **Recommendation: A**, like step 3's tournament mirror on fixtures (D17 there).

### D8. How configurable are the rules?
- **A.** Built-in rules per domain event, each with on/off, template, rank, regions, duration, zones and cue; no free-form editor.
- **B.** A full trigger → condition → action editor for everything.
- **C.** Fixed rules with no settings.
- **Recommendation: A.** Scenes already give organisers conditions; a general editor is a later slice.

### D9. What is a storyboard on the wire? (contract)
- **A.** An Override with `steps` (screen contract), plus an additive step field `transition`; Moments stores storyboards as data validated by a JSON schema in `contracts/`.
- **B.** A new override kind that Screen interprets.
- **Recommendation: A.** Screen already plays `steps`.

### D10. What can a storyboard's placeholders read?
- **A.** A fixed vocabulary per trigger kind: the agenda item's fields, the domain event's data (tournament, team, game), the event's name and the time.
- **B.** Any field of any module.
- **Recommendation: A**, documented in the contract; unknown placeholders fail validation, never show raw.

### D11. Which placeholders do announcement templates offer?
- **A.** `{item.title}`, `{item.starts_at}`, `{item.starts_in}`, `{item.location}`, `{event.name}`.
- **B.** A, plus free variables the organiser defines.
- **Recommendation: A.**

### D12. What happens on Discord when an announcement is edited or withdrawn? (step 6)
- **A.** The bot edits its post; a withdraw appends "(withdrawn)" and never deletes.
- **B.** The bot deletes and reposts.
- **Recommendation: A.** The bot consumes `.changed` and `.withdrawn`; nothing new for step 4 beyond the events.

### D13. How does an announcement reach the ticker?
- **A.** A claim in the `ticker` role, owned by Moments (TTL, revert); Screen's manual ticker (0018) is untouched.
- **B.** Moments writes a line to Screen's manual ticker and removes it later.
- **Recommendation: A.** Only Moments owns timing; the crew's own ticker lines stay theirs.

### D14. How do the screens of a zone play a sound together? (contract)
- **A.** Moments' decision goes into the composed state with `play_at` (the server's time plus 400 ms); each device plays at that moment by its clock corrected by the heartbeat's offset.
- **B.** Each device plays when the message arrives.
- **Recommendation: A**: #113's 200 ms target; an additive field in `ScreenState.sound`.

### D15. Where does the sound budget's state live?
- **A.** Counters per zone in Valkey with expiry; the log in Postgres.
- **B.** Everything in Postgres.
- **Recommendation: A.** Containers keep no state; a restart of Moments loses no count.

### D16. Sound categories: the legacy six or the design's six? (design Q21)
The design's table (bell, fanfare, alert, pizza, photo, ambient) is a proposal "not taken from the legacy engine". The legacy has categories attention (40), something new (30), result (50), urgent (70), ended (20) and ambient (10), with sounds linked to them.
- **A.** The legacy categories as the rule axis (priority, cooldown, level, on/off), the design's six as the default sounds linked to them ([mockup 12](12-sound-desk.svg)).
- **B.** The design's six as categories.
- **Recommendation: A.** Proposed cooldowns: attention 30 s, something new 2 min, result 60 s, urgent none, ended 60 s (off by default), ambient 5 min; the legacy had per-cue cooldowns of 0 except ticker 2 min and the strip cues 10 min, and relied on the flood guard.

### D17. Catch-up windows
- **A.** Per cue, default 2 minutes; the tournament cues keep the legacy windows (T−29 to T−15, T−14 to T−2).
- **B.** Only the legacy tournament cues catch up.
- **Recommendation: A**, at most once per cue and source.

### D18. What may a crew spotlight show?
- **A.** Standings, a bracket, a photo, a message (design sheet 13), live: Moments updates the content through `.changed` as the source changes.
- **B.** A, plus any widget of the zone.
- **Recommendation: A.** Standings and bracket render "Collecting…" or placeholders until the tournament lands (experience map).

### D19. Who may send reactions, if built? (P4)
- **A.** Signed-in attendees (the hub's session), one every 10 s each.
- **B.** Checked-in attendees only.
- **C.** Guests too.
- **Recommendation: A.** Check-in is never mandatory (0027); a sign-in gives a per-person limit.

### D20. Notify's `announcements` topic (contract)
- **A.** Owner `moments`, trigger `moments.announcement.sent`, urgent from `data.urgent`, visibility from the announcement; an additive change to notify.md in #115's package.
- **B.** Keep admin as owner.
- **Recommendation: A.** notify.md already names step 4 as the one to fix it.

### D21. How long is the history kept?
- **A.** The legacy's 7 days or 500 rows.
- **B.** For the event's life, deleted 30 days after it is archived, exportable as CSV.
- **Recommendation: B.** The history is how an organiser learns what worked.

### D22. What does "clone with an event" copy?
- **A.** Priorities, rules, scenes, storyboards, templates, cue and sound links, the library.
- **B.** Nothing.
- **Recommendation: A.** Never the history, the log or live moments.

### D23. The sound library and its limits
- **A.** Uploads are Screen's `audio` assets (one asset store); MP3 or OGG, at most 10 s and 1 MiB; Moments keeps the links.
- **B.** Moments keeps its own files.
- **Recommendation: A.** The design's 10 s; the legacy allowed 30 s and 2 MiB, and its 10 s guide flag never fired.

### D24. The shape of the Moments contract (contract)
- **A.** `contracts/moments.md` and `moments.openapi.yaml` using the shared components, written in parts that travel with their packages: the engine (#112), scenes, cues and sound (#113), storyboards (#114), announcements (#115).
- **B.** One contract PR before any code.
- **Recommendation: A**, as 0029 asks.

## E · Edge cases and failure

### E1. Moments is down
- **A.** Screens play on and end claims at their `expires_at`; new moments cannot start; Studio says "Moments is not answering"; an active emergency stays until Moments is back to clear it.
- **B.** As A, plus an emergency fallback inside Screen.
- **Recommendation: A.** One path for overrides; Moments is small and restarts in seconds. A health alert in step 8.

### E2. Moments restarts mid-moment
- **A.** Every active, hidden and queued moment is a row; on start the tick resumes every timer from the stored times ([mockup 16](16-flow-lifecycle.svg)).
- **Recommendation: A**, with #112's restart test.

### E3. Two crew members announce at the same time
- **A.** Both run: the first takes the rail, the second queues behind it (or degrades to the ticker); On air shows both.
- **B.** The second replaces the first.
- **Recommendation: A.**

### E4. The same rule fires again while its moment runs
- **A.** Re-posting the same content extends the TTL (legacy); different content updates it through `.changed`.
- **Recommendation: A.**

### E5. A moment's source ends early (a match finished, a surge ended)
- **A.** The moment ends with `source_ended`; its region resumes.
- **Recommendation: A.**

### E6. A storyboard is interrupted (an emergency, a higher moment)
- **A.** It is hidden with its clock running and comes back at the step it would be in now; if its time has run out, it does not return.
- **B.** It restarts from the first step.
- **Recommendation: A**, the same rule as every hidden claim.

### E7. Scenes flip back and forth (design Q18)
- **A.** The first scene in the list whose conditions hold wins; a scene holds for its minimum time and blends; the crew button wins until its time ends or it is pressed again.
- **B.** Scenes carry rank numbers.
- **Recommendation: A**, as drawn on sheet 12.

### E8. The priority order changes while moments run
- **A.** Re-ranked at once; a moment that loses its region is hidden or queued, never ended.
- **Recommendation: A.**

### E9. A zone is removed, or a device moves, while a moment runs on it
- **A.** The override is narrowed to its other zones (D3) or ends for that zone with `source_ended`.
- **Recommendation: A.**

### E10. The event is archived while moments run
- **A.** Every moment ends, the emergency included; the archived screens show the archived notice (step 3's E8).
- **Recommendation: A.**

### E11. A quiet scene meets a storyboard or an announcement
- **A.** The quiet scene wins: the storyboard plays calm and silent, or is skipped if it is marked "not in quiet"; only urgent sounds play.
- **Recommendation: A.**

### E12. A kiosk has not unlocked audio
- **A.** Its heartbeat says `audio_unlocked: false`; Studio flags the zone's sound screen; the log says "not played: audio locked".
- **Recommendation: A**, with step 3's kiosk check page.

### E13. A zone's sound screen is offline
- **A.** No other device plays; the log says so; catch-up applies when it returns within the window.
- **B.** Another device of the zone takes over.
- **Recommendation: A.** One sound device per zone is step 3's rule.

### E14. A burst of triggers (50 in a minute)
- **A.** Repeated triggers from one source coalesce (2 s); the flood guard passes 3 sounds a minute; the picture is paced by Screen's choreographer; everything is logged.
- **Recommendation: A**, with #113's test.

### E15. A scheduled announcement's run-of-show item is delayed or cancelled
- **A.** A delay moves it with the item; a cancel withdraws it and logs why.
- **Recommendation: A.**

### E16. An announcement is edited after it degraded on some zones
- **A.** The edit reaches every channel and every zone in place, whatever shape each has.
- **Recommendation: A.**

### E17. Long texts
- **A.** Limits (title 60, body 140 characters), auto-fit within the template, and the readability check of step 3 in CI.
- **Recommendation: A.**

### E18. A crew member's phone loses its connection mid-action
- **A.** Every action is one request with an idempotency key; a retry never sends twice.
- **Recommendation: A.**

## O · Operations and scale

### O1. Reactions at 2,000 attendees
- **A.** Counted in Valkey and emitted at most once a second per zone, never one bus event per reaction.
- **Recommendation: A**, whenever reactions are built.

### O2. How fast must a moment reach the screens?
- **A.** Request to every screen of its zones in under 1 s p95, measured on the demo stack, like step 3's push.
- **Recommendation: A.**

### O3. Which tests prove the step?
- **A.** Concurrent moments share regions as specified; a priority change takes effect live; a takeover reverts on time across a restart; 50 triggers stay within the budget; a zone's screens start a sound within 200 ms; the scene presets reproduce "follow the day"; CI screenshots of every built-in storyboard through `scripts/demo-screenshots.mjs`.
- **Recommendation: A.**

### O4. What is audited?
- **A.** Every crew action, every change to priorities, rules, scenes, storyboards, cues, templates and the library, every emergency start and clear.
- **Recommendation: A.**

### O5. How does the crew see that Moments is healthy?
- **A.** The module health check, On air's live state, and the sound log; alerts in step 8.
- **Recommendation: A.**

### O6. Where does each setting live?
- **A.** As the experience map says: scenes, moments (priorities, rules, storyboards) and cues in Screen studio; event-wide defaults (hold time, master volume) in Admin → Settings.
- **Recommendation: A.**

### O7. How are the built-in rules, scenes and storyboards kept current across platform versions?
- **A.** Built-ins are platform data an event copies on first use; a later platform version never changes an event's copy; a "reset to default" is offered.
- **B.** Built-ins are always live references.
- **Recommendation: A.** A running event never changes unasked (step 3's freeze).

### O8. What does the product owner see at the checkpoint?
- **A.** The exit criteria proposed in the brief, on the demo tenant.
- **Recommendation: A.**

## P · Plan and scope

### P1. The step's issue set
- **A.** As proposed in the brief: a breaking contract change first (if D2 is B); #112 the engine with spotlight and emergency; scenes (new); #113 cues and sound; #114 storyboards; #115 the announcement composer.
- **B.** The four issues as written; scenes and cues wait for a later step.
- **C.** A, with scenes split again into scenes and the heartbeat.
- **Recommendation: A.** The design guideline put scenes and cues in step 4; leaving them out leaves the accepted design without its engine.

### P2. Scenes: their own issue or part of #112?
- **A.** Their own issue.
- **B.** Inside #112.
- **Recommendation: A.** A whole capability with its own page; it runs in parallel with #113.

### P3. Cues: in #113 or their own issue?
- **A.** In #113, renamed "cues: picture and sound, with a budget".
- **B.** Their own issue.
- **Recommendation: A.** A cue is a picture plus an optional sound; the two share the rules and the page.

### P4. Reactions: step 4 or the App track?
- **A.** Step 4 builds the Moments side (API, rate limits, the overlay claim, moderation) with a crew test button.
- **B.** The App track builds both sides, when the hub can send them.
- **Recommendation: B.** Lean scope: no code without its consumer. A `Roadmap note:` for the App track.

### P5. The visual heartbeat: in the scenes issue?
- **A.** Yes (L10).
- **B.** Later, with presence.
- **Recommendation: A.**

### P6. Does each feature issue carry its own phone flow and Studio page?
- **A.** Yes: the spotlight and emergency with #112, Peak now with scenes, Announce with #115.
- **B.** One "crew remote" issue at the end.
- **Recommendation: A.** Whole capabilities, as AGENTS.md asks.

### P7. Package order
- **A.** The brief's sketch: the contract change; #112; scenes and #113 in parallel; #114 and #115 in parallel; the exit.
- **Recommendation: A.**

### P8. Voices (text to speech of announcements)
- **A.** Not in step 4; Voices is not scheduled.
- **Recommendation: A.** The override events already name Voices as a later consumer.

### P9. The director desk
- **A.** Stays on the later list (0022); On air and test-fire cover step 4.
- **Recommendation: A.**

### P10. Memories
tenants.md says Moments keeps users' memories (photos and clips) when they opt in.
- **A.** Not in step 4; an App track item, possibly in another module.
- **Recommendation: A.** A `Roadmap note:` to settle which module owns memories.
