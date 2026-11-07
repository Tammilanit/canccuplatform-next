# Screen contract

The venue screens: paired devices, each event's zones, the Pulse layout that composes widgets into regions, the playlists and weekly scheduler of the legacy signage core, the PPTX render job, and the push channel that keeps every screen current within about a second ([0022](../docs/decisions/0022-product-vision.md)). The `screen` module owns it. It draws what other modules say and ranks nothing: overrides come ranked from Moments ([0010](../docs/decisions/0010-scope.md), [events.md](events.md#screen-overrides)), the look from theming ([theming.md](theming.md)).

**Machine-readable API: [screen.openapi.yaml](screen.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions). Written from the canccusignage routes ([legacy inventory](../docs/legacy-inventory/canccusignage.md#http-routes)), adapted rather than copied: see [From the legacy API](#from-the-legacy-api).

## Words
- **Device:** one paired screen: a kiosk browser on a venue PC, showing `/screen/` on the event's hostname.
- **Zone:** a place in one event with its own screens and content (main hall, café, stage).
- **Layout, region, widget:** a layout places regions on a grid and widgets in each region; layouts are theming data ([theming.md](theming.md#layouts-as-data)). Screen adds region roles, the widget types and what a zone shows.
- **Composed state:** everything one zone's screens draw, built on the server. A screen renders from it alone, with no knowledge of other modules.
- **Claim:** an override that holds a region for a while.

## Tenancy
- Everything belongs to the event (tenant) resolved from the request's hostname ([tenants.md](tenants.md#resolving-the-tenant)); no path, query or body names a tenant. Per-tenant rows carry `tenant_id` under row-level security; events go to `t:<tenant>:events:screen` with the envelope's `tenant`; files live under `/files/<tenant>/screen/`; the scheduler, break ticks and push streams are keyed by tenant and zone ([0013](../docs/decisions/0013-multi-tenant-core.md) item 7).
- **One global table, `screen devices`** (device identity, 0013 item 34; on the kit's allow-list): `id`, `name`, `token_hash` (SHA-256 of the current 256-bit random token; no token is ever stored), `superseded_token_hashes` (hashes of tokens a transfer replaced, each with its expiry; a superseded token is only ever answered with the redirect of `GET /api/screen/device/home`, see Moving), `venue_id` (read through the tenants API), `current_tenant_id` (a plain reference), `created_at`, `revoked_at`. Nothing else of any event is on it. Assignments, health, pairing codes and everything else are per tenant.
- An archived event is read-only: writes get 409 `event_archived`; its devices show the archived notice until the superadmin moves them.

## Devices
### Pairing
1. The kiosk opens `https://<event hostname>/screen/`. Without a device cookie it calls `POST /api/screen/pairing` and shows the returned 8-character `code` large, with the event's name. The request must come from one of the event's venue addresses (unless the venue IP check is off, below), at most 10 open codes per event and 3 per address; a code lives 10 minutes. `DELETE /api/screen/pairing` (`screen.devices.pair`) clears every open code of the event, for when someone on the venue network holds them. The answer sets the cookie `canccu_pairing` (HttpOnly, Secure, SameSite=Strict), so only that browser can collect the token.
2. An event admin (right `screen.devices.pair`) enters the code: `POST /api/screen/devices` with `code`, `name` and optionally `zone_key`. This creates the device with the event's venue as `venue_id` and the event as its current tenant; an event with no venue cannot pair (409 `no_venue`). Audited; emits `screen.device.paired`.
3. The kiosk polls `GET /api/screen/pairing/{pairing_id}` (with its pairing cookie) every 2 seconds. Once claimed the answer sets the **device cookie** `canccu_device` (HttpOnly, Secure, SameSite=Strict, host-only, `Max-Age` 400 days) holding the token, and the code is spent.

Creating a device on the event that pairs it is the only time anyone but the superadmin sets a current tenant: the device is new and belongs to no other event. Moving an existing device is the superadmin's (below), as 0013 item 34 says. This reading of item 34 is for the maintainer to confirm (or to record as an amendment of 0013).

The token travels as a cookie, not a header, because images, video and the push stream are loaded by the browser, which sends cookies but no custom headers.

### Every device request
A device request (state, stream, heartbeat, files, theming reads) is served only when **all** hold, checked in the app by the kit on every request, because the firewall cannot tell events at one venue apart ([tenants.md](tenants.md#venue-ip-check-for-screens-and-its-emergency-switch)):
- the cookie's token is the current token of a device that is not revoked (otherwise 401 `device_unknown`; the page goes back to pairing). A superseded token gets 409 `device_moved` on every path except `GET /api/screen/device/home`;
- the device's current tenant is the request's tenant (otherwise 409 `device_moved`, see Moving);
- the request comes from one of the event's venue addresses, IPv4 or IPv6 (otherwise 403 `venue_ip_refused`). The address alone is never enough.

**Emergency switch:** the tenants module's per-tenant switch (`PUT /api/tenants/current/venue-ip-check`, right `tenants.venue_ip_check.write`, at most 48 hours, every change audited) turns the third check off; the device token then serves alone. Screen follows `tenants.venue_ip_check.changed` through the kit's tenant cache and never keeps a switch of its own.

### Moving, renaming, revoking
- **Moving** (superadmin only, on the superadmin hostname): `PATCH /api/screen/registry/devices/{device_id}` with `current_tenant_id` (an event whose venue is the device's venue, or `null` to park it) and optionally `venue_id`, `name`. Audited ("devices' current tenant", 0013 item 13). The device's assignment in the old event ends; the old event gets `screen.device.released`, the new one `screen.device.moved` (neither names the other event). A move to another venue (`venue_id` changed) needs a new start URL on the kiosk: the old hostname checks the old event's venue address, so the kiosk cannot learn its new home there.
- A moved kiosk gets 409 `device_moved` on the old hostname and calls `GET /api/screen/device/home`, which, for the device's current token, answers the new event's screen URL with a one-time transfer code in the fragment (`https://<primary hostname>/screen/#transfer=<code>`, 60 seconds, single use, kept in the new event's Valkey keys). The page there redeems it with `POST /api/screen/device/transfer` only when it holds no working device cookie for that hostname (otherwise it drops the fragment and runs); redeeming issues a new current token in a new cookie for that hostname, and the replaced token becomes superseded (kept in `superseded_token_hashes`), not revoked. Audited.
- **A superseded token** is answered only by `GET /api/screen/device/home`, and only with the redirect to the device's current hostname (`https://<primary hostname>/screen/`, no transfer code): it can never get a transfer code or a current token, so a copied old cookie cannot take the device over. It expires 7 days after the transfer, or as soon as the new token has been used once, whichever comes first; an expired superseded token is dropped and gets 401 `device_unknown`. So a kiosk whose start URL still names the old hostname is sent on to the new one until the new cookie has worked; after that the venue crew updates the start URL, which admin shows with the device. Revoking or deleting the device drops every superseded token. A parked device gets `url: null` and shows its name and "not assigned".
- **Renaming:** an event admin of the device's current event (`screen.devices.write`) or the superadmin.
- **Revoking:** `POST /api/screen/devices/{device_id}/revoke` (`screen.devices.write`) or `DELETE /api/screen/registry/devices/{device_id}` (superadmin, also deletes the row). The token and every superseded token stop at once; the kiosk goes back to pairing. Audited; emits `screen.device.revoked`.
- **No dangling references:** when a device is moved away, revoked or deleted, the devices that mirror it are unassigned (each emits `screen.device.assigned`) and a zone whose `sound.device_id` names it gets `null` there (emits `screen.zone.saved`).
- **Commands:** `POST /api/screen/devices/{device_id}/commands` with `reload` (reload the page and the bundle) or `identify` (show the device's name and zone for 15 seconds). Delivered on the push channel; a command not delivered within 60 seconds is dropped.
- Two events at one venue at the same time each use their own devices: a device serves one event at a time.

## Zones and assignments
- A **zone** (`Zone`): `key` (lowercase letters, digits, `-` and `_`, 2–32 characters, unique per event; the "zone key" the agenda's items and Moments' overrides name), `name`, `layout_id`, `regions` (per-region settings, see The Pulse options), `sound` (`enabled`, `device_id`: the one device of the zone that plays sound, `null` for every non-mirroring device), `revision`.
- `GET`, `POST /api/screen/zones`; `GET`, `PUT`, `DELETE /api/screen/zones/{zone_key}`. Right `screen.zones.write` for writes; `revision` for optimistic concurrency (409 `version_conflict`). A zone with devices assigned cannot be deleted (409 `zone_in_use`). Emits `screen.zone.saved`, `screen.zone.removed`. A new event starts with one zone, `main`.
- **Assignment:** `PUT /api/screen/devices/{device_id}/assignment` with either `zone_key` or `mirror_of` (`{"device_id"}` or `{"zone_key"}`), or `DELETE` to unassign. Right `screen.devices.write`. A device is in one zone of one event at a time and is reassigned for the next event; an assignment is valid only while the device's current tenant is this event. Audited; emits `screen.device.assigned`.
- **Mirroring:** a mirroring device shows exactly what its target shows (a device's zone, or a zone) and plays no sound. It reports health with `mirror: true`. The admin's live view is a mirror for a session with `screen.devices.read`, not a device ([inventory](../docs/legacy-inventory/canccusignage.md#tenancy-questions), question 10).

## Layouts and regions
- **Which layout:** a zone shows `layout_id`, a layout id of the event's current theme revision ([theming.md](theming.md#reading-the-current-theme)) or a built-in one. A schedule window may switch it for its time (`layout_id` on the window). An id the theme does not have falls back to `pulse` (or `pulse_portrait` for a portrait device), so a theme change never leaves a blank screen. A theme layout with a built-in id replaces the built-in.
- **Built-in layouts,** as data in the theme schema's `layout` shape, used while the theme has none:

| Layout | Aspect, grid | Regions (`column`, `row`, `columns`, `rows`) | Widgets |
|---|---|---|---|
| `pulse` | 16:9, 12×12 | `header` (1,1,12,1); `hero` (1,2,8,10); `rail` (9,2,4,6); `venue_rail` (9,8,4,4); `ticker` (1,12,12,1) at layer 1 | `logo`, `clock` · `playlist`, `hot_game`, `bracket`, `photo` · `agenda_now`, `countdown` · `venue_info`, `food_status`, `checkin_qr` · `ticker` |
| `pulse_portrait` | 9:16, 6×16 | `header` (1,1,6,2); `hero` (1,3,6,7); `rail` (1,10,6,6); `ticker` (1,16,6,1) | as `pulse`, without `venue_rail` |

  At 1920×1080 a `pulse` hero is 1280×900 px, the rail 640×540, the venue rail 640×360, the ticker 1920×90.
- **Region roles** let Moments target regions without knowing a theme's ids. A region's role is, in order: the zone's `regions.<id>.role`; its id when the id is a role; `main` → `hero`, `side` → `rail`; otherwise none.

| Role | What it is |
|---|---|
| `full` | The whole screen. Every layout has it implicitly, above every region; only claims use it |
| `hero` | The large rotating region |
| `rail` | The now/next rail |
| `venue_rail` | Venue facts: Wi-Fi, food, the check-in QR |
| `ticker` | One line of text along an edge |
| `header`, `backdrop` | Logo and clock; the background. Never claimed |
| `overlay` | A band on top of everything (layer 10), implicit like `full`; only claims use it |

## Widgets
Each widget type below is offered by Screen: theming layouts place it, templates draw it ([theming.md](theming.md#widget-templates)), and its view-model is the only data a template can read. Data comes from the source module, through Screen; a device never calls another module, except loading the theme's files, which theming allows paired screens. The layout and templates come in the composed state, from the theme revision in effect (the pinned one, else the current), which Screen's server reads from theming as a module. Every view-model also has `qr` (see QR handoff) and `stale` (boolean: older than the widget's `stale_after_seconds`; the screen then adds `canccu-is-stale`). A widget with nothing to show has `empty: true` (`canccu-is-empty`) and is skipped in a rotation.

| Type | View-model fields | Source | Live updates | Natural QR target |
|---|---|---|---|---|
| `clock` | `iso`, `time`, `date` | Server time and the event's time zone; ticks on the device | none | — |
| `agenda_now` | `title`, `items` (each `id`, `name`, `state` (`now`, `next`, `delayed`, `cancelled`), `starts_text`, `ends_text`, `starts_at`, `ends_at`, `delay_minutes`, `location`, `kind`) | `GET /api/agenda/now?zone=` (public items only) | `agenda.item.*`, `agenda.kind.*` | `/notify/` (schedule) |
| `countdown` | `label`, `target_at`, `ends_text` | The next agenda item, or `props.item_id`, or a claim's `content` | `agenda.item.*` | — |
| `hot_game` | `game` (`id`, `name`, `cover_url`), `players`, `since` | `games.surge.started` | `games.surge.*`, `games.game.changed` | The game's follow page in the hub |
| `now_playing` | `available`, `games` (each `game_id`, `name`, `players`, `names`: present only with `props.show_names: true`) | The bot's `GET /api/bot/presence/playing` ([bot.md](bot.md#who-plays-what)), once the bot contract adds a module path for it (until then `empty`) | `bot.presence.counted` (re-read, at most every 30 s) | `/notify/` (now playing) |
| `bracket` | `title`, `session` (`id`, `game_name`, `status`), `matches` (each `label`, `state`, `teams` (`name`, `names`), `results` (`rank`, `names`, `points`)) | Tournament events ([events.md](events.md#tournament)) | `tournament.session.*`, `tournament.match.*`, `tournament.result.corrected` | Your matches in the hub |
| `leaderboard` | `title`, `rows` (each `rank`, `name`, `points`, `is_finalist`) | `tournament.leaderboard.changed` | same | — |
| `photo` | `url`, `caption`, `author_name`, `posted_at`, `featured` | Screen's photo carousel (Photos) | `screen.photo.*` | — |
| `announcement` | `title`, `body`, `level` (`info`, `urgent`, `emergency`), `starts_at` | Moments' overrides with template `announcement` | `moments.override.*` | — |
| `ticker` | `text`, `until`, `source` (`admin`, `bot`, `window`) | Screen's ticker (Ticker) | `screen.ticker.changed` | — |
| `food_status` | `state`, `seq`, `pizzeria_name`, `target_at`, `pizza_count`, `people_count`, `holder_name` | Pizza events ([events.md](events.md#pizza)) | `pizza.order.*`, `pizza.item.*` | Your order in the hub |
| `qr` | `url`, `label`, `image_url` | `props.url` (a path on the event's hostname) | none | itself |
| `checkin_qr` | `url`, `label`, `image_url`, `purpose`, `rotates_at`, `valid_until` | Notify's rotating code ([notify.md](notify.md#check-in-by-the-rotating-qr)), once the notify contract adds a module path for it (until then `empty`): purpose `arrival`, or `tournament:<session id>` while `tournament.checkin.opened` is open | A `widget` push at every rotation | itself |
| `venue_info` | `wifi` (`ssid`, `password`, `note`: public networks only), `has_floor_plan` | `GET /api/tenants/current/venue-info` as a guest would see it | `tenants.venue_info.changed` | `/notify/` (venue info) |
| `playlist` | `item` (`kind`, `url`, `slide_urls`, `started_at`, `offset_seconds`, `duration_seconds`, `muted`), `next_item` | The zone's scheduler (Content and scheduling) | `screen.content.pushed`, schedule changes | — |
| `stats` | `members`, `online`, `in_voice` | `bot.presence.counted` | same | — |
| `match_called`, `winner_card`, `sting` | `match_called`: `label`, `game_name`, `teams` (`name`, `names`), `voice_channels` (names); `winner_card`: `title`, `names`, `points`, `image_url`; `sting`: `text`, `image_url` | Only in claims: Moments fills `content` | `moments.override.*` | — |

- `logo` and `embed` are theming's. `sponsor` is reserved for a later step.
- **Names on a screen:** the venue screen shows platform names to everyone in the room. Most come from event-wide `public` events (pizza holders, tournament players); `now_playing` names do not: the bot gives them only to signed-in members and crew ([bot.md](bot.md#who-plays-what)), so a zone shows them only when its organiser opts in, and `GET /api/screen/now` never gives them to a guest (below). Screen stores no presence data ([tenants.md](tenants.md#privacy-and-retention)): `now_playing` names are read live and kept only in the composed state (Valkey, 60 seconds). They show only with `props.show_names: true`, set per zone.
- **Reading other modules as a module:** Screen's server reads the bot's presence API and Notify's check-in codes on behalf of the event's screens, never with a device's request. Neither the bot nor the notify contract has a module path for it yet; until those contracts add one, `now_playing` and `checkin_qr` show `empty`.
- **One source, two surfaces:** the hub reads now and next from `GET /api/agenda/now`, now playing from the bot and announcements from Moments ([notify.md](notify.md#the-hub)); Screen's widgets read the same sources, so they never disagree. `GET /api/screen/now?zone=` serves the hub what a zone's screens show now, following the event's info-page mode: its active claims, the ticker, and the view-models of only these widget types: `clock`, `agenda_now`, `countdown`, `hot_game`, `bracket`, `leaderboard`, `announcement`, `ticker`, `food_status`, `stats`, and `now_playing` (with `names` left out unless the caller is a signed-in member of the event). It never includes `checkin_qr`, `qr`, `venue_info`, `photo`, `playlist` or `embed`: the rotating check-in code proves presence at the venue only while it stays on the screen.

### QR handoff
Any widget entry may carry `props.qr`: `auto` (the type's natural target above), `none` (the default), or a path on the event's hostname starting with `/`. The view-model's `qr` is then `{"url", "label", "image_url"}` or `null`: `url` is absolute on the tenant's `primary_hostname` ([tenants.md](tenants.md#resolving-the-tenant)), `image_url` a `data:image/svg+xml` QR code made by Screen, so a template draws it with `<img src="{{qr.image_url}}">`. The hub itself is the app track.

## The Pulse options
A zone sets, per region id of its layout (`Zone.regions.<region id>`):

| Field | Meaning | Default |
|---|---|---|
| `role` | The region's role (above) | from its id |
| `widgets` | Replaces the layout's widget list for this zone (the theme schema's widget entries) | the layout's |
| `rotation` | `sequence` (in order) or `shuffle` (a new order each cycle, seeded per zone and cycle so all screens of a zone agree) | `sequence` |
| `dwell_seconds` | One dwell for every widget, 5–3600; a widget entry's `props.dwell_seconds` overrides it | the layout's `rotate_seconds` |
| `skip_empty` | Skip widgets with `empty: true` | `true` |
| `idle` | What the region shows when every widget is empty: `logo`, `blank`, or `collapse` (the region's cells are left to the regions it overlaps or the background) | `logo` |

Rotation runs on the server clock: the composed state gives each rotating region `cycle_started_at` and the dwell list, so every screen of a zone shows the same widget at the same moment, also after a reload, and keeps rotating offline.

## Moments drive it: claims
Moments emits `moments.override.started`, `.changed` and `.ended` ([events.md](events.md#screen-overrides)); Screen turns each into claims on the zones it names (`zones` empty: every zone). This contract adds optional fields to the Override, an additive change; an Override without them works as before.

| Field (added) | Type | Meaning |
|---|---|---|
| `regions` | list of string | Roles it may claim, in order of preference: the degrade chain (`["hero", "rail", "ticker"]`). Without it: `takeover` → `["full"]`, `block` → `["hero", "rail", "ticker"]`, `overlay` → `["overlay"]` |
| `ttl_seconds` | integer or null | The claim's first lifetime: `expires_at` is `starts_at` plus this when no `expires_at` is given |
| `expires_at` | string, time, or null | Screen ends the claim itself at this time, also offline, so an override outlives no crash of Moments. Moments renews a claim by sending a later `expires_at` in `.changed`; `starts_at` never moves |
| `sound` | object or null | `cue` (string), `url` (a file of the event), `volume` (0–1), `play` (`once`, `loop`): played by the zone's sound device when the claim first shows |
| `steps` | list of object or null | A Moment sequence: each `template`, `content`, `duration_ms` (500–60000), optional `sound`; played in order in the claimed region, then the last step stays until the end |
| `on_end` | string | What the region shows when the claim ends: `resume` (the rotation where it would be now) or `next` (the next widget). Default `resume` |

- **Placement:** for each zone, Screen walks the claims by `rank` (highest first; ties: the later `starts_at`, then the override id). Each claim takes the first role in its chain that the zone's layout offers and that is free:
  - first ignoring every `full` claim: `hero`, `rail`, `venue_rail`, `ticker` and `overlay` are each free when no higher claim holds that role;
  - `full` is free when no higher claim holds any role other than `overlay`.
- A claim that finds no role at all is **`unplaced`**. A claim placed in any role (also `overlay`) that ranks below a placed `full` claim is **`hidden`**: it keeps its role and waits, not drawn, and shows again when the `full` claim ends. An overlay that ranks above the `full` claim is drawn on top of it. Both are listed in the zone's state and reported in `screen.claims.changed`, so Moments learns of them and decides whether they end. Placement is deterministic and renewals change no tie-breaker, so all screens of a zone agree and regions do not flap.
- **What a claimed region shows:** the claim's `template` names a widget type (the table above; `pizza_placed` draws as `food_status`), `content` is that widget's whole view-model, and `steps` replace both while they run. `full` hides every region; `overlay` draws on top without hiding.
- **Sound** plays once per claim per device; the heartbeat reports played claims, so a reload does not repeat it. The sound budget and cue rules are Moments' (step 4).

Examples (the `override` in `data`; the envelope as in [events.md](events.md)):

An announcement in the rail while a bracket runs in the hero:
```json
{"id": "ov_10", "kind": "block", "zones": ["main"], "rank": 80,
 "source": {"module": "moments", "event_id": null, "ref": null},
 "template": "announcement", "content": {"title": "Dinner is served", "body": "Café, until 19:00", "level": "info", "starts_at": "2026-01-01T18:00:00Z"},
 "regions": ["rail", "ticker"], "ttl_seconds": 300, "sound": {"cue": "announce", "url": null, "volume": 0.8, "play": "once"},
 "steps": null, "on_end": "resume", "starts_at": "2026-01-01T18:00:00Z", "ends_at": "2026-01-01T18:05:00Z"}
```
The bracket stays in `hero` (a `bracket` widget, or a rank-60 claim); the announcement takes `rail`, or the ticker line on a zone whose layout has no rail.

An emergency on the full screen of every zone:
```json
{"id": "ov_11", "kind": "takeover", "zones": [], "rank": 100,
 "source": {"module": "moments", "event_id": null, "ref": null},
 "template": "announcement", "content": {"title": "Please leave the hall", "body": "Follow the exit signs.", "level": "emergency", "starts_at": "2026-01-01T20:00:00Z"},
 "regions": ["full"], "ttl_seconds": null, "sound": {"cue": "emergency", "url": null, "volume": 1, "play": "loop"},
 "steps": null, "on_end": "resume", "starts_at": "2026-01-01T20:00:00Z", "ends_at": null}
```

A hot-game surge, as a short sequence in the hero, falling back to the rail:
```json
{"id": "ov_12", "kind": "block", "zones": ["main", "cafe"], "rank": 50,
 "source": {"module": "moments", "event_id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e90", "ref": "g_1"},
 "template": "hot_game", "content": {"game": {"id": "g_1", "name": "Demo Game", "cover_url": "/games/covers/g_1.webp"}, "players": 14, "since": "2026-01-01T21:10:00Z"},
 "regions": ["hero", "rail"], "ttl_seconds": 120, "sound": null,
 "steps": [{"template": "sting", "content": {"text": "Hot right now", "image_url": null}, "duration_ms": 2500, "sound": {"cue": "sting", "url": null, "volume": 0.7, "play": "once"}},
           {"template": "hot_game", "content": {"game": {"id": "g_1", "name": "Demo Game", "cover_url": "/games/covers/g_1.webp"}, "players": 14, "since": "2026-01-01T21:10:00Z"}, "duration_ms": 30000, "sound": null}],
 "on_end": "next", "starts_at": "2026-01-01T21:10:05Z", "ends_at": "2026-01-01T21:12:05Z"}
```

## Composed state and the push channel
- **State:** `GET /api/screen/device/state` (`ScreenState`): `state_version` (per zone, +1 on every change), `time`, `tenant` (`id`, `name`, `time_zone`, `status`), `device` (`id`, `name`, `mirror`), `zone` (`key`, `name`, `epoch`) or `null`, `bundle` (`version`), `theme` (`revision`, `tokens_css_url`, `css_url`, `logo_url`), `layout` (the whole layout), `regions` (each `id`, `role`, `area`, `layer`, `rotation`, `cycle_started_at`, `widgets` with their view-models, `claim` or `null`), `unplaced`, `hidden`, `ticker`, `sound`, `prefetch` (file URLs the next 24 hours of the schedule need) and `offline` (below). It is everything a screen needs to draw. A device with no zone (paired without `zone_key`, or unassigned) gets the same shape with `zone: null`, `layout: null` and `regions: []`, and shows its name and "not assigned"; its stream stays open, so an assignment arrives as a `state`.
- **Push:** `GET /api/screen/device/stream`, Server-Sent Events. SSE because the traffic is one way, it runs over plain HTTP through Caddy, carries the device cookie, and resumes by itself. Messages (SSE `event:` names, not bus events), each with `id: <zone_key>.<zone_epoch>.<state_version>` (`none.0.<n>` without a zone). `zone_epoch` is set when a zone is created, so a zone removed and created again under the same key never resumes the old one's versions:

| SSE event | `data` |
|---|---|
| `state` | A whole `ScreenState`: on connect, when a resume is not possible, and on every change of the device's assignment or mirror target |
| `widget` | `state_version`, `region_id`, `index`, `view` (the widget's new view-model) |
| `region` | `state_version`, `region` (one region, e.g. a claim placed or ended, a rotation changed) |
| `ticker` | `state_version`, `ticker` |
| `theme` | `state_version`, `theme`: re-read the theme files (after `theming.theme.published`) |
| `command` | `command` (`reload`, `identify`), `expires_at` |
| `ping` | `time`, every 15 seconds |

- **Latency:** a committed change reaches the zone's connected screens within about one second (bus event → composed state → push).
- **Resume:** the stream sends `retry: 2000`. The screen reconnects with `Last-Event-ID`. Screen resumes only when its zone key and epoch are those of the zone the device shows now and it still holds every change since that version (the last 5 minutes per zone): it then sends them in order. Otherwise it sends one `state`. Reconnect delays back off with jitter up to 30 seconds. After three failed connects in a row the screen polls `GET /api/screen/device/state` every 10 seconds while it keeps retrying the stream.
- **Heartbeat:** `POST /api/screen/device/heartbeat` every `heartbeat_seconds` (15) with `state_version`, `now_playing` (`region_id`, `widget`, `item_id` or `claim_id`), `bundle_version`, `theme_revision`, `audio_unlocked`, `viewport`, `claims_sounded` and `errors`. The answer is `server_time`, for the device's clock offset.
- **Device health** (for admin, `GET /api/screen/devices`): `online` (a heartbeat or an open stream within `offline_after_seconds`, 45), `last_seen_at`, `now_playing`, `state_version` behind the zone's, versions and viewport. Changes emit `screen.device.online`, `screen.device.offline` and `screen.device.playing_changed` (at most once per device per 10 seconds).

## Offline, theming and the pinned bundle
- **Offline** ([0013](../docs/decisions/0013-multi-tenant-core.md) item 25): a screen keeps its last composed state and the files it names (and `prefetch`) in its browser cache, and keeps showing them when the uplink drops: rotation, the clock and countdowns run on, a claim ends at its `expires_at` (or its `ends_at`, if earlier), and the playlist plays its cached items. Without a stream for 10 seconds `<body>` gets `canccu-is-offline`, and widgets past `stale_after_seconds` get `canccu-is-stale`. It is not an offline-first player: nothing new starts while offline. Admin shows the device offline.
- **Theming:** screen pages use the stable classes and custom properties ([theming.md](theming.md#stable-classes-and-custom-properties)): `canccu-surface--screen` on `<body>`, `canccu-layout--<id>`, `canccu-region--<id>`, `canccu-widget--<type>` with the state classes. The theme's files are immutable addresses, cached for offline use.
- **CSP:** screen pages add the event's `web_allowlist` origins and `https://www.youtube-nocookie.com` to `frame-src` (the one widening theming allows them). Web assets are framed with `sandbox="allow-scripts allow-same-origin allow-presentation"` and `referrerpolicy="no-referrer"`; the screen reads no messages from them (the screen-embed protocol stays dropped, [0010](../docs/decisions/0010-scope.md)), so the legacy Ready check becomes the frame's load event with a timeout (8 seconds) and the chosen fallback image.
- **Pins** ([0013](../docs/decisions/0013-multi-tenant-core.md) item 23): `GET`, `PUT /api/screen/pin` with `bundle_version` (one of `available`; `null` follows the platform version) and `theme_revision` (a revision of the event's theme; `null` follows the current). Right `screen.bundle.write`; audited. The `/screen/` page loads the pinned bundle from `/screen/b/<version>/`; the platform keeps at least the last 5 bundle versions and any pinned one. Theming keeps a pinned revision ([theming.md](theming.md#draft-preview-publish)), reading it here. Screen builds `ScreenState.theme` (its file URLs and `templates`) and `layout` from the revision in effect, so a pinned screen keeps drawing the pinned revision after a publish. A changed pin reaches screens as a `reload` command. Because the contract only grows, an older bundle keeps working against a newer API.

## Content and scheduling
The legacy signage core, per zone ([inventory](../docs/legacy-inventory/canccusignage.md#features)). Right `screen.content.write` for writes, `screen.content.read` for reads.

- **Assets:** kinds `image`, `video`, `pptx`, `web`, `youtube`. `GET /api/screen/assets` (search `q`, `kind`, paged with `cursor`); `POST /api/screen/assets` (multipart upload, ≤ 100 MiB, or JSON `{"kind": "web"|"youtube", "url", "title"}`); `POST /api/screen/assets/name-check`; `PATCH`, `DELETE /api/screen/assets/{asset_id}` (409 `asset_in_use` while a playlist, an active push or the `ready_fallback_asset_id` setting refers to it; its files go when nothing else refers to them); `POST …/{asset_id}/replace` (multipart) and `POST …/{asset_id}/revert` (one-step undo). Files are checked by content, images scaled to at most 2560×1440 with EXIF orientation applied and metadata dropped, video length read from the file, YouTube URLs normalised and probed (`health`: `ok`, `degraded`, `error`). A web asset's origin must be on `web_allowlist` (400 `origin_not_allowed`). Files are served to the event's devices and to sessions with `screen.content.read` at `/api/screen/files/{sha256}.{ext}` (content-addressed, immutable) and slides at `/api/screen/renders/{asset_id}/{asset_version}/slide-{n}.png`. The server serves a file only when it resolves to an asset version or render row of the current tenant, and builds the storage path from that row; it never joins a path from the request. A file is deleted only when no asset version (also a kept undo version) or render of the tenant refers to it any more, since identical bytes share one file. Counts against the event's storage quota.
- **Playlists:** `type` `regular` (a timeline), `slideshow` (images with one dwell and a cycle) or `break` (the legacy ADVT: timed interrupts, never scheduled, with `period_seconds`, `break_seconds`, an optional daily window, `play_once`, priority chaining, slideshow options, and `region`: `playlist` (inside the playlist widget) or `full`). Items: `asset_id`, `duration_seconds` (`null` = the video's own length), `slide_start`, `slide_end`, `slide_seconds`. `GET`, `POST /api/screen/playlists`; `GET`, `PUT`, `DELETE /api/screen/playlists/{playlist_id}` (the whole playlist with its items and `revision`).
- **Schedule windows:** per zone: `zone_key`, `playlist_id`, `priority` (0–999), `layout_id` (optional), and either weekly `days` with `start_minute` and `end_minute` (overnight allowed, 1440 allowed) or `agenda_item_id` (active while that run-of-show item runs, so the run-of-show drives the scheduler). Times are in the event's time zone. The winner: the highest priority, then the later start, then the playlist's priority, then the id, as in legacy. `GET`, `POST /api/screen/schedules`; `PUT`, `DELETE /api/screen/schedules/{schedule_id}`; `GET /api/screen/schedules/simulate?zone=&at=` (what would play). A zone's `break_min_gap_seconds` (setting) applies between unchained breaks.
- **Scheduler:** one server-side tick per zone owns playback position, bookmarks and breaks; reading the state never changes it.
- **Push content:** `POST /api/screen/push` with `zones` (empty: every zone), `playlist_id` or `asset_id`, and `until` (at most 12 hours ahead): plays it in the zones' `playlist` widgets now, above every schedule window, until `until` or `DELETE /api/screen/push/{push_id}`. Right `screen.push.write`. Emits `screen.content.pushed` and `screen.content.cleared`. Pushing an **override** (an announcement, a takeover) to all zones or one is Moments' announce API (step 4), with `zones` the same way.

### The PPTX render job
A PPTX deck is converted once, all slides, by the render-job container (`screen-render`, LibreOffice and poppler), never inside a request ([0010](../docs/decisions/0010-scope.md)).
- **Isolation:** each job sees only its input deck (read-only) and an empty scratch output directory, never the shared files volume; it has no network; linked and external content is disabled; a deck with external relationships (linked images, OLE links, remote templates) is refused (`file_invalid`). Screen copies the slide PNGs into the files volume after the job.

- **Submit:** uploading a `pptx` asset submits a job; `POST /api/screen/render-jobs` with `asset_id` submits one again (after a failure, or a replace) → 202 with the job. One live job per asset version: a second submit answers the existing job (200).
- **Status:** `GET /api/screen/render-jobs/{job_id}` → `RenderJob`: `id`, `asset_id`, `asset_version`, `state`, `queue_position`, `submitted_at`, `started_at`, `finished_at`, `error` (`code`, `message`). `GET /api/screen/render-jobs?asset_id=` lists them.
- **Result:** `GET /api/screen/render-jobs/{job_id}/result` → `slide_count` and `slides` (each `index`, `url`, `width`, `height`) once `succeeded`; otherwise 409 `render_not_finished`.
- **Cancel:** `DELETE /api/screen/render-jobs/{job_id}` while `queued` or `running`.
- **States:** `queued` → `running` → `succeeded` | `failed`; `queued` or `running` → `cancelled`. Error codes: `render_timeout` (10 minutes), `too_many_slides` (over 300), `file_invalid`, `renderer_failed`.
- **Fair queue** ([0013](../docs/decisions/0013-multi-tenant-core.md) item 27): one running job per event at a time, events served in turn. The container keeps no state: jobs are in Postgres, the queue in Valkey.
- **Files:** slides as PNG under `/files/<tenant>/screen/renders/<asset id>/<asset version>/slide-<n>.png` in the shared files volume, served at `/api/screen/renders/…`; deleted when no asset version refers to them any more. Fonts are the platform-wide set of the render image.
- Emits `screen.render.queued`, `.started`, `.succeeded`, `.failed` and `.cancelled`.

### Ticker
The ticker is manual ([0018](../docs/decisions/0018-ticker-manual.md)): `PUT /api/screen/ticker` with `text` and `until` (or `null` for no end), `DELETE` to clear, `GET` to read; right `screen.ticker.write`. The bot's `/ticker` commands call this with the person's rights. **Ticker windows** (`GET`, `POST /api/screen/ticker/windows`; `DELETE …/{window_id}`) set the text for weekly times and are kept in Postgres. A person's ticker wins over a window. Emits `screen.ticker.changed`.

### Photos
The photo carousel (flag `screen.photos`): `POST /api/screen/photos` (multipart image with `caption`, `author_name`, `author_user_id`, `posted_at`, `source_ref`), `DELETE /api/screen/photos/{photo_id}`, `GET` to list; right `screen.photos.write`. The `photo` widget shows them, a new photo first and `featured` once, then all of them in turn, each for `photo_dwell_seconds`. Emits `screen.photo.added` and `screen.photo.removed`. On `tenants.user.deleted` the user's photos are deleted. Spotlight becomes a Moments takeover.

## Health
`GET /health` (`/api/screen/health` behind Caddy), the shape every module serves ([admin.md](admin.md#health)), with checks `postgres`, `valkey`, `files` and `render` (`degraded` when the render queue is older than 10 minutes).

## Rights
`screen.devices.read` (devices, health, the live mirror), `screen.devices.pair`, `screen.devices.write` (rename, assign, mirror, commands, revoke), `screen.zones.write`, `screen.content.read`, `screen.content.write` (assets, playlists, schedules, render jobs), `screen.push.write`, `screen.ticker.write`, `screen.photos.write`, `screen.bundle.write`, `screen.settings.read` ([admin.md](admin.md#settings)). Event admins hold all of them through their role. Moving and deleting devices is the superadmin's.

## Feature flags
`screen.photos` (photo carousel, default `false`), `screen.web` (web and YouTube assets, default `true`).

## Settings
Per event through the admin settings API (module `screen`): `heartbeat_seconds` (5–60, 15), `offline_after_seconds` (15–300, 45), `web_allowlist` (list of `https://` origins, empty), `break_min_gap_seconds` (0–3600, 60), `progress_bars` (boolean, `true`), `ticker_appearance` (`default`, `high_contrast`, `minimal`, `broadcast`), `ready_timeout_seconds` (1–30, 8), `ready_fallback_asset_id` (string, empty), `photo_dwell_seconds` (5–60, 8).

## Clone with an event
`POST /api/screen/clone` with `source_tenant_id`, by a user with the event-admin role on both events of one series ([tenants.md](tenants.md#series-and-clone)), otherwise 403 `missing_right`. Copies zones, assets (files copied), playlists, schedule windows, ticker windows and the pin's `bundle_version`; the pin's `theme_revision` becomes `null`, since revision numbers are per event. Not copied: devices, assignments, pushes, photos or render jobs (re-run for the copies). The source is read in its own tenant context.

## Audit
Through `POST /internal/tenants/audit` in the same request ([tenants.md](tenants.md#audit-log)): pairing, renaming, moving, transfer and revoking of devices, assignments, pins, `web_allowlist` changes and clone.

## What Screen consumes
| From | Events | Used for |
|---|---|---|
| pizza | `pizza.order.*`, `pizza.item.*` | `food_status`; the ticker fallback line when no ticker is set |
| tournament | `tournament.session.*`, `tournament.registration.*`, `tournament.player.*` (counts), `tournament.checkin.*`, `tournament.match.*`, `tournament.result.corrected`, `tournament.leaderboard.changed` | `bracket`, `leaderboard`, `countdown`; `checkin_qr` with the session's purpose while check-in is open |
| bot | `bot.presence.counted`, `bot.voice_channels.created`; the read API `GET /api/bot/presence/playing` | `stats`, `now_playing` (once the bot contract adds a module path), voice channel names in `match_called` |
| agenda | `agenda.*`; `GET /api/agenda/now` | `agenda_now`, `countdown`, agenda-bound schedule windows |
| games | `games.surge.*`, `games.game.*` | `hot_game` |
| moments | `moments.override.*` | Claims |
| notify | The rotating check-in code, through a module path the notify contract has yet to add | `checkin_qr` |
| theming | `theming.theme.published`; the revision in effect (`GET /api/theming/current`, or the pinned revision as a module, through a module path the theming contract has yet to add) | Layouts, templates, the `theme` push |
| tenants | `tenants.tenant.*`, `tenants.status.changed`, `tenants.venue_ip_check.changed`, `tenants.venue.changed`, `tenants.venue_info.changed`, `tenants.flags.changed`, `tenants.user.deleted` | Tenant cache, venue IP check, `venue_info`, flags, deletes |
| admin | `admin.settings.changed` | Settings |

Media, pizzeria menus and every other event content are not part of the platform: an event's own files are referenced by path in its event profile ([profile.md](profile.md)) and uploaded as assets; nothing event-specific is in this contract.

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). All on the tenant's stream. Listed in the catalog: [events.md](events.md#screen). Audience: system unless noted.

| Type | When | `data` |
|---|---|---|
| `screen.device.paired` | A device was paired on the event | `device_id`, `name`, `zone_key` (or null), `actor_user_id` |
| `screen.device.moved` | The superadmin gave the event a device | `device_id`, `name`, `actor_user_id` |
| `screen.device.released` | The superadmin took a device from the event | `device_id`, `actor_user_id` |
| `screen.device.assigned` | A device's zone or mirror target changed, or it was unassigned | `device_id`, `zone_key` (or null), `mirror_of` (or null), `actor_user_id` |
| `screen.device.revoked` | A device's token was revoked | `device_id`, `actor_user_id` |
| `screen.device.online`, `screen.device.offline` | A device came online or went offline | `device_id`, `zone_key`, `last_seen_at` |
| `screen.device.playing_changed` | What a device shows changed (at most once per 10 s) | `device_id`, `zone_key`, `now_playing` |
| `screen.zone.saved` | A zone was added or changed | `zone_key`, `revision`, `changed`, `actor_user_id` |
| `screen.zone.removed` | A zone was removed | `zone_key`, `actor_user_id` |
| `screen.content.pushed` | Content was pushed to zones | `push_id`, `zones`, `playlist_id` or `asset_id`, `until`, `actor_user_id` |
| `screen.content.cleared` | A push ended | `push_id`, `reason` (`cleared`, `expired`), `actor_user_id` |
| `screen.ticker.changed` | The ticker text changed. Audience: event-wide, `public` | `text` (or null), `until`, `source`, `actor_user_id` |
| `screen.photo.added`, `screen.photo.removed` | A carousel photo was added or removed. Audience: event-wide, `public` | `photo_id`, `actor_user_id` |
| `screen.claims.changed` | Placement of Moments' claims on a zone changed | `zone_key`, `placed` (list of `override_id` and `role`), `unplaced` (override ids), `hidden` (override ids) |
| `screen.render.queued`, `.started`, `.succeeded`, `.failed`, `.cancelled` | A render job moved | `job_id`, `asset_id`, `asset_version`, `state`, `slide_count` (succeeded), `error` (failed) |

```json
{"id": "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4ea0", "type": "screen.render.succeeded", "version": 1,
 "time": "2026-01-01T15:02:00Z", "source": "screen", "tenant": "demo",
 "data": {"job_id": "rj_1", "asset_id": "as_7", "asset_version": 2, "state": "succeeded", "slide_count": 12, "error": null}}
```

## From the legacy API
| Legacy | Here |
|---|---|
| `GET /api/screen/state` (polled every second) | `GET /api/screen/device/state` and the push stream |
| `POST /api/screen/playback-progress` | Gone: the server-side scheduler owns bookmarks |
| `POST /api/screen/ready-log`, `youtube-playback-error` | The heartbeat's `errors` |
| `POST /api/screen/sound-*` | The heartbeat's `audio_unlocked` and `claims_sounded`; the sound board is Moments' (step 4) |
| `GET /api/asset`, `GET /api/pptx-slide` | `/api/screen/files/{file}` and `/api/screen/renders/…`; slides from the render job's result |
| `/api/admin/assets*` | `/api/screen/assets*` |
| `/api/admin/playlist*`, `…/advt`, `…/priority`, `…/reorder`, `…/settings` | `/api/screen/playlists/{playlist_id}` (one document); ADVT is the `break` type |
| `/api/admin/schedules*`, `/schedule/simulate`, `/advt-gap` | `/api/screen/schedules*`; the gap is a setting |
| `/api/admin/screen-display`, `/api/admin/triggers` (display part) | Settings; layouts and templates are theming's |
| `/api/admin/ticker`, `/api/control/override` label `ticker` | `/api/screen/ticker` |
| `/api/admin/override`, `/api/control/override`, directives | Moments (step 4) |
| `/api/carousel/photos`, `/api/admin/carousel*` | `/api/screen/photos`; spotlight is a Moments takeover |
| `/api/control/triggers` | The bot's own settings (bot contract) |
| `/api/health`, `/api/healthz`, `/api/readiness` | `GET /health`; device health |
| `/api/admin/auth/*`, `/api/admin/session`, `/api/admin/sounds*` | Central sign-in and admin; sounds are Moments' |
| `/screen?mirror=1` | Assignment with `mirror_of`, or the admin's live mirror |

## Not in this contract
The screen module's code, the admin pages, migrating old data (none is migrated, [0004](../docs/decisions/0004-nothing-migrated.md)), media and menus (event repo), Moments' ranking, sound board and announce API (step 4), the hub (app track).
