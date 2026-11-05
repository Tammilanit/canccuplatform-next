# Roadmap

The plan from today to the full new platform, running at the next event in **April 2027**. This file is the plan; the decisions behind it are in [`decisions/`](decisions/README.md). Both live only here: when the plan changes, change this file in a PR.

## In short
- **Port, don't rewrite.** Each module is ported from the proven legacy code and tests onto Postgres, containers, the kit and its contract ([0001](decisions/0001-port-dont-rewrite.md)).
- **Multi-tenant from day 1.** Many events, also simultaneous, on one shared stack ([0013](decisions/0013-multi-tenant-core.md)). The tenancy foundation comes before the module contracts.
- **Infrastructure first**, then modules one at a time. While `platform.version` is `dev` and no tenant is live, the shared VM follows main, so the pieces are joined every day, not at the end.
- **All feature work, Hardening included, is done by end of February 2027.** March is the freeze (from 2027-03-01): fixes only, a dress rehearsal and the switch. The event pins a tested release.
- Each step is an epic in this repo with one child issue per module it touches (AGENTS.md, Maintainers).

## Goals and non-goals
- **Goals:** run any event from one profile (configuration, not code); work at both ends, from a handful of friends to a large event with several screens; fewer manual steps on the day; keep what worked (pizza end to end, the tournament flow after its fixes, easy setup, a screen anyone can open).
- **Multi-tenant from day 1:** many events, also simultaneous, on one shared stack. Adding an event or a hostname adds rows; it needs no deploy and no restart.
- **Non-goals for this round:** payments, public results, a hot standby.
- **Users:** the organizer (runs the event and admin), the players (register, play, see scores), the venue crew (screens, network, hardware), and the superadmin who operates the shared stack for several organizers.

## How the system fits together
- **The platform runs on a hosted VM away from the venue**, not on a venue host ([0011](decisions/0011-hosting-on-remote-vm.md)). One VM runs one shared stack: one container per module, one Postgres, one Valkey and one edge Caddy. Every event is a tenant in it.
- **Attendees and the projector PC reach the VM over the internet** through the venue's uplink. The VM sees the whole venue as one public address, so **HTTPS with a real domain is required** for every page and for sign-in.
- **The venue uplink is a dependency.** When it drops, screens keep showing their last state and assets, and admin shows them as offline.
- **The projector is a venue PC** running a full-screen browser on `/screen` and sending picture and sound over HDMI. The VM serves web pages only and never drives a display.
- **The fallback laptop is the only on-site copy:** the event repo, images downloaded in advance and a restore of the latest backup, started with one command.
- **Modules talk through their API and the bus.** Example: Pizza publishes `pizza.order.placed`, Moments ranks it against other moments, Screen shows it and Voices can speak it. Nothing polls.

## Timeline
The months fit the order into the time left. Fixed: steps 9 and 10 finish by 2027-02-28, and March is the freeze.

| Step | When | Epic |
|---|---|---|
| 0. Prep | Nov 2026 | — |
| 1. Skeleton | Nov 2026 | #15 |
| 2. Event catalog and contracts (inventory → tenancy → contracts) | Nov–Dec 2026 | #36; tenancy epic to be created |
| 3. Screen core incl. PPTX | Dec 2026–Jan 2027 | — |
| 4. Moments | Jan 2027 | — |
| 5. Pizza | Jan 2027 | — |
| 6. Bot | Feb 2027 | — |
| 7. Tournament | Feb 2027 | — |
| 8. Admin operations | Feb 2027 | — |
| 9. Feeds and LAN display | Feb 2027 | — |
| 10. Hardening | Feb 2027 (done by 2027-02-28) | — |
| 11. Freeze, dress rehearsal and switch | Mar 2027 (from 2027-03-01) | — |
| The event | Apr 2027 | first real run |

Games and Cast run in parallel from step 2, after the tenancy foundation (see Parallel tracks).

## Steps

