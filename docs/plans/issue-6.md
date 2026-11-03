# Plan: issue #6 — Contract: admin API and profile format v1

Branch `6-admin-profile-contract`. Parent epic #15; runs in parallel with #5 (the sign-in redirect decision does not change the session contract). Consumers: #7 (kit), #10 and #11 (admin), #12 (setup).

## Files
| File | New/changed | Purpose |
|---|---|---|
| `contracts/README.md` | new | Index of contracts, shared conventions, the check command |
| `contracts/admin.md` | new | Prose admin contract: settings, health, session and rights, events; points to the OpenAPI file |
| `contracts/admin.openapi.yaml` | new | Machine-readable admin API (OpenAPI 3.1) |
| `contracts/profile.md` | new | Profile format v1: layout, contents, exclusions, upgrade rule |
| `contracts/profile.schema.json` | new | JSON Schema (draft 2020-12) for `profile.yaml` |
| `events/demo/profile.yaml` | new | Demo profile, validates against the schema |
| `events/demo/assets/…` | new | Placeholder logo (hand-written SVG) and one generated tone (WAV) |
| `scripts/check-contracts` | new | The named validation command |
| `.github/workflows/ci.yml` | changed | New `contracts` job runs `scripts/check-contracts` |
| `docs/ci.md` | changed | Documents the `contracts` check |

## Shared conventions (in `contracts/README.md`)
- JSON over HTTP, `snake_case` fields, times in RFC 3339 UTC.
- Error body for every non-2xx: `{"error": {"code": "<snake_case>", "message": "<text>"}}`.
- Module names are the directory names under `modules/`.
- Additive-only rule from AGENTS.md repeated, with a pointer.

## Event naming and envelope (in `contracts/admin.md`, section "Events")
- **Name:** `<module>.<noun>.<verb in past tense>`, lowercase, dot-separated, e.g. `admin.settings.changed`. The first part is always the emitting module.
- **Transport:** Valkey Streams, one stream per emitting module named `events:<module>`; one field `event` holding the JSON envelope. Delivery is at least once; consumers dedupe by `id`.
- **Envelope fields** (all required except `correlation_id`):

| Field | Type | Meaning |
|---|---|---|
| `id` | string (UUID v7) | Unique event id; dedupe key, time-ordered |
| `type` | string | Event name as above |
| `version` | integer ≥ 1 | Version of this event type's `data` shape; additive changes keep it, breaking ones bump it |
| `time` | string (RFC 3339 UTC) | When the event happened |
| `source` | string | Emitting module name; equals the first part of `type` |
| `correlation_id` | string, optional | Id of the request or event that caused it, for tracing |
| `data` | object | Event-specific payload, documented per event |

- **Admin events (v1):**
  - `admin.settings.changed` — `data`: `module`, `keys` (changed keys), `settings_version`, `actor_user_id`.
  - `admin.profile.loaded` — `data`: `profile_name`, `schema_version`, `actor_user_id`.
  - `admin.profile.saved` — `data`: `profile_name`, `schema_version`, `actor_user_id`.
  - `admin.rights.changed` — `data`: `user_id`, `rights` (full new list), `actor_user_id`.

## Admin API (in `admin.openapi.yaml`, summarised in `admin.md`)
- **Health — every module:** `GET /health` → `{"status": "ok"|"degraded"|"down", "module", "version", "time", "checks": {"<name>": {"status", "detail"?}}}`. HTTP 200 for `ok` and `degraded`, 503 for `down`. No auth. Defined once as a shared component that other modules' contracts reference.
- **Settings:** `GET /api/admin/settings/{module}` → `{"module", "settings_version", "values": {…}}`. `PUT /api/admin/settings/{module}` with body `{"settings_version", "values"}`: optimistic concurrency, 409 `version_conflict` if stale; needs right `admin.settings.write`; emits `admin.settings.changed`. Values are never secrets (secrets come from the environment).
- **Session and rights:** session is an opaque cookie `cp_session`, stored in Postgres (containers keep no state). `GET /api/admin/session` → `{"user": {"id", "name"}, "rights": ["<module>.<right>", …], "expires_at"}` or 401. Other modules check rights by calling this endpoint with the user's cookie and looking for the right; the kit (#7) wraps this. Rights are named `<module>.<right>`. `POST /api/admin/session/sign-out` → 204. The sign-in flow itself (Discord, first-run code) belongs to #10 and is not specified here beyond the session it produces.
- **Profile:** `GET /api/admin/profile` exports the current profile (zip of `profile.yaml` + `assets/`); `PUT /api/admin/profile` imports one, validating and upgrading it (see below); need right `admin.profile.write`; emit `admin.profile.saved` / `admin.profile.loaded`. Implemented in #11.

