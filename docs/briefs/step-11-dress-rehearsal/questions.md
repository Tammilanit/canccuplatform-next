# Step 11 question bank

Every open question the research for [the step 11 brief](../step-11-dress-rehearsal.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#170). IDs are stable, so the session can answer "D1: A" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), D1 (what "pinned" means on a shared stack), D5 (deploys while an event is live), D4 (hotfixes), O3 (when the legacy is retired), P3 (the exit criterion), U2 (the rehearsal copy), P2 (the issue set).

**Already decided, so not asked again:** no freeze date and no target date ([0021](../../decisions/0021-no-fixed-dates.md)); the dress rehearsal is mainly the product owner testing the whole system at home, including a restore onto the fallback laptop, with the App track's privacy center in place before it (the [roadmap](../../roadmap.md#11-dress-rehearsal-and-switch), 2026-11-08); nothing is migrated except the legacy bot's data, which step 6 builds and tests and step 11 only runs ([0004](../../decisions/0004-nothing-migrated.md), #125); the legacy bot is stopped before its token moves into the tenant, never two processes on one token, and its container is kept stopped as rollback ([0013](../../decisions/0013-multi-tenant-core.md), Consequences; TE7 in the [legacy summary](../../legacy-inventory/README.md)); one stack runs one version and one migration, deploys are held while a tenant is live except hotfixes, a demo tenant gets every change first, and screens can pin a bundle (0013 items 22–24); the signup site stays outside ([0005](../../decisions/0005-signup-site-stays-outside.md)); the fallback laptop is the only on-site copy ([0011](../../decisions/0011-hosting-on-remote-vm.md)); legacy repos are renamed `-legacy` and archived, and this repo takes the name `canccuplatform` ([0002](../../decisions/0002-no-legacy-history-or-docs.md), [0017](../../decisions/0017-naming.md)).

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive, so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)). A question marked **record** needs a decision record.

## U · Who uses it and how

### U1. Who takes part in the dress rehearsal?
- **A.** The product owner alone, at home.
- **B.** The product owner at home, the lead on call remotely (watching Health and the logs, filing issues), and one crew member who joins from their own phone for the crew parts.
- **C.** The whole crew, at the venue.
- **Recommendation: B.** The roadmap says "mainly the product owner at home"; a second pair of eyes on Health turns a symptom into an issue on the spot, and one crew phone tests the rights of a crew member, which the product owner's own account (an event admin) cannot ([mockup 05](05-rehearsal-at-home.svg)).