### 0. Prep
- **Goal:** everything the first steps need from outside the code.
- **In it:**
  - done: the GitHub organization with this public repo and a private event repo; code surveys of the legacy repos and the porting plan (see Porting plan below); the hosted VM with Tailscale and a firewall; parallel workers, one worktree per issue;
  - open: a test Discord server and a dev bot with its own Discord app (blocks #10); the platform domain and a DNS API token for DNS-01 certificates (blocks HTTPS and #5);
  - postponed: the mini-tourney author's OK to port the ISC-licensed code, until the tournament and games ports (step 7 and the Games track).
- **Exit criteria:** workers run in parallel in one repo; the VM is reachable; the test Discord server and dev bot exist; the domain decision is made.
- **Issues:** none (maintainer tasks).

### 1. Skeleton
- **Goal:** infrastructure first: a stack that starts, deploys itself and has an admin page.
- **In it:** the monorepo; Compose with Postgres, Valkey and Caddy; kit-ts and kit-py; ui; CI with branch rules and the merge queue; the admin API and profile contract; admin settings, health view and profile save and load; setup (install, boot survival, firewall, the demo event); demo-stack CI with screenshots and image builds; Discord sign-in, first-run code and rights; auto-deploy of main to the VM.
  - #12 is re-scoped for the shared stack: the firewall covers IPv6 and port 443 and can later open 80/443 to everyone; `new-event` becomes "seed the demo tenant" once the tenants module exists (tenants themselves are rows created through the tenants module).
  - #5 changes: the VM is remote, so sign-in needs HTTPS on a real hostname. The old check "does Discord accept plain http to a LAN IP" and the venue router's DNS-rebinding check no longer apply. #5 and #10 build sign-in so that it fits the central sign-in host of step 2b ([0013](decisions/0013-multi-tenant-core.md), item 10) instead of being redone there.
  - #14 changes: auto-deploy holds while any tenant is live, except hotfixes ([0013](decisions/0013-multi-tenant-core.md), item 22).
- **Exit criteria:** sign in on the VM, change a setting, and see a test module's health. Sign-in over HTTPS on the platform domain completes with step 2b (items 4 and 5).
- **Issues:** epic #15. Closed: #2, #3, #4, #6, #7, #8, #9, #11. Open, in order: #12, #13, #10, #5, #14.

### 2. Event catalog and contracts
The contracts step. Its order is fixed: legacy inventory, then the tenancy foundation, then the event catalog and the screen contract, because both contracts must be tenant-aware.

#### 2a. Legacy inventory (task)
- **Goal:** know exactly what is being ported before tenancy and contracts are designed.
- **In it:** for each legacy repo: features, data model (what is per event and what is global), bus events and APIs, external integrations (Discord, feeds, devices), config and env, tests, size, event-specific content, the target module and step, and what is dropped.
- **Exit criteria:** a scrubbed `docs/legacy-inventory.md` is merged; event-specific findings are in the event repo.
- **Issues:** to be created (one issue).

#### 2b. Tenancy foundation
- **Goal:** every later module is tenant-aware from its first line ([0013](decisions/0013-multi-tenant-core.md)).
- **In it**, in this order, each its own child issue:
  1. the tenants contract (first): registry, hostnames, admins and roles, networks, settings, feature flags, lifecycle, audit log, and `tenant` in the bus envelope;
  2. kit tenancy: tenant context, row-level security helpers, scoped Valkey keys, streams and files, a migration lint and leak-test helpers;
  3. the tenants module;
  4. the edge Caddy with a wildcard certificate (DNS-01) and on-demand TLS behind an `ask` endpoint;
  5. the central sign-in host;
  6. bot connections in the bot contract (shared bot and own tokens);
  7. the theming contract;
  8. backups off the VM.

  Then the admin module's single-event tables are reworked for tenants.
- **Exit criteria:** two demo tenants run on one stack, each on its own hostname over HTTPS; CI proves no data crosses between them (RLS lint and leak tests); a backup lands off the VM.
- **Issues:** epic to be created; the domain decision (step 0) blocks items 4 and 5.

#### 2c. Event catalog and screen contract
- **Goal:** the events modules exchange, named and outlined before the ports start.
- **In it:** event names and payload outlines for pizza, tournament, bot and screen overrides (#34); the screen module API and events (#35), with device pairing tokens, layouts as data, the theming contract and pinned bundles. #34 also settles whether screen overrides are `moments.*` or `screen.*` events, since Moments ranks them ([0010](decisions/0010-scope.md)), so step 4 needs no breaking rename. Each other module's full contract is its own PR at the start of its port, written from the real legacy API.
- **Exit criteria:** catalog and screen contract merged, both tenant-aware.
- **Issues:** epic #36, order #34 → #35.

### 3. Screen core incl. PPTX
- **Goal:** the projector PC plays a Main screen from the VM.
- **In it:** port the canccusignage core: scheduler and windows, playlists, playback timing and bookmarks, validators, duration parsers, the asset pipeline with PowerPoint rendering as a separate render-job container, the kiosk player and a new Postgres schema. Rewritten: the screen page and snapshot serving, persistence, the admin UI (its view-models kept). Screens pair once and get a revocable device token; they cache their last state and assets. Feeds are wired later (step 9).
- **Exit criteria:** the projector PC plays a Main screen from the VM over HTTPS, including a PPTX deck, and keeps showing it when the uplink is cut.
- **Issues:** to be created after #35.

### 4. Moments
- **Goal:** one queue decides what the screens show and play, and when.
- **In it:** port the directive ranking and the sound engine as their own module: takeovers, blocks, overlays and the sound budget. Moments runs on the server, so every screen gets the same thing and a reload loses nothing.
- **Exit criteria:** a test event takes over the screen and plays sound within the budget.
- **Issues:** to be created.

### 5. Pizza
- **Goal:** the quick proof of the port model.
- **In it:** port the pizza router and its tests; events `pizza.order.*`; a transaction for claims; a scheduler for reminders.
- **Exit criteria:** an order runs end to end and shows on the screen.
- **Issues:** to be created.

### 6. Bot
- **Goal:** the Discord side of the platform comes from the new bot.
- **In it:** port canccubot: storage on Postgres, presence, voice, game and stats; polls dropped. One bot module with a pool of clients: the shared platform bot, or a tenant's own token. Slash commands registered per guild from feature flags. Events, and role-to-rights sync. Contract first.
- **Exit criteria:** dashboard data and rights come from the new bot on the test server.
- **Issues:** to be created.

### 7. Tournament
- **Goal:** a tournament runs on the platform.
- **In it:** port the scoring, leaderboard and final from the signup site's code; registration lives inside the module; the bot's voice-channel handshake goes through events; concurrency with row locks (`SELECT … FOR UPDATE`). Ported only after the mini-tourney author's OK (AGENTS.md, Porting).
- **Exit criteria:** a test tournament runs end to end.
- **Issues:** to be created.

### 8. Admin operations
- **Goal:** the crew sees problems and fixes them from admin.
- **In it:** port canccumanager: debounce, alerts as events consumed by the bot, ack and mute, restart policy. The executor is designed first, not ported.
- **Exit criteria:** an alert reaches Discord and can be acked.
- **Issues:** to be created.

### 9. Feeds and LAN display
- **Goal:** live data on the screen.
- **In it:** wire pizza, tournament and bot events into Screen; the LAN display page comes last.
- **Exit criteria:** live data on the Main screen, by end of February 2027.
- **Issues:** to be created.

### 10. Hardening
- **Goal:** the platform survives the event and can be recovered from cold.
- **In it:**
  - backup and restore, the fallback laptop, an outside watchdog with a heartbeat;
  - the admin simplification pass, theme, and Finnish as the first language pack;
  - dependency auditing ([0015](decisions/0015-dependency-auditing.md)): `npm audit` and `pip-audit` in CI, and Renovate (or Dependabot) for images and dependencies.
- **Exit criteria:** by 2027-02-28, a restore onto the fallback laptop works from cold; the audit jobs run in CI and update PRs arrive.
- **Issues:** to be created.

### 11. Freeze, dress rehearsal and switch
- **Goal:** the event runs on a pinned, tested release.
- **In it:**
  - from 2027-03-01 a release branch is cut; March is fixes only, and every PR needs a maintainer's accept ([0016](decisions/0016-merge-policy.md));
  - a dress rehearsal with the crew on the VM, including a restore onto the fallback laptop;
  - the legacy bot is cut over: its data is migrated into its event's tenant and the migration is tested in a crew session, the legacy bot is stopped, and its token moves into the tenant ([0013](decisions/0013-multi-tenant-core.md), Consequences; [0004](decisions/0004-nothing-migrated.md));
  - the switch: the old repos are renamed `-legacy` and archived; this repo takes the name `canccuplatform`.
- **Exit criteria:** the dress rehearsal passed; the bot data migration was tested; the event repo pins a tested release.
- **Issues:** to be created.

## Parallel tracks
Both are new builds with their own contracts, so neither blocks the main line. They start in step 2, after the tenancy foundation (2b), so their contracts are tenant-aware from the start.

### Games
- **Goal:** rosters for any game, organized into rounds.
- **In it:** rosters, rounds as data (qualification, quarter-final, semi-final, final), the list of games people play, favourites with a notification when many play one. Based on the mini-tourney code (ISC): bracket engine, rankings and team builder ported; storage, API, auth and frontend rewritten. Ported only after its author's OK; licence and attribution are kept.
- **Exit criteria:** a roster is built and a bracket runs end to end on the demo tenant.

### Cast
- **Goal:** anyone at the venue casts their screen to the projector.
- **In it:** its own container (MediaMTX over WebRTC), a cast page and hooks.
- **Open:** casting was designed for a VM on the venue LAN. With the VM remote, the stream crosses the uplink twice; latency and bandwidth must be measured before the design is fixed.
- **Exit criteria:** a cast from a venue PC reaches the projector with acceptable delay.

## Porting plan
From the code surveys of 3 Nov 2026. Each port takes this table as its starting point; the legacy inventory (2a) refines it.

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
- **A separate dev VM before the freeze?** To be asked of the hoster nearer March ([0012](decisions/0012-development-on-the-vm.md)).
- **Cast over a remote VM:** see Parallel tracks.
