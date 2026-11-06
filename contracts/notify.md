# Notify contract

Notifications to attendees' phones, and the API of the phone hub (a PWA, no store app) that shows them ([0022](../docs/decisions/0022-product-vision.md), the App track). The `notify` module owns both: it serves the hub under `/notify/`, keeps Web Push subscriptions, turns domain events into notifications and delivers them. Notify consumes events; other modules never know about phones, subscriptions or push.

**Machine-readable API: [notify.openapi.yaml](notify.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Tenancy
- Every subscription, preference, notification and check-in belongs to one event, which is one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)). The tenant comes from the request's hostname; a subscription made on one event's hostname never receives another event's notifications.
- Every row carries `tenant_id` under row-level security. Notify consumes each tenant's streams with the tenant set per message (0013 item 7). Its schedulers (quiet hours, caps, check-in codes) are keyed by tenant.
- Users are global (0013 item 30); a user's subscriptions and preferences are per event.
- **When the event is archived** (the tenants contract's lifecycle), Notify deletes all of its subscriptions, subscription tokens, preferences and notifications at once, and stops delivering. Check-ins are presence data and are deleted 30 days after the archive (0022).

## Who can do what
| | Guest (no account) | Signed-in attendee (member of the event) |
|---|---|---|
| Subscribe to push | Event-wide topics | Event-wide and personal topics |
| Manage the subscription | With its subscription token | With the session, or the token |
| Read notifications | Event-wide ones with `public` audience | Also `attendees` ones and their own personal ones |
| Check in by the rotating QR | No | Yes |
| Privacy: export, delete | Delete the subscription | Export and delete everything Notify holds on them |

Personal topics need sign-in: a guest asking for one gets 401 `sign_in_required`. A guest who signs in later claims the subscription, which then belongs to the user.

## Topics and sources
Five topics. Each has an event-wide part, a personal part, or both. An attendee opts in per topic and part, per subscription (one per phone or browser); the defaults are what a new subscription gets.

| Topic | Event-wide | Personal | Default |
|---|---|---|---|
| `schedule` | Run-of-show reminders, delays, cancellations | — | on |
| `announcements` | The announce action's announcements | — | on |
| `food` | Ordering opens or closes | Your order is ready | event-wide off, personal on |
| `tournament` | Registration opens, a final starts | Your match is called, check-in opens | event-wide off, personal on |
| `play` | — | Invitations to sessions inside Games | on |

The event's settings can switch a topic off for the whole event (`topics`).

**Sources.** Notify maps events to topics by the event's audience: event-wide events by their visibility (`public` reaches guests and members, `attendees` only signed-in members, `crew` never reaches phones), personal events by the `user_id` they name (the event catalog, [events.md](events.md)). Only the agenda's events exist yet. The other names are provisional until the event catalog and each module's contract fix them; this table follows those names and stays additive.

| Event | Topic and part | Urgent | Notes |
|---|---|---|---|
| `agenda.reminder.triggered` | `schedule`, event-wide | no | One per item: at the item's lead time nearest to `schedule_lead_minutes` (on a tie, the larger), so an item with leads `[15]` is still announced, at 15. An item with no leads (`[]`) gets none. Items of kind `quiet_hours` are not announced |
| `agenda.item.delayed`, `agenda.item.cancelled` | `schedule`, event-wide | no | Only for items starting within the next 2 hours. For a delay with `following`, one notification per `correlation_id` and audience (`public`, `attendees`), describing the earliest shifted item that audience may see; `crew` items are ignored and never take the dedupe key |
| The announce action's event (step 4) | `announcements`, event-wide | when the announcement is marked urgent | |
| `pizza.ordering.opened`, `pizza.ordering.closed` (provisional) | `food`, event-wide | no | |
| `pizza.order.ready` (provisional) | `food`, personal | no | |
| `tournament.registration.opened` (provisional) | `tournament`, event-wide | no | |
| `tournament.match.called` (provisional) | `tournament`, personal | yes | Each player of the match |
| `tournament.checkin.opened` (provisional) | `tournament`, personal | no | Each registered player |
| `games.session.invited` (provisional) | `play`, personal | no | |
| `agenda.item.added`, `.changed`, `.delayed`, `.cancelled`, `.removed` of `quiet_hours` items, and `agenda.items.cloned` | — | — | Notify re-evaluates the event's quiet hours (Delivery rules) |

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
- **Who gets it:** an event-wide notification goes to every subscription of the event with that topic's event-wide part on (for `attendees`, only subscriptions of current members). A personal one goes to every subscription of its user with that topic's personal part on.
- **Discord DM fallback:** when a personal notification finds no active push subscription of its user, or every push failed, and both the event's setting `dm_fallback` and the user's own `dm_fallback` are on, Notify emits `notify.dm.requested`. The bot module sends the DM; Notify never talks to Discord. Event-wide notifications never go out as DMs; the bot posts those in the event's channels itself.
- **Info-page mode** (the tenants contract) applies to guests as it does to the agenda's `public` items. In mode `sign-in` guests cannot subscribe (403 `info_pages_closed`), and existing guest subscriptions are kept but get no pushes until the mode opens again. In mode `venue-only` guests subscribe and read notification details only from the venue address; pushes still reach them, but off-site the hub cannot load the details and shows the generic text.
- **Quiet hours** are the event's `quiet_hours` items in the run-of-show: edit them there and Notify follows. Quiet hours are active while a scheduled `quiet_hours` item with visibility `public` or `attendees` is running (`starts_at` ≤ now < `ends_at`); `crew` items do not count. Notify keeps these items from the agenda events in the sources table and times them itself. It reads them again from `GET /api/agenda/items` on start-up, on `agenda.items.cloned` and when `agenda_version` jumps, so a cancelled, removed or moved item ends or moves quiet hours at once, and a restart during quiet hours keeps them. During quiet hours non-urgent pushes and DMs are held. When they end, held notifications that have not expired are sent, at most one per topic per recipient (the newest); the rest stay in the inbox.
- **Hourly cap:** at most `hourly_cap` pushes (default 6) per recipient in any 60 minutes; the recipient is the user, or the subscription for a guest. Over the cap a non-urgent notification is not pushed and stays in the inbox.
- **Urgent:** only where the sources table says so. Urgent notifications are pushed during quiet hours and over the cap, and count toward the cap. They never override an opt-out: a topic part switched off gets nothing.
- **Dedupe:** events arrive at least once; Notify creates at most one notification per source event `id` (and per `correlation_id` where the sources table says so).

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
| Your order | Members | The pizza contract: the caller's own orders and their status |
| Your matches, match check-in | Members | The tournament contract: the caller's matches; check-in through `tournament:<ref>` codes here |
| Check-in at arrival | Members | This API (`arrival`) |
| Privacy | Members | See below |

**Privacy.** The hub's privacy page:
- **Presence opt-out:** sets the global per-user privacy flag through the tenants API; every module reads it there.
- **Export:** `GET /api/notify/me/export` returns everything Notify holds on the caller at this event (subscriptions without their keys, preferences, personal notifications, check-ins); the other modules' exports come from their own contracts.
- **Delete:** `DELETE /api/notify/me` (with a session) deletes all of it at this event and ends every push to the caller. A guest deletes its subscription, which is all Notify holds on a guest, with `DELETE /api/notify/subscriptions/{subscription_id}` and its token.
- `GET`/`PATCH /api/notify/me` reads and sets the caller's own `dm_fallback` (default on).

## Settings
Per event, through the admin settings API (module `notify`):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `topics` | list of topics | all five | Topics offered at this event |
| `hourly_cap` | integer, 1–60 | `6` | Pushes per recipient per 60 minutes, urgent ones over it |
| `dm_fallback` | boolean | `true` | Personal notifications fall back to a Discord DM |
| `schedule_lead_minutes` | integer | `10` | The agenda reminder lead that becomes a `schedule` notification; one of the agenda's lead times |
| `check_in_rotation_seconds` | integer, 15–120 | `30` | How often check-in codes rotate |

## Rights
`notify.checkin.display` (fetch the rotating check-in codes), `notify.stats.read` (delivery counts per topic for admin; no recipients).

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Both are personal. Listed in the catalog: [events.md](events.md).

| Type | When | `data` |
|---|---|---|
| `notify.dm.requested` | A personal notification should reach its user as a Discord DM | `user_id`, `discord_user_id`, `notification_id`, `topic`, `title`, `body`, `url`, `urgent` |
| `notify.checkin.recorded` | A member checked in by the rotating QR | `user_id`, `purpose`, `check_in_id`, `checked_in_at` |

## Not in this contract
The implementation, and a native store app (the hub is a PWA only).
