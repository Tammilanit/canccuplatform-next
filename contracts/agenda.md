# Agenda contract

The run-of-show: one dated agenda per event. It drives the screen's now and next and its countdowns, the reminders on Discord and the phone hub, and the Moments at the peaks. Organisers edit it in one place, also while the event runs, and everything else follows ([0022](../docs/decisions/0022-product-vision.md)). The `agenda` module owns it.

**Machine-readable API: [agenda.openapi.yaml](agenda.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Tenancy
- The agenda belongs to one event, which is one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)). The tenant comes from the request's hostname, never from a path, query or body field; there is no way to name another event's agenda.
- Every row carries `tenant_id` under row-level security; item ids are unique per tenant. Events go to the tenant's stream `t:<tenant>:events:agenda` and carry the envelope's `tenant` field (the tenants contract). The reminder scheduler is keyed by tenant (0013 item 7).
- An archived event's agenda is read-only: writes get 409 `event_archived`.

## Items
An item is one entry of the run-of-show (`Item` in the OpenAPI file).

| Field | Meaning |
|---|---|
| `id` | Item id, set by the module |
| `title`, `description` | Text for people; `description` is optional |
| `kind` | The key of one of the event's kinds (see Kinds). A consumer that does not know a kind reads the event's kind list for its name, and otherwise treats it as `other` |
| `starts_at`, `ends_at` | Current times. `ends_at` is `null` for a moment in time (doors open); `quiet_hours` items always have one. `ends_at` is after `starts_at` |
| `planned_starts_at`, `planned_ends_at` | The times as planned, before any delay |
| `delay_minutes` | `starts_at` minus `planned_starts_at`, in whole minutes; 0 when on time. Screens show it ("+15 min") |
| `location` | Where, for people ("Main stage"); optional |
| `zone` | The screen zone it belongs to, by the zone key of the screen contract; optional. Screens of that zone show it first |
| `visibility` | Who may read it: `public` (anyone, also guests and info pages), `attendees` (signed-in members of the event) or `crew` (right `agenda.crew.read`) |
| `status` | `scheduled` or `cancelled`. A cancelled item stays in the agenda, so screens can show it as cancelled |
| `reminder_leads_minutes` | Lead times for its reminders (see Reminders); `null` uses its kind's, else the event's setting; `[]` means none |
| `notify` | The channels that announce this item's reminders and changes (see Notification channels); `null` uses its kind's choice, else the event's setting |
| `notify_channels` | Read-only: the channels in effect, after `notify`, the kind and the event's setting are applied. Consumers act on this field |
| `links` | `tournament_id` (a tournament of the tournament module), `tournament_session_id` (a session of it) and `moment_id` (a Moment of the moments module), all optional. They are ids owned by those modules; the agenda stores them and does not read those modules' data. `tournament_session_id` is set only by the agenda itself (see Tournament sessions); a write that sets it is 400 `invalid_request` |
| `managed_by` | Read-only: `tournament` for an item that mirrors a tournament session (see Tournament sessions); absent on the organiser's own items |
| `cloned_from` | The source item's id when the item came from a clone; otherwise absent |
| `revision` | Starts at 1, +1 on every change of the item; used for optimistic concurrency |

