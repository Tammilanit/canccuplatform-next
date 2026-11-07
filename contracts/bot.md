# Bot contract

The Discord side of the platform. The `bot` module is one module with a pool of Discord clients ([0013](../docs/decisions/0013-multi-tenant-core.md) items 14–16): the shared platform bot serves many events, and an event may bring its own Discord application instead. This part of the contract fixes the **connections**: which client serves an event, how an event binds its Discord server (guild), how slash commands follow the event's feature flags, and how one event's client trouble stays its own. The commands, the gateway data the bot reads and the rest of its events are fixed when canccubot is ported (roadmap step 6) and join this file then.

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

The two route tables are added to the kit's allow-list of global tables ([tenants.md](tenants.md#tables-global-and-per-tenant)) when the module is built. They hold no secret and no tenant data beyond the reference, like hostnames. Everything else the bot stores is per tenant under row-level security.

## The client pool
- **The shared client** runs the shared application. Its id, bot token and client secret come from the environment (`CANCCU_BOT_APPLICATION_ID`, `CANCCU_BOT_TOKEN`, `CANCCU_BOT_CLIENT_SECRET`), never from the database. Every event starts on it (`mode: shared`).
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

- **Bring an own application:** `PUT /api/bot/connection` with `mode: own`, `application_id`, `bot_token`, `client_secret` and `revision`. The module checks the token with Discord before storing anything: it must work (otherwise 400 `token_invalid`) and belong to `application_id` (400 `application_mismatch`). The shared application is refused (409 `application_reserved`), and so is an application another event holds (409 `application_taken`: an event admin there clears it first). Changing the application while a guild is bound is 409 `guild_bound`: unbind first, then bind again with the new application, so the Manage Server proof is made for the application that will serve the guild.
- **Rotate a credential:** the same `PUT` with the same `application_id` and only the credential that changed (the other keeps its stored value). Allowed while bound.
- **Back to the shared bot:** `PUT` with `mode: shared` (also 409 `guild_bound` while bound), or `DELETE /api/bot/connection`, which does the same. The stored credentials are erased, the own client is closed, and the application is free for another event.
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
   - the guild is not bound to another event; otherwise `guild_bound`;
   - the event's connection did not change since the start; otherwise `connection_changed`.
5. **Result:** on success the guild is bound in the event's tenant context and its guild route is written, its commands are registered (below), the bind is audited with the guild, the application and the user, and `bot.guild.bound` is emitted. The browser goes back to the admin pages on the event's primary hostname with `bind=ok`, or `bind=<error code>` on failure, never to a hostname taken from the request; an event with no active primary hostname gets the result on a page of the sign-in host instead. A `state` that is unknown, used or expired gets `state_invalid` on a page of the sign-in host, since it names no event. The user's Discord access token is used for these checks only, then dropped; it is never stored.

- **Unbind:** `DELETE /api/bot/guild` (the event-admin role). The client stops serving the guild, the event's commands are removed from it, the guild route is deleted, the shared bot leaves the guild, and `bot.guild.unbound` is emitted with `reason: unbound`; audited. An own bot stays in the guild (it is the event's application) but serves it no more.
- **The guild removes the bot** (kicked, or the guild deleted): the binding ends the same way with `reason: bot_removed`, audited as a system action. A guild that is only unavailable during a Discord outage stays bound. This is the guild's own way out: whoever holds Manage Server can always end a binding by removing the bot, then bind the guild to another event through the flow.
- **The shared bot added without the flow** (from a plain invite link) stays unbound and leaves the guild after 15 minutes, so it never holds data of a guild that no event chose. An own bot in an unbound guild stays, and its data there is dropped.
- **Superadmin:** `POST /api/bot/guilds/{guild_id}/unbind` with a `reason`, on the superadmin hostname, unbinds any guild (a dispute, an abandoned event); audited with the reason; the event gets `reason: superadmin`.
- **Archived events:** an archived event keeps its binding so the next event of its series can take it over (see Clone), but the bot reads and stores nothing more for it and removes its commands from the guild. Unbinding and clearing the connection still work (they delete data); other writes are 409 `event_archived`.
- **Deleted events and users:** on `tenants.tenant.deleted` the module deletes the event's connection, binding, routes and secrets, closes its own client and the shared bot leaves its guild. On `tenants.user.deleted` it drops the user from `bound_by` and `updated_by`.

The binding (`Binding` in the OpenAPI file): `guild_id`, `guild_name`, `application_id`, `bound_by` (user id or `null`), `bound_at`, and `commands`: `status` (`registered`, `pending`, `failed`, `removed`), `flags_version` they were registered for, `registered_at`, `error_code`.

