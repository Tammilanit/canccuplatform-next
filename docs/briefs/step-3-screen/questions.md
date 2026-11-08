# Step 3 question bank

Every open question the research for [the step 3 brief](../step-3-screen.md) found, grouped by theme, each with its options and a recommendation. It replaces the brief's usual "at most 7 questions" for the product owner's brainstorming session (the lead's comment on #106, 2026-11-08). IDs are stable, so the session can answer "U6: C" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): L1, U1, U6, L2, D6, D18, P1, P2, P3, O3.

A question marked **contract** needs an additive contract change if the recommendation is taken; those go in one screen contract PR at the start of step 3, merged before any consumer (AGENTS.md, Contracts). None of the recommendations is a breaking change.

## U · Who uses it and how

### U1. Who runs the screens on the day?
The answer sets what Studio optimises for.
- **A.** The organisers, from their phones on the floor, between other jobs.
- **B.** A dedicated "screen person" at a desk, directing like a broadcast (direction A).
- **C.** The venue crew, who own the screens across events.
- **Recommendation: A**, with B possible. Live actions (delay, ticker, push, device help) are one tap on a phone ([mockup 13](13-crew-remote.svg)); preparation (schedule, layouts, content) is a desk job. The screen runs itself from the run-of-show, so nobody has to direct it.

### U2. Who pairs and sets up the screens?
Pairing needs `screen.devices.pair` on the event.
- **A.** An event admin, at each event.
- **B.** Venue crew get only the device and ticker rights at the event, granted to them as members.
- **C.** The venue's screens are paired once and handed from event to event by the superadmin; events pair only extra screens.
- **Recommendation: C plus B.** Venue screens stay paired across events (the move in [mockup 15](15-superadmin-move.svg)). The tenants contract lets an event grant rights to a member without the event-admin role, so a "screen crew" preset in admin can grant `screen.devices.*`, `screen.ticker.write` and `agenda.items.write` in one action, and venue crew help without full admin rights.

### U3. A pairing QR on the kiosk?
- **A.** The 8-character code only (the contract).
- **B.** The code plus a QR that opens Studio's pair dialog on a signed-in phone, with the code in the URL fragment.
- **C.** A QR only.
- **Recommendation: B.** No contract change; nobody types at a kiosk or reads a code across a hall ([mockup 05](05-device-states.svg), [06](06-flow-pairing.svg)).

### U4. How many QR codes may a screen show at once?
Every widget can carry `props.qr`; too many codes make a screen look like a form.
- **A.** One handoff QR per screen (the venue rail), plus the check-in QR where a zone wants it.
- **B.** Per-widget QR codes wherever a widget has a natural target (`props.qr: auto`).
- **C.** Only the check-in QR.
- **Recommendation: A.** The built-in layouts set `auto` only on the venue rail; organisers may turn on more per widget.

### U5. Preparing ahead or running live: which does Studio lead with?
- **A.** Preparation: schedule and playlists first (direction B).
- **B.** Live: what is on now, and the live actions.
- **C.** Both, with a "Live" home during the event and the planning pages one tap away.
- **Recommendation: C.** Studio opens on Live while the event is `live`, on Zones before it.

### U6. How is a zone change previewed before it goes live? (contract)
The grid is a theme layout (theming has draft → preview → publish). What each region of a zone shows is the zone's own settings, saved at once with a revision ([mockup 08](08-studio-zone-editor.svg)).
- **A.** Save at once, with an undo for 10 minutes (the old revision kept by the client).
- **B.** The studio renders the proposed zone in the browser from the current composed state (widgets that are new to the zone have no view-model yet, so they show placeholders).
- **C.** An additive path, `POST /api/screen/zones/{zone_key}/preview`, that answers a `ScreenState` for a proposed zone without saving it; the studio renders it with the real player.
- **D.** Zone drafts with their own publish, like themes.
- **Recommendation: C plus A's undo.** One small additive path gives a true preview with real data; drafts for zones (D) would double the publish concepts organisers must learn.

### U7. What does the admin's Live page show?
- **A.** One zone at a time, as a live mirror.
- **B.** Every zone at once, as small live mirrors (a multi-view), with a click for full size.
- **Recommendation: B.** It is the first place to look on the day. Mirrors are silent and are not devices (the contract).

### U8. Is the ticker from Studio enough until the bot arrives?
The bot's `/ticker` commands land in step 6 and call the same API.
- **A.** Yes: Studio and the crew remote set it in step 3.
- **B.** No: a minimal Discord path is needed in step 3.
- **Recommendation: A.**

### U9. Undo for live run-of-show edits?
A delay notifies people; an undo notifies them again.
- **A.** No undo button: a delay of −15 is the undo.
- **B.** An undo button for 2 minutes that applies the inverse change (a delay back, a move back), saying that people will be told again.
- **C.** A version history of the agenda with restore.
- **Recommendation: B.** Client-side, no contract change ([mockup 11](11-agenda-live.svg)).

### U10. A backstage screen that shows crew-only items?
Crew items never reach a screen today.
- **A.** Never: a venue screen is public.
- **B.** A zone flag that lets its screens show crew items.
- **Recommendation: A** for step 3. A crew screen is a `Roadmap note:` for the checkpoint.

### U11. Which languages on the screen and in Studio, from when?
The roadmap puts Finnish as the first language pack in step 10; #110 asks for Finnish and English strings from the start.
- **A.** English only, with every string behind a message key from day 1.
- **B.** English and Finnish from day 1, in Studio and on the screen.
- **C.** A per-event language (`admin.language`) from day 1, with English shipped and Finnish in step 10.
- **Recommendation: C**, unless the first event on the platform needs Finnish screens; then B for the screen only (a few dozen strings: NOW, NEXT, "offline since", the device states).

## L · Look and feel

### L1. Which direction?
See the brief's three directions and [mockup 01](01-directions.svg).
- **A.** Channel: the venue's own TV channel.
- **B.** Billboard: the legacy signage, polished.
- **C.** Pulse: the room's living dashboard.
- **Recommendation: C as the body, A's broadcast grammar for claims and transitions, B's scheduler and playlists inside the hero.**

### L2. What fills the hero when there is no content? (contract)
A new event has no playlist; the contract's idle rule shows the logo.
- **A.** The logo (the contract).
- **B.** The next run-of-show item with a big countdown, then the logo when the agenda is empty too.
- **C.** An ambient backdrop from the theme with the clock.
- **Recommendation: B**, as a new idle value `next` (additive) used by the built-in layouts' hero. The first screen is useful with nothing uploaded ([mockup 17](17-flow-first-screen.svg)).

### L3. How much motion?
- **A.** Calm: fades only, slow rotation.
- **B.** Lively: animated transitions, filling progress bars, stingers.
- **C.** Per theme, through a motion token, always honouring `prefers-reduced-motion`, with a calm default during quiet hours.
- **Recommendation: C**, default moderate (fades and progress bars; stingers only in claims).

### L4. A theme gallery to start from?
- **A.** Only the platform defaults.
- **B.** The demo themes (`default`, `terminal`, `level-up`) as starting points in the brand kit.
- **C.** B plus shared community themes later.
- **Recommendation: B.** They already exist and are tested by CI screenshots.

### L5. Dark or light on screens by default?
- **A.** Dark (projectors in dim halls, less glare).
- **B.** Light.
- **C.** The organiser picks in the brand kit, with dark as the default.
- **Recommendation: C.**

### L6. Does the platform show its own mark on screens?
- **A.** Never.
- **B.** Only on the device-state screens (pairing, refused, not assigned).
- **C.** A small corner mark on every Pulse.
- **Recommendation: B.** The event's screen belongs to the event.

### L7. Readability from across the hall: a rule CI checks?
- **A.** Guidance in the docs only.
- **B.** CI measures the demo themes' screen screenshots: no text under 2.5 % of the screen height (27 px at 1080p) and the theming contrast rules.
- **C.** B, plus the same size check as a warning when an advanced theme is published.
- **Recommendation: C.** #109 already asks for "readable from across a hall (theme tokens checked in CI)"; this makes it measurable.

### L8. Portrait screens from the start?
- **A.** Yes: `pulse_portrait` is in the contract and in CI screenshots.
- **B.** Landscape first, portrait later.
- **Recommendation: A** ([mockup 03](03-pulse-portrait.svg)).

### L9. Which resolutions are tested?
- **A.** 1920×1080 only (1080p first, gap 5).
- **B.** 1280×720, 1920×1080 and 3840×2160, each landscape and portrait, in CI screenshots.
- **Recommendation: B** for the default theme, A for the others.

### L10. TV overscan and safe areas
Some TVs crop the edges.
- **A.** The theme's `safe_inset` token only.
- **B.** A per-zone inset override.
- **C.** A per-device inset (a device-assignment setting).
- **Recommendation: A** in step 3; if a venue TV crops, a `Roadmap note:` for B.

### L11. Burn-in protection for static elements?
OLED and plasma panels can keep a ghost of a static logo or clock.
- **A.** None.
- **B.** A slow 1–2 px drift of static regions, off by default, a theme token.
- **Recommendation: B**, cheap and invisible.

### L12. Video sound in step 3?
Claim sounds are Moments' (step 4); playlist videos have `muted`.
- **A.** Videos always muted in step 3.
- **B.** Unmuted items play only on the zone's sound device (`sound.device_id`), muted by default.
- **Recommendation: B.**

### L13. How does the ticker move?
The legacy marquee flashed mid-loop.
- **A.** A scrolling marquee always.
- **B.** A static line that fades between messages, scrolling only when a line is wider than the screen, never under reduced motion.
- **Recommendation: B** ([mockup 13](13-crew-remote.svg)).

## D · Data and integrations

### D1. Pairing sets the new device's tenant: confirm?
The screen contract reads 0013 item 34 so that creating a device on the event that pairs it is the only time anyone but the superadmin sets a current tenant (the lead's step 2 note).
- **A.** Confirm, and record it as an amendment of 0013 in its own decision PR.
- **B.** Only the superadmin may ever set it: events cannot pair; the superadmin pairs every device.
- **Recommendation: A.** B would make the superadmin a bottleneck for every new screen.

### D2. The transfer code for moved devices: confirm?
A moved kiosk is sent to its new hostname with a one-time, 60-second transfer code; the old token only ever redirects.
- **A.** Confirm.
- **B.** Re-pair after every move.
- **Recommendation: A.** No one touches a kiosk between events at the same venue.

### D3. SSE rather than WebSocket for the push channel: confirm?
- **A.** Confirm SSE: one-way, plain HTTP through Caddy, carries the device cookie, resumes by itself; commands travel on it too.
- **B.** WebSocket.
- **Recommendation: A.** Nothing in step 3 needs a channel from the screen to the server beyond the heartbeat.

### D4. Plain dated windows? (contract)
Windows are weekly (legacy) or bound to a run-of-show item.
- **A.** Weekly and agenda-bound only; a dated one-off is an agenda item (also a `crew` one, which never shows anywhere) with a bound window.
- **B.** Add dated windows (start and end times) next to weekly ones.
- **C.** Replace weekly windows with dated ones.
- **Recommendation: A** for step 3 ([mockup 09](09-studio-schedule.svg)); richer rules stay N4 in the backlog.

### D5. Should kinds of agenda items switch layouts by themselves?
- **A.** No: windows are bound to items explicitly.
- **B.** A window template per kind ("every `ceremony` switches the main hall to hero only").
- **Recommendation: A** in step 3, B as a `Roadmap note:`.

### D6. The check-in page in step 3?
The rotating QR opens `/notify/check-in`; the hub's pages are the App track's ([mockup 14](14-flow-checkin-handoff.svg)).
- **A.** A minimal check-in page in the notify module in step 3: sign in, check in, done; the App track restyles it later.
- **B.** The QR shows, and the page says "coming soon" until the App track.
- **C.** No check-in QR until the App track.
- **Recommendation: A.** The step 3 screen then works end to end, and the code is small.

### D7. Crew notifications in step 3 (a screen went offline)? (contract)
Notify's audiences are `public`, `attendees` and personal; there is no crew audience.
- **A.** None until step 8's alerts; Studio shows it.
- **B.** A crew audience in Notify, and a screen topic for device health.
- **Recommendation: A.**

### D8. Video formats: transcode or not?
- **A.** Accept MP4 (H.264, AAC) and WebM as uploaded; refuse others with a reason people understand.
- **B.** Transcode every video in the render-job container to one safe profile.
- **Recommendation: A** in step 3, with a codec probe at upload ([mockup 10](10-studio-content.svg)); B is N18 in the backlog.

### D9. PDF decks as well as PPTX? (contract)
The render job already has poppler, which turns PDF pages into images. Many organisers export from online slide tools as PDF.
- **A.** PPTX only (the contract).
- **B.** Add the asset kind `pdf`, rendered by the same job.
- **Recommendation: B**: cheap, and it avoids font problems entirely.

### D10. Fonts for PPTX rendering (contract)
The render image holds a platform-wide font set.
- **A.** A broad open set (for example Liberation, Noto, Open Sans, Roboto, Montserrat, Lato), no warnings.
- **B.** A, plus `warnings` on the render job's result naming fonts the deck uses that the image lacks.
- **C.** Fonts uploaded per event (with the theme).
- **Recommendation: B.** A warning tells the organiser why a slide looks different; C brings licence questions.

### D11. The photo carousel in step 3?
The API and the `photo` widget are in the contract (flag `screen.photos`, default off); the bot's photo feed is step 6.
- **A.** Build the API and the widget, with upload from Studio.
- **B.** Wait for the bot.
- **Recommendation: A** ([mockup 03](03-pulse-portrait.svg)).

### D12. Module identity for the check-in and now-playing widgets
`checkin_qr` reads Notify's internal path (`/internal/notify/check-in/code`), which today is guarded by the internal network alone, as every internal path is until the kit has a module-to-module identity (#157). `now_playing` needs the bot's presence API as a module, which needs both that identity and a module path in the bot contract (the lead's step 2 notes).
- **A.** `checkin_qr` ships on the internal path in step 3 and moves to the identity when #157 lands; `now_playing` stays `empty` until the bot (step 6).
- **B.** #157's identity blocks the `checkin_qr` criterion.
- **Recommendation: A.** The internal network is the accepted guard for every internal path today; holding the widget back would block the step's check-in flow on step 2 follow-up work.

### D13. Web and YouTube assets in step 3?
They widen the screen's CSP (`frame-src`) and need the per-event allowlist.
- **A.** Yes, behind the existing flag `screen.web` (default on), with an empty allowlist.
- **B.** Later.
- **Recommendation: A.** The legacy screens leaned on web views; the allowlist keeps it safe.

### D14. Clone with an event: step 3 or step 8?
Screen, agenda and theming each have a clone path; series and clone-the-last-event are step 8.
- **A.** Build the clone paths with each module in step 3.
- **B.** Build them in step 8 with the series UI.
- **Recommendation: B.** The paths stay in the contracts; nothing in step 3 needs them.

### D15. Git sync for themes in step 3?
It needs a guarded fetcher and encrypted credentials (the secrets helper of #157).
- **A.** In step 3, after upload and the simple mode.
- **B.** Later (step 10 or on demand).
- **Recommendation: B.** Upload covers the event repo's theme folder as a zip.

### D16. Custom embeds in step 3?
The `terminal` and `level-up` demo themes use them, and the theming contract's screenshot test covers them; the same-host sandbox is security work.
- **A.** In step 3, as their own high-risk package.
- **B.** Later; the demo themes' embeds show nothing until then.
- **Recommendation: A.**

### D17. The agenda's tournament-session mirror before the tournament exists?
- **A.** Build it in step 3 against the event catalog with contract-tested fixtures; it goes live with step 7 (the OC8 pattern).
- **B.** Build it in step 7.
- **Recommendation: A.**

### D18. How much of Notify in step 3?
The roadmap puts the topic registry, Web Push, delivery rules and check-in in step 3, and the hub pages in the App track. Without hub pages nobody can subscribe yet.
- **A.** The whole backend, tested through its API with a fake push service; only D6's check-in page has a UI.
- **B.** Check-in codes and the topic registry only; Web Push and delivery with the App track.
- **C.** A plus a minimal subscribe page.
- **Recommendation: A**, as the roadmap says. It lets the App track start on a finished backend.

## E · Edge cases and failure

### E1. Kiosk start-up after a power cut
Auto-starting the browser on the venue PC is the venue's job.
- **A.** A short kiosk setup guide (Windows, Linux) with the browser flags the legacy found (autoplay, occlusion), and a check page that tests audio unlock, clock offset and the viewport.
- **B.** Nothing in step 3; the install kit is step 10.
- **Recommendation: A**: the legacy's black and silent screens came from missing browser flags.

### E2. One screen down, or the venue uplink down?
- **A.** Each device alarms on its own.
- **B.** When every device of a venue goes offline within a minute, Studio says "the venue uplink may be down" once ([mockup 16](16-flow-offline.svg)).
- **Recommendation: B**, a rule over device health with no contract change.

### E3. Kiosk clock drift
Rotation runs on the server clock through the heartbeat's `server_time`.
- **A.** Apply the offset silently.
- **B.** Apply it, and flag a device in health when the offset is over 2 seconds.
- **Recommendation: B.**

### E4. The venue's public address changes during the event
Every screen is then refused.
- **A.** The event admin turns on the audited emergency switch (at most 48 hours).
- **B.** The superadmin updates the venue's addresses.
- **C.** The platform learns the new address by itself.
- **Recommendation: A and B**, never C (the address check exists to stop exactly that). The refused screen tells the crew what to do ([mockup 05](05-device-states.svg)).

### E5. A theme publish breaks the screen (CSS hides everything)
- **A.** Restore the previous revision in one click; the safety elements in `canccu-base` stay visible whatever the CSS says.
- **B.** A, plus a preview step that Studio requires before publishing a theme with changed CSS.
- **Recommendation: B.**

### E6. A playlist item fails (missing file, private video, web page that never loads)
- **A.** Skip it and show the event's fallback image for the slot (the contract), and show the error in device health from the heartbeat's `errors`.
- **Recommendation: A**: the legacy's frozen kiosk after a failed video is the bug to avoid.

### E7. Two organisers edit the same thing
Writes carry a revision and answer 409 when it is stale.
- **A.** "Changed by someone else, reload" and nothing more.
- **B.** Show who changed it and re-apply your change when the fields do not overlap.
- **Recommendation: B** for the agenda and zones; A elsewhere.

### E8. The event is archived while its screens run
The contract shows an archived notice until the superadmin moves the devices.
- **A.** Confirm.
- **B.** Archive moves the venue's devices to the venue's next event automatically.
- **Recommendation: A**, with O6 to make the move painless.

### E9. Who may send an emergency takeover?
Step 4's question (Moments), listed so the session can note a direction.
- **A.** Any event admin, for their own event's zones.
- **B.** A venue-wide emergency, on every event at the venue, by the superadmin only.
- **Recommendation: A and B** together; step 4 settles it in the Moments contract.

### E10. A copied device cookie
The venue address check already limits a copy to the venue.
- **A.** Nothing more: revoke when noticed.
- **B.** Flag a device in health when two streams or heartbeats with different viewports use one token at once.
- **Recommendation: B**, no fingerprinting.

### E11. A cold boot while the uplink is down
The contract keeps the last state "in the browser cache"; 0022 rules out an offline-first player.
- **A.** Rely on the HTTP cache alone.
- **B.** A service worker that keeps the bundle, the last composed state and its files, so a cold boot offline shows the last state; nothing new starts.
- **Recommendation: B**, as the implementation of the contract's rule, not an offline-first player.

### E12. Daylight-saving change during an event
- **A.** The scheduler computes windows in the event's time zone with the legacy rules, with tests across both transitions.
- **Recommendation: A.**

### E13. Nothing at all to show
No theme, no agenda, no content.
- **A.** The logo, else the event's name, on the theme background: never a blank frame (legacy gap 4).
- **Recommendation: A.**

## O · Operations and scale

### O1. What scale does step 3 prove?
- **A.** The demo tenant's two devices (the exit criteria).
- **B.** A load script in CI: 100 screens' streams across two tenants, with the one-second push target measured.
- **Recommendation: B.** The large-event load harness stays in the backlog; this is its smallest version.

### O2. How is the one-second push measured?
- **A.** Not measured.
- **B.** A demo-stack test changes an agenda item and times the SSE message (p95 under one second).
- **Recommendation: B.**

### O3. The 24-hour soak test
#109 asks for 24 hours on the kiosk browser without memory growth "in CI with a fixed budget"; a 24-hour CI job is not practical.
- **A.** An accelerated soak in CI: a fake clock runs 24 hours of rotations, pushes and reconnects in about 10 minutes, with a heap budget.
- **B.** A real 24-hour run on the test VM as an exit check of the step.
- **C.** Both.
- **Recommendation: C.** The legacy's worst kiosk bug (unread response bodies holding memory) showed only after hours.

### O4. Device thumbnails in Studio
- **A.** Live mini mirrors of each device's zone in the admin's browser (the virtual-screen route).
- **B.** Server-side screenshots every minute (a browser on the server).
- **C.** The kiosk captures its own screen (not possible from a web page without a prompt).
- **Recommendation: A** ([mockup 07](07-studio-devices.svg)).

### O5. "Freeze the screens" for the event
Pins keep a bundle version and a theme revision.
- **A.** Pins only through settings.
- **B.** A "freeze for the event" switch in Studio that pins the current bundle and theme revision, and unpins after.
- **Recommendation: B**, so a platform deploy never changes a running event's screens unasked.

### O6. Moving devices "after the event ends" (contract)
The registry's PATCH moves a device at once.
- **A.** The superadmin moves them by hand after the event.
- **B.** An additive `effective_at` on the move.
- **Recommendation: A** for step 3 ([mockup 15](15-superadmin-move.svg)), B if moves become routine.

### O7. Storage per event
Assets count against the event's storage quota; the default is not set.
- **A.** 2 GB per event, raised by the superadmin.
- **B.** No limit until step 10.
- **Recommendation: A.**

### O8. Render capacity
One running job per event, events served in turn.
- **A.** One render container per stack.
- **B.** Two workers per stack, more by replicas.
- **Recommendation: B**, so one event's big deck never delays another's beyond one job.

### O9. Deploys while screens run
The deploy hold and pinned bundles exist (0013 items 22–23).
- **A.** As is: screens reconnect after a deploy, and a pinned bundle keeps the player unchanged.
- **Recommendation: A.**

## P · Plan and scope

### P1. Issues for the three new modules
Step 3 builds `theming`, `agenda` and `notify`, but the step has no issue for them.
- **A.** Add one issue per module (the brief's proposed issue changes).
- **B.** Fold them into the screen issues.
- **Recommendation: A.**

### P2. Split the Studio issue (#110)?
It holds the calendar, the layout editor, playlists and assets, the ticker, devices, phone layouts, two languages and rights.
- **A.** Keep one issue.
- **B.** Split into "Studio essentials" (Live, Devices, Ticker, Zones) and "Studio planning" (Schedule, Content, the layout editor).
- **Recommendation: B.** The essentials are what the exit criteria need.

### P3. Take the render job out of #108?
It is its own container, isolates untrusted uploads, and has its own queue.
- **A.** Keep it in #108.
- **B.** Its own issue, high risk (sandboxing untrusted files is security work).
- **Recommendation: B.**

### P4. Where do the run-of-show and brand-kit pages live?
- **A.** In each module's issue, under one admin navigation ("Event": run-of-show, brand kit, notifications).
- **B.** In the Studio issues.
- **Recommendation: A.**

### P5. Claims in step 3?
Placement of Moments' overrides is Screen's contract.
- **A.** Build and test placement in #109 with fixture `moments.override.*` events, so step 4 adds only the ranking.
- **B.** Wait for step 4.
- **Recommendation: A** ([mockup 04](04-pulse-claims.svg)).

### P6. CI screenshots for theming and the screen
The lead's step 2 note: `theming-<theme>-<surface>[-<layout>].png` and per widget `theming-<theme>-screen-<layout>-<widget>.png`, a `.github` change.
- **A.** Its own issue after the player, high risk (`.github`).
- **B.** Inside the player issue.
- **Recommendation: A.**
