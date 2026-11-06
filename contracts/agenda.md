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
| `kind` | `doors`, `ceremony`, `tournament`, `meal`, `quiet_hours`, `activity` or `other`. More kinds may be added; a consumer treats a kind it does not know as `other` |
| `starts_at`, `ends_at` | Current times. `ends_at` is `null` for a moment in time (doors open); `quiet_hours` items always have one. `ends_at` is after `starts_at` |
| `planned_starts_at`, `planned_ends_at` | The times as planned, before any delay |
| `delay_minutes` | `starts_at` minus `planned_starts_at`, in whole minutes; 0 when on time. Screens show it ("+15 min") |
| `location` | Where, for people ("Main stage"); optional |
| `zone` | The screen zone it belongs to, by the zone key of the screen contract; optional. Screens of that zone show it first |
| `visibility` | Who may read it: `public` (anyone, also guests and info pages), `attendees` (signed-in members of the event) or `crew` (right `agenda.crew.read`) |
| `status` | `scheduled` or `cancelled`. A cancelled item stays in the agenda, so screens can show it as cancelled |
| `reminder_leads_minutes` | Lead times for its reminders (see Reminders); `null` uses the event's setting, `[]` means none |
| `links` | `tournament_id` (a tournament of the tournament module) and `moment_id` (a Moment of the moments module), both optional. They are ids owned by those modules; the agenda stores them and does not read those modules' data |
| `cloned_from` | The source item's id when the item came from a clone; otherwise absent |
| `revision` | Starts at 1, +1 on every change of the item; used for optimistic concurrency |

