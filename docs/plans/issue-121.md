# Plan: issue #121 — the bot module and the Discord page

Package `bot-module-discord-page`, branch `121-feat-bot-the-bot`. Step 6, package 1 of the step's order ([step-6-bot.md](../briefs/step-6-bot.md#order-packages-by-dependency-chain)). Sources: the accepted step 6 plan ([step-6-bot.md](../briefs/step-6-bot.md#plan), [decisions.md](../briefs/step-6-bot/decisions.md), the [question bank](../briefs/step-6-bot/questions.md)), mockups [02](../briefs/step-6-bot/02-setup-connect.svg)–[06](../briefs/step-6-bot/06-commands.svg), [13](../briefs/step-6-bot/13-bot-health.svg) and [15](../briefs/step-6-bot/15-edge-states.svg), [bot.md](../../contracts/bot.md) with [bot.openapi.yaml](../../contracts/bot.openapi.yaml), [admin.md](../../contracts/admin.md), [tenants.md](../../contracts/tenants.md), the product owner's three remarks on the issue, the legacy canccubot at `12f2b03`, and main at e265abc. This plan changes no contract and no code.

## Why a plan first
1. **Size.** About 20,000 changed lines (below), five times the package limit of about 4,000. The issue's own Risk line says the lead splits it at its link when it passes the limit; workers do not split issues. Its own two-way split (the module, pool, commands and rights; then the page) still leaves halves of about 14,000 and 6,000 lines. #117 merged whole at 10,900 lines; this is twice that, and it falls apart cleanly at six links, each with its own tests.
2. **What #121 builds on is not on main.** The criteria assume the per-event rights model of [admin.md](../../contracts/admin.md#granting-rights) and [tenants.md](../../contracts/tenants.md#users-roles-and-membership). On main:

   | #121 needs | State on main | Built by |
   |---|---|---|
   | "The event-admin role itself" for every bot write (bot.md, U8) | Admin's sessions carry platform-wide `owner` and `admin` roles (`ROLE_RIGHTS` in `modules/admin/src/canccu_admin/auth.py`); the tenants module keeps `event_admins` but no path tells another module who holds it (`GET /internal/tenants/tenants/{tenant_id}/users/{user_id}` is not served) | #150 (open, blocked), #52 (open, blocked) |
   | Membership: "someone … not a member gets a sign-in link" (U6, U7), "a role grants rights only to people who … joined" | Not served: no `GET /api/tenants/me`, no members | #150 |
   | "Kept by admin as their own source", beside the hand-granted list (D3); presets beside `screen_crew` (U9) | No granted rights at all: `GET`/`PUT /api/admin/rights/{user_id}` and `GET /api/admin/rights/presets` are in the contract only | #223 (open, blocked by #150) |
   | Sessions bound to one event, so "the person's rights" in that event mean something | Sessions are bound to no event until the central sign-in | #52 |
   | The install callback "on the central sign-in host" | Not built; IP mode serves one host | #52 |
   | `tenants.tenant.deleted`, `tenants.user.deleted`, `tenants.tenant.cloned` for the deletion hooks and clone | Catalogued, not emitted yet | #150 |

   Pizza, agenda and notify built over the missing membership behind one seam. #121 can do the same for membership and the callback host, but its rights criteria (D3's second source, the presets, "the person's rights" through the acting token) are the high-risk heart of the issue and need the first source in place. That is the lead's call (Questions 2 and 3).
3. **Contract parts with real design in them.** The acting token is a new way into every module's rights check; the rights source changes how admin computes a session. Both are high risk and deserve an agreed shape before code.

## Proposed contract parts
All additive. Each ships in the link whose code uses it ([0029](../decisions/0029-additive-contracts-ship-with-consumers.md)); none is breaking.

