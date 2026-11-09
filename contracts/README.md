# Contracts

How modules talk to each other and what an event profile looks like. Modules use only these APIs and events, never each other's data (see [AGENTS.md](../AGENTS.md), Contracts).

## Files
| File | What it is |
|---|---|
| [admin.md](admin.md) | Admin contract: settings, health (shared by all modules), session and rights, sign-in providers, event naming and envelope, admin events |
| [admin.openapi.yaml](admin.openapi.yaml) | Machine-readable admin API (OpenAPI 3.1) |
| [agenda.md](agenda.md) | Agenda contract: the run-of-show, edited live, each event's own kinds, notification channels per event, kind and item, tournament sessions kept as items, its reminders, clone with an event, agenda events |
| [agenda.openapi.yaml](agenda.openapi.yaml) | Machine-readable agenda API (OpenAPI 3.1) |
| [notify.md](notify.md) | Notify contract: the topic registry (topic types, triggers, per-event configuration, custom topics), per-person channels and follows, Web Push, delivery rules, check-in by the rotating QR, the phone hub and its privacy page |
| [notify.openapi.yaml](notify.openapi.yaml) | Machine-readable notify API (OpenAPI 3.1) |
| [bot.md](bot.md) | Bot contract, connections part: the client pool (the shared bot or an event's own application, its encrypted credentials), binding a guild with Manage Server through the OAuth bot-install flow, slash commands per guild from feature flags, per-event isolation of client failures and rate limits, the who-plays-what read API, bot connection events |
| [bot.openapi.yaml](bot.openapi.yaml) | Machine-readable bot API (OpenAPI 3.1) |
| [finals.md](finals.md) | Finals contract, provisional: only the finals provider stub the bot's `/finals` uses (season status, sign-up and cancel by Discord user, a page link), shared with the standalone off-LAN app; the Finals track writes the rest ([0025](../docs/decisions/0025-finals-and-games-modules.md)) |
| [games.md](games.md) | Games contract: the game catalogue (baseline and each event's own), matching Discord activities, moderation, surges, games events |
| [games.openapi.yaml](games.openapi.yaml) | Machine-readable games API (OpenAPI 3.1) |
| [events.md](events.md) | Event catalog: every cross-module event, its audience and consumers, linked to its payload; provisional `version: 1` outlines for pizza, tournament, bot and the screen overrides (`moments.*`) until those contracts are written |
| [screen.md](screen.md) | Screen contract: paired devices with device tokens and the venue IP check, moving devices between events, zones and assignments, the zone preview, mirroring, layouts and region roles, the widget types and their view-models, the Pulse options, how Moments' overrides claim regions, the composed state and its push channel (SSE), device health, offline behaviour, pinned bundle and theme revision, content and the weekly scheduler, the render job for PPTX and PDF decks with its font warnings, the manual ticker, photos, the screen crew rights preset, screen events |
| [screen.openapi.yaml](screen.openapi.yaml) | Machine-readable screen API (OpenAPI 3.1), with its paths in parts: [screen/devices](screen/devices.openapi.yaml) and [screen/content](screen/content.openapi.yaml) |
| [tenants.md](tenants.md) | Tenants contract: events as tenants, hostnames, venues and the venue profile, users, their sign-in identities, roles and membership, access (info-page mode, venue IP check, admin access), feature flags, lifecycle, series and clone, privacy and retention, the audit log, global and per-tenant tables |
| [tenants.openapi.yaml](tenants.openapi.yaml) | Machine-readable tenants API (OpenAPI 3.1), with its paths in parts: [tenants/event](tenants/event.openapi.yaml), [tenants/superadmin](tenants/superadmin.openapi.yaml) and [tenants/internal](tenants/internal.openapi.yaml) |
| [theming.md](theming.md) | Theming contract: stable CSS classes and custom properties, the theme package (tokens, CSS, fonts, images), layouts as data, logic-less widget templates, embeds, the brand kit's simple and advanced modes, draft → preview → publish with rollback, git sync, clone with a series, upload safety (sandboxed SVG and HTML, the CSP, the same-host sandbox and the optional sandbox origin, `__Host-` session cookies), theming events |
| [theming.openapi.yaml](theming.openapi.yaml) | Machine-readable theming API (OpenAPI 3.1) |
| [theme.schema.json](theme.schema.json) | JSON Schema (draft 2020-12) for a theme package's `theme.yaml` |
| [flags.yaml](flags.yaml) | Every module's feature flags and their defaults, in one place ([tenants.md](tenants.md#feature-flags)) |
| [profile.md](profile.md) | Event profile format v1 |
| [profile.schema.json](profile.schema.json) | JSON Schema (draft 2020-12) for `profile.yaml` |
| [common.openapi.yaml](common.openapi.yaml) | The error body and the common error responses every OpenAPI file references (see [Shared components](#shared-components)) |
| [redocly.yaml](redocly.yaml) | Lint rules for the OpenAPI files |

Each module gets its own `<module>.md` (and `<module>.openapi.yaml` if it has an HTTP API) when its contract is written.

## Conventions
- JSON over HTTP; field names in `snake_case`; times in RFC 3339, UTC (`2026-01-01T12:00:00Z`).
- Every module's API refuses a request with `Origin: null` (a sandboxed document's) with 403 `origin_refused`; the kit does it ([theming.md](theming.md#the-sandbox)).
- Every non-2xx response has the body `{"error": {"code": "<snake_case>", "message": "<text for people>"}}`. Clients branch on `code`, never on `message`. In OpenAPI it is the shared `Error` schema ([Shared components](#shared-components)).
- Module names are the directory names under `modules/`: `screen`, `tournament`, `pizza`, `bot`, `admin`, `games`, `finals`, `moments`, `voices`, `cast`, `agenda`, `notify`, `tenants`, `theming`. `finals` (The Finals mini tourney: seasons, registration, brackets, rankings, champions, the team builder) and `games` (the catalogue, activity matching, surges) are separate modules ([0025](../docs/decisions/0025-finals-and-games-modules.md)); `finals` uses the paths `/api/finals/…` and `/finals/…`, events `finals.<noun>.<past-tense verb>` and rights `finals.<right>`, like every module.
- Rights are named `<module>.<right>`, e.g. `admin.settings.write`.
- Events are named `<module>.<noun>.<past-tense verb>` and use one envelope; see [admin.md](admin.md#events).
- Everything belongs to one event (tenant), taken from the request's hostname; see [tenants.md](tenants.md).
- **Internal paths** (`/internal/<module>/…`) are for other modules only. The edge Caddy never routes them, so they are reached only on the stack's internal network ([tenants.md](tenants.md#resolving-the-tenant)). They take no session. A per-event internal path names its tenant in the query parameter `tenant_id`, which the calling module's kit sets from the tenant it is serving, never from a client's input. Until the kit has a module-to-module identity, the internal network is their only guard.

## Shared components
Every `<module>.openapi.yaml` takes the error body and the common error responses from [common.openapi.yaml](common.openapi.yaml), defined there once, and never writes them out again:

- **The error body** is `common.openapi.yaml#/components/schemas/Error`. Only a response under `components/responses` references it, never an operation.
- **The common responses** are `BadRequest` (400 `invalid_request`), `Unauthorized` (401 `not_signed_in`), `Forbidden` (403 `missing_right`), `NotFound` (404 `not_found`), `Conflict` (409 `version_conflict` or `event_archived`), `TooLarge` (413 `file_too_large`), `Unprocessable` (422), `TooMany` (429 `rate_limited`) and `BadGateway` (502). An operation references them directly: `$ref: "common.openapi.yaml#/components/responses/NotFound"`.
- **A module's own codes:** when a module answers with more codes than a common response names (its own 409s, a 403 for the venue IP check), it defines that response once in its own `components/responses`, in full: the list of codes as its `description`, and the shared `Error` as its body. All its operations then use the module's one; a file never mixes its own `Conflict` with the common one, which the bundler would keep as two responses named alike (`Conflict` and `responses-Conflict`).
- **One operation's own code** goes in a `description` next to the `$ref`, which OpenAPI 3.1 allows and which replaces the response's description for that operation only:

  ```yaml
  "409":
    $ref: "#/components/responses/Conflict"
    description: "`subscription_exists`: this push endpoint belongs to another subscriber."
  ```
- **Trap:** a module's response must not be a `$ref` to a common one with a `description` of its own. Redocly's bundler (CLI 1.34.5) follows the chain and drops that description at every operation that uses it. Write the module's response in full instead, as above.
- **Size:** an OpenAPI file stays at or under about 1,500 lines; `scripts/check-file-size` warns over that. A larger contract is written in parts, each its own package ([AGENTS.md](../AGENTS.md), Package plan).
- **Parts:** an API that would pass the limit keeps its `info`, `tags`, `security` and `components` in `<module>.openapi.yaml` and moves groups of path items to `<module>/<part>.openapi.yaml`. The root's `paths` names each one as `$ref: "screen/content.openapi.yaml#/~1api~1screen~1assets"` (a JSON pointer: `/` in the path is `~1`). A part holds path items only, at the top level, and refers to the root's components as `../<module>.openapi.yaml#/components/…` and to the shared ones as `../common.openapi.yaml#/components/…`. Redocly lints a part through its root, and `scripts/check-file-size` applies the same limit to each part.

## Privacy: export and delete
The phone hub's privacy page collects everything the platform holds on the caller at one event, module by module, so every module follows one shape:

- `GET /api/<module>/me/export` → 200 with everything the module holds on the caller at this event (the request's tenant), as one JSON object whose fields the module's contract defines. Keys, tokens and other secrets are left out.
- `DELETE /api/<module>/me` → 204: the module deletes all of it at this event and stops using it.
- Both need a session (otherwise 401 `not_signed_in`), act only on the caller and never take a user id. They work in every status of the event: deleting is allowed when it is archived ([tenants.md](tenants.md#lifecycle)).
- Every module that holds personal or presence data ([tenants.md](tenants.md#privacy-and-retention)) serves both, and its contract says what its export holds. The hub calls them for each module the event runs; a 404 `not_found` means the module holds nothing on anyone. [notify.md](notify.md#the-hub) is the first.
- The tenants module holds the platform-wide part: the user, the privacy flags and the membership (`GET /api/tenants/me`, `…/me/privacy`; leaving is `DELETE /api/tenants/me/membership`). Deleting the whole account is `DELETE /api/tenants/users/{user_id}` (the superadmin's for now; self-service belongs to the App track's privacy center).

## Changing a contract
- A contract change is its own PR and merges before its consumers.
- Additive only: new fields, endpoints, events. Clients ignore fields they do not know.
- Removing or renaming anything a consumer may use is breaking and needs a person's approval.

## Check
`scripts/check-contracts` validates the demo profile and the demo theme packages against their schemas, checks the paths they name exist, and lints the OpenAPI files (`common.openapi.yaml` through its alias `common` in [redocly.yaml](redocly.yaml), so its components need no operation of its own). CI runs it as the `contracts` check. `scripts/check-contracts --dry-run` lists the steps without running them.
