# Admin contract

The admin module stores settings, holds sign-in sessions and rights, saves and loads the event profile, and fixes the shapes every module shares: the health endpoint, event names and the event envelope.

**Machine-readable API: [admin.openapi.yaml](admin.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Health
Every module serves `GET /health` with the same shape (`Health` in the OpenAPI file). No authentication.

```json
{"status": "ok", "module": "admin", "version": "v0.1.0", "time": "2026-01-01T12:00:00Z",
 "checks": {"postgres": {"status": "ok"}, "valkey": {"status": "ok"}}}
```
- `status`: `ok` (all checks ok), `degraded` (works with reduced function, e.g. a non-essential dependency down), `down` (cannot serve).
- HTTP 200 for `ok` and `degraded`, 503 for `down`, so plain HTTP probes work.
- `version` is the platform version (git tag) the module runs. `checks` has one entry per dependency, with an optional `detail` for people.
- **Health note:** `GET /api/admin/health/note` → `{"status", "text"}`, what the organiser menu's Health item says on every module's shell ("Health 1 down", docs/design/mockups.html sheet 2). Right: `admin.settings.read`, the right that opens Health. It answers from admin's latest check of every part (every 10 seconds) and never waits for a new one. `status` is `down` when some part is down, else `degraded` when some part is slow, else `ok`; `text` says how many, down first (`"1 down, 2 slow"`), and is `""` with `ok`. Before admin's first check it is `ok` with `""`. For the shell only: a module reads health from each part's own `/health`.

## Settings
- `GET /api/admin/settings/{module}` → `{"module", "settings_version", "values", "groups"}`. Right: `admin.settings.read`, or `<module>.settings.read` for a module reading its own settings.
- `PUT /api/admin/settings/{module}` with `{"settings_version", "values"}` replaces the values. Right: `admin.settings.write`.
  - Optimistic concurrency: send the `settings_version` you read. A stale one gets 409 `version_conflict`; read again and retry.
  - On success `settings_version` goes up by one and `admin.settings.changed` is emitted.
- `settings_version` is 0 for a module with no stored settings.
- **Groups:** the settings answer (the `Settings` shape of `GET` and `PUT`, and of the internal read and write below) also carries `groups`: how the organiser's Settings form groups the module's declared settings, in the order the form shows them, each `{"id", "label", "description", "keys"}`. `id` is lowercase `snake_case` and unique in the module; `label` is the group's heading and `description` one line under it, both in the event's language (admin's `language` setting below); `keys` lists the group's settings in order, at least one, none twice. Admin declares each module's groups together with that module's settings declarations, so a deploy is what changes them. Every declared key is in exactly one group, and a module that declares no settings has `[]`. Groups describe the form, never the values: a client that draws no form ignores them, and a key in `values` that no group names (a profile may carry any) is still a setting. A form draws only the keys its groups name: it shows such a key nowhere, and with `groups` `[]` it draws no fields. An answer without `groups` reads as `[]`. `settings_version` counts writes of the values only: a deploy that changes the groups leaves it as it is, so a client that keeps an answer by its version still takes `groups` from each fresh read.
- Values are strings, numbers, booleans or flat lists of those, keyed by lowercase `snake_case` keys, the same as in a profile ([profile.md](profile.md)).
- Settings are never secrets. A setting that needs one names the environment variable instead.
- Modules read their settings at start and follow `admin.settings.changed` instead of polling.
- **A module reads its own settings** for the tenant it serves with `GET /internal/admin/settings/{module}?tenant_id=` on admin's internal address, where no hostname names a tenant: the same answer as `GET /api/admin/settings/{module}` for that tenant. The kit's settings client calls it, with `tenant_id` from the tenant in scope. Internal network only ([README.md](README.md#conventions)).
- **Admin's own settings** (module `admin`) hold the event's `language` (`en` or `fi`; default `en`): the language of the event's organiser pages and screens, English first, Finnish from step 10. Every module may read them with `GET /internal/admin/settings/admin?tenant_id=`, the one module's settings another module reads, so its pages follow the event's language; a module still reads no other module's settings (403 `service_forbidden`).
- **A module writes its own settings** for one tenant with `PATCH /internal/admin/settings/{module}?tenant_id=` and `{"settings_version", "values", "actor_user_id"}`: the keys in `values` are set, every other key stays as it is. For settings that are, by the module's own contract, the same values as something the module stores (for example Notify's `topics` and `schedule_lead_minutes`), so that writing either way changes both; and for settings the module's own endpoint edits besides admin's Settings form (for example Screen's `motion_level` and `follow_the_day`, `PUT /api/screen/motion`, under that endpoint's right), which have no copy in the module's store. Internal network only.
  - Only the module itself: the service identity's caller must be `{module}`, others get 403 `service_forbidden`; no valid service identity is 401 `service_unauthenticated`. The shared key proves "a module of this stack", not which one ([README.md](README.md#conventions), Internal paths), so this check stops mistakes, not a module that signs as another.
  - Admin accepts only the keys and value types the module's own contract lists for its settings; anything else is 400 `invalid_request`. A stale `settings_version` is 409 `version_conflict`: the version covers the whole document, so an organiser's change to any other key makes the write stale; read again and retry. An archived event is 409 `event_archived` ([tenants.md](tenants.md#lifecycle)); the calling module refuses its own writes on an archived event before it calls, and this answer only covers a module that has not yet followed `tenants.status.changed`.
  - `actor_user_id` is always a user, the one whose change in the module caused the write: a module never mirrors a system change through this path. On success `settings_version` goes up by one and `admin.settings.changed` is emitted with that `actor_user_id`; its `keys` are the keys in `values` whose value changed (empty when none did).
  - Order and recovery: within one request the calling module writes admin first and commits its own store (if it keeps a copy) only after admin answers 200. On a 409 it reads again and retries, or fails its own request without committing, so the two copies never drift apart. It audits the change in its own audit entry ([tenants.md](tenants.md#audit-log)), inside the same request; admin does not audit it again.
  - The calling module ignores an `admin.settings.changed` whose `settings_version` it has already applied (its own write), so it neither writes back nor audits twice.

## Session and rights
- Signing in (through a sign-in provider, today Discord; see [Sign-in providers](#sign-in-providers)) ends in a session. The session id is the opaque cookie `canccu_session` (HttpOnly, SameSite=Lax, Secure when served over HTTPS); the session itself lives in Postgres, so any container can serve any request.
- **From the central sign-in host (#52) on, the cookie is a `__Host-` cookie:** over HTTPS it is named `__Host-canccu_session` and set with `Secure`, `Path=/` and no `Domain`, so no other hostname (another event's hostname or any subdomain of the platform domain included) can set or overwrite it. Session cookies the platform adds later follow the same rule ([theming.md](theming.md#the-sandbox)). Browsers refuse the prefix over plain http, so the IP-mode demo stack keeps `canccu_session`. Modules never name the cookie themselves: the kit reads it and forwards it to `GET /api/admin/session`.
- `GET /api/admin/session` → `{"user": {"id", "name"}, "rights": [...], "expires_at", "superadmin"}`, or 401 `not_signed_in`.
- **`superadmin`** is true only for a session bound to the platform (signed in for the superadmin hostname, see [Sign-in providers](#sign-in-providers)) of a superadmin whose sign-in identity for this session has `mfa_enabled` ([tenants.md](tenants.md#sign-in-identities)). Every other session has `false`: a superadmin on a tenant's hostname acts there only through a support window, as an event admin, never as superadmin. A missing field counts as `false`. A module's superadmin paths (such as Screen's device registry) check it through the kit, and answer only on the superadmin hostname, as the tenants module's do ([tenants.md](tenants.md#superadmin)).
- `POST /api/admin/session/sign-out` → 204 and clears the cookie.
- **Rights** are strings `<module>.<right>`, e.g. `admin.settings.write`, `tournament.matches.edit`. Each module's contract lists its rights.
- **Rights check:** a module calls `GET /api/admin/session` with the user's cookie and allows the request when the right is in `rights`; otherwise it answers 401 (no session) or 403 `missing_right`. The kit wraps this call. A module may cache the answer for at most 30 seconds and drops it on `admin.rights.changed` for that user.

Admin's own rights: `admin.settings.read`, `admin.settings.write`, `admin.profile.read`, `admin.profile.write`, `admin.rights.write`.

### Granting rights
A session's `rights` are those of the user's role in the event (an event admin holds every right) plus the rights granted to the user one by one, without the role ([tenants.md](tenants.md#users-roles-and-membership)).
- `GET /api/admin/rights/{user_id}` → `{"user_id", "rights", "rights_version", "event_admin"}`: the rights granted to that member of the request's event, never the role's; `event_admin` says whether the role is held too. Right `admin.rights.write`.
- `PUT /api/admin/rights/{user_id}` with `{"rights", "rights_version"}` replaces the granted list (empty takes all away). Right `admin.rights.write`, and the caller must hold every right the change adds or removes (otherwise 403 `missing_right`), so a granted `admin.rights.write` never passes on more than its holder has. A role-only right is 400 `right_role_only`; a user who is not a member of the event is 404 `not_found`; a stale `rights_version` is 409 `version_conflict`; an archived event is 409 `event_archived`. Audited (action `admin.rights.changed`, the old and new lists in `changes`); emits `admin.rights.changed` with the full new list.
- **Presets:** `GET /api/admin/rights/presets` (right `admin.rights.write`) → `{"presets": [{"id", "module", "rights"}]}`. A preset is a name a module's contract gives to a list of rights, never a role: granting it is one `PUT` with its rights added to the member's list, and each right can then be taken away alone. Today: `screen_crew` ([screen.md](screen.md#rights)).
- Granted rights end with the membership: when a member leaves or is removed (`tenants.member.left`), or the user is deleted (`tenants.user.deleted`), admin drops their granted rights in that event and emits `admin.rights.changed` with an empty list. The list is emptied, never deleted, so `rights_version` keeps counting and a write read before the member left is stale after they rejoin. Losing the event-admin role (`tenants.admin.removed`) does not end granted rights, by design: an event admin who steps down to crew keeps the rights granted to them one by one, and `event_admin` with the list shows what they hold.

## Sign-in providers
Sign-in starts Discord-only (the product owner, 2026-11-08). The central sign-in host ([#52](../docs/roadmap.md#2b-tenancy-foundation)) is built around a provider interface, so a username-and-password login, or another provider, is added later as one more provider, without touching users, sessions, rights or the hand-off to event hosts.

- **A provider** has an id (`discord`; `SignInProvider` in [tenants.openapi.yaml](tenants.openapi.yaml)) and does only this: **start** (send the browser to the provider, or show its own form), then **finish** (the provider's callback, or a credential check) with a verified `(provider, subject)`, a display name and `mfa_enabled`. Nothing a provider returns reaches a session or a right except through the next step.
- **One path after that, for every provider:** the identity is mapped to a user by the tenants module (`POST /internal/tenants/identities/sign-in`, [tenants.md](tenants.md#sign-in-identities)); then the session is made (rotated on sign-in, stored in Postgres, the cookie above), scoped by `return_to`, and handed over by the one-time code of #52. Sessions, rights, `GET /api/admin/session`, the hand-off and the event hosts never depend on the provider. The session records which identity it signed in with, so the superadmin check reads that identity's `mfa_enabled`.
- **Scope of the session, by `return_to`:** a tenant's hostname gives a session bound to that one tenant; the superadmin hostname gives a session bound to the platform, as on that hostname today ([tenants.md](tenants.md#superadmin)); no `return_to` leaves only the sign-in host's own session, bound to no tenant and holding no rights (#52 decides what it is used for, such as a later hand-off without signing in again). On the IP-mode demo stack the one host serves the demo tenant, so its session is bound to it.
- **Login CSRF, for every redirect provider:** the origin check on start stops another site from starting a sign-in in the browser. That is not enough on its own, because someone can start a flow themselves, approve it with their own account and pass the unopened callback URL to someone else (a QR code at the venue, a chat link), who would then be signed in as them. So start also sets a short-lived flow cookie, `__Host-canccu_sign_in` over HTTPS (`canccu_sign_in` on plain http), whose hash is kept with the `state`, and the callback refuses a `state` whose browser does not carry the matching cookie (`state_invalid`). The `__Host-` prefix needs `Path=/`, so the cookie is set there, HttpOnly and SameSite=Lax, and lives no longer than the `state`. The `state` is used up and the cookie cleared on every outcome.
- **Paths,** on the central sign-in host (on the IP-mode demo stack, its one host), all under `/api/admin/auth/`: `GET …/providers` lists the enabled providers for the sign-in page, which shows one choice per provider and names none itself. A redirect provider has `POST …/{provider}/start` (from the sign-in page, with an optional `return_to`; it answers the provider's `redirect_url`, like the bot's bind flow, and sets the flow cookie) and `GET …/{provider}/callback`; Discord's redirect URI is `https://<sign-in host>/api/admin/auth/discord/callback`. A credential provider would have `POST …/{provider}/credentials` (not built). A provider that is not enabled answers 404 `not_found` on all of them.
- **The first-run code** (#10) is not a provider: it rides on a sign-in with an enabled provider and makes that user the owner.
- **The enabled providers** are the platform setting `CANCCU_SIGN_IN_PROVIDERS`: provider ids, comma-separated, default `discord`. Admin (the sign-in host) and the tenants module both read it; a name the platform does not know, or an empty list, stops the module at start with a clear message. Today `discord` is the only provider, so every account is a Discord account: that policy is this setting, not a schema rule. It is a platform setting, not a per-event one, because users are global. Enabling a provider other than `discord` needs the contract change first ([tenants.md](tenants.md#sign-in-identities)).

**A password provider, later (not built, out of scope now).** What it would need, so the interface leaves room for it:
- Hashes with argon2id (a per-hash salt, parameters stored with each hash, rehash on sign-in when the parameters change); never a plain or reversible password, in a row, a log or an event.
- Rate limits per account and per address, with backoff and a temporary lockout; the same answer for an unknown name and a wrong password, so it does not tell which names exist; failed and locked sign-ins in the audit log.
- Reset by e-mail (a single-use, short-lived link; it needs an e-mail address, which is personal data, and a mail sender) or by an event admin or the superadmin (a single-use reset link, audited); never a password set or shown by an admin.
- Optional TOTP as a second factor, with recovery codes; it sets that identity's `mfa_enabled`, so a password identity can meet the superadmin check only with it.
- Its subject (a normalised username), a sign-up or invite flow, and linking it to an existing user, as a contract change of its own.

## Profile
- `GET /api/admin/profile` exports the current profile as a zip of `profile.yaml` and `assets/`. Right: `admin.profile.read`. Emits `admin.profile.saved`.
- `PUT /api/admin/profile` imports a zip. Right: `admin.profile.write`. The profile is upgraded step by step to the current `schema_version`, validated, then applied; emits `admin.profile.loaded`. Errors: 400 `profile_invalid`, 400 `profile_too_new`.
- **For theming** ([theming.md](theming.md), which applies the profile's design while an event has no published revision): `GET /internal/admin/profile/theme?tenant_id=` → `theme` (the profile's `theme` as it is, `{}` without one) and `logo_main` (`sha256` and `bytes` of the file `logos.main` names, or `null`); `GET /internal/admin/profile/logo?tenant_id=` → that file's bytes with its SHA-256 as the `ETag`, 404 `not_found` when there is none. Theming reads them when it holds no copy and again on `admin.profile.loaded`, which an import emits only once the new files are stored. An event without a profile answers `{}` and `null`; an event the tenants module does not know is 404 `not_found` on both paths. Only theming may call them, with its service identity (any other module is 403 `service_forbidden`). Internal network only ([README.md](README.md#conventions)).
- The format and its version rule: [profile.md](profile.md).

## Events
### Naming
`<module>.<noun>.<past-tense verb>`: lowercase, dot-separated, words inside a part joined with `_`. The first part is always the module that emits it. Examples: `admin.settings.changed`, `tournament.match.finished`.

### Transport
- Valkey Streams, one stream per emitting module: `events:<module>`. Each entry has one field, `event`, holding the envelope as JSON.
- With tenancy, an event that concerns one event (tenant) goes to that tenant's stream `t:<tenant>:events:<module>`; an event that concerns the platform as a whole stays on `events:<module>` ([events.md](events.md#tenant-in-the-envelope)).
- Delivery is at least once. Consumers dedupe by `id` and must tolerate events they do not know.

### Envelope
Every event, from every module, uses this envelope.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string, UUID v7 | yes | Unique event id; dedupe key; sorts by time |
| `type` | string | yes | Event name, as in Naming |
| `version` | integer ≥ 1 | yes | Version of this event type's `data` shape. Additive changes keep it; a breaking change bumps it (and needs a person's approval) |
| `time` | string, RFC 3339 UTC | yes | When it happened |
| `source` | string | yes | Emitting module; equals the first part of `type` |
| `tenant` | string | for tenant events | The tenant (event) id the event concerns; absent on platform events ([tenants.md](tenants.md), [events.md](events.md#tenant-in-the-envelope)) |
| `correlation_id` | string | no | Id of the request or event that caused it, for tracing |
| `data` | object | yes | Payload, documented per event below |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e5f", "type": "admin.settings.changed", "version": 1,
 "time": "2026-01-01T12:00:00Z", "source": "admin",
 "data": {"module": "screen", "keys": ["rotation_seconds"], "settings_version": 4, "actor_user_id": "u_123"}}
```

### Admin events (version 1)
| Type | When | `data` |
|---|---|---|
| `admin.settings.changed` | A module's settings were written | `module`, `keys` (changed keys), `settings_version` (new), `actor_user_id` |
| `admin.profile.loaded` | A profile was imported and applied | `profile_name`, `schema_version`, `actor_user_id` |
| `admin.profile.saved` | A profile was exported | `profile_name`, `schema_version`, `actor_user_id` |
| `admin.rights.changed` | A user's rights changed | `user_id`, `rights` (the full new list of rights granted one by one, never the role's), `actor_user_id` |

Events carry ids and changed keys, never secret values. Consumers that need the new settings read them through the settings API.
