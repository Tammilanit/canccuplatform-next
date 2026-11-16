# Step 4 brief: Moments (research pack)

The research pack for the product owner's brainstorming session on [roadmap step 4](../roadmap.md#4-moments), issue #111. It follows the [outline of a research pack](README.md#outline-of-a-research-pack) and the lead's comments on #111: the research pack for a very heavy, extensive and interactive brainstorming session (2026-11-08), and the design guideline (PO 2026-11-12) that puts scenes, the crew spotlight, cues, reactions, storyboards and announcements in Moments. After this merges, the lead runs the session over as many rounds as it takes, writes the final plan into this brief (`## Plan`) and rewrites the step's issues; the product owner accepts the plan before any build starts. **The final plan is the [Plan](#plan) below the goal;** the product owner's answers are in [step-4-moments/decisions.md](step-4-moments/decisions.md).

**In this pack**
- This file: goal, what was read, how others solve it, three directions and the recommended one, the key flows, port / drop / invent, the lead's step 2 notes, proposed issue changes.
- [step-4-moments/questions.md](step-4-moments/questions.md): the question bank, 87 questions in six themes, each with options and a recommendation. IDs (U3, D2, …) are used throughout.
- [step-4-moments/](step-4-moments/): 16 SVG mockups, drawn new, with the demo event only. GitHub shows them inline below. Mockups 12 and 13 were redrawn for the Plan's [sound model](#the-sound-model-d16).

## Goal
One module decides what the screens show and play, and when: the Moments at the peaks of the event ([0022](../decisions/0022-product-vision.md)). It is built on the legacy directive ranking and sound engine (takeovers, blocks, overlays and the sound budget) and runs on the server, so every screen gets the same thing and a reload loses nothing. One announce action reaches the screen, Discord and the ticker at once; the Discord side lands in step 6 (roadmap step 4).

Exit criterion (roadmap): a test event takes over the screen and plays sound within the budget.