## Slash commands per guild
- Commands are registered **per guild** only, never globally, so a guild sees only its own event's commands (0013 item 15).
- Each command belongs to one feature flag (`bot.<feature>`, or another module's flag for its commands, such as a pizza command under a pizza flag). The set registered in a guild is exactly the commands whose flags are on for its event, written in one bulk overwrite.
- **Re-registered** on `tenants.flags.changed` for that event, on bind, on a new platform version that changes the commands, when an archived event's commands are removed, and on `POST /api/bot/guild/commands/sync` (the event-admin role) for an admin who wants to retry now.
- **Handlers check the flag too**, at the moment of the interaction: a command registered before a flag went off answers privately that it is not on at this event, and does nothing.
- A failed registration (Discord's daily limit on command writes, a rate limit, a missing `applications.commands` scope) is retried with back-off for that guild only, and shows as `commands.status: failed` with its `error_code`. It never blocks another guild's registration.
- Admin checks happen in the handler with the person's platform rights; Discord's default command permissions are not used for access ([legacy inventory](../docs/legacy-inventory/canccubot.md)).
- The flags and commands themselves are declared here by the port (step 6), additively. Each flag's default is in that list; until then the bot declares no flag.

## Privileged intents and data per event
- Privileged intents (members, presence, message content) are set per application, not per guild (0013 item 16). The shared application holds the union the platform's features need; which ones is decided at the port.
- Each feed of gateway data (presence, members, voice, messages) belongs to a feature flag. The client drops a feed for a guild whose event has that flag off, or that is bound to no event, **before** anything is stored, counted or emitted. The same holds on an own client.
- Members with the presence opt-out are left out of every presence feed ([tenants.md](tenants.md#privacy-and-retention), [events.md](events.md#provisional-events-version-1)).

## Clone
The bot's part of clone-the-last-event ([tenants.md](tenants.md#series-and-clone)): `POST /api/bot/clone` with `source_tenant_id`, on the new event's hostname. It **moves** the source's connection and binding to the new event, so a series keeps its Discord server and its own application without a new install:

- The same check as the tenants clone: the caller holds the event-admin role on both events and both are in one series (otherwise 403 `missing_right`).
- The source must not be `live` (409 `source_live`: an event that is on keeps its bot); a `draft` or `archived` source is fine, and the move counts as the deletion an archived event allows. The new event must not be archived, and must have no binding and no own application of its own (409 `already_connected`).
- The own application's credentials move inside the module, re-encrypted for the new event; they are never returned or sent anywhere. The source falls back to `shared` with no binding.
- The guild keeps the Manage Server proof made when it was bound: the move stays inside one series, by someone who is an event admin of both events.
- Nothing to move is not an error: the answer says what moved (`moved_connection`, `moved_binding`). The new event's commands are registered for its own flags.
- Audited in both events; emits `bot.connection.changed` and `bot.guild.unbound` (`reason: moved`) on the source's stream and `bot.connection.changed` and `bot.guild.bound` on the new event's.

## Rights
`bot.connection.read` (see the connection, the client's status and the binding). Writing the connection, binding, unbinding, syncing commands and cloning need the event-admin role itself (above), not a right. The superadmin's unbind needs the superadmin role.

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Listed in the catalog: [events.md](events.md#bot-connections). On the event's stream `t:<tenant>:events:bot`, with `tenant` set. Events carry ids, never a token, a client secret or a person's Discord id.

| Type | When | Audience | `data` |
|---|---|---|---|
| `bot.connection.changed` | The event's application or a credential changed, also by a clone | system | `mode`, `application_id`, `changed` (field names: `mode`, `application_id`, `bot_token`, `client_secret`), `revision`, `actor_user_id` |
| `bot.client.changed` | The event's client changed status: ready, rate limited, paused, failed, or back. A change of the shared client is emitted for every event on it. Debounced: at most once a minute per event, the last status winning | system | `status`, `error_code` (or `null`), `since` |
| `bot.guild.bound` | A guild was bound to the event, by the install flow or a clone | system | `guild_id`, `guild_name`, `application_id`, `actor_user_id` |
| `bot.guild.unbound` | The event's guild binding ended | system | `guild_id`, `reason` (`unbound`, `bot_removed`, `superadmin`, `moved`, `tenant_deleted`), `actor_user_id` (`null` for `bot_removed`) |

Consumers: admin (the event's bot status), notify (Discord DMs are possible only while a guild is bound and the client is ready, [notify.md](notify.md)).

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e90", "type": "bot.guild.bound", "version": 1,
 "time": "2026-01-01T15:00:00Z", "source": "bot", "tenant": "demo",
 "data": {"guild_id": "100000000000000001", "guild_name": "Demo Community",
   "application_id": "100000000000000002", "actor_user_id": "u_123"}}
```

## Not in this contract
The bot port (step 6): its commands and their flags, the gateway data it reads and which privileged intents the shared application holds, role-to-rights sync, guided guild setup, and the events already outlined in [events.md](events.md#bot). The central sign-in host itself (#52) and the edge Caddy's routes (#51).
