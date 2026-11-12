# Widget catalogue

One entry per widget a screen can show. A widget is drawn by a theme template from its view-model; it never reads other data. Sizes are for a 1920×1080 screen and scale with it; nothing is under 33 px. "Levels" are the motion levels: none, calm, lively, party.

**Rules that hold for every widget**

- **Cues hold.** When a widget's box gets a cue, the move is small and takes about 0.6 s; a frame and soft glow then stay on the box for 60–120 s and fade over 10 s.
- **The hero role.** In a Dashboard any box can hold the hero role; a showcase grows that box to 2 × 2 and the other widgets shrink to a one-line headline (label and main value) until it ends.

- **States.** *Empty*: the widget is skipped in its box's rotation; a box with nothing to show follows the zone's `idle` setting. *Stale* (the source has not answered for 2 minutes): the value stays, dimmed to 60 %, with "as of 18:40" at 33 px. *Offline* (the screen lost its uplink): clocks and countdowns run on; live numbers freeze and show "as of"; anything that would mislead (a check-in code, a food status) hides.
- **Numbers roll; they never jump.** A changed number rolls to its new value in 0.7 s. At the none level it swaps.
- **Trend arrows.** Every statistic carries ▲, ▼ or –. The arrow compares the average of the last 10 minutes with the 10 minutes before. It turns only when the change is 3 % or more (and at least 2 in absolute terms), and then holds for at least 60 s, so it never flickers. Shape carries the meaning; colour (ok, down, muted) backs it up.
- **Spotlight.** A widget may ask for the screen's spotlight; the screen grants one at a time, at most one every 10 s.
- **Theme hooks.** Every widget has the stable class `canccu-widget--<type>` and uses the theme's colours, fonts, motion speed and intensity. The effect names below are the ones on the "Screens in motion" sheet.

## Widgets in the screen contract