## Profile format v1 (in `profile.md` and `profile.schema.json`)
- **Layout:** a directory with `profile.yaml` and an `assets/` folder; asset paths in the YAML are relative, may not start with `/` or contain `..` (enforced by pattern).
- **Top-level fields:** `schema_version` (integer, `const: 1` in this schema), `name`, `settings` (`{<module>: {<key>: value}}`), `theme` (colour and font tokens, names aligned with #8 later, additive), `logos` (`{<role>: <path>}`), `sounds` (`{<name>: <path>}`), `modules` (list of module names, enum of the nine modules). `additionalProperties: false` at the top level.
- **Not in a profile:** live data (scores, brackets, orders, chat), secrets (tokens, passwords, OAuth client secrets), uploaded media (moments, voices). `profile.md` states where each lives instead.
- **Upgrade rule:** `schema_version` is an integer starting at 1. The loader upgrades one step at a time (n → n+1) with one upgrader per step until it reaches the current version; a version newer than the platform supports is rejected with `profile_too_new`. The schema `$id` carries the version; when v2 arrives, v1's schema is kept as `profile.v1.schema.json` (additive).

## Demo profile and assets
- `events/demo/profile.yaml`: name "Demo Event", all nine modules, a few demo settings, a theme, one logo, one sound.
- `assets/logo.svg`: hand-written SVG with the text "Demo". `assets/sounds/chime.wav`: a short sine tone generated once with Python's `wave` module (the generator is not committed; `profile.md` notes how it was made).
- Nothing from legacy repos; no real event names (the `no-event-names` check covers it).

## Validation command
- `scripts/check-contracts [--dry-run]`:
  1. Validates `events/demo/profile.yaml` against `contracts/profile.schema.json` with `npx --yes ajv-cli@5 validate --spec=draft2020 -c ajv-formats`.
  2. Checks every asset path in the demo profile exists.
  3. Lints `contracts/admin.openapi.yaml` with `npx --yes @redocly/cli@1 lint`.
  - Clear message and non-zero exit on any failure; `--dry-run` prints the steps without running them.
- CI: new job `contracts` (name `contracts`) with Node 22 runs it. `docs/ci.md` gets a row; a maintainer adds it to the required checks after merge.

## Steps (each checked before the next)
1. `contracts/README.md` with conventions. Check: read through against AGENTS.md rules.
2. `contracts/profile.schema.json` + `contracts/profile.md`. Check: schema compiles (`ajv compile`).
3. `events/demo/profile.yaml` + assets. Check: validates; a copy with `schema_version: 2`, an extra top-level key, and a `../` path each fail.
4. `contracts/admin.openapi.yaml` + `contracts/admin.md` (events section with the envelope above). Check: redocly lint passes.
5. `scripts/check-contracts`. Check: passes on the tree; fails clearly on a broken profile; `--dry-run` works.
6. CI job + `docs/ci.md`. Check: workflow YAML parses; job green on the PR.
7. `scripts/check-event-names --self-test` and a local run on the diff.

## Out of scope
- Other modules' contracts (step 2), the contract-diff and contract API tests in CI (#13 and later), implementing any endpoint (#7, #10, #11), the sign-in flow (#10).
