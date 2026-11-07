# Finals contract (provisional: the provider stub)

**Provisional.** This file holds only the **finals provider interface**: what a finals provider offers the bot's `/finals` commands (season status, individual sign-up by Discord user, cancel, and a page link). The Finals track writes the full `finals` contract when it starts: the module's own API for the hub and admin, its events (`finals.<noun>.<past-tense verb>`), its rights (`finals.<right>`) and the screen's finals cards ([0025](../docs/decisions/0025-finals-and-games-modules.md), [roadmap](../docs/roadmap.md#finals)). Until then, nothing here is final.

One contract, several providers: the standalone off-LAN tourney app and the platform's `finals` module. The consumer is the bot's `/finals` commands, which switch between providers with one base-URL setting. This stub copies the shapes of the off-LAN app's provider contract exactly; a change on either side is passed to the other before it ships.

JSON over HTTPS. Conventions as in [README.md](README.md#conventions), with the provider rules below.

## Base URL
`{base}` is the provider's; the paths below are relative to it.

| Provider | `{base}` | Auth |
|---|---|---|
| The standalone off-LAN app | `https://<off-LAN host>/api/provider` | bearer |
| The platform's `finals` module | `https://<event host>/api/finals` | the bot module's (see Auth) |

- Never under `/api/bot/`: that prefix belongs to the platform's bot module.
- **The event comes from the hostname**, never from a field in the request ([tenants.md](tenants.md)). On the platform each event's bot configuration names its own event host as `{base}`.

## Auth
- **The off-LAN app:** every request carries `Authorization: Bearer <secret>`. Missing or wrong → `401` with code `unauthorized`. The secret lives on the bot's host and the provider's host, never in a repo.
- **The platform:** no bearer secret. The bot module calls the `finals` module itself; the entries and links paths act for a Discord user, so the module answers them only for the platform's bot module and gives any other caller (a browser, a session, the public) `401` `unauthorized`. How the bot proves it is the bot is the kit's service-to-service auth, named in the Finals track's full contract. `GET {base}/status` is readable by whoever the event's info-page mode lets in ([tenants.md](tenants.md#info-page-mode)).
- **Rights on the platform come only from sign-in.** `role_ids` in `POST {base}/links` is ignored: admin rights in `finals` come only from the signed-in user's platform rights (`GET /api/admin/session`, [admin.md](admin.md#session-and-rights)), never from Discord role ids a caller sends.

## Conventions
- JSON in and out, field names in `snake_case`.
- Ids (season, entry, team) are opaque strings. Consumers compare them and pass them back; they never parse them or do arithmetic on them.
- Times are ISO 8601 UTC strings (`2026-11-07T18:00:00Z`).
- A player's team is read at query time (an admin can swap players between teams after the start). Consumers must not cache it.
- Errors use the common body, with the HTTP status in the table:

```json
{"error": {"code": "registration_closed", "message": "Registration is closed for this season."}}
```

| Code | HTTP | When |
|---|---|---|
| `no_season` | 404 | No season with that id. (`GET {base}/status` with no season is not an error; it returns `{"season": null}`.) |
| `registration_closed` | 409 | The season is not in `register`, or is in team mode (sign-up by Discord is individual only). |
| `name_taken` | 409 | Another entry in the season already uses that name, including names taken by page sign-ups. The bot asks for `/finals register name:<nick>`. |
| `not_registered` | 404 | The Discord user has no entry in the season. |
| `rate_limited` | 429 | Too many requests. Consumers may retry later. |
| `unauthorized` | 401 | The caller is not allowed: bearer missing or wrong (the off-LAN app), or not the bot module (the platform). |
| `invalid_request` | 400 | The body misses a required field or a field fails validation (e.g. the name breaks the nick rules). |

`message` is for logs and may change; consumers branch on `code`.

## `GET {base}/status`
The current season, or none. Always `200`.

```json
{"season": null}
```

```json
{
  "season": {
    "id": "7",
    "name": "Friday finals",
    "state": "register",
    "mode": "individual",
    "format": "nine",
    "registered": 5,
    "capacity": 27,
    "champion": null
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `season` | object or `null` | The newest season not yet finished; if none, the newest finished one; `null` if there is no season at all. |
| `id` | string | Opaque season id; use it in the entries paths. |
| `name` | string | Season name. |
| `state` | `"register" \| "active" \| "finished"` | The season's phase. |
| `mode` | `"teams" \| "individual"` | Registration mode. |
| `format` | string | Bracket format. |
| `registered` | integer | Players signed up (individual mode) or teams registered (team mode). |
| `capacity` | integer | In individual mode, players (the format's teams × 3, e.g. `nine` → 27); in team mode, teams. |
| `champion` | object or `null` | When `state` is `finished`: `{"name": "<team name>", "players": ["…", "…", "…"]}`; else `null`. |

## `POST {base}/seasons/{id}/entries`
Signs a Discord user up as an individual.

```json
{"discord_user_id": "123456789012345678", "name": "Player One"}
```

| Field | Type | Meaning |
|---|---|---|
| `discord_user_id` | string | Discord snowflake, as a string. |
| `name` | string | Display name in the tourney; the bot sends the server nickname sanitised to the nick rules. |

Response `{"id": "<entry id>", "created": true}`: `201` when a new entry was made, `200` with `"created": false` when this user already had one (idempotent per user: the name in the request is ignored then). One entry per (season, `discord_user_id`), also across page sign-ups. The provider keeps any edit token server-side; it never appears in a response.

On the platform the entry belongs to the user with that Discord id; the link between a user and their Discord id is kept only in the tenants module ([events.md](events.md), [tenants.md](tenants.md#users-roles-and-membership)). How a Discord user who never signed in is held is the Finals track's.

Errors: `no_season`, `registration_closed`, `name_taken`, `invalid_request`.

## `GET {base}/seasons/{id}/entries/by-discord/{discord_user_id}`
The user's entry. `200`:

```json
{"id": "41", "name": "Player One", "team_id": null}
```

`team_id` is an opaque team id once teams are formed, else `null`; read at query time.

Errors: `no_season`, `not_registered`.

## `DELETE {base}/seasons/{id}/entries/by-discord/{discord_user_id}`
Withdraws the user while the season is in `register`. `204`, no body.

Errors: `no_season`, `not_registered`, `registration_closed` (the season has started).

## `POST {base}/links`
A page link for the caller. The bot shows it ephemerally (only the caller sees it).

```json
{"discord_user_id": "123456789012345678", "discord_username": "playerone", "role_ids": ["111", "222"]}
```

| Field | Type | Meaning |
|---|---|---|
| `discord_user_id` | string | Discord snowflake. |
| `discord_username` | string | Discord username, for display. |
| `role_ids` | array of strings, optional | The caller's role ids in the server. The off-LAN app grants admin when one is in its own allowlist. **Ignored by the platform**, where admin rights come only from the user's own sign-in (see Auth). |

Response `200`:

```json
{"url": "https://<off-LAN host>/#d=<token>", "expires_at": "2026-11-07T18:15:00Z"}
```

| Field | Type | Meaning |
|---|---|---|
| `url` | string | Open as is. On the off-LAN app a short-lived link token sits in the fragment; the token format is the provider's own and not part of this contract. **On the platform it is a plain hub URL** on the event's host (`https://<event host>/finals/`), with no token: the player signs in with Discord there, and the event comes from the hostname. |
| `expires_at` | string | When the link stops working (about 15 min on the off-LAN app); reusable until then. The platform sends the same 15 minutes so the bot's text reads the same, though its plain URL keeps working. |

Errors: `invalid_request`.

## Additive rule
New fields and endpoints may appear; consumers ignore unknown fields. Fields and codes here are not removed or renamed without a change here first, passed to the other provider before it ships.
