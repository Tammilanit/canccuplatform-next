# 0028. Pairing sets a new device's event; moves stay the superadmin's

- **Status:** Accepted (amends [0013](0013-multi-tenant-core.md) item 34 without superseding it)
- **Date:** 2026-11-08

## Context
[0013](0013-multi-tenant-core.md) item 34 says that only the superadmin, who manages venues, sets a device's current tenant. The screen contract ([screen.md](../../contracts/screen.md#pairing), #154) lets the event that pairs a screen create it with that event as its current tenant, and asked the maintainer to confirm that reading or record it as an amendment. Read literally, item 34 would make the superadmin pair every new screen of every event, which makes them a bottleneck on the day a venue is set up. The product owner settled it in the step 3 brainstorming session (2026-11-08, question D1 of the [step 3 question bank](../briefs/step-3-screen/questions.md#d1-pairing-sets-the-new-devices-tenant-confirm), option A).

## Decision
- **Pairing ties a new device to the event that pairs it.** Someone who holds `screen.devices.pair` on an event (its event admins through their role, or a member granted the right) enters the code a kiosk shows; the device is created with that event as its current tenant and the event's venue as its venue. This is the only time anyone but the superadmin sets a current tenant: the device is new, so it belongs to no other event.
- **Pairing stays fenced to the venue.** The kiosk must ask for its code from one of the event's venue addresses, the code lives 10 minutes and only the browser that asked can collect the token, and an event with no venue cannot pair ([screen.md](../../contracts/screen.md#pairing)). So an event can only take on a screen that is on its venue's network and shows its code.
- **Everything after pairing is the superadmin's.** Moving a device to another event, parking it, moving it to another venue and deleting it stay with the superadmin, on the superadmin hostname, and are audited, as item 34 says. An event never takes over a device another event holds: pairing always makes a new device with a new token.
- Every pairing is audited and emits `screen.device.paired` on the event.

## Consequences
- 0013 stays as written, apart from its Status line, which points here; item 34 reads with this record.
- The screen contract already works this way; its Pairing section now points here instead of asking for a confirmation. No contract changes.
- The devices issue (#107) and Studio's pair dialog build on it; the "screen crew" rights preset ([screen.md](../../contracts/screen.md#rights)) lets venue crew pair without the event-admin role.

## Known limits
- **While the venue IP check is off** (the tenants module's emergency switch, at most 48 hours), a kiosk can ask for a code from anywhere, so pairing no longer proves the screen is at the venue; the code shown on the screen and the person who enters it remain the guard.
- **A kiosk paired again at another event** (its cookie lost or cleared) becomes a new device there; its old row stays with the old event until that event revokes it or the superadmin deletes it.
- **A venue role** that could move devices between events at one venue without the superadmin, as item 34 foresees, is still not built.
