# Step 8 question bank: admin operations

The open questions of the [step 8 research pack](../step-8-admin-operations.md), for the product owner's brainstorming session. Each has its options and a recommendation; the IDs (U3, D10, …) are used in the brief and in the mockups' notes. **Decide first:** [P1](#p1-the-direction), [U2](#u2-what-event-crew-see-of-the-platform), [U3](#u3-who-hears-an-alert-in-discord), [D1](#d1-the-alert-kinds), [D10](#d10-the-executor), [U13](#u13-who-runs-a-clone), [P2](#p2-the-issue-set) and [P3](#p3-the-exit-criterion).

Seven themes: the step itself (P), who uses it and how (U), look and feel (L), data and integrations (D), edge cases and failure (E), operations and scale (O). 76 questions.

Words used here: a **part** is one of the stack's containers (a module, or a shared service such as Postgres) as admin's Health checks it; a **subject** is what an alert is about (a part, a screen, the event's bot); an **incident** runs from the moment a subject is confirmed not ok until it is ok again; an **audience** is who hears about it (the platform's superadmins, or one event's crew).

## The step (P)

### P1. The direction
- **A. The manager, ported:** canccumanager's rules inside admin's Health page, alerts to the bot, ack and mute, and a superadmin restart button; series and venues as plain forms.
- **B. The control room:** an operations console with on-call rotas, escalation chains, runbooks, log search, metrics graphs and maintenance windows.
- **C. The calm crew desk:** problems in plain words with the next step, one voice per audience, fixes that try themselves first, and the next event started from the last one in one guided flow.
- **Recommendation: C.** See [Three directions](../step-8-admin-operations.md#three-directions).

### P2. The issue set
The epic (#62) has no children yet; the pack proposes five ([Proposed issue changes](../step-8-admin-operations.md#proposed-issue-changes)).
- **A.** One issue per roadmap bullet (operations; series and clone; venue profile).
- **B.** Five issues: alerts and incidents; the bot's relay and `/platform status`; fixes (the executor and auto-fix); the next event (series and clone); venues.
- **C.** Two: operations, and series with venues.
- **Recommendation: B.** Each is a whole capability and the risk classes differ; the planner bundles them into packages.

### P3. The exit criterion
The roadmap's: "an alert reaches Discord and can be acked".
- **A.** As written, checked by hand.
- **B.** Made checkable on the demo stack: stopping a part opens an incident, the fake Discord gets the alert, its Acknowledge button acks it, the reminder stops, and the recovery edits the message; plus the next event cloned from the demo event with every part reporting done.
- **C.** B without the clone.
- **Recommendation: B.** The step's second half ("the next event starts from the last one") needs a check too.

### P4. Series and clone overlap with the Go-public track
The tenants part of series and clone is #150 (Go public), which waits for the central sign-in (#52).
- **A.** Step 8 builds the admin side (the flow, the orchestration, the modules' clone parts) and waits for #150 for the tenants part.
- **B.** Step 8 takes series and clone out of #150 and builds both.
- **C.** Step 8 drops series and clone; Go public does all of it.
- **Recommendation: A.** #150 already holds the tenants part; the next-event issue is blocked by it, and the alerts issues are not, so the step can start without it.

### P5. Risk classes
- **A.** Everything normal (docs and features inside admin).
- **B.** As the merge rules read: alerts and incidents high (new rights), the bot's relay high (rights through Discord, a webhook secret), fixes high (`deploy/`, a privileged sidecar), the next event high (role-only rights, tenancy), venues high (venue addresses gate screens and admin access).
- **Recommendation: B.** The planner may still bundle related high issues into one package (one accept).

### P6. What waits for step 10
Step 10 holds pre-flight checks, the outside watchdog and backup.
- **A.** Keep them in step 10; step 8 only links to them.
- **B.** Pull the pre-flight check into step 8 (it reads the same facts).
- **Recommendation: A.** Lean scope; a `Roadmap note:` says the pre-flight check can reuse the alert kinds.

## Who uses it and how (U)

### U1. Who opens Health and acts on alerts
Today Health opens with `admin.settings.read`.
- **A.** Keep it: whoever reads settings sees Health and acts.
- **B.** New rights: `admin.health.read` (Health and incidents), `admin.alerts.ack`, `admin.alerts.mute` and `admin.alerts.write` (alert settings), with a preset `on_duty` that grants the first three.
- **C.** Event admins only.
- **Recommendation: B.** A crew member on duty should ack a dark screen without seeing the settings.

### U2. What event crew see of the platform
On one shared stack a part serves every event (TI1).
- **A.** Every part, as the built page shows it today.
- **B.** The event's own facts (its screens, its bot, its food, its storage) and one coarse platform word (ok, slow, down) without internals.
- **C.** Only the event's facts.
- **Recommendation: B,** from TI1: the crew learns that a problem is not theirs to fix, and nothing about other events leaks.

### U3. Who hears an alert in Discord
- **A.** The event's alert channel only.
- **B.** The alert channel, mentioning one role (for example "Crew on duty") for down alerts.
- **C.** The channel plus a DM to each crew member marked on duty.
- **Recommendation: B.** One place, one ping; who is on duty stays a Discord role the crew already manages. C adds an on-duty state the platform would have to keep.

### U4. Who may ack
- **A.** Anyone who can press the button in the channel.
- **B.** A person whose Discord account is a platform user holding `admin.alerts.ack` in that event.
- **C.** Event admins only.
- **Recommendation: B.** The actor is a signed-in user, never a self-declared name (legacy P6).

### U5. What ack means
- **A.** As in the legacy: it stops the reminders of this incident; the first ack stands; the recovery is still posted.
- **B.** A also closes the incident.
- **Recommendation: A.** Ack says "someone is on it", not "it is fixed".

### U6. Mute: for how long
- **A.** 15 min, 1 h, until 06:00, until the event ends; never forever.
- **B.** Any time, also forever (legacy).
- **Recommendation: A.** A mute that never ends is how a real outage goes unseen. The legacy's cast relay was muted forever because it was not deployed; a part that is not deployed is not watched at all here.

### U7. Mute: what it silences
- **A.** One subject (a screen, a part, the bot): no alerts, no reminders, no auto-fix, with an optional note.
- **B.** A whole alert kind (all screens).
- **C.** Both.
- **Recommendation: C,** with kinds muted only from Alert settings (an organiser's choice) and subjects from the incident (a crew member's).

### U8. Venue staff
In step 5 the product owner chose B: venue staff get nothing of their own.
- **A.** The same here: venue staff who help are crew members with a preset (`screen_crew`, `on_duty`).
- **B.** A venue role that sees every alert about the venue's screens, across events.
- **Recommendation: A.** One kind of person per event; the venue's lasting facts are in the venue profile.

### U9. Attendees
- **A.** Nothing of operations: a feature that is down shows its own state on its own page (Food says ordering is paused).
- **B.** A public status line in the hub.
- **Recommendation: A.** Attendees need the feature, not the incident.

### U10. The superadmin
- **A.** A Stack health page on the superadmin hostname: every part, platform incidents, fixes and logs; platform alerts to a platform channel.
- **B.** The superadmin uses each event's Health page through support windows.
- **Recommendation: A** (TI3, TE4, TE5): platform alerts never go to a tenant's channel.

### U11. Who starts the next event
- **A.** As the contract has it: the superadmin creates the event in the series (it needs a hostname); an event admin of both events then copies from the last one.
- **B.** An event admin creates the next event themselves.
- **Recommendation: A.** Hostnames and venues are the superadmin's; the flow makes it one step for each.

### U12. What a copy takes
- **A.** Every part's clone, all or nothing.
- **B.** A list of parts, each on by default, any of which can be left out.
- **Recommendation: B.** An event may want last year's run of show but a new theme.

### U13. Who runs a clone
Today the contract says "the admin client then runs each module's clone".
- **A.** The browser calls each module in turn.
- **B.** Admin runs it as a job on the server: progress per part, safe to close the tab, retry of a failed part.
- **Recommendation: B.** A closed laptop lid must not leave half an event; this adds an admin endpoint (additive).

### U14. Dates
- **A.** The shift is the new event's start less the source's; shown, and editable.
- **B.** Each part asks.
- **Recommendation: A.**

### U15. Who edits the venue profile
- **A.** The superadmin (as contracted); event admins edit their event's copy and can copy again.
- **B.** Event admins may also save their copy back to the venue.
- **Recommendation: A.** One owner for the venue's lasting data; an event's edits are for that event.

### U16. `/platform status`
- **A.** In an event's guild: the event's view, for crew with `admin.health.read`; in the platform guild: the stack, for superadmins. Answers only the asker (ephemeral).
- **B.** Public answers in the channel.
- **Recommendation: A** (TD1).

### U17. The legacy LAN reset (D16)
It cleared the bot's stats and trends between events.
- **A.** Drop it: each event is its own tenant, so the next event starts empty.
- **B.** Keep a "clear test data" action for a draft event.
- **Recommendation: A.** A test run belongs in a draft event of its own.

### U18. On duty
- **A.** No on-duty state in the platform; the Discord role of U3 is it.
- **B.** An "On duty" switch on the crew's phone that routes DMs.
- **Recommendation: A** for step 8; B is a `Roadmap note:` if the role is not enough.

## Look and feel (L)

### L1. The Health page
- **A.** Health keeps its name and place; three tabs: Now, History, Alert settings ([mockup 02](02-health-needs-you.svg)).
- **B.** A new "Operations" menu item beside Health.
- **Recommendation: A.** The menu's "Health 1 down" note is built and known.

### L2. An incident in words
- **A.** Each alert kind has a written title, a "what still works" line and a "what to check" list, with the facts filled in.
- **B.** The raw check name and message (legacy `<check>: <message>`).
- **Recommendation: A,** with the raw text one click away for the superadmin.

### L3. The incident page
- **A.** A timeline (opened, told, reminded, acked, fixes tried, recovered), the actions and "what to check" ([mockup 03](03-incident.svg)).
- **B.** Only the card.
- **Recommendation: A.**

### L4. The Discord message
- **A.** One message per incident, edited in place as it changes (open, acked by whom, recovered after how long); reminders as replies under it.
- **B.** A new message for every change (legacy).
- **Recommendation: A** ([mockup 04](04-discord.svg)): the channel reads as a list of incidents, not a log.

### L5. Buttons on the message
- **A.** Acknowledge, Mute 1 h, Open in admin.
- **B.** Acknowledge only.
- **Recommendation: A.**

### L6. A new incident while Health is open
- **A.** The card appears, the tab title shows "(1)", no sound.
- **B.** A chime.
- **Recommendation: A.** The venue is loud; Discord pings phones already.

### L7. The copy flow
- **A.** One page with four steps: from, dates, parts, run; then a result per part ([mockup 10](10-copy-from-last.svg)).
- **B.** A wizard of separate pages.
- **Recommendation: A.**

### L8. The superadmin console
- **A.** The same shell with a purple "Platform" mark and its own menu, so nobody mistakes it for an event ([mockup 06](06-stack-health.svg)).
- **B.** A plain page.
- **Recommendation: A.**

### L9. On a phone
- **A.** Health is in the organiser phone bar for anyone with `admin.health.read`; every page in this step is drawn at 390 px.
- **B.** Desk only.
- **Recommendation: A.** The crew walks the hall with a phone.

### L10. Language
- **A.** Plain English first; Finnish with step 10's language pack.
- **Recommendation: A** (admin's `language` setting).

## Data and integrations (D)

### D1. The alert kinds
- **A.** A fixed catalog for step 8: `part_down` and `part_slow` (platform); `screen_dark`, `screen_stuck`, `bot_offline`, `storage_nearly_full` (event); `fix_gave_up` and `fix_blocked` (the subject's audience).
- **B.** Only `part_down`, as the legacy.
- **C.** A rule builder for any check.
- **Recommendation: A** ([mockup 12](12-lifecycle.svg)). A kind is code with tests; more kinds come by issue.

### D2. Timings
- **A.** A part is confirmed after 3 checks in a row (30 s); `part_slow` alerts only after 5 min slow; a screen is dark after 2 min without word; reminders every 30 min; recovery confirmed after 3 checks.
- **B.** The legacy's 2 polls of 30 s for everything.
- **Recommendation: A,** each an event setting where it concerns the event (O7).

### D3. Events
- **A.** `admin.alert.opened`, `.changed`, `.reminded`, `.acked`, `.muted`, `.recovered`, on the tenant's stream for event alerts and the platform stream for platform ones; ids and words only, never secrets or log lines.
- **B.** One `admin.alert.changed` with a `state`.
- **Recommendation: A.** Additive in `contracts/admin.md`, shipped with the code (0029).

### D4. Where the alert channel lives
- **A.** On the bot's guild binding: `alert_channel_id` and `alert_role_id` (bot contract, additive); the platform binding for platform alerts.
- **B.** An admin setting holding a channel id.
- **Recommendation: A.** The bot owns Discord ids and checks the channel exists.

### D5. Ack from Discord
- **A.** The bot calls `POST /internal/admin/alerts/{id}/ack` with the platform user its Discord user maps to; admin checks `admin.alerts.ack`.
- **B.** The button is a link to admin.
- **Recommendation: A,** with B as the fallback message's button (E1).

### D6. The webhook fallback
- **A.** One Discord webhook URL per audience, a secret set in Admin → Integrations like step 5's AI key: write-only, encrypted at rest, last four characters shown, replace and revoke audited.
- **B.** An environment variable (legacy).
- **Recommendation: A** for events; the platform's webhook is the environment variable `CANCCU_PLATFORM_ALERT_WEBHOOK` (setup holds it).

### D7. Where incidents live
- **A.** Event incidents in admin's tenant tables under RLS; platform incidents in one global table on the kit's allow-list.
- **B.** All global.
- **Recommendation: A** (0013).

### D8. Retention
- **A.** Platform health history 90 days (TH6); event incidents for the event's life, with actors as audit references, deleted with the tenant; `personal` data class for the actor ids.
- **B.** Forever (legacy).
- **Recommendation: A.**

### D9. How admin learns the event's facts
- **A.** From events (`screen.device.offline`/`online`, the bot's client events, the storage count) and a reconcile read every 5 min.
- **B.** By polling each module's API for every event.
- **Recommendation: A.** Cost does not grow with the number of events.

### D10. The executor
The roadmap: "the executor is designed new".
- **A.** No container executor: Docker restarts crashed containers; admin only reports and sends typed commands to modules (reload a screen, reconnect the bot).
- **B.** A: plus a small `ops` sidecar that alone talks to Docker, through a socket proxy that allows only `restart`, `inspect` and `logs` of containers labelled `canccu.part`; admin calls it on the internal network with its service identity; superadmin only.
- **C.** A host agent installed by `setup/` (systemd).
- **Recommendation: B** ([mockup 07](07-fixes.svg)). It is the only way to restart a part that is up but wrong, with the Docker socket fenced to three verbs; no free-text command exists anywhere (legacy P13).

### D11. The action catalog
- **A.** Typed actions only: screen Identify and Reload (built), bot Reconnect (bot, additive), part Restart and part Logs (the sidecar), and Retry for a failed clone part. Each names its right, its guard and its audit entry.
- **B.** Config-defined commands (legacy).
- **Recommendation: A.**

### D12. Logs
- **A.** The superadmin reads a part's last 200 lines through the sidecar, redacted; event crew read none in step 8.
- **B.** Lines tagged with the tenant for event admins (TH5).
- **Recommendation: A;** B is a `Roadmap note:` for step 10's observability.

### D13. Redaction
- **A.** Port the legacy patterns (bearer tokens, `key=value` secrets, webhook URLs, three-part tokens) into both kits, with their tests; applied to log lines and action output.
- **Recommendation: A** (the inventory's "port as is").

### D14. Clone parts
- **A.** Each module that copies something declares a clone part in admin (name, what it copies, its endpoint), like settings declarations; admin's job calls them in order.
- **B.** A fixed list in admin's code.
- **Recommendation: A:** agenda, screen, theming, moments, notify, pizza copy; the bot moves its binding.

### D15. New venue profile fields
- **A.** `crew_notes`: crew-only text (where the fuse box is, who opens the doors), copied in like the rest.
- **B.** Structured contacts with names and phone numbers.
- **C.** Nothing new.
- **Recommendation: A.** B is personal data with no retention story; a name in a note is the venue's to keep short.

### D16. The venue's screens on the venue page
- **A.** Read from Screen's superadmin device registry: name, current event, online.
- **B.** Not shown.
- **Recommendation: A** ([mockup 11](11-venues.svg)).

### D17. The next event's dates
- **A.** The superadmin types them; the form offers the same weekday at the series' usual gap.
- **B.** A cadence on the series.
- **Recommendation: A.**

### D18. The coarse platform word
- **A.** The worst state of the parts this event uses (by its feature flags), shown as ok, slow or down.
- **B.** The worst of all parts.
- **Recommendation: A.**

## Edge cases and failure (E)

### E1. The bot is down, or is the subject
- **A.** The webhook posts the same words with a link button "Open in admin" (webhooks cannot take button clicks); ack happens in admin ([mockup 13](13-edge-states.svg)).
- **B.** Nothing reaches Discord.
- **Recommendation: A** (legacy F8).

### E2. No route takes the message
- **A.** The incident shows "not delivered"; admin retries every 5 min, the recovery too (fixes legacy P7).
- **B.** Give up.
- **Recommendation: A.**

### E3. Admin itself is down
- **A.** Docker restarts it; nobody is alerted until step 10's outside watchdog.
- **B.** A second watcher in another module.
- **Recommendation: A,** and the brief says so plainly.

### E4. Flapping
- **A.** Debounce, and an incident that changed state 4 times in 10 min becomes "keeps changing": one message, no more until it holds 5 min.
- **B.** Debounce only.
- **Recommendation: A.**

### E5. Deploys
- **A.** Deploy grace: when a part answers with a new version, its incidents wait 3 min before alerting.
- **B.** A manual maintenance switch.
- **Recommendation: A;** the deploy hold already keeps deploys away from live events (0013 item 22).

### E6. One cause, many parts down
- **A.** When parts fail on the same check (`postgres`, `valkey`), one incident names the cause and the parts it takes.
- **B.** One incident per part.
- **Recommendation: A.**

### E7. Auto-fix loops
- **A.** The legacy engine: a cooldown, at most 3 tries in 30 min, then one "gave up" alert until the subject recovers; never for a muted subject.
- **Recommendation: A** (its tests are the spec).

### E8. A restart while an event is live
- **A.** A manual restart warns with each live event's name and what runs there (a takeover, an emergency, a cast) and needs the part's name typed; an automatic one is blocked and says so once (fixes legacy P2, P3 and P4: "blocked" is a timeline entry, not a fake state change).
- **B.** Never while any event is live.
- **Recommendation: A.**

### E9. A dark screen at night
- **A.** `screen_dark` only while the event is `live` and outside the agenda's quiet hours.
- **B.** Always.
- **Recommendation: A.**

### E10. Draft and archived events
- **A.** No event alerts while `draft` or `archived`; their Health still shows the state.
- **Recommendation: A.**

### E11. A clone part fails
- **A.** Each part is all or nothing; the others stand; Retry runs that part again; a part that answers "already cloned" counts as done.
- **Recommendation: A** ([mockup 10](10-copy-from-last.svg)).

### E12. Ack after recovery, or twice
- **A.** The first ack stands; acking a recovered incident changes nothing (legacy).
- **Recommendation: A.**

### E13. A Discord user who is no platform user
- **A.** The bot answers only them: "Sign in once at the event's admin to act from Discord."
- **Recommendation: A.**

### E14. A mute ends while the subject is still not ok
- **A.** A reminder at once, saying it was muted until now.
- **Recommendation: A.**

### E15. Restarts of admin and several admin containers
- **A.** Incidents, timers and fix counters in Postgres; one alert engine at a time through a Valkey lease (like the bot's clients).
- **Recommendation: A** (0007).

### E16. The venue's address changes
- **A.** A `screens_refused` kind when screens of the event are refused by the venue IP check for 2 min, pointing to the emergency switch; Screen emits the fact (additive).
- **B.** Leave it to the crew.
- **Recommendation: A,** if the session keeps it in step 8; otherwise a `Follow-up:`.

## Operations and scale (O)

### O1. Check interval
- **A.** Parts every 10 s (built); event facts from events.
- **Recommendation: A.**

### O2. Where the engine runs
- **A.** In admin, beside the Health checks; only Docker access is apart (D10).
- **B.** A new `ops` module.
- **Recommendation: A.**

### O3. Message caps
- **A.** At most 10 messages per audience per 10 min; past it, one digest message with a count.
- **Recommendation: A.**

### O4. Audit
- **A.** Ack, mute, unmute, every fix (manual or automatic), alert settings and webhook changes are audited; the action log is the audit log (legacy F13).
- **Recommendation: A.**

### O5. The CI check
- **A.** The stack smoke stops one part, waits for the incident, checks the fake Discord's message, acks through the bot's endpoint and checks the recovery.
- **Recommendation: A** (P3).

### O6. The platform guild
- **A.** The superadmin binds the shared bot to a platform guild once; platform alerts and `/platform status` live there (bot contract, additive).
- **B.** Only the webhook.
- **Recommendation: A.**

### O7. Settings per event
- **A.** Each event kind on or off, its delay, the reminder interval and deploy grace as admin settings with defaults ([mockup 05](05-alert-settings.svg)).
- **Recommendation: A.**

### O8. A large event
- **A.** Three or more screens of one zone dark at once become one incident ("3 screens in Main hall dark"); one message.
- **Recommendation: A.**
