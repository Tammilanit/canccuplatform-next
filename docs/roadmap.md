# Roadmap

The plan from today to the full new platform: **a commercial-scale, polished and intuitive platform for events of any size**, much bigger, better and richer than the legacy system it grows from ([0020](decisions/0020-best-of-old-freely-new.md)), for the vision of [0022](decisions/0022-product-vision.md). There are no fixed dates; the steps go in the order of their dependencies ([0021](decisions/0021-no-fixed-dates.md)). This file is the plan; the decisions behind it are in [`decisions/`](decisions/README.md). Both live only here: when the plan changes, change this file in a PR.

## In short
- **The screen is the heart.** A "Pulse" screen at the venue, very visual, lively and always current: push-driven, composed of widgets, with Moments at the peaks and a QR handoff to phones. Discord is the second surface, and a phone hub (a PWA) the third, on its own track ([0022](decisions/0022-product-vision.md)).
- **The best of the old, freely new.** The legacy repos are a source of proven ideas, code and tests; for each feature we reuse, adapt, rebuild, drop or add something new, whichever makes the better product ([0020](decisions/0020-best-of-old-freely-new.md)).
- **Multi-tenant from day 1.** Many events, also simultaneous, on one shared stack ([0013](decisions/0013-multi-tenant-core.md)). The tenancy foundation comes before the module contracts.
- **Infrastructure first**, then modules one at a time. While `platform.version` is `dev` and no tenant is live, the shared VM follows main, so the pieces are joined every day, not at the end.
- **Dependencies set the order; no dates are fixed** ([0021](decisions/0021-no-fixed-dates.md)). An event that runs on the platform pins a tested release.
- Each step is an epic in this repo with a "Planned" checklist of its issues. From step 3 on, like every parallel track, it starts with a research pack, an extensive brainstorming session with the product owner over as many rounds as it takes, and a plan the product owner accepts before any build ([0023](decisions/0023-step-design-briefs.md), [0026](decisions/0026-briefs-are-research-packs.md), [`briefs/`](briefs/README.md)); it runs in work packages and ends with a health pass and a checkpoint ◆ ([0019](decisions/0019-work-packages.md); AGENTS.md, How work flows).

## Goals and non-goals
- **Who:** organisers of recurring LAN events at one venue (several events a year), the venue's staff, and attendees; it scales to a large event of about 1,000–2,000 attendees. Free and self-hosted (AGPL), no payments ([0022](decisions/0022-product-vision.md)).
- **Goals:** run any event from one profile (configuration, not code); work at both ends, from a handful of friends to a large event with several screens; fewer manual steps on the day; keep what worked (pizza end to end, the tournament flow after its fixes, easy setup, a screen anyone can open).
- **Multi-tenant from day 1:** many events, also simultaneous, on one shared stack. Adding an event or a hostname adds rows; it needs no deploy and no restart.
- **Non-goals for this round:** payments, public results, a hot standby.
- **Not planned** ([0022](decisions/0022-product-vision.md)): an auto recap reel, an offline-first player, a game-server registry, a service-order engine (the pizza flow is ported as it is), a help desk, a cheer meter, a venue edge box.
- **Users:** the organizer (runs the event and admin), the attendees and players (follow the event, register, play, see scores), the venue crew (screens, network, hardware), and the superadmin who operates the shared stack for several organizers.

## How the system fits together
- **The platform runs on a hosted VM away from the venue**, not on a venue host ([0011](decisions/0011-hosting-on-remote-vm.md)). One VM runs one shared stack: one container per module, one Postgres, one Valkey and one edge Caddy. Every event is a tenant in it.
- **Attendees and the projector PC reach the VM over the internet** through the venue's uplink. The VM sees the whole venue as one public address, so **HTTPS with a real domain is required** for every page and for sign-in. Events at the same venue share that address, so the per-venue check for screens is in the app, not the firewall ([0013](decisions/0013-multi-tenant-core.md), item 33).
- **The venue uplink is a dependency.** When it drops, screens keep showing their last state and assets, and admin shows them as offline.
- **The projector is a venue PC** running a full-screen browser on `/screen` and sending picture and sound over HDMI. The VM serves web pages only and never drives a display.
- **The fallback laptop is the only on-site copy:** the event repo, images downloaded in advance, the separately kept secrets key and `deploy/.env`, and a restore of the latest backup, started with one command.
- **Modules talk through their API and the bus.** Example: Pizza publishes `pizza.order.placed`, Moments ranks it against other moments, Screen shows it and Voices can speak it. Nothing polls.

