# Event catalog

The cross-module events in one place, so a consumer finds what it can subscribe to without reading every contract. Naming, transport and the envelope: [admin.md](admin.md#events); the envelope is not repeated here. Each event's full `data` is in the contract of the module that emits it, linked per section.

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
| `agenda.item.delayed` | An item was delayed or brought forward | screen, notify |
| `agenda.item.cancelled` | An item was cancelled | screen, notify |
| `agenda.item.removed` | An item was removed | screen, notify (quiet hours) |
| `agenda.item.started` | An item's start was reached | screen, moments |
| `agenda.item.ended` | An item's end was reached | screen |
| `agenda.reminder.triggered` | A lead time before an item's start was reached | bot, screen, notify |
| `agenda.items.cloned` | The agenda was cloned from another event | screen, notify (quiet hours) |
| `agenda.kind.saved` | A kind of the event's kind list was added or changed. Audience: event-wide, `public` | screen, bot, notify (re-read items whose defaults changed) |
| `agenda.kind.removed` | A kind was removed. Audience: event-wide, `public` | screen, bot |

Every item in these events carries `notify_channels`, the channels the organiser chose for it ([agenda.md](agenda.md#notification-channels)); each consumer announces only on its own.

## Games
Emitter: `games`. Audience: event-wide, `public`. Payloads: [games.md](games.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `games.game.added` | A game was added to the event's catalogue | screen |
| `games.game.changed` | A game was edited, hidden or shown again | screen |
| `games.game.merged` | An event's game was merged into another | notify (moves the follows), screen |
| `games.surge.started` | Players on one game reached the event's threshold | notify (`game` topic), screen (hot-game banner), bot |
| `games.surge.ended` | A surge ended | screen |

Provisional, until the bot contract fixes it: `bot.activities.counted` (system; counts of the members' activities, never who), consumed by games ([games.md](games.md#surges)).

## Notify
Emitter: `notify`. Audience: personal. Payloads: [notify.md](notify.md#events-version-1).

| Type | Meaning | Consumers |
|---|---|---|
| `notify.dm.requested` | A notification should reach a user as a Discord DM: the person chose DMs for its topic, or no push reached them | bot |
| `notify.checkin.recorded` | A signed-in attendee checked in by the rotating QR | The module named in `purpose` (tournament for match check-in), admin |

## Tenants
Emitter: `tenants`. Audience: system, except where noted. Payloads: [tenants.md](tenants.md#events-version-1).

On the tenant's stream:

| Type | Meaning | Consumers |
|---|---|---|
| `tenants.tenant.changed` | The event's fields changed (name, time zone, dates, access, venue, series) | All modules (the kit's tenant cache) |
| `tenants.status.changed` | The event went live or was archived | All modules (archived is read-only) |
| `tenants.tenant.cloned` | The tenants part of a clone ran | admin (runs each module's clone) |
| `tenants.flags.changed` | Feature flags were set | All modules; bot (re-registers slash commands) |
| `tenants.venue_info.changed` | The event's venue info changed (also when copied in for a new venue). Audience: event-wide, `public` | screen, notify |
| `tenants.venue_ip_check.changed` | The venue IP check was switched off or on | screen (the kit's tenant cache) |
| `tenants.admin.added`, `tenants.admin.removed` | A user became or stopped being an event admin | Every module that caches rights |
| `tenants.member.joined`, `tenants.member.left` | A user joined or left the event. Audience: personal | notify (members-only delivery), every module that caches membership |
| `tenants.support.opened`, `tenants.support.closed` | A superadmin's support window opened or closed | admin |
| `tenants.retention.reached` | A retention date was reached (`presence`: 30 days after archiving) | Every module holding presence data |

On the platform stream `events:tenants`, without `tenant`:

| Type | Meaning | Consumers |
|---|---|---|
| `tenants.tenant.created` | A tenant was created | All modules (start reading its streams) |
| `tenants.tenant.deleted` | A tenant was deleted | All modules (delete its data) |
| `tenants.hostname.changed` | A hostname was added, verified, made primary, held or released | The kit's tenant cache |
| `tenants.venue.changed` | A venue was created, edited or deleted | screen, the kit's tenant cache |
| `tenants.privacy.changed` | A user's privacy flags changed. Audience: personal | Every module holding presence data, moments |
| `tenants.user.deleted` | A user was deleted. Audience: personal | All modules (delete their data) |
