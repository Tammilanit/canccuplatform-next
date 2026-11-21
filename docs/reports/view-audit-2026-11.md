# View audit, 2026-11: steps 3 and 4 against the rules of 2026-11-21

The product owner asked on 2026-11-21 for the views built so far to be checked, in retrospect, against the rules accepted that day, and for what breaks them to be fixed in each step's polish (#720). This report covers the pages of steps 3 and 4: Screen, Moments, Theming, Notify, Admin and the run of show (Agenda). Step 5 (Food) is checked in its own deep review. Nothing is redrawn or rebuilt here; each module's fixes are filed as one `blocked` issue, which the lead schedules into a step's polish.

## What was checked, and how

- **Shots:** the `demo-screenshots` artifact of main's CI run [44940683970](https://github.com/Tammilanit/canccuplatform-next/actions/runs/44940683970) (commit 49c9398, the latest main run that finished; the two after it were cancelled). A shot's name without a suffix is 1280 × 800, `-phone` is 390 px, `-wide` 1440 px, `-1920` 1920 px; most are full page. The names below are those PNGs.
- **Pages:** every attendee and crew page of the six modules, at each width it was shot, and the screens' status states (identify, pairing, check, refused and the rest, 1920 × 1080) for internal words only. The tall full-page shots were cut into readable slices and every page was read; a sample of the findings was looked at a second time.
- **The rules** ([the design guideline's amendments](../design/README.md#amendments-accepted-by-the-po-binding-for-the-build)):
  - **Form** and **Boxes**: amendment 3's "Choose the form first" (#716): a card grid only for a collection of like items, a table for things compared by column, a ranked list where order matters, a hero for the one main thing; few boxes, no box around a single item or line, no box in a box, no text framed twice.
  - **Day schedule**: amendment 4: anything planned in time is one day at a time, times down the side, days switched with a day picker.
  - **Desktop**: amendment 5: at 1280 px a real desktop layout, never a phone column stretched or centred. The shell's 64 rem column beside the menu is the accepted default for forms and lists; a page is flagged when its content is still laid out as a phone.
  - **Words**: no internal words on screens ([briefs README](../briefs/README.md)): no code event names, keys, ids, file names, paths, versions, roadmap steps or right names in text a user sees.
- **Size:** S is a wording or CSS change in one place; M reworks a page's layout or a control.
- **Not counted as findings:** the count tiles on Health (amendment 3 names them as small grid items); the storyboards' leading numbers (their catalogue order, amendment 3, "Order is stable"); the platform's wordmark on the screens; the run of show's day table, which is amendment 4's own model.

## Findings

### Admin (sign-in, settings, health, event profile, people)

| Page | Shots | Rule | Fix | Size |
|---|---|---|---|---|
| Sign-in, sign-in off | `sign-in`, `sign-in-phone`, `sign-in-no-event`, `sign-in-archived-phone` | Boxes | "Sign-in isn't switched on yet" is a framed notice inside the framed sign-in card: show it as a plain line with its icon. | S |
| Offline | `offline` | Desktop | On a PC it says "Your phone has no connection": say "This device has no connection". | S |
| Settings | `settings`, `settings-phone` | Words | Section summaries "Heartbeat, offline mark, web pages, ticker" and "Surges, games members add": plain summaries ("how often screens check in, when they show as offline, …"). | S |
| Settings › Screens | `settings-screen`, `settings-screen-change-phone` | Words | "Heartbeat", "slow uplink", "(https:// origins)": "How often a screen checks in", "slow connection", "Web addresses screens may show" with an example in the hint. | S |
| Settings › Screens | `settings-screen` | Words | "Asset shown when content is not ready in time" is free text for a raw asset reference: a picture picker, "Picture shown while content loads". | M |
| Settings › Screens | `settings-screen` | Boxes | The Food section is a whole card around one checkbox ("Holder names"): show it as an unframed row or join a neighbouring section. | S |
| Health | `health-view`, `health-view-phone`, `health-view-trouble` | Words | Columns Version ("dev") and Log name (`notify`, `screen-render`, …), and "look at `notify`" in the help: name the part ("Notifications"); put version and log name behind a "Details for the technician" disclosure. | S |
| Event profile | `profile`, `profile-phone` | Words | "A zip with profile.yaml and its assets" and the "Modules 9" row: "The file Download this profile gives you"; name the parts switched on, or drop the count. | S |
| Event profile, load and upload | `profile-load-ask`, `profile-upload-ask` | Desktop | The three buttons stack full width at 1280 px: one right-aligned row on a desk. | S |
| People › Remove | `people-remove`, `people-remove-phone` | Boxes | "Remove Player 2" as the page title and again as the card title: keep one heading. | S |
| People › Person | `people-person-phone` | Needs a 1280 px shot | — | — |

### Notify (notification topics, check-in, privacy)

| Page | Shots | Rule | Fix | Size |
|---|---|---|---|---|
| Notifications | `notify-topics`, `notify-topics-phone` | Form | Each topic is a tall card with the same fields and its own Save: a table, one row per topic (Offered, Push, Discord DM, sent in 24 h / all), one Save; cards on a phone. | M |
| Notifications | `notify-topics` | Boxes | The "Channels" fieldset is a frame inside each topic's card: an unframed label. | S |
| Notifications | `notify-topics`, `notify-topics-trouble` | Words | "From moments · `announcements`", "From pizza · `food`", "From agenda · `schedule`": "From Announcements", "From Food", "From Run of show", no key. | S |
| New topic | `notify-new-topic` | Words | "A topic of this event's own narrows one a module offers": "Make a narrower topic from an existing one, for example only the cosplay items of the run of show". | S |
| Check-in, done and again | `check-in-done-phone`, `check-in-again-phone` | Boxes | The Wi-Fi rows and "Now: Dinner" are framed boxes inside the framed result card: rows split by dividers. | S |
| Check-in, every state | `check-in-phone`, `check-in-sign-in-phone`, `check-in-done-phone`, `check-in-again-phone`, `check-in-not-open-phone`, `check-in-closed-phone`, `check-in-at-venue-phone`, `check-in-expired-phone`, `check-in-unreachable-phone`, `check-in-cancelled-phone` | Needs a 1280 px shot | — | — |
| Privacy | `privacy-phone` | Needs a 1280 px shot | — | — |

### Theming (Theme studio, hub preview)

| Page | Shots | Rule | Fix | Size |
|---|---|---|---|---|
| Theme studio, draft | `studio-draft`, `studio-screen-notice` | Boxes | "Ready to publish" is a framed notice inside the framed brand-kit card: an unframed status line with its icon, or beside Publish. | S |
| Theme studio, draft | `studio-draft`, `studio-draft-phone` | Words | The logo picker's heading is the file name "logo.svg": "Logo", the file name muted or gone. | S |
| Theme studio, preview on a screen | `studio-screen-notice` | Words | "No module offers the widget announcements; its region shows nothing.": "Nothing feeds the Announcements area on the screens, so it stays empty." | S |
| Theme studio, Advanced | `studio-draft-advanced` | Words | Token keys and CSS values as labels: `body`, `border_width`, `safe_inset`, "0.5rem", "48px", "Save tokens": human labels ("Corner roundness", "Edge margin on screens"), presets or sliders, "Save". | M |
| Theme studio, Advanced | `studio-draft-advanced` | Words | "theme.yaml, CSS, fonts, … Embeds need the embeds right" and the path "images/logo.svg": plain words ("colours, fonts, pictures and layouts"), files by name. | S |
| Theme studio, Advanced | `studio-draft-advanced` | Boxes | "Before publishing" is a card holding only the framed "Ready to publish" box; "Files" frames one line: drop the outer card, fold Files into the package section. | S |
| Theme studio, Advanced | `studio-draft-advanced` | Desktop | Fonts, sizes and motion are one long column of full-width fields at 1280 px: a two- or three-column grid like the colours, or a label and control table. | M |
| Hub preview | `hub-preview-phone` | Boxes | The one item, "Now: Dinner", sits in a framed card on an empty page: an unframed hero. | S |
| Hub preview | `hub-preview-phone` | Needs a 1280 px shot | — | — |

### Agenda (run of show)

| Page | Shots | Rule | Fix | Size |
|---|---|---|---|---|
| Delay | `agenda-delay`, `agenda-delay-phone` | Words | "One notice per audience (everyone)": "One notice to everyone who follows the schedule …". | S |
| New item, edit item | `agenda-new-item`, `agenda-edit` | Words | "Screen zone" is free text for the zone's key: a picker of zone names ("Entrance", "Main hall", "Every screen"). | S |
| Quick add | `agenda-quick-add-phone`, `agenda-quick-add-night-phone` | Needs a 1280 px shot | — | — |
| Signed in, no role | `agenda-no-role-phone` | Needs a 1280 px shot | — | — |

### Screen (Screen studio, the screens)

| Page | Shots | Rule | Fix | Size |
|---|---|---|---|---|
| Schedule | `screen-schedule`, `screen-schedule-all-zones` | Day schedule | At 1440 px Saturday and Sunday are side-by-side columns with no day picker (the phone has one): one day at a time with the day picker, the side panels kept. | M |
| Schedule | `screen-schedule`, `screen-schedule-phone`, `screen-schedule-details-phone` | Words | "prio 10", "playlist widget", "the hero shows its idle view": "Priority 10", "what each zone's screens play", "the screens show their standby view". | S |
| Zones and layouts | `screen-zones`, `screen-zones-phone` | Words | Zone keys under each name ("main · Theme's layout") and the "Key" field ("The run of show names the zone with it"): make the key from the name and hide it; other pages pick zones by name. | M |
| Zones and layouts | `screen-zones` | Desktop | Zone list, a full-width "New zone" form and "Motion" stacked in one column: the form at form width beside the list, Motion beside or below at form width. | M |
| Zone editor | `screen-zone-editor`, `screen-zone-editor-phone` | Boxes | Each widget row is framed inside the "Selected box" panel, and "Photo wall" is a fieldset frame inside that: an unframed list with dividers, "Photo wall" a subheading. | S |
| Zone editor | `screen-zone-editor` | Words | "Region: Hero" (the page says "box" elsewhere) and "snap to the 12 × 12 grid": "Box: Hero", "Boxes snap into place and never overlap". | S |
| Devices | `screen-devices-12`, `screen-devices-phone` | Words | "all on bundle dev" and "state up to date": "all up to date", "seen 10 s ago". | S |
| Pair a screen | `screen-pair-phone` | Needs a 1280 px shot | — | — |
| Content | `screen-content`, `screen-content-phone` | Words | "not in the renderer", "Plays in the zones' playlist widget", "Search assets": "isn't available on the screens", "Plays on the zones' screens", "Search files". | S |
| Ticker | `screen-ticker`, `screen-ticker-phone` | Boxes | The current line sits alone in a framed panel above the framed form: plain text or a preview strip above one panel. | S |
| Ticker | `screen-ticker` | Desktop | A textarea and button about 900 px wide at 1280 px: the form at form width, the current line beside it. | S |
| Pins | `screen-pins`, `screen-pins-phone` | Words | "player bundle and theme revision", "Bundle dev", "Theme revision 3", "Follows the platform version": "Screen software: current", "Theme: published 21 Nov 18:40". | S |
| Pins | `screen-pins` | Desktop | Three full-width panels of two or three short lines each, right half empty: "In effect" and "Pinned" side by side, Freeze below. | S |
| Archived event | `screen-studio-archived`, `screen-studio-archived-phone` | Boxes | "Archived … Read only." in the shell bar and again in a framed box below: keep the bar, or the note as plain text. | S |
| Screen, kiosk check | `theming-default-screen-check-1920x1080` | Words | "add --autoplay-policy=no-user-gesture-required", "once /screen/ has loaded", "Player version dev", "docs/screen-kiosk.md": plain results ("Sound needs one tap: see the kiosk guide"), the guide by title or QR code, flags and paths in the guide. | S |
| Screen, identify | `theming-default-screen-identify-1920x1080`, `theming-default-screen-identify-1080x1920` | Words | "Main hall · version dev": drop the version. | S |
| Screen, refused | `theming-default-screen-refused-1920x1080` | Words | "check the venue uplink", "nothing is shown while refused": "venue internet connection", "nothing plays until this screen is at the venue". | S |

### Moments (On air, priorities, history, cues, scenes, announcements, storyboards)

| Page | Shots | Rule | Fix | Size |
|---|---|---|---|---|
| On air | `moments-on-air`, `moments-on-air-phone`, `stories-on-air`, `stories-on-air-phone` | Boxes | The red Emergency box is framed inside the framed "Crew actions" box: crew actions as a plain band, the emergency frame kept. | S |
| On air | `moments-on-air` | Words | The pill "hero" over each moment and "no region of its chain is free": "Main spot" or the region's name; "Waiting for a free spot on screen; gives up after 5 min". | S |
| Priorities | `moments-priorities`, `moments-priorities-phone` | Words | "On tournament.match.called", "On pizza.order.placed, pizza.order.arrived", rule names in key case ("match called", "hot game"), "Stream (Cast track, later)", "Drag a class", "Audited.": plain triggers ("When a match is called"), display names, "Stream" or hidden until it exists, "Changes are recorded in History". | S |
| Priorities | `moments-priorities` | Boxes | Every row of "Order: higher wins" is a bordered box inside the bordered panel: a divided list with drag handles. | S |
| History | `moments-history`, `moments-history-phone` | Words | Region "hero", zone "all", "Demo CI · spotlight": "Hero", "Every zone", "Crew spotlight". | S |
| Cues | `moments-cues`, `moments-cues-phone` | Words | Each cue shows its key under the name ("announce.urgent", "strip.finals_open", "chrome.hot", …): drop the key, or a plain trigger. | S |
| Cue log | `moments-cues-log` | Words | "announce.attention" and "no_sound_screen" under each row: drop both, the name and sentence are enough. | S |
| Cue editor | `moments-cue-edit`, `moments-cue-edit-window` | Words | "tournament.start" under the title: drop it, or "When a tournament starts". | S |
| Cue editor | `moments-cue-edit` | Boxes | "From the default pack" panel around one line, and each sound row framed inside the Sound panel: a plain note, divided rows. | S |
| Scenes | `moments-scenes`, `moments-scenes-phone` | Words | "stage: wind-down", "stage: peak", the zone key "main", ISO dates "2026-11-21": stage and zone names, the event's date style ("Sat 21"). | S |
| Scenes | `moments-scenes` | Desktop | "Peak now" is a full-width button (about 725 px) at 1280 px, here and in On air's Scenes panel: natural width on a desk, full width on a phone. | S |
| Scene editor | `moments-scenes-edit` | Words | Zone keys "main", "entrance", "Layout in main", "An item of kind runs (comma-separated)" with "tournament, ceremony", "(HH:MM)", the stage value "peak", widget keys "bracket", "today numbers", and "An outside signal, such as a volume meter, is planned.": zone and widget names, a picker of item kinds, time inputs, the roadmap sentence gone. | M |
| Scene editor | `moments-scenes-edit` | Desktop | The editor opens as one long form between "The event at a glance" and the list, so the list is far below: a `wide` master–detail page, the list beside the editor. | M |
| Announcements, composer | `announce-composer`, `announce-composer-phone` | Words | "Discord channel posted by the bot from step 6" and placeholders "{item.title}, {item.starts_at}, …", "(fills {item.···})": drop "from step 6"; chips with plain names that insert the token. | S |
| Storyboards | `stories-list`, `stories-list-phone` | Words | Triggers as event names ("tournament.match.called", "until pizza.order.closed", "games.surge.started"), "item quiet_hours", "which the pizza module sends from step 5", "Replaces the built-in rule match called", "as data" in the subtitle: the builder's trigger labels ("A match is called"), kind names, "(not available yet)", the rule's display name in quotes. | S |
| Storyboard builder | `stories-builder`, `stories-builder-phone` | Words | "♪ tournament.start", "(story.starting_soon.1)" and placeholder chips "{item.starts_in}", "{now.day}", …: the sound's and cue's names, chips in plain words that insert the token. | S |
| Storyboard builder | `stories-builder` | Boxes | "The round" frames the repeated steps in a dashed box, and each step is a bordered card inside it: a side bracket with "×2" instead of the dashed frame. | S |

## Pages that pass

Run of show (`agenda`, `agenda-wide`, `agenda-earlier`, `agenda-phone`, `agenda-strip-phone`): the day schedule's model, a hero for what is on now and a table at desk width; its item panel (`agenda-item`) and empty state (`agenda-empty`). Sign-in without a role (`sign-in-no-role`), not found (`error-not-found`), People (`people-many`), Theme studio without a draft (`studio`) and its History (`studio-history`), Screen studio Live (`screen-live`), the device grid (`screen-devices-12`: a collection, cards are right), the schedule window editor (`screen-schedule-editor`), Spotlight (`moments-spotlight`), the sound library (`moments-cues-library`) and cue limits (`moments-cues-limits`), a withdrawn announcement (`announce-withdrawn`), and the screens' archived, offline, pairing, unassigned, moved, unreachable and empty-rail states.

## Seen on the way, outside the four rules

- `studio-draft-phone`: the action bar runs off a 390 px phone; "Publish" is cut to "Pu". (Theming, S.)
- `moments-cues-limits`, `moments-cue-edit`: in the full-page shot the sticky save bar covers a row of the table; probably the shot, not the page. (Moments, S to confirm.)
- `screen-studio-archived`: the read-only page's empty state still says "Add a zone, then assign screens to it in Devices". (Screen, S.)

## Filed

One `blocked` issue per module, titled `polish(<module>): views follow the 2026-11 rules`, with the module's label and its rows above:

ISSUES_PLACEHOLDER
