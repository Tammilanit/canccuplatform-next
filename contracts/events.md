# Event catalog

The cross-module events in one place, so a consumer finds what it can subscribe to without reading every contract. Naming, transport and the envelope: [admin.md](admin.md#events); the envelope is not repeated here. Each event's full `data` is in the contract of the module that emits it, linked per section. Modules whose contract is not written yet have provisional outlines here instead ([Provisional events](#provisional-events-version-1)).

- Events are per event (tenant): each goes to the tenant's stream `t:<tenant>:events:<module>` and carries the envelope's `tenant` field ([0013](../docs/decisions/0013-multi-tenant-core.md), item 7; [tenants.md](tenants.md)). The few platform events are the exception (see below).
- Adding an event or a field is additive. Removing or renaming one is breaking ([README.md](README.md#changing-a-contract)).
- **Audience:** each event says whom it concerns: event-wide (with a visibility), personal (it names the platform `user_id`) or system (for modules only; it never reaches people). Notify maps events to notification topics by this, without asking the emitting module ([notify.md](notify.md#topics-and-sources)).

## Tenant in the envelope
The envelope ([admin.md](admin.md#envelope)) gains one field, an additive change: consumers already ignore fields they do not know.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `tenant` | string | for tenant events | The id of the tenant (event) the event concerns, as in [tenants.md](tenants.md#tenants) |

- A **tenant event** concerns one event. It goes to `t:<tenant>:events:<module>`, and `tenant` names the same tenant as the stream. A consumer sets the tenant from `tenant` for each message (0013 item 7) and drops a message whose `tenant` does not match its stream.
- A **platform event** concerns no single event: the creation or deletion of a tenant, hostnames, venues, a user's privacy flags or deletion. It goes to the platform stream `events:<module>` and has no `tenant`. Only the tenants module emits platform events so far; another module needs its contract to say so.
- Consumers learn of a new tenant's streams from `tenants.tenant.created` and start reading them without a restart, from the start of the stream (`0`), not from `$`, so events written before the consumer arrived (such as the first `tenants.admin.added`) are not missed.

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e5f", "type": "admin.settings.changed", "version": 1,
 "time": "2026-01-01T12:00:00Z", "source": "admin", "tenant": "demo",
 "data": {"module": "screen", "keys": ["rotation_seconds"], "settings_version": 4, "actor_user_id": "u_123"}}
```

## Admin
Payloads: [admin.md](admin.md#admin-events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `admin.settings.changed` | A module's settings were written | The module whose settings changed |
| `admin.profile.loaded` | A profile was imported and applied | All modules |
| `admin.profile.saved` | A profile was exported | None required |
| `admin.rights.changed` | A user's rights changed | Every module that caches rights |

## Agenda
Emitter: `agenda`. Audience: event-wide, by the item's `visibility`. Payloads: [agenda.md](agenda.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `agenda.item.added` | An item was added | screen, notify (quiet hours) |
| `agenda.item.changed` | An item was edited or moved | screen, notify (quiet hours) |
| `agenda.item.delayed` | An item was delayed or brought forward | screen, notify, tournament (moves the session of a delayed session item, [agenda.md](agenda.md#tournament-sessions)) |
| `agenda.item.cancelled` | An item was cancelled | screen, notify |
| `agenda.item.removed` | An item was removed | screen, notify (quiet hours) |
| `agenda.item.announced` | An organiser announced an item now, with an optional message | notify (`schedule`), bot (a post in the event's channel, on `discord_channel`) |
| `agenda.item.started` | An item's start was reached | screen, moments |
| `agenda.item.ended` | An item's end was reached | screen |
| `agenda.reminder.triggered` | A lead time before an item's start was reached | bot, screen, notify |
| `agenda.items.cloned` | The agenda was cloned from another event | screen, notify (quiet hours) |
| `agenda.kind.saved` | A kind of the event's kind list was added or changed. Audience: event-wide, `public` | screen, bot, notify (re-read items whose defaults changed) |
| `agenda.kind.removed` | A kind was removed. Audience: event-wide, `public` | screen, bot |

Every item in these events carries `notify_channels`, the channels the organiser chose for it ([agenda.md](agenda.md#notification-channels)); each consumer announces only on its own.

## Bot connections
Emitter: `bot`. Audience: system. Payloads: [bot.md](bot.md#events-version-1). The bot's other events (presence, activities, voice channels) are still provisional: see [Bot](#bot) below.

| Type | Meaning | Consumers |
|---|---|---|
| `bot.connection.changed` | The event's Discord application or a credential changed (never the value) | admin |
| `bot.client.changed` | The event's Discord client changed status (ready, rate limited, paused, failed) | admin, notify (whether a DM can go out) |
| `bot.guild.bound` | A Discord guild was bound to the event | admin, notify |
| `bot.guild.unbound` | The event's guild binding ended | admin, notify |

## Games
Emitter: `games`. Audience: event-wide, `public`. Payloads: [games.md](games.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `games.game.added` | A game was added to the event's catalogue | screen |
| `games.game.changed` | A game was edited, hidden or shown again | screen |
| `games.game.merged` | An event's game was merged into another | notify (moves the follows), screen |
| `games.surge.started` | Players on one game reached the event's threshold | notify (`game` topic), screen (hot-game banner), bot |
| `games.surge.ended` | A surge ended | screen |

Games consumes `bot.activities.counted`, outlined under [Bot](#bot) ([games.md](games.md#surges)).

## Notify
Emitter: `notify`. Audience: personal. Payloads: [notify.md](notify.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `notify.dm.requested` | A notification should reach a user as a Discord DM: the person chose DMs for its topic, or no push reached them | bot |
| `notify.checkin.recorded` | A signed-in attendee checked in by the rotating QR | The module named in `purpose` (tournament for match check-in), admin |

## Screen
Emitter: `screen`. Audience: system, except where noted. Payloads: [screen.md](screen.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `screen.device.paired`, `screen.device.moved`, `screen.device.released`, `screen.device.assigned`, `screen.device.revoked` | A device was paired, given to or taken from the event, assigned to a zone or mirror, or revoked | admin |
| `screen.device.online`, `screen.device.offline`, `screen.device.playing_changed` | Device health for admin | admin |
| `screen.zone.saved`, `screen.zone.removed` | A zone was added, changed or removed | admin, moments (zone targets), agenda (zone keys) |
| `screen.pin.changed` | The event's pinned screen bundle or theme revision changed | theming (keeps the pinned revision) |
| `screen.content.pushed`, `screen.content.cleared` | Content was pushed to zones, or a push ended | admin |
| `screen.ticker.changed` | The ticker text changed. Audience: event-wide, `public` | bot (`/ticker status`), voices |
| `screen.photo.added`, `screen.photo.removed` | A carousel photo was added or removed. Audience: event-wide, `public` | moments |
| `screen.claims.changed` | Where Moments' claims are placed on a zone, and which are unplaced or hidden | moments |
| `screen.render.queued`, `.started`, `.succeeded`, `.failed`, `.cancelled` | A render job (PPTX or PDF deck) moved | admin |

## Tenants
Emitter: `tenants`. Audience: system, except where noted. Payloads: [tenants.md](tenants.md#events-version-1).

On the tenant's stream:

| Type | Meaning | Consumers |
|---|---|---|
| `tenants.tenant.changed` | The event's fields changed (name, time zone, dates, access, venue, series) | All modules (the kit's tenant cache) |
| `tenants.status.changed` | The event went live or was archived | All modules (archived is read-only); notify (deletes its subscriptions and notifications at archiving) |
| `tenants.tenant.cloned` | The tenants part of a clone ran | admin (runs each module's clone) |
| `tenants.flags.changed` | Feature flags were set | All modules; bot (re-registers slash commands) |
| `tenants.venue_info.changed` | The event's venue info changed (also when copied in for a new venue). Audience: event-wide, `public` | screen, notify |
| `tenants.venue_ip_check.changed` | The venue IP check was switched off or on | screen (the kit's tenant cache) |
| `tenants.admin.added`, `tenants.admin.removed` | A user became or stopped being an event admin | Every module that caches rights |
| `tenants.member.joined`, `tenants.member.left` | A user joined or left the event. Audience: personal | notify (members-only delivery), every module that caches membership |
| `tenants.support.opened`, `tenants.support.closed` | A superadmin's support window opened or closed | admin |
| `tenants.retention.reached` | A retention date was reached (`presence`: 30 days after archiving; `personal`: 12 months after archiving) | Every module holding presence or personal data |

On the platform stream `events:tenants`, without `tenant`:

| Type | Meaning | Consumers |
|---|---|---|
| `tenants.tenant.created` | A tenant was created | All modules (start reading its streams) |
| `tenants.tenant.deleted` | A tenant was deleted | All modules (delete its data) |
| `tenants.hostname.changed` | A hostname was added, verified, made primary, held or released | The kit's tenant cache |
| `tenants.venue.changed` | A venue was created, edited or deleted | screen, the kit's tenant cache |
| `tenants.privacy.changed` | A user's privacy flags changed. Audience: personal | Every module holding presence data, moments |
| `tenants.user.deleted` | A user was deleted. Audience: personal | All modules (delete their data) |

## Theming
Emitter: `theming`. Audience: event-wide, `public`. Payloads: [theming.md](theming.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `theming.theme.published` | A theme revision became current: publish, rollback or clone | screen (re-renders by push), the phone hub, bot (embed colour), admin |

## Provisional events (version 1)
The events the first ports need before their modules have a contract: pizza, tournament, bot, and the screen overrides. Each outline gives the name, a one-line meaning, the audience, the expected consumers and the `data` fields, so consumers built earlier (the bot's tournament side in step 6, Screen and Moments, Notify's topics) use the names the module will emit ([roadmap](../docs/roadmap.md), OC8).

- **Provisional:** every event here is `version: 1` and provisional until its module's contract PR adopts it. That contract (`<module>.md`, plus `<module>.openapi.yaml` if the module has an HTTP API) is its own PR at the start of the module's port, written from the real legacy API, and merges before the module's code ([README.md](README.md#changing-a-contract)). It takes over these names and fields and may add events and fields; adding stays additive. Changing or dropping a name or field listed here is done in this catalog first, in its own PR, so nothing built against an outline breaks unseen.
- **Counts** (`pizza_count`, `registered_count`, …) come with the order's or session's revision (`revision`, or `order_revision` / `session_revision` on item and player events). Delivery is at least once ([admin.md](admin.md#transport)), so a consumer ignores counts older than the newest revision it has seen.
- **Fields** are `snake_case`. Ids are strings; times are strings in RFC 3339, UTC (`2026-01-01T18:00:00Z`); Discord ids are strings, since a snowflake does not fit a JavaScript number. A field marked "or null" is always present. `actor_user_id` (string or null) is the user who made the change, `null` when the module's own scheduler did; consumers never show it to people.
- **Shapes** used by several events (Person, Order, Session, Match, Override) are defined once in their section; `data` lists name the shape in the type.
- **Audience** is as above: event-wide with a visibility (`public`, `attendees` or `crew`, as for [agenda items](agenda.md)), personal, or system.
- Examples use the demo event (tenant `demo`, [events/demo](../events/demo/README.md)) and placeholder names and ids; no event, venue, pizzeria, team or Discord id of a real event appears here.

### People in events
A person in a payload is a **Person**:

| Field | Type | Meaning |
|---|---|---|
| `user_id` | string or null | The platform user ([tenants.md](tenants.md#users-roles-and-membership)); `null` for a Discord member who has not signed in to the platform |
| `discord_user_id` | string or null | Their Discord user id, so the bot can mention or DM them; `null` only when the emitter does not know it |
| `name` | string | The name the module shows for them |

At least one of `user_id` and `discord_user_id` is set. The phone hub's people fit this shape as they are:

| Who | `user_id` | `discord_user_id` | Personal events |
|---|---|---|---|
| A signed-in user (every account is a Discord account while `discord` is the only sign-in provider, [tenants.md](tenants.md#sign-in-identities)) | set | set | Yes: Notify (push, inbox, Discord DM) and the bot |
| A Discord member who has not signed in to the platform | `null` | set | Only through the bot (a mention or a channel post); Notify cannot reach them |
| A guest: the hub with an anonymous push subscription and no account | — | — | Never: a guest is not a Person and no event names them. Guests get event-wide notifications only ([notify.md](notify.md#who-can-do-what)) |

- **The link between a user and their Discord id** is the user's `discord` identity in the tenants module, the one place it is kept ([tenants.md](tenants.md#sign-in-identities)). An emitter fills `discord_user_id` from it when it emits (the kit's user cache or `GET /internal/tenants/users/{user_id}`); an event already emitted is never corrected.
- A personal event names the users it concerns at the top of `data`: `user_id` (string, or null for a person without a platform account) for one person, or `user_ids` (list of string, users without a platform account left out) for several. Notify's topic triggers read these as their `recipients` ([notify.md](notify.md#topic-types)), and **Notify resolves everything from them alone**: it never reads a Person, a name or a Discord id from a payload, and takes a user's Discord id for a DM from the tenants module at delivery. The Person objects alongside are for the bot (mentions) and for screens (names).
- An event-wide event may name a person too (the holder of a pizza order); its audience then says who may see that name. User ids and Discord ids are for modules: no consumer shows them to people.
- Presence data ([tenants.md](tenants.md#privacy-and-retention)): the emitter leaves users with `presence_opt_out` out of every presence payload (counts and voice rosters below), so consumers never see them.
- **Who plays what is never on the bus.** An event-wide event reaches every consumer of the event's stream, also logs and the screens of other zones, so presence goes on the bus as counts only (`bot.activities.counted`, `bot.presence.counted`, `games.surge.started`). The names behind them (who plays which game, who is in which voice channel) are served by the bot's read API to callers allowed to see them ([bot.md](bot.md#who-plays-what)). The one exception is `bot.voice_roster.captured`, a system event that answers the tournament's own scoring request.

### Pizza
Emitter: `pizza` (roadmap step 5). The legacy group order, ported as it is ([0022](../docs/decisions/0022-product-vision.md)): one open order at a time per event; people add their pizzas; a holder claims the order, closes it and phones it in. New is `arrived`: the holder marks the pizzas arrived, which feeds the personal part of Notify's `food` topic. Menus, prices, bills and phone numbers never travel in events: they stay in the pizza API and the event's own data.

An **Order**:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The order |
| `seq` | integer | Its number of the day, for people ("order 2") |
| `state` | string | `open` (pizzas can be added), `closed` (no more pizzas; the holder calls), `placed` (phoned in), `arrived`, `cancelled` |
| `pizzeria` | object | `id` (string), `name` (string): the pizzeria the order goes to |
| `target_at` | string, time | When the holder means to call |
| `holder` | Person or null | Who holds the order |
| `pizza_count`, `people_count` | integer | Pizzas in the order, and people with at least one |
| `opened_at`, `closed_at`, `placed_at`, `arrived_at` | string, time, or null | When it reached each state |
| `revision` | integer | Grows with every change, including each pizza added or removed; a consumer keeps the highest it has seen |

| Type | Meaning | Audience | Consumers | `data` |
|---|---|---|---|---|
| `pizza.order.opened` | A group order opened: people can add pizzas | event-wide, `public` | notify (`food`), screen, moments, bot (channel post) | `order` (Order), `actor_user_id` |
| `pizza.order.claimed` | Someone became the holder (a claim, or a take-over of an order nobody held) | event-wide, `public` | screen, bot | `order` (Order), `previous_holder` (Person or null), `actor_user_id` |
| `pizza.order.released` | The holder let go of the order, an admin released it, or it timed out | event-wide, `public` | screen, bot | `order` (Order), `previous_holder` (Person), `reason` (string: `released`, `forced`, `timeout`), `actor_user_id` |
| `pizza.order.closed` | No more pizzas: the holder calls the pizzeria | event-wide, `public` | notify (`food`), screen, bot | `order` (Order), `actor_user_id` |
| `pizza.order.reopened` | A closed order took pizzas again | event-wide, `public` | screen, bot | `order` (Order), `actor_user_id` |
| `pizza.order.placed` | The holder phoned the order in | event-wide, `public` | screen, moments, bot | `order` (Order), `actor_user_id` |
| `pizza.order.reverted` | A step was undone: placed back to closed, or arrived back to placed | event-wide, `public` | screen, bot | `order` (Order), `from_state` (string), `actor_user_id` |
| `pizza.order.arrived` | The holder marked the pizzas arrived | personal (`user_ids`); `order` itself is event-wide, `public` | notify (`food`, personal part), screen, moments, bot | `order` (Order), `user_ids` (list of string), `people` (list of Person): everyone with a pizza in the order |
| `pizza.order.cancelled` | The order was cancelled, also a stale one from an earlier day | event-wide, `public` (`order`); personal (`user_ids`, `people`): everyone with a pizza in it | screen, bot | `order` (Order), `reason` (string: `cancelled`, `stale`), `user_ids` (list of string), `people` (list of Person): everyone with a pizza in it, `actor_user_id` |
| `pizza.item.added` | A person added a pizza to the open order | personal (`user_id`) | screen (counts) | `order_id` (string), `order_revision` (integer), `item_id` (string), `user_id` (string: adding a pizza needs sign-in), `person` (Person), `pizza_count` (integer), `people_count` (integer), `actor_user_id` |
| `pizza.item.removed` | A pizza was taken out of the order, by its owner or the holder | personal (`user_id`) | screen (counts) | `order_id` (string), `order_revision` (integer), `item_id` (string), `user_id` (string: adding a pizza needs sign-in), `person` (Person), `pizza_count` (integer), `people_count` (integer), `actor_user_id` |
| `pizza.reminder.triggered` | An order is overdue: open past `target_at`, or closed but not placed, for `minutes` | event-wide, `public`, like every order event that names the holder | bot (posts in the event's channel, mentioning the holder) | `order` (Order), `kind` (string: `open_past_target`, `closed_not_placed`), `minutes` (integer) |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e70", "type": "pizza.order.opened", "version": 1,
 "time": "2026-01-01T17:00:00Z", "source": "pizza", "tenant": "demo",
 "data": {"order": {"id": "po_1", "seq": 1, "state": "open",
   "pizzeria": {"id": "pz_1", "name": "Demo Pizzeria"}, "target_at": "2026-01-01T18:00:00Z",
   "holder": {"user_id": "u_123", "discord_user_id": "100000000000000001", "name": "Demo Player"},
   "pizza_count": 0, "people_count": 0, "opened_at": "2026-01-01T17:00:00Z",
   "closed_at": null, "placed_at": null, "arrived_at": null, "revision": 1},
  "actor_user_id": "u_123"}}
```

### Tournament
Emitter: `tournament` (roadmap step 7; the bot's side is built in step 6 against these outlines). A **session** is one scheduled game of one of the event's tournaments (a tournament "event" in the legacy code); registration is per session. A **match** is one game played in a session.

- **Scoring is manual** (screenshots and who stayed in the match's Discord voice channels), so the tournament asks nothing of players that scoring does not need. Check-in and matches are both optional.
- **Check-in is optional,** off by default. It is set per tournament (the tournament's `checkin` setting) and may be switched per session; `checkin_enabled` is the value in effect. With it off, the session never reaches `checkin_open`, no `tournament.checkin.*` or `tournament.player.checked_in` event is emitted, `checked_in_count` stays 0, and nobody is a no-show: every registered player plays. With it on, only registrants with a platform account can check in by the QR (it needs sign-in); an admin marks the others present. Check-in can be switched until the session is `running`. Switching it off while the session is `checkin_open` closes check-in with nobody a no-show: the module emits `tournament.checkin.closed` with an empty `no_show_user_ids`, the session goes back to `registration_closed`, and the screen drops the QR on that event as usual.
- **Matches are optional:** by default a session is one game, and the module keeps exactly one match for it, labelled with the game's name, with all its players, so the match events below work the same either way. When a tournament is set up, an organiser may give a session several matches (heats, rounds), session by session, and change them later (while none of them has started); `matches` lists them in play order, and a change emits `tournament.session.changed` with `matches` in `changed`.
- **Sessions feed the run-of-show:** the agenda module follows `tournament.session.added`, `.changed`, `.cancelled` and `.removed` and keeps one item of kind `tournament` per session, so adding, moving or cancelling a session adds, moves or cancels its item and the event's schedule always shows it ([agenda.md](agenda.md#tournament-sessions)). The tournament module never calls the agenda; it moves a session when the agenda delays its item (same section).

A **Session**:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The session |
| `tournament_id` | string | The tournament it belongs to (the id the agenda's `links.tournament_id` names) |
| `game` | object | `id` (string or null: the game in the games catalogue, [games.md](games.md)), `name` (string) |
| `starts_at`, `registration_closes_at` | string, time | Planned start; end of registration |
| `ends_at` | string, time, or null | Planned end, when the organiser set one |
| `status` | string | `scheduled`, `registration_open`, `registration_closed`, `checkin_open` (only with check-in on), `running`, `finished`, `cancelled` |
| `is_final` | boolean | The tournament's final |
| `checkin_enabled` | boolean | Check-in is on for this session: the session's own choice, else the tournament's `checkin` setting (default `false`) |
| `matches` | list of object | `id` (string), `label` (string): the session's matches in play order; exactly one unless the organiser gave it more |
| `voice_plan` | string | `none`, `solo` (one voice channel per player) or `team` (one per team): what the bot creates when a match is called |
| `registered_count`, `checked_in_count` | integer | Players registered, and checked in (0 while check-in is off) |
| `revision` | integer | Grows with every change, including each registration and check-in |

A **Match**:

| Field | Type | Meaning |
|---|---|---|
| `id`, `session_id` | string | The match and its session |
| `label` | string | For people ("Heat 1", "Final") |
| `teams` | list of object | `team_id` (string or null for solo play), `name` (string or null), `user_ids` (list of string), `people` (list of Person) |
| `called_at`, `started_at`, `finished_at` | string, time, or null | When it reached each step |

A **Result** is one placement: `rank` (integer), `team_id` (string or null), `user_ids` (list of string), `people` (list of Person), `points` (integer).

| Type | Meaning | Audience | Consumers | `data` |
|---|---|---|---|---|
| `tournament.session.added` | A session was added to the schedule | event-wide, `public` | screen, bot, agenda (adds the session's item) | `session` (Session), `actor_user_id` |
| `tournament.session.changed` | A session was edited, postponed or reopened, or its matches or check-in changed | event-wide, `public` | screen, bot, agenda (moves the session's item) | `session` (Session), `changed` (list of string: field names), `actor_user_id` |
| `tournament.session.cancelled` | A session was cancelled (`session.status` `cancelled`) or ended early (another status) | event-wide, `public` (`session`); personal (`user_ids`, `people`): its registered players | screen, bot (removes its voice channels, tells its players), agenda (cancels the session's item, or ends it for a session that ended early) | `session` (Session), `user_ids` (list of string), `people` (list of Person): its registered players, `actor_user_id` |
| `tournament.session.removed` | A session was deleted | event-wide, `public` | screen, bot, agenda (removes the session's item) | `session_id` (string), `actor_user_id` |
| `tournament.registration.opened` | Players can register for a session | event-wide, `public` | notify (`tournament`), screen, bot | `session` (Session), `actor_user_id` |
| `tournament.registration.closed` | Registration for a session closed | event-wide, `public` | screen, bot | `session` (Session), `actor_user_id` |
| `tournament.player.registered` | A person registered for a session, or an admin added them | personal (`user_id`) | screen (counts), bot | `session_id` (string), `user_id` (string or null), `person` (Person), `session_revision` (integer), `registered_count` (integer), `actor_user_id` |
| `tournament.player.unregistered` | A person left a session, or an admin removed them | personal (`user_id`) | screen (counts), bot | `session_id` (string), `user_id` (string or null), `person` (Person), `session_revision` (integer), `registered_count` (integer), `actor_user_id` |
| `tournament.checkin.opened` | Only with `checkin_enabled`. Check-in for a session opened: its players check in by the rotating QR (purpose `tournament:<session id>`, [notify.md](notify.md#check-in-by-the-rotating-qr)) | personal (`user_ids`, `people`: each registered player); `session` is event-wide, `public` | notify (`tournament`), screen (shows the QR with `session` only), bot | `session` (Session), `closes_at` (string, time), `user_ids` (list of string), `people` (list of Person) |
| `tournament.player.checked_in` | Only with `checkin_enabled`. A registered player checked in | personal (`user_id`) | screen (counts) | `session_id` (string), `user_id` (string), `person` (Person), `session_revision` (integer), `checked_in_count` (integer) |
| `tournament.checkin.closed` | Only with `checkin_enabled`, or when it was just switched off during check-in (then nobody is a no-show). Check-in closed; who did not check in is a no-show | event-wide, `public` | screen, bot | `session` (Session), `checked_in_user_ids` (list of string), `no_show_user_ids` (list of string) |
| `tournament.match.called` | A match's players are called to play now | personal (`user_ids`: each player of the match), urgent in Notify; `session` and `match`, with the players' names, are event-wide, `public`, as the schedule and results are | notify (`tournament`), bot (creates voice channels by `voice_plan`), moments (screen pin), screen | `session` (Session), `match` (Match), `user_ids` (list of string) |
| `tournament.match.started` | A match started | event-wide, `public` | screen, moments | `session` (Session), `match` (Match), `actor_user_id` |
| `tournament.scoring.started` | An admin started scoring a match; the bot answers with the voice roster | system | bot | `session_id` (string), `match_id` (string), `voice_channel_ids` (list of string) |
| `tournament.match.finished` | A match's results were recorded | event-wide, `public` | screen, moments (finals card when `session.is_final`), bot (posts results, removes the voice channels) | `session` (Session), `match` (Match), `results` (list of Result), `actor_user_id` |
| `tournament.result.corrected` | A recorded result was corrected; the module keeps the audit trail | event-wide, `public` | screen, moments, bot | `session_id` (string), `match_id` (string), `results` (list of Result: the whole new list), `reason` (string), `actor_user_id` |
| `tournament.leaderboard.changed` | The tournament leaderboard changed | event-wide, `public` | screen, moments | `leaderboard_version` (integer), `top` (list of object: `rank` (integer), `person` (Person), `points` (integer), `is_finalist` (boolean)): the first 10 |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e80", "type": "tournament.match.called", "version": 1,
 "time": "2026-01-01T19:45:00Z", "source": "tournament", "tenant": "demo",
 "data": {"session": {"id": "ts_1", "tournament_id": "tn_1", "game": {"id": "g_1", "name": "Demo Game"},
   "starts_at": "2026-01-01T19:30:00Z", "registration_closes_at": "2026-01-01T19:00:00Z",
   "ends_at": "2026-01-01T21:00:00Z", "status": "running", "is_final": false,
   "checkin_enabled": false, "matches": [{"id": "tm_1", "label": "Heat 1"}, {"id": "tm_2", "label": "Heat 2"}],
   "voice_plan": "solo", "registered_count": 2, "checked_in_count": 0, "revision": 6},
  "match": {"id": "tm_1", "session_id": "ts_1", "label": "Heat 1",
   "teams": [{"team_id": null, "name": null, "user_ids": ["u_123"],
              "people": [{"user_id": "u_123", "discord_user_id": "100000000000000001", "name": "Demo Player"}]},
             {"team_id": null, "name": null, "user_ids": ["u_124"],
              "people": [{"user_id": "u_124", "discord_user_id": "100000000000000002", "name": "Demo Player 2"}]}],
   "called_at": "2026-01-01T19:45:00Z", "started_at": null, "finished_at": null},
  "user_ids": ["u_123", "u_124"]}}
```

### Bot
Emitter: `bot` (roadmap step 6). Bot events report what the bot sees on Discord, for the event's bound guild. A bot command that changes another module's data (`/screen announce`, `/ticker set`, tournament admin) is a call to that module's API with the person's rights, not an event: the person gets the answer, and the owning module emits the event. The bot consumes `notify.dm.requested`, `games.surge.started` and the pizza and tournament events above. Its events carry counts, never who: who plays which game and who is in which voice channel are read from the bot's API ([bot.md](bot.md#who-plays-what)). When it answers an event, it sets the envelope's `correlation_id` to that event's `id`.

| Type | Meaning | Audience | Consumers | `data` |
|---|---|---|---|---|
| `bot.activities.counted` | The guild members' "playing" activities, counted every interval: counts only, never who ([games.md](games.md#surges)) | system | games (surges) | `counted_at` (string, time), `interval_seconds` (integer), `activities` (list of object: `application_id` (string or null), `name` (string), `players` (integer)) |
| `bot.presence.counted` | Members online and in voice, counted every interval | event-wide, `public` (counts only) | screen (stats), moments | `counted_at` (string, time), `interval_seconds` (integer), `members` (integer), `online` (integer), `idle` (integer), `dnd` (integer), `in_voice` (integer) |
| `bot.voice_channels.created` | The bot created the voice channels a match asked for (once per match) | system | tournament (keeps the ids), screen (shows the channel names) | `ref` (object: `module` (string), `id` (string): `tournament` and the match id), `channels` (list of object: `channel_id` (string), `name` (string), `team_id` (string or null)) |
| `bot.voice_channels.removed` | The bot disconnected everyone and deleted the channels: the acknowledgement of cleanup | system | tournament | `ref` (object), `channel_ids` (list of string), `reason` (string: `finished`, `cancelled`, `backstop`) |
| `bot.voice_roster.captured` | Who stayed in a match's voice channels and for how long, answering `tournament.scoring.started` (presence data) | system | tournament (fills in placements) | `ref` (object), `captured_at` (string, time), `channels` (list of object: `channel_id` (string), `team_id` (string or null), `members` (list of Person, each with `dwell_seconds` (integer))) |

### Screen overrides
Emitter: `moments` (roadmap step 4). A screen override (a takeover, a block or an overlay) is a `moments.*` event, not a `screen.*` one: Moments ranks the overrides and owns their timing and revert ([0010](../docs/decisions/0010-scope.md)), and an event's first part is its emitter, so the module that decides emits. Step 4 therefore needs no rename.

- **Input:** Moments turns domain events into overrides by its own trigger settings (`pizza.order.placed`, `tournament.match.called`, `games.surge.started`, …), and takes explicit ones through its API (the bot's `/screen announce` and `clear`, and the one announce action of step 4). No other module emits override events.
- **Output:** at most one override of each kind is active on a zone. Screen shows what these events say and ranks nothing. When an override leaves only some of its zones (a higher rank takes one of them), `moments.override.ended` lists just the zones it left and it stays active on the rest. Whether a preempted override comes back afterwards is for the Moments contract. How Screen places an override in a zone's regions is in the screen contract ([screen.md](screen.md#moments-drive-it-claims)); Screen's own events are listed under [Screen](#screen).

An **Override**:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The override |
| `kind` | string | `takeover` (the whole screen), `block` (one region of the layout) or `overlay` (on top, such as a banner) |
| `zones` | list of string | The zones it shows on; empty for every zone of the event |
| `rank` | integer | Higher wins |
| `source` | object | `module` (string), `event_id` (string or null: the domain event that caused it), `ref` (string or null: what it is about, such as a match id) |
| `template` | string | How Screen draws it (`announcement`, `pizza_placed`, `match_called`, `hot_game`, …); the set is fixed by the Moments contract |
| `content` | object | The template's fields (`title`, `body`, `media_url`, `sound`, …) |
| `starts_at`, `ends_at` | string, time; `ends_at` or null | Start and planned end; `null` until someone clears it |

The screen contract adds these optional fields ([screen.md](screen.md#moments-drive-it-claims)), an additive change; Screen handles an Override without them as before.

| Field | Type | Meaning |
|---|---|---|
| `regions` | list of string | Region roles it may claim, in order of preference (the degrade chain, e.g. `["hero", "rail", "ticker"]`); without it derived from `kind` |
| `ttl_seconds` | integer or null | First lifetime: `expires_at` defaults to `starts_at` plus this |
| `expires_at` | string, time, or null | Screen ends it at this time; Moments renews by sending a later one in `.changed`, and `starts_at` never moves |
| `sound` | object or null | `cue`, `url`, `volume` (0–1), `play` (`once`, `loop`) |
| `steps` | list of object or null | A sequence: each `template`, `content`, `duration_ms`, optional `sound` |
| `on_end` | string | What the region shows after it: `resume` (default) or `next` |

| Type | Meaning | Audience | Consumers | `data` |
|---|---|---|---|---|
| `moments.override.started` | An override became active on its zones | event-wide, `public` | screen, voices (may speak it) | `override` (Override), `actor_user_id` |
| `moments.override.changed` | An active override's content or end changed (extended, a live score) | event-wide, `public` | screen | `override` (Override), `changed` (list of string: field names), `actor_user_id` |
| `moments.override.ended` | An override stopped: it expired, a person cleared it, a higher rank took its place, or its source ended | event-wide, `public` | screen, voices | `override_id` (string), `zones` (list of string: the zones it left), `reason` (string: `expired`, `cleared`, `preempted`, `source_ended`), `actor_user_id` |