<a id="order-and-dates"></a>
## Order
- **Steps follow their dependencies,** not a strict one-after-another rule. An issue starts when the issues it is blocked by are closed, so issues from different steps can run at once. The tracker's blocked-by links are the source for the order; this file names them.
- **The tracker:** each step is an epic in the milestone of the same number (milestones have no due dates); its epic closes when its children close. Step 2 is one milestone with the epics #36, #46 and #47.
- **Step 0's product-owner tasks** (#43, #44, #45) run alongside and block only the issues that name them: #43 (domain) blocks #5 and #51; #45 (backup target) blocks #55. #44 (test Discord) is done; it blocked #10 and #52.
- **The parallel tracks** (Finals, Games, Cast, App; milestone "Parallel tracks"; epics #161, #66, #67 and #160) start after the tenancy foundation (#47); the tracker has no blocked-by link for this yet. Like a step, a track builds only once its own plan is accepted ([0026](decisions/0026-briefs-are-research-packs.md)). The App track's privacy center lands before the dress rehearsal (step 11).
- **No fixed dates:** no freeze and no target date ([0021](decisions/0021-no-fixed-dates.md)). Work goes as fast as it goes; a release freeze before an event, if ever wanted, is decided then in its own record.

## How the roadmap changes
The roadmap changes as we learn ([0019](decisions/0019-work-packages.md)).
- **Roadmap notes:** whoever finds something that changes the plan (a worker, planner or reviewer) writes a `Roadmap note:` line in the PR; work that fits the plan as it is goes in a `Follow-up:` line. Nobody splits an issue or creates one for them.
- **The lead's triage:** the lead sorts each note into this step, a later step, or a roadmap change for the maintainer.
- **The review at each checkpoint ◆:** the maintainer sees the demo and the step summary (packages, risk classes, spend, roadmap notes, and the step's contract PRs, reviewed together, [0024](decisions/0024-additive-contract-docs-normal-risk.md)); this file is updated in a PR, and the maintainer says go before the next step starts.
- **Change log:** every change to this file adds a dated line below, newest first: `- YYYY-MM-DD: <what changed> (<issue or PR>)`.

### Change log
- 2026-11-14: an additive contract change ships in the package PR with the code that uses it; only a breaking change is still its own PR, merged first ([0029](decisions/0029-additive-contracts-ship-with-consumers.md), #462).
- 2026-11-08: a step brief becomes a research pack (every key screen mocked up, a full question bank) for an extensive brainstorming session over as many rounds as it takes; the lead then writes the plan into the brief, the product owner accepts it before any build, and its plan issue gates the step's other issues; this holds for every step from step 3 on and every parallel track ([0026](decisions/0026-briefs-are-research-packs.md), #175).
- 2026-11-08: the product owner's decisions of 2026-11-07: step 3 builds the new `theming`, `agenda` and `notify` modules, each its own container; the bot only reports activity counts and the games module detects surges; rosters and rounds for casual play belong to the Games track; the App track (#160) and Finals track (#161) epics are listed; the dress rehearsal of step 11 is mainly the product owner testing the whole system at home; the App track's privacy rules gain the 12-month anonymisation and joining by the venue or the event's own link; overrides are `moments.*` (#162, #156).
- 2026-11-07: the Games track splits into a Finals track (the `finals` module, on the shared tourney core) and a Games track (the generic `games` module); the mini tourney's author gave the OK to reuse the ISC code, so the notes waiting for it are removed ([0025](decisions/0025-finals-and-games-modules.md), #148).
- 2026-11-07: a contract doc that only adds is normal risk, and the checkpoint's step summary lists the step's contract PRs for the maintainer to review together ([0024](decisions/0024-additive-contract-docs-normal-risk.md), #136).
- 2026-11-06: every step from step 3 on starts with a design brief (`docs/briefs/`) and a brainstorming round with the product owner, and its other issues wait for the brief; issues gain a Room to design section ([0023](decisions/0023-step-design-briefs.md), #130).
- 2026-11-06: the product vision recorded ([0022](decisions/0022-product-vision.md)): who it is for, Pulse and push in step 3, Moments at the peaks and one announce action in step 4, the core features in their steps, the App parallel track for the phone hub, the backlog under Not scheduled yet, and what is not planned (#102).
- 2026-11-06: the reuse table (Building on the legacy) updated from the legacy inventory summary, with the main features of every legacy repo, the new features and six flagged changes of order and dependencies, OC1, OC2, OC4, OC6, OC7 and OC8 (#76).
- 2026-11-06: the ambition restated: a commercial-scale platform that takes the best of the legacy and is free to build anew ([0020](decisions/0020-best-of-old-freely-new.md)); no freeze and no target dates, step 11 becomes "Dress rehearsal and switch" ([0021](decisions/0021-no-fixed-dates.md)) (#99).
- 2026-11-06: steps run in work packages and end with a health pass and a checkpoint ◆; this section added ([0019](decisions/0019-work-packages.md), #99).

## Steps

### 0. Prep
- **Goal:** everything the first steps need from outside the code.
- **In it:**
  - done: the GitHub organization with this public repo and a private event repo; code surveys of the legacy repos and the reuse plan (see Building on the legacy below); the hosted VM with Tailscale and a firewall; parallel workers, one worktree per issue; a test Discord server and a dev bot with its own Discord app (#44);
  - open: the platform domain and a DNS API token for DNS-01 certificates (#43, blocks #5 and #51); a backup target off the VM (#45, blocks #55);
  - done 2026-11-07: the mini tourney's author gave the OK to reuse the ISC-licensed code in the `finals` module and the shared tourney core ([0025](decisions/0025-finals-and-games-modules.md)).
- **Exit criteria:** workers run in parallel in one repo; the VM is reachable; the test Discord server and dev bot exist; the domain decision is made.
- **Issues:** product-owner tasks #43, #44, #45 (each in the milestone of the step it blocks; see Order and dates).

### 1. Skeleton
- **Goal:** infrastructure first: a stack that starts, deploys itself and has an admin page.
- **In it:** the monorepo; Compose with Postgres, Valkey and Caddy; kit-ts and kit-py; ui; CI with branch rules and the merge queue; the admin API and profile contract; admin settings, health view and profile save and load; setup (install, boot survival, firewall, the demo event); demo-stack CI with screenshots and image builds; Discord sign-in, first-run code and rights; auto-deploy of main to the VM.
  - #12 is re-scoped for the shared stack: the firewall covers IPv6 and port 443 and can later open 80/443 to everyone; `new-event` becomes "seed the demo tenant" once the tenants module exists (tenants themselves are rows created through the tenants module).
  - #5 changes: the VM is remote, so sign-in needs HTTPS on a real hostname. The old check "does Discord accept plain http to a LAN IP" and the venue router's DNS-rebinding check no longer apply. #5 and #10 build sign-in so that it fits the central sign-in host of step 2b ([0013](decisions/0013-multi-tenant-core.md), item 10) instead of being redone there.
  - #14 changes: auto-deploy holds while any tenant is live, except hotfixes ([0013](decisions/0013-multi-tenant-core.md), item 22).
- **Exit criteria:** change a setting on the VM and see a test module's health. Signing in over HTTPS is an exit criterion of step 2b, because it needs the domain, the edge Caddy and the central sign-in host.
- **Issues:** epic #15. Closed: #2, #3, #4, #6, #7, #8, #9, #11. Open: #12 and #13 (ready); #10 (blocked by #48); #5 (blocked by #10 and #43); #14 (blocked by #12). Also in the milestone, closed: #39 (the review gate, merged as #40) and #44.

### 2. Event catalog and contracts
The contracts step. Its dependencies: the tenants contract (#48) waits for the legacy inventory (#46); the event catalog (#34) waits for #48; the screen contract (#35) waits for #34, #48 and the theming contract (#54). Both contracts must be tenant-aware.

#### 2a. Legacy inventory
- **Goal:** know exactly what the legacy offers to build on, confirmed by the product owner, before tenancy and contracts are designed.
- **In it:** one inventory per legacy repo (they can run in parallel), then a summary. For each repo: features, data model (what is per event and what is global), bus events and APIs, external integrations (Discord, feeds, devices), config and env, tests, size, event-specific content, the target module and step, and what is dropped.
- **Exit criteria:** the scrubbed per-repo inventories and the summary `docs/legacy-inventory/README.md` are merged, each confirmed by the product owner; the summary updates the reuse plan below; event-specific findings are in the event repo.
- **Issues:** epic #46: per-repo inventories #68–#75 (no blockers, can run in parallel), then the summary #76 (blocked by #68–#75).

#### 2b. Tenancy foundation
- **Goal:** every later module is tenant-aware from its first line ([0013](decisions/0013-multi-tenant-core.md)).
- **In it**, each its own child issue; the blocked-by links set the order (#49, #53 and #54 wait for #48; #50 for #48 and #49; #51 for #50 and #43; #52 for #50 and #51 (and #44, done); #55 for #50 and #45; #56 for #49 and #50):
  1. the tenants contract (first, #48): registry, hostnames, admins and roles, settings, feature flags, lifecycle, audit log, and `tenant` in the bus envelope; venues as global rows owned by the tenants module and managed by the superadmin (name, IPv4 and IPv6 addresses; the devices at a venue belong to Screen, step 3), each event pointing to a venue (several events can share one, also at once), the per-tenant info-page mode (public, venue-only, sign-in) and the audited emergency switch for the venue IP check ([0013](decisions/0013-multi-tenant-core.md), items 33–34);
  2. kit tenancy (#49): tenant context, row-level security helpers, scoped Valkey keys, streams and files, a migration lint and leak-test helpers; it implements the carve-outs of [0013](decisions/0013-multi-tenant-core.md) items 2 and 6 (platform hostnames, health endpoints and the IP-mode demo stack outside tenant resolution; global tables on the lint's allow-list);
  3. the tenants module (#50);
  4. the edge Caddy with a wildcard certificate (DNS-01) and on-demand TLS behind an `ask` endpoint (#51);
  5. the central sign-in host (#52);
  6. bot connections in the bot contract (shared bot and own tokens, #53);
  7. the theming contract (#54);
  8. backups off the VM (#55).

  Then the admin module's single-event tables are reworked for tenants (#56).
- **Exit criteria:** a user signs in with Discord over HTTPS through the central sign-in host; two demo tenants run on one stack, each on its own hostname over HTTPS, both pointing to one demo venue; CI proves no data crosses between them (RLS lint and leak tests); a backup lands off the VM.
- **Issues:** epic #47, children #48–#56 with the blocked-by links above.

#### 2c. Event catalog and screen contract
- **Goal:** the events modules exchange, named and outlined before the module work starts.
- **In it:** event names and payload outlines for pizza, tournament, bot and screen overrides (#34); the screen module API and events (#35), with device tokens, the venue IP check, devices (global rows with their current tenant) and per-tenant zones and assignments, layouts as data and pinned bundles; it uses the theming contract from 2b item 7. #34 settled that screen overrides are `moments.override.*` events, since Moments ranks them ([0010](decisions/0010-scope.md), [events.md](../contracts/events.md#screen-overrides)), so step 4 needs no breaking rename. Each other module's full contract is its own PR at the start of its step, written from the real legacy API.
- **Exit criteria:** catalog and screen contract merged, both tenant-aware.
- **Issues:** epic #36: #34 (blocked by #48), then #35 (blocked by #34, #48 and #54).

<a id="3-screen-core-incl-pptx"></a>
### 3. Screen core and Pulse, incl. PPTX
- **Goal:** the projector PC plays a Pulse screen from the VM, always current by push, and an event can run several screens.
- **In it:** a signage system built on the best of the canccusignage core: scheduler and windows, playlists, playback timing and bookmarks, validators, duration parsers, the asset pipeline with PowerPoint rendering as a separate render-job container, the kiosk player and a new Postgres schema. Rewritten: the screen page and snapshot serving, persistence, the admin UI (its view-models kept). Screens cache their last state and assets (they are not an offline-first player, [0022](decisions/0022-product-vision.md)). The ticker is manual ([0018](decisions/0018-ticker-manual.md)): set from admin or the bot, and Screen owns its scheduled windows (taken from the bot's ticker schedule into the scheduler windows) and keeps them across restarts. Feeds are wired later (step 9).
  - **Pulse** ([0022](decisions/0022-product-vision.md)): the Main screen is very visual, lively, coherent and always current. It is composed of widgets placed by layouts as data, and its state is pushed to every screen (polling only as a fallback). A QR code on the screen hands off to phones (the App track).
  - **Three new modules, each its own container,** built alongside Screen from the contracts of step 2: `theming`, `agenda` and `notify`.
  - **The brand kit:** each event's look, in the `theming` module ([contracts/theming.md](../contracts/theming.md)), with a simple mode and an advanced (CSS) mode.
  - **The run-of-show:** its own `agenda` module ([contracts/agenda.md](../contracts/agenda.md)), editable live while the event runs; it drives the scheduler windows.
  - **Notify:** its own `notify` module ([contracts/notify.md](../contracts/notify.md)): the topic registry, Web Push, the delivery rules and check-in by the rotating QR, which the screen's `checkin_qr` widget shows. The hub's pages on top of it are the App track's.
  - **Devices**, owned by Screen: a global device row holds only its name, a hash of its device token, its venue id (the venue is read through the tenants API) and its current tenant. A device serves one tenant at a time: only the superadmin (who manages venues) sets its current tenant (audited), and a tenant's zone assignment is valid only while that matches. Two simultaneous events at one venue use different devices. Zone assignment and health are per tenant (`tenant_id`, RLS). Paired once, with a revocable device token; a screen is served only with **both** its token and a request from its event's venue IP (the IP alone is never enough), unless the tenant's audited emergency switch has turned the IP check off.
  - **Zones** per event (for example main hall, café, stage), each with its own layout, playlist and schedule; devices are assigned to zones per event and reassigned for the next event.
  - Push to all zones or one zone, and mirror one zone onto others.
  - Device health in admin: online, last seen, now playing.
- **Exit criteria:** the projector PC plays a Pulse screen from the VM over HTTPS, including a PPTX deck, and keeps showing it when the uplink is cut; a run-of-show change in admin reaches it by push, with no reload; a second device in another zone plays its own playlist; a device with a valid token outside the venue IP is refused; a device whose current tenant is another event is refused; admin shows both devices' health.
- **Issues:** epic #57; children are written when the step starts, after #35.

### 4. Moments
- **Goal:** one queue decides what the screens show and play, and when: the Moments at the peaks of the event ([0022](decisions/0022-product-vision.md)).
- **In it:** one module that decides what plays, built on the legacy directive ranking and sound engine: takeovers, blocks, overlays and the sound budget. Moments runs on the server, so every screen gets the same thing and a reload loses nothing.
  - **One announce action:** an announcement from admin or the bot reaches the screen (a Moments takeover), Discord and the ticker at once. It grows from today's announce command; the Discord side lands in step 6.
- **Exit criteria:** a test event takes over the screen and plays sound within the budget.
- **Issues:** epic #58.

### 5. Pizza
- **Goal:** players order food and the crew hands it out, end to end; the first proof of building on the legacy.
- **In it:** the ordering flow, ported as it is (no general service-order engine, [0022](decisions/0022-product-vision.md)), built on the legacy pizza router and its tests; events `pizza.order.*`; a transaction for claims; a scheduler for reminders.
- **Exit criteria:** an order runs end to end and shows on the screen.
- **Issues:** epic #59.

### 6. Bot
- **Goal:** the Discord side of the platform comes from the new bot.
- **In it:** a bot built on the best of canccubot: storage on Postgres, presence, voice, game and stats; polls dropped. One bot module with a pool of clients: the shared platform bot, or a tenant's own token. Slash commands registered per guild from feature flags. Events, and role-to-rights sync. Contract first. Easy Discord guild setup: an organiser binds a guild to an event in a few guided steps. The Discord side of the one announce action (step 4). The ticker commands (`/ticker set`, `stop`, `status` and `/ticker schedule add`, `list`, `remove`) stay and publish to Screen ([0018](decisions/0018-ticker-manual.md)). The bot only reports activity counts (`bot.activities.counted`); the games module matches them to its catalogue and detects surges, which drive the hot-game banner ([contracts/games.md](../contracts/games.md#surges)).
  - The legacy bot data migration into its event's tenant is built here and tested on a copy of the legacy data ([0004](decisions/0004-nothing-migrated.md)); step 11 only runs it at the switch.
- **Exit criteria:** dashboard data and rights come from the new bot on the test server; the legacy bot data migration passes its test on a copy of the legacy data.
- **Issues:** epic #60.

### 7. Tournament
- **Goal:** players register, play and follow a tournament on the platform.
- **In it:** the tournament system ported and polished ([0022](decisions/0022-product-vision.md)): check-in, no-shows, result corrections with an audit trail, seeding; scoring, leaderboard and final, built on the signup site's code; registration lives inside the module; the bot's voice-channel handshake goes through events; concurrency with row locks (`SELECT … FOR UPDATE`). The mini tourney is not part of it: it is the `finals` module of the Finals track ([0025](decisions/0025-finals-and-games-modules.md)).
- **Exit criteria:** a test tournament runs end to end.
- **Issues:** epic #61.

### 8. Admin operations
- **Goal:** the crew sees problems and fixes them from admin, and the next event starts from the last one.
- **In it:** operations built on the best of canccumanager: debounce, alerts as events consumed by the bot, ack and mute, restart policy. The executor is designed new.
  - Event series, with clone-the-last-event, and a venue profile built on the venues of the tenants contract (2b item 1) ([0022](decisions/0022-product-vision.md)).
- **Exit criteria:** an alert reaches Discord and can be acked.
- **Issues:** epic #62.

### 9. Feeds and LAN display
- **Goal:** live data on the screen.
- **In it:** wire pizza, tournament and bot events into Screen; the LAN display page comes last.
- **Exit criteria:** live data on the Main screen.
- **Issues:** epic #63.

### 10. Hardening
- **Goal:** the platform survives the event and can be recovered from cold.
- **In it:**
  - backup and restore, the fallback laptop, an outside watchdog with a heartbeat;
  - an install kit, pre-flight checks before an event, and release channels to pin from ([0022](decisions/0022-product-vision.md));
  - the admin simplification pass, theme, and Finnish as the first language pack;
  - the reviewer moves to its own OS user that alone holds its token, a privileged-setup task ([0014](decisions/0014-independent-review.md), Known limits);
  - dependency auditing ([0015](decisions/0015-dependency-auditing.md)): `npm audit` and `pip-audit` in CI, and Renovate (or Dependabot) for images and dependencies.
- **Exit criteria:** a restore onto the fallback laptop works from cold and secrets decrypt after the restore; the audit jobs run in CI and update PRs arrive.
- **Issues:** epic #64.

<a id="11-freeze-dress-rehearsal-and-switch"></a>
### 11. Dress rehearsal and switch
- **Goal:** an event runs on a pinned, tested release, and the legacy system is retired.
- **In it:**
  - the event pins a tested release ([0021](decisions/0021-no-fixed-dates.md): no freeze date; a release freeze, if wanted, is decided in its own record);
  - a dress rehearsal on the VM: mainly the product owner testing the whole system at home, including a restore onto the fallback laptop; the App track's privacy center is in place before it;
  - the legacy bot is cut over: the migration built and tested in step 6 runs at the switch and moves its data into its event's tenant, the legacy bot is stopped, and its token moves into the tenant ([0013](decisions/0013-multi-tenant-core.md), Consequences; [0004](decisions/0004-nothing-migrated.md));
  - the switch: the old repos are renamed `-legacy` and archived; this repo takes the name `canccuplatform`.
- **Exit criteria:** the dress rehearsal passed; the bot data was migrated at the switch; the event repo pins a tested release.
- **Issues:** epic #65.

## Parallel tracks
All four are new builds with their own contracts, so none blocks the main line. They start after the tenancy foundation (#47), so their contracts are tenant-aware from the start, and each builds only once its own plan is accepted: research pack, brainstorming session, plan ([0026](decisions/0026-briefs-are-research-packs.md)). The Finals and Games tracks were one Games track until 2026-11-07 ([0025](decisions/0025-finals-and-games-modules.md)).

### Finals
- **Goal:** The Finals mini tourney runs on the platform for an event: players and teams register, the bracket runs, and champions are crowned.
- **In it:** the `finals` module: seasons, registration of teams and individuals (on the hub, and by Discord through the bot's `/finals`), brackets, rankings, champions and the team builder; result reporting and correction; the full `finals` contract (API, events `finals.*`, rights) replacing the provisional provider stub ([contracts/finals.md](../contracts/finals.md)); the finals cards on the screen come with Moments (step 4) and the feeds (step 9).
- **Builds on:** the shared tourney core (bracket engine, rankings, team builder), the public library the standalone off-LAN app also uses, taken as a dependency pinned to a release (npm preferred, else a git tag); storage, API, sign-in and the frontend built new on the kit; the tenancy foundation (#47), sign-in and rights (#52); the provider contract shared with the off-LAN app, which stays independent with no data sync. The mini tourney's author gave the OK (2026-11-07); the licence (ISC) and attribution are kept.
- **Exit criteria:** a season runs end to end on the demo tenant, with a sign-up through the bot's `/finals` against the platform as its provider.
- **Issues:** epic #161; its children are written when the track starts.

### Games
- **Goal:** the games people play at an event: what is being played now, what is hot, and who to play with.
- **In it:** the generic `games` module: the game catalogue, activity matching and surges ([contracts/games.md](../contracts/games.md)), favourites with a notification when many play one; rosters and rounds for casual play, for any game: generic teams, and rounds as data (the product owner's decision of 2026-11-07); later LFG and casual sessions (Not scheduled yet). The `finals` module and the tournament keep their own rosters and brackets.
- **Builds on:** the bot's presence data (the who-plays-what API, [contracts/bot.md](../contracts/bot.md)), Notify for the surge notifications, and the screen's hot-game widget; no mini-tourney code.
- **Exit criteria:** an activity on the test server is matched to a game in the demo tenant's catalogue, and a surge reaches the screen and the hub.
- **Issues:** epic #66, written for the old Games track; the lead re-scopes it to this track (the Finals track has its own epic, #161).

### Cast
- **Goal:** anyone at the venue casts their screen to the projector.
- **In it:** its own container (MediaMTX over WebRTC), a cast page and hooks.
- **Open:** casting was designed for a VM on the venue LAN. With the VM remote, the stream crosses the uplink twice; latency and bandwidth must be measured before the design is fixed.
- **Not planned:** a venue edge box ([0022](decisions/0022-product-vision.md)), so the design must work with the VM remote.
- **Exit criteria:** a cast from a venue PC reaches the projector with acceptable delay.
- **Issues:** epic #67.

### App
- **Goal:** attendees follow the event on their phone, and organisers reach admin safely from anywhere ([0022](decisions/0022-product-vision.md)).
- **In it**, in this order; the track is planned separately:
  1. the hub shell: a PWA only (no store app), reached from the Pulse screen's QR handoff;
  2. notifications on the `notify` module built in step 3: event-wide notifications for guests, without signing in;
  3. the signed-in hub: every account is a Discord account, and a person becomes an attendee only at the venue or through the event's own link or QR code ([contracts/tenants.md](../contracts/tenants.md#joining-the-event)); event admin reachable from the internet with sign-in, behind a "venue or Tailscale only" switch that is on by default; the superadmin over Tailscale only;
  4. Play: the player's side of the event on the phone;
  5. the privacy center, before the dress rehearsal (step 11): each module's export and delete ([contracts/README.md](../contracts/README.md#privacy-export-and-delete)); raw presence data is deleted 30 days after an event is archived, and its other personal data is anonymised 12 months after;
  6. memories, opt-in.
- **Rules:** no CDN proxy at the start; the hub opens to the public only after a go-public checklist.
- **Exit criteria:** set when the track is planned.
- **Issues:** epic #160; the track is planned separately.

<a id="porting-plan"></a>
## Building on the legacy
The main features the platform takes from each legacy repo, from the code surveys and the [legacy inventory summary](legacy-inventory/README.md) (#76), whose feature map is complete: every legacy feature with its module, step, verdict and reason. This table is where each step starts, not a limit: for each feature the step chooses to reuse, adapt, rebuild, drop or add something new, and names the reason ([0020](decisions/0020-best-of-old-freely-new.md)). The summary also lists what the platform can offer [beyond the old system](legacy-inventory/README.md#beyond-the-old-system). **(new)** marks the main features the summary added; its feature map has the full list.

| Legacy repo | Reuse as is | Reuse with changes | Rebuild | Drop |
|---|---|---|---|---|
| canccusignage | Scheduler and windows, playback timing and bookmark maths, ADVT window and slideshow maths, scene precedence and readiness timers, sound engine rules, YouTube rules, playlist, item and schedule validators, duration parsers, asset validation and image and video parsers | Bookmark and session storage per zone, ADVT tick (one per zone on the server), directive model and history (bands become settings; Moments, step 4), the ticker and its appearance (Screen, step 3, [0018](decisions/0018-ticker-manual.md)), sound settings and log, asset catalog and replace, asset pipeline with the PPTX render job, web-asset allowlist per tenant, kiosk player with the device token, diagnostics; **(new)** trigger settings (bot and Moments settings schemas), photo carousel (step 3), spotlight (a Moments takeover), screen display settings, design tokens as the demo theme | Screen page and snapshot serving, adapter (becomes event consumers), admin UI (view-models kept), sound board commands, all persistence; **(new)** device identity and health | Auth, runtime/db, supervisor, legacy health, cue migrations, backfill CLIs, ops scripts, the screen-embed message protocol ([0010](decisions/0010-scope.md)), the stream directive kind |
| the signup site (pizza and tournament parts) | Pizza router tests, validators, menu filter, summary and orderer view, daily record and CSV; LAN display pure helpers (alive chrome, demo overlays, trends) | Pizza order lifecycle with transactions, events, reminder scheduler, admin, pizzerias and menus per tenant; tournament schedule, registration inside the module, scoring, roster autofill, leaderboard, final and photos; bot snapshots (to the bot); LAN reset (admin, step 8) | Voice handshake, session admin UI; stats fold and retention (bot, step 6); `postMessage` cues (Moments policy); LAN display views last (step 9) | The LAN signup itself (stays outside, [0005](decisions/0005-signup-site-stays-outside.md)), polls, polls RSS, browser trend state, debug flags, the manager heartbeat, admin password, registration and admin tokens in URLs |
| canccubot | Validators and formatters (the surviving parts), steam_cover, carousel_photo_naming | Storage logic on Postgres, intents, presence, voice, game, message counts, stats, tournament pure parts, tournament reminders and voice channels, `/ticker` commands publishing to Screen, ticker schedule into Screen's windows; **(new)** activity counts for the hot-game banner (the games module matches them and detects surges), screen announce commands (publish events), photo carousel menus, mini-tourney watcher posts (Finals events), finals cards (a Moments takeover, step 4, and a Screen widget, step 9) | Runtime and config (pool of clients), rights by role id, pizza cog, signage client (bus events), alerts (step 8), health; **(new)** trigger settings (per-tenant settings), `/platform status` (step 8) | Polls, RSS ticker, signage state timers, `/adminlink`, heartbeat watcher, worker stub, integration tests, help_cog, `/stream` stubs, the in-memory layer |
| canccumanager | Debounce state machine, log redaction (into the kit) | Health parse and poller, state-change events, alerts and reminders (its tests as the spec), webhook fallback, mute, ack and history, restart policy, status API, live-cast guard | DB layer, executor and action log, log sources, status page (admin health view); **(new)** kiosk restart as a Screen device command | Heartbeat to the signup site, hosted log source, bearer tokens and `X-Caller`, tailnet bind, systemd |
| thefinals_mini_tourney (ISC; Finals track, its author's OK given 2026-11-07) | Bracket engine, rankings, team builder, through the shared tourney core ([0025](decisions/0025-finals-and-games-modules.md)) | Rankings keyed by player id (a user or a guest), service layer on Postgres transactions, result reporting, public start (a tenant setting), roster, champions, arena list as game data; **(new)** bracket and finals cards on the screen (a Moments takeover, step 4, and Screen widgets, step 9) | Storage, API, auth, frontend, settings; **(new)** result correction | Shared admin password, team tokens |
| canccuplatform (legacy system repo) | — | Health shape (done in step 1), CI link check and shellcheck; its contracts are read as the spec for #34, #35 and each module contract | **(new)** kiosk reload as a per-device action (steps 3, 8) | Status, logs, restart and deploy scripts, runbooks, units, login link, the `postMessage` protocol, the heartbeat |
| canccudocs (plans only) | — | **(new)** 17 requirements not yet in the plan, proposed for steps 2b, 2c, 3, 4, 6, 8, 10 and 11 ([Gaps](legacy-inventory/README.md#gaps-from-the-legacy-plans)) | — | Plan index, workspace, legacy docs ([0002](decisions/0002-no-legacy-history-or-docs.md)) |
| canccustream (decommissioned) **(new)** | — | — | Ideas only for the Cast track: cast events instead of webhooks, the cast page, a test sender, the stall-grace rule and encoder findings | All code: RTMP ingest, compositor, slot daemon, scripts, units |

Order rationale: Screen consumes pizza, tournament and bot events, so Screen core and Moments go first and feeds are wired in later. Dropped features are listed in [0010](decisions/0010-scope.md) and, each with its reason, in the summary's [feature map](legacy-inventory/README.md#feature-map).

**Changes of order found by the summary,** flagged for the product owner; the step texts above change only after confirmation (details in [the summary](legacy-inventory/README.md#changes-of-order-flagged)):
- **OC1.** Tournament (step 7) reuses the signup site's code, not the ISC code; step 7 already limits the OK to that author's code, but step 0's postponed item and AGENTS.md still tie it to step 7. Only the Games track waits. *Settled 2026-11-07: the OK is given and the mini tourney is the Finals track's ([0025](decisions/0025-finals-and-games-modules.md)).*
- **OC2.** Step 5's exit "shows on the screen" needs Screen's pizza consumer (step 9). Proposed: step 5's exit becomes "an order runs end to end and publishes `pizza.order.*` events (contract-tested)"; step 6 adds "the bot posts the order" and step 9 adds "the order shows on the screen".
- **OC4.** The bot's alert relay and `/platform status` land in step 8, not step 6.
- **OC6.** The scope of the legacy bot data migration (step 6) depends on the product owner's answer about data held by the signup site.
- **OC7.** The tenancy answers of the summary are inputs to the tenants contract (#48), so they are confirmed before #48 starts.
- **OC8.** The bot's tournament side (step 6) needs the tournament API and events of step 7: step 6 builds it against the event catalog (#34) with contract tests, and it goes live with step 7.

## Not scheduled yet
- **Later, or in the backlog** ([0022](decisions/0022-product-vision.md)): a director desk, game-aware voice lobbies, quests, a dry run, one standings table, LFG and casual sessions inside Games; sponsors and a load harness for the large event.
- **Voices** (text to speech, pluggable providers, cached by text; a local provider by default so a small event needs no account). It follows Moments when time allows.

## Open questions
- **Domain and DNS:** who provides the platform domain and a DNS API token for DNS-01 certificates. Blocks HTTPS, #5 and step 2b items 4–5.
- **A separate dev VM before real event data comes to the VM?** To be asked of the hoster then ([0012](decisions/0012-development-on-the-vm.md), [0021](decisions/0021-no-fixed-dates.md)).
- **Cast over a remote VM:** see Parallel tracks.
- **Deploys while tenants are live:** "no deploys while any tenant is live" ([0013](decisions/0013-multi-tenant-core.md), item 22) can block every deploy once live periods overlap; a deploy window or per-tenant pinning beyond the screen bundles (item 23) is not decided yet.