Since the roadmap was written, the accepted design guideline ([docs/design](../design/README.md), PO 2026-11-12) gave Moments more to own ([experience-map.md](../design/experience-map.md#moments-step-4-111-brief-112-engine-113-sound-114-storyboards-115-announce)): **scenes** (the venue's autopilot), the **crew spotlight**, **cues** (a picture plus an optional sound), **reactions** on screen, the **visual heartbeat's rate**, storyboards and announcements. This pack treats that as input to the step, not as settled scope: [P1](step-4-moments/questions.md#p1-the-steps-issue-set) asks how much of it step 4 builds.

## Plan
The product owner answered every question in the [bank](step-4-moments/questions.md) on 2026-11-16; the record is [step-4-moments/decisions.md](step-4-moments/decisions.md). This plan turns those answers into the step's design and issue set. The product owner accepts it by accepting this PR. It bounds the step's build: each issue's Room to design is measured against it ([0026](../decisions/0026-briefs-are-research-packs.md)), not against the pack's recommendations below. The research below this section stays as it was, apart from short pointers where the answers overrode it.

### What the answers changed
Every question took its recommendation, except these:
- **U3 · A, not B:** anyone who may announce may mark an announcement urgent. There is no `moments.announce.urgent` right; the lead's step 2 note 1 is superseded, and Notify's urgent exception relies on `moments.announce`.
- **L4 · B, not A:** when the composer's "Ticker line" channel is on and the card itself degrades to the ticker on a zone, both lines show.
- **D11 · B, not A:** announcement templates offer the run-of-show placeholders plus free variables the organiser defines.
- **D16 · a model of its own:** the sound model below (three layers, several sounds per cue, a voice line, only urgent interrupts, uploads up to 30 s, stricter flood and budget limits, a rule per energy level). It replaces the D16 options and the 10 s length in D23.

And these notes amend a recommendation that was taken:
- **L2:** the levels look as mockup 06 draws them, and an announcement may also be shown **full screen** when the organiser chooses it.
- **L9:** the default pack is CC0 with a credits file (A); each event may upload any sounds it wants.
- **D7:** the built-in rules ship now on fixtures; each later step may redefine its own rules when its emitter lands.
- **P8:** text to speech is not in step 4, but stays in the backlog as an item of its own.

Mockups [12](step-4-moments/12-sound-desk.svg) and [13](step-4-moments/13-flow-sound-decision.svg) are redrawn for the sound model. The other fourteen stand.

### Direction
**C, the Autopilot with a crew remote** (L1), as recommended: A's legacy rules as the arbiter's core (TTL, refusal with retry, revert, history, the sound engine), B's grammar (preview, take, test-fire, cue lists) for storyboards and On air, with no operator required. Moments ranks, times, queues and refuses; Screen places, as built in step 3 (D1).

### Design principles
The pack's eight, kept; principle 5 amended for the sound model.
1. **One arbiter.** Everything that claims a screen goes through Moments; nothing else emits overrides.
2. **Share before you queue.** A moment takes the first free region of its chain; it waits only when none is free, and never longer than its patience.
3. **Autopilot first, crew second, operator never required.**
4. **Subtle but not brief.** Cues move a little and hold long; the pace never changes with the energy level.
5. **Sound is a budget, not a right.** Every sound passes the same gates on the server; only urgent sounds (the emergency's among them) interrupt a playing sound; the picture plays even when the sound does not.
6. **Explain every decision.** History, On air and the sound log carry a reason for everything that played, waited, was refused or stayed silent.
7. **Safety is simple.** Emergency: one hold to start, one tap to end, nothing outranks it, every screen comes back as it was.
8. **Rehearse before it is live.** Previews on the virtual screen for everything; test-fire on one zone for storyboards and cues.

### Rights
U2 as amended by U3. Every right is a `moments.<right>` string, checked through the admin session like every module's ([tenants.md](../../contracts/tenants.md#rights)).

| Right | Allows |
|---|---|
| `moments.read` | On air, History, the sound log, every settings page read-only |
| `moments.announce` | Send, edit and withdraw announcements, at the info or urgent level (U3) |
| `moments.take` | The crew spotlight, firing a storyboard, ending a crew moment, "End in zone" for a rule moment (U12) |
| `moments.scenes.take` | Peak now and the other scene buttons |
| `moments.emergency` | Start and end an emergency; held with the event admin role, grantable to named crew (U4) |
| `moments.settings.write` | Priorities, rules, scenes, storyboards, cues, the library, templates |

A "Moments crew" preset grants `moments.read`, `moments.announce`, `moments.take` and `moments.scenes.take` (U2, U8). The superadmin starts a venue-wide emergency across the events at the venue (U4 C). `moments.announcement.sent` carries `urgent: true` when the sender chose urgent; the sender held `moments.announce`, so Notify's urgent exception (quiet hours, the hourly cap) relies on that right.

### The sound model (D16)
Three layers, as the legacy built them, decided on the server once per zone:

1. **Six categories, fixed:** the rule axis. Each has a priority (the legacy's), a level and an on/off switch per event. Events add cues, never categories.

   | Category | Priority | Default level | Interrupts a playing sound | Plays at calm |
   |---|---|---|---|---|
   | urgent | 70 | 100 % | yes | yes |
   | result | 50 | 80 % | no | yes |
   | attention | 40 | 80 % | no | yes |
   | something new | 30 | 80 % | no | no |
   | ended | 20 | 80 % | no | no |
   | ambient | 10 | 35 % | no | no |

2. **Cues, as data per event:** seeded from the 25 legacy cues (`announce.attention`, `announce.urgent`, `announce.result`, `announce.ended`, `announce.cleared`, `emergency.start`, `poll.open`, `poll.result`, `nowplaying.start`, `ticker.message`, `photo.showcase`, `cast.live`, `cast.ended`, `tournament.pre`, `tournament.start`, `tournament.post`, `chrome.hot`, `chrome.voice`, `chrome.spike`, `strip.tournament_next`, `strip.finals_open`, `strip.finals_start`, `pizza.open`, `pizza.closed`, `pizza.placed`) with their legacy categories, on/off defaults and cooldowns (none, except the ticker's 2 minutes and the three chips' 10 minutes); cues whose emitter does not exist yet (poll, cast) are seeded off. Each cue has its own on/off, level, cooldown, catch-up window (D17) and **one or more sounds**, picked at random and never the same one twice running. An event adds cues of its own; each cue belongs to one category. The names in the seed are the legacy's; the package may rename them to the platform's catalog and says so.
3. **The library:** any sound can go to any cue. Uploads are Screen's `audio` assets (D23): MP3 or OGG, **at most 30 s**, with a warning over 10 s, and at most 1 MiB. The default pack is CC0 sounds with a credits file; legacy clips go in only where their CC0 source is confirmed (L9). Each event may upload any sounds of its own.

**A voice line:** a cue may carry a recorded voice line as an optional second part, played right after its sound and counted with it as one sound. Uploads only, the same limits; no text to speech (P8).

**The gates**, in order (redrawn [mockup 13](step-4-moments/13-flow-sound-decision.svg)): master switch and timed mute; the zone's energy and quiet state (party and lively play every category, calm plays urgent, attention and result, a quiet scene plays urgent only); category on; cue on and its cooldown; once per source (7 days); coalescing (2 s) and the flood guard (10 s per source, **3 sounds a minute per zone**); the **hourly budget per zone** (20 by default; urgent always passes and still counts); one at a time (only urgent interrupts a playing sound; any other waits in the short queue, at most 4 s, or drops). Every "no" writes the log with a reason code; the picture still plays.

### The final issue set
In the order of the [package plan](#order-packages-by-dependency-chain). Each issue below is the text the lead copies into the tracker after this merges: its title, goal, acceptance criteria, out of scope and risk. Every issue keeps the standard Room to design: the criteria are the floor, the bound is this plan.

| Issue | Status |
|---|---|
| New: docs(contracts): several overrides of a kind per zone | new (D2 B), breaking, high |
| [#112](https://github.com/Tammilanit/canccuplatform-next/issues/112) the Moments engine | kept, rewritten |
| New: feat(moments): scenes, the venue's autopilot | new (P1, P2) |
| [#113](https://github.com/Tammilanit/canccuplatform-next/issues/113) cues: picture and sound, with a budget | kept, rewritten for D16 |
| [#114](https://github.com/Tammilanit/canccuplatform-next/issues/114) storyboards | kept, sharpened |
| [#115](https://github.com/Tammilanit/canccuplatform-next/issues/115) the announcement composer | kept, sharpened for U3, L2, L4, D11 |

#### New · docs(contracts): several overrides of a kind per zone
- **Goal:** region sharing needs two `block` overrides on one zone at once (standings in the hero, an announcement in the rail); [events.md](../../contracts/events.md#screen-overrides) promises at most one of each kind. Lift the promise (D2 B).
- **Criteria:**
  - [ ] events.md's Screen overrides output says that any number of overrides of a kind may be active on a zone, and that Screen places them by rank as [screen.md](../../contracts/screen.md#moments-drive-it-claims) says.
  - [ ] The PR names it a breaking contract change; nothing else in the contracts changes.
- **Out of scope:** code (Screen already places any number); every other Moments contract part.
- **Risk:** high: a breaking contract change, its own PR, merged first with the maintainer's accept.

#### #112 · feat(moments): the Moments engine: the arbiter, priorities, history, the crew spotlight and emergency
- **Goal:** one server-side arbiter ranks, times, queues and refuses every moment per zone; Screen places them (D1). The legacy directive rules move to the server and become regional. A restart loses nothing.
- **Criteria:**
  - [ ] The engine part of `contracts/moments.md` and `moments.openapi.yaml` (shared components, D24): moment requests, the default priority order (emergency > stream > announcement > spotlight > storyboard > tournament > finals > hot game > reactions > ticker; stream and reactions keep their ranks for later), per-event and per-zone orders, patience, refusal with retry, history, the rights above; additive to events.md: `.ended`'s `final` and the narrowing rule (D3).
  - [ ] Every active, hidden and queued moment is a Postgres row; a server-side tick owns every TTL and revert; Moments follows `screen.claims.changed` for placement. A test proves a takeover reverts on time across a restart (E2).
  - [ ] The legacy ranking rules ported with their tests: TTL (default 120 s, at most 7200 s), re-posting the same content extends it (E4), a lower moment refused with a 30 s retry, revert; a priority change re-ranks at once and never ends a moment (E8).
  - [ ] Interactive and lively: a moment may carry a QR target and live data bindings, updated through `.changed`.
  - [ ] The **crew spotlight** (D18, L15): standings, a bracket, a photo or a message in the hero, with duration and zones, "From the crew" on screen and the name in the history; the phone flow on the Screens tab (U6).
  - [ ] **Emergency** (mockup 07): hold 2 s to start, one tap to end, the optional "All clear", the superadmin venue-wide; nothing outranks it, every screen comes back as it was; an archived event ends every moment, the emergency included (E10).
  - [ ] **Built-in rules** for catalog events (tournament, pizza, games surge), each with on/off, template, rank, regions, duration, zones and cue (D8), tested on fixture events (D7); they fire when the emitters appear, and each later step may redefine its own.
  - [ ] Pages in Studio → Moments: **On air** during a live event, **Priorities** before it (U9), with a preview through Screen's zone preview path; **History** per zone with why, what it displaced and how it ended, filters and CSV export, kept for the event's life and deleted 30 days after archiving (D21).
  - [ ] Every crew action and settings change is audited (O4); every crew action carries an idempotency key (E18); a moment reaches every screen of its zones in under 1 s p95 on the demo stack (O2).
  - [ ] Tests: concurrent moments share regions as specified; a priority change takes effect live; a takeover reverts on time across a restart.
- **Out of scope:** sound (#113), scenes, storyboards (#114), announcements (#115), reactions, the director desk.
- **Risk:** normal: a new module, an additive contract, rights checked through the existing admin session path. The package is high if adding the module's container must touch `.github/` or `setup/` (as the agenda's did).

#### New · feat(moments): scenes, the venue's autopilot
- **Goal:** scenes set the room's mood per zone by themselves (design sheet 12), so nobody needs to direct at 03:00, and the visual heartbeat's rate follows how busy the event is (L10, P5).
- **Criteria:**
  - [ ] The scenes part of the Moments contract: scenes as data with conditions (time per event day, the agenda's kinds, check-ins, the crew button; presence and games when their emitters land, tested on fixtures; D6), changes (motion level, layout per zone, stage mood, palette only (L14), sound on or off, quiet mode, hero features), first match wins, hold and blend times (E7).
  - [ ] `moments.scene.changed` per zone, with the heartbeat's rate as a field; Screen composes it into `display` where it uses the day's phase today and keeps the phase as the fallback (D5).
  - [ ] Five presets; with no scene configured they reproduce step 3's "follow the day", and a CI test proves the two agree.
  - [ ] The Scenes page in Screen studio (sheet 12) with the band chart; "Peak now" on the crew remote, one tap, that wins until its time ends or it is pressed again (U11, E7).
  - [ ] Built-ins are platform data an event copies on first use, with "reset to default" (O7); clone with an event copies them (D22).
- **Out of scope:** whole themes per scene (later); the outside signal; sound gates themselves (#113 reads the scene state).
- **Risk:** normal: module code, an additive contract part and an additive Screen field.

#### #113 · feat(moments): cues: picture and sound, with a budget
- **Goal:** a cue is a picture plus an optional sound. Pictures pick from effect pools; sounds follow [the sound model](#the-sound-model-d16): six fixed categories, cues as data, a library, all decided on the server once per zone.
- **Criteria:**
  - [ ] The cues and sound part of the Moments contract, and `play_at` in `ScreenState.sound` (additive, D14).
  - [ ] **Picture:** effect pools per kind of event, a random pick never repeated twice running (L7), a hold of 60–120 s per kind fading over 10 s (L8).
  - [ ] **Categories:** the six, with priority, level and on/off per event; nothing adds a category.
  - [ ] **Cues:** seeded from the 25 legacy cues; each with on/off, level, cooldown, catch-up window and one or more sounds picked at random, never the same twice running; an optional recorded voice line played after the sound; an event adds cues.
  - [ ] **Library:** upload MP3 or OGG up to 30 s (a warning over 10 s) and 1 MiB as Screen's `audio` assets, preview, link any sound to any cue; a CC0 default pack with a credits file covering every built-in moment, storyboard and cue, legacy clips only with a confirmed CC0 source.
  - [ ] **The engine:** the legacy sound engine ported with its tests (dedupe, cooldown, ambient gap, stale queue 4 s, coalescing 2 s, once per source, catch-up), changed so that only urgent interrupts a playing sound; the flood guard at 3 a minute per zone and 10 s per source; an hourly budget per zone (20 by default) in Valkey counters (D15); calm plays urgent, attention and result, a quiet scene urgent only (from the scene state, or the day's phase until scenes land).
  - [ ] **Sync:** the screens of a zone start a sound within 200 ms of each other, measured on the demo stack; only the zone's sound screen plays; a reload never repeats a sound.
  - [ ] **The sound desk** in Studio → Cues ([mockup 12](step-4-moments/12-sound-desk.svg)): budget per zone, master switch, timed mute, sound check, categories, cues with their sounds and voice lines, the library, and the log with a reason code for every decision (E12, E13).
  - [ ] Tests: a burst of 50 triggers in a minute stays within the budget and logs why (E14); a lower sound never interrupts a playing one; a cue with several sounds never repeats one twice running.
- **Out of scope:** text to speech (backlog, P8); reactions.
- **Risk:** normal: module code, an additive contract part, file uploads through Screen's existing asset path.

#### #114 · feat(moments): storyboards for the big moments
- **Goal:** sequences for the peaks (opening, finals, midnight) as data an organiser edits without code.
- **Criteria:**
  - [ ] The storyboards part of the Moments contract: a storyboard compiles to an Override with `steps`, plus the additive step field `transition` in the screen contract (D9); stored as data validated by a JSON schema; placeholders from a fixed vocabulary per trigger kind, unknown ones fail validation (D10).
  - [ ] Triggers: a run-of-show item at its start or n minutes before (the agenda module), a domain event, a time, a take by hand; patience when the region is held; an interrupted storyboard comes back at the step it would be in now (E6).
  - [ ] Built-ins: doors open, starting soon, champion, midnight, match called (L5); the full set designed with the product owner when the package starts (a `Roadmap note:` proposes more). Hero first, full screen only where the storyboard says so (L12); motion per energy level (L6); a quiet scene plays it calm and silent, or skips it when marked "not in quiet" (E11).
  - [ ] The builder ([mockup 10](step-4-moments/10-storyboard-builder.svg)): preview with a scrubber on the virtual screen; test-fire on one zone, silent unless chosen, marked as a test in the history (U10).
  - [ ] CI screenshots of each built-in through the demo screenshot scripts and their groups file, named as the test (O3).
- **Out of scope:** the director desk; a rehearsal mode with a movable clock (U10 B, later).
- **Risk:** normal: module and UI code, additive contract parts.

#### #115 · feat(moments): the announcement composer for every channel
- **Goal:** one form makes the screen card, the ticker line, and (from step 6) the Discord post, plus a push through Notify.
- **Criteria:**
  - [ ] The announcements part of the Moments contract: `moments.announcement.sent`, `.changed`, `.withdrawn` (D4); notify.md's `announcements` topic owned by `moments`, triggered by `.sent`, urgent from `data.urgent` (D20); both additive.
  - [ ] Levels info and urgent, open to anyone with `moments.announce` (U3); emergency hands over to #112's flow. On screen as mockup 06 (L2); the chains: info rail → ticker, urgent rail → hero → ticker (L3).
  - [ ] **Full screen** (L2 note): the organiser may mark an info or urgent announcement full screen; it then takes the full-screen region in the theme's look (never the emergency's fixed red), ranked as an announcement, and degrades along its level's chain where the full screen is held.
  - [ ] Channels: screen card, ticker line, Discord, push; the ticker line is a claim in the `ticker` role owned by Moments (D13). With the ticker line on and the card degraded to the ticker on a zone, both lines show (L4).
  - [ ] Templates per event with the placeholders `{item.title}`, `{item.starts_at}`, `{item.starts_in}`, `{item.location}`, `{event.name}` plus **free variables the organiser defines** (D11), filled in the composer before sending; an unknown placeholder fails validation, never shows raw; limits and auto-fit (E17).
  - [ ] Send now, at a time, or attached to a run-of-show item and moved with its delays; a cancelled item withdraws it and logs why (E15). Edit in place everywhere with an "Updated" chip and no new sound, withdraw silently (L13, E16); two senders at once both run (E3).
  - [ ] The composer at Run the event → Announcements, the phone's quick action, and "Announce this" on a run-of-show item (U5); a preview with the real player and each channel's preview before sending (U11); audit on every send.
- **Out of scope:** the bot's command and its Discord post (step 6); push delivery itself (Notify, the App track).
- **Risk:** normal: module and UI code, additive contract changes.

### Out of step 4
- **Reactions:** the Moments side waits for the App track's hub, which sends them (P4 B); designed here (mockup 15). A `Roadmap note:` for the App track.
- **Memories:** an App track item; which module owns them is settled there (P10).
- **The director desk:** later, as 0022 says (P9); so is a rehearsal mode (U10 B).
- **Text to speech:** to the backlog (P8). The lead files it as an `idea` issue after this merges, so it exists there.

### Order: packages by dependency chain
Workflow v2: one package per dependency chain, up to about 4000 changed lines. Each feature issue here is close to that size alone, so a chain is split at its links and the links merge in order; chains that share nothing run in parallel.

| # | Package | Issues | Risk | Starts after |
|---|---|---|---|---|
| 1 | `pkg-4-contract` | the D2 contract change | high (maintainer's accept) | — |
| 2 | `pkg-4-engine` | #112 | normal | 1 merged |
| 3 | `pkg-4-scenes` | scenes | normal | 2 merged |
| 4 | `pkg-4-sound` | #113 | normal | 2 merged; parallel with 3 |
| 5 | `pkg-4-storyboards` | #114 | normal | 4 merged (steps carry cues and sounds) |
| 6 | `pkg-4-announce` | #115 | normal | 4 merged (the announce cues); parallel with 5 |

Then the exit on the demo tenant, the health pass and the checkpoint (P7).

### The step 4 gate
The roadmap's exit criterion stands: a test event takes over the screen and plays sound within the budget. On the demo tenant, the product owner also sees (O3, O8):
- Three moments share the main hall at once; the portrait zone degrades the announcement to a ticker line, and with the "Ticker line" channel on shows both lines (L4).
- An announcement shown full screen in the theme's look, and an urgent one sent by a crew member who holds `moments.announce` pushes in quiet hours (U3).
- A priority change takes effect live.
- An emergency takes every zone; "All clear" brings each screen back as it was.
- A restart of Moments loses nothing.
- A burst of 50 triggers stays within 3 sounds a minute and the hourly budget per zone, and the log says why; only urgent interrupts a playing sound.
- A cue with several sounds never plays the same one twice running; a voice line plays after its cue's sound.
- At calm only urgent, attention and result sound; in a quiet scene only urgent.
- The screens of a zone start a sound within 200 ms.
- The scene presets reproduce step 3's look exactly.
- Each built-in storyboard has a CI screenshot.

## What was read
- **Decisions:** [0022](../decisions/0022-product-vision.md) (vision: the screen is the heart; a director desk later; no cheer meter), [0020](../decisions/0020-best-of-old-freely-new.md) (best of the old, freely new), [0023](../decisions/0023-step-design-briefs.md) and [0026](../decisions/0026-briefs-are-research-packs.md) (briefs), [0010](../decisions/0010-scope.md) (no page embedding, no `postMessage`), [0018](../decisions/0018-ticker-manual.md) (manual ticker), [0027](../decisions/0027-product-decisions-2026-11-07-08.md) (check-in never mandatory), [0029](../decisions/0029-additive-contracts-ship-with-consumers.md) (additive contracts ship with their code).
- **The design guideline:** [docs/design/README.md](../design/README.md) with its two binding amendments (energy levels change the look, never the pace; the six-box dashboard gets more air), [experience-map.md](../design/experience-map.md), [widgets.md](../design/widgets.md), and in `mockups.html` sheet 12 (scenes), sheet 13 (the Director and the crew spotlight), sheet 14 (cues: picture and sound) and sheet 15 (the two backgrounds). Its open questions Q17–Q22 are Moments' and come back in the bank.
- **Legacy inventories:** [canccusignage](../legacy-inventory/canccusignage.md): directives, directive history, scene precedence, spotlight, the sound engine and its triggers, the sound desk, the configuration keys, the known problems (11 and 14 are sound) and the port table; [canccubot](../legacy-inventory/canccubot.md): the announce, clear and reset commands, the trigger settings and the directive labels; from the [summary](../legacy-inventory/README.md): flows 3, 4 and 6 (announcement, hot-game banner, photo spotlight). The legacy sound code itself (`src/lib/sound/categories.ts`, `cues.ts`, `engine.ts`, `catch-up.ts`) for the real categories, priorities, cooldowns and catch-up windows.
- **The step's issues:** #112 (engine), #113 (sound), #114 (storyboards), #115 (announcements), the epic #58, and the lead's two step 2 notes on #111.
- **Contracts it builds on:** [events.md](../../contracts/events.md#screen-overrides) (the Override and `moments.override.*`), [screen.md](../../contracts/screen.md#moments-drive-it-claims) (claims, placement, `steps`, `sound`, `on_end`, the composed state and its push, motion levels and the stage, the heartbeat's `claims_sounded`), [agenda.md](../../contracts/agenda.md) (kinds, `links.moment_id`, `agenda.item.started`, quiet hours), [notify.md](../../contracts/notify.md) (the `announcements` topic, urgent delivery, quiet hours, the hourly cap), [bot.md](../../contracts/bot.md), [theming.md](../../contracts/theming.md) (motion vocabulary), [tenants.md](../../contracts/tenants.md).
- **What step 3 built:** Screen already places claims by rank and degrade chain and reports them (`modules/screen/src/compose/claims.ts`, with tests), plays claim `steps`, ends a claim at its `expires_at` by itself, and computes the motion level from the day's phase. `modules/moments/` is an empty folder.

## How comparable products solve it
| Field | What they do | What we take |
|---|---|---|
| **Broadcast graphics and playout** (template-driven graphics systems, live production switchers) | A rundown of templates; "take" and "clear"; preview before program; lower thirds and stingers layered on top of the main picture | Templates as data; take and clear; a preview before anything goes live ([mockups 05](step-4-moments/05-announce-composer.svg), [10](step-4-moments/10-storyboard-builder.svg)). Not the operator: the run-of-show and the rules do the taking |
| **Theatre and show control** (cue-list playback, lighting consoles) | A cue stack with GO, auto-follow and wait times; scenes with fade times; a "panic" that blacks everything out | Storyboards as cue lists with auto-follow; scenes with hold and blend times (design sheet 12); emergency as the one panic button |
| **Arena and in-venue entertainment** | A goal fires a scripted sequence (sting, replay, sound, scoreboard) on every screen at once; a sound effects library with "don't overplay" rules | Event-triggered storyboards across zones; a sound budget instead of a sound board |
| **Home automation** (trigger → condition → action rules, scenes, blueprints) | Rules anyone can read; scenes as named states; blueprints to start from; a trace of why an automation fired | Scenes with presets (design sheet 12); built-in rules per domain event; **a trace**: the history says why every moment started, what it displaced and how it ended ([mockup 09](step-4-moments/09-history.svg)) |
| **Mass notification and emergency alerting** (severity levels, compose once, many channels) | One composer reaches every channel; levels (info, urgent, emergency); per-channel previews; withdraw | The announcement composer ([mockup 05](step-4-moments/05-announce-composer.svg)): one form, three levels, each channel previewed, edit and withdraw everywhere |
| **Game audio design** (voice limits, priorities, ducking, cooldowns) | One voice per bus, higher priority interrupts, a lower one waits briefly then drops, per-sound cooldowns | The legacy engine already does this: one sound at a time, category priorities, a stale queue, cooldowns ([mockup 13](step-4-moments/13-flow-sound-decision.svg)) |
| **Livestream alerts** (follower alerts with variations, an alert queue, cooldowns, moderation) | Alerts queue so none is lost; variations picked at random; rate limits and word filters on viewer input | Cue pools picked at random, never twice running (design sheet 14); reactions from a fixed set with rate limits ([mockup 15](step-4-moments/15-reactions.svg)) |

The lesson across them: the polished systems **separate deciding from drawing**, **explain what they did**, and **give the operator very few, very safe buttons**. A venue screen at 03:00 has no operator, so the deciding must be automatic and the buttons must be impossible to misuse.

## Three directions
The same moment in each: 21:15, the grand final starts while the crew announces that the pizza is here.

![Three directions side by side](step-4-moments/01-directions.svg)

### A · Conductor: one queue, the legacy rules
The legacy directive model, moved to the server and the event: one ranked queue per zone, the highest moment owns the screen, lower ones wait or are refused with a retry, fixed triggers per domain event, the legacy sound engine with its budget.
- **Attendees:** clear, one thing at a time; the final's start waits behind the pizza, and a hot game is refused while anything ranks higher.
- **Organisers:** little to set up and little to steer: a priority list, a few trigger settings, announce, clear.
- **Venue crew:** announce, clear, emergency.
- **Trade-offs:** the cheapest and safest, and it meets the roadmap's words. It ignores what step 3 built (regions, placement by role) and what the design guideline drew (scenes, cues, the spotlight); the screen at the peaks is the legacy's single-slot takeover again.
- **Cost: M.**

### B · Director's desk: a show you run
A broadcast console in admin: preview and program monitors, a cue stack, hotkeys for stingers and storyboards, a person who decides every peak.
- **Attendees:** the finals feel produced, like a stream in the room; between peaks the screen shows whatever the operator left on.
- **Organisers:** a person per peak, or nothing happens; a volunteer-run event rarely has one at 03:00.
- **Venue crew:** a desk job, not a phone job.
- **Trade-offs:** the strongest finals, the weakest everything else; 0022 puts the director desk on the "later" list.
- **Cost: L–XL.**

### C · Autopilot with a crew remote
Moments is the venue's autopilot. **Rules** turn what happens (the run-of-show, domain events, the crew) into **moments** that claim regions, **cues** that touch boxes, **scenes** that set the room's mood, and **storyboards** for the big peaks. One **arbiter** ranks every claim per zone and shares the screen out by region; it queues only when no region of a moment's chain is free. The crew steers from phones: announce, spotlight, fire a storyboard, "Peak now", emergency.
- **Attendees:** the room is alive and nothing important waits: the final takes the hero, the pizza takes the rail, the ticker keeps going; at 03:00 the screen is calm and silent by itself.
- **Organisers:** presets that work on day one (built-in rules, five scene presets, five storyboards, announcement templates); everything is data they can change without code.
- **Venue crew:** one-tap actions that cannot break the screen, because every one of them is a request to the arbiter.
- **Trade-offs:** more to build and to test than A (rules, scenes, cues, three Studio pages), and more to explain, which the history and the On air page answer. Some inputs (presence, games, tournament, pizza) arrive in later steps, so their rules are tested on fixtures here.
- **Cost: M–L.** Much of it is already paid: Screen places claims, plays steps and ends them offline (step 3), and the look is drawn (sheets 12–14).

## Recommended direction: the Autopilot, with the Conductor's engine and the Desk's grammar
**C as the body; A's legacy rules as the arbiter's core (TTL, refusal with retry, revert, history, the sound engine as is); B's grammar (preview, take, test-fire, cue lists) for storyboards and the On air page, with no operator required.**

Why, boldly:
1. **The screen is shared, not owned.** Step 3 made the screen a set of regions with roles. A single-slot queue (A) would throw that away at exactly the moments that matter: two things happening at once is the normal state of a LAN event at 21:00, not the edge case. Sharing by region first and queueing second is the step's core idea ([mockup 02](step-4-moments/02-composition.svg)).
2. **Nobody directs at 03:00.** A volunteer-run event has no show operator most of the time. An autopilot that knows the run-of-show, the hour and the room's activity makes the screen right by itself, and the crew adds the human moments from their phones ([mockup 04](step-4-moments/04-crew-remote.svg)).
3. **Explainable beats clever.** Every decision is written down with its reason: the On air page says what each zone shows and what waits ([mockup 03](step-4-moments/03-on-air.svg)), the history says what displaced what ([mockup 09](step-4-moments/09-history.svg)), the sound log says why a sound did not play ([mockup 12](step-4-moments/12-sound-desk.svg)). An organiser trusts an autopilot they can read.
4. **The legacy engine is good; its shape was not.** Its ranking rules, its sound engine and their tests are the best code in the old repos for this step. What failed was where they ran (in the kiosk, in reads that write, in process memory) and the one-slot model. Moving the rules to the server and making them regional keeps the good and fixes the bad.
5. **The design guideline already chose it.** Sheets 12–14 draw scenes, cues and the spotlight as Moments'; picking A or B would leave the accepted design without an engine.

**Design principles for the step** (proposed for the session to keep, change or drop):
1. **One arbiter.** Everything that claims a screen goes through Moments: rules, people, storyboards, scenes. Nothing else emits overrides (events.md already says so).
2. **Share before you queue.** A moment takes the first free region of its chain; it waits only when none is free, and never longer than its patience.
3. **Autopilot first, crew second, operator never required.**
4. **Subtle but not brief.** Cues move a little and hold long (the design's 60–120 s frame and glow); the pace never changes with the energy level (amendment 1).
5. **Sound is a budget, not a right.** Every sound passes the same gates on the server; the picture plays even when the sound does not. *Amended in the [Plan](#design-principles): only urgent interrupts.*
6. **Explain every decision.** History, On air and the sound log carry a reason for everything that played, waited, was refused or stayed silent.
7. **Safety is simple.** Emergency: one hold to start, one tap to end, nothing outranks it, and every screen comes back as it was ([mockup 07](step-4-moments/07-flow-emergency.svg)).
8. **Rehearse before it is live.** Every moment, storyboard, announcement and priority change has a preview on the virtual screen; storyboards and cues can be test-fired on one zone.

## Key flows
Each flow for the user who meets it, with its mockup. Questions that change a flow are named.

### Composition: many moments on one screen (attendees)
The main hall shows the standings in the hero, the crew's announcement in the rail and the ticker at once; the entrance's portrait screen gets the same announcement as a ticker line; a crew spotlight grows the Dashboard's hero box; an emergency hides everything and gives it back afterwards (D1, D2, E8).

![Composition](step-4-moments/02-composition.svg)

### The life of a moment (everyone, implicitly)
Requested, ranked, then placed, hidden, queued or refused; renewed by a later `expires_at`; ended with a reason; the region resumes. Everything is a row in Postgres, so a restart of Moments loses nothing, and screens end claims by themselves if Moments is down (E1, E2, D3).

![Lifecycle](step-4-moments/16-flow-lifecycle.svg)

### On air (organiser, crew at a desk)
Studio → Moments opens on On air during the event: a column per zone with what is live, hidden and queued and why; the next two hours of scheduled moments; the crew actions and the emergency button (U9, O5).

![On air](step-4-moments/03-on-air.svg)

### The crew remote (organiser and crew on the floor)
The phone's Screens tab: what is on air, the four crew moments (announce, spotlight, storyboard, Peak now) and emergency; announce with a template, the channels, a preview per zone, then edit or withdraw while it is live (U1, U2, U6).

![Crew remote](step-4-moments/04-crew-remote.svg)

### Announcing (organiser)
One form: a template filled from the run-of-show, the level (info, urgent, emergency), the channels (screen card, ticker line, Discord, push), the zones, and when (now, at a time, or with a run-of-show item, following its delays). A preview with the real player and the event's theme, a preview of each channel, and who will hear about it (U3, U5, D4, D11, D12, D13, E15, E16).

![Announcement composer](step-4-moments/05-announce-composer.svg)

On screen, the three levels, an edit and a withdraw (L2, L3, L13):

![Announcements on screen](step-4-moments/06-announce-on-screen.svg)

### Emergency (event admin, superadmin)
Hold for 2 s, full screen on every chosen zone with the alarm looping and an urgent push; it survives reloads, restarts and a lost uplink; one tap ends it and every screen comes back where it was (U4, E1, E10).

![Emergency](step-4-moments/07-flow-emergency.svg)

### Priorities (organiser)
The default order ships (emergency > stream > announcement > spotlight > storyboard > tournament > finals > hot game > reactions > ticker); the organiser drags it per event, and per zone where a zone needs its own, and sees a preview of what a zone would show before saving; every change is audited (U9, E8).

![Priorities](step-4-moments/08-priorities.svg)

### History (organiser, after the fact)
Per zone, lanes of what held each region, and a table of every moment: why it started, what it displaced and how it ended; filters and an export (D21).

![History](step-4-moments/09-history.svg)

### Storyboards (organiser before the event; attendees at the peaks)
A storyboard is a list of steps (template, content with placeholders, duration, transition, sound), triggered by a run-of-show item, a domain event, a time or a take by hand; preview with a scrubber, test-fire on one zone, and five built-ins to start from (L5, L6, D9, D10, E6).

![Storyboard builder](step-4-moments/10-storyboard-builder.svg)

The built-ins on screen: doors open, starting soon, champion, midnight (the fifth, match called, is the design's `match_called` widget with a ripple):

![Storyboards on screen](step-4-moments/11-storyboards-on-screen.svg)

### Sound (organiser, crew)
Per zone, a budget for the hour; the legacy engine's six categories with their sounds, cooldowns and levels; master switch, a timed mute and a sound check; and a log of every decision with its reason (L9, D14–D17, D23, E12, E13). *Overridden by D16: the Plan's [sound model](#the-sound-model-d16) (categories, cues per event, a library); the two mockups below are redrawn for it.* How each sound is decided, on the server, the same on every screen of a zone:

![Sound desk](step-4-moments/12-sound-desk.svg)

![How a sound is decided](step-4-moments/13-flow-sound-decision.svg)

The screen effects of a cue (the pools, the hold time, the random pick) are design sheet 14's "Screen effects" section, unchanged (L7, L8).

### Scenes (organiser before the event; crew on the floor)
Where scenes sit among the other layers, and the scene on the crew remote with the "Peak now" button. The Scenes editor itself is design sheet 12 (D5, D6, L14, E7).

![Layers and scenes](step-4-moments/14-layers-and-scenes.svg)

### Reactions (attendees, crew)
A fixed set sent from the hub floats up the large panel's edge, at most one a second per screen, off in quiet scenes, with a crew switch; drawn here so the session can decide whether step 4 builds the Moments side of it or the App track does (P4, D19, O1).

![Reactions](step-4-moments/15-reactions.svg)

## Port, drop or invent
Verdicts follow [0020](../decisions/0020-best-of-old-freely-new.md) and the [canccusignage port table](../legacy-inventory/canccusignage.md#port-recommendation).

### Port as is (code and its tests, with clock, zone and storage injected)
| Legacy | Into | Why |
|---|---|---|
| Sound engine core (`engine.ts`): one at a time, category priority, dedupe, cooldown, ambient gap, stale queue (4 s), flood guard (per source 10 s, per minute), coalescing (2 s), emergency pre-emption | Moments' sound decision, per zone, on the server | Pure and tested (28 + 25 tests); it was bundled for the kiosk, so it already has no I/O |
| Categories and priorities (`categories.ts`): attention 40, something new 30, result 50, urgent 70, ended 20, ambient 10 | Moments' sound categories | The design's six names (bell, fanfare, alert, pizza, photo, ambient) are sounds; the legacy categories are the right axis for rules ([D16](step-4-moments/questions.md#d16-sound-categories-the-legacy-six-or-the-designs-six)) |
| Catch-up (`catch-up.ts`): a missed pre-start cue plays late within a window, at most once (T−29 to T−15, T−14 to T−2) | Moments' catch-up, generalised to any cue with a window | Pure; 11 tests; its windows become the tournament cues' defaults |
| Once per source (7 days) | Moments, server-side per event | The rule is right; its home (the kiosk's local storage) was wrong |
| Directive ranking rules: rank bands, TTL default 120 s and maximum 7200 s, re-posting the same content extends the TTL, a lower card refused with a 30 s retry, an announcement over a stream becomes an overlay | The arbiter | 10 + 10 tests (`directive-store`, `directive-precedence`); the bands become the adjustable priority list |
| Directive history: set, clear, expire, reject, with actor | The history, plus "displaced" and "why" | 6 tests; the shape is right, the detail grows |

### Port with changes
| Legacy | Change | Why |
|---|---|---|
| Directives: one row per source and label, global | Per event and per zone, in Postgres, several per zone by region | One screen and one slot by design |
| Control API for directives (`POST /api/control/override`, per-sender tokens) | The Moments API with central sign-in and rights; the bot (step 6) calls it as a module | Tokens per sender dropped (0010) |
| Ops directive presets in `/admin/ops` | Crew moments: announce, spotlight, storyboard, Peak now, emergency | The presets were URLs of embedded pages |
| Spotlight (pin one photo full screen; refused while a directive is up) | The crew spotlight: a ranked moment in the hero with live content (standings, bracket, a photo, a message), design sheet 13 | A takeover rather than its own pin (port table) |
| Sound settings, sound log, uploads (MP3 and OGG, length parsers) | Postgres per event; uploads as Screen's `audio` assets; PATCH validated; the log's reasons as codes | Known problem 11: unvalidated PATCH, reasons mixed with sentences |
| Sound board commands (preview, sound check, stop), kiosk presence | Per device on the server, delivered on the screen's stream | They lived in process memory |
| Bot trigger settings (hot-game banner time 120 s and cooldown 900 s, announce default 60 s, poll times) | Moments' rule settings; the bot keeps only its own thresholds | The flow 4 split in the inventory summary |
| Bot `/signage-announce` with `sfx` and duration; clear; reset | The one announce action (#115); the bot's commands call it in step 6 | The roadmap's "grows from today's announce command" |
| The cue-test page | A test fixture that sends synthetic triggers, never a production page | Port table |

### Drop
| Legacy | Why |
|---|---|
| Sound decisions in the kiosk, by diffing successive screen states | The server decides once per zone; every screen of a zone agrees |
| Cue messages from embedded pages (`canccu:screen-cue`), the display page's `view` and `sfx` URL parameters | 0010: no page embedding, no `postMessage` |
| Reads that write: directive expiry, mute timers and catch-up run on every state read | A server-side tick per event |
| Poll directives and their bands (`poll_active`, `poll_result`) | No module plans polls; a band comes back with a module that emits one |
| The stream directive kind | Never built; its rank stays reserved for the Cast track |
| `/admin/triggers` as a page | Rule settings live with the rules (Studio → Moments) |
| The cue-id migration | Nothing is migrated (0004) |
| The ten placeholder sounds (four distinct files copied) | A licensed default pack (L9) |

### Invent
| New | Where | Why |
|---|---|---|
| Regional arbitration: share by region first, queue second, with patience | Moments, with Screen's placement | The step's core idea; the legacy had one slot |
| Scenes, the autopilot, with presets that reproduce step 3's "follow the day" | Moments; Screen renders | Design sheet 12; nobody directs at 03:00 |
| Cues: effect pools picked at random, never twice running, held 60–120 s | Moments picks, Screen draws | Design sheet 14 |
| The adjustable priority list per event and zone, with a preview | Studio → Moments | #112; the legacy bands were constants |
| On air: per zone what is live, hidden, queued and why; the next two hours | Studio → Moments | Explain every decision |
| History with "why" and "displaced" | Studio → Moments | The automation trace |
| The announcement composer: levels, channels, templates, attach to an item, edit and withdraw everywhere | Moments; bot and Notify consume | 0022's one announce action |
| Storyboards as data, with a preview, a scrubber and test-fire | Moments; Screen plays `steps` | #114 |
| Server-side sound sync: `play_at` in the composed state | Moments decides, Screen plays | #113's 200 ms target |
| A sound log with a reason for every decision | Studio → Cues | Known problem 11; explain every decision |
| One-hold emergency with an "All clear" | Moments | Safety is simple |
| Reactions from a fixed set, rate-limited | Moments (if P4 keeps it in step 4) | Design sheet 16 |

## The lead's step 2 notes
1. **Who may mark an announcement urgent** (Notify's urgent exception relies on it): a separate right, `moments.announce.urgent`, granted with the event admin role and grantable to crew; the announce API answers 403 when a request without it asks for `urgent`, and the event carries `urgent` only when the sender held it ([U3](step-4-moments/questions.md#u3-who-may-mark-an-announcement-urgent)). *Superseded by U3 A: no separate urgent right ([Plan, Rights](#rights)).*
2. **How an override that held several zones (or `zones: []`) reports a partial end:** when an override leaves only some of its zones, Moments first emits `moments.override.changed` with `zones` narrowed to the explicit list it still holds (also for `zones: []`), then `moments.override.ended` for the zones it left; `.ended` gains an additive `final` boolean, `true` only when the override is gone from every zone. A consumer tells a partial end from a full one by `final` alone ([D3](step-4-moments/questions.md#d3-a-partial-end-of-an-override-that-held-several-zones)).

## Proposed issue changes
For the lead to apply after the session; each assumes the recommendation of the questions it names.

### A contract change that comes first (new, high, if D2 is B)
`docs(contracts): several overrides of a kind per zone`: the event catalog's "at most one override of each kind is active on a zone" ([events.md](../../contracts/events.md#screen-overrides)) forbids two blocks at once, which region sharing needs (standings in the hero and an announcement in the rail are both `block`). Screen already places any number by rank, but a consumer may rely on the guarantee, so lifting it is treated as a breaking change: its own PR, merged first, with the maintainer's accept (AGENTS.md, Contracts). No code; Screen needs no change.

### #112 the Moments engine (keep, rewrite; normal)
- Rename: "the Moments engine: the arbiter, priorities, history, the crew spotlight and emergency".
- **Who places:** replace "the engine places concurrent moments" with: Moments ranks, times, queues and refuses; Screen places (as built in step 3) and reports placement in `screen.claims.changed`, which Moments follows (D1).
- `contracts/moments.md` and `moments.openapi.yaml`, engine part: moment requests, the default priority order, per-event and per-zone orders, patience, refusal with retry, history, the rights; additive to events.md: `.ended`'s `final` and the narrowing rule (D3).
- Persistence: every active, hidden and queued moment in Postgres; a server-side tick owns every TTL and revert; a test proves a takeover reverts on time across a restart (already a criterion; keep).
- Add the **crew spotlight** (design sheet 13): content (standings, bracket, a photo, a message), duration, zones, live updates through `.changed`; the phone flow on the Screens tab.
- Add the **emergency flow** ([mockup 07](step-4-moments/07-flow-emergency.svg)): `moments.emergency`, hold to start, one action to end, the optional "All clear", the superadmin venue-wide.
- Add the pages: **On air**, **Priorities** with the preview (through Screen's zone preview path), **History** with filters and export.
- Add the built-in **rules** for catalog events that already have emitters or provisional contracts (tournament, pizza, games surge), each with on/off, rank, regions, duration and zones (D7, D8); tested on fixture events.
- Keep: "interactive and lively" (QR targets and live data bindings), history, an emergency always wins.

### New: `feat(moments): scenes, the venue's autopilot` (normal)
- Scenes as data (design sheet 12): conditions (time per event day, agenda kind, check-ins, the crew button; presence and games when their emitters land; the outside signal stays planned), changes (motion level, layout per zone, stage mood, palette, sound on or off, quiet mode, hero features), the priority list (first match wins), hold and blend times, five presets.
- `moments.scene.changed` per zone; Screen composes it into `display` where it uses the day's phase today; with no scene configured the presets reproduce "follow the day" exactly, and a CI test proves the two agree (D5, D6).
- The Scenes page in Screen studio (sheet 12), the band chart's data, "Peak now" on the crew remote.
- The visual heartbeat's rate (from check-ins and the agenda now, presence later), drawn by Screen (L10).

### #113 cues and sound (keep, rewrite; normal)
- Rename: "cues: picture and sound, with a budget".
- **Cues:** effect pools per kind of event, a random pick never repeated twice running, the hold time per kind (design sheet 14 "Screen effects").
- **Sound:** the legacy engine ported with its tests (above); categories, cooldowns, flood guard, hourly budget per zone, once per source, catch-up windows; links from any trigger to any sound with volume, cooldown and zones (sheet 14 "Sound").
- The library: uploads as Screen's `audio` assets (MP3 or OGG, at most 10 s), preview, and a licensed default pack covering every built-in moment and storyboard (L9, D23). *Overridden by D16: up to 30 s, cues per event, several sounds per cue ([Plan, #113](#113--featmoments-cues-picture-and-sound-with-a-budget)).*
- Sync: `play_at` in the composed state; a test on the demo stack shows the screens of a zone start within 200 ms (D14).
- The sound log with reason codes, master switch, timed mute, sound check.
- Keep the test: a burst of 50 triggers in a minute stays within the budget.

### #114 storyboards (keep, sharpen; normal)
- A storyboard compiles to an Override with `steps`; add the additive step field `transition` to the screen contract (D9).
- Triggers: a run-of-show item at its start or n minutes before (the agenda module, which replaces the old #103 reference), a domain event, a time, a take by hand; patience when the region is held (E6).
- The built-in five: doors open, starting soon, champion, midnight, match called. The full set is still designed with the product owner when the package starts.
- Preview with a scrubber on the virtual screen; test-fire on one zone, silent unless chosen, marked as a test in the history.
- CI screenshots of each built-in through `scripts/demo-screenshots.mjs` and its groups file, named as the test (O3).

### #115 the announcement composer (keep, sharpen; normal)
- Event names: `moments.announcement.sent`, `.changed`, `.withdrawn` instead of `announce.*` (D4): the catalog names an event by its emitter.
- Notify's `announcements` topic: owner `moments`, trigger `moments.announcement.sent`, urgent from `data.urgent` (an additive change to notify.md in this package).
- Levels: info and urgent here; emergency hands over to #112's flow. Urgent needs `moments.announce.urgent` (U3). *Overridden by U3 A: anyone who may announce ([Plan, #115](#115--featmoments-the-announcement-composer-for-every-channel)).*
- The ticker line is a claim in the `ticker` role owned by Moments, not a write to Screen's manual ticker (D13).
- Templates with a fixed set of run-of-show placeholders (D11); attach to an item and follow its delay; an item cancelled withdraws the announcement (E15). *Overridden by D11 B: plus free variables the organiser defines ([Plan](#115--featmoments-the-announcement-composer-for-every-channel)).*
- The composer's home: Run the event → Announcements, plus a quick action on the phone and "Announce this" on a run-of-show item (U5).

### Out of step 4 (proposed)
*Settled in the [Plan](#out-of-step-4), which adds text to speech to the backlog (P8).*
- **Reactions:** the Moments side waits for the App track's hub, which sends them; designed here (P4). A `Roadmap note:` for the App track.
- **Memories** (named by tenants.md as Moments'): an App track item, not this step (P10).
- **A director desk with preview and program monitors:** later, as 0022 says.

### Order (a sketch for the planner)
*Settled in the [Plan](#order-packages-by-dependency-chain).*

1. The contract change above, if D2 is B (merged first, maintainer's accept).
2. #112 the engine.
3. In parallel: scenes; #113 cues and sound.
4. In parallel: #114 storyboards; #115 the announcement composer.
5. The exit on the demo tenant, then the health pass and the checkpoint.

**Proposed additions to the exit criteria** (*amended in the [Plan](#the-step-4-gate)*): on the demo tenant, three moments share the main hall at once and the portrait zone degrades the announcement to a ticker line; a priority change takes effect live; an emergency takes every zone and "All clear" brings each screen back as it was; a restart of Moments loses nothing; a burst of 50 triggers stays within the budget and the log says why; the screens of a zone start a sound within 200 ms; the scene presets reproduce step 3's look exactly; each built-in storyboard has a CI screenshot.

## Open questions
*All answered on 2026-11-16 ([decisions.md](step-4-moments/decisions.md)); see the [Plan](#plan).*

All of them are in the [question bank](step-4-moments/questions.md). Decide first: **L1** (the direction), **P1** (the issue set: scenes and cues in step 4?), **D1** (who places), **D2** (the catalog's one-of-each-kind rule), **U1** (who runs Moments on the day), **U3** (the urgent right), **D4** (the announcement event names), **P4** (reactions now or with the hub), **D16** (sound categories).