| # | Where | What |
|---|---|---|
| C1 | admin.md | **The acting token.** `POST /internal/admin/acting-tokens` with `{discord_user_id}`, for the request's tenant, callable only with the bot's service identity (any other caller 403 `service_forbidden`). Answers `{token, expires_at}` (60 s), or 404 `no_account` (no user with that Discord id) or 403 `not_a_member`. The token is 32 random bytes, stored only as its SHA-256 with the tenant, the user and the expiry; single tenant, never refreshed. A module accepts it only on a request that also carries the bot's service identity: the kit forwards both to `GET /api/admin/session`, which answers that user's session for that tenant (rights computed as for a cookie session). So a token copied out of a log is useless from a browser, and the bot gains no rights of its own (D2). Audit entries of the call name the person, as for a session |
| C2 | admin.md | **The rights source from Discord roles.** `PUT /internal/admin/rights-sources/discord` (the bot only) with `{discord_user_id, rights, source_version}` for the request's tenant: the full role-derived list for that person, replacing the last. Admin maps the Discord id to its user itself (it holds it on the user row), so the bot never stores a user map; a Discord id with no account, or no member of the event, is refused (404 `no_account`, 403 `not_a_member`) and nothing is kept (B8). A right that is role-only, or not grantable, is refused (400 `right_role_only`), as in a hand grant. A session's rights become role ∪ granted ∪ from-roles. `GET /api/admin/rights/{user_id}` gains `sources: {granted: [...], discord_roles: [...]}`; `admin.rights.changed` gains `source` (`granted` or `discord_roles`). Losing the membership empties both lists. **The sign-in event** `admin.user.signed_in` (tenant-scoped, private; `user_id`, `discord_user_id`, emitted when a session starts for a user with a Discord id) tells the bot to push that person's role-derived list at once (B8) |
| C3 | admin.md | **New presets** beside `screen_crew`: `announcer` (`moments.announce`) and `food_crew` (`pizza.order.manage`, `pizza.record.read`); the ticker stays in `screen_crew`. U9's examples; #122 can add more with its commands |
| C4 | bot.md | **Role mappings.** `GET`/`PUT /api/bot/guild/role-mappings` (`PUT`: the event-admin role, with `revision`): `[{role_id, presets, rights}]`, by role id; `role_name` is read-only and refreshed from Discord. A mapping that names a role-only right, or the guild's `@everyone` role, is 400. `GET` adds per role `holders` and `holders_signed_in` (counts only, E8). Audited; emits `bot.mappings.changed` |
| C5 | bot.md | **Purposes.** A fixed catalogue (`announcements`, `now_and_next`, `food`, `photos`, `crew`, `tournaments`, `match_voice`), each a channel or a role, with its feature flag and template (name, kind, permission overwrites). `GET /api/bot/guild/purposes` (state `bound`, `missing`, `not_on`), `PUT /api/bot/guild/purposes/{purpose}` with a picked id or `null`, `POST /api/bot/guild/purposes/create-missing` (creates channels only while the bot's role is below what a role needs, E3, E6), and `GET /api/bot/guild/channels` and `/roles` for the pick lists, read live from Discord. Purposes move with the binding in a clone. Emits `bot.purposes.changed` (#122's posts follow it) |
| C6 | bot.md | **The check.** `GET /api/bot/guild/check` → per feature, rows of `{need: permission|intent|role_order, where, ok, fix}` (`fix` a whole sentence; `fix_action` when the bot can fix it itself), and `checked_at`; `POST` runs it again |
| C7 | bot.md | **Commands, flags and intents.** The framework's rules (per-guild hash, the flag checked again, deferral, 10 s, idempotency, the private "not on here" and "did not answer in time; nothing was sent" answers), the intents (presence and members, privileged; guild messages, not privileged; never message content, D5), each feed's flag, and the three feed flags in `flags.yaml` (`bot.presence`, `bot.voice`, `bot.messages`, default on). The commands themselves and their flags are added by #122 with their handlers (Question 4). `GET /api/bot/guild/commands` for the Commands tab: the registered set, per flag, with the hash's `registered_at` |
| C8 | packages/ui | **The menu item** `discord` ("Discord", under Admin, `href: /bot/`, rights `bot.connection.read`) in `menu.json` |

