# Experience map: who builds what

One page for the workers of every step. Each concept on the screens has one home module, a roadmap step, and the contracts it touches. If a concept is not in your row, you render or call it; you do not own it.

Issue numbers are the ones named in the round 6 brief. "Additive" means a contract change that adds fields or events and breaks nothing.

## Screen (step 3: #375, #383–#385)

| Concept | What Screen owns | Contract touch points |
|---|---|---|
| Layouts | The six built-ins (Pulse, Dashboard, Hero, Split, Ambient, Portrait), the box editor in Screen studio | `screen.md` built-in layouts and zone settings; `theming.md` layouts as data |
| Widgets | Drawing every widget from its view-model; the states (empty, stale, offline); the 33 px floor | `screen.md` Widgets; `theming.md` widget templates. New widget types are additive |
| The two backgrounds | The stage (drifting glows, art layers, scrim) and the card background per widget; the "tint the stage" request a box can make | `theming.md` stable classes and custom properties (additive: stage layers, card art) |
| Motion vocabulary | The effects inside a box and the box-level effects, as theme data; the 3-per-second and reduced-motion rules | `theming.md` (additive: motion speed, intensity, spotlight effect, motion pack) |
| Energy rendering | Drawing none, calm, lively and party. Screen renders the level it is told; it does not decide it | `screen.md` zone settings (additive: `motion_level`) |
| The hero role | In a Dashboard, one box holds the hero role (top-left by default; the crew picks it). A showcase (a crew spotlight, a surging game, a called match) grows it to 2 × 2 for its duration | `screen.md` zone settings (additive: `hero_region`, `grow_for_showcase`) |
| The Director | The hero's feature rotation: priority, freshness, queue jumping, the turn indicator | `screen.md` region settings (`widgets`, `dwell_seconds`, `skip_empty`; additive: feature priority, indicator) |
| The choreographer | Pacing: at most one notable change every few seconds, one spotlight at a time | None; a rule of the player |
| Playlists and breaks | PPTX, video and slideshow as hero features; the break playlist cutting in and leaving | `screen.md` Content and scheduling, push content |
| Device frames and safety elements | Pairing, offline marker, takeover styling | `screen.md` device API; `theming.md` safety rule |
| The screen's name in the header | Hidden automatically with one screen; a setting otherwise | `screen.md` zone settings (additive) |

## Moments (step 4: #111 brief, #112 engine, #113 sound, #114 storyboards, #115 announce)

| Concept | What Moments owns | Contract touch points |
|---|---|---|
| Scenes (the autopilot) | Triggers, actions, hold and blend times, presets, the priority list, the timeline preview data. Quiet hours as a scene | New `moments.md` section; emits scene changes that Screen, Notify and theming follow. `agenda.md` item kinds as a trigger input |
| Crew spotlight | A ranked override with live-updating content, a duration and zones | `events.md` Screen overrides (`moments.override.*`, kind `block`); `screen.md` claims |
| Cues (picture and sound) | Which cue plays for which event; effect pools; the random pick; cooldowns and the flood guard | `events.md` Screen overrides (additive: a cue on an override or on its own); the legacy sound engine's categories |
| Sound | Categories (bell, fanfare, alert, pizza, photo, ambient), cooldowns, per-zone sound screen, mute rules | #113; `screen.md` heartbeat field `claims_sounded` |
| Storyboards | Multi-step sequences in a claimed region (sting, then card) | #114; `screen.md` claim `steps` |
| Announcements | The one announce action; urgent and emergency levels; the takeover | #115; `events.md` Screen overrides (kind `takeover`, `overlay`) |
| Reactions on screen | Rate limiting, the allowed set, moderation, the on/off switch | New, additive; shown by Screen as an overlay claim |
| Visual heartbeat | The rate, from activity. Screen draws the pulse | Additive field on the scene state |

## Tournament (step 7: #126, #128; wired to screens in step 9)

| Concept | Owner | Contract touch points |
|---|---|---|
| Leaderboard, bracket, match called | Tournament emits; Screen draws the widgets; Moments turns "match called" into a cue | `events.md` tournament events (`tournament.leaderboard.changed`, `tournament.match.called`); `screen.md` `bracket`, `leaderboard`, `match_called` |

## Bot (step 6, plus #389 in step 9)

| Concept | Owner | Contract touch points |
|---|---|---|
| Presence, voice, who plays what | Bot | `bot.md` presence API; `screen.md` `stats`, `now_playing` |
| Statistics history and trends | Bot stores per-hour history in the platform database (#389); Screen computes the arrows from it | Additive history endpoint; `screen.md` new widgets `stats_history`, `top_games`, `voice_rooms` |

## Games track (#66 / #173)

| Concept | Owner | Contract touch points |
|---|---|---|
| The hot game and surges | Games emits; Screen promotes the game and tints the stage; Moments picks the cue | `events.md` `games.surge.*`; `screen.md` `hot_game` |
| Game art (covers, banners) | Games supplies URLs; Screen's server blurs once and caches | Additive fields on the game |

## Games system: tournament roster and bracket (to be planned later)

| Concept | Owner | Status |
|---|---|---|
| The tournament roster and the bracket, as their own widget family | The Games system. Screen will draw the widgets; the Director may feature them and a showcase may grow them to 2 × 2 | To be planned later. The standings, bracket and "match called" drawn on sheets 13 and 16 are placeholders for the look, not a specification |

## App track (#160 / #171)

| Concept | Owner | Contract touch points |
|---|---|---|
| Sending a reaction from the hub | App | Calls Moments' reactions API |
| The crew spotlight flow on the phone | App draws the four steps; Moments creates the override | Moments API |

## Event profile (tenants, admin; existing)

| Concept | Owner | Contract touch points |
|---|---|---|
| The event span for graphs and the scenes timeline | The event's dates in the profile | `tenants.md` event dates; read by Screen and Moments |
| Event-wide defaults | Admin module settings keep only defaults; per-widget settings live in Screen studio | `admin.md` settings; `screen.md` zone and widget props |

## Where each setting lives

| Setting | Lives in |
|---|---|
| Which layout a zone uses; a box's widget, size, visibility | Screen studio → Zones and layouts |
| Seconds per photo; graph window, type and metric; the turn indicator | The widget's settings in Screen studio |
| Scenes, their triggers and actions | Screen studio → Scenes (data owned by Moments) |
| Effect pools and sounds per event kind | Screen studio → Cues (data owned by Moments) |
| How strong and fast each motion level is; the motion pack (Standard, Broadcast, Arcade) | Theme studio → Advanced |
| Event-wide defaults (default seconds per slide, offline timing) | Admin → Settings → Screens |

## Open points for the leads

- Scenes need a home in the Moments contract before step 4 starts; Screen only needs `motion_level`, layout and stage mood per zone as inputs.
- The outside signal (a webhook with a name and a value) is drawn as planned, not built first.
- Statistics widgets ship with "Collecting…" until #389 lands.
- Reactions need a moderation decision (a fixed set of words is drawn).
