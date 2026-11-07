# Notify contract

Notifications to attendees' phones, and the API of the phone hub (a PWA, no store app) that shows them ([0022](../docs/decisions/0022-product-vision.md), the App track). The `notify` module owns both: it serves the hub under `/notify/`, keeps Web Push subscriptions, turns domain events into notifications and delivers them. Notify consumes events; other modules never know about phones, subscriptions or push.

**Machine-readable API: [notify.openapi.yaml](notify.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Tenancy
- Every subscription, preference, notification and check-in belongs to one event, which is one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)). The tenant comes from the request's hostname; a subscription made on one event's hostname never receives another event's notifications.
- Every row carries `tenant_id` under row-level security; the topic registry itself is global (one set of topic types for the platform), while each event's configuration, custom topics, choices and follows carry `tenant_id`. Notify consumes each tenant's streams with the tenant set per message (0013 item 7). Its schedulers (quiet hours, caps, check-in codes) are keyed by tenant.
- Users are global (0013 item 30); a user's subscriptions and preferences are per event.
- **When the event is archived** (the tenants contract's lifecycle), Notify deletes all of its subscriptions, subscription tokens, preferences, channel choices, follows and notifications at once, and stops delivering. Check-ins are presence data and are deleted 30 days after the archive (0022).

## Who can do what
| | Guest (no account) | Signed-in attendee (member of the event) |
|---|---|---|
| Subscribe to push | Event-wide topics | Event-wide and personal topics |
| Choose channels (push, Discord DM) and follow entities such as games | No | Yes |
| Manage the subscription | With its subscription token | With the session, or the token |
| Read notifications | Event-wide ones with `public` audience | Also `attendees` ones and their own personal ones |
| Check in by the rotating QR | No | Yes |
| Privacy: export, delete | Delete the subscription | Export and delete everything Notify holds on them |

Personal topics need sign-in: a guest asking for one gets 401 `sign_in_required`. A guest who signs in later claims the subscription, which then belongs to the user.

- **A guest** is an anonymous push subscription: no user, no Person and never named by an event ([events.md](events.md#people-in-events)), so a guest gets event-wide notifications only.
- **A signed-in attendee** is a user, with or without a Discord account linked. Without one they get everything by push and in the inbox, but no Discord DM (neither by choice nor as fallback); the hub offers `discord_dm` only to users with a linked Discord id.

## Topics and sources
A topic is what an attendee opts into ("Schedule", "Games you follow"). Notify knows no topic in its code: every topic is a **topic type** in the registry below, registered by the module that owns its source events, and Notify turns events into notifications by the registration alone. Adding a topic of any kind is therefore a registration, never a change to Notify.

Each topic type has an event-wide part, a personal part, or both. An attendee opts in per topic and part, per channel ([Per-person channels and follows](#per-person-channels-and-follows)), and on each phone per subscription; the defaults are what a new subscription or a new member gets. Everything is optional per event: an event offers a topic only while it is enabled there (see Per-event configuration).

**The built-in topic types**, each written as a registration (the fields are explained under Topic registry). Event names marked provisional are fixed by the event catalog and each module's contract when they are written; the registrations follow those names, additively.

| Topic | Owner | Part: scope (push, DM by default) | Trigger event | Recipients | Filter, dedupe | Urgent |
|---|---|---|---|---|---|---|
| `schedule` | agenda | event: event (on, off) | `agenda.reminder.triggered` | `data.item.visibility` | kind not `quiet_hours`; `data.lead_minutes` `nearest_in` `data.leads_minutes` to param `lead_minutes` (default 10; on a tie the larger), so an item with leads `[15]` is still announced, at 15, and one with `[]` never | no |
| | | | `agenda.item.delayed`, `agenda.item.cancelled` | `data.item.visibility` | kind not `quiet_hours`; `data.item.starts_at` `within_minutes` 120; dedupe by `correlation_id` and `audience`, so a delay with `following` gives one notification per audience, for the earliest shifted item it may see | no |
| `announcements` | admin (provisional: the announce action, step 4) | event: event (on, off) | the announce action's event (step 4) | its visibility | — | `data.urgent` |
| `food` | pizza | event: event (off, off); personal: user (on, off) | `pizza.order.opened`, `pizza.order.closed` (provisional) | event: `public` | — | no |
| | | | `pizza.order.arrived` (provisional) | personal: `data.user_ids` (each person with a pizza in the order) | — | no |
| `tournament` | tournament | event: event (off, off); personal: user (on, off) | `tournament.registration.opened` (provisional) | event: `public` | — | no |
| | | | `tournament.match.called` (provisional) | personal: `data.user_ids` (each player of the match) | — | yes |
| | | | `tournament.checkin.opened` (provisional) | personal: `data.user_ids` (each registered player) | — | no |
| `play` | games | personal: user (on, off) | `games.session.invited` (provisional) | `data.user_id` | — | no |
| `game` | games | personal: entity `game` (on, off) | `games.surge.started` | followers of `data.game.id` among current members (audience `attendees`, narrower than the event's `public`) | the surge threshold and cool-down are the games module's settings ([games.md](games.md#surges)) | no |
| | | | `games.lfg.opened` (provisional, once LFG exists) | followers of `data.game.id` among current members | — | no |

Every channel list above is `push` and `discord_dm`. Every trigger of `schedule` also carries `channels_field: data.item.notify_channels`, so the organiser's per-item and per-kind channel choice applies ([agenda.md](agenda.md#notification-channels)). The `game` topic follows merges of catalogue entries through `games.game.merged`.

The `schedule` registration in full, as the agenda module sends it:

```json
{"key": "schedule", "owner": "agenda", "title": "Schedule",
 "description": "Reminders, delays and cancellations of the run-of-show",
 "parts": {"event": {"scope": "event", "channels": ["push", "discord_dm"],
                     "defaults": {"push": true, "discord_dm": false}}},
 "params": [{"key": "lead_minutes", "type": "integer", "min": 1, "max": 1440, "default": 10,
             "description": "The reminder lead time that becomes a notification"}],
 "triggers": [
  {"event": "agenda.reminder.triggered", "part": "event", "audience": {"field": "data.item.visibility"},
   "channels_field": "data.item.notify_channels",
   "where": [{"field": "data.item.kind", "op": "ne", "value": "quiet_hours"},
             {"field": "data.lead_minutes", "op": "nearest_in", "list": "data.leads_minutes", "param": "lead_minutes"}],
   "title": "{data.item.title} at {data.item.starts_at|time}", "body": "Starts in {data.lead_minutes} min",
   "url": "/notify/agenda/{data.item.id}", "expires_at": "data.item.starts_at"},
  {"event": "agenda.item.delayed", "part": "event", "audience": {"field": "data.item.visibility"},
   "channels_field": "data.item.notify_channels",
   "where": [{"field": "data.item.kind", "op": "ne", "value": "quiet_hours"},
             {"field": "data.item.starts_at", "op": "within_minutes", "value": 120}],
   "dedupe_by": ["correlation_id", "audience"],
   "title": "{data.item.title} moved", "body": "Now at {data.item.starts_at|time} ({data.minutes|signed} min)",
   "url": "/notify/agenda/{data.item.id}", "expires_at": "data.item.starts_at"},
  {"event": "agenda.item.cancelled", "part": "event", "audience": {"field": "data.item.visibility"},
   "channels_field": "data.item.notify_channels",
   "where": [{"field": "data.item.kind", "op": "ne", "value": "quiet_hours"},
             {"field": "data.item.starts_at", "op": "within_minutes", "value": 120}],
   "title": "{data.item.title} cancelled", "body": "Planned for {data.item.planned_starts_at|time}",
   "url": "/notify/agenda", "expires_at": "data.item.starts_at"}]}
```

**Quiet hours** are not a topic: Notify follows `agenda.item.added`, `.changed`, `.delayed`, `.cancelled` and `.removed` of `quiet_hours` items, and `agenda.items.cloned`, to time them (Delivery rules).

## Topic registry
### Topic types
A topic type (`TopicType` in the OpenAPI file) is a registration:

| Field | Meaning |
|---|---|
| `key` | Lowercase `snake_case`, 1–32 characters. Module keys have no prefix; an event's own topics start with `custom_` (see Custom topics) |
| `owner` | The module that registered it (`admin` for the announce action until step 4 fixes it) |
| `title`, `description` | Text for people; the hub shows them on the preferences page |
| `parts` | `event` and/or `personal`. Each part has a `scope`, the `channels` a person may pick from (`push`, `discord_dm`) and their `defaults`. The event part's scope is always `event`. The personal part's scope is `user` (the trigger event names its recipients) or `entity` (its recipients are the people who follow one entity, for example one game; see Follows) |
| `parts.personal.entity` | For scope `entity`: the entity `type` (e.g. `game`), and optionally `merged` and `removed`: the events that tell Notify an entity was merged into another (`event`, the paths `from` and `into`) or is gone (`event`, the path `id`), so Notify moves or deletes the follows |
| `params` | Parameters an event admin sets per event (`key`, `type`: `integer`, `boolean` or `string`, `default`, and `min` and `max` for integers, `description`). Triggers refer to them as `param` |
| `triggers` | The domain events that create notifications (below) |

Each **trigger** maps one event type to one part:

| Field | Meaning |
|---|---|
| `event` | The event type, as in the event catalog ([events.md](events.md)) |
| `part` | `event` or `personal` |
| `audience` | Event part: `{"field": "<path>"}` naming the event's visibility, or `{"value": "public"}` or `{"value": "attendees"}`. It must be the event's audience as the catalog lists it, or narrower (`attendees` for a `public` event). `crew` and system events never reach phones: Notify drops them before anything else, so they never take a dedupe key either |
| `recipients` | Personal part, scope `user`: `{"user_field": "<path>"}`, a path to a user id or a list of user ids. Recipients resolve from these user ids alone: `null` and unknown ids are dropped, and Notify never reads a Person, a name or a Discord id from the event ([events.md](events.md#people-in-events)); everything else about a recipient (subscriptions, choices, the Discord id for a DM) is looked up by the user id. Scope `entity`: `{"entity_field": "<path>"}`, a path to the entity id, plus `audience` as for the event part: only followers in that audience get it |
| `where` | Conditions that must all hold (below); optional |
| `channels_field` | Optional path to a list of channels in the event (such as the agenda's `notify_channels`). Notify then delivers only on channels in that list |
| `dedupe_by` | Paths whose values make one notification; default the event's `id`. `audience` stands for the audience the notification goes to. Missing values count as the event's `id`. The key is always scoped to the topic (see Dedupe under Delivery rules) |
| `urgent` | `true`, `false` (default) or `{"field": "<path>"}` to a boolean |
| `title`, `body`, `url` | Templates (below). `url` is a page of the hub, relative to the event's hostname |
| `expires_at` or `expires_after_minutes` | A path to a time in the event, or minutes after creation. Default: 12 hours for a personal notification; an event-wide trigger names one |

- **Paths** are dot paths into the envelope: `data.item.kind`, `correlation_id`. A path that is missing makes a condition false and a template value empty.
- **Conditions:** `{"field", "op", ...}` with `op` one of `eq`, `ne`, `in`, `not_in` (against `value`, or `param`), `exists`, `within_minutes` (the time at `field` is at most `value` minutes from now, and not past), `nearest_in` (the number at `field` is the element of the list at `list` nearest to `param`, on a tie the larger).
- **Templates** put values into text with `{<path>}` or `{param.<key>}`, with an optional formatter: `|time` (hours and minutes in the event's time zone), `|date`, `|signed` (+15, −5). Templates are English and are filled in by Notify, so payload rules still hold (Web Push): no text travels through the push service.
- A registration is checked on write: an unknown `op`, formatter, channel or part, a trigger whose part the type lacks, or a template longer than the notification fields allow is 400 `invalid_request`. Notify does not check event names or paths against other contracts; the owner's contract and its review do.

### Registering
- A module registers its topic types at start: `PUT /internal/notify/topic-types/{topic}` with the `TopicType`. The registry is global: a topic type is the same at every event, while its configuration is per event. The call is idempotent; a new version of the module sends its new registration, which replaces the old one. A key registered by another owner is 409 `topic_owned`. Every trigger's `event` must be one the `owner` module emits (its first part equals `owner`); others are 400 `invalid_request`, so a module can only turn its own events into notifications. Notify keeps every registration change (time, owner, old and new registration) in a history it never edits, and logs it. Internal network only, like the tenants module's internal endpoints ([tenants.md](tenants.md#resolving-the-tenant)).
- A module's topic types are part of its contract, listed in the table above or in the module's own contract, and change by the contract rules: adding a topic, part, trigger or parameter is additive; removing one is breaking.
- Notify reads every registration from its store at start, so a module that is down does not take its topics away.

### Per-event configuration
- `GET /api/notify/topic-types` → every topic type with this event's configuration. Right `notify.topics.write`.
- `PUT /api/notify/topic-types/{topic}/config` with `config_version` and any of `enabled`, `params` (values within the type's limits) and `channels` (the subset of the type's channels this event allows). Right `notify.topics.write`. A stale `config_version` is 409 `version_conflict`. Audited ([tenants.md](tenants.md#audit-log)).
- A disabled topic gets no notifications at this event and is not listed in `GET /api/notify/topics`; people's choices for it are kept for when it is enabled again.
- The settings `topics` and `schedule_lead_minutes` (Settings) are the same values as `enabled` and the `schedule` topic's `lead_minutes`, kept for the consumers that use them; writing either way changes both.

### Custom topics
An event admin adds a topic of the event's own by narrowing a registered one, without writing triggers: `PUT /api/notify/topic-types/{topic}` for a key starting with `custom_`, with `based_on` (a module's topic type), `title`, `description`, optional `defaults` per part and channel (a default may be `true` only where the base's default for that part and channel is `true`; anything else is 400 `invalid_request`, so a custom topic never opts people into a channel they did not choose), and `where` conditions that are added to every trigger of the base. Example: "Cosplay", based on `schedule`, where `data.item.kind` `eq` `cosplay`. Right `notify.topics.write`; send `revision` to replace (409 `version_conflict` when stale); `DELETE` removes it and the choices people made for it. Audited.

- A custom topic inherits the base's parts, audiences, recipients, channels, parameters and templates, and its defaults can only switch channels off, so it can only ever reach fewer people, on fewer channels, than its base, never others.
- When a source event matches a recipient through both a custom topic and its base, each topic still creates its own notification (their dedupe keys differ), and the collapse happens per recipient at delivery: a recipient who would get both gets only the custom topic's; everyone who gets only the base's still gets it.

## Per-person channels and follows
- **Channels:** a signed-in attendee picks, per topic and part, whether to get it by `push` and by `discord_dm`, with `PATCH /api/notify/me` (`channels`). Choices left out take the part's defaults. Push also needs the part switched on in the phone's subscription (Web Push), so a phone can be quieter than the person; a guest has only the subscription's switches.
- A notification reaches a person on a channel only when all of these allow it: the topic type's `channels`, the event's configuration, the event's `channels_field` when the trigger names one (for the agenda, the organiser's per-item, per-kind and per-event choice), and the person's own choice. The Discord DM fallback is the one exception: it follows `dm_fallback` (Delivery rules) and is held back only by an explicit choice, not by a default.
- **Follows:** for a topic with an entity-scoped personal part, a member follows entities: `PUT /api/notify/me/follows/{topic}/{entity_id}` (201, or 200 when already followed), `DELETE` (204), and `GET /api/notify/me/follows`. Guests cannot follow (401 `sign_in_required`); a topic without an entity part is 400 `not_followable`; at most 200 follows per person and event (409 `follow_limit`). Notify stores only the id: the owner module's API is where the hub finds the entities and their names, and a follow of an unknown id never matches.
- On the type's `merged` event Notify moves the follows to the entity merged into (one follow when a person followed both); on its `removed` event it deletes them.
- Channels and follows are personal data: they are in the export and gone with `DELETE /api/notify/me` (The hub, Privacy).

## Web Push
- Standard Web Push: subscriptions from the browser's Push API, VAPID ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292)) and encrypted payloads (`aes128gcm`, [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)). The VAPID key pair is one per platform; the private key is a secret in the environment (`CANCCU_NOTIFY_VAPID_PRIVATE_KEY`), never in a setting or the database.
- `GET /api/notify/push-key` → the public key the hub passes to `PushManager.subscribe`.
- **Subscribe:** `POST /api/notify/subscriptions` with `push`, the browser's push subscription (`endpoint` and `keys`), and optionally `preferences` (missing ones take the defaults). With a session the subscription belongs to the user; without one it is a guest subscription. 201 returns the subscription and a `subscription_token`, shown only this once and stored only as a hash. The same `endpoint` subscribed again replaces the old subscription only when the caller owns it (the same user's session, or the old subscription's token); otherwise 409 `subscription_exists`.
- **Manage:** `GET`, `PATCH` (preferences) and `DELETE` (unsubscribe) on `/api/notify/subscriptions/{subscription_id}`, with the owner's session or `Authorization: Bearer <subscription_token>`. Anyone else gets 404 `not_found`.
- **Claim:** `POST /api/notify/subscriptions/{subscription_id}/claim` with a session and the token: the guest subscription becomes the user's, so personal topics can be switched on.
- **Payloads are minimal:** `{"v": 1, "id": "<notification id>", "topic": "<topic>", "urgent": false}`, under 256 bytes. No title, text or names travel through the push service. The hub's service worker loads the details from `GET /api/notify/notifications/{notification_id}` and shows them; if that fails it shows a generic text for the topic.
- `Urgency: high` for urgent notifications, `normal` otherwise; the push `TTL` runs to the notification's `expires_at`.
- When the push service answers 404 or 410, the subscription is gone: Notify deletes it.

## Notifications and the inbox
- A notification has an `id` (random and unguessable, never a sequence), `topic`, `part` (`event` or `personal`), `audience` (`public`, `attendees` or `personal`), `title`, `body`, an optional `url` into the hub, `urgent`, `created_at` and `expires_at`. Event-wide ones expire when what they announce starts or ends; personal ones after 12 hours unless the source says otherwise.
- `GET /api/notify/notifications/{notification_id}`: a `public` one for anyone holding its id whom the event's info-page mode lets in; an `attendees` one only for current members of the event; a personal one only for its user. Otherwise 404 `not_found`.
- `GET /api/notify/inbox?since=` → the caller's notifications that have not expired, newest first: the event-wide ones of the caller's audience (`attendees` only for current members, also when the caller uses the token of a subscription whose user has left the event) and, with a session, their own personal ones. The inbox also holds notifications that were not pushed (cap, quiet hours, a topic part switched off).

## Delivery rules
- **Who gets it:** an event-wide notification goes to every subscription of the event with that topic's event-wide part on (for `attendees`, only subscriptions of current members), and to the members who chose `discord_dm` for it. A personal one goes to its user, or for an entity-scoped part to the followers of the entity, on every channel they allow ([Per-person channels and follows](#per-person-channels-and-follows)).
- **Discord DMs:** Notify emits `notify.dm.requested` and the bot module sends the DM; Notify never talks to Discord. It does so for a person who chose `discord_dm` for the topic and part (`reason: channel`), event-wide notifications included, and as a **fallback** (`reason: fallback`) when a personal notification finds no active push subscription of its user, or every push failed, and both the event's setting `dm_fallback` and the user's own `dm_fallback` are on. A DM needs a Discord id linked to the user: Notify reads it from the tenants module (`GET /internal/tenants/users/{user_id}` or the kit's cache) when it requests the DM, and a user without one gets no DM. The fallback is governed by `dm_fallback` alone, not by the part's `discord_dm` default: it is sent unless the person explicitly set `discord_dm: false` for that topic and part (a choice left out is not an explicit one), or the topic or the event does not allow `discord_dm` at all. A person gets at most one DM per notification. Posts in the event's Discord channels are not Notify's: the bot makes them itself from the source events, on the channel `discord_channel` ([agenda.md](agenda.md#notification-channels)).
- **Info-page mode** ([tenants.md](tenants.md#info-page-mode)) applies to guests as it does to the agenda's `public` items. In mode `sign_in` guests cannot subscribe (403 `info_pages_closed`), and existing guest subscriptions are kept but get no pushes until the mode opens again. In mode `venue_only` guests subscribe and read notification details only from the venue address; pushes still reach them, but off-site the hub cannot load the details and shows the generic text.
- **Quiet hours** are the event's `quiet_hours` items in the run-of-show, and only those: edit them there and Notify follows. They are optional: an event with no such items, or without the kind `quiet_hours`, has no quiet hours, and Notify holds nothing. Quiet hours are active while a scheduled `quiet_hours` item with visibility `public` or `attendees` is running (`starts_at` ≤ now < `ends_at`); `crew` items do not count. Notify keeps these items from the agenda events listed under Topics and sources and times them itself. It reads them again from `GET /api/agenda/items` on start-up, on `agenda.items.cloned` and when `agenda_version` jumps, so a cancelled, removed or moved item ends or moves quiet hours at once, and a restart during quiet hours keeps them. During quiet hours non-urgent pushes and DMs are held. When they end, held notifications that have not expired are sent, at most one per topic per recipient (the newest); the rest stay in the inbox.
- **Hourly cap:** at most `hourly_cap` deliveries (default 6) per recipient in any 60 minutes, pushes and DMs counted together (a push and a DM of the same notification count once); the recipient is the user, or the subscription for a guest. Over the cap a non-urgent notification is neither pushed nor sent as a DM and stays in the inbox. This also keeps the bot within Discord's rate limits.
- **Urgent:** only where the topic's trigger says so. Urgent notifications are pushed during quiet hours and over the cap, and count toward the cap. They never override an opt-out: a topic part or channel switched off gets nothing.
- **Dedupe:** events arrive at least once; Notify creates at most one notification per dedupe key. The key is the topic key plus the trigger's `dedupe_by` values (default the source event's `id`), so two topics, a custom topic and its base included, never share a key. A trigger takes its key only when it actually creates a notification: after the audience check, the `where` conditions and the `channels_field` check (at least one Notify channel left) all pass. So an event that is dropped, for example a running item that a delay with `following` emits first but whose start has passed, leaves the key free for the next shifted item.

## Check-in by the rotating QR
- A door or desk screen shows a QR code that rotates: the URL `/notify/check-in?p=<purpose>&c=<code>`. The code is valid only briefly. Scanning it with the hub proves the attendee is at the venue now; a shared screenshot is useless a minute later.
- `GET /api/notify/check-in/code?purpose=` → `{"purpose", "code", "url", "valid_until", "rotates_at"}`. Right `notify.checkin.display`. Periods are `check_in_rotation_seconds` long (default 30), counted from the Unix epoch. The code for a period is the first 128 bits of HMAC-SHA256, under a per-event key, over the event id, the `purpose` and the period number, written in base64url without padding (22 characters). No code is stored: the server recomputes it.
- **Checking a code:** the server recomputes the code for the given purpose for the current and the previous period. A match is valid. A match for one of the 10 periods before those is 400 `code_expired`; anything else is 400 `code_invalid`. Codes are compared in constant time.
- `purpose` is `arrival` (arriving at the event) or `<module>:<ref>` for a check-in another module owns, for example `tournament:<session id>`.
- `POST /api/notify/check-ins` with `{"purpose", "code"}` (both from the QR) and a session (a member of the event) → 201 with the check-in and emits `notify.checkin.recorded`; the module named in `purpose` acts on it. The same user and purpose again → 200 with the first check-in, no new event. Errors: 400 `code_invalid`, 400 `code_expired`, 401 `not_signed_in`, 403 `not_a_member`.
- `GET /api/notify/check-ins/mine` → the caller's check-ins at this event.
- How a Pulse screen gets the code (a device has no session) is for the screen contract.

## The hub
The hub is a static PWA served by Notify under `/notify/`, reached from the Pulse screen's QR handoff. It holds no data of its own; it reads each module's API with the attendee's session (or none, for a guest).

| The hub shows | For | From |
|---|---|---|
| Now and next, the run-of-show | Guests (`public` items), members (also `attendees` items) | agenda API: `GET /api/agenda/now`, `GET /api/agenda/items` |
| Announcements | Guests and members | The announce action's API (step 4) |
| Notifications, preferences, subscribe and unsubscribe | Guests and members | This API |
| Channels per topic, followed games | Members | This API (`/api/notify/me`, follows); the games for the follow list from the games API ([games.md](games.md)) |
| Your order | Members | The pizza contract: the caller's own orders and their status |
| Your matches, match check-in | Members | The tournament contract: the caller's matches; check-in through `tournament:<ref>` codes here, only for sessions with check-in on ([events.md](events.md#tournament)) |
| Now playing: who plays which game, who is in voice | Members | The bot's read API ([bot.md](bot.md#who-plays-what)); the bus carries only counts |
| Check-in at arrival | Members | This API (`arrival`) |
| Privacy | Members | See below |

**Privacy.** The hub's privacy page:
- **Presence opt-out:** sets the global per-user privacy flag through the tenants API; every module reads it there.
- **Export:** `GET /api/notify/me/export` returns everything Notify holds on the caller at this event (subscriptions without their keys, preferences, channel choices, follows, personal notifications, check-ins); the other modules' exports come from their own contracts.
- **Delete:** `DELETE /api/notify/me` (with a session) deletes all of it at this event and ends every push to the caller. A guest deletes its subscription, which is all Notify holds on a guest, with `DELETE /api/notify/subscriptions/{subscription_id}` and its token.
- `GET`/`PATCH /api/notify/me` reads and sets the caller's own `dm_fallback` (default on) and `channels`.

## Settings
Per event, through the admin settings API (module `notify`):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `topics` | list of topic keys | every registered topic | Topics offered at this event; the same as each topic's `enabled` (Per-event configuration) |
| `hourly_cap` | integer, 1–60 | `6` | Pushes per recipient per 60 minutes, urgent ones over it |
| `dm_fallback` | boolean | `true` | Personal notifications fall back to a Discord DM |
| `schedule_lead_minutes` | integer | `10` | The `schedule` topic's parameter `lead_minutes`: the agenda reminder lead nearest to it becomes the notification |
| `check_in_rotation_seconds` | integer, 15–120 | `30` | How often check-in codes rotate |

## Rights
`notify.checkin.display` (fetch the rotating check-in codes), `notify.topics.write` (the event's topic configuration and custom topics), `notify.stats.read` (delivery counts per topic for admin; no recipients).

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Both are personal. Listed in the catalog: [events.md](events.md).

| Type | When | `data` |
|---|---|---|
| `notify.dm.requested` | A notification should reach a user as a Discord DM | `user_id`, `discord_user_id` (from the user's link in the tenants module, never from the source event), `notification_id`, `topic`, `title`, `body`, `url`, `urgent`, `reason` (`channel`: the person chose DMs for the topic; `fallback`: no push reached them) |
| `notify.checkin.recorded` | A member checked in by the rotating QR | `user_id`, `purpose`, `check_in_id`, `checked_in_at` |

## Not in this contract
The implementation, and a native store app (the hub is a PWA only).