Times are RFC 3339 UTC like everywhere ([README.md](README.md#conventions)). People see them in the event's time zone, which consumers read from the tenants API.

## Reading
- `GET /api/agenda/items?from=&to=&include_cancelled=` → `{"agenda_version", "items"}`, sorted by `starts_at`. `from` and `to` filter by overlap with the window; cancelled items are included unless `include_cancelled=false`.
- `GET /api/agenda/items/{item_id}` → one item.
- `GET /api/agenda/now?zone=` → `{"time", "agenda_version", "current", "next"}`: the scheduled items running now, and the scheduled items with the earliest start after now (several when they start at once). With `zone`, items of that zone and items with no zone. Every screen, the bot and the hub take now and next from here, so they never disagree.
- **Who sees what:** without a session only `public` items, and only when the event's info-page mode lets the request see info pages (the tenants contract); a signed-in member of the event also sees `attendees` items; `crew` items need the right `agenda.crew.read`. Items the caller may not see are left out, never returned as errors; a single item the caller may not see is 404 `not_found`.
- **`agenda_version`** goes up by one on every change of the event's agenda (an item added, changed, delayed, cancelled or removed, or a clone). Every change event carries it. A consumer that sees a jump of more than one, or starts up, reads `GET /api/agenda/items` again.

## Editing live
All writes need the right `agenda.items.write`. Each write that changes an item sends the item's `revision`; a stale one gets 409 `version_conflict` (read again and retry). Each change emits its event once it is committed, so the screen, Discord and reminders follow within seconds.

- **Add:** `POST /api/agenda/items` → 201 with the item; `planned_*` equal the given times. Emits `agenda.item.added`.
- **Edit or move:** `PATCH /api/agenda/items/{item_id}` with `revision` and the fields to change; fields left out stay as they are, and `null` clears `description`, `location` or `zone`. A move is a new plan: each given time becomes both its planned and its current value, so giving `starts_at` resets `delay_minutes` to 0 (planned 18:00, delayed to 18:15, then moved to 19:00: both times are 19:00 and no delay shows). Emits `agenda.item.changed` with the names of the changed fields.
- **Delay:** `POST /api/agenda/items/{item_id}/delay` with `revision`, `minutes` (non-zero, −720 to 720; negative brings it forward) and `following`. It shifts `starts_at` and `ends_at` and keeps the planned times, so screens show the delay. With `following: true` it also shifts every scheduled item that starts at or after this item's old start, except `quiet_hours` items. Each shifted item emits its own `agenda.item.delayed`; they share one `correlation_id`. An item already running keeps its start and only its end moves, so its `delay_minutes` stays as it was; screens show a running item whose `ends_at` differs from `planned_ends_at` with its new end ("until 19:15"). A shift that would put an item's `ends_at` at or before its `starts_at` is 400 `invalid_request`, and nothing shifts. Delaying an item that has started and has no `ends_at` is 409 `item_started`.
- **Cancel:** `POST /api/agenda/items/{item_id}/cancel` with `revision`. Emits `agenda.item.cancelled`. Cancelling is final; add the item again to bring it back.
- **Remove:** `DELETE /api/agenda/items/{item_id}?revision=` → 204. For mistakes only; during the event, cancel instead so people see it. Emits `agenda.item.removed`.

Errors: 400 `invalid_request` (for example `ends_at` not after `starts_at`, or a `quiet_hours` item without `ends_at`), 409 `version_conflict`, 409 `item_cancelled` (editing or delaying a cancelled item), 409 `item_started`, 409 `event_archived`.

The screen follows every change event, and `agenda.item.started` and `agenda.item.ended`, to keep now and next current without polling.

## Reminders
Consumers subscribe to the agenda stream; the agenda module does the timing once per event, so the bot, the screen and Notify never run their own clocks for the run-of-show.

- At `starts_at` minus each lead time of a scheduled item the module emits `agenda.reminder.triggered` with `lead_minutes`. The lead times are the item's `reminder_leads_minutes`, or else the event's setting `reminder_leads_minutes` (default `[30, 10]`).
- At `starts_at` it emits `agenda.item.started`, and at `ends_at` (when set) `agenda.item.ended`. Moments starts a linked Moment on `agenda.item.started`.
- A delay or move reschedules the pending reminders. A reminder that has already fired fires again for the new time only while that time is still ahead; its `item.starts_at` tells consumers the new time. A cancelled or removed item drops everything still pending for it: its `agenda.reminder.triggered`, `agenda.item.started` and `agenda.item.ended`. An item cancelled or removed while it runs therefore never emits `agenda.item.ended`; consumers treat its `agenda.item.cancelled` or `agenda.item.removed` as its end. A lead that has already passed when an item is added is skipped.
- Each consumer picks what it needs: the bot posts at one lead in the event's channel, Notify turns the lead nearest its setting into one `schedule` notification ([notify.md](notify.md#topics-and-sources)), the screen counts down from the items themselves. Consumers check `visibility` before they show an item to anyone: `crew` items go only to crew.

## Clone with an event
A new event of a series can be cloned from the previous one, dates shifted, then edited (the series rule in the tenants contract). The agenda's part:

- `POST /api/agenda/clone` with `source_tenant_id` and `shift_seconds`, on the new event's hostname. Needs `agenda.items.write` on the new event. The module asks the tenants API that both events are in one series and that the caller is an event admin of the source too; otherwise 403 `missing_right`. Only into an empty agenda: otherwise 409 `agenda_not_empty`.
- The module reads the source items in the source tenant's context and writes the copies in the new tenant's context, never both in one context.
- Copied: every scheduled item (cancelled ones are not), with title, description, kind, location, zone, visibility and reminder leads. The planned times plus `shift_seconds` become both the planned and current times, so the copy has no delays. `links` are dropped, because they name the source event's tournaments and Moments; `cloned_from` keeps the source item's id. Each copy starts at `revision` 1.
- Emits one `agenda.items.cloned`, not one event per item; consumers read the agenda again.

## Settings
The agenda's per-event settings, through the admin settings API (module `agenda`):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `reminder_leads_minutes` | list of integers, 1–1440 | `[30, 10]` | Lead times for items that set none |

## Rights
`agenda.items.write` (add, edit, delay, cancel, remove, clone), `agenda.crew.read` (read `crew` items).

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Every agenda event is event-wide; its audience is the item's `visibility`. `item` is the whole item as `GET /api/agenda/items/{item_id}` returns it to crew. Listed in the catalog: [events.md](events.md).

| Type | When | `data` |
|---|---|---|
| `agenda.item.added` | An item was added | `item`, `agenda_version`, `actor_user_id` |
| `agenda.item.changed` | An item was edited or moved | `item`, `changed` (field names), `agenda_version`, `actor_user_id` |
| `agenda.item.delayed` | An item was delayed or brought forward | `item`, `minutes` (this shift), `agenda_version`, `actor_user_id` |
| `agenda.item.cancelled` | An item was cancelled | `item`, `agenda_version`, `actor_user_id` |
| `agenda.item.removed` | An item was removed | `item_id`, `visibility`, `agenda_version`, `actor_user_id` |
| `agenda.item.started` | A scheduled item's `starts_at` was reached | `item` |
| `agenda.item.ended` | A scheduled item's `ends_at` was reached | `item` |
| `agenda.reminder.triggered` | A lead time before a scheduled item's start was reached | `item`, `lead_minutes` |
| `agenda.items.cloned` | The agenda was cloned from another event | `source_tenant_id`, `shift_seconds`, `item_count`, `agenda_version`, `actor_user_id` |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e60", "type": "agenda.item.delayed", "version": 1,
 "time": "2026-01-01T17:40:00Z", "source": "agenda", "correlation_id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e5f",
 "data": {"item": {"id": "it_8", "title": "Dinner", "kind": "meal", "starts_at": "2026-01-01T18:15:00Z",
   "ends_at": "2026-01-01T19:15:00Z", "planned_starts_at": "2026-01-01T18:00:00Z",
   "planned_ends_at": "2026-01-01T19:00:00Z", "delay_minutes": 15, "visibility": "public",
   "status": "scheduled", "reminder_leads_minutes": null, "links": {}, "revision": 3},
  "minutes": 15, "agenda_version": 42, "actor_user_id": "u_123"}}
```
The example leaves out the envelope's `tenant` field, which the tenants contract adds to every event.

## Not in this contract
Native Discord scheduled events, and the phone hub (its notifications: [notify.md](notify.md)).
