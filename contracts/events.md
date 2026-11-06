# Event catalog

The cross-module events in one place, so a consumer finds what it can subscribe to without reading every contract. Naming, transport and the envelope: [admin.md](admin.md#events); the envelope is not repeated here. Each event's full `data` is in the contract of the module that emits it, linked per section.

- Events are per event (tenant): each goes to the tenant's stream `t:<tenant>:events:<module>` and carries the envelope's `tenant` field ([0013](../docs/decisions/0013-multi-tenant-core.md), item 7; the tenants contract).
- Adding an event or a field is additive. Removing or renaming one is breaking ([README.md](README.md#changing-a-contract)).
- **Audience:** each event says whom it concerns: event-wide (with a visibility) or personal (it names the platform `user_id`). Notify maps events to notification topics by this, without asking the emitting module ([notify.md](notify.md#topics-and-sources)).

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
| `agenda.item.added` | An item was added | screen, bot, notify |
| `agenda.item.changed` | An item was edited or moved | screen, bot, notify, moments |
| `agenda.item.delayed` | An item was delayed or brought forward | screen, bot, notify, moments |
| `agenda.item.cancelled` | An item was cancelled | screen, bot, notify, moments |
| `agenda.item.removed` | An item was removed | screen, bot, notify, moments |
| `agenda.item.started` | An item's start was reached | screen, moments |
| `agenda.item.ended` | An item's end was reached | screen, moments, notify (quiet hours) |
| `agenda.reminder.triggered` | A lead time before an item's start was reached | bot, notify, screen |
| `agenda.items.cloned` | The agenda was cloned from another event | screen, bot, notify |