Times are RFC 3339 UTC like everywhere ([README.md](README.md#conventions)). People see them in the event's time zone, which consumers read from the tenants API.

**Everything is optional.** An agenda may be empty, and no kind of item is required: an event with no `quiet_hours` items has no quiet hours, and Notify holds nothing ([notify.md](notify.md#delivery-rules)). Each event is different, so what an event has is the organiser's choice, never the platform's.

## Kinds
Each event has its own list of kinds (`Kind` in the OpenAPI file); the organiser adds, renames and removes them. A new event starts with the **starter set** `doors`, `ceremony`, `tournament`, `meal`, `quiet_hours`, `activity` and `other`; a cloned event takes the source's list instead (see Clone with an event).

| Field | Meaning |
|---|---|
| `key` | Lowercase `snake_case`, 1–32 characters, unique per event; never changes. Items name their kind by it |
| `name` | Text for people ("Dinner", "LAN party"); the organiser may rename any kind, built-in ones too |
| `builtin` | `true` for the keys of the starter set. Only built-in keys carry behaviour (below); a kind the organiser adds is a label with defaults |
| `reminder_leads_minutes` | Default lead times for its items; `null` uses the event's setting |
| `notify` | Default channels for its items; `null` uses the event's setting `notify_channels` |
| `revision` | Starts at 1, +1 on every change; for optimistic concurrency |

- **Behaviour of built-in keys:** only `quiet_hours` has any. Its items need an `ends_at`, are not shifted by a delay with `following`, are never announced, and while one runs Notify holds non-urgent pushes ([notify.md](notify.md#delivery-rules)). Removing the kind `quiet_hours` from an event's list is how an organiser makes sure the event never has quiet hours. All other built-in kinds behave like added ones; they exist so a new event is ready to use.
- `other` is the fallback every consumer knows, so it cannot be removed (409 `kind_required`); it can be renamed.
- `GET /api/agenda/kinds` → `{"kinds_version", "kinds"}`, readable by whoever may read the agenda.
- `PUT /api/agenda/kinds/{kind_key}` creates or replaces a kind (send `revision` to replace; a stale one is 409 `version_conflict`, a missing one on an existing kind is 409 `kind_exists`). Right `agenda.items.write`. Emits `agenda.kind.saved`.
- `DELETE /api/agenda/kinds/{kind_key}?revision=` → 204. Right `agenda.items.write`. A kind still named by an item, cancelled ones included, is 409 `kind_in_use`: move those items to another kind first. Emits `agenda.kind.removed`.
- An item naming a key not in the list is 400 `unknown_kind`.
- **`kinds_version`** is 0 for a new event's starter set and goes up by one on every change of the kind list. A kind's defaults feed its items' lead times and `notify_channels` in effect, so on `agenda.kind.saved` the module reschedules the pending reminders of its items, and consumers that hold items read the agenda again.

## Notification channels
Whether the run-of-show's reminders and changes are announced, and where, is optional and chosen per channel:

| Channel | Who delivers it | Opt-in by the attendee |
|---|---|---|
| `screen` | Screen: reminder and change notices (the agenda itself always shows) | — (public) |
| `discord_channel` | Bot: a post in the event's channel | — (public) |
| `discord_dm` | Notify, through the bot ([notify.md](notify.md#delivery-rules)) | yes, per topic |
| `push` | Notify: Web Push to the hub | yes, per topic and per phone |

- **Per event:** the setting `notify_channels` (default `["screen", "discord_channel", "push"]`); `[]` announces nothing.
- **Per kind and per item:** a kind's `notify` and an item's `notify` override it; `null` passes the choice down. The order is item, then kind, then event; the first that is not `null` wins, so `[]` on an item silences that item.
- **Per person:** an attendee picks `push` and `discord_dm` per topic in Notify ([notify.md](notify.md#per-person-channels-and-follows)); Notify delivers only on a channel that both the item's `notify_channels` and the person allow.
- Each consumer checks `item.notify_channels` for its own channel before it announces a reminder, a delay or a cancellation. The agenda emits every event regardless, so consumers keep their state (now and next, quiet hours) whatever is announced.

## Reading
- `GET /api/agenda/items?from=&to=&include_cancelled=` → `{"agenda_version", "items"}`, sorted by `starts_at`. `from` and `to` filter by overlap with the window; cancelled items are included unless `include_cancelled=false`.
- `GET /api/agenda/items/{item_id}` → one item.
- `GET /api/agenda/now?zone=` → `{"time", "agenda_version", "current", "next"}`: the scheduled items running now, and the scheduled items with the earliest start after now (several when they start at once). With `zone`, items of that zone and items with no zone. Every screen, the bot and the hub take now and next from here, so they never disagree.
- **Who sees what:** without a session only `public` items, and only when the event's info-page mode lets the request see info pages (the tenants contract); a signed-in member of the event also sees `attendees` items; `crew` items need the right `agenda.crew.read`. Items the caller may not see are left out, never returned as errors; a single item the caller may not see is 404 `not_found`.
- **`agenda_version`** goes up by one on every change of the event's agenda (an item added, changed, delayed, cancelled or removed, or a clone). Every change event carries it. A consumer that sees a jump of more than one, or starts up, reads `GET /api/agenda/items` again.

## Editing live
All writes need the right `agenda.items.write`. Each write that changes an item sends the item's `revision`; a stale one gets 409 `version_conflict` (read again and retry). Each change emits its event once it is committed, so the screen, Discord and reminders follow within seconds.

- **Add:** `POST /api/agenda/items` → 201 with the item; `planned_*` equal the given times. Emits `agenda.item.added`.
- **Edit or move:** `PATCH /api/agenda/items/{item_id}` with `revision` and the fields to change; fields left out stay as they are, and `null` clears `description`, `location` or `zone`, or hands `reminder_leads_minutes` and `notify` back to the kind. A move is a new plan: each given time becomes both its planned and its current value, so giving `starts_at` resets `delay_minutes` to 0 (planned 18:00, delayed to 18:15, then moved to 19:00: both times are 19:00 and no delay shows). Emits `agenda.item.changed` with the names of the changed fields.
- **Delay:** `POST /api/agenda/items/{item_id}/delay` with `revision`, `minutes` (non-zero, −720 to 720; negative brings it forward) and `following`. It shifts `starts_at` and `ends_at` and keeps the planned times, so screens show the delay. With `following: true` it also shifts every scheduled item that starts at or after this item's old start, except `quiet_hours` items. Each shifted item emits its own `agenda.item.delayed`; they share one `correlation_id` and are emitted in order of their new `starts_at`, so a consumer that takes the first of a `correlation_id` gets the earliest. An item already running keeps its start and only its end moves, so its `delay_minutes` stays as it was; screens show a running item whose `ends_at` differs from `planned_ends_at` with its new end ("until 19:15"). A shift that would put an item's `ends_at` at or before its `starts_at` is 400 `invalid_request`, and nothing shifts. Delaying an item that has started and has no `ends_at` is 409 `item_started`.
- **Cancel:** `POST /api/agenda/items/{item_id}/cancel` with `revision`. Emits `agenda.item.cancelled`. Cancelling is final; add the item again to bring it back.
- **Remove:** `DELETE /api/agenda/items/{item_id}?revision=` → 204. For mistakes only; during the event, cancel instead so people see it. Emits `agenda.item.removed`.

Errors: 400 `invalid_request` (for example `ends_at` not after `starts_at`, or a `quiet_hours` item without `ends_at`), 400 `unknown_kind`, 409 `version_conflict`, 409 `item_cancelled` (editing or delaying a cancelled item), 409 `item_started`, 409 `item_managed` (a change a tournament session owns, see Tournament sessions), 409 `event_archived`.

The screen follows every change event, and `agenda.item.started` and `agenda.item.ended`, to keep now and next current without polling.

## Tournament sessions
Every session of the tournament module is an item of the run-of-show, so the event's schedule always shows the tournament. The agenda keeps those items itself, from the tournament's events ([events.md](events.md#tournament)); the tournament module never writes the agenda.

- **Added:** on `tournament.session.added` the agenda adds an item: `title` the session's game name (with " final" for `is_final`), kind `tournament` (`other` when the event's kind list has no `tournament`), `starts_at` and `ends_at` from the session, visibility `public`, `links.tournament_id` and `links.tournament_session_id` from the session, and `managed_by: tournament`. Lead times and `notify` are `null`, so the kind's and the event's choices apply. Emits `agenda.item.added` as for any item.
- **Moved:** on `tournament.session.changed` it sets the item's title and times from the session. Times that differ from the item's current ones are a move (a new plan, as under Editing live); equal times change nothing, so a session that only follows the agenda's own delay (below) keeps the item's planned times and its delay. Emits `agenda.item.changed` when anything changed.
- **Cancelled and removed:** on `tournament.session.cancelled` the item is cancelled (also a running one, which ends it, see Reminders), and on `tournament.session.removed` it is removed; each emits its agenda event. A cancelled session that is reopened (`tournament.session.changed` with a status other than `cancelled`) gets a new item, and its cancelled item is removed, so a session has one item at a time.
- **One item per session:** the agenda finds the item by `links.tournament_session_id`, unique per event. It applies a session event only when its `session.revision` is newer than the last one it applied, so a redelivered or late event changes nothing.
- **What the organiser edits:** the session owns the item's title, kind, times, status and links. A `PATCH` of any of them, a cancel or a remove is 409 `item_managed`: change the session in the tournament module. Description, location, zone, visibility, lead times and `notify` stay the organiser's in the agenda.
- **Delays are the exception:** an organiser running late delays the run-of-show here, and a delay, also with `following`, shifts session items like any other. The tournament module follows `agenda.item.delayed` for items with `links.tournament_session_id` and moves the session to the item's new times; its `tournament.session.changed` then finds the times equal and changes nothing here.
- **Clone:** session items are not copied (see Clone with an event); the tournament module's own clone brings the sessions, and their events add their items.

## Reminders
Consumers subscribe to the agenda stream; the agenda module does the timing once per event, so the bot, the screen and Notify never run their own clocks for the run-of-show.

- At `starts_at` minus each lead time of a scheduled item the module emits `agenda.reminder.triggered` with `lead_minutes` and `leads_minutes`, the item's whole list of lead times in effect. The lead times are the item's `reminder_leads_minutes`, else its kind's, else the event's setting `reminder_leads_minutes` (default `[30, 10]`).
- At `starts_at` it emits `agenda.item.started`, and at `ends_at` (when set) `agenda.item.ended`. Moments starts a linked Moment on `agenda.item.started`.
- A delay or move reschedules the pending reminders. A reminder that has already fired fires again for the new time only while that time is still ahead; its `item.starts_at` tells consumers the new time. A cancelled or removed item drops everything still pending for it: its `agenda.reminder.triggered`, `agenda.item.started` and `agenda.item.ended`. An item cancelled or removed while it runs therefore never emits `agenda.item.ended`; consumers treat its `agenda.item.cancelled` or `agenda.item.removed` as its end. A lead that has already passed when an item is added is skipped.
- Each consumer picks what it needs: the bot posts at one lead in the event's channel, Notify turns the lead nearest the `schedule` topic's parameter into one notification ([notify.md](notify.md#topics-and-sources)), the screen counts down from the items themselves. Consumers check `visibility` before they show an item to anyone (`crew` items go only to crew), and `notify_channels` before they announce it.

## Clone with an event
A new event of a series can be cloned from the previous one, dates shifted, then edited (the series rule in the tenants contract). The agenda's part:

- `POST /api/agenda/clone` with `source_tenant_id` and `shift_seconds`, on the new event's hostname. Needs `agenda.items.write` on the new event. The module asks the tenants API that both events are in one series and that the caller is an event admin of the source too; otherwise 403 `missing_right`. Only into an empty agenda: otherwise 409 `agenda_not_empty`. Only while the kind list is still the starter set, untouched (`kinds_version` 0): otherwise 409 `kinds_changed`, so kinds an organiser set up are never replaced silently; the organiser then adds the source's kinds by hand.
- The module reads the source items in the source tenant's context and writes the copies in the new tenant's context, never both in one context.
- Copied first: the source's kind list, replacing the new event's starter set. Then every scheduled item (cancelled ones and items with `managed_by` are not), with title, description, kind, location, zone, visibility, reminder leads and `notify`. The planned times plus `shift_seconds` become both the planned and current times, so the copy has no delays. `links` are dropped, because they name the source event's tournaments and Moments; `cloned_from` keeps the source item's id. Each copy starts at `revision` 1.
- Emits one `agenda.items.cloned`, not one event per item; consumers read the agenda again.

## Settings
The agenda's per-event settings, through the admin settings API (module `agenda`):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `reminder_leads_minutes` | list of integers, 1–1440 | `[30, 10]` | Lead times for items and kinds that set none |
| `notify_channels` | list of `screen`, `discord_channel`, `discord_dm`, `push` | `["screen", "discord_channel", "push"]` | Channels that announce reminders and changes, for items and kinds that set none; `[]` for none |

## Rights
`agenda.items.write` (add, edit, delay, cancel, remove, clone, and the kind list), `agenda.crew.read` (read `crew` items).

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Every agenda event is event-wide; its audience is the item's `visibility`, and `public` for the kind events. `item` is the whole item as `GET /api/agenda/items/{item_id}` returns it to crew. Listed in the catalog: [events.md](events.md).

| Type | When | `data` |
|---|---|---|
| `agenda.item.added` | An item was added | `item`, `agenda_version`, `actor_user_id` |
| `agenda.item.changed` | An item was edited or moved | `item`, `changed` (field names), `agenda_version`, `actor_user_id` |
| `agenda.item.delayed` | An item was delayed or brought forward | `item`, `minutes` (this shift), `agenda_version`, `actor_user_id` |
| `agenda.item.cancelled` | An item was cancelled | `item`, `agenda_version`, `actor_user_id` |
| `agenda.item.removed` | An item was removed | `item_id`, `visibility`, `agenda_version`, `actor_user_id` |
| `agenda.item.started` | A scheduled item's `starts_at` was reached | `item` |
| `agenda.item.ended` | A scheduled item's `ends_at` was reached | `item` |
| `agenda.reminder.triggered` | A lead time before a scheduled item's start was reached | `item`, `lead_minutes`, `leads_minutes` (the item's lead times in effect) |
| `agenda.kind.saved` | A kind was added or changed | `kind`, `kinds_version`, `actor_user_id` |
| `agenda.kind.removed` | A kind was removed | `kind_key`, `kinds_version`, `actor_user_id` |
| `agenda.items.cloned` | The agenda was cloned from another event | `source_tenant_id`, `shift_seconds`, `item_count`, `agenda_version`, `kinds_version`, `actor_user_id` |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e60", "type": "agenda.item.delayed", "version": 1,
 "time": "2026-01-01T17:40:00Z", "source": "agenda", "correlation_id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e5f",
 "data": {"item": {"id": "it_8", "title": "Dinner", "kind": "meal", "starts_at": "2026-01-01T18:15:00Z",
   "ends_at": "2026-01-01T19:15:00Z", "planned_starts_at": "2026-01-01T18:00:00Z",
   "planned_ends_at": "2026-01-01T19:00:00Z", "delay_minutes": 15, "visibility": "public",
   "status": "scheduled", "reminder_leads_minutes": null, "notify": null,
   "notify_channels": ["screen", "discord_channel", "push"], "links": {}, "revision": 3},
  "minutes": 15, "agenda_version": 42, "actor_user_id": "u_123"}}
```
The example leaves out the envelope's `tenant` field, which the tenants contract adds to every event.

## Not in this contract
Native Discord scheduled events, and the phone hub (its notifications: [notify.md](notify.md)).
