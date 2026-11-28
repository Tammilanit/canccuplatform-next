# Bot contract

The Discord side of the platform. The `bot` module is one module with a pool of Discord clients ([0013](../docs/decisions/0013-multi-tenant-core.md) items 14–16): the shared platform bot serves many events, and an event may bring its own Discord application instead. This part of the contract fixes the **connections**: which client serves an event, how an event binds its Discord server (guild), how slash commands follow the event's feature flags, and how one event's client trouble stays its own. It also fixes the **counts** the bot keeps of the gateway's feeds and publishes, the **who-plays-what read API**, which serves the names behind the bot's presence counts, the **run-of-show posts** the bot makes on the agenda's `discord_channel`, and the guild's **purposes** with the **setup check**. The event's own **commands** and the **announcement post** join it with #122's link 3 (#850); the gateway data the bot reads, the living messages and the rest of its events join it with the other links of #122 ([docs/plans/issue-122.md](../docs/plans/issue-122.md)).

**Machine-readable API: [bot.openapi.yaml](bot.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Words
- **Application:** a Discord application with a bot user, known by its application id (a snowflake). The **shared application** is the platform's own; an **own application** is one an event brings.
- **Client:** one running connection of one application to Discord (its gateway session, split into shards as Discord requires, and its REST rate limits). There is exactly one client per application.
- **Connection:** an event's choice of application: `shared` or `own`, with the own application's credentials.
- **Binding:** an event's Discord server (guild), served by the event's application.
- **Event** means a tenant, as in [tenants.md](tenants.md#words).

## Tables: global and per tenant
| Table | Scope | Holds |
|---|---|---|
| bot connections | per tenant | `mode`, the own application's id, its encrypted bot token and client secret, the key version, `revision` |
| bot bindings | per tenant | The guild id and name, the application that serves it, who bound it and when, the command registration state |
| bot guild routes | global | Guild id → tenant id and application id. Read before a tenant is set, to route a gateway event or an interaction to its event. A plain tenant reference, nothing else (0013 item 6) |
| bot application routes | global | Own application id → tenant id. Keeps each own application to one event |
| bot provider secrets | per tenant | An outside provider's bearer secret, encrypted (Provider secrets) |
| bot purposes | per tenant | Each purpose's channel or role id in the event's guild (Purposes) |

The two route tables are added to the kit's allow-list of global tables ([tenants.md](tenants.md#tables-global-and-per-tenant)) when the module is built. They hold no secret and no tenant data beyond the reference, like hostnames. Everything else the bot stores is per tenant under row-level security.

## The client pool
- **The shared client** runs the shared application. Its id, bot token and client secret come from the environment (`CANCCU_BOT_APPLICATION_ID`, `CANCCU_BOT_TOKEN`, `CANCCU_BOT_CLIENT_SECRET`), never from the database. Every event starts on it (`mode: shared`). A platform may run without one (none of the three set): its health then shows `checks.discord_shared` as `degraded` (`not configured`), and `GET /api/bot/connection` answers an event on the shared bot with 503 `discord_not_configured`.
- **Own clients:** an event with `mode: own` gets a client of its own for its application, opened without a restart when the connection is set, and closed when it is cleared, the event is deleted, or the application moves away.
- **One client per application, everywhere.** The module may run in several containers; each client is held by one container at a time through a lease in Valkey, so the platform never opens one token twice. Never run a legacy bot and the platform on one token at once (0013 item 14): an event taking over a legacy bot's application stops the legacy bot first ([0013](../docs/decisions/0013-multi-tenant-core.md), Consequences).
- **Routing:** every gateway event and interaction is routed by its guild through the guild routes: the guild's event, and only when the guild is bound for the application this client runs. The handler runs in that event's tenant context. A guild bound to no event, or bound for another application, gets nothing stored and no event emitted; an interaction there gets a short private answer that the server is not connected to an event.
- **Outside a guild** (a direct message to the bot): an own application's interactions belong to its event. The shared bot cannot tell the event, so it answers with a short private note and does nothing else.
- **Sending:** everything the bot sends for an event (`notify.dm.requested`, channel posts, voice channels) goes out through that event's client, never another event's.

### One event's trouble stays its own
- **A crash of one client** never stops another. A client that drops its gateway session reconnects by itself, with a growing back-off (from 1 s to at most 5 min). An own client's crash touches only its event. The shared client is one connection, so a Discord outage on it reaches every event on it; that is the reason an event may bring its own application.
- **Errors inside a handler** are caught per interaction and per guild: one event's error or bad data never stops the client or another guild's handling.
- **Rate limits** are per client: Discord counts them per token. On the shared client every event has its own queue of outgoing requests, served in turn, so a burst of one event (a mass of DMs) waits in its own queue and never delays another event's. A queue has a cap; work over it fails with `rate_limited` for that event only, and the requester (Notify, for a DM) falls back by its own rules.
- **Invalid requests:** Discord blocks an IP address that sends too many failing requests (401, 403, 429), which would stop every client on the VM. So a client whose token stops working (`token_invalid`) stops at once and waits for new credentials, and a client that keeps getting such answers pauses itself; neither retries in a loop.
- **Missing intents:** an own application without the privileged intents the event's features need connects without them and reports `intents_missing`; the features that need them stay off until the event admin enables the intents in their application and the client reconnects.
- **Status** is per client and per event (0013 item 28): `GET /api/bot/connection` shows the event's client, and the module's `GET /health` shows the shared client (`checks.discord_shared`) and the number of failing own clients, without naming events. An own client's failure never makes the module `degraded`.

## The event's connection
`GET /api/bot/connection` → `Connection` (right `bot.connection.read`):

| Field | Meaning |
|---|---|
| `mode` | `shared` or `own` |
| `application_id` | The application serving the event: the shared one, or the event's own |
| `bot_user` | `{"id", "name"}` of the application's bot user, as Discord last reported it; `null` before the client first connected |
| `credentials` | For `own`: `{"bot_token_set", "client_secret_set", "updated_at", "updated_by"}`. Never the values; `null` for `shared` |
| `client` | `status` (`connecting`, `ready`, `rate_limited`, `paused`, `failed`), `error_code` (`token_invalid`, `intents_missing`, `invalid_requests`, `discord_unavailable` or `null`), `since` |
| `guild` | The binding (below), or `null` |
| `revision` | +1 on every change, for optimistic concurrency |

- **Bring an own application:** `PUT /api/bot/connection` with `mode: own`, `application_id`, `bot_token`, `client_secret` and `revision`. The module checks both credentials with Discord before storing anything: the token must work (otherwise 400 `token_invalid`) and belong to `application_id` (400 `application_mismatch`), and the client secret must get a client-credentials token for that application (400 `client_secret_invalid`), so a wrong secret fails here, not later in a bind. The shared application is refused (409 `application_reserved`), and so is an application another event holds (409 `application_taken`: an event admin there clears it first). Changing the application while a guild is bound is 409 `guild_bound`: unbind first, then bind again with the new application, so the Manage Server proof is made for the application that will serve the guild.
- **Rotate a credential:** the same `PUT` with the same `application_id` and only the credential that changed (the other keeps its stored value), checked the same way. Allowed while bound.
- **Back to the shared bot:** `PUT` with `mode: shared` (also 409 `guild_bound` while bound), or `DELETE /api/bot/connection?revision=`, which does the same. Both take the `revision` the caller read (409 `version_conflict` when stale), so a clear never erases credentials someone set a moment before, and both are allowed on an archived event, since they delete data. The stored credentials are erased, the own client is closed, and the application is free for another event.
- **Who:** every write needs the **event-admin role** itself, not a granted right: a token decides which application speaks for the event, so it is not handed out with a right. A superadmin in a support window counts as an event admin ([tenants.md](tenants.md#users-roles-and-membership)).
- **Secrets** (0013 item 29): the bot token and the client secret are encrypted at rest with authenticated encryption under the platform's secrets key, which lives in the environment, never in the database. The tenant id and application id are bound into the encryption, so a value copied to another row or event does not decrypt. Each value records its key version, so the key can rotate without downtime. They are write-only: no endpoint, event, log line or audit entry returns or holds them, and the module decrypts them only to open the client or to finish a bind.
- Every change is audited with `POST /internal/tenants/audit` ([tenants.md](tenants.md#audit-log)): which credential changed and who, never the value. Emits `bot.connection.changed`.

## Binding a guild
An event has at most one guild, and a guild belongs to at most one event at a time. Binding needs **Manage Server** on the guild (0013 item 12), proven through Discord's OAuth bot-install flow and checked again by the module.

1. **Start:** an event admin (the role itself) calls `POST /api/bot/guild/bind` with an optional `guild_id` to preselect. The module answers `authorize_url`: Discord's authorize page for the event's application with the scopes `bot`, `applications.commands`, `identify` and `guilds`, the bot permissions the event's features need, the redirect URI on the central sign-in host, and a `state`.
2. **`state`** is random, single-use and valid for 10 minutes. The module keeps it server-side with the event, the caller's user id and the application; the browser carries only the random value.
3. **Discord** shows the person the guilds where they may add the bot (only those where they hold Manage Server), they pick one, and the bot is added.
4. **Callback:** Discord sends the browser to `GET /api/bot/install/callback` on the central sign-in host. One redirect URI serves every event, because Discord allows only about 10 per application (0013 item 10); an own application registers that same URI. The module takes `state`, exchanges the code with the application's client secret, takes the guild from Discord's answer to that exchange (never from the query), and then checks:
   - the Discord user who authorized is the user who started the bind (by the Discord id on their user row); otherwise `discord_user_mismatch`;
   - the user's guild list (`GET /users/@me/guilds` with the user's token) shows them as the guild's owner or with Manage Server or Administrator; otherwise `manage_server_required`. Discord's own check is not trusted alone: the bot may already be in the guild from an earlier binding;
   - the bot is in the guild; otherwise `bot_not_in_guild`;
   - the event still exists; otherwise `state_invalid`;
   - the event is not archived; otherwise `event_archived`;
   - the event still has no guild (another bind may have finished first); otherwise `guild_bound`;
   - the guild is not bound to another event; otherwise `guild_bound`;
   - the event's connection did not change since the start; otherwise `connection_changed`.

   A failed code exchange (a revoked secret, an expired code) is `code_exchange_failed`; the person cancelling on Discord is `access_denied`. The checks and the bind run in one transaction, and both rules are unique keys: one binding per event in the per-tenant bindings table, one route per guild in the global guild routes. So of two binds racing for one event, or for one guild, only one can win; the other gets `guild_bound`.
5. **Result:** on success the guild is bound in the event's tenant context and its guild route is written, its commands are registered (below), the bind is audited with the guild, the application and the user, and `bot.guild.bound` is emitted. The browser goes back to the admin pages on the event's primary hostname with `bind=ok`, or `bind=<error code>` on failure, never to a hostname taken from the request; an event with no active primary hostname gets the result on a page of the sign-in host instead. A `state` that is unknown, used or expired, or whose event was deleted, gets `state_invalid` on a page of the sign-in host (HTTP 400), since it names no event to go back to. The user's Discord access token is used for these checks only, then dropped; it is never stored.

- **Unbind:** `DELETE /api/bot/guild` (the event-admin role). The client stops serving the guild, the event's commands are removed from it, the guild route is deleted, the shared bot leaves the guild, and `bot.guild.unbound` is emitted with `reason: unbound`; audited. An own bot stays in the guild (it is the event's application) but serves it no more.
- **The guild removes the bot** (kicked, or the guild deleted): the binding ends the same way with `reason: bot_removed`, audited as a system action. A guild that is only unavailable during a Discord outage stays bound. This is the guild's own way out: whoever holds Manage Server can always end a binding by removing the bot, then bind the guild to another event through the flow.
- **The shared bot in a guild not bound for it,** however it got there (a plain invite link, a bind that failed, a guild bound to another event's own application), leaves that guild after 15 minutes, so it never holds data of a guild that no event chose for it. An own bot in an unbound guild stays, and its data there is dropped.
- **Superadmin:** `POST /api/bot/guilds/{guild_id}/unbind` with a `reason`, on the superadmin hostname, unbinds any guild (a dispute, an abandoned event); audited with the reason; the event gets `reason: superadmin`.
- **Archived events:** an archived event keeps its binding so the next event of its series can take it over (see Clone), but the bot reads and stores nothing more for it and removes its commands from the guild. Unbinding and clearing the connection still work (they delete data); other writes are 409 `event_archived`.
- **Deleted events and users:** on `tenants.tenant.deleted` the module deletes the event's connection, binding, routes and secrets, closes its own client and the shared bot leaves its guild. It emits nothing then: the event's streams are deleted with it ([tenants.md](tenants.md#privacy-and-retention)). On `tenants.user.deleted` it drops the user from `bound_by` and `updated_by`.

The binding (`Binding` in the OpenAPI file): `guild_id`, `guild_name`, `application_id`, `bound_by` (user id or `null`), `bound_at`, and `commands`: `status` (`registered`, `pending`, `failed`, `removed`), `flags_version` they were registered for, `registered_at`, `error_code`.

## Slash commands per guild
- Commands are registered **per guild** only, never globally, so a guild sees only its own event's commands (0013 item 15).
- Each command belongs to one feature flag (`bot.<feature>`, or another module's flag for its commands, such as a pizza command under a pizza flag), or to none: such a command is on wherever the event has a guild, because its feature has no flag (additive, #850; [Commands](#commands)). The set registered in a guild is exactly the commands whose flags are on for its event, and those with none, written in one bulk overwrite.
- **Written only when it changed:** the bot keeps a hash of the set last written to each guild and writes only a set whose hash differs, so a deploy or a flag change that leaves a guild's set as it was spends nothing of Discord's daily limit on command writes (O4). A failed write forgets the hash, so the next one writes again; `POST /api/bot/guild/commands/sync` writes whatever the hash says, for a guild whose commands someone removed by hand.
- **Re-registered** on `tenants.flags.changed` for that event, on bind, on a new platform version that changes the commands, when an archived event's commands are removed, and on `POST /api/bot/guild/commands/sync` (the event-admin role) for an admin who wants to retry now.
- **Handlers check the flag too**, at the moment of the interaction: a command registered before a flag went off answers privately that it is not on at this event, and does nothing.
- A failed registration (Discord's daily limit on command writes, a rate limit, a missing `applications.commands` scope) is retried with back-off for that guild only, and shows as `commands.status: failed` with its `error_code`. It never blocks another guild's registration.
- Admin checks happen in the handler with the person's platform rights; Discord's default command permissions are not used for access ([legacy inventory](../docs/legacy-inventory/canccubot.md)).
- The commands themselves are declared in [Commands](#commands), each with its flag; the bot declares no flag of its own for them.
- **At start** the bot writes every bound guild's set again, so a version that changes the commands reaches the guilds bound before it; the hash keeps an unchanged set from being written (additive, #850).

## The command framework
How every command answers, whichever feature owns it (step 6, link 3; the commands themselves come with their features).
- **Private and deferred:** every answer is private (only the person sees it). A command, or a button that does not open a form, is deferred at once (Discord shows "thinking…"), so Discord's 3-second limit never decides. A command whose first step is a form (`/announce`) answers with the form at once, since Discord takes no form after a deferral, and makes no call before it (additive, #850).
- **Message commands** (additive, #850): a command may be a message's menu entry ("Send to the screen", in a message's Apps menu): it has a name of words, no description and no options, and its handler gets the message as Discord resolved it. A reply names it in quotes (“Send to the screen”) where it names a slash command `/<command>`. Subcommand groups (`/ticker schedule add`) are a slash command's. The handler then has **10 seconds**; after that the person reads "<event> did not answer in time. Nothing was sent. Try again in a moment." (E5) and the handler is stopped.
- **Idempotent:** every call a command makes to a module carries the interaction id in the header `Idempotency-Key`, so a call that did land is not made twice when the person tries again.
- **As the person:** a command acts in a module only with the person's acting token ([admin.md](admin.md#the-acting-token)), beside the bot's service identity, never with rights of the bot's own. Someone without an account, or no member of the event, gets "Sign in to <event> once to use /<command>. Then your roles bring the rights." with a Sign in link to the event's sign-in page (U6, U7); someone without the right is told which right it needs, in words the command gives it, never a right's id. Admin checks happen there, with the person's platform rights; Discord's own command permissions are not used.
- **The flag again:** a command, or a button of one, whose flag went off answers "/<command> is not on at <event>. Ask the crew; the command goes away within a minute." and does nothing.
- **Components keep no state in the container:** a button, a Yes or No and a form carry what their handler needs in their custom id, signed for the event and dated (`c1.<command>.<step>.<args>.<issued>.<mac>`, at most 100 characters; `<command>` is a message command's short key, such as `screen-send`). What does not fit there (a draft's text, the photo a message became) waits in Valkey per event under a short id, never in the container (additive, #850). They work after a restart and on any copy of the container. One older than 15 minutes, of another event, or forged answers "This button is old. Run the command again."
- **Link buttons:** a link is a button, never a long URL in the text. A link that comes with a provider's `expires_at` lives as long as that: the answer is then edited to "This link has expired. Run /<command> again."; the platform's own links stay.
- **Errors as replies:** a module's or a provider's error code becomes the command's own short sentence, any other refusal "That did not work. Try again later.", a module or provider that does not answer "<event> is not reachable right now. Try again in a moment."; never the raw error.
- **The guard:** every message the bot sends pings nobody (`allowed_mentions` empty), whatever its text holds; the one exception is an urgent announcement's role the event picked, for that send alone (L3). Text built from other people's words keeps only links to the event's own hosts.
- **The event's voice:** the bot's nickname in the event's server is the event's name (at most 32 characters), set after a bind and when the name changes (L6); embeds take the event's Discord embed colour ([theming.md](theming.md)) (L8). Answers are in the person's Discord language when the platform speaks it (`en`, `fi`), otherwise English (U5).
- **Not connected:** an interaction in a server bound to no event answers "This server is not connected to an event yet. Ask an event admin to connect it on the event's Discord page."

### Provider secrets
An outside provider that wants a bearer secret (the standalone Finals app, [finals.md](finals.md)) gets one per event; the platform's own modules take the acting token instead. Which provider an event uses is that feature's setting.
- `PUT /api/bot/providers/{provider}/secret` with `{"secret"}` (1–512 characters) sets it; `DELETE` clears it (also on an archived event). Both 204, the event-admin role itself; an archived event's `PUT` is 409 `event_archived`. `provider` is lowercase `snake_case`, at most 32 characters (otherwise 404).
- Write-only: no read answers it. It is encrypted with the platform secrets key, bound to the event and the provider, and is never in a reply, a log or an event. Audited (`bot.provider_secret.set`, `bot.provider_secret.cleared`) without the value. A deleted event's secrets go with it.

## Commands
The event's own commands (additive, #850; U1, U2, U3, U12, U13, D14, D15 of the [step 6 plan](../docs/briefs/step-6-bot.md#plan), mockups 07 to 09). Each runs on the framework above: private, deferred (or a form at once), as the person through the acting token, its module's error codes in words, every page a link button on the event's primary hostname. English and Finnish.

| Command | Flag | Right (in the module) | What it does |
|---|---|---|---|
| `/food` | `pizza.enabled` | none: a member's read | The orders not over yet (`GET /api/pizza/orders`), each with its pizzeria, state and time, its count, its holder and the person's own pizzas; "Add a pizza" (the first open order's `/pizza/orders/{id}/add`) and "My order" (`/pizza/orders/{id}`), or the Food page (`/pizza/`) |
| `/now` | — | none: a member's read | Now and next from `GET /api/agenda/now`, each item's start in the event's time zone and its place; "Run of show" (`/notify/`) |
| `/hub` | — | — | A line about the hub and "Open the hub" (`/notify/`); calls nothing |
| `/privacy` | — | — | A line about the privacy page and "Privacy page" (`/notify/privacy`); calls nothing |
| `/announce` | — | `moments.announce` | A form (title, at most 60 characters; text, at most 140), then a preview from `POST /api/moments/announcements/preview` with the level (Info, Important, Urgent) and where it goes, then "Send now" (`POST /api/moments/announcements`, now, every zone, all four channels), "Back" (the form again, filled) and "Open the composer" (`/moments/announce`) for zones, a time, an item or a template. A draft is its writer's only and lasts 15 minutes |
| `/ticker set` `text` [`until`] | — | `screen.ticker.write` | `PUT /api/screen/ticker`; `until` is `HH:MM` in the event's time zone, the next time the clock shows it; "Stop now" and "Keep until …" (a form for a new time) |
| `/ticker stop`, `status` | — | `screen.ticker.write` | `DELETE`; `GET` with the windows |
| `/ticker schedule add` `days` `start` `end` `text`, `list`, `remove` `number` | — | `screen.ticker.write` | Screen's weekly windows (`POST`, `GET`, `DELETE /api/screen/ticker/windows`): days as people write them ("Sat and Sun", "fri-sun", "every day", "la ja su"), times `HH:MM` (`24:00` the day's end); `remove` takes the number `list` shows |
| “Send to the screen” (a message's menu) | `screen.photos` | `screen.photos.write` | The message's first picture, fetched only from Discord's file hosts (`cdn.discordapp.com`, `media.discordapp.net`) and at most 20 MB, to `POST /api/screen/photos` with the message id as `source_ref`, its time as `posted_at` and its words (without mention ids or links off the event's hosts) as `caption`; no `author_name`: never a Discord name, and the platform name waits for the bot to know whose account it is (#122's link 2b). "Remove" takes it off again |
| “Remove from the screen” (a message's menu) | `screen.photos` | `screen.photos.write` | `DELETE /api/screen/photos/{id}` of the photo that message became (kept 30 days) |

- **Not before the right:** a person without an account or membership gets the sign-in answer, a person without the right "You need the <right> right for <command>", named Announce, Ticker or Photos.
- **The guard:** every reply pings nobody, and text built from other people's words (a holder's or pizzeria's name, a run-of-show item, the ticker's line, a message's words) keeps no link off the event's hosts.
- **Nothing to the wall by itself** (U13): a picture reaches the photo wall only through “Send to the screen”.

## Purposes
What the bot uses a channel or a role of the event's guild for (step 6, link 5; mockup 03 of the [step 6 brief](../docs/briefs/step-6-bot.md)). A fixed catalogue, each purpose a channel, a category or a role, under its feature's flag, with a template to create it from:

| Purpose | Kind | Flag | Template | The bot needs there |
|---|---|---|---|---|
| `announcements` | channel | — | `announcements`; @everyone may not send | View channel, Send messages, Embed links |
| `now_and_next` | channel | — | `now-and-next`; @everyone may not send | as above, and Pin messages |
| `food` | channel | `pizza.enabled` | `food`; @everyone may not send | as above, and Pin messages |
| `photos` | channel | `screen.photos` | `photos` | View channel, Read message history |
| `crew` | channel | — | `crew`; only the crew role sees it | View channel, Send messages, Embed links |
| `tournaments` | channel | `tournament.enabled` | `tournaments`; @everyone may not send | View channel, Send messages, Embed links |
| `match_voice` | category | `tournament.enabled` | `Match voice` | View channel, Manage channels, Move members |
| `crew_role` | role | — | `Crew` | (role order, below) |
| `attendee_role` | role | — | `Attendee` | (role order, below) |

- **Flags:** a purpose whose flag is off for the event is `not_on`. `tournament.enabled` is the tournament module's (step 7); until it declares it in [flags.yaml](flags.yaml), no event carries it, and a flag the event's context does not carry counts as off.
- **State, read live:** `GET /api/bot/guild/purposes` reads the guild's channels and roles from Discord on each call and answers every purpose `bound`, `missing` (none picked, or the picked one was deleted in Discord: its id stays, E3) or `not_on`. Only the ids are kept, per event; names come from Discord. A purpose's posts go nowhere while it is `missing` (#122).
- **Pick:** `PUT /api/bot/guild/purposes/{purpose}` with `{"target_id"}`, a channel of the purpose's kind (a text or announcement channel, or a category) or a role that is neither `@everyone` nor an integration's own; `null` clears it. `GET /api/bot/guild/channels` and `/roles` are the pick lists, read live.
- **Create what is missing:** `POST /api/bot/guild/purposes/create-missing` makes each purpose that is on and `missing` from its template and binds it: roles first (no permissions of their own), then channels, whose overwrites let the crew role into `crew` and give the bot what it needs there. Discord lets the bot manage only roles below its own, so while a bound role sits at or above the bot's highest role, no role is made, only channels, and the check names the fix (E6). Without Manage roles no role is made, without Manage channels no channel. The answer says what was made and why the rest was not.
- **With the binding:** the purposes belong to the guild: an unbind forgets them, a clone moves them with the binding, a deleted event deletes them.
- **Who:** reading needs `bot.connection.read`, under the event's admin-access rule; picking and creating need the event-admin role itself. Both are audited (`bot.purpose.changed`, `bot.purposes.created`) and emit `bot.purposes.changed`. An archived event's guild is read no more: these paths answer 409 `event_archived`. Discord not answering is 503 `discord_unavailable`.

## The setup check
`GET /api/bot/guild/check` answers, for every feature that is on, what the bot needs in the guild, whether it has it, and one whole sentence that fixes it (mockup 04). `POST` runs it again; `GET` shows the last result for the bound guild (kept a week), or runs it when there is none. Right `bot.connection.read`.

| Feature | Flag | Rows |
|---|---|---|
| `announcements`, `now_and_next`, `food`, `photos`, `crew` | as their purpose | the purpose has a channel; the bot's permissions in it |
| `tournaments` | `tournament.enabled` | the same for `tournaments` and `match_voice` |
| `presence` (who plays what) | `bot.presence` | the application's Presence intent |
| `roles` (rights from roles) | `bot.members` | the application's Server members intent; the bot's role above `crew_role` and `attendee_role` |

- **A row** is `{need, where, ok, missing, fix, fix_action}`: `need` is `purpose`, `permission`, `intent` or `role_order`; `where` names the channel, category, role or application; `missing` lists the permissions the bot lacks there, as Discord names them; `fix` is a whole sentence ("Give the bot “Pin messages” in #food.", "Move the bot's role above Crew in Server settings → Roles."), null when the row is ok. A feature that is off is `not_on` with no rows; otherwise `ok` or `gaps`.
- **Permissions** are computed as Discord does: @everyone and the bot's roles on the server, Administrator holding everything, then the channel's overwrites for @everyone, for the bot's roles and for the bot itself.
- **Intents** come from the application's flags on Discord (full or limited both count). For the shared bot the fix asks the platform's operator; for an own application it names the switch in the Developer Portal.
- **Fixes the bot makes itself** carry `fix_action`: `create_missing` (above), or `allow_in_channel`, when a channel takes from the bot's role what the role holds on the server and the bot holds Manage roles. `POST /api/bot/guild/check/fix` with `{"feature"}` (the event-admin role itself) then gives the bot that permission in its own overwrite in the channel, which outranks its role's, audits it (`bot.check.fixed`) and answers the check run again. A permission the role lacks on the server is a fix in words only: Discord refuses an overwrite granting more than the bot holds.

## Privileged intents and data per event
- Privileged intents (members, presence, message content) are set per application, not per guild (0013 item 16). The shared application holds the union the platform's features need: **presence and members**, never message content (step 6, D5). Every client asks for the intents `GUILDS`, `GUILD_MEMBERS` and `GUILD_PRESENCES` (privileged), `GUILD_VOICE_STATES` and `GUILD_MESSAGES` (not privileged), and never `MESSAGE_CONTENT`: nothing the platform does reads message text. An own application without the two privileged ones in its portal connects without them (Missing intents, above).
- Each feed of gateway data belongs to a feature flag of the event, declared in [flags.yaml](flags.yaml), each on by default:

  | Feed | Gateway events | Flag |
  |---|---|---|
  | Presence | `PRESENCE_UPDATE` | `bot.presence` |
  | Members | `GUILD_MEMBER_ADD`, `GUILD_MEMBER_UPDATE`, `GUILD_MEMBER_REMOVE`, `GUILD_MEMBERS_CHUNK` | `bot.members` |
  | Voice | `VOICE_STATE_UPDATE` | `bot.voice` |
  | Messages | `MESSAGE_CREATE` (in a guild; never its text) | `bot.messages` |

- The client drops a feed for a guild whose event has that flag off, that is archived, or that is bound to no event (or to another application), **before** anything is stored, counted or emitted. The same holds on an own client. A flag the event's context does not carry counts as off.
- Members with the presence opt-out are left out of every presence feed ([tenants.md](tenants.md#privacy-and-retention), [events.md](events.md#provisional-events-version-1)).

## Counts
What the bot keeps of the feeds: **counts, never people** (step 6, D7). Each event's guild is counted once a minute and folded per hour. No person's Discord id, user id or name, and no message text, ever reaches Postgres or the bus; nor does a channel, but for the public voice rooms `bot.voice.counted` names.

- **The live state** is per event in Valkey only (`bot:live:<tenant>:…`): who is a member or a bot, each member's status, their "playing" activities and voice channel, by Discord id, and which channels everyone can see. It follows the gateway (the guild's snapshot on connect, then each feed's events), is written behind every few seconds and read back after a restart. A guild bound after its snapshot came (a bind always is: the bot must be in the guild first), or a guild whose members or presence feed came on since, gets what the snapshot would have brought: its channels and roles read over REST and its members and their presences through a members request (gateway op 8), which a large guild also gets after its snapshot, whose member list names only who is online. It goes when the event is archived or deleted, when the guild is unbound, and a feed's part when its flag goes off.
- **Per minute** (`bot_counts_minute`): `members` (the guild's members without bots), `online`, `idle`, `dnd` (members by status; offline is not counted), `in_voice` (members in any voice channel), `messages` and players per activity (`application_id`, `name`, `players`: "playing" activities only, grouped by name without case or spacing, with the spelling and application id most players carry). A count is `null` while its feed's flag is off. A minute the bot missed while it was down keeps its messages, which are counted in Valkey the moment they come. Minute rows are kept 48 hours.
- **Per hour** (`bot_counts_hour`, `bot_activity_hour`): the averages and the highest minute of the hour's counts, the hour's messages, and per activity its player-minutes and peak. They stay with the event, anonymous, until the event is deleted (tenants.md, Privacy and retention).
- **Chat activity** (step 6, D6 B): a message counts when it is a person's own post (not a bot's, a webhook's or a system message) in a channel everyone in the guild can read: its `@everyone` role, after the channel's overwrite for `@everyone`, holds View channel; a thread when its channel is public and it is not a private thread. The author's id is read only to leave out bots and people who hid; the message's text is never asked for (Privileged intents and data per event).
- **Who is left out:** bots the gateway has named (in a member list, a member or voice event, or the answer to a members request), whatever the feeds' flags, and the members who hid their activity (`presence_opt_out`, tenants.md), from every count, chat activity included, when the count is built: opting out holds from the next minute. Until the tenants module serves the flag (#150) nobody can set it, so the bot's seam `hidden_discord_ids` answers nobody; the bot's README names it and what replaces it. Without the members intent the bot cannot ask for a guild's members, so a bot it has not been told about (offline at a large guild's snapshot) counts like a member until an event names it.
- **Published** (Events, below): `bot.presence.counted`, `bot.activities.counted` and `bot.voice.counted` each minute (`interval_seconds` 60), and `bot.messages.counted` for each hour once it ends (`interval_seconds` 3600). A minute or an hour is counted and published once, also across containers. `bot.presence.counted` and `bot.activities.counted` go while the presence feed is on, `bot.voice.counted` while the voice feed is on (with it off, `in_voice` is 0), and an hour's `bot.messages.counted` when the messages feed counted in it.
- **`GET /api/bot/stats?hours=`** (at most 72, 24 by default): the hourly series (`online`, `online_max`, `in_voice`, `messages`) and the top games by player-hours. Counts only, so a member of the event reads it, and a guest as the info-page mode allows (tenants.md: nothing in a draft event or in `sign_in` mode, only from the venue in `venue_only`), otherwise 403 `info_pages_closed`. A game is named only when its activity matches a game of the event's catalogue (games.md, The catalogue): an activity name is free text a guild member controls (Who plays what). Until the games module serves the catalogue, the list is empty.

## Who plays what
The bus carries presence as counts only ([events.md](events.md#people-in-events)): an event-wide event reaches every consumer, also logs and the screens of other zones. The names behind the counts, who plays which game and who is in which voice channel, are read here, live, by callers allowed to see them: the screen's and the hub's "now playing" boards, LFG, and the players of a game that surges.

- `GET /api/bot/presence/playing?game_id=` → `Playing`: the event's guild members' "playing" activities now, grouped by game, each with its `players`. The bot matches activities to the event's games catalogue by the games contract's rule ([games.md](games.md#the-catalogue)), reading it through the games API and following the `games.game.*` events. An activity whose identifiers belong to a hidden game is left out entirely, neither listed nor counted, so a game a moderator hid never comes back by its activity name ([games.md](games.md#moderation)). Activities that match no game are grouped into one entry with `game_id: null` and `name: null`: an activity name is free text a guild member controls, so it never reaches a board unmoderated (moderators find them in the games module's unmatched list). At most one entry has `game_id: null`, so clients key entries by `game_id`. `game_id` narrows the answer to one game, for a surge or an LFG page.
- `GET /api/bot/presence/voice` → `Voice`: the guild's voice channels with people in them, each with its `member_count` and `members`. Only channels every member of the guild can see are listed; a private channel and who is in it never are.
- **Who may read:** a signed-in member of the event (the hub's attendee session), or a caller with the right `bot.presence.read` (crew; how a screen device's requests carry it is for the screen contract). A guest gets 401 `not_signed_in`, a signed-in non-member 403 `not_a_member`.
- **Only platform users are named.** A player (`Player`) is `user_id` (always set) and `name` (the platform name). A guild member who has not signed in to the platform is counted in `player_count` and `member_count` but never listed: they cannot opt out (the presence opt-out lives on a platform user), and their presence was visible only inside Discord until now. Never a Discord id either: the people reading are attendees, and Discord ids are for modules ([events.md](events.md#people-in-events)).
- **Opted out means absent:** a user with `presence_opt_out` ([tenants.md](tenants.md#privacy-and-retention)) never appears in either list, also when they are playing or in voice, and is not counted in `player_count` or `member_count`. The flag is checked when the answer is built, so opting out takes effect on the next read.
- **Live only:** the bot keeps the current state per event in Valkey, updated from the gateway as it changes, and no history; it is presence data, dropped when the event is archived. The answer's `as_of` says when it was last updated.
- **Not available:** with no guild bound, the client not ready, or the event's feature flag for the presence or voice feed off ([Privileged intents and data per event](#privileged-intents-and-data-per-event)), the answer is 200 with `available: false` and empty lists, so a board shows "not available" rather than "nobody plays".

## Run-of-show posts
The agenda's channel `discord_channel` is the bot's: a post in the event's Discord channel ([agenda.md](agenda.md#notification-channels)). Notify never posts there ([notify.md](notify.md#delivery-rules)).

- **Reminders:** on `agenda.reminder.triggered` the bot posts the item (title, start time in the event's time zone, location) at one of its lead times, not at every one ([agenda.md](agenda.md#reminders)). A delayed item's reminder that fires again posts again, with the new time.
- **Announcements:** on `agenda.item.announced` the bot posts the item with the organiser's `message`, once per announcement.
- **Only where chosen and public:** the bot posts only when the item's `notify_channels` holds `discord_channel`, and only for an item with `visibility: public`. A guild's members are not the event's members, so `attendees` and `crew` items never go to the channel. A `quiet_hours` item is never posted, neither its reminders nor an announcement ([agenda.md](agenda.md#kinds)).
- **Once, through the event's client:** each source event is posted at most once (deduplicated by its `id`). Posts go out through the event's own client and queue ([One event's trouble stays its own](#one-events-trouble-stays-its-own)); with no guild bound, or the client `paused` or `failed`, nothing is posted and nothing is kept for later.

## The announcement post
The Discord channel of Moments' announcements ([moments.md](moments.md#channels-d13-l4); additive, #850; L3 to L5 of the step 6 plan, mockup 08):

- **One message per announcement** sent with `channels.discord`, in the guild's `announcements` purpose, on `moments.announcement.sent`: an embed with the title and the text, the event's colour, and "From the crew · on the screens until HH:MM" (its `expires_at` in the event's time zone; "From the crew" without the screen channel). It never says who sent it (L5).
- **Edited** in place on `moments.announcement.changed` ("Updated HH:MM · from the crew"), and **marked withdrawn** on `.withdrawn`: "Withdrawn: <title>", "This announcement was withdrawn at HH:MM." with Moments' `why` when its item ended it (L4). It is not deleted.
- **Pings:** none, but an urgent one mentions the role the event picked in the setting `announce_role` (none by default), for that send alone; never `@everyone` (L3). An id that is no snowflake, or the guild's own (`@everyone`'s), pings nobody.
- **The guard:** no link off the event's hosts in its title or text.
- **Once:** whatever the number of containers or deliveries, one post per announcement (the post is claimed in Postgres before it goes out). Discord not answering now releases it for the event's next delivery; a post Discord refuses for good (the channel deleted, no access) is dropped and logged. With no guild bound, the purpose `missing` or an archived event, nothing is posted and nothing is kept for later.
- **Kept:** the message id per announcement, with the binding: an unbind, a clone that moves the binding and a deleted event delete them.

## Settings
Per event through the admin settings API (module `bot`; additive, #850): `announce_role` (string, a role id of the event's guild, empty by default): the role an urgent announcement's post mentions (The announcement post).

## Clone
The bot's part of clone-the-last-event ([tenants.md](tenants.md#series-and-clone)): `POST /api/bot/clone` with `source_tenant_id`, on the new event's hostname. It **moves** the source's connection and binding to the new event, so a series keeps its Discord server and its own application without a new install:

- The same check as the tenants clone: the caller holds the event-admin role on both events and both are in one series (otherwise 403 `missing_right`).
- The source must not be `live` (409 `source_live`: an event that is on keeps its bot); a `draft` or `archived` source is fine, and the move counts as the deletion an archived event allows. The new event must not be archived, and must have no binding and no own application of its own (409 `already_connected`).
- The own application's credentials move inside the module, re-encrypted for the new event; they are never returned or sent anywhere. The source falls back to `shared` with no binding.
- **Routing moves with them,** in the same transaction: the guild route's tenant (and application) is rewritten to the new event, and the application route of an own application points to the new event. Otherwise gateway events, interactions and DMs would still go to the source, which reads nothing more. The running client of a moved own application is closed and opened again for the new event (a gap of seconds; the gateway resumes its events); the shared client simply follows the rewritten route.
- The guild keeps the Manage Server proof made when it was bound: the move stays inside one series, by someone who is an event admin of both events.
- Nothing to move is not an error: the answer says what moved (`moved_connection`, `moved_binding`). The new event's commands are registered for its own flags.
- Audited in both events; emits `bot.connection.changed` and `bot.guild.unbound` (`reason: moved`) on the source's stream and `bot.connection.changed` and `bot.guild.bound` on the new event's.

## Rights
`bot.connection.read` (see the connection, the client's status and the binding, the purposes, the pick lists and the check), `bot.presence.read` (read who plays what without being a member of the event). Writing the connection, binding, unbinding, syncing commands, picking and creating purposes, the check's fixes, cloning and a provider's secret need the event-admin role itself (above), not a right. The superadmin's unbind needs the superadmin role.

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Listed in the catalog: [events.md](events.md#bot-connections). On the event's stream `t:<tenant>:events:bot`, with `tenant` set. Events carry ids, never a token, a client secret or a person's Discord id.

| Type | When | Audience | `data` |
|---|---|---|---|
| `bot.connection.changed` | The event's application or a credential changed, also by a clone | system | `mode`, `application_id`, `changed` (field names: `mode`, `application_id`, `bot_token`, `client_secret`), `revision`, `actor_user_id` |
| `bot.client.changed` | The event's client changed status: ready, rate limited, paused, failed, or back. A change of the shared client is emitted for every event on it. Debounced: at most once a minute per event, the last status winning | system | `status`, `error_code` (or `null`), `since` |
| `bot.guild.bound` | A guild was bound to the event, by the install flow or a clone | system | `guild_id`, `guild_name`, `application_id`, `actor_user_id` |
| `bot.guild.unbound` | The event's guild binding ended | system | `guild_id`, `reason` (`unbound`, `bot_removed`, `superadmin`, `moved`), `actor_user_id` (`null` for `bot_removed`) |
| `bot.purposes.changed` | Purposes were picked, cleared or created (Purposes) | system | `purposes` (purpose → channel or role id, or `null` when cleared), `actor_user_id` |
| `bot.presence.counted` | A minute's members by status and in voice (Counts) | event-wide, `public` | `counted_at` (when counted), `interval_seconds` (60), `members`, `online`, `idle`, `dnd`, `in_voice` |
| `bot.activities.counted` | A minute's players per "playing" activity (Counts) | system | `counted_at`, `interval_seconds` (60), `activities` (list of `{application_id` (or `null`), `name`, `players}`, most players first) |
| `bot.voice.counted` | A minute's public voice rooms with people in them (Counts) | event-wide, `public` | `counted_at`, `interval_seconds` (60), `rooms` (list of `{channel_id`, `name`, `member_count}`, busiest first; only rooms everyone in the guild can see) |
| `bot.messages.counted` | An hour's chat activity, once the hour ends (Counts) | event-wide, `public` | `counted_at` (the hour's start), `interval_seconds` (3600), `messages` (the hour's total) |

The bot consumes Moments' `moments.announcement.sent`, `.changed` and `.withdrawn` for its post ([The announcement post](#the-announcement-post)).

Consumers: admin (the event's bot status), notify (Discord DMs are possible only while a guild is bound and the client is ready, [notify.md](notify.md)). `bot.purposes.changed` has none outside the bot yet: its posts (#122) follow it. The counted events: screen (`bot.presence.counted` for its stats and graphs, `bot.voice.counted` for `voice_rooms` and `bot.messages.counted` for chat activity), moments (`bot.presence.counted`) and games (`bot.activities.counted`, for surges). They carry counts only, never who ([events.md](events.md#people-in-events)).

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e90", "type": "bot.guild.bound", "version": 1,
 "time": "2026-01-01T15:00:00Z", "source": "bot", "tenant": "demo",
 "data": {"guild_id": "100000000000000001", "guild_name": "Demo Community",
   "application_id": "100000000000000002", "actor_user_id": "u_123"}}
```

## Not in this contract
The bot port (step 6): which of the event's Discord channels the run-of-show posts go to, which lead time a reminder posts at, and how a post looks; the living messages and DMs (#122's link 4), `/finals` (the Finals track, on the framework above), role-to-rights sync, and the events already outlined in [events.md](events.md#bot). The central sign-in host itself (#52) and the edge Caddy's routes (#51).
