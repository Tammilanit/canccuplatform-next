# Contracts

How modules talk to each other and what an event profile looks like. Modules use only these APIs and events, never each other's data (see [AGENTS.md](../AGENTS.md), Contracts).

## Files
| File | What it is |
|---|---|
| [admin.md](admin.md) | Admin contract: settings, health (shared by all modules), session and rights, event naming and envelope, admin events |
| [admin.openapi.yaml](admin.openapi.yaml) | Machine-readable admin API (OpenAPI 3.1) |
| [agenda.md](agenda.md) | Agenda contract: the run-of-show, edited live, its reminders, clone with an event, agenda events |
| [agenda.openapi.yaml](agenda.openapi.yaml) | Machine-readable agenda API (OpenAPI 3.1) |
| [events.md](events.md) | Event catalog: every cross-module event, its audience and consumers, linked to its payload |
| [profile.md](profile.md) | Event profile format v1 |
| [profile.schema.json](profile.schema.json) | JSON Schema (draft 2020-12) for `profile.yaml` |
| [redocly.yaml](redocly.yaml) | Lint rules for the OpenAPI files |

Each module gets its own `<module>.md` (and `<module>.openapi.yaml` if it has an HTTP API) when its contract is written.

## Conventions
- JSON over HTTP; field names in `snake_case`; times in RFC 3339, UTC (`2026-01-01T12:00:00Z`).
- Every non-2xx response has the body `{"error": {"code": "<snake_case>", "message": "<text for people>"}}`. Clients branch on `code`, never on `message`.
- Module names are the directory names under `modules/`: `screen`, `tournament`, `pizza`, `bot`, `admin`, `games`, `moments`, `voices`, `cast`, `agenda`.
- Rights are named `<module>.<right>`, e.g. `admin.settings.write`.
- Events are named `<module>.<noun>.<past-tense verb>` and use one envelope; see [admin.md](admin.md#events).

## Changing a contract
- A contract change is its own PR and merges before its consumers.
- Additive only: new fields, endpoints, events. Clients ignore fields they do not know.
- Removing or renaming anything a consumer may use is breaking and needs a person's approval.

## Check
`scripts/check-contracts` validates the demo profile against the schema, checks its asset paths exist, and lints the OpenAPI files. CI runs it as the `contracts` check. `scripts/check-contracts --dry-run` lists the steps without running them.
