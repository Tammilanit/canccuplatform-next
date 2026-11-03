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

## Session and rights
- Signing in (Discord, first-run code: #10) ends in a session. The session id is the opaque cookie `cp_session` (HttpOnly, SameSite=Lax, Secure when served over HTTPS); the session itself lives in Postgres, so any container can serve any request.
- `GET /api/admin/session` → `{"user": {"id", "name"}, "rights": [...], "expires_at"}`, or 401 `not_signed_in`.
- `POST /api/admin/session/sign-out` → 204 and clears the cookie.
- **Rights** are strings `<module>.<right>`, e.g. `admin.settings.write`, `tournament.matches.edit`. Each module's contract lists its rights.
- **Rights check:** a module calls `GET /api/admin/session` with the user's cookie and allows the request when the right is in `rights`; otherwise it answers 401 (no session) or 403 `missing_right`. The kit wraps this call. A module may cache the answer for at most 30 seconds and drops it on `admin.rights.changed` for that user.

Admin's own rights: `admin.settings.read`, `admin.settings.write`, `admin.profile.read`, `admin.profile.write`, `admin.rights.write`.

## Profile
- `GET /api/admin/profile` exports the current profile as a zip of `profile.yaml` and `assets/`. Right: `admin.profile.read`. Emits `admin.profile.saved`.
- `PUT /api/admin/profile` imports a zip. Right: `admin.profile.write`. The profile is upgraded step by step to the current `schema_version`, validated, then applied; emits `admin.profile.loaded`. Errors: 400 `profile_invalid`, 400 `profile_too_new`.
- The format and its version rule: [profile.md](profile.md).

## Events
### Naming
`<module>.<noun>.<past-tense verb>`: lowercase, dot-separated, words inside a part joined with `_`. The first part is always the module that emits it. Examples: `admin.settings.changed`, `tournament.match.finished`.

### Transport
- Valkey Streams, one stream per emitting module: `events:<module>`. Each entry has one field, `event`, holding the envelope as JSON.
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
