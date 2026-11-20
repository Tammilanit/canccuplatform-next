# The grid audit (#640)

Every `grid-template-columns` in the organiser and screen CSS on main at `9f02c35`, with the decision under amendment 3 ([`../README.md`](../README.md#3--grids-scale-with-their-content-2026-11-19)). Rows 1–103 are the modules (`modules/*/static/*.css`, the agenda and notify modules' `static/`, the player's `player/src/`), 104–114 the shared `packages/ui/ui.css`, 115–120 the column lists written another way (the `grid-template` shorthand and the columns the player and the Studio set from a theme's layout). Paths drop the leading `modules/` and `src/canccu_<module>/static/` or `static/`.

**Totals.** 114 `grid-template-columns` rules, 103 of them in modules; 97 have a fixed track list, 17 already use `auto-fill` or `auto-fit`. Decisions: **12 Rule** (become `.canccu-grid`), **3 Band** (a side column becomes a band), **5 Remove** (the rule makes them unnecessary), **100 Keep** (marked with their kind and reason).

**Decisions.**
- **Rule: card, small or tile** — the element takes `.canccu-grid` (with `--small` or `--tile`), and the module's columns go. The old minimum is named when it changes.
- **Band** — the panels leave the side column for a band: crew actions above the collection, related panels below in `.canccu-band`.
- **Remove** — the declaration goes, because the rule covers it.
- **Keep: kind — reason** — the declaration stays and gets the guard's marker, `/* canccu-grid: fixed <kind> — <reason> */`; a row without a reason takes the kind's own: a `form` lays out fields, a `table` keeps its columns in line across rows, a `row` lays out one item's own parts, a `control` has a fixed count of choices, a `master-detail` page shows the picked item beside its list, a `screen` is the player's or a layout's own grid, the `shell` is the organiser shell.

| # | Where | Page | Selector | Lays out | Today | Decision |
|---|---|---|---|---|---|---|
| 1 | `agenda/agenda.css:44` | Run of show: an item's hero | `.canccu-agenda-delay` | the delay chips (+5, +10, +15, Other…) | `repeat(4, minmax(0, 1fr))` | Keep: control — four fixed choices in one row |
| 2 | `agenda/agenda.css:112` | Run of show: day view, phone | `.canccu-agenda-row` | a row's time, item and marker | `3.5rem minmax(0, 1fr) 1.25rem` | Keep: row |
| 3 | `agenda/agenda.css:185` | Run of show: the picked item's side | `.canccu-agenda-side .canccu-dl` | label and value | `5.5rem minmax(0, 1fr)` | Keep: row |
| 4 | `agenda/agenda.css:186` | Run of show: the picked item's side | `.canccu-agenda-side__actions` | its two buttons | `1fr 1fr` | Keep: control — two equal buttons |
| 5 | `agenda/agenda.css:236` | Run of show: day view | `.canccu-agenda-head, .canccu-agenda-row` (@media (min-width: 40.01rem)) | the table's head and rows | `4rem 3rem minmax(0, 1fr) 7rem 6rem 1.25rem` | Keep: table |
| 6 | `agenda/agenda.css:294` | Run of show: day view at 1440 px | `.canccu-agenda-hero:has(.canccu-agenda-hero__screen)` (@media (min-width: 1440px)) | the hero beside the live miniature | `minmax(0, 1fr) 336px` | Keep: master-detail — the item now beside what the screen shows |
| 7 | `agenda/agenda.css:301` | Run of show: day view at 1440 px | `.canccu-agenda-day:has(.canccu-agenda-side)` (@media (min-width: 1440px)) | the list beside the picked item | `minmax(0, 1fr) 23rem` | Keep: master-detail |
| 8 | `agenda/agenda.css:350` | Run of show: new item, quick add | `.canccu-agenda-when` | the day and the time fields | `minmax(0, 1fr) 6.5rem` | Keep: form |
| 9 | `agenda/confirm.css:6` | Run of show: delay and edit confirm | `.canccu-agenda-preview .canccu-dl, .canccu-agenda-variant…` | label and value | `6.5rem minmax(0, 1fr)` | Keep: row |
| 10 | `moments/moments.css:10` | Studio → Moments → On air | `.moments-zones` | the zone cards | `repeat(auto-fill, minmax(16rem, 1fr))` | Rule: card (16 rem → 18 rem); dead once #639's board lands, then removed |
| 11 | `moments/moments.css:21` | Studio → Moments → On air | `.moments-onair` (@media (min-width: 64rem)) | zones beside a side column of panels | `1fr 18rem` | Band: crew actions above, Storyboards and Scenes below (see the build issue) |
| 12 | `moments/moments.css:142` | Studio → Scenes | `.moments-bands__row,.moments-bands__axis` | the band chart's label and its day | `6.5rem 1fr` | Keep: row |
| 13 | `moments/moments.css:213` | Studio → Scenes: a scene's editor | `.moments-pair` | two fields side by side | `repeat(auto-fit, minmax(12rem, 1fr))` | Keep: form |
| 14 | `moments/moments.css:218` | Studio → Scenes: a scene's editor | `.moments-checks` | the zone and hero-feature checkboxes | `repeat(auto-fill, minmax(9rem, 1fr))` | Rule: small (9 rem → 10 rem) |
| 15 | `moments/moments.css:228` | Run the event → Announcements | `.moments-announce` (@media (min-width: 64rem)) | the composer beside its preview | `minmax(0, 1fr) minmax(0, 1fr)` | Keep: master-detail — the form and what it shows |
| 16 | `moments/organiser.css:13` | Studio → Moments → Priorities | `.moments-priorities` (@media (min-width: 64rem)) | the order beside the rules | `26rem minmax(0, 1fr)` | Keep: master-detail |
| 17 | `moments/organiser.css:33` | Studio → Moments → Priorities | `.moments-order__row` | an order row's rank, name and handle | `2.75rem minmax(0, 1fr) auto` | Keep: row |
| 18 | `moments/organiser.css:124` | Studio → Moments → Priorities | `.moments-rule__seconds` | a rule's seconds field and unit | `minmax(0, 1fr) 4.5rem` | Keep: row |
| 19 | `moments/organiser.css:146` | Studio → Moments → Priorities | `.moments-rule` (@container rules (min-width: 34rem)) | a rule's fields at 34 rem | `repeat(2, minmax(0, 1fr))` | Keep: table — a rule row's columns |
| 20 | `moments/organiser.css:158` | Studio → Moments → Priorities | `.moments-rule` (@container rules (min-width: 52rem)) | a rule's fields at 52 rem | `13rem repeat(3, minmax(0, 1fr)) auto` | Keep: table |
| 21 | `moments/organiser.css:195` | Studio → Moments → History | `.moments-filters` | the filters | `repeat(auto-fill, minmax(10rem, 1fr))` | Rule: small (one wrapping row of filters above the table) |
| 22 | `moments/organiser.css:223` | Studio → Moments → History, phone | `.moments-history td` (@media (max-width: 40rem)) | a row as label and value | `6.5rem minmax(0, 1fr)` | Keep: row |
| 23 | `moments/organiser.css:246` | Studio → Moments → Storyboards | `.moments-stories` (@media (min-width: 64rem)) | the catalogue beside the Fire column | `minmax(0, 1fr) 18rem` | Band: Fire above the catalogue |
| 24 | `moments/organiser.css:279` | Studio → Moments → Storyboards | `.moments-preset` (@container presets (min-width: 34rem)) | a preset row's columns | `minmax(0, 1.2fr) minmax(0, 1fr)` | Remove: each storyboard becomes a card in a card grid (sheet 05) |
| 25 | `moments/organiser.css:303` | Moments: the spotlight form | `.moments-photos` | the photo picker's thumbnails | `repeat(auto-fill, minmax(6.5rem, 1fr))` | Rule: tile (6.5 rem → 7 rem) |
| 26 | `moments/sound-desk-lists.css:32` | Studio → Moments → Cues: master strip | `.moments-master .moments-slider` | the master slider's label, track and value | `auto minmax(6rem, 14rem) auto` | Keep: row |
| 27 | `moments/sound-desk-lists.css:162` | Studio → Moments → Cues | `.moments-cuehead,.moments-cue` | the cue list's head and rows | `2.5rem minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 1.1fr) 5.5rem 3.5rem` | Keep: table |
| 28 | `moments/sound-desk-lists.css:256` | Studio → Moments → Cues → Library | `.moments-sounds` | the sound cards | `repeat(auto-fill, minmax(min(100%, 17rem), 1fr))` | Rule: card (17 rem → 18 rem) |
| 29 | `moments/sound-desk-pages.css:13` | Studio → Moments → Cues → Limits | `.moments-limits` | the budget sliders | `repeat(auto-fit, minmax(min(100%, 14rem), 1fr))` | Keep: form — a few fields that share the row |
| 30 | `moments/sound-desk-pages.css:21` | Studio → Moments → Cues → Limits | `.moments-zonehead,.moments-zonerow` | the per-zone table | `minmax(0, 0.8fr) repeat(2, minmax(0, 1.2fr)) repeat(2, minmax(0, 1.3fr))` | Keep: table |
| 31 | `moments/sound-desk-pages.css:40` | Studio → Moments → Cues → Limits | `.moments-categoryhead,.moments-category` | the categories table | `9rem minmax(0, 1.6fr) auto auto 3rem` | Keep: table |
| 32 | `moments/sound-desk-pages.css:45` | Studio → Moments → Cues → Limits | `.moments-category .moments-slider` | a category's slider and value | `minmax(0, 1fr) 3.5rem` | Keep: row |
| 33 | `moments/sound-desk-pages.css:57` | Studio → Moments → Cues → Log | `.moments-loghead,.moments-logrow` | the log's head and rows | `5.5rem 6.5rem minmax(0, 1.1fr) minmax(0, 2fr)` | Keep: table |
| 34 | `moments/sound-desk-pages.css:67` | Studio → Moments → Cues → Log | `.moments-logrow__what` | what happened and its code | `auto minmax(0, 1fr)` | Keep: row |
| 35 | `moments/sound-desk-pages.css:128` | Studio → Moments → Cues: cue editor | `.moments-editor__grid` (@media (min-width: 64rem)) | the Sound and Picture cards | `minmax(0, 1.45fr) minmax(0, 1fr)` | Keep: form — one editor in two halves |
| 36 | `moments/sound-desk-pages.css:155` | Studio → Moments → Cues: cue editor | `.moments-mini` | the live preview's six boxes | `repeat(3, minmax(0, 1fr))` | Keep: screen — the dashboard's six boxes |
| 37 | `moments/sound-desk-pages.css:303` | Studio → Moments → Cues, phone | `.moments-cue` (@media (max-width: 40rem)) | a cue row | `2.5rem minmax(0, 1fr) auto` | Keep: row |
| 38 | `moments/sound-desk-pages.css:315` | Studio → Moments → Cues → Limits, phone | `.moments-zonerow` (@media (max-width: 40rem)) | a zone row | `minmax(0, 1fr) minmax(0, 1fr)` | Keep: row |
| 39 | `moments/sound-desk-pages.css:323` | Studio → Moments → Cues → Limits, phone | `.moments-category` (@media (max-width: 40rem)) | a category row | `minmax(0, 1fr) auto` | Keep: row |
| 40 | `moments/sound-desk-pages.css:335` | Studio → Moments → Cues → Log, phone | `.moments-logrow` (@media (max-width: 40rem)) | a log row | `auto minmax(0, 1fr)` | Keep: row |
| 41 | `moments/sound-desk-pages.css:349` | Studio → Moments → Cues, phone | `.moments-player` (@media (max-width: 40rem)) | the themed player | `auto minmax(0, 1fr) auto auto` | Keep: row |
| 42 | `moments/sound-desk-pages.css:360` | Studio → Moments → Cues → Library, phone | `.moments-sound .moments-player, .moments-chosen .moments-…` (@media (max-width: 40rem)) | the player in a sound card | `auto auto minmax(0, 1fr) auto auto` | Keep: row |
| 43 | `moments/sound-desk.css:126` | Studio → Moments → Cues | `.moments-slider` | a slider's label and value | `minmax(0, 1fr) auto` | Keep: row |
| 44 | `moments/sound-desk.css:189` | Studio → Moments → Cues: cue editor | `.moments-fieldrow` | a field and its unit | `minmax(0, 1fr) auto` | Keep: row |
| 45 | `moments/sound-desk.css:260` | Studio → Moments → Cues | `.moments-player` | the themed player's controls | `auto auto minmax(0, 1fr) auto auto` | Keep: row |
| 46 | `moments/story-builder.css:130` | Studio → Moments → Storyboards: builder | `.moments-builder__grid` (@media (min-width: 1100px)) | rounds, steps and the preview column | `11rem minmax(0, 1fr) minmax(17rem, 20rem)` | Keep: master-detail |
| 47 | `moments/story-controls.css:7` | Studio → Moments → Storyboards: builder | `.moments-chiprow` | a chip row's label and chips | `6.5rem minmax(0, 1fr)` | Keep: form |
| 48 | `moments/story-controls.css:93` | Studio → Moments → Storyboards: builder | `.moments-grid` | the step form's two field columns | `repeat(2, minmax(0, 1fr))` | Keep: form |
| 49 | `moments/story-controls.css:221` | Studio → Moments → Storyboards: builder, phone | `.moments-chiprow` (@media (max-width: 40rem)) | a chip row | `minmax(0, 1fr)` | Keep: form |
| 50 | `moments/story-controls.css:229` | Studio → Moments → Storyboards: builder, phone | `.moments-grid` (@media (max-width: 40rem)) | the step form | `minmax(0, 1fr)` | Keep: form |
| 51 | `moments/story-side.css:113` | Studio → Moments → Storyboards: builder | `.moments-storychecks__item` | a check's icon and sentence | `1.125rem minmax(0, 1fr)` | Keep: row |
| 52 | `notify/notify.css:15` | Notifications → a custom topic | `.canccu-notify-condition` | a condition, phone | `1fr` | Keep: form |
| 53 | `notify/notify.css:21` | Notifications → a custom topic | `.canccu-notify-condition` (@media (min-width: 36rem)) | a condition's three fields | `2fr 1.5fr 2fr` | Keep: form |
| 54 | `notify/notify.css:31` | Check-in display | `.canccu-checkin__row` | an arrival's icon and name | `auto 1fr` | Keep: row |
| 55 | `screen/player/src/claims.css:202` | Screen: the hot game | `.canccu-region > .canccu-widget--hot_game` | its cover and text | `auto 1fr` | Keep: screen |
| 56 | `screen/player/src/dashboard.css:79` | Screen: Dashboard, wide | `.canccu-layout--dashboard .canccu-region:not([data-role="…` (@container (aspect-ratio > 2)) | a box's widget rows | `auto auto 1fr` | Keep: screen |
| 57 | `screen/player/src/dashboard.css:124` | Screen: Dashboard, wide | `.canccu-layout--dashboard .canccu-region:not([data-role="…` (@container (aspect-ratio > 2)) | a countdown and its label | `minmax(0, 1fr) auto` | Keep: screen |
| 58 | `screen/player/src/director.css:71` | Screen: activity graph | `.canccu-widget__gridline` | the axis gutter and the bars | `var(--canccu-graph-gutter) 1fr` | Keep: screen |
| 59 | `screen/player/src/director.css:180` | Screen: Today in numbers | `.canccu-widget__figures` | three figures | `repeat(auto-fit, minmax(0, 1fr))` | Keep: screen |
| 60 | `screen/player/src/layouts.css:14` | Screen: Split rail | `.canccu-layout--split .canccu-region[data-role="rail"] .c…` | a now row | `auto 1fr` | Keep: screen |
| 61 | `screen/player/src/layouts.css:55` | Screen: Split rail | `.canccu-layout--split .canccu-region[data-role="rail"] .c…` | a next row | `auto auto 1fr` | Keep: screen |
| 62 | `screen/player/src/layouts.css:61` | Screen: Split rail | `.canccu-layout--split .canccu-region[data-role="rail"] .c…` | a delayed row | `auto auto auto 1fr` | Keep: screen |
| 63 | `screen/player/src/layouts.css:72` | Screen: Dashboard rail | `.canccu-layout--dashboard .canccu-region[data-role="rail"…` | a delayed row | `auto auto 1fr` | Keep: screen |
| 64 | `screen/player/src/layouts.css:246` | Screen: Ambient rail | `.canccu-layout--ambient .canccu-region[data-role="rail"] …` | a row | `auto auto auto 1fr` | Keep: screen |
| 65 | `screen/player/src/player.css:316` | Screen: the kiosk check | `.canccu-selfcheck` | a check's mark, name and result | `auto auto 1fr` | Keep: screen |
| 66 | `screen/player/src/rail.css:24` | Screen: run of show widget | `.canccu-widget--agenda_now .canccu-widget__row` | a row | `auto 1fr` | Keep: screen |
| 67 | `screen/player/src/rail.css:82` | Screen: run of show widget | `.canccu-widget--agenda_now .canccu-widget__row--next, .ca…` | a next row | `auto 1fr` | Keep: screen |
| 68 | `screen/player/src/rail.css:88` | Screen: run of show widget | `.canccu-widget--agenda_now .canccu-widget__row--delayed` | a delayed row | `auto 1fr` | Keep: screen |
| 69 | `screen/player/src/rail.css:132` | Screen: venue card | `.canccu-widget--venue_info .canccu-widget__row` | the Wi-Fi and the hub QR | `minmax(0, 1fr)` | Keep: screen |
| 70 | `screen/player/src/screen.css:191` | Screen: every widget | `.canccu-widget__row` | a row's label and value | `1fr auto` | Keep: screen |
| 71 | `screen/player/src/wall.css:21` | Screen: photo wall | `.canccu-widget__wall` | the wall's tiles | `repeat(4, minmax(0, 1fr))` | Keep: screen — five tiles in the panel's two rows (Changes since v7, 6) |
| 72 | `screen/player/src/wall.css:149` | Screen: Pulse portrait rail | `.canccu-layout--pulse_portrait .canccu-region[data-role="…` | a delayed row | `auto 1fr` | Keep: screen |
| 73 | `screen/studio-content.css:142` | Screen studio → Content | `.canccu-studio-uploads > li` | an upload's name and progress | `minmax(0, 1fr) 8rem` | Keep: row |
| 74 | `screen/studio-content.css:170` | Screen studio → Content | `.canccu-studio-library` | the library, phone | `repeat(2, minmax(0, 1fr))` | Rule: small (one rule for 74–77) |
| 75 | `screen/studio-content.css:178` | Screen studio → Content | `.canccu-studio-library` (@media (min-width: 768px)) | the library from 768 px | `repeat(3, minmax(0, 1fr))` | Remove: the rule covers it |
| 76 | `screen/studio-content.css:184` | Screen studio → Content | `.canccu-studio-library` (@media (min-width: 1280px)) | the library from 1280 px | `repeat(4, minmax(0, 1fr))` | Remove: the rule covers it |
| 77 | `screen/studio-content.css:190` | Screen studio → Content | `.canccu-studio-library` (@media (min-width: 1600px)) | the library from 1600 px | `repeat(5, minmax(0, 1fr))` | Remove: the rule covers it |
| 78 | `screen/studio-content.css:273` | Screen studio → Content | `.canccu-studio-slides` | a playlist's three slides and +N | `repeat(4, minmax(0, 1fr))` | Keep: control — a fixed summary of four cells |
| 79 | `screen/studio-layout.css:34` | Screen studio → Zones and layouts | `.canccu-studio-laypick` | the layout gallery | `repeat(auto-fill, minmax(7rem, 1fr))` | Rule: tile |
| 80 | `screen/studio-motion.css:15` | Screen studio → Zones and layouts: motion | `.canccu-studio-motion-levels` | the four motion levels | `repeat(4, minmax(0, auto))` | Keep: control |
| 81 | `screen/studio-playlists.css:29` | Screen studio → Content | `.canccu-studio-content__grid` (@container canccu-content (min-width: 52rem)) | the library beside the playlist builder | `minmax(0, 1fr) minmax(22rem, 42%)` | Keep: master-detail |
| 82 | `screen/studio-playlists.css:33` | Screen studio → Content | `.canccu-studio-content__main .canccu-studio-library` (@container canccu-content (min-width: 52rem)) | the library in that layout | `repeat(2, minmax(0, 1fr))` | Remove: the rule adapts to its column |
| 83 | `screen/studio-playlists.css:134` | Screen studio → Content: playlist | `.canccu-studio-item` | an item and its tools | `minmax(0, 1fr) auto` | Keep: row |
| 84 | `screen/studio-playlists.css:145` | Screen studio → Content: playlist editor | `.canccu-studio-item--edit` | handle, title, length, tools | `auto minmax(0, 1fr) auto auto` | Keep: row |
| 85 | `screen/studio-playlists.css:229` | Screen studio → Content: playlist | `.canccu-studio-run li` | a run's time, title and length | `3.5rem minmax(0, 1fr) auto` | Keep: row |
| 86 | `screen/studio-schedule-edit.css:86` | Screen studio → Schedule: window editor | `.canccu-studio-days` | the seven days | `repeat(7, minmax(0, 1fr))` | Keep: control |
| 87 | `screen/studio-schedule.css:32` | Screen studio → Schedule | `.canccu-sched__layout` | the week beside its side column | `minmax(0, 1fr) minmax(16rem, 22rem)` | Keep: master-detail — the side shows the picked window |
| 88 | `screen/studio-schedule.css:372` | Screen studio → Schedule, phone | `.canccu-sched__layout` (@media (max-width: 60rem)) | one column | `minmax(0, 1fr)` | Keep: master-detail |
| 89 | `screen/studio-zone.css:9` | Screen studio → Zones: zone editor | `.canccu-studio-editor` (@import url("studio-layout.css"); .canccu-studio-editor) | the editor beside preview and Go live | `minmax(0, 1fr) minmax(18rem, 24rem)` | Keep: master-detail |
| 90 | `screen/studio-zone.css:85` | Screen studio → Zones: zone editor | `.canccu-studio-map` | the region map | `repeat(4, minmax(0, 1fr))` | Keep: screen — the layout's own grid |
| 91 | `screen/studio-zone.css:154` | Screen studio → zone editor; Theme studio | `.canccu-studio-row` | a region's settings fields | `repeat(auto-fit, minmax(15rem, 1fr))` | Keep: form |
| 92 | `screen/studio-zone.css:239` | Screen studio → zone editor, phone | `.canccu-studio-editor` (@media (max-width: 60rem)) | one column | `minmax(0, 1fr)` | Keep: master-detail |
| 93 | `screen/studio.css:22` | Screen studio → Live | `.canccu-studio-grid` | every zone's live view | `repeat(auto-fill, minmax(18rem, 1fr))` | Rule: card |
| 94 | `screen/studio.css:119` | Screen studio → Devices at 1440 px | `.canccu-studio-split` (@media (min-width: 1440px)) | the devices beside Recent | `minmax(0, 1fr) 20rem` | Band: Recent below the devices |
| 95 | `screen/studio.css:125` | Screen studio → Devices | `.canccu-studio-devices` | the device cards | `repeat(auto-fill, minmax(17rem, 1fr))` | Rule: card (17 rem → 18 rem) |
| 96 | `screen/studio.css:265` | Screen studio → Schedule: window editor | `.canccu-studio-columns` | the start and end fields | `repeat(auto-fit, minmax(8rem, 1fr))` | Keep: form |
| 97 | `theming/preview.css:6` | Theme studio: the screen preview | `.canccu-layout--preview` | the preview's hero and rail | `2fr 1fr` | Keep: screen |
| 98 | `theming/studio-previews.css:10` | Theme studio → Brand kit | `.canccu-studio-previews__row` | the three surface previews | `repeat(auto-fit, minmax(min(12rem, 100%), 1fr))` | Keep: screen — each preview at its surface's shape, scaled to its box |
| 99 | `theming/studio.css:38` | Theme studio → Brand kit | `.canccu-studio-kit` | the kit beside its previews | `minmax(18rem, 26rem) minmax(0, 1fr)` | Keep: master-detail — the form and what it draws |
| 100 | `theming/studio.css:44` | Theme studio → Brand kit, phone | `.canccu-studio-kit` (@media (max-width: 60rem)) | one column | `minmax(0, 1fr)` | Keep: master-detail |
| 101 | `theming/studio.css:133` | Theme studio → Advanced | `.canccu-studio-pair` | a colour's swatch and hex | `repeat(2, minmax(0, 1fr))` | Keep: row |
| 102 | `theming/studio.css:167` | Theme studio → Advanced | `.canccu-studio-colours` | the colours | `repeat(auto-fill, minmax(min(13rem, 100%), 1fr))` | Rule: small (13 rem → 10 rem; label above the swatch) |
| 103 | `theming/studio.css:220` | Theme studio → Themes | `.canccu-studio-swatches` | the swatches | `repeat(auto-fill, minmax(min(11rem, 100%), 1fr))` | Rule: small (11 rem → 10 rem) |
| 104 | `packages/ui/ui.css:509` | Shell: the menu sheet under 1100 px | `.canccu-menu__sheet` (@media (max-width: 1099.98px)) | the menu and its close | `minmax(0, 1fr) auto` | Keep: shell |
| 105 | `packages/ui/ui.css:645` | Every form | `.canccu-form__row` | label and field pairs | `minmax(0, 1fr) minmax(0, 1fr)` | Keep: form |
| 106 | `packages/ui/ui.css:701` | Every form, phone | `.canccu-form__row` (@media (max-width: 40rem)) | one column | `minmax(0, 1fr)` | Keep: form |
| 107 | `packages/ui/ui.css:714` | Admin → Settings | `.canccu-split` | the form page's side column | `minmax(0, 40rem)` | Keep: form — Settings' last changes beside the form |
| 108 | `packages/ui/ui.css:723` | Admin → Settings at 1440 px | `.canccu-split` (@media (min-width: 1440px)) | the form beside its history | `40rem minmax(0, 1fr)` | Keep: form |
| 109 | `packages/ui/ui.css:739` | Admin → Settings; Devices' Recent | `.canccu-history li` | a history line's time and text | `5.5rem minmax(0, 1fr)` | Keep: row |
| 110 | `packages/ui/ui.css:831` | Lists with a glance, phone | `.canccu-list__row:has(> .canccu-list__end > .canccu-list_…` (@media (max-width: 40rem)) | a list row's parts | `auto minmax(0, 1fr) auto` | Keep: row |
| 111 | `packages/ui/ui.css:1057` | Every label and value list | `.canccu-dl` | label and value | `7.5rem 1fr` | Keep: row |
| 112 | `packages/ui/ui.css:1081` | Admin → Health | `.canccu-stats` | the count tiles | `repeat(auto-fit, minmax(8rem, 1fr))` | Rule: small (auto-fit → auto-fill: four tiles keep their width; two by two on a phone, one column under 360 px; `.canccu-stats` shares `.canccu-grid--small`'s selectors) |
| 113 | `packages/ui/ui.css:1586` | Front door: sign-in, check-in | `.canccu-front` | the poster beside the form | `minmax(0, 1fr) 27rem` | Keep: shell |
| 114 | `packages/ui/ui.css:1664` | Front door under 1100 px | `.canccu-front` (@media (max-width: 1099.98px)) | one column | `minmax(0, 1fr)` | Keep: shell |
| 115 | `screen/player/src/widgets.css:53` | Screen: a crew spotlight | `(grid-template)` | the photo beside the name and zone | `auto minmax(0, 1fr)` | Keep: screen |
| 116 | `screen/player/src/screen.ts:104` | Screen: every layout | `(set from the layout)` | the layout's regions | `the theme layout's columns` | Keep: screen — from the theme's layout (contracts/theme.schema.json) |
| 117 | `screen/studio-layout.js:17` | Screen studio → Zones and layouts | `(set from the layout)` | the layout map and gallery boxes | `repeat(columns, minmax(0, 1fr))` | Keep: screen |
| 118 | `packages/ui/ui.css:203` | Shell | `(grid-template) .canccu-shell` | menu and content | `16rem minmax(0, 1fr)` | Keep: shell |
| 119 | `packages/ui/ui.css:450` | Shell without a menu, at 1100 px and wider | `(grid-template) .canccu-shell--bare` | one column | `minmax(0, 1fr)` | Keep: shell |
| 120 | `packages/ui/ui.css:466` | Shell under 1100 px | `(grid-template) .canccu-shell` | one column and the bar | `minmax(0, 1fr)` | Keep: shell |

**Not grids.** Several pages lay collections out with flex or a list, not with grid columns, and are left as they are: the Scenes page's ranked list (`.moments-scenes`), the cue list's rows (row 27 is its table), admin's People table, the run of show's day list. Amendment 3 says why scenes, cues and people stay lists or tables.

**#639.** The open On air fix adds `modules/moments/static/on-air.css`, whose `.moments-board` is `repeat(auto-fill, minmax(18rem, 1fr))` with the three panels as siblings of the zone cards (`display: contents` on the zones' wrapper). Whichever merges first, the build issue brings On air to the rule: see [`build-issue.md`](build-issue.md).
