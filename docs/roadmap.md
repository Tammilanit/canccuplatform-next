# Roadmap

The plan from today to the full new platform, running at the next event in **April 2027**. This file is the plan; the decisions behind it are in [`decisions/`](decisions/README.md). Both live only here: when the plan changes, change this file in a PR.

## In short
- **Port, don't rewrite.** Each module is ported from the proven legacy code and tests onto Postgres, containers, the kit and its contract ([0001](decisions/0001-port-dont-rewrite.md)).
- **Multi-tenant from day 1.** Many events, also simultaneous, on one shared stack ([0013](decisions/0013-multi-tenant-core.md)). The tenancy foundation comes before the module contracts.
- **Infrastructure first**, then modules one at a time. While `platform.version` is `dev` and no tenant is live, the shared VM follows main, so the pieces are joined every day, not at the end.
- **Dependencies set the order; two dates are fixed:** the freeze from 2027-03-01 (fixes only, a dress rehearsal and the switch) and the event in April 2027. The event pins a tested release.
- Each step is an epic in this repo with one child issue per module it touches (AGENTS.md, Maintainers).

## Goals and non-goals
- **Goals:** run any event from one profile (configuration, not code); work at both ends, from a handful of friends to a large event with several screens; fewer manual steps on the day; keep what worked (pizza end to end, the tournament flow after its fixes, easy setup, a screen anyone can open).
- **Multi-tenant from day 1:** many events, also simultaneous, on one shared stack. Adding an event or a hostname adds rows; it needs no deploy and no restart.
- **Non-goals for this round:** payments, public results, a hot standby.
- **Users:** the organizer (runs the event and admin), the players (register, play, see scores), the venue crew (screens, network, hardware), and the superadmin who operates the shared stack for several organizers.

## How the system fits together
- **The platform runs on a hosted VM away from the venue**, not on a venue host ([0011](decisions/0011-hosting-on-remote-vm.md)). One VM runs one shared stack: one container per module, one Postgres, one Valkey and one edge Caddy. Every event is a tenant in it.
- **Attendees and the projector PC reach the VM over the internet** through the venue's uplink. The VM sees the whole venue as one public address, so **HTTPS with a real domain is required** for every page and for sign-in. Events at the same venue share that address, so the per-venue check for screens is in the app, not the firewall ([0013](decisions/0013-multi-tenant-core.md), item 33).
- **The venue uplink is a dependency.** When it drops, screens keep showing their last state and assets, and admin shows them as offline.
- **The projector is a venue PC** running a full-screen browser on `/screen` and sending picture and sound over HDMI. The VM serves web pages only and never drives a display.
- **The fallback laptop is the only on-site copy:** the event repo, images downloaded in advance, the separately kept secrets key and `deploy/.env`, and a restore of the latest backup, started with one command.
- **Modules talk through their API and the bus.** Example: Pizza publishes `pizza.order.placed`, Moments ranks it against other moments, Screen shows it and Voices can speak it. Nothing polls.