| Widget | Purpose | Data | Sizes at 20 m | Animations and triggers | Own states |
|---|---|---|---|---|---|
| `clock` | The event's time, on every layout | Server time, event time zone; ticks on the device | Time 44 px in the header, 290 px in Ambient; date 33 px | Minute change: split-flap flip (calm and up) | Offline: keeps ticking |
| `agenda_now` | What is on now and what comes next | Public run-of-show items: title, start, end, place, delay | Title 61 px, times 55 px, place 40 px, delay badge 33 px | New item: slide in. A delay: the time flips and the badge pops (party). Item starts: rows slide up | Empty: "Nothing more today", with tomorrow's first item |
| `countdown` | Time to the next item, or to a chosen one | `target_at`, label | Digits 65 px, label 55 px | Seconds flip. At 5:00 it takes the spotlight until 0:00 (glow pulse and tracing border at lively; plus pop and ring burst at party; a steady outline at calm) | Empty when nothing is ahead; hidden, never "00:00" |
| `hot_game` | The game that is surging | Game name, cover, players, since | Name 46 px, players 55 px | Arrive: the cover fades up and the background takes the game's art. Players roll, with a trend arrow | Empty: skipped |
| `now_playing` | Who plays what right now | Games with player counts (names only if the zone allows) | Rows 40 px, counts 55 px | Counts roll; a new game slides in; rows re-sort with a slide | Stale after 2 min |
| `bracket` | A tournament's matches | Matches, teams, results | Team names 40 px, scores 55 px | A result: the score flips, the winner's row gets a shimmer sweep, the line to the next round draws | Empty before the draw: the title and the start time |
| `leaderboard` | A ranking | Rank, name, points | Rows 40 px | Points roll; a rank change slides the rows past each other, with ▲n or ▼n for 60 s | — |
| `photo` | The photo wall (seconds per photo and order are this widget's settings in Screen studio) | Image, caption, author | Caption 44 px, author 36 px | A new photo pops into the wall (scale from 0.9 with a soft edge); older ones cross-fade every dwell | Empty: skipped |
| `announcement` | A message from the crew | Title, body, level | Title 65 px, body 40 px | Slide in; an urgent one takes the spotlight (ripple) once; an emergency is a takeover, not a widget | Ends at its end time even when offline |
| `ticker` | Short lines along the bottom | Text lines | 45 px | Crawls (44 s, 30 s or 22 s a loop by level); a new line types in at lively and party. None: steps line by line | Empty: the band collapses |
| `food_status` | Where the pizza order is | State, count, target time, holder | State 55 px, time 55 px | State change: flip, then a pop (party). "Arrived": confetti burst at party, shimmer at lively | Offline: hidden (it would mislead) |
| `qr` | A link to scan, usually the hub | URL, label | Code 270 px or more, label 33 px | None; a ripple once when it first appears (lively and up) | — |
| `checkin_qr` | The rotating check-in code | URL, `rotates_at` | Code 270 px or more, label 33 px | A thin bar drains until the next rotation; the code cross-fades when it rotates | Offline: hidden, with one line saying when it is back |
| `venue_info` | Wi-Fi and venue facts | Network name, note | Name 55 px, note 33 px | None | — |
| `playlist` | Slides, images and video from the scheduler | Current item, next item | Content fills the box | Cross-fade between items; a progress bar; nothing else, so content is never competed with | Offline: plays what is cached |
| `stats` | How many are here | Members, online, in voice | Numbers 71 px, labels 33 px | Numbers roll; trend arrows nudge when they turn (lively and up); a sparkline of the last hour draws on arrival; a round figure gets a ring burst (party) | Stale: dimmed, "as of" |
| `match_called`, `winner_card`, `sting` | Moments' own templates | From the claim | Per template | Owned by Moments; Pulse only yields the box | — |
| `logo` | The event's logo | Theme | 46 px high in the header | None | Missing logo: the event's initials |
| `embed` | A sandboxed web page | URL | Fills the box | None from the platform | Offline: its last frame or skipped |

## New in this proposal

| Widget | Purpose | Data | Sizes at 20 m | Animations and triggers | Trend logic | Own states | Card background |
|---|---|---|---|---|---|---|---|
| `stats` (reworked "Right now") | How many are here | Online, in voice, checked in; the day's peak and its time | Number 71 px, label and peak 33 px | The number rolls; the arrow sits beside it on the same line and nudges when it turns; a sweep of light when a value changes (lively and up) | 10-minute averages, 3 % threshold, 60 s hold | With three numbers in a narrow box the peak line drops out. No sparkline | Plain |
| `activity_graph` | Presence, voice or games over time | One value per hour, plus the game most played that hour | Fills the box; labels 33 px; peak icons 55 px | Bars grow from the baseline 40 ms apart; the newest bar grows live | The peak label rolls on a new peak, with a ring burst at party | Settings: metric (online, voice, games), window (24 h, the whole event, custom), type (bars, area, hour by day), colour by top game. Under 3 hours of data: "Collecting…" | Plain |
| `top_games` | The most played games | Game, hours, previous rank, banner | Rows 40 px or more | Hours bars grow; hours roll; two rows slide past each other on a rank change | ▲n, ▼n or – against one hour ago, held 60 s; "new" for a first entry, "rising" for two moves up in an hour | Empty: skipped | The leader's art under the card's veil; a banner per row |
| `voice_rooms` | Which voice rooms are busy | Room, people | Rows 40 px, counts 55 px | Counts roll; rooms re-sort with a slide | An arrow per room | None in use: skipped | Plain |
| `next_chip` | "Next starts in", inside another box | As `countdown` | Label 55 px, digits 65 px | Owner of the 5-minute spotlight: pop, glow and tracing border at lively; plus a burst at party | — | — | — |
| `leaderboard` (live) | A tournament's standings | Rank, name, points, finalist flag | Rows 40 px or more | Points roll and their bars grow; rows slide on a rank change; finalists are framed | ▲n, ▼n per row | Before the first result: the title and the start time | The tournament's colours |
| `bracket` (live) | A tournament's matches | Matches, teams, scores, which is live | Names 40 px, scores 40 px | The live match has a frame; a result flips the score and draws the line onward | — | Before the draw: title and start | The tournament's colours |
| `match_called` | Calls two teams to their stage | Teams, stage, voice room, time left | Teams 80 px, place 55 px | Tracing border and ripple; a bell if sound is on. Owned by Moments as a cue | — | Ends when the match starts | Plain |
| `reactions` | Attendee reactions floating up the large panel's edge | Hearts, stars and a fixed set of short words, from the hub | Icons 65 px, words 33 px | Each floats up for 7 s and fades | — | At most one a second per screen; off at the none level and in a quiet scene; the crew can switch them off | — |
| Hero features | What the large panel rotates | `playlist`, `hot_game`, `bracket` or `leaderboard`, `photo`, tonight's highlight, a sponsor slot (planned), "Today in numbers" | Titles 75–92 px | A feature fades and rises in; the turn indicator (line, ring or off) fills | — | Picked by priority and freshness; a surge or a new photo jumps the queue | Each feature brings its own |

## Proposals for later

| Widget | Purpose | Data needed | Motion |
|---|---|---|---|
| `milestone` | A live milestone: "1,000 hours played", "200 online", "Longest session: 14 h" | Thresholds over the bot's totals | Appears only when crossed: the number rolls up to it, then a confetti or ring burst (party) or a shimmer (lively); stays 5 minutes |
| `tournament_progress` | Where a tournament is: round 3 of 5, matches done | Tournament session | A stepped bar; a finished match fills its step with a pop |
| `photo_pop` | The newest photo over the wall for 10 s | Screen's photos | Pop-in over the playlist, caption types in |
| `player_spotlight` | A player card: most hours today, a winner (with consent, names as the hub shows them) | Bot totals, tournament results | Slide in, then a shimmer sweep |
| `arrivals` | Who just checked in: "12 arrived in the last 10 minutes" | Check-in counts (no names by default) | The count rolls; a trend arrow; dots drop in |

## Data note

`stats_history`, `top_games` and `milestone` need the bot's history (presence, voice and play time per hour) in the platform's database. The widgets are designed now and show "Collecting…" until that data exists.
