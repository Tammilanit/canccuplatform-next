# Games contract

The games people play at an event: the game catalogue, how a Discord activity is matched to a game, and surges (many people starting one game at once). The `games` module owns it. Rosters, rounds and Play sessions join this contract when their step writes them (the Games track, [roadmap](../docs/roadmap.md#games)); this part is what the screen, the bot and Notify need first.

**Machine-readable API: [games.openapi.yaml](games.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Tenancy
- The **baseline** is one list for the whole platform: the games most events see, shipped with the module as data and versioned with the platform. It changes only through a pull request, like code; no API writes it.
- Everything else is per event, which is one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)): the games the event's attendees add, and the event's **overlay** on baseline games (hidden, and identifiers added by event admins or merges). Those rows carry `tenant_id` under row-level security. The tenant comes from the request's hostname.
- So an event admin changes only their own event's catalogue: hiding or merging at one event never changes another. A game worth having everywhere goes into the baseline by a pull request.
- Events go to the tenant's stream `t:<tenant>:events:games`. An archived event's catalogue is read-only: writes get 409 `event_archived`.

## The catalogue
An event's catalogue is the baseline plus the event's own games, with the event's overlay applied (`Game` in the OpenAPI file):

| Field | Meaning |
|---|---|
| `id` | Game id. Baseline games keep their id at every event; an event's own games get one from the module |
| `name` | Text for people ("Racing League") |
| `source` | `baseline` or `event` |
| `discord.application_ids` | The application ids Discord sends in a member's activity for this game (snowflakes as strings). The surest match |
| `discord.name_aliases` | Activity names to match when an activity has no application id, compared case-insensitively after trimming |
| `store_ids` | Optional store ids: `steam` (app id), `epic`, `gog`, `battle_net`, `riot`. Used for cover art and links |
| `cover_url` | Optional cover art, served by the module; resolved from the store ids (Steam first) or uploaded by an event admin |
| `status` | `active`, `hidden` (not offered to follow, never surges) or `merged` (see Moderation) |
| `merged_into` | For `merged`: the game it was merged into |
| `revision` | +1 on every change at this event; for optimistic concurrency |

- **Matching an activity:** the application id first, then the name aliases; an activity that matches nothing is **unmatched**. A hidden or merged game never matches; an activity whose identifiers moved to another game by a merge matches that game.
- `GET /api/games/catalogue?q=` → `{"catalogue_version", "games"}`: the active games, filtered by name or alias when `q` is given. Readable by whoever the event's info-page mode lets in ([tenants.md](tenants.md#info-page-mode)). With right `games.catalogue.moderate`, `include_hidden=true` adds hidden and merged games.
- `GET /api/games/catalogue/{game_id}` → one game, also a merged one (so a client holding an old id follows `merged_into`); 404 `not_found` for a hidden one without the right.
- **`catalogue_version`** goes up by one on every change of the event's catalogue, the baseline arriving with a new platform version included.

## Adding a game
A signed-in member adds a game that is missing, and everyone at the event can then follow it.

- `POST /api/games/catalogue` with `name`, and optionally `steam_app_id` and `from_activity` (the id of an unmatched activity seen at the event, which brings that activity's application id or name as an identifier). Needs a session of a member of the event (403 `not_a_member`), and the setting `attendee_additions` on (otherwise 403 `missing_right` unless the caller moderates). 201 with the game; emits `games.game.added`; audited.
- A game whose name, an alias, the Steam id or the activity's application id is already in the catalogue is 409 `game_exists`, with the existing game's id in the message so the hub can offer it instead.
- At most 10 additions per member per day: 429 `rate_limited`.
- Attendees set only those fields. Application ids from anything but an observed activity, name aliases, store ids other than Steam, and cover art are moderators' work, so nobody can attach a popular game's activity to a joke entry.
- `GET /api/games/activities/unmatched` → the activities seen at the event that match no game (id, application id, name, players now, last seen; never who). Members see those with at least 2 players, so the list never tells what one person plays; moderators see all of them.

## Moderation
Right `games.catalogue.moderate` (event admins hold it through their role). Every change below is written to the audit log through `POST /internal/tenants/audit` in the same request ([tenants.md](tenants.md#audit-log)), with what changed; attendees' additions are audited the same way.

- `PATCH /api/games/catalogue/{game_id}` with `revision`: the name, identifiers, store ids and cover of an event's own game; on a baseline game only the overlay (adding identifiers, hiding). A stale `revision` is 409 `version_conflict`; an identifier already on another game is 409 `identifier_taken`. Emits `games.game.changed`.
- **Hide:** `PATCH` with `status: hidden` (and `active` to undo). A hidden game is not offered to follow, never surges, and keeps its follows in Notify for when it comes back. Its `games.game.changed` carries only `game_id`, `status` and `changed`, never the game, so an entry a moderator removed is not broadcast again.
- **Merge duplicates:** `POST /api/games/catalogue/{game_id}/merge` with `into` and `revision`. Only an event's own game merges (a baseline game is 409 `baseline_entry`), into any active game of the catalogue (otherwise 409 `game_not_active`). Its identifiers move to the target (for a baseline target, into the event's overlay), it becomes `merged` with `merged_into`, and the module emits `games.game.merged`, on which Notify moves its followers to the target ([notify.md](notify.md#per-person-channels-and-follows)). Merging is final: any `PATCH` or merge of a merged game is 409 `game_merged`.
- `PUT /api/games/catalogue/{game_id}/cover` uploads cover art (PNG, JPEG or WebP, at most 2 MB) into the shared files volume.

## Following a game
Following is a Notify follow on the `game` topic, `PUT /api/notify/me/follows/game/{game_id}` ([notify.md](notify.md#per-person-channels-and-follows)): the games module keeps no list of who follows what, so a person's follows live with their other notification choices, are exported and deleted with them, and need no second privacy path. The hub lists the catalogue from this API and the follows from Notify.

## Surges
A surge is the moment many people at the event start the same game. It feeds the `game` topic in Notify (people who follow the game) and the screen's hot-game banner.

- **Input:** the bot module reports the "playing" activities of the event's Discord members as counts per activity (application id, name, players), every interval; the bot contract fixes the event (provisional: `bot.activities.counted`). Counts only, never who: members with the presence opt-out ([tenants.md](tenants.md#privacy-and-retention)) are not counted at all.
- The module matches each activity to a game and adds up the players per game.
- **Start:** when a game's players reach `surge_threshold` and the game is not cooling down, the module emits `games.surge.started` and the game's cool-down of `surge_cooldown_minutes` begins: no new surge for that game until it ends.
- **End:** when the players stay below the threshold for two intervals in a row, the module emits `games.surge.ended`.
- Hidden and merged games never surge; unmatched activities never surge.
- Surge events carry counts only. Who plays the game is read from the bot's read API with the game's id ([bot.md](bot.md#who-plays-what)), by callers allowed to see it.

## Settings
Per event, through the admin settings API (module `games`). Everything here is optional per event.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `surges` | boolean | `true` | Detect surges at all |
| `surge_threshold` | integer, 2–500 | `4` | Players on one game that start a surge |
| `surge_cooldown_minutes` | integer, 1–1440 | `15` | Minutes after a surge starts before that game can surge again |
| `attendee_additions` | boolean | `true` | Members may add games; with `false`, only moderators add them |

## Rights
`games.catalogue.moderate` (edit, hide, merge, identifiers, cover art, see hidden games). Adding a game needs only membership of the event.

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Listed in the catalog: [events.md](events.md).

| Type | When | Audience | `data` |
|---|---|---|---|
| `games.game.added` | A game was added to the event's catalogue | event-wide, `public` | `game`, `catalogue_version`, `actor_user_id` |
| `games.game.changed` | A game was edited, hidden or shown again | event-wide, `public` | `game` (absent when the game was hidden: then `game_id` and `status` instead), `changed` (field names), `catalogue_version`, `actor_user_id` |
| `games.game.merged` | An event's game was merged into another | event-wide, `public` | `game_id`, `into_game_id`, `catalogue_version`, `actor_user_id` |
| `games.surge.started` | Players on one game reached the threshold | event-wide, `public` | `game` (`id`, `name`, `cover_url`), `players`, `threshold` |
| `games.surge.ended` | A surge ended | event-wide, `public` | `game` (`id`, `name`), `players` |

`game` is the whole game as `GET /api/games/catalogue/{game_id}` returns it. A `games.game.added` by an attendee names them in `actor_user_id` like every other change event; the audience of the event is `public` because the game is, and consumers never show `actor_user_id` to people.

## Not in this contract
Rosters, rounds and Play sessions (their step adds them here), LFG (in the backlog; the `game` topic in Notify already lists `games.lfg.opened` for when it exists), and how the bot reads presence (the bot contract).
