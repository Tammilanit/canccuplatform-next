# Contracts

How modules talk to each other and what an event profile looks like. Modules use only these APIs and events, never each other's data (see [AGENTS.md](../AGENTS.md), Contracts).

## Files
| File | What it is |
|---|---|
| [admin.md](admin.md) | Admin contract: settings, health (shared by all modules), session and rights, event naming and envelope, admin events |
| [admin.openapi.yaml](admin.openapi.yaml) | Machine-readable admin API (OpenAPI 3.1) |
| [agenda.md](agenda.md) | Agenda contract: the run-of-show, edited live, each event's own kinds, notification channels per event, kind and item, tournament sessions kept as items, its reminders, clone with an event, agenda events |
| [agenda.openapi.yaml](agenda.openapi.yaml) | Machine-readable agenda API (OpenAPI 3.1) |
| [notify.md](notify.md) | Notify contract: the topic registry (topic types, triggers, per-event configuration, custom topics), per-person channels and follows, Web Push, delivery rules, check-in by the rotating QR, the phone hub and its privacy page |
| [notify.openapi.yaml](notify.openapi.yaml) | Machine-readable notify API (OpenAPI 3.1) |
| [bot.md](bot.md) | Bot contract, connections part: the client pool (the shared bot or an event's own application, its encrypted credentials), binding a guild with Manage Server through the OAuth bot-install flow, slash commands per guild from feature flags, per-event isolation of client failures and rate limits, the who-plays-what read API, bot connection events |
| [bot.openapi.yaml](bot.openapi.yaml) | Machine-readable bot API (OpenAPI 3.1) |
| [games.md](games.md) | Games contract: the game catalogue (baseline and each event's own), matching Discord activities, moderation, surges, games events |
| [games.openapi.yaml](games.openapi.yaml) | Machine-readable games API (OpenAPI 3.1) |
| [events.md](events.md) | Event catalog: every cross-module event, its audience and consumers, linked to its payload; provisional `version: 1` outlines for pizza, tournament, bot and the screen overrides (`moments.*`) until those contracts are written |
| [tenants.md](tenants.md) | Tenants contract: events as tenants, hostnames, venues and the venue profile, users, roles and membership, access (info-page mode, venue IP check, admin access), feature flags, lifecycle, series and clone, privacy and retention, the audit log, global and per-tenant tables |
| [tenants.openapi.yaml](tenants.openapi.yaml) | Machine-readable tenants API (OpenAPI 3.1) |
| [theming.md](theming.md) | Theming contract: stable CSS classes and custom properties, the theme package (tokens, CSS, fonts, images), layouts as data, logic-less widget templates, embeds, the brand kit's simple and advanced modes, draft → preview → publish with rollback, git sync, clone with a series, upload safety (sandboxed SVG and HTML, the CSP, the sandbox origin), theming events |
| [theming.openapi.yaml](theming.openapi.yaml) | Machine-readable theming API (OpenAPI 3.1) |
| [theme.schema.json](theme.schema.json) | JSON Schema (draft 2020-12) for a theme package's `theme.yaml` |
| [profile.md](profile.md) | Event profile format v1 |
| [profile.schema.json](profile.schema.json) | JSON Schema (draft 2020-12) for `profile.yaml` |
| [redocly.yaml](redocly.yaml) | Lint rules for the OpenAPI files |

Each module gets its own `<module>.md` (and `<module>.openapi.yaml` if it has an HTTP API) when its contract is written.

## Conventions
- JSON over HTTP; field names in `snake_case`; times in RFC 3339, UTC (`2026-01-01T12:00:00Z`).
- Every non-2xx response has the body `{"error": {"code": "<snake_case>", "message": "<text for people>"}}`. Clients branch on `code`, never on `message`.
- Module names are the directory names under `modules/`: `screen`, `tournament`, `pizza`, `bot`, `admin`, `games`, `moments`, `voices`, `cast`, `agenda`, `notify`, `tenants`, `theming`.
- Rights are named `<module>.<right>`, e.g. `admin.settings.write`.
- Events are named `<module>.<noun>.<past-tense verb>` and use one envelope; see [admin.md](admin.md#events).
- Everything belongs to one event (tenant), taken from the request's hostname; see [tenants.md](tenants.md).

## Changing a contract
- A contract change is its own PR and merges before its consumers.
- Additive only: new fields, endpoints, events. Clients ignore fields they do not know.
- Removing or renaming anything a consumer may use is breaking and needs a person's approval.

## Check
`scripts/check-contracts` validates the demo profile and the demo theme packages against their schemas, checks the paths they name exist, and lints the OpenAPI files. CI runs it as the `contracts` check. `scripts/check-contracts --dry-run` lists the steps without running them.
