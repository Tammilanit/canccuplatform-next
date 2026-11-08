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

## Settings
- `GET /api/admin/settings/{module}` → `{"module", "settings_version", "values"}`. Right: `admin.settings.read`, or `<module>.settings.read` for a module reading its own settings.
- `PUT /api/admin/settings/{module}` with `{"settings_version", "values"}` replaces the values. Right: `admin.settings.write`.
  - Optimistic concurrency: send the `settings_version` you read. A stale one gets 409 `version_conflict`; read again and retry.
  - On success `settings_version` goes up by one and `admin.settings.changed` is emitted.
- `settings_version` is 0 for a module with no stored settings.
- Values are strings, numbers, booleans or flat lists of those, keyed by lowercase `snake_case` keys, the same as in a profile ([profile.md](profile.md)).
- Settings are never secrets. A setting that needs one names the environment variable instead.
- Modules read their settings at start and follow `admin.settings.changed` instead of polling.
- **A module reads its own settings** for the tenant it serves with `GET /internal/admin/settings/{module}?tenant_id=` on admin's internal address, where no hostname names a tenant: the same answer as `GET /api/admin/settings/{module}` for that tenant. The kit's settings client calls it, with `tenant_id` from the tenant in scope. Internal network only ([README.md](README.md#conventions)).

## Session and rights
- Signing in (through a sign-in provider, today Discord; see [Sign-in providers](#sign-in-providers)) ends in a session. The session id is the opaque cookie `canccu_session` (HttpOnly, SameSite=Lax, Secure when served over HTTPS); the session itself lives in Postgres, so any container can serve any request.
- **From the central sign-in host (#52) on, the cookie is a `__Host-` cookie:** over HTTPS it is named `__Host-canccu_session` and set with `Secure`, `Path=/` and no `Domain`, so no other hostname (another event's hostname or any subdomain of the platform domain included) can set or overwrite it. Session cookies the platform adds later follow the same rule ([theming.md](theming.md#the-sandbox)). Browsers refuse the prefix over plain http, so the IP-mode demo stack keeps `canccu_session`. Modules never name the cookie themselves: the kit reads it and forwards it to `GET /api/admin/session`.
- `GET /api/admin/session` → `{"user": {"id", "name"}, "rights": [...], "expires_at"}`, or 401 `not_signed_in`.
- `POST /api/admin/session/sign-out` → 204 and clears the cookie.
- **Rights** are strings `<module>.<right>`, e.g. `admin.settings.write`, `tournament.matches.edit`. Each module's contract lists its rights.
- **Rights check:** a module calls `GET /api/admin/session` with the user's cookie and allows the request when the right is in `rights`; otherwise it answers 401 (no session) or 403 `missing_right`. The kit wraps this call. A module may cache the answer for at most 30 seconds and drops it on `admin.rights.changed` for that user.

Admin's own rights: `admin.settings.read`, `admin.settings.write`, `admin.profile.read`, `admin.profile.write`, `admin.rights.write`.

## Sign-in providers
Sign-in starts Discord-only (the product owner, 2026-11-08). The central sign-in host ([#52](../docs/roadmap.md#2b-tenancy-foundation)) is built around a provider interface, so a username-and-password login, or another provider, is added later as one more provider, without touching users, sessions, rights or the hand-off to event hosts.

- **A provider** has an id (`discord`; `SignInProvider` in [tenants.openapi.yaml](tenants.openapi.yaml)) and does only this: **start** (send the browser to the provider, or show its own form), then **finish** (the provider's callback, or a credential check) with a verified `(provider, subject)`, a display name and `mfa_enabled`. Nothing a provider returns reaches a session or a right except through the next step.
- **One path after that, for every provider:** the identity is mapped to a user by the tenants module (`POST /internal/tenants/identities/sign-in`, [tenants.md](tenants.md#sign-in-identities)); then the session is made (rotated on sign-in, stored in Postgres, the cookie above), bound to one tenant, and handed to the event's hostname by the one-time code of #52. Sessions, rights, `GET /api/admin/session`, the hand-off and the event hosts never depend on the provider. The session records which identity it signed in with, so the superadmin check reads that identity's `mfa_enabled` and the audit log names the provider (never a subject).
- **Paths,** on the central sign-in host (on the IP-mode demo stack, its one host), all under `/api/admin/auth/`: `GET …/providers` lists the enabled providers for the sign-in page, which shows one choice per provider and names none itself. A redirect provider has `POST …/{provider}/start` (from the sign-in page, with an optional `return_to`; it answers the provider's `redirect_url`, like the bot's bind flow) and `GET …/{provider}/callback`; Discord's redirect URI is `https://<sign-in host>/api/admin/auth/discord/callback`. A credential provider would have `POST …/{provider}/credentials` (not built). A provider that is not enabled answers 404 `not_found` on all of them.
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
| `admin.rights.changed` | A user's rights changed | `user_id`, `rights` (full new list), `actor_user_id` |

Events carry ids and changed keys, never secret values. Consumers that need the new settings read them through the settings API.
