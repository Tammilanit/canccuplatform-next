# App track question bank

Every open question the research for [the App track brief](../track-app.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#171). IDs are stable, so the session can answer "D4: B" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): L1 (the direction), D1 (who serves the hub), D4 (the next event), P1 (the issue set), P2 (the order), U7 (reactions: who sends), D12 (self-service account deletion), P6 (memories).

**Already decided by the product owner** (2026-11-14, on #160), so not asked again: the Wi-Fi password is shown to **members**, check-in or not; an attendee can **follow one run-of-show item** (D7 asks only how). Polls stay open for the product owner; P9 asks only whether this track builds them.

A question marked **contract** needs a contract change if the recommendation is taken. Every such change in this bank is additive, so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)); none is breaking.

## U · Who uses it and how

### U1. Who is the hub for first?
- **A.** Guests: every page that the contracts let a guest read works without signing in; signing in adds to it.
- **B.** Members: the hub starts at sign-in.
- **C.** Organisers: the hub is mainly a phone admin.
- **Recommendation: A.** 0022: "guests get event-wide notifications without signing in". Most people who scan a hall screen will never sign in, and they should still get the event in their pocket ([mockup 02](02-flow-qr-handoff.svg)).

### U2. What does a guest see?
- **A.** Now (public items, the zone's screen as text, the latest announcement), Schedule (public items), venue facts a guest may see, alerts on event-wide topics, Play as counts.
- **B.** A without Play.
- **C.** Now only.
- **Recommendation: A.** Everything here is already public on the screens; the hub repeats it in the person's hand ([mockup 03](03-now.svg)). All of it follows the info-page mode ([tenants.md](../../../contracts/tenants.md#info-page-mode)).

### U3. Which topics is a guest offered, and which are on by default?
- **A.** The event's enabled topics with an event-wide part, with the registrations' defaults (Schedule and Announcements on; Food and Tournament off).
- **B.** A new per-event setting for each topic's default.
- **C.** All off until the guest picks.
- **Recommendation: A.** No new setting: an organiser who does not want a topic disables it ([notify.md](../../../contracts/notify.md#per-event-configuration)). Personal topics wait for sign-in.

### U4. How does the hub ask for push permission?
- **A.** Our own card first ("Get alerts for this event"), then a short sheet that says what comes and how often, and only on "Turn on alerts" the browser's prompt.
- **B.** The browser's prompt on arrival.
- **C.** Only from the Alerts tab.
- **Recommendation: A.** A browser's "Block" is final for the site, and a prompt on arrival is the most refused moment there is. Our sheet costs nothing when the answer is "Not now" ([mockup 02](02-flow-qr-handoff.svg)).

### U5. When does the hub offer to be installed?
- **A.** After the first useful moment (alerts turned on, or a second visit), plus the guide under More; on an iPhone the guide comes when the person asks for alerts (E3).
- **B.** On arrival.
- **C.** Never by itself; only under More.
- **Recommendation: A** ([mockup 05](05-install-guide.svg)).

### U6. Do people see the hourly cap and quiet hours?
- **A.** One line in the alerts sheet ("at most 6 an hour, held during quiet hours"), quiet hours on Now while they run, and tags in the inbox ("Held: quiet hours", "Not pushed: limit").
- **B.** Hidden: the rules just apply.
- **C.** A page that explains them.
- **Recommendation: A.** People trust alerts they can predict, and the inbox tags explain a missing push before anyone asks ([mockup 07](07-notifications.svg)).

### U7. Reactions from the hub: who may send them?
Step 4 left reactions to this track: the hub sends them and the track builds both sides ([step 4 P4 B](../step-4-moments/questions.md#p4-reactions-step-4-or-the-app-track)). Step 4's [mockup 15](../step-4-moments/15-reactions.svg) asked whether a guest with a check-in may send.
- **A.** Members only, rate-limited per user (one every 10 s), shown on screen without a name.
- **B.** Anyone at the venue, guests included.
- **C.** Anyone, anywhere.
- **Recommendation: A.** A guest has no identity, and everyone at the venue shares its few public addresses, so a guest cannot be rate-limited fairly; a guest cannot check in either (check-in needs a member). Members are the people actually in the room. **Contract** (moments.md: the reactions API).

### U8. Is joining the event a wall?
- **A.** An offer: guest pages stay; the hub offers to join where attendee data is needed (For you, the Wi-Fi password, personal alerts, check-in).
- **B.** Signing in and joining are needed to use the hub at all.
- **Recommendation: A.** 0027: membership gates attendee data, not the hub; check-in is never a gate ([mockup 08](08-flow-sign-in-join.svg)).

### U9. How does a member start a check-in?
- **A.** By scanning the door screen's code with the phone's camera or the hub's scanner (under More and on the check-in page); the hub never nags.
- **B.** A "Check in" card on Now until the member has checked in.
- **C.** Both.
- **Recommendation: A.** Check-in is never mandatory (0027), and a card on Now would make it look required. An organiser who wants it puts the code at the door ([mockup 10](10-check-in.svg)).

### U10. Is Play for members only?
- **A.** Guests see counts per game (as the screens show) and a sign-in prompt; members see the names, voice channels and follows.
- **B.** Play is hidden for guests.
- **C.** Names for everyone.
- **Recommendation: A.** C is ruled out: [bot.md](../../../contracts/bot.md) gives a guest 401 for the names ([mockup 11](11-play.svg)).

### U11. How are destructive privacy actions confirmed?
- **A.** A hold to delete (as Moments' emergency), one tap to download, and a clear list of what goes.
- **B.** Typing the event's name.
- **C.** A confirm dialog.
- **Recommendation: A.** No native dialogs on phones (the legacy mini-tourney's lesson, P13), and a hold is hard to do by accident ([mockup 13](13-privacy-centre.svg)).

### U12. Does a guest get a privacy page?
- **A.** A short page: what a guest subscription holds (a push address, your topic switches), and "Delete this phone's subscription"; linked from Alerts and More.
- **B.** Only "Turn off all alerts on this phone" in Alerts.
- **Recommendation: A.** It costs one page, and it is the honest answer to "what do you keep about me?" for the person who never signed in ([mockup 14](14-flow-privacy-data.svg)).

### U13. One installed app for attendees and crew?
- **A.** One app per event hostname; More shows **Organiser tools** to anyone with a right at the event, and it opens the existing organiser phone pages.
- **B.** A separate organiser install (its own manifest, start URL `/admin/`).
- **C.** No door: organisers bookmark admin.
- **Recommendation: A.** Most crew are also attendees; one icon, one set of alerts. The hub builds no second admin ([mockup 15](15-organiser-access.svg)).

### U14. Does the hub carry crew actions (announce, spotlight)?
The design guideline gave the App track "the phone side of the crew spotlight" (the lead's comment on #171, [experience-map.md](../../design/experience-map.md#app-track-160--171)); step 4's plan then put the crew remote, the spotlight's four steps included, on the organiser shell's Screens tab (#112).
- **A.** No: Organiser tools (U13) leads to step 4's crew remote; the experience map's line is superseded by the step 4 plan.
- **B.** The hub repeats the crew moments in its own pages.
- **Recommendation: A.** One crew remote, built once, in the organiser shell.

### U15. Which languages does the hub speak?
- **A.** English, as the platform does today (admin's `language` setting is `en`), with every string in one place per module so a language pack can come later.
- **B.** English and Finnish from the start (#119 asks for both on the pizza pages).
- **C.** Language packs for the whole platform first.
- **Recommendation: A**, with a `Roadmap note:` that languages are one platform decision, not a per-module one: #119 and the hub should not differ.

## L · Look and feel

### L1. Which direction?
- **A.** The pocket screen: a read-only mirror of the Pulse.
- **B.** The event companion: a signed-in personal app.
- **C.** Guest first, grows with you: one hub at three depths (guest, member, crew door), module pages inside one frame.
- **Recommendation: C** ([brief, Recommended direction](../track-app.md#recommended-direction-guest-first-grows-with-you); [mockup 01](01-directions.svg)).

### L2. Which tabs?
- **A.** Now, Schedule, Play, Alerts, More. The inbox sits under Alerts, For you on top of Now, and module pages (food, matches) are reached from For you and More.
- **B.** Now, Schedule, For you, Inbox, More.
- **C.** A tab per module: Now, Schedule, Food, Play, More (#119's "Food tab").
- **Recommendation: A.** The bar must not change with the modules an event runs, and it ends in More (design decision 5). For you on Now puts your own things where you already look ([mockup 09](09-more.svg)).

### L3. How lively is the hub?
- **A.** Calm: the screen is the show. The hub uses the event's colours and fonts, moves only when something changes (a delay badge appears, a card updates), and honours reduced motion.
- **B.** It mirrors the screen's energy level (calm, lively, party).
- **C.** A plain utility look without the event's theme.
- **Recommendation: A.** People read the hub in a dark hall at arm's length, often in a hurry ([mockup 03](03-now.svg)).

### L4. The app badge?
- **A.** The unread inbox count on the icon, where the phone supports it.
- **B.** No badge.
- **Recommendation: A.** It is the cheapest way to say "something changed" without a push.

### L5. The name under the icon?
- **A.** The event's name (shortened to about 12 characters for `short_name`).
- **B.** The series' name (fits D4 B: one icon across events).
- **C.** The platform's name.
- **Recommendation: A**, or **B** if D4 is B ([mockup 05](05-install-guide.svg)).

### L6. Whose colours?
- **A.** The event's theme through `/theming/current/tokens.css`, as [theming.md](../../../contracts/theming.md#the-phone-hub) already says for the hub; the privacy pages link `admin-tokens.css`, as the contract says for privacy pages, so they stay readable in a hostile theme.
- **B.** The admin look everywhere.
- **C.** The phone's light or dark setting.
- **Recommendation: A.** No contract change; the mockups draw the demo theme's "Demo night".

### L7. Does the privacy centre show retention dates?
- **A.** Yes: for an archived event, "presence goes on <date>; the rest becomes anonymous on <date>" (`presence_delete_at`, `personal_anonymise_at`).
- **B.** One general sentence.
- **Recommendation: A** ([mockup 14](14-flow-privacy-data.svg)).

### L8. Single-task pages or tabbed pages?
- **A.** Join, check-in and sign-in keep design sheet 7's "the event up front, one task per page" (the poster, no tab bar); everything else sits in the tabbed frame.
- **B.** Every page in the tabbed frame.
- **Recommendation: A.** Sheet 7 is accepted and already built for check-in (#441).

### L9. The hub on a laptop?
- **A.** The same pages in a centred column at phone width, with a "get it on your phone" QR.
- **B.** A responsive two-column layout.
- **Recommendation: A** ([mockup 05](05-install-guide.svg)).

### L10. An empty For you?
- **A.** Hidden when there is nothing, except right after joining, when it says what will appear there.
- **B.** Always shown, with hints.
- **Recommendation: A** ([mockup 08](08-flow-sign-in-join.svg)).

### L11. What do attendees call it?
- **A.** "The Demo Event app" (the event's name), and the screen's QR label says "Get the app".
- **B.** "The hub".
- **Recommendation: A.** "Hub" is our word; attendees know the event's name. The QR label is Screen's text, an easy change.

## D · Data and integrations

### D1. Who serves the hub?
- **A.** Notify, as [notify.md](../../../contracts/notify.md#the-hub) says: server-rendered pages beside today's check-in page, with a service worker and small scripts only where a page needs the phone (push, the camera).
- **B.** A new `hub` module that serves pages only and keeps no data.
- **C.** A client-side app, built as a bundle and served as static files.
- **Recommendation: A.** No contract change, no new container, and Notify already has the hub's session and token handling, the venue and agenda reads (`hub.py`) and the check-in pages. C would add a third way of building pages; B moves the same code to a new container for no gain the attendee sees. If Notify's pages outgrow one module, the health pass can split them later.

### D2. How do module pages join the hub?
- **A.** Each module renders its own attendee pages on its own paths with the frame's markup from `packages/ui` (the event header, the tab bar, the tokens); the hub draws only its own pages.
- **B.** The hub renders everything from the module APIs; modules have no attendee pages.
- **C.** The hub embeds module pages in frames.
- **Recommendation: A.** It matches how organiser pages work (one shell, each module its pages), keeps each module's flow with its owner (#119), and C is ruled out by [0010](../../decisions/0010-scope.md) (no page embedding) ([mockup 09](09-more.svg)).

### D3. The installed app's scope?
- **A.** The manifest's `scope` is `/` (the whole event hostname) with `start_url` `/notify/`, so module pages and the organiser door stay inside the app; the service worker's scope stays `/notify/` (push and the hub's own offline pages only).
- **B.** Scope `/notify/` for both: module pages open in a browser tab.
- **C.** Scope `/` for both: the service worker also controls admin and module pages.
- **Recommendation: A.** B breaks the "one app" feel at every module link; C lets one worker cache pages it does not own, admin included ([mockup 19](19-hub-map.svg)).

### D4. The next event: what happens to an installed hub?
A PWA, its push permission and its subscription belong to one hostname, each event has its own hostname, and Notify deletes every subscription when an event is archived ([mockup 18](18-flow-next-event.svg)).
- **A.** A new install per event, as the contracts are.
- **B.** A series hostname that moves: the series gets a lasting hostname, which the superadmin moves to the new event when it is cloned; the installed app and its permission stay, and the hub subscribes again silently on its first open in the new event.
- **C.** One hub on the platform domain with an event picker.
- **Recommendation: B.** Regulars come to several events a year at one venue (0022); asking them to install and allow alerts again each time throws away the hub's best feature. C breaks "the tenant comes from the hostname" and host-only cookies (0013, #52). **Contract** (tenants.md: moving a hostname between events of one series; additive), and high risk (tenancy), so its own issue, not inside the hub's packages.

### D5. Which zone does Now show?
- **A.** The zone of the screen whose QR was scanned (Screen adds `?zone=<key>` to the hub QR's URL), remembered on the phone; the event's first zone otherwise.
- **B.** Always the event's main zone.
- **Recommendation: A.** In a venue with a main hall and a stage the right "now" depends on where you stand ([mockup 03](03-now.svg)). **Contract** (screen.md, Header and hub QR: the zone in the URL; additive).

### D6. How does Now stay current?
- **A.** Read on open and when the page becomes visible, then every 60 s while visible, with `ETag` and `agenda_version` so an unchanged answer is a 304.
- **B.** A push stream (server-sent events) per phone.
- **C.** Only when a push arrives.
- **Recommendation: A.** Phones suspend background pages, so a stream mostly reconnects; 2,000 visible phones polling every 60 s with 304s is about 33 small requests a second. B can come later if O3's test asks for it.

### D7. How does following one run-of-show item work?
Decided by the product owner on 2026-11-14 (#160): keep it; plan it with the hub's Now pages.
- **A.** The agenda's `schedule` topic gains a personal part with scope `entity` (`agenda_item`), with `agenda.item.removed` as its `removed` event; the hub's item page gets a Follow button for members.
- **B.** A separate topic, `schedule_item`, owned by the agenda.
- **Recommendation: A.** Notify's entity follows already do this for games; one topic keeps "Schedule" one line on the alerts page. **Contract** (notify.md's `schedule` row and the agenda's registration; additive) ([mockup 04](04-schedule.svg)).

### D8. A calendar file of the run of show?
- **A.** No.
- **B.** A personal `.ics` of the followed items.
- **C.** The public run of show as a calendar feed.
- **Recommendation: A.** A calendar copy goes stale at the first live delay, which is exactly when the hub is right.

### D9. Several phones per person, two events on one phone?
- **A.** As built: one subscription per phone and event; the alerts page lists "2 phones get your alerts" from the export and can remove one.
- **B.** As built, with no list.
- **Recommendation: A** ([mockup 06](06-alerts.svg)).

### D10. What happens to today's check-in page?
- **A.** It stays the page the phone's camera opens, server-rendered and working without scripts, now drawn in the hub's frame; the hub's scanner opens the same page.
- **B.** It is replaced by a hub page that needs scripts.
- **Recommendation: A** ([mockup 10](10-check-in.svg)).

### D11. Which join links does Play offer?
- **A.** Discord voice channels (the bot knows them) now; a game's own launch or lobby link when the games catalogue gets one (the Games track).
- **B.** Discord only, ever.
- **Recommendation: A** ([mockup 11](11-play.svg)).

### D12. Can a person delete their own account?
[tenants.md](../../../contracts/tenants.md#privacy-and-retention) says self-service account deletion belongs to the hub's privacy centre; today only the superadmin can.
- **A.** Add `DELETE /api/tenants/me`: it deletes the caller's user as the superadmin's delete does and emits `tenants.user.deleted`, which every module already handles.
- **B.** A "request deletion" button that tells the superadmin.
- **C.** Not in this track.
- **Recommendation: A.** **Contract** (tenants.md; additive), high risk (personal data); built in the privacy centre's package ([mockup 14](14-flow-privacy-data.svg)).

### D13. How is the export delivered?
- **A.** The phone calls each module's `me/export` and saves one JSON file; nothing is stored on the server.
- **B.** A server job that builds a zip and sends a link.
- **Recommendation: A.** Nothing new to keep, secure or delete.

### D14. What does "Leave this event" do?
- **A.** It ends membership only (`DELETE /api/tenants/me/membership`); the person's data at the event stays until its retention date, and the page offers "Delete my data at this event" beside it.
- **B.** Leaving also deletes the person's data at the event.
- **Recommendation: A.** Two clear actions instead of one surprising one.

### D15. Which access settings does the track build pages for?
`admin_access`, `info_page_mode` and `membership` live in tenants, and the Go-public track builds the people part (#150, #52).
- **A.** None: the track adds only a plain-words summary of who can see what (on the organiser's access page and in the hub's About), and the refusal page's text.
- **B.** The whole Event → Access page.
- **Recommendation: A** ([mockup 15](15-organiser-access.svg)).

### D16. Where do announcements come from?
- **A.** Now shows the active announcements from Moments' API (#115); the inbox holds them through Notify's `announcements` topic.
- **B.** Only through Notify.
- **Recommendation: A.** A guest who never turned on alerts still sees the latest one on Now.

### D17. "On the big screen": text or picture?
- **A.** Text from `GET /api/screen/now?zone=` (what the zone shows, as view-models).
- **B.** A live miniature of the screen.
- **Recommendation: A.** The miniature needs the virtual-screen render on every phone; text is light and readable.

### D18. How does For you learn what each module has for the person?
- **A.** Each module's own "my" read (the tournament's matches, the pizza orders), each read by the hub in its own shape.
- **B.** A small shared convention beside the privacy convention: `GET /api/<module>/me/summary` → a list of cards (`title`, `subtitle`, `state`, `starts_at`, `url`); the hub shows them in time order; a 404 means nothing to show.
- **Recommendation: B.** The hub then never learns a module's shapes, and a module added later (the Apps track, #193) appears in For you with no change to the hub. Notify's check-in is its first user, pizza and the tournament follow in their steps. **Contract** (contracts/README.md; additive).

### D19. What is kept on the phone for offline use?
- **A.** The app shell, Now's and Schedule's last answers, and the inbox's last page.
- **B.** Nothing: online only.
- **C.** Everything, module pages included.
- **Recommendation: A.** 0022 drops an offline-first *player*, not a cached hub; a hall full of phones on one Wi-Fi is when the cache pays ([mockup 17](17-states.svg)).

### D20. Where does a guest's subscription token live?
- **A.** In the phone's storage for the event's hostname, where the service worker and the pages can read it.
- **B.** Also in a cookie.
- **Recommendation: A.** A cookie would send it with every request for no use.

## E · Edge cases and failure

### E1. The venue's Wi-Fi is saturated
- **A.** The cached pages (D19) with "Offline · showing 18:40"; alerts and check-in say they need the network.
- **B.** An error page.
- **Recommendation: A** ([mockup 17](17-states.svg)).

### E2. A module is down, or the event does not run it
- **A.** Each card fails alone with "can't load right now"; a module the event does not run (its feature flags, [tenants.md](../../../contracts/tenants.md#feature-flags), or a 404 by the privacy convention) never shows, and is never an error.
- **B.** The page fails as a whole.
- **Recommendation: A.**

### E3. An iPhone without the hub on the home screen
Safari offers web push only to a site added to the home screen (iOS 16.4 and later).
- **A.** The alerts card shows the install guide instead of the permission prompt.
- **B.** Ask anyway, and fail.
- **Recommendation: A** ([mockup 05](05-install-guide.svg)).

### E4. Discord's in-app browser and other in-app browsers
Links from Discord open in its own browser, which cannot install a PWA or show push.
- **A.** Detect it and say "Open in your browser" with a copy-link fallback; reading keeps working.
- **B.** Ignore it.
- **Recommendation: A.** Discord is the event's second surface, so many people will arrive this way ([mockup 05](05-install-guide.svg)).

### E5. Signing in from an installed hub
An app on an iPhone's home screen keeps its own cookies, apart from Safari's, so a sign-in finished in Safari does not reach it.
- **A.** The sign-in round trip must finish inside the installed app (#52 already has the criterion), tested on iOS and Android before the signed-in hub ships.
- **B.** Sign in only in the browser.
- **Recommendation: A.** It is the riskiest part of the track; test it first ([mockup 08](08-flow-sign-in-join.svg)).

### E6. A push whose details cannot load
- **A.** A text per topic from the registry ("Demo Event: a schedule change. Open the app to read it.").
- **B.** One generic text.
- **Recommendation: A** ([mockup 07](07-notifications.svg)).

### E7. A notification for something that is gone
- **A.** The page says what happened ("This item was removed from the schedule", "This has passed") and shows what it can.
- **B.** A 404 page.
- **Recommendation: A.**

### E8. A member who opted out of presence tries to check in
Check-ins are presence data; #294 stops recording them for an opted-out user.
- **A.** The hub says "You chose not to record your presence, so check-in is off" with a link to Privacy, and does not open the scanner.
- **B.** The check-in silently records nothing.
- **Recommendation: A** ([mockup 10](10-check-in.svg)).

### E9. A person who opted out of presence and Play
- **A.** Nothing extra: the bot never records them, so they never show; the privacy page says "you don't appear in Play".
- **B.** Nothing at all.
- **Recommendation: A** ([mockup 11](11-play.svg)).

### E10. A module is down during a delete
- **A.** The page shows each module's answer and retries the ones that failed; the account delete (D12) runs server-side through `tenants.user.deleted` anyway.
- **B.** A server job that finishes per-event deletes.
- **Recommendation: A** ([mockup 13](13-privacy-centre.svg)).

### E11. The last event admin deletes their account
- **A.** Refused with a reason: hand the event to another admin first.
- **B.** Allowed; the superadmin fixes the event.
- **Recommendation: A.** **Contract** (tenants.md, with D12).

### E12. A guest lost the subscription token
Clearing a site's data loses the token; when the browser keeps the push subscription, subscribing again with the same endpoint is 409 `subscription_exists`, because the caller cannot prove it owns it.
- **A.** Accept proof of possession: a new subscribe with the same endpoint *and* the same `keys.auth` secret (which only that browser holds) replaces the old subscription.
- **B.** As is: the old one lives until the push service answers 410 or the event is archived.
- **Recommendation: A.** **Contract** (notify.md, Web Push; additive) ([mockup 14](14-flow-privacy-data.svg)).

### E13. The primary hostname changes during the event
- **A.** The old hostname stays as an alias until the event is archived, so installed hubs keep working.
- **B.** The superadmin's problem.
- **Recommendation: A**, as a rule in the hostname runbook (no contract change: an event may already have several hostnames).

### E14. The info-page mode changes mid-event
- **A.** The hub shows the closed state at once (mockup 17) and tells a guest that their alerts are paused, as Notify already pauses them in mode `sign_in`.
- **B.** Pages just fail.
- **Recommendation: A.**

## O · Operations and scale

### O1. A page-weight budget?
- **A.** Yes: first load at most 150 KB over the wire, a repeat visit at most 20 KB, checked in CI.
- **B.** No budget.
- **Recommendation: A.** The VM is remote ([0011](../../decisions/0011-hosting-on-remote-vm.md)): every byte crosses the venue's uplink, 2,000 times.

### O2. What the hub costs the VM
- **A.** Measure it in O3's test: requests per second at 2,000 visible phones (D6), and the push fan-out.
- **B.** Assume it is small.
- **Recommendation: A.**

### O3. A test at the large event's size?
- **A.** On the demo stack with a fake push service: 2,000 subscriptions, one event-wide notification, all delivered within a set time (proposed: 60 s), and the cap and quiet hours held.
- **B.** Leave it to the backlog's load harness (0022).
- **Recommendation: A**, as the track's own small test; the full harness stays in the backlog ([mockup 07](07-notifications.svg)).

### O4. The VAPID key
A new key breaks every push subscription (the notify module's README).
- **A.** It is in the backups off the VM (#55) and in the restore drill, and the runbook says never to rotate it during an event.
- **B.** As is.
- **Recommendation: A.**

### O5. The privacy centre's deadline
- **A.** It is in place before the dress rehearsal (step 11), as the roadmap says, and the track's order puts it right after the signed-in hub.
- **B.** Whenever.
- **Recommendation: A.** The track's only date-bound item ([mockup 13](13-privacy-centre.svg)).

### O6. Go public and the hub
0022: the hub opens to the public only after a go-public checklist.
- **A.** The hub ships to the test VM as soon as it is built; a real event uses it only after the Go-public checklist (#51) is done.
- **B.** A per-event switch that turns the hub on.
- **Recommendation: A.** The checklist already gates the hostname and HTTPS; a second switch adds nothing.

### O7. Delivery health for organisers
- **A.** Delivery counts per topic (`notify.stats.read`, built) on the organiser's Notify page, and the push failure rate in Admin → Health.
- **B.** Logs only.
- **Recommendation: A.**

### O8. Which browsers?
- **A.** The last two versions of Safari on iOS (16.4 or later), Chrome on Android, Samsung Internet and Firefox; CI runs the hub's browser tests in WebKit and Chromium at phone size.
- **B.** Chrome only.
- **Recommendation: A.**

### O9. Screenshots
- **A.** Every hub page joins the demo screenshots at phone width (`*-phone.png`), as the screenshot rule asks for every user-facing page ([docs/ci.md](../../ci.md#tiers)).
- **Recommendation: A.**

## P · Plan and scope

### P1. The track's issue set
- **A.** As proposed in the brief ([Proposed issue changes](../track-app.md#proposed-issue-changes)): A1 and A2 rewritten (the backend exists), A3 rewritten with its dependencies named, A4 kept, A5 with self-service deletion, A6 narrowed to a recap, reactions added, the series hostname added if D4 is B.
- **B.** The epic's six items as written.
- **C.** Fewer, bigger issues.
- **Recommendation: A.**

### P2. The order
- **A.** The guest hub and alerts first (they need nothing beyond step 3); the signed-in hub after #52 and #150 (Go public); the privacy centre right after it and before step 11; Play after step 6's bot read API; reactions after step 4 and the signed-in hub; the recap last.
- **B.** The epic's order, one at a time.
- **Recommendation: A** ([brief, Order](../track-app.md#order-a-sketch-for-the-planner)).

### P3. Does Play wait for its sources?
- **A.** Yes: it is built after the bot's read API (step 6, #122) exists, and gains games and follows when the Games track lands.
- **B.** Build it now against fixtures.
- **Recommendation: A.** Lean scope: no pages without their data ([mockup 11](11-play.svg)).

### P4. How much of the player's side lives in the hub?
- **A.** The hub frames and links; the tournament module owns its pages (my matches, the match page, check-in by `tournament:<ref>`), and step 7's brief decides the player flow (lobby id, "I can't make it", reporting).
- **B.** The hub builds the match page itself.
- **Recommendation: A** ([mockup 12](12-flow-match-called.svg)).

### P5. Reactions in this track?
- **A.** Yes, an issue of its own: Moments' reactions API (the fixed set, the rate limit, off in a quiet scene, the crew switch), the drawing on the screen as step 4's mockup 15 has it, and the hub's buttons.
- **B.** Leave them to the Apps track.
- **Recommendation: A.** Step 4 handed them here (its P4 B).

### P6. Memories
0022 names memories in the track; tenants.md says Moments keeps them when `memories_opt_in` is on, but no module knows who is in a photo ([mockup 16](16-memories.svg)).
- **A.** Photos: people tag themselves in the event's photos and keep them for 12 months.
- **B.** A recap of the person's own records (matches, results, orders, check-in) after the event; photos to "Not scheduled yet".
- **C.** Memories to "Not scheduled yet" altogether.
- **Recommendation: B.** It needs no new storage and no tagging; until something reads `memories_opt_in`, the privacy centre does not show that switch (a switch that does nothing misleads).

### P7. Organisers reaching admin from anywhere: whose is it?
The roadmap's App item 3 includes "event admin reachable from the internet with sign-in, behind a venue-or-Tailscale switch", but `admin_access` is already in tenants and #52 carries the criterion.
- **A.** The Go-public track builds and enforces the switch; this track adds only the hub's door (U13) and the plain-words summary (D15).
- **B.** This track builds the switch too.
- **Recommendation: A**, with a `Roadmap note:` to move the line.

### P8. The track's exit criteria (the roadmap says: set when the track is planned)
- **A.** On the demo stack: a guest scans the Pulse's QR, sees now and next, turns on alerts and gets a delay's push within 10 s; a member joins with the link, follows an item, checks in, and gets an urgent push during quiet hours; export and delete work across every module the demo runs; O3's fan-out passes; every hub page has its phone screenshot.
- **B.** Fewer, set by the plan.
- **Recommendation: A.**

### P9. Polls in the hub?
Polls are dropped by [0010](../../decisions/0010-scope.md), and #193 lists no-code polls; the product owner has kept the question open.
- **A.** Not in this track: if polls come back, the Apps track (#193) builds them, and the hub shows them as any module page in its frame.
- **B.** This track builds polls.
- **Recommendation: A.** A new record would be needed first (0022: a dropped item comes back only through a new issue and a record).

### P10. The hub's first package: how much?
- **A.** A1 and A2 as one package (the shell and alerts share pages and the service worker), with the per-item follow (D7) and the route map in notify.md.
- **B.** A1 alone first.
- **Recommendation: A.** Fewer, fuller packages cost less (AGENTS.md, package plan); the two together stay under 4,000 lines.
