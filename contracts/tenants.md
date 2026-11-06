# Tenants contract

Every event is a tenant on one shared stack ([0013](../docs/decisions/0013-multi-tenant-core.md)). The `tenants` module owns the registry of events, their hostnames, venues, users, roles and membership, each event's access settings, feature flags and lifecycle, event series, and the audit log. Every other module builds on it: it learns its tenant from the request's hostname through the kit, and reads everything here through this API or the kit's cache, never from the tenants module's tables ([0008](../docs/decisions/0008-contract-first.md)).

**Machine-readable API: [tenants.openapi.yaml](tenants.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Words
- **Tenant** or **event:** one event, for example one weekend LAN. The words are used interchangeably; "event" in a module contract means a tenant, never a bus event.
- **Platform:** the shared stack itself, with the things that belong to no event (venues, users, series, the hostname registry).
- **Guest:** a request without a session. **Member:** a signed-in user who belongs to the event (an attendee). **Event admin**, **superadmin:** the two roles (see Roles).

## Tables: global and per tenant
Postgres row-level security guards every tenant table (0013 items 5–6). A global table has no `tenant_id` of its own, is not under RLS and is read before a tenant is set. A global table exists only on the kit's allow-list ([#49](../docs/roadmap.md#2b-tenancy-foundation)); adding one changes that list.

| Table (owner) | Scope | Holds |
|---|---|---|
| tenants (tenants) | global | The registry row: id, name, status, time zone, dates, venue id, series id and the access settings below. A plain reference to a venue and a series, nothing else of other tenants |
| hostnames (tenants) | global | Each hostname and its tenant, as a plain foreign key; also held hostnames |
| venues (tenants) | global | Name, addresses and the venue profile |
| users (tenants) | global | Id, Discord id, name, the privacy flags, the superadmin flag and an audit reference (see Audit log) |
| series (tenants) | global | A series' name; its events point to it |
| platform audit (tenants) | global | Audit entries with no tenant: venues, hostnames, tenant creation and deletion, superadmins, user deletion |
| Device identity (screen) | global | Owned by the screen contract (0013 item 34); not part of this contract |
| event admins, members, feature flags, venue info, audit, support windows (tenants) | per tenant | `tenant_id` under RLS |
| Everything else, in every module | per tenant | `tenant_id` under RLS, unless that module's contract adds a table to the allow-list |

Series and platform audit are added to 0013 item 6's list of global tables: a series spans events, and an audit entry about a venue or a hostname belongs to no single event.

## Resolving the tenant
- The tenant comes from the request's hostname, looked up exactly (lowercase, port dropped) among `active` hostnames. Never from a path, query or body field, and never from the `Host` header of a request Caddy did not forward. An unknown host gets 404 with no body detail, and the edge Caddy gets no certificate for it.
- Outside resolution (0013 item 2): the platform's own hostnames (the central sign-in host and the superadmin hostname, both from the environment and never registrable), `GET /health`, and the IP-mode demo stack in CI, which serves the demo tenant on an unregistered host only while `platform.version` is `dev` and the demo tenant is the only tenant.
- **For modules:** the kit resolves and caches the tenant through `GET /internal/tenants/resolve?host=` (the `TenantContext` in the OpenAPI file: id, status, time zone, access settings, the venue's addresses and the feature flags) and drops its cache on the tenants events. A module never reads the registry itself.
- Absolute URLs (links in DMs, push, QR codes) use the tenant's `primary_hostname`, never the request's `Host` header (0013 item 10).
- **Internal endpoints** live under `/internal/tenants/`, not `/api/`. The edge Caddy routes only `/api/<module>/` and `/<module>/`, so they are reached only on the stack's internal network: by the kit, the other modules and Caddy's `ask`.

## Tenants
A tenant (`Tenant` in the OpenAPI file):

| Field | Meaning |
|---|---|
| `id` | Set by the superadmin at creation and never changed: lowercase letters, digits and `-`, 3–32 characters, starting with a letter. It appears in keys, streams (`t:<id>:events:<module>`) and file paths (`/files/<id>/<module>/`) |
| `name` | The event's name for people |
| `status` | `draft`, `live` or `archived` (see Lifecycle) |
| `time_zone` | IANA zone, e.g. `Europe/Berlin`. People see every time of the event in it; modules read it here |
| `starts_at`, `ends_at` | The event's dates, both optional while `draft` |
| `venue` | `{"id", "name"}` of its venue, or `null` (online event, or not chosen yet) |
| `series_id` | Its series, or `null` |
| `primary_hostname` | The hostname for absolute URLs |
| `info_page_mode` | `public`, `venue_only` or `sign_in` (see Access) |
| `membership` | `open` (any signed-in user may join) or `closed` (event admins add members). Default `open` |
| `admin_access` | `restricted` (default) or `internet` (see Access) |
| `venue_ip_check` | `{"enabled", "disabled_until", "reason"}` (see Access) |
| `archived_at`, `presence_delete_at` | Set when archived (see Retention) |
| `revision` | +1 on every change, for optimistic concurrency |

- `GET /api/tenants/current` → the request's tenant, readable by anyone, also guests, so pages can decide what to show. Guests see the public fields only (`PublicTenant`: no access settings beyond `info_page_mode`, no revision).
- `PATCH /api/tenants/current` with `revision` changes `name`, `time_zone`, `starts_at`, `ends_at`, `info_page_mode`, `membership` and `admin_access`. Right `tenants.event.write`. A stale `revision` is 409 `version_conflict`. Emits `tenants.tenant.changed`.
- The venue, the series and the hostnames are the superadmin's (see Superadmin): they decide who may use a venue's screens and which names point to the event.

**Settings.** A tenant's settings are of two kinds. Its own (time zone, dates, access, membership) are the fields above. Each module's settings are per tenant through the admin settings API ([admin.md](admin.md#settings)), for the request's tenant (0013 item 18).

## Lifecycle
`draft` → `live` → `archived`, and `draft` → `archived` for an event that never runs. Nothing goes back; an archived event comes back only as a new event cloned from it.

- **draft:** created by the superadmin. Event admins and members use it fully; guests get nothing, whatever the info-page mode, so an event is prepared out of sight.
- **live:** the event is on. The platform's deploy hold counts live tenants (0013 item 22).
- **archived:** read-only. Every write in every module gets 409 `event_archived`. Excepted: deleting data (privacy deletes, leaving the event, retention, deleting the tenant) and the audit log's own appends. Reads follow the info-page mode as before.
- `POST /api/tenants/current/status` with `{"status", "revision"}`. Right `tenants.lifecycle.write`. A transition not listed is 409 `invalid_transition`. Emits `tenants.status.changed`.

## Hostnames
- A tenant has one or more hostnames, exactly one of them `primary`. Each hostname points to one tenant.
- `kind`: `platform` (a name directly under the platform domain, covered by the wildcard certificate; `active` at once) or `custom` (any other name; 0013 items 9 and 12).
- A `custom` hostname starts `pending`: the superadmin's client shows the TXT record (`_canccu-verify.<hostname>` with the given token). `POST …/verify` looks it up; when it matches the hostname becomes `active`, otherwise 409 `verification_failed`. Only then does the `ask` endpoint allow a certificate for it.
- **Removing** a hostname makes it `held` for 30 days (`held_until`): it resolves to nothing and cannot be added to another tenant (409 `hostname_held`). The superadmin may add it back to the same tenant. After the hold the row is deleted.
- The platform's own hostnames are refused (409 `hostname_reserved`); a hostname in use is 409 `hostname_taken`.
- **Caddy's `ask`:** `GET /internal/tenants/ask?domain=` → 200 for an `active` hostname, otherwise 404.

## Venues
A venue is a place where events happen. Venues are global rows managed by the superadmin (0013 item 33).

| Field | Meaning |
|---|---|
| `id`, `name` | Set by the superadmin |
| `addresses` | CIDR prefixes, IPv4 and IPv6, as the remote VM sees the venue: its public NAT address or prefix (`192.0.2.10/32`, `2001:db8:1::/48`). A plain address means a single host |
| `profile` | The venue's lasting data (below) |
| `revision` | For optimistic concurrency |

- An event points to at most one venue. Several events may use one venue, at different times or at once; they share its addresses, so the check that tells their screens apart is the device token in the app (the screen contract), never the firewall.
- The devices that stay at a venue are Screen's global device rows with this venue's id (0013 item 34). Screen reads the venue through this API.
- A venue that an event points to cannot be deleted (409 `venue_in_use`).

### Venue profile, copied into each event
The venue owns its lasting data, and each new event gets a copy of it ([0022](../docs/decisions/0022-product-vision.md)).

- The profile: `house_rules` (text, up to 20,000 characters), `wifi` (a list of networks: `ssid`, `password`, `note`, `visibility`), `floor_plan` (an image, PNG, JPEG or WebP, up to 10 MB; SVG is refused because uploads are served as data, 0013 item 21). The screens at the venue are Screen's devices (above); they are not copied, because a device serves one event at a time and only the superadmin moves it.
- **Copy-in, not a live link:** when an event gets its venue (at creation, or when the superadmin changes it), the venue's profile is copied into the event's **venue info** (per tenant), replacing any earlier copy. Later edits of the venue do not change existing events; the event admin may copy again with `POST /api/tenants/current/venue-info/copy`.
- Event admins edit the event's copy: `PUT /api/tenants/current/venue-info` and `PUT /api/tenants/current/venue-info/floor-plan`, right `tenants.venue_info.write`. Emits `tenants.venue_info.changed`.
- Reading: `GET /api/tenants/current/venue-info` and `…/floor-plan` are info pages and follow the info-page mode. A Wi-Fi network's `visibility` is `public` (everyone the mode lets in) or `attendees` (members only), so a password can stay with attendees.
- The venue's floor plan file is global data of the tenants module, stored under `/files/_platform/tenants/venues/<venue id>/` (outside every tenant's tree; `_` is not allowed in tenant ids). The copy goes to `/files/<tenant>/tenants/`.

## Users, roles and membership
- **Users are global** (0013 item 30): one row per person, created or updated by the central sign-in ([#52](../docs/roadmap.md#2b-tenancy-foundation)) through the tenants module. A user has an `id` (e.g. `u_123`), a Discord user id, a `name`, `mfa_enabled` as Discord last reported it, and the privacy flags.
- **Roles:**
  - **superadmin** (global): manages tenants, hostnames, venues, series and superadmins on the superadmin hostname. Needs `mfa_enabled` (Discord two-factor; otherwise 403 `mfa_required`). The superadmin hostname is reachable over Tailscale only (0022); the edge Caddy enforces that (#51). On a tenant's hostname a superadmin has no rights until they open a support window.
  - **event admin** (per tenant): holds every right of every module in that tenant. A user may be event admin of several events.
- Rights stay `<module>.<right>` strings, checked through the admin session ([admin.md](admin.md#session-and-rights)), for the session's tenant. Each session is bound to one tenant server-side (0013 item 10). A right may be granted to a member without the role (TD1 of the [legacy inventory](../docs/legacy-inventory/README.md#t-d-identity-and-rights)), except `tenants.admins.write` and `tenants.lifecycle.write`, which only the event-admin role holds, so no granted right can make its holder an admin.
- **Event admins:** `GET /api/tenants/current/admins`; `PUT` and `DELETE /api/tenants/current/admins/{user_id}`. Right `tenants.admins.write`. Removing the last event admin is 409 `last_admin`. Emits `tenants.admin.added` or `tenants.admin.removed`; a module that caches rights drops that user's cache on them.
- **Members** (attendees): a member belongs to one event; a user may be a member of several.
  - `GET /api/tenants/me` → for this event: `user` (`null` for a guest), `member`, `roles`, `superadmin`, `support_until` and `privacy`. Modules ask here (through the kit, with the caller's cookie) whether the caller is a member.
  - Join: `POST /api/tenants/me/membership` while `membership` is `open`; otherwise 403 `membership_closed`. Leave: `DELETE /api/tenants/me/membership`, also when archived.
  - Event admins: `GET /api/tenants/current/members` (right `tenants.members.read`) and `PUT` or `DELETE /api/tenants/current/members/{user_id}` (right `tenants.members.write`). An event admin sees only their own event's members: user id, name and when they joined; never a Discord id. Emits `tenants.member.joined` or `tenants.member.left`.
- **Support access** (0013 item 13): a superadmin on a tenant's hostname opens a support window with `POST /api/tenants/current/support` and a `reason`. For 2 hours, or until `DELETE /api/tenants/current/support`, they act as an event admin there, and every audit entry they cause is marked `support`. Opening and closing emit `tenants.support.opened` and `tenants.support.closed`.

## Access
Who may see what on a tenant's hostname. The kit implements these rules once ([#49](../docs/roadmap.md#2b-tenancy-foundation)); modules call it and never compare addresses themselves. The request's address is the client address the edge Caddy forwards; Caddy is the only trusted proxy (0013 item 10).

### Info-page mode
Info pages are read-only, public-facing pages and data: the run-of-show, announcements, venue info, the hub's public views (0013 item 11).

| Mode | Guests may read info pages |
|---|---|
| `public` (default) | Always |
| `venue_only` | Only from one of the venue's addresses; an event with no venue lets no guest in |
| `sign_in` | Never |

- Members, event admins and a superadmin in a support window always may, in every mode; guests never may while the event is `draft`.
- The mode is a **visibility setting, never authorization.** It never grants a write, a personal read or any right. `venue_only` lets in anyone at the venue, also the attendees of another event there at the same time.
- A denied info read is 403 `info_pages_closed`.

### Venue IP check for screens and its emergency switch
- A screen is served only with **both** its device token and a request from one of its event's venue addresses (the screen contract owns devices and tokens). The address alone is never enough, and an event with no venue fails the check.
- **Emergency switch:** when the venue's address changes mid-event, an event admin or the superadmin turns the check off: `PUT /api/tenants/current/venue-ip-check` with `{"enabled": false, "reason", "until"}`, right `tenants.venue_ip_check.write`. `reason` is required, `until` at most 48 hours ahead; at `until` the check turns itself back on. Turning it on again works at any time.
- While it is off the device token alone serves a screen. It changes nothing else: not the info-page mode, not `admin_access`.
- Every change, and the automatic switch back, is written to the audit log and emits `tenants.venue_ip_check.changed`. The superadmin fixes the venue's addresses (audited too), then turns the check on.

### Admin access
- `admin_access` keeps admin reachable from the internet with sign-in, behind a "venue or Tailscale only" switch that is on by default ([0022](../docs/decisions/0022-product-vision.md)). `restricted`: admin pages and every request that needs a right come only from the venue's addresses or the platform's Tailscale prefixes (`CANCCU_TAILSCALE_CIDRS`, by default `100.64.0.0/10` and `fd7a:115c:a1e0::/48`); otherwise 403 `admin_access_restricted`. `internet`: from anywhere.
- It only narrows: sign-in and rights are always needed. Changing it is a `PATCH` of the tenant (right `tenants.event.write`) and is audited.
- When a restricted event loses its venue address, admins recover over Tailscale, or the superadmin fixes the address.

## Feature flags
- Per tenant (0013 item 17): `GET /api/tenants/current/flags` → `{"flags_version", "flags"}`, readable by anyone; `PUT /api/tenants/current/flags` with `flags_version` and the flags to set, right `tenants.flags.write`. A stale `flags_version` is 409 `version_conflict`.
- A flag is named `<module>.<feature>` (e.g. `bot.stats`) and is a boolean. Each module's contract lists its flags with their defaults and declares them next to its settings; an undeclared flag is 400 `unknown_flag`. A flag never stored has its default.
- Emits `tenants.flags.changed`. Modules follow it without a restart; the bot re-registers that guild's slash commands (0013 item 15), and handlers check the flag too.

## Series and clone
- A **series** groups recurring events (0022). The superadmin creates series and puts events in them (`series_id`).
- `GET /api/tenants/current/series` → the series and its events (`id`, `name`, `status`, `starts_at`, `ends_at`), each with `caller_is_admin`. Right `tenants.event.write`. Other modules use it to check a clone source: [agenda.md](agenda.md#clone-with-an-event) asks it that both events are in one series and that the caller is an event admin of the source.
- **Clone the last event:** the superadmin creates the new event in the series; then an event admin of both events clones on the new event's hostname. Each module copies its own part through its own clone endpoint (the agenda's run-of-show, Screen's playlists, the theme, pizzerias, Discord bindings), always reading the source in the source's tenant context and writing in the new one's.
- The tenants module's part: `POST /api/tenants/current/clone` with `source_tenant_id` and `shift_seconds`, right `tenants.event.write`, only on a `draft` event that has not been cloned (409 `already_cloned`), from an event of the same series where the caller is an event admin (otherwise 403 `missing_right`). It copies the event admins, the feature flags, `info_page_mode`, `membership` and `admin_access`, and sets `starts_at` and `ends_at` to the source's plus `shift_seconds`. Not copied: members (attendees join each event themselves), venue info (it comes from the venue, copy-in), the venue IP check (always on in a new event) and the audit log. Emits `tenants.tenant.cloned`; the admin client then runs each module's clone.

## Privacy and retention
- **Privacy flags** are global per user, set by the user anywhere and read by every module (0022, the phone hub's privacy page):
  - `presence_opt_out` (default `false`): no module records presence data about the user (see the data class below); each deletes what it already holds of that class about them.
  - `memories_opt_in` (default `false`): Moments keeps a user's memories (photos and clips in which they are the subject) past the event only when it is on (the moments contract).
- `GET` and `PUT /api/tenants/me/privacy` (a signed-in user, any status of the event). Emits `tenants.privacy.changed` on the platform stream. Modules read the flags in `GET /internal/tenants/users/{user_id}` or the kit's cache.
- **Data class `presence`:** raw records of where or when a person was or what they did live: Discord presence, voice and game-activity samples, check-ins, location hints. Each module's contract names its data in this class.
- **The retention rule:** raw presence data of an event is deleted 30 days after the event is archived (0022). At archiving the tenant gets `presence_delete_at` = `archived_at` + 30 days; at that time the tenants module emits `tenants.retention.reached` with `data_class: "presence"`, and every module deletes its presence data of that tenant. A module also checks `presence_delete_at` at start-up, so a missed event is caught. Memories are kept only when opted in (above). Other data stays until the tenant is deleted; each module's contract may set shorter periods.
- **Deleting a user** (GDPR, 0013 item 31): `DELETE /api/tenants/users/{user_id}`, superadmin. Emits `tenants.user.deleted` on the platform stream; every module deletes that user's rows, keys and files in every tenant. The audit log keeps an anonymous id (see Audit log). Self-service account deletion belongs to the hub's privacy centre.
- **Deleting a tenant:** `DELETE /api/tenants/registry/{tenant_id}`, superadmin, only for a `draft` or `archived` event (409 `tenant_live`). Emits `tenants.tenant.deleted` on the platform stream; every module deletes the tenant's rows, Valkey keys, streams and files. Its hostnames become `held`.

## Audit log
Append-only (0013 item 13): no API changes or deletes an entry, and the module's database role may only insert into it.

- **Covered:** settings, roles and rights, membership changes by admins, lifecycle, feature flags, hostnames, venues and their addresses, each event's venue, the venue IP check (also its automatic switch back), `admin_access`, devices' current tenant, bot bindings, secret changes (which secret and who, never the value), support windows, superadmins, tenant creation and deletion, and user deletion.
- **An entry** (`AuditEntry`): `id`, `time`, `tenant_id` (`null` for a platform entry), `actor` (`kind`: `user`, `system` or `module`; `ref`; `superadmin`; `support`), `action` (named like an event, `<module>.<noun>.<past-tense verb>`, e.g. `tenants.venue_ip_check.changed`), `target` (`type`, `id`), `changes` (field names with old and new values; secret values never appear), `reason` (when given) and `correlation_id`.
- **Other modules append** with `POST /internal/tenants/audit`, in the same request that made the change; the tenants module records its own changes itself.
- **Reading:** `GET /api/tenants/current/audit` (right `tenants.audit.read`) for the event's entries; `GET /api/tenants/audit?tenant_id=` for the superadmin, also platform entries. Newest first, paged with `before`.
- **Pseudonymisation:** entries never hold a name or a Discord id, only `actor.ref`, the user's audit reference (`aud_…`), kept on the user row. While the user exists, reads show their `user_id` and `name` next to it. Deleting the user deletes the link, so the entries keep only the anonymous reference, unchanged, and the log stays append-only.
- Per-tenant entries are deleted with their tenant; platform entries stay.

## Superadmin
On the superadmin hostname only; on any other hostname these paths answer 404 `not_found`. Every call needs a superadmin with `mfa_enabled`. All of it is audited.

- **Tenants:** `GET`, `POST /api/tenants/registry`; `GET`, `PATCH`, `DELETE /api/tenants/registry/{tenant_id}`; `POST …/status`. Creating takes `id`, `name`, `time_zone` and optionally `venue_id`, `series_id`, `starts_at`, `ends_at` and the first event admins, and emits `tenants.tenant.created`. `PATCH` also sets `venue_id` and `series_id`.
- **Event admins of any tenant:** `PUT`, `DELETE /api/tenants/registry/{tenant_id}/admins/{user_id}`, so a new event gets its first admin.
- **Hostnames:** `GET`, `POST /api/tenants/registry/{tenant_id}/hostnames`; `PATCH` (make primary) and `DELETE /api/tenants/hostnames/{hostname}`; `POST /api/tenants/hostnames/{hostname}/verify`.
- **Venues:** `GET`, `POST /api/tenants/venues`; `GET`, `PATCH`, `DELETE /api/tenants/venues/{venue_id}`; `PUT /api/tenants/venues/{venue_id}/floor-plan`. Changing a venue emits `tenants.venue.changed`.
- **Series:** `GET`, `POST /api/tenants/series`; `PATCH /api/tenants/series/{series_id}`.
- **Users:** `GET /api/tenants/users?q=` (find a user by name or Discord id); `DELETE /api/tenants/users/{user_id}`.
- **Superadmins:** `GET /api/tenants/superadmins`; `PUT`, `DELETE /api/tenants/superadmins/{user_id}`. Removing the last one is 409 `last_superadmin`. The first superadmin is set from a shell on the VM (setup).
- **Audit:** `GET /api/tenants/audit`.

## Rights
`tenants.event.write` (the event's fields, series view, clone), `tenants.lifecycle.write` (status; role only), `tenants.admins.write` (event admins; role only), `tenants.members.read`, `tenants.members.write`, `tenants.flags.write`, `tenants.venue_info.write`, `tenants.venue_ip_check.write`, `tenants.audit.read`. The superadmin's actions need the role, not a right.

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events); the envelope's `tenant` field and the platform stream: [events.md](events.md#tenant-in-the-envelope). Listed in the catalog: [events.md](events.md#tenants). Events carry ids and changed field names, never secret values or Discord ids.

On the tenant's stream `t:<tenant>:events:tenants`, with `tenant` set:

| Type | When | `data` |
|---|---|---|
| `tenants.tenant.changed` | The event's fields changed (also its venue or series) | `changed` (field names), `revision`, `actor_user_id` |
| `tenants.status.changed` | The lifecycle moved | `from`, `to`, `presence_delete_at` (when archived), `actor_user_id` |
| `tenants.tenant.cloned` | The tenants part of a clone ran | `source_tenant_id`, `shift_seconds`, `actor_user_id` |
| `tenants.flags.changed` | Feature flags were set | `flags_version`, `changed` (flag names), `flags` (all, with defaults), `actor_user_id` |
| `tenants.venue_info.changed` | The event's venue info was edited or copied again | `changed`, `copied` (true for a copy from the venue), `actor_user_id` |
| `tenants.venue_ip_check.changed` | The venue IP check was switched | `enabled`, `until`, `actor_user_id` (`null` for the automatic switch back) |
| `tenants.admin.added`, `tenants.admin.removed` | A user became or stopped being an event admin | `user_id`, `actor_user_id` |
| `tenants.member.joined`, `tenants.member.left` | A user joined or left, or an admin added or removed them | `user_id`, `actor_user_id` |
| `tenants.support.opened`, `tenants.support.closed` | A superadmin's support window opened or closed | `user_id`, `until` |
| `tenants.retention.reached` | A retention date of the event was reached | `data_class` (`presence`) |

On the platform stream `events:tenants`, without `tenant`:

| Type | When | `data` |
|---|---|---|
| `tenants.tenant.created` | A tenant was created; consumers start reading its streams without a restart (0013 item 7) | `tenant_id`, `status` |
| `tenants.tenant.deleted` | A tenant was deleted; every module deletes its data | `tenant_id` |
| `tenants.hostname.changed` | A hostname was added, verified, made primary, held or released | `hostname`, `tenant_id`, `status`, `primary` |
| `tenants.venue.changed` | A venue was created, edited or deleted | `venue_id`, `changed` (field names), `deleted` |
| `tenants.privacy.changed` | A user's privacy flags changed | `user_id`, `presence_opt_out`, `memories_opt_in` |
| `tenants.user.deleted` | A user was deleted; every module deletes their data in every tenant | `user_id` |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e61", "type": "tenants.venue_ip_check.changed", "version": 1,
 "time": "2026-01-01T17:40:00Z", "source": "tenants", "tenant": "demo",
 "data": {"enabled": false, "until": "2026-01-02T06:00:00Z", "actor_user_id": "u_123"}}
```

## Not in this contract
The implementation (the tenants module, #50; the kit's tenancy, #49). Devices, their tokens, zones and assignments (the screen contract, #35). The central sign-in and its sessions (#52). Bot connections and Discord bindings (the bot contract, #53). The admin module's rework for tenants (#56).
