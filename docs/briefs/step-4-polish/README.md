# Step 4 polish: the sound desk, the storyboard builder and the hero

Issue #623. At the step 4 checkpoint (#618) the product owner read the screenshot book (`docs/reports/step4-screenshot-book.md`, PR #622). Three surfaces need a new design before they are rebuilt. These mockups redraw them in the shipped design language: the dark organiser shell with its left menu, and the Pulse screen in the Demo night theme. Colours are the theme's tokens and the computed inks from `docs/design/`. The type is the system sans used in the other mockups. Names come from the demo event only. The files are SVG with no raster images; the "photo" in the hero sheets is a vector stand-in.

Each sheet has numbered markers, and its notes say what changed and why. This README sums them up. Shot ids (O9, R2, S1, …) are the book's.

| Sheet | What it shows | Book shots | Rebuilt in |
|---|---|---|---|
| [01](01-sound-desk-cues.svg) | Sound desk: Cues at 1280 px; the master strip muted and after a sound check | O9, O11, O12 | #626 |
| [02](02-sound-desk-cue-editor.svg) | The cue editor at 1280 px | O10, O9 | #626 |
| [03](03-sound-desk-library-limits-log.svg) | Library, Limits and categories, Log at 1280 px | O9, O11, O12 | #626 |
| [04](04-sound-desk-phone.svg) | The four sub-pages and the cue editor at 390 px | O30 | #626 |
| [05](05-builder.svg) | Storyboard builder at 1280 px | O20–O23 | #627 |
| [06](06-builder-phone.svg) | The builder at 390 px | O29 | #627 |
| [07](07-hero-rule.svg) | The hero rule: anatomy, photo and scrim, type scale, before and after | R1, R2, R17–R22, S1–S3, A5 | #625 |
| [08](08-hero-templates-1080p.svg) | Every hero template at 1080p | R1, R2, R4, R17–R22, S1, A5 | #625 |
| [09](09-hero-midnight.svg) | Midnight: countdown, sting, card, the entrance on the dot | S2, R21 | #625 |
| [10](10-hero-4k-portrait.svg) | The rule at 4K and in portrait | R2, R19, A1, A5 | #625 |

## The sound desk (replaces mockup 12)

- **One long page becomes four sub-pages** (O9): Cues, Library, Limits and categories, and Log, as pills under the Cues tab. A master strip sits on top of each one. O9 put the budget, master, categories, 25 cues, library and log on one page about 7,000 px tall.
- **The master strip** (O11, O12): Sound on, the master volume as a slider, Mute all 15 min and Sound check with its zone menu. Each zone's use of the hour is shown in a line. When muted, the strip turns amber and counts down. After a sound check it reports in words what each zone did.
- **Plain names first** (O9): "Urgent announcement", with `announce.urgent · Alarm` as the grey second line. Cues are grouped under their category, which states its level and calm rule. Chips filter the list and search finds a cue by name or id.
- **Sliders, not number boxes** (O9, O10): master volume, cue level, category levels, sounds an hour and a minute, not-again-for and holds-for are sliders with their values shown. Catch-up and the per-source gap are steppers. Interrupts and the calm rule are two-way switches.
- **A professional cue editor** (O10): two cards on the content grid. Sound holds the category as chips with a line on what it means, the chosen sounds as themed players (play, stop, waveform, length, remove), the rest of the library as add-chips, then level, not again for, catch-up and once per source. Picture holds the effect chips, a hold slider and a small live preview. Try it plays the cue here or on a zone. Save and Cancel sit in a pending row; Reset to default moves into a card that says what changed from the pack.
- **Themed players everywhere** (O9): the library is a grid of sound cards with themed players, the licence, and the cues that use each sound by name. Upload is one button with a drop area.
- **The log in words** (O9): each row says what happened ("Not again for 2 min: played 21:29:10"), and the reason code is the grey second line. The log filters by outcome and zone.
- **It fits** (O9, O11, O12, O30): nothing is wider than 1280 px or 390 px. On a phone the sub-pages are pills that scroll sideways, and lists become cards.

## The storyboard builder (mockup 18 in the dark shell)

- **Rounds on a timeline** (O20, O21): the rounds are blocks on a time axis from T−15 to the finale. One switch picks set times or every few minutes (the loop, O21). Until and Sound sit on the same line.
- **The round as a strip of steps** (O20–O22): each step is a small picture of itself in the hero's look, with its seconds. The repeat is a bracket and steps reorder by drag. The selected step's form opens beside the strip.
- **Fields on a grid** (O20–O22; the PO: "oddly aligned, one long edit box"): two even columns with a label above each field. Seconds is a slider and hero or full screen is a switch. Placeholders are chips, and the form shows what the fields fill with.
- **Triggers and conditions as chip rows** (O20): labels sit in one column at the left, and each chip opens its own small form.
- **The live preview with scrub** (O20, O23): the real player at card size, drawn to the new hero rule. The scrub bar is coloured by step. Test-fire and Save are in the header (O23: after a test-fire the header says "One test round on Main hall").
- **The checks before saving** (O20): airtime and the sound budget as bars with their caps, and each check as a sentence with a tick or a warning, in the preview's column.
- **Phone** (O29): Overview, Round and Preview as three tabs. The checks are one line on top. Test-fire and Save sit in the pending row.

## The hero uses the screen (the rule for mockup 20)

One rule for every hero template: the crew spotlight, the announcement card, and the storyboard message, title, QR, countdown and finale steps, stings and Midnight.

- **One block, centred** (R1, R2, R21, R22, A5): the content is one block, centred across and down, in the hero less 64 px. It is never pinned to a corner.
- **Large** (R21, S1): the kicker is 44 px. The headline starts at 160 px (128 px over a photo), steps down by 4 to fit and never goes under 88 px. The body is 60 to 44 px and the countdown 330 px. Every size doubles at 4K (R2, R19). Portrait keeps the same steps and allows a third headline line (A1, A5).
- **A photo fills the hero** (R2; the PO: "the hero is meant for a photo"): it covers the whole hero, cropped from the centre. A scrim runs from clear to 94 %, and the block sits centred at its foot. Without a photo, the type is large and centred.
- **Stings are bright on the accent** (R17, S1 frames 1, 3, 5): the hero turns to the theme's gradient, primary to accent, with dark ink at 230 px and a light sweep. The finale "It's on!" uses the same treatment (S1 frame 8, R22): the loudest moment, not the quietest.
- **Midnight** (S2): a full-screen countdown with 420 px figures, then a full-screen sting in the theme's gradient with a ring burst and confetti, then the card. The sting is gone 0.6 s before the card comes, so the two never overlap. Every zone, the portrait entrance too, shows the sting in the same second.
- **The QR step** (R20) always draws its code, large, beside its words.
- **Contrast** stays computed per ground (design decision 1 in `docs/design/README.md`), and storyboard steps join the readability check (#625).

## Design choices beyond the book's notes

The book does not settle these. The sheets choose them, and the PO accepts or changes them:

- The sound tab keeps its name, Cues. Its sub-pages are Cues, Library, Limits and categories, and Log.
- The log's "suppressed" outcome reads "Held back" (its reason code stays as it is).
- A step's "Size on screen" (Hero or Full screen) is a switch in the step form; the shipped builder had a Full screen checkbox per storyboard.
- A photo narrower than half the hero is not stretched: the hero falls back to type without it (sheet 10).