## Order and dates
- **Steps follow their dependencies,** not a strict one-after-another rule. An issue starts when the issues it is blocked by are closed, so issues from different steps can run at once. The tracker's blocked-by links are the source for the order; this file names them.
- **The tracker:** each step is an epic in the milestone of the same number (milestones have no due dates); its epic closes when its children close. Step 2 is one milestone with the epics #36, #46 and #47.
- **Step 0's product-owner tasks** (#43, #44, #45) run alongside and block only the issues that name them: #43 (domain) blocks #5 and #51; #44 (test Discord) blocks #10 and #52; #45 (backup target) blocks #55.
- **The parallel tracks** (Games, Cast; milestone "Parallel tracks") start after the tenancy foundation (#47).
- **Only two dates are fixed:** the freeze from **2027-03-01** (fixes only; every PR needs a maintainer's accept, [0016](decisions/0016-merge-policy.md)) and the event in **April 2027**. What is not merged before the freeze waits for a later release.

## Steps

### 0. Prep
- **Goal:** everything the first steps need from outside the code.
- **In it:**
  - done: the GitHub organization with this public repo and a private event repo; code surveys of the legacy repos and the porting plan (see Porting plan below); the hosted VM with Tailscale and a firewall; parallel workers, one worktree per issue;
  - open: a test Discord server and a dev bot with its own Discord app (#44, blocks #10); the platform domain and a DNS API token for DNS-01 certificates (#43, blocks HTTPS and #5); a backup target off the VM (#45, blocks 2b item 8);
  - postponed: the mini-tourney author's OK to port the ISC-licensed code, until the tournament and games ports (step 7 and the Games track); ask before step 2b closes, so the Games track does not wait for it.
- **Exit criteria:** workers run in parallel in one repo; the VM is reachable; the test Discord server and dev bot exist; the domain decision is made.
- **Issues:** product-owner tasks #43, #44, #45 (each in the milestone of the step it blocks; see Order and dates).

### 1. Skeleton
- **Goal:** infrastructure first: a stack that starts, deploys itself and has an admin page.
- **In it:** the monorepo; Compose with Postgres, Valkey and Caddy; kit-ts and kit-py; ui; CI with branch rules and the merge queue; the admin API and profile contract; admin settings, health view and profile save and load; setup (install, boot survival, firewall, the demo event); demo-stack CI with screenshots and image builds; Discord sign-in, first-run code and rights; auto-deploy of main to the VM.
  - #12 is re-scoped for the shared stack: the firewall covers IPv6 and port 443 and can later open 80/443 to everyone; `new-event` becomes "seed the demo tenant" once the tenants module exists (tenants themselves are rows created through the tenants module).
  - #5 changes: the VM is remote, so sign-in needs HTTPS on a real hostname. The old check "does Discord accept plain http to a LAN IP" and the venue router's DNS-rebinding check no longer apply. #5 and #10 build sign-in so that it fits the central sign-in host of step 2b ([0013](decisions/0013-multi-tenant-core.md), item 10) instead of being redone there.
  - #14 changes: auto-deploy holds while any tenant is live, except hotfixes ([0013](decisions/0013-multi-tenant-core.md), item 22).
- **Exit criteria:** change a setting on the VM and see a test module's health. Signing in over HTTPS is an exit criterion of step 2b, because it needs the domain, the edge Caddy and the central sign-in host.
- **Issues:** epic #15. Closed: #2, #3, #4, #6, #7, #8, #9, #11. Open: #12 and #13 (ready); #10 (blocked by #44); #5 (blocked by #10 and #43); #14 (blocked by #12). Also in the milestone: #39 (merge-policy rollout) and #44.

### 2. Event catalog and contracts
The contracts step. Its dependencies: the tenants contract (#48) waits for the legacy inventory (#46); the event catalog (#34) waits for #48; the screen contract (#35) waits for #34 and #48. Both contracts must be tenant-aware.

#### 2a. Legacy inventory
- **Goal:** know exactly what is being ported, confirmed by the product owner, before tenancy and contracts are designed.
- **In it:** one inventory per legacy repo (they can run in parallel), then a summary. For each repo: features, data model (what is per event and what is global), bus events and APIs, external integrations (Discord, feeds, devices), config and env, tests, size, event-specific content, the target module and step, and what is dropped.
- **Exit criteria:** the scrubbed per-repo inventories and the summary `docs/legacy-inventory/README.md` are merged, each confirmed by the product owner; the summary updates the porting plan below; event-specific findings are in the event repo.
- **Issues:** epic #46: per-repo inventories #68–#75 (no blockers, can run in parallel), then the summary #76 (blocked by #68–#75).

#### 2b. Tenancy foundation
- **Goal:** every later module is tenant-aware from its first line ([0013](decisions/0013-multi-tenant-core.md)).
- **In it**, each its own child issue; the blocked-by links set the order (#49, #53 and #54 wait for #48; #50 for #48 and #49; #51 for #50 and #43; #52 for #50, #51 and #44; #55 for #50 and #45; #56 for #49 and #50):
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
- **Goal:** the events modules exchange, named and outlined before the ports start.
- **In it:** event names and payload outlines for pizza, tournament, bot and screen overrides (#34); the screen module API and events (#35), with device tokens, the venue IP check, devices (global rows with their current tenant) and per-tenant zones and assignments, layouts as data and pinned bundles; it uses the theming contract from 2b item 7. #34 also settles whether screen overrides are `moments.*` or `screen.*` events, since Moments ranks them ([0010](decisions/0010-scope.md)), so step 4 needs no breaking rename. Each other module's full contract is its own PR at the start of its port, written from the real legacy API.
- **Exit criteria:** catalog and screen contract merged, both tenant-aware.
- **Issues:** epic #36: #34 (blocked by #48), then #35 (blocked by #34 and #48).

### 3. Screen core incl. PPTX
- **Goal:** the projector PC plays a Main screen from the VM, and an event can run several screens.
- **In it:** port the canccusignage core: scheduler and windows, playlists, playback timing and bookmarks, validators, duration parsers, the asset pipeline with PowerPoint rendering as a separate render-job container, the kiosk player and a new Postgres schema. Rewritten: the screen page and snapshot serving, persistence, the admin UI (its view-models kept). Screens cache their last state and assets. Feeds are wired later (step 9).
  - **Devices**, owned by Screen: a global device row holds only its name, a hash of its device token, its venue id (the venue is read through the tenants API) and its current tenant. A device serves one tenant at a time: the superadmin or the venue owner sets its current tenant (audited), and a tenant's zone assignment is valid only while that matches. Two simultaneous events at one venue use different devices. Zone assignment and health are per tenant (`tenant_id`, RLS). Paired once, with a revocable device token; a screen is served only with **both** its token and a request from its event's venue IP (the IP alone is never enough), unless the tenant's audited emergency switch has turned the IP check off.
  - **Zones** per event (for example main hall, café, stage), each with its own layout, playlist and schedule; devices are assigned to zones per event and reassigned for the next event.
  - Push to all zones or one zone, and mirror one zone onto others.
  - Device health in admin: online, last seen, now playing.
- **Exit criteria:** the projector PC plays a Main screen from the VM over HTTPS, including a PPTX deck, and keeps showing it when the uplink is cut; a second device in another zone plays its own playlist; a device with a valid token outside the venue IP is refused; a device whose current tenant is another event is refused; admin shows both devices' health.
- **Issues:** epic #57; children are written when the step starts, after #35.

### 4. Moments
- **Goal:** one queue decides what the screens show and play, and when.
- **In it:** port the directive ranking and the sound engine as their own module: takeovers, blocks, overlays and the sound budget. Moments runs on the server, so every screen gets the same thing and a reload loses nothing.
- **Exit criteria:** a test event takes over the screen and plays sound within the budget.
- **Issues:** epic #58.

### 5. Pizza
- **Goal:** the quick proof of the port model.
- **In it:** port the pizza router and its tests; events `pizza.order.*`; a transaction for claims; a scheduler for reminders.
- **Exit criteria:** an order runs end to end and shows on the screen.
- **Issues:** epic #59.

### 6. Bot
- **Goal:** the Discord side of the platform comes from the new bot.
- **In it:** port canccubot: storage on Postgres, presence, voice, game and stats; polls dropped. One bot module with a pool of clients: the shared platform bot, or a tenant's own token. Slash commands registered per guild from feature flags. Events, and role-to-rights sync. Contract first.
  - The legacy bot data migration into its event's tenant is built here and tested on a copy of the legacy data ([0004](decisions/0004-nothing-migrated.md)); step 11 only runs it at the switch.
- **Exit criteria:** dashboard data and rights come from the new bot on the test server; the legacy bot data migration passes its test on a copy of the legacy data.
- **Issues:** epic #60.

### 7. Tournament
- **Goal:** a tournament runs on the platform.
- **In it:** port the scoring, leaderboard and final from the signup site's code; registration lives inside the module; the bot's voice-channel handshake goes through events; concurrency with row locks (`SELECT … FOR UPDATE`). Ported only after the mini-tourney author's OK (AGENTS.md, Porting).
- **Exit criteria:** a test tournament runs end to end.
- **Issues:** epic #61.

### 8. Admin operations
- **Goal:** the crew sees problems and fixes them from admin.
- **In it:** port canccumanager: debounce, alerts as events consumed by the bot, ack and mute, restart policy. The executor is designed first, not ported.
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
  - the admin simplification pass, theme, and Finnish as the first language pack;
  - the reviewer moves to its own OS user that alone holds its token, a privileged-setup task ([0014](decisions/0014-independent-review.md), Known limits);
  - dependency auditing ([0015](decisions/0015-dependency-auditing.md)): `npm audit` and `pip-audit` in CI, and Renovate (or Dependabot) for images and dependencies.
- **Exit criteria:** a restore onto the fallback laptop works from cold and secrets decrypt after the restore; the audit jobs run in CI and update PRs arrive.
- **Issues:** epic #64.

### 11. Freeze, dress rehearsal and switch
- **Goal:** the event runs on a pinned, tested release.
- **In it:**
  - from 2027-03-01 a release branch is cut; from then on fixes only, and every PR needs a maintainer's accept ([0016](decisions/0016-merge-policy.md));
  - a dress rehearsal with the crew on the VM, including a restore onto the fallback laptop;
  - the legacy bot is cut over: the migration built and tested in step 6 runs at the switch and moves its data into its event's tenant, the legacy bot is stopped, and its token moves into the tenant ([0013](decisions/0013-multi-tenant-core.md), Consequences; [0004](decisions/0004-nothing-migrated.md));
  - the switch: the old repos are renamed `-legacy` and archived; this repo takes the name `canccuplatform`.
- **Exit criteria:** the dress rehearsal passed; the bot data was migrated at the switch; the event repo pins a tested release.
- **Issues:** epic #65.

## Parallel tracks
Both are new builds with their own contracts, so neither blocks the main line. They start after the tenancy foundation (#47), so their contracts are tenant-aware from the start.

### Games
- **Goal:** rosters for any game, organized into rounds.
- **In it:** rosters, rounds as data (qualification, quarter-final, semi-final, final), the list of games people play, favourites with a notification when many play one. Based on the mini-tourney code (ISC): bracket engine, rankings and team builder ported; storage, API, auth and frontend rewritten. Ported only after its author's OK; licence and attribution are kept.
- **Exit criteria:** a roster is built and a bracket runs end to end on the demo tenant.
- **Issues:** epic #66.

### Cast
- **Goal:** anyone at the venue casts their screen to the projector.
- **In it:** its own container (MediaMTX over WebRTC), a cast page and hooks.
- **Open:** casting was designed for a VM on the venue LAN. With the VM remote, the stream crosses the uplink twice; latency and bandwidth must be measured before the design is fixed.
- **Exit criteria:** a cast from a venue PC reaches the projector with acceptable delay.
- **Issues:** epic #67.

## Porting plan
From the code surveys of 3 Nov 2026. Each port takes this table as its starting point; the legacy inventory summary (#76) updates it.

| Legacy repo | Port as-is | Port with changes | Rewrite | Drop |
|---|---|---|---|---|
| canccusignage | Scheduler and windows, playback timing and bookmarks, directive precedence, sound engine rules, YouTube, web-asset and replace-plan validators, duration parsers | Directive and ticker model (bands become settings), sound settings, asset pipeline with the PPTX render job | Screen page and snapshot serving, adapter (becomes event consumers), admin UI (view-models kept), all persistence | Auth, runtime/db, supervisor, legacy health, cue migrations, ops scripts |
| the signup site (pizza and tournament parts) | Pizza router and tests | Pizza events, claim transactions, reminder scheduler; tournament scoring, leaderboard, final | Tournament tokens, voice handshake, admin UI; LAN display last | The LAN signup itself (stays outside, [0005](decisions/0005-signup-site-stays-outside.md)) |
| canccubot | Validators, formatters, steam_cover, carousel_photo_naming | Storage logic, presence, voice, game, stats, tournament pure parts, ticker schedule | Runtime and config, pizza cog, signage client, alerts | Polls, worker stub, integration tests, help_cog |
| canccumanager | Debounce state machine, log redaction | Health parse, poller, alerts (its tests as the spec), restart policy | DB layer, executor, log sources | Heartbeat to the signup site |
| thefinals_mini_tourney (ISC) | Bracket engine, rankings, team builder | Service layer on Postgres transactions | Storage, API, auth, frontend | Shared admin password |

Order rationale: Screen consumes pizza, tournament and bot events, so Screen core and Moments go first and feeds are wired in later. Dropped features are listed in [0010](decisions/0010-scope.md).

## Not scheduled yet
- **Voices** (text to speech, pluggable providers, cached by text; a local provider by default so a small event needs no account). It follows Moments when time allows.

## Open questions
- **Domain and DNS:** who provides the platform domain and a DNS API token for DNS-01 certificates. Blocks HTTPS, #5 and step 2b items 4–5.
- **A separate dev VM before the freeze?** To be asked of the hoster before the freeze ([0012](decisions/0012-development-on-the-vm.md)).
- **Cast over a remote VM:** see Parallel tracks.
- **Deploys while tenants are live:** "no deploys while any tenant is live" ([0013](decisions/0013-multi-tenant-core.md), item 22) can block every deploy once live periods overlap; a deploy window or per-tenant pinning beyond the screen bundles (item 23) is not decided yet.