## Design (holds for every link)
| # | Decision | Reason |
|---|---|---|
| B1 | **Python on kit-py**, Starlette, Postgres under RLS as `canccu_bot_app`, the kit's outbox and SecretBox (aad `bot:token:<tenant>:<application id>` and `bot:secret:…`, as the kit's README already names) | The legacy is Python; the kit already has secrets, pages and the outbox in Python |
| B2 | **A thin Discord client of our own** (httpx for REST, a websocket client for the gateway), not discord.py | The contract needs per-event queues inside one client, a cap per queue, an invalid-request breaker that stops instead of retrying, and feeds dropped before anything is stored; discord.py has one rate limiter per client, retries 429s itself and caches members and presences of every guild. The legacy's logic is ported, not its discord.py glue. Costs about 900 lines more |
| B3 | **One container** serving the API, the pages and the gateway (O2); each client held through a Valkey lease (`bot:lease:<application id>`, 30 s, renewed every 10 s), so a second container never opens a token twice | O2; bot.md "One client per application" |
| B4 | **The fake Discord** in `canccu_kit.testing.discord`: a REST app and a gateway on websockets, both in-process for unit tests, and the same code as a small container in `deploy/compose.ci.yml` for the stack test and Playwright. It keeps guilds, channels, roles, members and interactions as data, and records every request for transcripts | O3; #122 and #125 reuse it |
| B5 | **Components keep no state:** a custom id `c1.<command>.<step>.<args>.<mac>` (≤ 100 characters), the MAC an HMAC under a key derived from the service key, checked on arrival with an age limit; an old or forged one answers "this button is old, run the command again" | `/finals` item 2; works after a restart and on any container |
| B6 | **Every call to a module** is deferred at once, carries the interaction id as its idempotency key and the acting token (C1), and is answered within 10 s or with E5's sentence | E5, D2 |
| B7 | **The guard** wraps every send: `allowed_mentions` none, except an urgent announcement's picked role for that one send; `strip_foreign_links(text, event_hosts)` for text built from other people's words; a link button keeps its provider's host | Port of `tourney_guard.py`; L3 |
| B8 | **Rights sync** keyed by Discord id (C2): on `GUILD_MEMBER_UPDATE` and in a reconcile every 10 minutes, for people who are signed in. "At sign-in" (D4): admin emits `admin.user.signed_in` and the bot answers with that person's role-derived list (C2), so admin keeps no rights list for anyone who never signed in. A list is dropped when the role, the mapping or the binding goes; the Roles tab shows holders without an account as a count only (E8). Mappings by role id only, so a renamed role changes nothing and a look-alike role grants nothing | D4, U9, E8; the lead's answer 6 |
| B9 | **The Discord page** is server-rendered by the bot module with `canccu_kit.ui` in the shared shell at `/bot/` (Caddy `handle_path /bot/*`), the five tabs as a tab bar on a desktop and one tab menu on a phone, the guided setup as four steps | U10; one look with admin's pages |
| B10 | **The bot's nickname** in each guild is the event's name, set after bind and on a name change; embeds take the event's accent colour from theming's tokens | L6, L8 |
| B11 | **Seams** (the lead's answer 2): the event-admin role is "holds `admin.rights.write`" (today only the owner: fails closed); every signed-in session counts as a member; the install redirect URI is on `CANCCU_SIGNIN_HOSTNAME`, else admin's public origin (the one host in IP mode); tenants' deletion and clone events are handled and tested with delivered events, live once #150 emits them. Each seam is one function, named in the README | As pizza, agenda and notify did for membership |

## Size by area (source plus tests, estimated)
| Area | Estimate |
|---|---|
| A. The fake Discord (REST and gateway) in kit-py, with its own tests | 1,100 |
| B. REST client with per-event queues, buckets and the invalid-request breaker; gateway client with identify, heartbeat, resume, back-off and intents | 1,900 |
| C. The pool, the lease, own clients opened and closed, client status with `bot.client.changed` debounced, health with `checks.discord_shared` | 900 |
| D. The connection API: own applications, the three credential checks, secrets, audit, `bot.connection.changed` | 1,000 |
| E. The bind flow (state, callback, the eight checks in one transaction, the result page), unbind, `bot_removed`, leaving unbound guilds after 15 minutes, the superadmin unbind, archived events, the deletion hooks | 2,000 |
| F. Routing by guild, DMs outside a guild, clone with purposes | 700 |
| G. The module on the stack: migrations, app, config, Dockerfile, Compose, Caddy, stack smoke, README, the global-table allow-list | 900 |
| H. The command framework, `/finals` needs (B5, B6, link buttons with expiry, the provider helper with its per-event bearer secret, errors as replies) and the test command after a simulated restart | 2,300 |
| I. The guard, the nickname and the colour | 400 |
| J. The acting token: admin's endpoint, kit-py and kit-ts accepting it with the bot's identity, the sign-in link replies (U6, U7) | 1,000 |
| K. Rights from roles: mappings, sync, admin's second source and its People column, the presets, audit, rename and look-alike tests | 2,200 |
| L. Purposes and the check: catalogue, templates, pick lists, create what is missing, the check per feature with its fixes | 1,700 |
| M. The Discord page: setup in four steps, five tabs, the phone tab menu, the edge states, the menu item | 2,600 |
| N. Playwright against the fake Discord, screenshots at 1280 and 390 px beside the mockups | 700 |
| O. Contract parts C1–C8 and the catalog | 1,200 |
| **Total** | **≈ 20,000** (±25%) |

## Proposed split (for the lead)
Six links, all high, each one issue and one package; the contract part of each travels with it.

| Link | Content | ≈ Lines | Needs |
|---|---|---|---|
| 1. Clients | A, B, C, G: the module on the stack, the fake Discord, the REST and gateway clients, the pool with its lease, `GET /api/bot/connection` (shared mode), health | 4,500 | — |
| 2. Connection and guild | D, E, F; C7's intents and feed flags | 3,900 | 1 (B11 seams, or #52 and #150) |
| 3. Commands | H, I, J; C1, C7's framework rules; the "not connected" reply's final wording (the product owner's remark on mockup 07) | 4,000 | 2 |
| 4. Rights from roles | K; C2, C3, C4 | 2,500 | 3, and #223 (answer 3) |
| 5. Setup API | L; C5, C6 | 2,000 | 2; parallel with 3 |
| 6. The Discord page | M, N; C8; the "Always on" row (the product owner's remark on mockup 06); `docs/design/widgets.md` saying `in_voice` (the third remark) | 3,300 | 3, 4, 5 |

The issue's criteria map as: the module, the pool, routing, queues, clone, unbind, deletion, health, the lease and the fake Discord → 1 and 2; the command framework, `/finals` needs, the guard, the acting token, nickname and colour → 3; rights from roles → 4; intents → 2 (the feeds) and 3 (the flag checks); events → 1, 2 and 4; clone carries the purposes → 5; the Discord page, Playwright and screenshots → 6; contract parts → each link. #122 and #125 wait for links 1–3 (the framework and the fake Discord), not for the page.

## Answers (the lead, on the plan PR)
1. **Split:** six links, as above. The dispatcher's normal flow splits #121 into them.
2. **Foundations:** the seams of B11. Membership and the callback host get a seam, as pizza did. The event-admin role uses the fail-closed seam, so only the owner writes until #150.
3. **Rights from roles:** link 4 is blocked on #223.
4. **Commands:** #121 builds the framework, a test command and the Commands tab. #122 adds the commands with their flags.
5. **Client (B2):** our own thin client, kept lean: the legacy's logic ported, nothing beyond what bot.md requires.
6. **B8 privacy:** the alternative. Admin emits a sign-in event and the bot answers with that person's role-derived rights, so admin keeps no rights list for people who never signed in (B8, C2). The 10-minute reconcile and `GUILD_MEMBER_UPDATE` stay as they are for people who are signed in.

**Order:** this PR stays the plan, with no code. After it merges, the lead files the six link issues; link 1 starts after step 5's deep review, polish and gate work (#755), and the pace rule caps runs at 1.

## Decisions made
- Plan tier, not feature: the size and the missing foundations above.
- The acting token is accepted only with the bot's service identity beside it, and the rights source is keyed by Discord id inside admin (C1, C2): the bot never holds a user map or a right of its own.
- Mappings by role id only; the role's name is shown, never matched.
- Rights at sign-in come from admin's sign-in event, which the bot answers (B8, answer 6). Admin keeps no role-derived list for anyone who never signed in.
