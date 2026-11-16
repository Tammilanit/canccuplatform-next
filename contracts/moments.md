# Moments contract

Moments is the venue's autopilot at the peaks: one server-side arbiter ranks, times, queues and refuses everything that claims a screen, per zone, and Screen places what it decides ([screen.md](screen.md#moments-drive-it-claims), step 4 plan D1). The `moments` module owns it. Nothing else emits screen overrides ([events.md](events.md#screen-overrides)).

**Machine-readable API: [moments.openapi.yaml](moments.openapi.yaml)** (OpenAPI 3.1). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

The contract comes in parts, each with the package whose code uses it (step 4 plan D24): **the engine** (this text: moments, priorities, the arbiter's rules, the crew spotlight, emergency, built-in rules, history), then scenes, cues and sound (#113), storyboards (#114) and announcements (#115).

## Tenancy
- Moments belong to one event, which is one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)); the tenant comes from the request's hostname. Every row carries `tenant_id` under row-level security. Events go to `t:<tenant>:events:moments`.
- An archived event's Moments are read-only: writes get 409 `event_archived`. Archiving ends every moment, the emergency included (E10, below).
- The one action across events is the superadmin's venue-wide emergency (Emergency, below).

## Words
- A **moment** is one thing that wants screen time: a crew spotlight, an emergency, a rule's hot game. It is a row in Postgres from its request to its end; a restart of Moments loses nothing (E2).
- Moments shows a moment by emitting one or more **overrides** ([events.md](events.md#screen-overrides)); Screen turns them into claims and places them by `rank` and the region chain (`regions`).
- Each moment has a **class**, and the event's **priority order** of the classes gives its `rank`.
- **Patience** is how long a moment waits for its first place on a zone before it gives that zone up.

## Classes and the priority order
| Class | Default rank | Kind, regions | Who starts it |
|---|---|---|---|
| `emergency` | 100, locked at the top | `takeover`, `["full"]` | people with `moments.emergency`, the superadmin |
| `stream` | 90 | (the Cast track, later) | — |
| `announcement` | 80 | `block`, `["rail", "ticker"]` | the announcement composer (#115), the pizza rule, "All clear" |
| `spotlight` | 70 | `block`, `["hero"]` | the crew (`moments.take`) |
| `storyboard` | 65 | (storyboards, #114) | — |
| `tournament` | 60 | `block`, `["hero", "rail"]` | rules |
| `finals` | 55 | `block`, `["hero"]` | rules |
| `hot_game` | 50 | `block`, `["hero", "rail"]` | rules |
| `reactions` | 20 | (the App track, later) | — |
| `ticker` | 10 | `block`, `["ticker"]` | modules |

- **The order:** the event has one order of the ten classes, highest first; a zone may keep its own. A class's rank is the rank of its place: the n-th class in an order gets the n-th of 100, 90, 80, 70, 65, 60, 55, 50, 20, 10. The default order is the table's. `emergency` is always first, in every order, so nothing outranks it.
- `GET /api/moments/priorities` (right `moments.read`) → `PriorityOrders`: `order` (the event's), `zones` (each `zone_key` and its own `order`; a zone that follows the event is not listed), `ranks` (each class's rank in the event's order), `revision`.
- `PUT /api/moments/priorities` (right `moments.settings.write`) with `order`, `zones` and `revision` replaces both. Each order names every class once, `emergency` first (else 400 `invalid_request`); a stale `revision` is 409 `version_conflict`. Audited.
- **A priority change takes effect at once** (E8): every running moment is ranked again and its overrides get the new `rank` through `.changed`. A moment that loses its region is hidden or waits; a priority change never ends one.
- **Zones with their own order:** an override has one `rank`, so a moment whose zones rank it differently is shown by one override per rank. The override for the zones that follow the event's order has the moment's id; one for a zone's own rank has `<moment id>.<rank>`. The zones a moment's overrides cover never overlap.

## Moments
A `Moment`: `id`, `class`, `rank` (in the event's order), `kind`, `regions`, `template`, `content`, `zones` (empty: every zone of the event), `origin` (`rule`, `crew`, `emergency` or `module`), `rule_id` (or null), `source` (as the Override's), `actor` (`user_id` and `name` of the person, or null), `starts_at`, `expires_at` (or null: no end of its own), `patience_seconds`, `qr` and `binding` (Live and interactive, below), `placements` (each zone Screen reported: `zone_key`, `state`, `role` or null, `since`), `ended_at`, `end_reason`.

- `GET /api/moments/moments` (right `moments.read`) → the running moments, highest rank first, with the zones Moments knows (`zones`: each zone key Screen has named, from its zone events and claim reports). The On air page reads it.
- **A request** (`MomentRequest`): `class`, `template`, `content`, and optionally `zones`, `regions` (default the class's), `ttl_seconds`, `patience_seconds`, `qr`, `binding`, `source`, `dedupe_key`. Modules send one to `POST /internal/moments/moments?tenant_id=` (the kit's service identity); people use the crew actions below. The `emergency` class is never requested this way (400 `invalid_request`).
- **Answers:** 201 with the `Moment` when it started, 200 with it when it renewed one (E4, below), 409 `moment_refused` with `retry_after_seconds` (30) and `held_by` (the moment that holds its regions) when it was refused.

### The arbiter's rules
The legacy directive rules, moved to the server and made regional:
- **TTL:** a moment lives `ttl_seconds` (default 120, 1 to 7200); `expires_at` is its start plus that. Screen ends the claim at `expires_at` by itself, also while Moments is down. An emergency has no TTL.
- **Re-posting extends it** (E4): a request whose `dedupe_key` (default: the rule and the source's `ref`) names a running moment renews it: with the same `template` and `content` only `expires_at` moves (now plus its TTL, `.changed` with `changed: ["expires_at"]`); with new content the content changes too. `starts_at` never moves.
- **Refusal with retry:** a rule's moment (and a module's) is refused when, on every zone it names, every role of its chain is held by a higher rank, as Screen last reported (a `full` claim holds every role but `overlay`). The answer, and the rule, wait 30 s before asking again. People's moments are never refused: they wait.
- **Share before you queue:** an accepted moment takes the first free role of its chain on each zone (Screen's placement). Where none is free it waits, at most `patience_seconds` (default: 120 for a rule's, its whole TTL for people's), then gives that zone up (`.ended` there, `preempted`). Patience counts only until its first place on the zone: once shown, a moment that is pushed aside waits hidden until its own end.
- **Revert:** when a higher moment ends, Screen places the ones it held aside again where they would be now, and the history notes them as back. A moment whose time ran out meanwhile does not come back.
- **Ends:** by its `expires_at` (`expired`), by a person (`cleared`), by its patience (`preempted`), or when its source ends (`source_ended`: a surge ended, a match started, the event was archived, its zone was removed).

### Placement from Screen
Moments follows `screen.claims.changed` ([screen.md](screen.md#events-version-1)): for each zone, which of its overrides are `placed` (and in which role), `unplaced` (waiting) or `hidden` (under a `full` claim). It stores each as the moment's placement on that zone and writes the history from it. `screen.zone.saved` and `screen.zone.removed` tell it the event's zones; a moment leaves a removed zone (`source_ended`, E9).

### The overrides it emits
`moments.override.started`, `.changed` and `.ended` ([events.md](events.md#screen-overrides)) with the fields of [screen.md](screen.md#moments-drive-it-claims). `ttl_seconds` is never sent: `expires_at` always is (null for an emergency). `.ended` carries the additive field `final` (below).

- **Narrowing (D3):** when an override leaves some of its zones but stays on others, Moments first emits `.changed` with `zones` narrowed to the explicit list it still holds (`changed` names `zones`), then `.ended` with just the zones it left and `final: false`. An override that held every zone (`zones: []`) is narrowed to the zones Moments knows minus the ones it leaves.
- **`final`** (boolean, additive): `true` only when the override is gone everywhere. An `.ended` with `zones: []` ends it everywhere and is always `final: true`.

### Live and interactive (D18)
- **`qr`** (`path` on the event's hostname, starting with `/`, and `label`): the moment's view-model gets `qr` (`url`, `label`, `image_url`) as Screen's widgets do ([screen.md](screen.md#qr-handoff)), so the template draws the code.
- **`binding`** (`source`: `leaderboard`, `session` with `ref` the session id, or `none`): the content follows that source. Moments keeps the latest tournament leaderboard and sessions from the catalog's events, and each change re-renders the bound moments' content and sends it in `.changed` (`changed: ["content"]`). Before the source has spoken the content is a placeholder ("Collecting standings…").

## The crew spotlight (D18, L15)
`POST /api/moments/spotlight` (right `moments.take`) with `show` (`standings`, `bracket`, `photo` or `message`), `zones` (default every zone), `duration_seconds` (default 300, 1 to 7200), and per `show`: `session_id` (bracket), `photo_url` and `caption` (a path on the event's hostname, photo), `title` and `body` (message); optionally `qr`. It starts a `spotlight` moment in the hero: standings as `leaderboard` and the bracket as `bracket` (both bound, live), a photo as `photo`, a message as `announcement` (level `info`). The content carries `from_crew: true`, so the screen says "From the crew" and never the name; the history keeps who started it.

## Emergency (mockup 07, U4, E10)
- `POST /api/moments/emergency` (right `moments.emergency`) with optional `title`, `body` (defaults: "Please leave the hall", "Follow the exit signs.") and `zones` (default every zone): a takeover in `full` at rank 100 with template `announcement` and level `emergency`, no end time, `kind` `takeover`. One per event: a second start while one runs is 409 `emergency_active`. The page asks for a 2-second hold before it sends.
- `POST /api/moments/emergency/end` (right `moments.emergency`) with `all_clear` (boolean): one tap ends it everywhere (`cleared`); with `all_clear` an "All clear" `announcement` takes the rail for 60 s. Every moment it held aside comes back if its time has not run out (Revert).
- **Venue-wide:** the superadmin, on the superadmin hostname only, `POST /api/moments/venue-emergency` with `venue_id`, `title` and `body`, and `POST /api/moments/venue-emergency/end` with `venue_id` and `all_clear`, starts or ends the emergency of every event at that venue that is not archived (404 `not_found` without one). Each event's history names the superadmin.
- Nothing outranks it, and no rule, module or scene starts or ends one: only these four paths do. Archiving the event ends it with every other moment (`source_ended`).

## Crew actions on running moments (U12)
- `POST /api/moments/moments/{id}/end` (right `moments.take`) with optional `zone_key`: ends a crew moment everywhere, or, with `zone_key`, any moment on that zone only ("End in zone"; a rule's moment ends there for this occurrence: the rule fires again next time). An emergency needs `moments.emergency` and ends only through Emergency.
- `POST /api/moments/moments/{id}/extend` (right `moments.take`) with `seconds` (1 to 3600): moves `expires_at` on, at most 7200 s after now.

## Idempotency (E18)
Every crew action (`POST` on the spotlight, emergency, venue emergency, end and extend) carries a key, the header `Idempotency-Key` (8 to 64 characters of `A–Z a–z 0–9 - _`; without one 400 `invalid_request`). The same key from the same person within 24 hours answers what the first request answered and does nothing again, so a phone's retry never sends twice. The pages put a fresh key in each form.

## Built-in rules (D7, D8)
Rules turn catalog events into moments. Each built-in has these settings per event: `enabled`, `template` (one of the rule's), `class` (its rank), `regions`, `ttl_seconds`, `zones` and `cue` (the sound cue it will ask for once cues land, #113; it plays nothing yet). `GET /api/moments/rules` (right `moments.read`) lists them with their `revision`; `PUT /api/moments/rules/{rule_id}` (right `moments.settings.write`) with the settings and `revision` changes one (409 `version_conflict` on a stale one). Audited. They fire when their emitters appear (tested on fixture events now); a later step may redefine its own rules.

| Rule | On | Shows (template, class, regions, TTL) | Ends early on (`source_ended`) |
|---|---|---|---|
| `match_called` | `tournament.match.called` | `match_called`, `tournament`, hero → rail, 300 s | `tournament.match.started` of the match |
| `standings` | `tournament.leaderboard.changed` | `leaderboard`, `tournament`, hero → rail, 120 s, bound to the leaderboard | — |
| `finals_result` | `tournament.match.finished` of a final (`session.is_final`) | `winner_card`, `finals`, hero, 120 s | — |
| `pizza` | `pizza.order.placed`, `pizza.order.arrived` | `pizza_placed`, `announcement`, rail → ticker, 300 s | `pizza.order.cancelled` |
| `hot_game` | `games.surge.started` | `hot_game`, `hot_game`, hero → rail, 120 s | `games.surge.ended` of the game |

## History (D21, mockup 09)
- Every decision is a row: a moment started, was refused, placed, hidden, queued (waiting), came back, changed or ended, with the zone (or none for the whole moment), the region, why (the rule and its event, or the person and the action), what it displaced, and how it ended. A renewal of the same content writes nothing.
- `GET /api/moments/history` (right `moments.read`) with filters `zone` (its rows and the whole-moment rows), `region`, `origin` (`rule`, `crew`, `emergency`, `module`) and `action`, newest first, `limit` (default 100, at most 500) and `before` (a row's `seq`, for the next page). `GET /api/moments/history.csv` answers the same rows, at most 10,000, as CSV.
- Kept for the event's life; deleted 30 days after the event is archived.

## Pages
Studio → Moments, the Screen studio's Moments tab, at `/moments/` (Caddy strips the prefix), phone-first; a signed-out browser goes to `/admin/sign-in?next=`. `/moments/` opens **On air** while the event is live and **Priorities** before (U9).
- **On air** (mockup 03, and the phone's Screens tab, mockup 04, U6): a column per zone with what is placed, hidden and waiting and why, time left, Extend and End in zone; the crew actions Spotlight and Emergency (hold 2 s).
- **Spotlight:** the crew spotlight's form.
- **Priorities** (mockup 08): the event's order and each zone's, moved up and down and saved; a preview of a zone in the real player through Screen's zone preview path (`POST /api/screen/zones/{zone_key}/preview` with `ranks`), with the running moments ranked as the order on the page would rank them; the built-in rules' settings.
- **History** (mockup 09): the table per zone with its filters and Export CSV.

## Rights
U2 as amended by U3: `moments.read` (On air, History, the settings read-only), `moments.announce` (#115), `moments.take` (the crew spotlight, ending and extending moments), `moments.scenes.take` (scenes), `moments.emergency` (start and end an emergency), `moments.settings.write` (priorities and rules; later scenes, storyboards, cues, templates). Event admins hold all of them through their role.

**The "Moments crew" preset** (`moments_crew`): `moments.read`, `moments.announce`, `moments.take` and `moments.scenes.take`, a name for that list as `screen_crew` is ([screen.md](screen.md#rights)). `moments.emergency` is granted one by one to named crew.

## Audit
Through `POST /internal/tenants/audit` in the same request ([tenants.md](tenants.md#audit-log)): every crew action (spotlight, end, extend), every emergency start and end (the venue-wide one in each event), and every change of the priorities and the rules, with the old and new values.

## Privacy
The history keeps the name and user id of whoever started or ended a moment. `GET /api/moments/me/export` answers the caller's history rows at this event; `DELETE /api/moments/me` removes their name and id from them ([README.md](README.md#privacy-export-and-delete)). `tenants.user.deleted` does the same in every event; `tenants.tenant.deleted` deletes the event's rows.

## What Moments consumes
| From | Events | Used for |
|---|---|---|
| screen | `screen.claims.changed`, `screen.zone.saved`, `screen.zone.removed` | Placements, the history, the event's zones |
| tournament | `tournament.match.called`, `.match.started`, `.match.finished`, `tournament.leaderboard.changed`, `tournament.session.*`, `tournament.result.corrected` | Rules; the spotlight's standings and bracket |
| pizza | `pizza.order.placed`, `.arrived`, `.cancelled` | The `pizza` rule |
| games | `games.surge.started`, `games.surge.ended` | The `hot_game` rule |
| tenants | `tenants.status.changed`, `tenants.tenant.deleted`, `tenants.user.deleted` | Archiving (E10), deletes |
| admin | `admin.rights.changed` | Rights cache |

## Events (version 1)
Emitter `moments`, on the tenant's stream; listed in the catalog ([events.md](events.md#screen-overrides)). Audience event-wide, `public`.

| Type | When | `data` |
|---|---|---|
| `moments.override.started` | An override starts | `override` (Override), `actor_user_id` |
| `moments.override.changed` | Its rank, zones, content or `expires_at` changed | `override`, `changed` (field names), `actor_user_id` |
| `moments.override.ended` | It left zones or ended | `override_id`, `zones`, `reason`, `final`, `actor_user_id` |

## Not in this contract
Scenes, cues and sound (#113: the rules' `cue` plays nothing until then), storyboards (#114), announcements and their composer (#115), reactions (the App track), the director desk (later), cloning Moments' settings with an event (with scenes, D22).
