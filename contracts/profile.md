# Event profile format v1

An event profile is everything that makes the platform look and behave like one event, and nothing that happens during it. The platform never names an event; each event repo holds its profile. The demo profile is [events/demo/](../events/demo/).

Machine-readable schema: [profile.schema.json](profile.schema.json) (JSON Schema draft 2020-12). Check: `scripts/check-contracts`.

## Layout
```
<profile>/
  profile.yaml      # the profile, validated by profile.schema.json
  assets/           # logos, sounds; every file the profile names
```
Asset paths in `profile.yaml` are relative to the profile directory and start with `assets/`. Absolute paths and `..` are rejected. Every path named must exist.

## What it holds
| Field | Required | Meaning |
|---|---|---|
| `schema_version` | yes | Integer, `1` for this format. See Versions. |
| `name` | yes | Display name of the event. |
| `modules` | yes | Modules the event runs: `screen`, `tournament`, `pizza`, `bot`, `admin`, `games`, `moments`, `voices`, `cast`, `agenda`, `notify`, `theming`, `finals`. |
| `settings` | no | `{<module>: {<key>: value}}`. Values are strings, numbers, booleans or flat lists of those. Same keys as the admin settings API ([admin.md](admin.md#settings)). |
| `theme` | no | `colors` (`#rrggbb` or `#rrggbbaa`) and `fonts` (font family names), by token name. |
| `logos` | no | `{<role>: <asset path>}`, e.g. `main`. |
| `sounds` | no | `{<name>: <asset path>}`. |
| `agenda` | no | `kinds`: the event's kind list (`key`, `name`, and optionally `reminder_leads_minutes` and `notify`), as in [agenda.md](agenda.md#kinds). |
| `pizza` | no | `pizzerias`: the event's pizzerias and their menus (see [The pizza section](#the-pizza-section)). |
| `notify` | no | `topics`: per topic key, `enabled`, `params` and `channels` ([notify.md](notify.md#per-event-configuration)); `custom_topics`: per `custom_…` key, `based_on`, `title`, `description`, `defaults` and `where` ([notify.md](notify.md#custom-topics)). |

Keys are lowercase `snake_case`. Unknown top-level fields are rejected.

Admin applies `agenda` and `notify` through those modules' own APIs, with the rights of the person loading the profile (`agenda.items.write`, `notify.topics.write`), and exports them from the same APIs: each kind with `PUT /api/agenda/kinds/{kind_key}`, each topic's configuration with `PUT /api/notify/topic-types/{topic}/config`, each custom topic with `PUT /api/notify/topic-types/{topic}`. Kinds and custom topics the profile does not name stay as they are.

## The pizza section
`pizza.pizzerias` lists the event's pizzerias with the same fields as the menu CSV ([pizza.md](pizza.md#the-menu-csv)), so a profile and a menu CSV hold the same menu:

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The pizzeria's name, up to 80 characters; unique in the event in any case |
| `phone`, `website` | no | Its phone number; its web page, an `http` or `https` URL |
| `service` | no | `delivery` (when absent) or `takeaway` |
| `items` | no | Menu items: `number` (up to 8 characters, unique in the pizzeria), `name` (80), `description` (300) and `price` (euro cents, 0 to 99999) |
| `base` | no | The own pizza's base: `name`, `description`, `price`; without one the pizzeria offers no own pizza |
| `toppings` | no | The own pizza's toppings: `name`, `description`, `price` (the extra price) |

Admin applies it through the pizza API with `pizza.menu.write`: a pizzeria matched by name is edited (`PATCH /api/pizza/pizzerias/{pizzeria_id}`), one not there is added (`POST /api/pizza/pizzerias`), and its menu is replaced (`PUT /api/pizza/pizzerias/{pizzeria_id}/menu`); pizzerias the profile does not name stay as they are. Admin exports it from `GET /api/pizza/pizzerias` and each `GET /api/pizza/pizzerias/{pizzeria_id}`. Orders are live data and never in a profile.

## What it does not hold
| Not in a profile | Where it lives |
|---|---|
| Live data: players, scores, brackets, orders, chat, sessions | Postgres, per module |
| Secrets: tokens, passwords, OAuth client secrets, API keys | Environment / secret store on the host, never in a repo |
| Uploaded media: moments, voices, user uploads | The shared files volume |

A setting that needs a secret names the environment variable, not the value.

## Versions
- `schema_version` is an integer, starting at 1, raised by one for each format change that old loaders cannot read.
- The loader reads `schema_version` first, then upgrades one step at a time, n → n+1, with one upgrader per step, until the profile is at the current version; then it validates against the current schema.
- A profile newer than the platform supports is rejected with error code `profile_too_new`. A profile that fails validation is rejected with `profile_invalid`.
- Additive changes (a new optional field) keep the version. When version 2 arrives, this schema is kept as `profile.v1.schema.json` and `profile.schema.json` becomes v2.

## Save and load
The admin module exports and imports profiles through `GET` / `PUT /api/admin/profile` ([admin.md](admin.md#profile)).
