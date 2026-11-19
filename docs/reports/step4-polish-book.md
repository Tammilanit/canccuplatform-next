# Step 4 polish book: the changed pages and screens beside their mockups

Issue #635. The product owner read the step 4 screenshot book ([step4-screenshot-book.md](step4-screenshot-book.md), #620) and gave notes. The agreed polish has merged: the mockups (#623, PR #628), the organiser pages (#624), the screens (#625), the sound desk (#626) and the storyboard builder (#627, PR #632). This book shows every page and screen the polish changed, on the demo stack at main `9f02c35` (19 November 2026). Each shot sits next to its mockup and the old book's shot it replaces. Each has one short paragraph: what changed, which note or mockup it answers, and whether it matches the mockup. The book is for the step 4 gate on checkpoint #618.

It has three parts: [the organiser and crew pages](#the-organiser-and-crew), [the screens](#the-screens) and [the gate's three sequences](#the-gates-sequences). After them come [what was seen while shooting](#seen-while-shooting) and the lead's evaluation.

## How it was made

- **Two sources, both main `9f02c35`:**
  - **CI:** the artifact `demo-screenshots` of the Demo stack run on the push of `9f02c35` ([44514926330](https://github.com/Tammilanit/canccuplatform-next/actions/runs/44514926330), green). `scripts/demo-screenshots` took these in Chromium, with the demo event, its fixture and the CI session stub ([docs/ci.md](../ci.md#demo-stack)). Since #625 the storyboard screen shots pass the screens' readability check too. The book marks them *CI*.
  - **Local:** what CI does not shoot comes from the same commit, built locally with the same CI overlay (`deploy/compose.yml` + `deploy/compose.ci.yml`), the same fixture (`seedScreens`) and the same Playwright image. A one-off script built on the CI scripts' helpers took them (it is not committed). That covers: the gate's sequences in real time, the first fire on a fresh stack, the portrait screens, the mute and the sound check, Test-fire, a drag on Priorities, Fire by hand and the finale on 4K and portrait. The screens are real paired players on `/screen/`, each with its device cookie, so they draw what Screen places, as an installed screen would. The book marks them *local*.
- **The event's time zone, local shots only:** Midnight fires at the event's own 00:00. To shoot it on the dot without waiting for UTC midnight, the local stack's demo event was set to the time zone `Australia/Eucla` (UTC+8:45) at 14:58 UTC. That made midnight fall at 15:15:00 UTC the same day. Before that, from about 14:55 to 14:58 UTC, it was `Asia/Shanghai` (UTC+8), and the first fire (V6) was shot then. So the local shots show event time: the clock reads 22:57 to 00:47. The organiser header reads "Thu 19 – Sat 21 Nov" there, where CI's reads "Thu 19 – Fri 20 Nov": the same dates seen from that zone. Nothing else changed: the fixture's run of show keeps its UTC times, so the semis start at 16:00 UTC (00:45 event time), the item Starting soon fired on in S1.
- **Data:** the demo profile and the screens' fixture: a run of show around the time of the run (Dinner on now, the semis delayed 15 minutes), a ticker line, and two zones, Main hall (landscape) and Entrance (portrait, with the check-in QR in its hero). On top of that, per shot: crew spotlights, an urgent announcement, test-fires, Premiere set up on an added item with the demo film, and Starting soon on the fixture's semis. Every moment and run was ended, stopped or withdrawn afterwards, and every added item and file was removed (the agenda kind Premiere stays on the throwaway stack).
- **Sizes:**
  - Pages are shown 1:1 as PNG: desktop 1280 px wide and phone 390 px wide, as tall as the page. A few local ones show only the window (1280×800), the top of the page, where the change is.
  - Screens were shot at 1920×1080, 3840×2160 and 1080×1920. Here they are JPEG, 720 px on the short side, with one 1:1 crop of a 4K screen. Sequences are numbered strips.
  - Each sequence frame's label is the instant the shot was asked for, in event time. A capture takes 1.1 to 1.8 s, and when two screens are shot at once in one browser, their captures can be up to about a second apart.
- **Time:** CI took its shots 11:30–11:37 UTC. The local shots were taken 14:57–16:05 UTC: Midnight at 15:14:45–15:15:21, and Starting soon's rounds at 15:45, 15:55 and 15:59 UTC, with its finale at 16:00.
- **Mockups:** "polish NN" is sheet NN of [docs/briefs/step-4-polish/](../briefs/step-4-polish/README.md) (#623). "Mockup NN" is the step 4 brief's mockup in [docs/briefs/step-4-moments/](../briefs/step-4-moments/). "Before" is the old book's shot (O, C, A, R, S numbers).

## Contents

| Part | What | Images | Replaces |
|---|---|---|---|
| Organiser and crew, 1280 px and phone | Priorities and the built-in rules; the sound desk (Cues, a cue, Library, Limits and categories, Log, the mute, the sound check); Storyboards and the builder; History; Fire; the spotlight remote | [P1–P17](#the-organiser-and-crew) | O2, O5, O9–O12, O19–O23, O24, O27–O30, C2, C8 |
| Screens, 1080p, 4K and portrait | The crew spotlight with a photo; message, title and finale at hero size; the stings; every preset; Urgent; the first fire; fired by hand | [V1–V7](#the-screens) | R2, R6, R17, R19–R22, A1, A3, A5 |
| The gate | Starting soon at T−15, T−5, T−1 and its finale; Midnight at 00:00:00 on both zones; Premiere on two screens | [S1–S3](#the-gates-sequences) | S1–S3 |

## The organiser and crew

Every page is in the organiser shell, under Studio → Moments (sheet 2 of [the design guideline](../design/mockups.html)). Most are shown at 1280 px and on a 390 px phone; CI shoots the builder's loop, Premiere and Test-fire at 1280 px only.

### P1 · Priorities: drag and drop, no rank numbers

| Now, 1280 px (*CI*) | Now, dragging (*local*) | Now, phone (*CI*) | Mockup 08 | Before (O5) |
|---|---|---|---|---|
| ![Priorities](step4-polish-book/p01-priorities.png) | ![Priorities while a row is dragged](step4-polish-book/p01-priorities-dragging.png) | ![Priorities, phone](step4-polish-book/p01-priorities-phone.png) | ![Mockup 08](../briefs/step-4-moments/08-priorities.svg) | ![O5](step4-screenshot-book/o05-priorities-and-rules.png) |

The order is a list of classes with a drag handle each. The rank numbers and arrows are gone, as the PO asked ("drag and drop, not arrows; the rank numbers mean nothing"). The line above says "Drag a class by its handle, or focus it and use the arrow keys", and Emergency stays locked at the top. In the local shot, Crew spotlight is held mid-drag and has already moved above Announcement. Rows reorder live under the pointer; Save order then keeps the order (the shot does not save). The preview of what main would show sits beside the list (here it plays the test round of P14). On a phone the list, the preview and the rules stack in one column. This matches mockup 08's drag and drop, without its numbers.

### P2 · The built-in rules: chips and sliders

| Now, 1280 px, the rules (*CI*, 1:1 crop of P1) | Before (O5) |
|---|---|
| ![The built-in rules](step4-polish-book/p02-rules.png) | ![O5](step4-screenshot-book/o05-priorities-and-rules.png) |

Each rule is a row: on or off, its name and event in one column, then As, Shows for (a slider with minutes), Cue, Regions as chips and Zones as chips, and Save. Event names wrap only at a dot ("tournament.leaderboard. changed"), no longer mid-word (O5). The phone form is in P1. This matches mockup 08 and #624's ask, "chips and sliders in the built-in rules".

### P3 · The sound desk: Cues

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup: polish 01 and 04 | Before (O9, O30) |
|---|---|---|---|
| ![Cues](step4-polish-book/p03-cues.png) | ![Cues, phone](step4-polish-book/p03-cues-phone.png) | ![Polish 01](../briefs/step-4-polish/01-sound-desk-cues.svg) ![Polish 04](../briefs/step-4-polish/04-sound-desk-phone.svg) | ![O9](step4-screenshot-book/o09-cues.png) ![O30](step4-screenshot-book/o30-cues-phone.png) |

The single 7,000 px page (O9) is now four sub-pages, Cues, Library, Limits and categories and Log, under one master strip. The strip holds Sound, the master volume slider, Mute all 15 min, Sound check, and each zone's use of the hour. Each cue reads by its plain name ("Urgent announcement"), with its id and sounds as the grey second line, grouped under its category with the level and calm rule. Chips filter and search finds a cue. The page is 1280 px wide, and on a phone 390 px, so it fits; O9 was 1291 px and O30 883 px. This answers the PO's "one huge page, not user-friendly" and matches polish 01 and 04. One difference: the list shows all 33 cues, where polish 01 folds them after ten ("Show all 25").

### P4 · A cue's editor

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup: polish 02 | Before (O10) |
|---|---|---|---|
| ![The cue Tournament starts](step4-polish-book/p04-cue-editor.png) | ![The cue editor, phone](step4-polish-book/p04-cue-editor-phone.png) | ![Polish 02](../briefs/step-4-polish/02-sound-desk-cue-editor.svg) | ![O10](step4-screenshot-book/o10-cue-editor.png) |

"Tournament starts" in two cards. Sound has the category as chips with what it means, the chosen sounds as themed players (play, waveform, length, remove), the rest of the library as add-chips, a voice line, then Level, Not again for (a slider with named stops), Catch-up (a stepper) and Once per source. Picture has the effect chips, Holds for (a slider) and a small preview. Try it plays the cue here or on a zone. "From the default pack" says what differs from the pack (here: "Same as the default pack."). This answers the PO's "does not look professional" and "sliders suit levels and times better", and matches polish 02. In the full-page capture the pending row (No changes yet · Cancel · Save) is drawn halfway down, over the Voice line heading. The capture does that, not the page (see [Seen while shooting](#seen-while-shooting)).

### P5 · Library

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup: polish 03 and 04 | Before (O9, its library) |
|---|---|---|---|
| ![Library](step4-polish-book/p05-library.png) | ![Library, phone](step4-polish-book/p05-library-phone.png) | ![Polish 03](../briefs/step-4-polish/03-sound-desk-library-limits-log.svg) | ![O9](step4-screenshot-book/o09-cues.png) |

Upload a sound is one button with a drop area and its rules in words. The 12 sounds are cards with a themed player, length, licence and the cues that use them by name. The browser's own light-grey players of O9 are gone. This matches polish 03.

### P6 · Limits and categories

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup: polish 03 | Before (O9, its budget and categories) |
|---|---|---|---|
| ![Limits and categories](step4-polish-book/p06-limits.png) | ![Limits and categories, phone](step4-polish-book/p06-limits-phone.png) | ![Polish 03](../briefs/step-4-polish/03-sound-desk-library-limits-log.svg) | ![O9](step4-screenshot-book/o09-cues.png) |

Budget per zone has Sounds an hour and Sounds a minute as sliders and the per-source gap as a stepper. The zone table says what passes now and that no zone has a sound screen ("None · Set one in Devices"). Categories are rows of a level slider and two switches (Interrupts or Waits, Plays or Silent at calm). Every number box of O9 is now a slider or a stepper, as polish 03 draws it. The pending row sits halfway down here too, an artefact of the capture.

### P7 · Log

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup: polish 03 | Before (O9, its log) |
|---|---|---|---|
| ![Log](step4-polish-book/p07-log.png) | ![Log, phone](step4-polish-book/p07-log-phone.png) | ![Polish 03](../briefs/step-4-polish/03-sound-desk-library-limits-log.svg) | ![O9](step4-screenshot-book/o09-cues.png) |

Each row says what happened in words ("Held back · The zone has no sound screen"), with the reason code grey below. The log filters by outcome (All, Played, Waited, Held back, Missed) and zone. This matches polish 03; its outcome chips name Muted where the build has Waited and Missed.

### P8 · The mute

| Now, 1280 px (*local*, top of the page) | Now, phone (*local*) | Mockup: polish 01, the strip muted | Before (O11, C8) |
|---|---|---|---|
| ![Cues, muted](step4-polish-book/p08-cues-muted.png) | ![Cues, muted, phone](step4-polish-book/p08-cues-muted-phone.png) | ![Polish 01](../briefs/step-4-polish/01-sound-desk-cues.svg) | ![O11](step4-screenshot-book/o11-cues-muted.png) ![C8](step4-screenshot-book/c08-cues-muted-phone.png) |

Mute all 15 min pressed: the page says "Muted.", and the master strip turns amber, says "Muted · back at 23:59 (14:59 left)" and offers Unmute now. This is exactly polish 01's muted strip. O11's card ran off the page's right edge; this one fits.

### P9 · The sound check

| Now, the zone menu (*local*) | Now, sent (*local*) | Mockup: polish 01, after a sound check | Before (O12) |
|---|---|---|---|
| ![Sound check menu open](step4-polish-book/p09-sound-check-menu.png) | ![Sound check sent](step4-polish-book/p09-sound-check.png) | ![Polish 01](../briefs/step-4-polish/01-sound-desk-cues.svg) | ![O12](step4-screenshot-book/o12-cues-sound-check.png) |

Sound check opens a menu (Every zone or one zone). After Every zone the strip reports in words: "Sound check sent to every zone at 23:45:12 · entrance has no sound screen, so nothing was heard there · main has no sound screen, so nothing was heard there". O12 said only "Sound check sent." This matches polish 01.

### P10 · Storyboards: the catalogue

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup 21 | Before (O19, O28) |
|---|---|---|---|
| ![Storyboards](step4-polish-book/p10-storyboards.png) | ![Storyboards, phone](step4-polish-book/p10-storyboards-phone.png) | ![Mockup 21](../briefs/step-4-moments/21-storyboard-preset-picker.svg) | ![O19](step4-screenshot-book/o19-storyboards-catalogue.png) ![O28](step4-screenshot-book/o28-storyboards-catalogue-phone.png) |

The catalogue fits: 1280 px wide, with the Fire panel in the right column, where O19 was 1657 px. On a phone it is 390 px wide and the panel follows the list, where O28 was 601 px and shrunk. Each row keeps its trigger, rounds, sound and status in words, with Turn on/off, Duplicate and Reset to default. This matches mockup 21 and #624's "Storyboards fits at 1280 px and on a phone".

### P11 · The builder: Starting soon

| Now, 1280 px (*CI*) | Now, phone: Overview, Round, Preview (*CI*) | Mockup: polish 05 and 06 | Before (O20, O29) |
|---|---|---|---|
| ![The builder of Starting soon](step4-polish-book/p11-builder.png) | ![Overview tab](step4-polish-book/p11-builder-phone.png) ![Round tab](step4-polish-book/p11-builder-phone-round.png) ![Preview tab](step4-polish-book/p11-builder-phone-preview.png) | ![Polish 05](../briefs/step-4-polish/05-builder.svg) ![Polish 06](../briefs/step-4-polish/06-builder-phone.svg) | ![O20](step4-screenshot-book/o20-builder-starting-soon.png) ![O29](step4-screenshot-book/o29-builder-phone.png) |

Mockup 18 in the dark shell, as polish 05 redraws it. Test-fire and Save are in the header. Plays when and Only if are chip rows with their labels in one column. The rounds are blocks on a time axis (−15, −5, −1, T, with the finale), with At set times or Every few minutes, Until and Sound on one line. The round is a strip of steps, each a small picture of itself, with the ×2 repeat as a bracket. The selected step's form opens beside it on a two-column grid, with Seconds as a slider. The live preview has a scrub bar coloured by step, and Before you save shows airtime and sounds as bars and each check as a sentence. On a phone it is three tabs (Overview, Round, Preview). The checks are one line on top ("2 checks pass · none to look at"), and Test-fire and Save sit in the pending row (polish 06). This answers the PO's "oddly aligned, with one long edit box" and matches polish 05 and 06. The build adds a Name row on top, which the sheet does not draw.

### P12 · The builder: a loop

| Now, 1280 px (*CI*) | Mockup: polish 05 | Before (O21) |
|---|---|---|
| ![The builder of Doors open](step4-polish-book/p12-builder-loop.png) | ![Polish 05](../briefs/step-4-polish/05-builder.svg) | ![O21](step4-screenshot-book/o21-builder-doors-open-loop.png) |

Doors open, a loop: Every few minutes is chosen, and the axis shows rounds at T, +10 and +20, with "Every 10 min · From T · Ends: 3 rounds". The strip has its four steps: sting, the "Welcome to Demo Event" title, the venue-info title and the QR. The title step's form shows "Fills with: Welcome to Demo Event". This matches polish 05 (marker 3: one switch for set times or a loop).

### P13 · The builder: Premiere

| Now, 1280 px (*CI*) | Mockup: polish 05, and mockup 22 | Before (O22) |
|---|---|---|
| ![The builder of Premiere](step4-polish-book/p13-builder-premiere.png) | ![Polish 05](../briefs/step-4-polish/05-builder.svg) ![Mockup 22](../briefs/step-4-moments/22-storyboard-premiere.svg) | ![O22](step4-screenshot-book/o22-builder-premiere.png) |

Premiere, set up for the demo film. It plays when a premiere item starts, by hand, or once at a set time. Its round is one block on the axis: a 30 s countdown, the 12 s video and the after-card "Thanks for watching · Again at 21:00 on Stage", in the same strip-and-form layout. This matches polish 05 and mockup 22's round. The countdown's thumbnail in the strip reads "05:00" for a 30 s step (see [Seen while shooting](#seen-while-shooting)).

### P14 · The builder after Test-fire

| Now, 1280 px (*local*, top of the page) | Mockup: polish 05, marker 1 | Before (O23) |
|---|---|---|
| ![Match called after Test-fire](step4-polish-book/p14-builder-test-fired.png) | ![Polish 05](../briefs/step-4-polish/05-builder.svg) | ![O23](step4-screenshot-book/o23-builder-test-fired.png) |

Match called after Test-fire on main: a green notice says "One test round on main." under the header, which keeps Test-fire on main and Save. Polish 05 puts that line in the header itself ("One test round on Main hall · marked as a test in History"). Here it is a notice, it names the zone by its key ("main") rather than its name (Main hall), and it does not mention History. Close to the sheet, not the same.

### P15 · History

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Mockup 09 | Before (O27) |
|---|---|---|---|
| ![History](step4-polish-book/p15-history.png) | ![History, phone](step4-polish-book/p15-history-phone.png) | ![Mockup 09](../briefs/step-4-moments/09-history.svg) | ![O27](step4-screenshot-book/o27-history-phone.png) |

On a phone each row is now a card (Time, Zone, Moment and its outcome, Region, Why, Displaced, Ended or outcome), so nothing runs off the screen. In O27 the table kept its columns and ran off the right edge. The filters stack in pairs above. This answers the PO's "History does not fit the width". Mockup 09 draws only the desk, so the phone cards are the build's own; the desk keeps its table.

### P16 · Fire, defaulting to the next item

| Now, 1280 px (*CI*) | Now, phone (*CI*) | Fired by hand (*local*) | Mockup 03 and 04 | Before (O2) |
|---|---|---|---|---|
| ![On air](step4-polish-book/p16-on-air.png) | ![On air, phone](step4-polish-book/p16-on-air-phone.png) | ![On air after Fire Starting soon](step4-polish-book/p16-fired.png) | ![Mockup 03](../briefs/step-4-moments/03-on-air.svg) ![Mockup 04](../briefs/step-4-moments/04-crew-remote.svg) | ![O2](step4-screenshot-book/o02-on-air-fired.png) |

The Storyboards card's item list now starts at the next item a story can take, not at the first item of the day. In CI at 11:30 UTC it picks "Demo Game Cup, semis", the next tournament item. Locally, with the semis started, it picks "Demo Game Cup, grand final" (17:45 UTC). In O2 the list started at Doors open, already past. Fire Starting soon on it (local): the page says "Fired." and the card reads "Starting soon · between rounds", with Stop loop and Skip to finale. The rounds count from the item's time, so nothing plays until the grand final's T−15 (V7). This answers #624's "Fire defaults to the next fitting item" (mockups 03 and 04 draw an item picker but no default). Two things fall short: the list writes the time in UTC ("17:45") where the event's clock reads 02:30, and on a phone the list touches the first Fire button (see [Seen while shooting](#seen-while-shooting)).

### P17 · The spotlight remote's photo picker

| Now, phone (*CI*) | Now, 1280 px (*CI*) | Mockup 04 | Before (C2) |
|---|---|---|---|
| ![The spotlight remote, phone](step4-polish-book/p17-spotlight-phone.png) | ![The spotlight form](step4-polish-book/p17-spotlight.png) | ![Mockup 04](../briefs/step-4-moments/04-crew-remote.svg) | ![C2](step4-screenshot-book/c02-spotlight-remote-phone.png) |

The crew spotlight form now has a Photo field showing the event's images as thumbnails to tap. Here it shows the one uploaded for the shot, "poster-final.png". C2 asked for a raw path ("/screen/files/…"). The QR is a tick box, "Show the QR to the phone hub", where C2 asked for a path. This answers the lead's note on C2 and mockup 04's photo pick. Unlike mockup 04, the form shows Message, More, Bracket of and Photo together, whatever What it shows says (see [Seen while shooting](#seen-while-shooting)).

## The screens

The main hall at 1920×1080 and 3840×2160, and the entrance in portrait at 1080×1920. The CI shots are the organiser's live view of the zone (`/screen/zones/main`, with its "Demo" badge); the local ones are paired players.

### V1 · The crew spotlight uses the screen (R2)

| Now, 1080p with a photo (*CI*) | Now, 4K with a photo (*CI*) | Mockup: polish 07, 08 (1) and 10 | Before (R2) |
|---|---|---|---|
| ![Photo spotlight, 1080p](step4-polish-book/v01-photo-1080p.jpg) | ![Photo spotlight, 4K](step4-polish-book/v01-photo-4k.jpg) | ![Polish 08](../briefs/step-4-polish/08-hero-templates-1080p.svg) ![Polish 10](../briefs/step-4-polish/10-hero-4k-portrait.svg) | ![R2](step4-screenshot-book/r02-spotlight-4k.jpg) |

| Now, portrait with a photo (*local*) | Now, portrait, a message (*local*) | Before (A1) |
|---|---|---|
| ![Photo spotlight, portrait](step4-polish-book/v01-photo-portrait.jpg) | ![Message spotlight, portrait](step4-polish-book/v01-message-portrait.jpg) | ![A1](step4-screenshot-book/a01-spotlight-portrait.jpg) |

A photo picked in the remote (P17) fills the hero, cropped from the centre, with a scrim. "From the crew · Pizza is here" sits centred at its foot, large, and doubles at 4K. Without a photo, the message is large and centred in the hero. R2 put small text in the lower corner of an empty 4K hero. This answers the PO's note on R2 ("the screens do not use their space") and matches polish 08 (1, 2) and 10. The demo poster is a striped test image, so the scrim shows on its lower half.

### V2 · Message, title and finale at hero size

| Doors open, 1080p (*CI*) | Doors open, 4K (*CI*) | Mockup: polish 08 (4–6) and 10 | Before (R17, R18, R19) |
|---|---|---|---|
| ![Doors open's steps, 1080p](step4-polish-book/v02-doors-open-1080p.jpg) | ![Doors open's steps, 4K](step4-polish-book/v02-doors-open-4k.jpg) | ![Polish 08](../briefs/step-4-polish/08-hero-templates-1080p.svg) | ![R17](step4-screenshot-book/r17-round-transitions.jpg) ![R19](step4-screenshot-book/r19-title-card-4k.jpg) |

| 4K, 1:1 crop of the message (*CI*) | Starting soon: sting, countdown, finale, 1080p and 4K (*CI*) | Before (R22, S1) |
|---|---|---|
| ![The 4K message at full size](step4-polish-book/v02-doors-open-4k-crop.jpg) | ![Starting soon's steps](step4-polish-book/v02-starting-soon.jpg) | ![R22](step4-screenshot-book/r22-fired-by-hand.jpg) |

| The finale, portrait (*local*) | The finale, 4K (*local*) | Before (A5) |
|---|---|---|
| ![It's on!, portrait](step4-polish-book/v02-finale-portrait.jpg) | ![It's on!, 4K](step4-polish-book/v02-finale-4k.jpg) | ![A5](step4-screenshot-book/a05-storyboard-card-portrait.jpg) |

Every storyboard step is now one block, centred in the hero and large: "Welcome to Demo Event · Find your seat, say hi, have fun", "Wi-Fi and venue info", the QR beside "Check in at the door", and Starting soon's countdown. The 4K crop shows the type sharp at double size. The finale "It's on! · Demo Cup, final · Stage" is on the bright accent gradient, like the sting, where R22 and S1 frame 8 had a small line in the corner. It does the same at 4K and on the portrait entrance (local: Starting soon fired by hand on an item started a minute before, which goes straight to the finale on every zone). This matches polish 08's scale and centring. The build leaves out polish 08's kickers ("DOORS ARE OPEN", "CHECK-IN", "STARTING SOON") and the QR step's "Scan with your phone" (see [Seen while shooting](#seen-while-shooting)). In the CI finale frame (Starting soon, 1080p, 3) the rail is caught mid-crossfade.

### V3 · The stings

| Now (*CI*; frame 6 *local*) | Mockup: polish 07, 08 (8) and 09 (2) | Before (R17, S1) |
|---|---|---|
| ![Stings at 1080p, 4K and portrait](step4-polish-book/v03-stings.jpg) | ![Polish 08](../briefs/step-4-polish/08-hero-templates-1080p.svg) ![Polish 09](../briefs/step-4-polish/09-hero-midnight.svg) | ![R17](step4-screenshot-book/r17-round-transitions.jpg) ![S1](step4-screenshot-book/s01-starting-soon.jpg) |

Stings are bright on the theme's gradient (primary to accent) with dark ink, filling the hero, with a light sweep: "Starting soon" and "Doors are open" at 1080p, 4K and portrait. Midnight's "Midnight!" fills the whole screen, with rings and a few dots. Before they were dark grey on dark blue in a corner. They now pass the screens' readability check in CI. This matches polish 07 and 08 (8). Midnight's sting has no "Night 2 at Demo Event" subline and fewer, smaller confetti than polish 09 (2).

### V4 · Every preset (R21)

| Now (*CI*) | Mockup: polish 08 | Before (R21) |
|---|---|---|
| ![Every preset's message step](step4-polish-book/v04-every-preset.jpg) | ![Polish 08](../briefs/step-4-polish/08-hero-templates-1080p.svg) | ![R21](step4-screenshot-book/r21-every-preset.jpg) |

Each of the 23 presets, test-fired as one round on the main hall and shot at its message step, then Premiere's three steps. Every message now fills the hero, centred and large, from "Welcome to Demo Event" to "The tournament: round starts now". QR steps draw their code (arrival check-in, good morning, pizza order open, venue info, pizza last call). The shots CI caught wrong in R21 are right now: Midnight shows its card ("Night 2 at Demo Event", 5), and Starting soon shows its countdown (2), not the sting. Match called with no data still reads "Match called:" over an empty hero (3), a later item in the old book's plan. Test-fired, Starting soon counts down "14:56" while the rail says the semis start in 58 minutes (see [Seen while shooting](#seen-while-shooting)).

### V5 · Urgent

| Now, 1080p (*CI*) | Now, 4K (*CI*) | Now, portrait (*local*) | Mockup 06 | Before (R6, A3) |
|---|---|---|---|---|
| ![Urgent, 1080p](step4-polish-book/v05-urgent-1080p.jpg) | ![Urgent, 4K](step4-polish-book/v05-urgent-4k.jpg) | ![Urgent, portrait](step4-polish-book/v05-urgent-portrait.jpg) | ![Mockup 06](../briefs/step-4-moments/06-announce-on-screen.svg) | ![R6](step4-screenshot-book/r06-announcement-urgent.jpg) ![A3](step4-screenshot-book/a03-urgent-portrait.jpg) |

"Semis in 15 min · Players to the stage now", urgent: the card's label now reads URGENT in the warning colour (amber), with an amber frame inside a glowing edge. R6 and A3 read ANNOUNCEMENT in the secondary purple. The ticker's label also reads URGENT, but on the purple ground (portrait). This matches mockup 06 on the card, but not on the ticker label (see [Seen while shooting](#seen-while-shooting)).

### V6 · The QR step and `{event.name}` on the first fire

| Main hall, 1080p (*local*) | Entrance, portrait (*local*) | Mockup: polish 08 (4, 6) and 10 | Before (R19, R20, A5) |
|---|---|---|---|
| ![Doors open's first fire on main](step4-polish-book/v06-first-fire.jpg) | ![The same fire on the entrance](step4-polish-book/v06-first-fire-portrait.jpg) | ![Polish 10](../briefs/step-4-polish/10-hero-4k-portrait.svg) | ![R20](step4-screenshot-book/r20-qr-step-blank.jpg) ![A5](step4-screenshot-book/a05-storyboard-card-portrait.jpg) |

The first storyboard fired on a freshly started stack (Moments restarted just before), Doors open, test-fired on main and on the entrance at 14:57:08 UTC (22:57 event time, then UTC+8). The message reads "Welcome to Demo Event" on both screens, and the QR step shows its code (each frame shot about 1 s after the step was drawn). The first test-fire of the old book read "Welcome to" (A5, R19) and drew a white square (R20). This matches polish 10 (portrait: "the first fire never reads 'Welcome to' on its own"), apart from the kicker.

### V7 · Fired by hand (R22)

| Main hall after Fire (*local*) | Before (R22) |
|---|---|
| ![The main hall after Fire Starting soon](step4-polish-book/v07-after-fire.jpg) | ![R22](step4-screenshot-book/r22-fired-by-hand.jpg) |

The main hall 80 s after P16's Fire: the Pulse, with the grand final in the hero ("Starts in 01:42:24"). Nothing jumps to a finale. In R22 Fire defaulted to an item already past, and "It's on!" went up when nothing was starting. Now the run waits for its rounds at the item's T−15, T−5 and T−1, as S1 shows. The crew sees "between rounds" on On air but nothing on screen (see [Seen while shooting](#seen-while-shooting)). The run was stopped afterwards.

## The gate's sequences

Each sequence is a strip of numbered frames, labelled with the instant each was asked for, in event time.

### S1 · Starting soon: T−15, T−5, T−1 and its finale

| Main hall, 1080p (*local*, real time) |
|---|
| ![Starting soon at T−15, T−5, T−1 and T](step4-polish-book/s01-starting-soon.jpg) |

| Mockup: polish 08 (7–9) and mockup 19 | Before (S1) |
|---|---|
| ![Polish 08](../briefs/step-4-polish/08-hero-templates-1080p.svg) ![Mockup 19](../briefs/step-4-moments/19-storyboard-loop-timeline.svg) | ![S1](step4-screenshot-book/s01-starting-soon.jpg) |

Nothing fired by hand and no item added. Starting soon fired by itself on the fixture's own tournament item, "Demo Game Cup, semis", which starts at 00:45:00 event time (16:00 UTC, 15 minutes late). The run started at T−15 exactly (15:45:00.98 UTC by its record).
- **T−15:** the Pulse 15 minutes before (1), then the round's countdown "Demo Game Cup, semis · Starts in · 14:27 · Stage · in 15 minutes", large and centred in the hero (2). The watcher missed the round's opening sting: a bug in the one-off script, not the screen.
- **T−5:** the sting "Starting soon", bright on the accent gradient and filling the hero (3); the countdown "04:56" (4); the sting again, since the round repeats steps 1–2 twice (5). Then the Pulse comes back between rounds (6).
- **T−1:** sting (7), then the countdown "00:22" (8). The round is over 13 s before T, and the Pulse counts the last seconds ("Starts in 00:00:13", 9).
- **T:** at 00:45:01 the finale "It's on! · Demo Game Cup, semis · Stage" fills the hero on the accent gradient (10). Nine seconds later the Pulse is back with the next tournament item (11).

Each round plays on time and counts to the item, not to its own offset. The screen's clock in the top right reads the same minute as each label. This answers the lead's two notes on S1: the sting is now the loudest thing on the screen, not dim and small, and the finale is no longer "the quietest moment". It matches polish 08 (7–9) in scale and colour, without the sheet's "STARTING SOON" kicker over the countdown.

### S2 · Midnight at 00:00:00 on every zone

| Main hall, 1080p (*local*, real time) |
|---|
| ![Midnight on the main hall](step4-polish-book/s02-midnight-main.jpg) |

| Entrance, portrait (*local*, real time) | Mockup: polish 09 | Before (S2) |
|---|---|---|
| ![Midnight at the entrance](step4-polish-book/s02-midnight-entrance.jpg) | ![Polish 09](../briefs/step-4-polish/09-hero-midnight.svg) | ![S2](step4-screenshot-book/s02-midnight.jpg) ![S2 at the entrance](step4-screenshot-book/s02-midnight-p00000-portrait.jpg) |

Nothing fired by hand. Two paired players, the main hall at 1080p and the entrance in portrait, were each shot at the same instants, from 15 s before the event's midnight to 13 s after. At 23:59:45 and 23:59:50 both show the Pulse (1–2). By 23:59:55 both show the full-screen countdown "Midnight · Starts in · 00:05", and at 23:59:59.4 "00:01" (3–4). At 00:00:00.8 both show the sting "Midnight!" full screen on the theme's gradient (5). At 00:00:08 and 00:00:13 both show the card "Night 1 at Demo Event · Keep it going" (7–8). At 00:00:03.9 the main hall was still on the sting while the entrance was in the 0.6 s gap before the card (6). The two captures run one after the other in one browser, so this may be the capture's own spread, not the zones'. Sting and card never overlap. So the entrance is now on the dot with the main hall, where in S2 it showed only its background at 00:00:00. This matches polish 09's timing and its no-overlap rule. The build leaves out the sheet's kicker lines ("MIDNIGHT IN", "Night 2 … starts at 00:00", "MIDNIGHT") and most of its confetti. During the countdown a purple glow runs round the edge of both screens (3–4), which polish 09 does not draw.

### S3 · Premiere on two screens at once

| Two main-hall screens (*local*) | Mockup 22 | Before (S3) |
|---|---|---|
| ![Premiere on two main-hall screens](step4-polish-book/s03-premiere.jpg) | ![Mockup 22](../briefs/step-4-moments/22-storyboard-premiere.svg) | ![S3](step4-screenshot-book/s03-premiere-two-screens.jpg) |

Two players paired into the main hall, side by side, with Premiere test-fired on an added premiere item with the demo film. Each row is one moment on both screens. The countdown "Demo Event: the film · Starts in · 00:29 · Lights down, sound up" fills the hero (1–4). Its words now match the counter, where S3 said "Starts 02:00" over a 30 s count. The film then plays full bleed, edge to edge with no frame and no bars, at three moments (5–10). Last comes the after-card "Thanks for watching · Again at 21:00 on Stage", large and centred (11–12). The film's own position, read from both players together: 1.867 s and 1.818 s, 6.262 s and 6.212 s, 10.695 s and 10.645 s. The two screens stay 49–50 ms apart and do not drift, and the film's second counter shows the same second on both. This matches mockup 22 and the lead's two fixes for S3 (full bleed, matching countdown text).

## Not in this book

- **Pages and screens the polish did not change:** Scenes, the announcement composer, the emergency, the split zone and the rest of the old book stand as they were shot there.
- **Sound.** Screenshots have none, and no demo screen is a sound screen, so the log and the sound check say so.
- **Peak on a live screen:** the lead's plan checks it on a live screen, not in stills.

## Seen while shooting

Not fixed here (out of scope); for the lead to sort.

**Screens**
- **Storyboard steps have no kicker.** Polish 08 and 09 put a small kicker over each step ("DOORS ARE OPEN", "CHECK-IN", "STARTING SOON", "MIDNIGHT IN", "MIDNIGHT") and a line under some ("Scan with your phone", "Night 2 at Demo Event starts at 00:00"). The build draws the headline and body only (V2, V4, V6, S2). The Midnight sting also has no subline and only a few dots for confetti (V3).
- **A test-fired countdown counts from its round's offset.** Starting soon test-fired at 11:31 counts down "14:56", while the rail says the semis start in 58 minutes (V4, 2); the builder's preview shows "05:00" (P11). A test round seems to count its own −15 rather than the time to the item. The step thumbnails in the builder's strip read "05:00" whatever the step's length (P11, P13: a 30 s countdown).
- **The urgent ticker label is purple.** The card's URGENT is amber (the warning colour), but the ticker's URGENT label sits on the purple secondary ground (V5, portrait). Mockup 06 uses the warning colour for both.
- **A purple glow runs round the screen's edge** during Midnight's countdown, on both zones (S2, 3–4); polish 09 draws none.
- **The rail lists the semis as "Delayed · 00:45" after they started** (S1 frames 10–11, V7, two minutes after T), not as Now. A step 3 Pulse matter, seen here.
- **Match called with no data** still reads "Match called:" over an empty hero (V4, 3). It is on the old book's "later" list.

**Pages**
- **On air still shows rank numbers** ("rank 70") on every moment (P16), after the PO dropped them on Priorities as meaningless.
- **On air's item list writes item times in UTC:** "Demo Game Cup, grand final · 17:45" while the event's clock reads 00:46 and the screens put the item at 02:30 (P16, local, with the event in UTC+8:45; CI runs in UTC, so it does not show there). The list is also clipped at 1280 px ("Demo Game Cup, semis · 12:3"), and on a phone it touches the first Fire button with no gap.
- **Fire by hand on a later item shows nothing for now.** Fired on the grand final, 1 h 44 min away, Starting soon waits for its T−15 round; On air says "between rounds" and the screens stay on the Pulse (P16, V7). That is the rule (a take with an item counts from the item's time), but a crew member who pressed Fire sees nothing happen. Skip to finale is the only way to put something up now.
- **The spotlight form shows every field at once:** Message, More, Bracket of and Photo, whatever What it shows says (P17). Mockup 04 shows only the fields of the chosen kind. At 1280 px every field spans the whole 944 px column, the one long edit box the PO disliked in the builder.
- **CI's full-page shots draw the pending row in the middle** of the cue editor and of Limits and categories (P4, P6), over the Voice line heading. The row sticks to the window's foot, and a full-page capture leaves it where the window ended. The phone shots grow the window to the page's height first, so their row sits at the foot; the desktop ones do not.
- **After Test-fire the builder says "One test round on main."** as a notice under the header. Polish 05 puts it in the header and adds "marked as a test in History" (P14).

## Lead's evaluation

**Verdict.** The polish did its job, and in my view step 4 is ready for `checkpoint-ok`.
- All seven gate-blocking items from the first book are closed; Urgent and Midnight are closed in the main, with small gaps.
- Every product owner note is answered on the page it was about.
- The screens now look like one product: storyboard steps, stings and the finale are large and centred in the hero, and they sit well next to the crew spotlight and the Pulse.
- The sound desk and the builder are new pages, close to their sheets.

What is left is smaller polish, listed at the end. One cheap, quick package would remove the things you are most likely to notice. None of it needs to hold the gate.

### The organiser and crew: good, with a few rough edges
- **Good:**
  - Priorities is drag and drop, with no rank numbers and no arrows (P1). The built-in rules use chips and sliders, and event names no longer wrap mid-word (P2).
  - The sound desk is four sub-pages under one master strip, instead of one 7,000 px page (P3–P7). Every level and limit is a slider, or a stepper for times (P4, P6).
  - The cue editor now looks like a product: chips, themed players, sliders with named stops, and "Heard at 64 %" in words (P4).
  - The mute and the sound check report in words (P8, P9).
  - The builder matches polish 05 and 06 (P11–P13): the round as a strip of steps, a two-column form, a scrub preview, and the "Before you save" checks. On a phone it is three tabs.
  - Every phone shot is 390 px wide. Nothing runs off the screen any more, History included (P15).
- **Falls short:**
  - **On air still shows rank numbers** ("rank 70") on every moment (P16). You called them meaningless on Priorities, and they are still here.
  - **Zones are shown by their key, not their name**: "main" and "entrance" on the sound desk, the rules, Test-fire, History, On air and the spotlight form (P2–P9, P14–P17). The screens themselves say "Main hall" and "Entrance".
  - **Raw ids still show in places:**
    - Match called's triggers read "tournament.match.called" and "tournament.match.started" (P14), where Starting soon reads "A tournament or ceremony item starts" (P11).
    - Cue pickers show ids ("tournament.pre", "+ New cue (story.starting_soon.1)").
    - The catalogue shows notes like "idle: pizza.order.closing: provisional, not sent yet" (P10).
    - Placeholders are code tokens (`{item.title}`), not the chips I asked for on #628.
  - **The builder's text boxes are narrow** and cut off the template ("Welcome to {event.n", "Find your seat, sa"; P12, P13). The "Fills with:" line below helps.
  - **Fire by hand on a later item shows nothing.** On air says "between rounds" and the screens stay on the Pulse (P16, V7). The item list writes its time in UTC and is clipped ("12:3"), and the list touches the first Fire button.
  - **The spotlight form** shows every field at once, each the full width of the page, with a plain browser checkbox (P17). It works, and the photo picker replaced the raw path, but it is the plainest page in the set.
  - The catalogue is still a long list (P10: 4,600 px on the desktop, 7,000 px on a phone). It fits, though, and crew fire from On air, where the Fire panel is at the top on a phone (P16).

### Screens: good
- **Good:**
  - Every storyboard message, title, QR step and finale fills the hero, large and centred, at 1080p, 4K and portrait (V2, V4, V6). The 4K crop is sharp (V2).
  - Stings are bright on the theme's gradient with dark ink (V3). The finale "It's on!" is now the loudest thing on the screen (V2, S1 frame 10).
  - A crew spotlight photo fills the hero with its words on a scrim (V1). This answers R2's "small text in the corner of an empty hero".
  - The first fire on a fresh stack reads "Welcome to Demo Event" and draws its QR (V6).
- **Falls short:**
  - The steps have no kicker line ("DOORS ARE OPEN", "CHECK-IN", "STARTING SOON"), and the QR step has no "Scan with your phone", as polish 08 draws (V2, V4, V6). They read fine without them; it is a finishing touch.
  - **Urgent** now says URGENT in amber on the card (V5). But the card's frame keeps the normal cyan glow, and the ticker's URGENT label is purple (V5, portrait). Urgent and info are now easy to tell apart on the card, not yet everywhere.
  - A test-fired Starting soon counts down "14:56" while its own line says "in 55 minutes" (V4, 2; Starting soon in V2, 2). A real run counts correctly (S1). The builder's step thumbnails always read "05:00" (P11, P13).
  - Match called with no data still reads "Match called:" over an empty hero (V4, 3). It was on the old "later" list.

### The gate's three sequences
- **Starting soon, T−15, T−5, T−1 and its finale (S1): passes.** It fired by itself on the fixture's item and played each round on time. Each round opens with the full-hero sting, and each countdown fills the hero. The Pulse comes back between rounds, and "It's on!" lands at 00:45:01 on the accent gradient. This is what mockup 20 and polish 08 asked for. One small thing: after T, the rail still lists the semis as "Delayed · 00:45" (frames 10–11), a step 3 Pulse matter.
- **Midnight at 00:00:00 (S2): passes.**
  - Both zones show the countdown by 23:59:55 and the sting by 00:00:00.8, and sting and card never overlap. The entrance is now on the dot with the main hall.
  - Next to polish 09, the full-screen countdown and the "Night 1 at Demo Event" card are about half the sheet's size, in a big dark screen (frames 3–4 and 7–8). The sheet's kicker lines are missing, there are only a few confetti dots, and a purple glow the sheet does not draw runs round the edge during the countdown.
  - The entrance shows a 0.6 s empty background between sting and card (frame 6). The capture may cause that.
- **Premiere on two screens (S3): passes.** The film plays full bleed with no frame and no bars. The two players stay 49–50 ms apart with no drift. The countdown's words now match its count.

### The first book's seven gate items
1. **Storyboard steps at hero scale; stings bright and large: closed** (V2, V3, V4, S1). The readability check now covers storyboard steps in CI.
2. **Midnight done properly: closed** (S2): on the dot on both zones, the sting in the theme's look, no overlap. The countdown and card are smaller than polish 09 (later).
3. **Premiere full bleed, with countdown text that matches: closed** (S3).
4. **Pages that fit:** Storyboards, Cues and History at 1280 px and on a phone, with the Fire panel in the grid: **closed** (P3, P10, P15).
5. **The QR and `{event.name}` on the first fire: closed** (V6).
6. **Fire picks the next fitting item: closed** (P16). Two gaps are left: the time is shown in UTC, and nothing visible happens until the first round.
7. **Urgent looks urgent: mostly closed** (V5): the label is amber on the card. The card's frame and the ticker label are not.

### Your notes
- **Drag and drop, no rank numbers:** closed on Priorities (P1). "Rank 70" is still on On air (P16).
- **The sound desk, one huge page:** closed (P3–P9).
- **Sliders, not typed numbers:** closed (P2, P4, P6, P11).
- **The cue editor looking professional:** closed (P4).
- **The builder's box alignment and the one long edit box:** closed (P11–P13). The text boxes are narrow, and the spotlight form now has the long boxes instead (P17).
- **History fitting the width:** closed (P15).
- **The screens using their space, with the hero text large:** closed (V1, V2, V4). Midnight's countdown and card are the exception (S2).
- **The QR on a phone (a link instead):** this book does not show the attendee's phone pages, so I cannot confirm it from here. I will check it on the demo stack.

### What is left
**Before the gate:** nothing blocking.

If you want the most visible rough edges gone first, one small fast-lane package can do it in a few hours:
- remove "rank 70" from On air;
- name zones by their names everywhere ("Main hall", not "main");
- give Fire a visible result ("Starting soon starts at 02:15, T−15"), and show item times in the event's clock;
- make the urgent ticker label and frame amber.
- plain words instead of ids: triggers and Until in the builder (P14), cue pickers, the catalogue's notes (P10).

Otherwise these go first in step 5's polish.

**Later (step 5 polish, or the backlog):**
- Placeholders as chips (P11–P13).
- Wider text fields in the builder's step form (P12, P13).
- The spotlight form shows only the fields of the kind chosen, with themed controls (P17).
- Kicker lines on storyboard steps, and "Scan with your phone" on the QR step (polish 08).
- Midnight's countdown and card at polish 09's size, with its confetti, and without the edge glow (S2).
- A test-fired countdown counts to the item, or says it is a test; step thumbnails show the step's real length (V4, P11, P13).
- Test-fire's notice in the header, naming Main hall and History (P14).
- "Match called:" with no data (V4, 3).
- The rail lists a started item as Now, not "Delayed" (S1).
- The Cues list folds after ten, as polish 01 draws it (P3).
- The CI full-page shots draw the sticky Save row in the middle of the page (P4, P6). That comes from the capture, not the page. Fix the script so the next book is clean.
- Check Peak's look and pace, and the attendee's QR-as-link, on a live screen and phone.