### U2. What does the rehearsal run on?
- **A.** A rehearsal copy: a new tenant cloned from the real event (step 8's clone), with the event's days moved to the rehearsal evening, deleted after the report.
- **B.** The demo event.
- **C.** The real event itself, still in draft, put live early and then back.
- **Recommendation: A.** It tests the real event's profile, theme, run of show and settings without touching the event; the demo event does not have them, and C is impossible (nothing goes back from `live`, [tenants.md](../../../contracts/tenants.md#lifecycle)). Going live with the copy also exercises the deploy hold (D5). See E13 for the dates.

### U3. What stands in for the venue at home?
- **A.** The copy gets a "Home" venue with the home's public address, so joining at the venue and the venue IP check behave as at the event.
- **B.** The venue IP check switched off for the evening (the tenants module's audited emergency switch, at most 48 hours).
- **C.** No venue: everyone joins with the event's link.
- **Recommendation: A,** plus one scenario that joins from mobile data with the link (S2). B is drilled once as a failure scenario, not relied on; C skips the path most attendees take at the venue.

### U4. Which Discord server does the rehearsal use?
- **A.** The test server (#44) with the dev bot, bound to the copy.
- **B.** The real server, in a hidden channel.
- **C.** Both: the test server for the evening, then the real server at the bot cutover.
- **Recommendation: C.** The rehearsal never posts to the real community; the cutover (mockup 09) is the real server's own test, on a quiet day before the event.

### U5. Who decides go or no-go, and how is it recorded?
- **A.** The product owner, on the go-live board: every gate is green, or accepted in writing with a name and a reason; going live is one deliberate step ([mockups 02](02-go-live-board.svg), [04](04-go-live.svg)).
- **B.** The maintainer, by labelling a PR or an issue.
- **C.** Nobody formally: the team agrees in chat.
- **Recommendation: A.** The legacy plans' rule "no silent success: a failure is fixed or accepted in writing before the event" (canccudocs, SUBPLAN 06) is the right one, and the board keeps it with the event for the next time. An acceptance belongs to one event and is never carried to the next ([mockup 12](12-after-the-event.svg)).

### U6. What do venue staff do before doors?
- **A.** A venue-day check on a crew phone, the day before doors: screens paired and drawing, a sound check per zone, the uplink, the venue's address seen, the fallback laptop on the crew desk, the superadmin on Tailscale ([mockup 13](13-venue-day.svg)).
- **B.** A printed checklist.
- **C.** Nothing new: the crew already knows the venue.
- **Recommendation: A.** Home cannot test the venue's network, projector PCs and sound; this check does, and it closes the board's last automatic gate (the venue's address seen). A printout of the rollback plan still goes on the crew desk.

### U7. What do attendees notice at the switch?
- **A.** One announcement on Discord when the bot cuts over, and old pizza and tournament links that land on a "this moved" page with a button to the hub.
- **B.** A guided tour of the new hub on first open.
- **C.** Nothing at all.
- **Recommendation: A.** Attendees have nothing to migrate (every account is a Discord account, [0027](../../decisions/0027-product-decisions-2026-11-07-08.md)); they need to know where things went, once. The hub's own first-run experience is the App track's.

### U8. Who is on call during the live window?
- **A.** The superadmin, on Tailscale at the venue or remote, with the lead as the second; both named on the go-live board's Contacts tab.
- **B.** The lead alone.
- **C.** Whoever is around.
- **Recommendation: A.** Only the superadmin may apply a hotfix (D4) or move the stack; the lead diagnoses. The Contacts tab is where the crew looks when a trigger fires.

### U9. How long is the rehearsal?
- **A.** One evening of scripted scenarios (about four hours) and an unattended overnight soak of at least 12 hours.
- **B.** One evening only.
- **C.** A whole weekend, replaying the event's days.
- **Recommendation: A.** The legacy plans asked for "at least one 8-hour supervised run on the final stack" (gap 14); the soak covers the hours, the evening covers the scenarios, and `scripts/screen-soak` already exists for the screens. C is direction B's simulator in disguise.

### U10. Is there a second rehearsal at the venue?
- **A.** No: the venue-day check (U6) covers what home cannot.
- **B.** A short venue session (1–2 hours) a week before, with the crew.
- **C.** A full second rehearsal at the venue.
- **Recommendation: A,** with B for the first event only if the venue's projector PCs or sound changed since the legacy ran there.

### U11. Who may tick the hand-ticked gates?
- **A.** Event admins only (the same right as going live).
- **B.** Anyone with a crew role.
- **Recommendation: A** for "dress rehearsal passed" and for accepting a gate; B for "crew briefed" and the venue-day items, which the crew does.

## L · Look and feel

### L1. Where does readiness live?
- **A.** A Go live page in the Admin group of the Event menu: readiness gates, the rollback plan, contacts ([mockup 02](02-go-live-board.svg)).
- **B.** A section of the Health page.
- **C.** A checklist document only.
- **Recommendation: A.** Health answers "is it working now"; Go live answers "may we start", with people's ticks and acceptances that Health has no place for. The page follows sheet 2 of the [design guideline](../../design/README.md) and the grid rules (amendment 3).

### L2. How do organisers see the platform version?
- **A.** A Platform card in the Event profile: the version, "tested", what changed since the last event ([mockup 03](03-releases-and-pins.svg)).
- **B.** Only on Health.
- **C.** Nowhere: it is the superadmin's business.
- **Recommendation: A.** The organiser's question is "will anything change during my event?", and the card answers it in one sentence.

### L3. How deliberate is going live?
- **A.** A dialog that lists what changes, shows any accepted gates, and asks for the event's name typed in ([mockup 04](04-go-live.svg)).
- **B.** A plain confirm.
- **C.** Automatic at the first item of the run of show.
- **Recommendation: A.** It is the one step in the kit that cannot be undone and that changes the whole stack (the hold). C would go live by accident on a wrong date.

### L4. Does the shell show that an event is live?
- **A.** A small "Live" pill next to the event's name in the header, and a "Deploys held" row on Health.
- **B.** Nothing.
- **Recommendation: A.** Crew members switch between the rehearsal copy and the event; the pill says which one they are in. It needs a shell change in `packages/ui` (one pill).

### L5. What does an old link show?
- **A.** A "this page has moved" card in the hub's look with one button to the hub ([mockup 13](13-venue-day.svg)).
- **B.** A plain redirect to the hub.
- **C.** The signup site's own 404.
- **Recommendation: A** for the signup site's pizza and tournament pages (one sentence says why things moved), B for old screen URLs on projector PCs, which nobody reads.

### L6. What do screens show during a failover?
- **A.** The last state with a crew-only offline dot, as the screen contract already says ([mockup 07](07-failure-drills.svg)); after a restore on the laptop, a reload.
- **B.** A "back soon" slide.
- **Recommendation: A.** It is built; the drill proves it. B would turn a short outage into something the hall notices.

### L7. What does the rehearsal report look like?
- **A.** A markdown run sheet (one row per scenario: steps, should, result, evidence), generic in this repo, filled in the private event repo ([mockup 06](06-rehearsal-run-sheet.svg)).
- **B.** A page in admin that runs the scenarios and stores the results.
- **Recommendation: A.** The scenarios are for people, not machines; B is a feature for one evening per event. The board's "Dress rehearsal passed" gate links the filled sheet.

## D · Data and integrations

### D1. What does "the event pins a tested release" mean on a shared stack?
One stack runs one version for every event (0013). The roadmap's "pins" was written with one event in mind.
- **A.** The stack runs a release the superadmin sets (a tag, never `dev`); each event records the release it tested (the event repo's `platform.version`, imported into the tenant); going live is held while the two differ, and screens pin the same bundle ([mockup 03](03-releases-and-pins.svg)).
- **B.** Only screens pin (0013 item 23); the stack follows its channel.
- **C.** A stack per live event.
- **Recommendation: A.** It makes "pinned" true for the whole event at no extra cost, and keeps one stack. C doubles the VM and is the hot standby 0022 rules out. **Contract:** `platform_version` on the tenant, read from the profile (additive, [tenants.md](../../../contracts/tenants.md), [profile.md](../../../contracts/profile.md)).

### D2. What makes a release "tested"?
- **A.** It is on the `stable` channel: CI and the demo stack green, the upgrade test from the last stable passed, a weekly regression run on it is clean, and a dress rehearsal passed on it or on the release it patches (with the failed scenarios re-run).
- **B.** CI green.
- **C.** The rehearsal alone.
- **Recommendation: A.** Each part exists or comes from step 10's channels; the rehearsal is what CI cannot do, and CI is what one evening cannot cover.

### D3. How are releases numbered at the switch and after?
Today `release-tag` gives every green main `v0.<step>.<n>`, with `<step>` from the lowest open step milestone; after step 11 there is none, and the job fails by design ([docs/ci.md](../../ci.md#releases)).
- **A.** The release that passes the rehearsal is also tagged `v1.0.0`; from then on main's green commits are `v1.<minor>.<n>`, the minor rising at each checkpoint, and hotfixes are patches of the pinned release (`v1.0.1`).
- **B.** Keep `v0.<step>.<n>` and keep adding step milestones.
- **C.** Calendar versions (`2027.4.1`).
- **Recommendation: A.** `v1.0.0` marks the switch for everyone; the tagger changes once (`.github/`, high risk).

### D4. How does a fix reach a live event?
- **A.** A release branch from the pinned tag (`release/v1.0`); the fix is reviewed as usual, tagged as a patch (`v1.0.1`), staged on the staging stack with a copy of the demo tenant, applied by the superadmin with a reason (audited), and merged to main too ([mockup 11](11-live-window.svg)).
- **B.** Roll forward: the stack takes the newest green main.
- **C.** Freeze main during the live window, so main is the fix branch.
- **Recommendation: A.** B brings untested features into the event; C stops everyone else's work for every event (and 0021 says no freeze by default). A needs `release-tag` and `setup/deploy` to know release branches (high risk).

### D5. Deploys while an event is live
The roadmap lists this as open: "no deploys while any tenant is live" can block every deploy once live periods overlap (0013 item 22).
- **A.** A hard hold while any tenant is live; only a hotfix (D4) passes; the hold lifts when the last live event is archived.
- **B.** Deploy windows: deploys run in each live event's quiet hours.
- **C.** Per-tenant stacks (see D1 C).
- **Recommendation: A,** recorded in a decision with D1, D3, D4 and O1. Events at one venue rarely overlap; B deploys untested code into a running event at night. Revisit when two events overlap often. **Record.**

### D6. What does the bot migration take?
The legacy bot holds almost nothing: its settings and two small state files; everything else lives in the signup site's database (DR4, TE6 and OC6 in the [legacy summary](../../legacy-inventory/README.md)).
- **A.** Only what the legacy bot held: its settings and two state files (the token is entered, not migrated: D7).
- **B.** Also the signup site's bot-side data (snapshots, tournament rows).
- **Recommendation: A.** B is a new decision against 0004 and 0005 and needs a copy of the signup site's database; nobody needs that history at the next event. #125's scope follows the answer ([mockup 09](09-bot-cutover.svg)).

### D7. Where does the bot's token go, and how?
- **A.** An event admin enters it once on the event's Discord settings page; it is stored as the event's secret, audited, never shown again, never in the event repo.
- **B.** The superadmin puts it in `deploy/.env`.
- **Recommendation: A.** Tokens per tenant are rows, not environment ([0013](../../decisions/0013-multi-tenant-core.md)); the step 6 bot module defines the binding. See E7 for resetting it.

### D8. What happens to the signup site's pizza, tournament and display parts?
- **A.** Their links point to the event hub (the "moved" card, L5), and its owner turns those parts off after the switch; registration stays untouched.
- **B.** They stay as they are.
- **C.** Only the links change.
- **Recommendation: A.** Two pizza systems at one event split the orders. 0005 keeps registration outside and moves the other parts into modules; this finishes that move. It is a change in another repo, so the maintainer accepts it there.

### D9. What does the event repo gain?
- **A.** `platform.version` (the release the event tested), the filled run sheet and the rehearsal report, and the venue-day notes; never secrets.
- **B.** Only `platform.version`.
- **Recommendation: A.** The event repo is where real names may live; this repo keeps the generic run sheet only.

### D10. What happens to the rehearsal copy afterwards?
- **A.** Archived and deleted once the report is written (a tenant can be deleted only as `draft` or `archived`).
- **B.** Archived and left to retention (presence after 30 days, personal data after 12 months).
- **Recommendation: A.** It holds the product owner's and testers' data for no use; deleting it also tests the tenant delete.

### D11. Where does the evidence live?
- **A.** Screenshots, logs and the filled run sheet in the private event repo; a scrubbed summary (counts, timings, issues) in `docs/reports/` here for the checkpoint; failures as issues here, labelled `rehearsal`, with demo names only.
- **B.** Everything here, scrubbed.
- **C.** Everything in the event repo.
- **Recommendation: A.** This repo is public and names no event; the checkpoint still needs the summary.

### D12. How is the repo rename done?
- **A.** Rename the legacy `canccuplatform` to `canccuplatform-legacy` first (it frees the name), then this repo to `canccuplatform`; push the pinned release's images under the new path; re-point the VM's and the fallback laptop's remotes; sweep the name in docs and checks in one PR ([mockup 10](10-the-switch.svg)).
- **B.** Keep the name `canccuplatform-next`.
- **Recommendation: A.** GitHub redirects the old URL of this repo; the images and the deploy's registry path do not follow by themselves (`ghcr.io/<owner>/<repo>` comes from the `origin` remote, [setup/README.md](../../../setup/README.md#auto-deploy)).

### D13. Which repos are renamed and archived?
- **A.** The legacy system repo, the bot, the screens, the manager, the plans and the streaming repo. Not the signup site (0005), not the mini tourney (an independent app, [0025](../../decisions/0025-finals-and-games-modules.md)), not the event repo.
- **B.** Also the signup site.
- **Recommendation: A.** Their open issues are closed with a pointer to this repo before archiving.

### D14. Where does development run after the switch?
0012 says to revisit development on the VM "before real event data comes to the VM", which is this step.
- **A.** Ask the hoster for a separate dev VM; the production VM runs only the pinned stack and the staging stack (0013 item 24).
- **B.** Keep developing on the production VM, with the stack pinned and the staging stack for tests.
- **C.** Move development to the maintainer's own machine.
- **Recommendation: A,** with B as the fallback until the dev VM exists. Development sessions and real attendee data should not share a machine; the reviewer's own OS user (step 10) narrows the risk but does not remove it. **Record:** a follow-up to 0012.

### D15. Does the auto-deploy go away?
`setup/deploy` acts only while `CANCCU_VERSION` is `dev`.
- **A.** On the production VM, `CANCCU_VERSION` becomes the pinned release; a new `setup/deploy --release <tag>` moves it (with the hold, D5); the dev VM (D14) keeps following main.
- **B.** Production keeps following main between events.
- **Recommendation: A.** Between events the stack may still move freely, but always to a release on a channel, so the demo tenant and the staging stack saw it first. This touches the step 9 "deploy word" and step 10's channels; step 11 only needs the release-tag path.

## E · Edge cases and failure

### E1. Which failure drills run in the rehearsal?
- **A.** Eight: uplink out, a module killed, a VM reboot, the database restored to a point in time, the whole VM lost (fallback laptop), the bot's token reset, Discord sign-in blocked, a deploy during live ([mockup 07](07-failure-drills.svg)).
- **B.** Only the restore onto the fallback laptop (the roadmap's minimum).
- **Recommendation: A.** Each drill proves one line of the rollback plan, and most take minutes. Valkey loss and a full disk are good candidates if time allows.

### E2. What are the recovery-time targets?
The legacy plan aimed at 30 minutes to a working display path (gap 13).
- **A.** Screens never go blank (cached); a module back within 2 minutes; the VM back within 10 minutes after a reboot; the whole platform on the fallback laptop within 30 minutes; the bot within 15 minutes after a failed cutover.
- **B.** One target: 30 minutes for anything.
- **Recommendation: A.** Different failures have different costs; a crashed module should not borrow the laptop's 30 minutes.

### E3. What are the rollback triggers?
- **A.** Written per event on the board's Rollback plan tab, with defaults: the stack not healthy 30 minutes after a restart → the fallback laptop; a screen blank 5 minutes after the crew acted → its fallback image; the bot offline 15 minutes after the cutover → the legacy bot; data lost → restore the last backup.
- **B.** Decided on the spot.
- **Recommendation: A.** The legacy wrote triggers per event and never used them; writing them in the board makes them part of the readiness, and the crew briefing (a hand-ticked gate) reads them.

### E4. A gate fails the day before
- **A.** Fix it on a patch release (D4, before going live there is no hold) or accept it in writing; no going live with a silent red.
- **B.** Postpone going live and run the first evening on the legacy.
- **Recommendation: A.** After the bot cutover there is no complete legacy to fall back to; the plan's fallbacks are the laptop and the triggers.

### E5. Is the legacy a rollback for the first event?
- **A.** Only the bot's stopped container (0013); for everything else the fallback laptop with the platform.
- **B.** Keep the legacy screens and site installable for the first event.
- **Recommendation: A.** B needs the crew to practise two systems and keeps the legacy signup site's parts alive (D8). The legacy stays readable in its repos.

### E6. The bot cutover fails
Token rejected, intents missing, the bot lacks permissions in the server.
- **A.** Roll back with one button: the event's bot disconnects, the legacy bot is started again; the import is idempotent, so the next try starts over safely.
- **B.** Fix forward only.
- **Recommendation: A,** with the trigger at 15 minutes (E3). The cutover runs on a quiet day (O2), so a rollback costs nothing.

### E7. Two bots on one token
- **A.** Reset the token in the Discord developer portal at the cutover and enter the new one, so the legacy process can never connect with the old token again.
- **B.** Trust the checklist: the legacy is stopped first.
- **Recommendation: A.** The rule "never two processes on one token" becomes a fact instead of a promise. The rollback then needs the legacy bot's environment updated with the new token (written into the rollback runbook).

### E8. Renaming while work is open
- **A.** One quiet window: no package run open, the dispatcher paused, open worktrees re-pointed afterwards.
- **B.** Rename any time; GitHub redirects.
- **Recommendation: A.** Redirects cover clones, not the deploy's registry path, the review gate's settings or the dispatcher's state.

### E9. The pinned images after the rename
- **A.** Push the pinned release's images again under the new path, and install from the new path on the fallback laptop before the window closes.
- **B.** Point `CANCCU_DEPLOY_IMAGES` at the old path until the next release.
- **Recommendation: A.** The laptop must restore from cold with the new name; B leaves a trap for the next restore.

### E10. The venue's uplink fails during the event
- **A.** Nothing to do for screens (they keep the last state); attendees on mobile data keep using the hub; the crew watches the offline dots and Health from a phone on mobile data.
- **B.** Move to the fallback laptop on the venue LAN.
- **Recommendation: A** for an outage under 30 minutes; B only if the trigger fires. The rehearsal's uplink drill (S24) measures the recovery.

### E11. The rehearsal finds a blocker late
- **A.** Fix on a patch release; re-run the failed scenarios and the smoke set (join, screens, one announcement) on the patch, not the whole evening.
- **B.** Re-run the whole rehearsal.
- **Recommendation: A.** The run sheet marks which scenarios a fix touches; the same rule lets the next event re-run only what changed ([mockup 12](12-after-the-event.svg)).

### E12. Two events live at once
- **A.** Both must pin the release the stack runs; the second event's go-live is held otherwise ([mockup 03](03-releases-and-pins.svg)); one hotfix applies to both.
- **B.** The second event takes whatever the stack runs.
- **Recommendation: A.** It is D1 applied twice; the board says why it is held and what to do.

### E13. The copy's dates
The run of show, check-in windows and Moments' schedules are dated to the event's days. The tenants module's clone already takes `shift_seconds` and moves the event's start and end by it ([tenants.md](../../../contracts/tenants.md#series-and-clone)).
- **A.** Clone with the offset from the event's first day to the rehearsal evening; every module's clone applies the same shift to its own dated rows.
- **B.** Keep the dates; rehearse with "simulate at a time" where it exists.
- **Recommendation: A.** The run sheet's first scenario checks that the run of show, Moments' schedules and the tournament's sessions all moved; any module whose clone ignores the shift is a finding for its own step, not for step 11.

### E14. The privacy center is not ready
- **A.** The rehearsal waits: the roadmap puts the privacy center before it.
- **B.** Rehearse without it and test privacy later.
- **Recommendation: A.** Real people's data comes onto the stack at the rehearsal; export and delete must work then.

### E16. Cloning moves the bot
The bot moves its Discord connection and binding to a cloned event instead of copying them ([tenants.md](../../../contracts/tenants.md#series-and-clone), bot.md).
- **A.** Make the rehearsal copy before the event's bot is cut over (O2 puts the cutover after the rehearsal), then bind the copy to the test server (U4); the event's own binding is never touched.
- **B.** A clone option that leaves the bot behind.
- **Recommendation: A** for the first event, because the order already gives it. From the second event on the event has a binding when it is copied for a rehearsal, so B is a small additive option for the bot's clone (**contract**), proposed for step 8 or 6, not step 11.

### E15. A deploy arrives during live anyway
- **A.** `setup/deploy` refuses, says why, exits 0 and tries again later ([mockup 04](04-go-live.svg)).
- **B.** It refuses and opens an issue each time.
- **Recommendation: A,** with one issue opened on the first hold only (O6).

## O · Operations and scale

### O1. Is there a release freeze?
0021 leaves "a release freeze, if wanted" to its own record.
- **A.** No freeze: pinning is the freeze for the event; main keeps merging.
- **B.** Freeze main during each live window.
- **C.** Freeze main for a week before each event.
- **Recommendation: A,** recorded with D5. The pin protects the event; a freeze would protect nothing more.

### O2. When does the bot cut over?
- **A.** A quiet day three to seven days before the event, once the board's other gates are green.
- **B.** At go-live.
- **C.** Right after the rehearsal.
- **Recommendation: A.** A failure then has days to be fixed; at go-live it competes with everything else, and right after the rehearsal the release may still change.

### O3. When is the legacy retired?
- **A.** Two moves: the bot cuts over before the event (O2); the repos are renamed and archived after the first event has run on the platform ([mockup 10](10-the-switch.svg)).
- **B.** Everything at once, before the first event.
- **C.** Everything after the first event, including the bot.
- **Recommendation: A.** The bot must move before the event (two bots cannot share the server's token); the rename has no value before the platform has carried an event and costs a quiet window.

### O4. How long is the legacy bot's container kept stopped?
- **A.** Until 30 days after the first event is archived, then removed; the archived repo stays readable.
- **B.** For good.
- **Recommendation: A** ([mockup 12](12-after-the-event.svg)). After a month the rollback is no longer realistic, and the container holds the old token's environment.

### O5. Is there a load test before the first event?
0022 keeps "a load harness for the large event" in the backlog.
- **A.** A light load check sized to the first event's expected attendance (phones joined, live pages open, a burst of orders), from a script beside `scripts/screen-soak`.
- **B.** None: the first event is small.
- **C.** Pull the full harness from the backlog.
- **Recommendation: A** if the first event expects more than about 150 attendees, else B. C needs the product owner's yes (P7).

### O6. What happens to a held deploy?
- **A.** It waits quietly and tries again; one issue labelled `module:deploy` is opened on the first hold of a live window, so the lead knows main is waiting.
- **B.** An issue each time.
- **C.** Silence.
- **Recommendation: A.**

### O7. Which gates are automatic, which by hand?
- **A.** Automatic: the release matches the pin, backups fresh, a restore drill within 30 days, the watchdog and alerts, screens paired and online, the bot connected, the venue's address seen, the privacy center on, HTTPS valid. By hand: dress rehearsal passed, crew briefed, the venue-day check ([mockup 02](02-go-live-board.svg)).
- **B.** All by hand.
- **Recommendation: A.** Machines check what they can; people tick what only people know. The automatic gates read step 10's pre-flight checks and the modules' health.

### O8. How often is the restore drilled?
0013 item 26 asks for a monthly restore test.
- **A.** Monthly as 0013 says, and always within 30 days before an event (a board gate); the rehearsal's drill counts as one.
- **B.** Only at the rehearsal.
- **Recommendation: A.** The board makes the monthly test visible where it matters ([mockup 08](08-fallback-restore.svg)).

### O9. Admin access at the venue
- **A.** Check before going live that event admin works from the venue (the "venue or Tailscale only" switch) and that the superadmin reaches Stack health over Tailscale from the venue.
- **B.** Assume it works.
- **Recommendation: A,** as two items of the venue-day check.

### O10. What does the overnight soak measure?
- **A.** Restarts, memory and disk per container, screen frames drawn and reconnects (from `scripts/screen-soak`), live-page reconnects, and the deploy hold holding; a short soak report in the morning.
- **B.** Only "still up in the morning".
- **Recommendation: A.**

### O11. When does the hold lift, and what runs next?
- **A.** When the last live event is archived; the superadmin then moves the stack to the newest stable release, never straight to edge.
- **B.** At a set time after the event's last day.
- **Recommendation: A** ([mockup 11](11-live-window.svg)). Archiving is the organiser's explicit "we are done".

### O12. Reviewer identity and real data
0014's known limit (the reviewer and authors share an OS user) is planned for step 10.
- **A.** A gate: real event data reaches the VM only after the reviewer has its own OS user (step 10) and D14 is answered.
- **B.** Independent of step 11.
- **Recommendation: A.** The rehearsal is the first time real people's data is on the stack.

## P · Plan and scope

### P1. The direction
- **A.** One long evening: a runbook and a manual switch.
- **B.** Rehearsal studio: a simulator, synthetic load, replay.
- **C.** The go-live kit: releases and pins, the go-live board, scripted drills, a reversible switch.
- **Recommendation: C** ([mockup 01](01-directions.svg); the brief argues it).

### P2. The issue set
- **Recommendation:** as proposed in the brief: rewrite the epic; seven new issues; #125 kept in step 6 with its scope set by D6.

### P3. The exit criterion
The roadmap's exit is "the dress rehearsal passed; the bot data was migrated at the switch; the event repo pins a tested release", and the goal says "an event runs on a pinned, tested release, and the legacy system is retired".
- **A.** Exit when the first event has run on its pinned release and the legacy repos are renamed and archived (O3); the rehearsal, the cutover and the pin are on the way.
- **B.** Exit at go-live; the rename is a follow-up.
- **Recommendation: A.** The step's goal is an event that ran; ending earlier leaves the switch to no one.

### P4. Risk classes
- **Recommendation:** high for anything in `setup/`, `.github/`, `AGENTS.md` or the bot's token (the pin and deploy hold, the hotfix lane, the release numbering, the rename sweep, the cutover); normal for the go-live board and the version card; low for the run sheet and the rehearsal docs.

### P5. What must be closed before the rehearsal?
- **Recommendation:** the Go public epic (#166: domain, edge Caddy with TLS, central sign-in, membership, backups off the VM), step 10's restore onto the fallback laptop, pre-flight checks and release channels, the reviewer's own OS user, step 8's clone and alerts, the App track's privacy center, and #125 (the bot migration, tested). Each is a gate on the board or a blocker of the rehearsal issue.

### P6. A decision record for the switch
- **Recommendation: yes,** one record: what "pinned" means (D1), what "tested" means (D2), the numbering (D3), the hotfix lane (D4), deploys while live (D5), no freeze (O1), and development after the switch (D14). It closes the roadmap's open question on deploys while tenants are live.

### P7. Backlog items 0022 keeps for later
- **Recommendation:** "a dry run" and "a load harness for the large event" stay in the backlog; step 11 takes only O5's light check. Pulling them in is direction B.

### P8. The epic and the milestone
The epic is still titled "Freeze, dress rehearsal and switch", and the milestone's description still names a freeze date.
- **Recommendation:** rename the epic "Step 11: Dress rehearsal and switch" and drop the freeze date from the milestone's description (0021).
