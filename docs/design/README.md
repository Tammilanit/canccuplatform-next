# One design

**This is the accepted design guideline (PO, 2026-11-12) for every later step that touches anything users see.** Issues name the sheet of `mockups.html` they follow; PRs carry screenshots of the built page next to that sheet.

**What is in the repo and what is not.** This folder holds `mockups.html`, `stage.html`, this README, `widgets.md`, `experience-map.md`, `strips/*.png` and `moments-on-air.svg` (On air rebalanced at 1280 px and 390 px, plus a 6-zone grid frame, #638, in the dark shell of the step 4 polish sheets). The per-sheet renders (`png/`, 64 files, about 84 MB) and the clips (`video/`, about 29 MB) are too large for the repo: they stay in the handover folder on the maintainer host, `/home/debian/handover/design-final/png/` and `/home/debian/handover/design-final/video/`. Wherever this README says `png/` or `video/`, it means those folders. The generator `build/` it names is in neither the repo nor the handover folder.

The one design language, organiser shell and screens (issue #382). The base is PR #387's `mockups.html`, with the hybrid from the design review, the fixes from four judging rounds, round 5's layouts and motion, and round 6's scenes, Director, cues, backgrounds and widgets.

**Open `mockups.html` in a browser.** It is one self-contained file: no scripts, no external files. The screens on sheets 10 and 11 move. The switch at the top right recolours every mockup with four themes: Default, Demo night, Light and Hostile (yellow primary on white, pale status colours, grey text). `png/<sheet>-<theme>.png` holds every sheet in every theme (64 files). `build/` holds the generator (`build.py`, with `colour.py` for the contrast rule), the renderer (`render.sh`) and a per-figure zoom tool; none is needed to read the mockups.

The sheets carry no version or review tags.

## Amendments accepted by the PO, binding for the build

These amendments came after the sheets were drawn: 1 and 2 on 2026-11-12, 3 on 2026-11-19. Where a sheet, a clip, `widgets.md` or a later section of this README says otherwise (for example the drift times under "Fixes from the product owner"), the amendments win.

### 1 · Energy levels: clearly different look, same pace

The three energy levels must look clearly different, but the pace never changes. The hero rotation stays the same at calm, lively and party (the zone's dwell), so the screen never gets busier or hastier. Higher levels only make effects more visible.

| | Calm | Lively | Party |
|---|---|---|---|
| Changed box | Numbers roll only | Plus a light sweep | Plus box-level effects (pop, tilt) |
| Spotlight | Steady outline | Glow plus a tracing border | Glow, tracing, pop and a ring burst |
| Background drift | Slow, 2 min a turn, no stage tint | 45 s a turn, tints on surges | 20 s a turn, frequent tints |
| Heartbeat | None | Visible | Strong |
| Celebrations | None | Milestones | Milestones, confetti and reactions |
| Sound | Essential cues only | Normal | Full |
| Hero rotation | The zone's dwell | The zone's dwell | The zone's dwell |

A test or CI clip shows the three levels side by side.

### 2 · The six-box dashboard gets more air

- Each box shows at most 3–4 rows, with larger type.
- During a showcase the 2 × 2 hero takes four cells. The two remaining cells show at most two widgets; the others pause.

### 3 · Grids scale with their content (2026-11-19)

The PO at the step 4 gate: "Any page that has a grid should scale." A page of like items fills the width it has, from a 390 px phone to a 2560 px desk, and stays balanced with one item, two or forty. The sheets are in [`grids/`](grids/README.md) (01 the rule; 02–05 On air, the sound library, Devices and the storyboard catalogue, each with few and many items at 1280 px, 1920 px and 390 px); the audit of every grid today is [`grids/audit.md`](grids/audit.md). Numbers are at a 16 px rem.

**Collections are one auto-fill grid, with the shared class.** `packages/ui/ui.css` gets `.canccu-grid`; no module writes its own collection columns:

```css
.canccu-grid {
  --canccu-grid-min: 18rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--canccu-grid-min)), 1fr));
  gap: var(--canccu-gap);
  align-items: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}
.canccu-grid > * { min-width: 0; }
.canccu-grid--small { --canccu-grid-min: 10rem; }
.canccu-grid--tile { --canccu-grid-min: 7rem; gap: calc(var(--canccu-gap) / 2); }
```

`auto-fill`, never `auto-fit`: the empty tracks stay, so one or two items keep their width. `min(100%, …)` lets a card shrink inside a box narrower than its minimum instead of overflowing it. A card wider than its minimum grows only until one more column fits, so from two columns on a card is at most 1.5 × its minimum plus half a gap (card 440 px, small 248 px, tile 172 px). Three sizes are enough: a module never sets `--canccu-grid-min` itself.

| Size | Min | Phone (358 px) | 1280 px (944 px) | 1920 px (1,584 px) | 2560 px and wider (1,920 px) | Kinds |
|---|---|---|---|---|---|---|
| Card | 18 rem, 288 px | 1 | 3 × 304 | 5 × 304 | 6 × 307 | Zones (On air, Live), devices, sounds, storyboards, pizza orders (step 5) |
| Small | 10 rem, 160 px | 2 | 5 × 176 | 9 × 162 | 11 × 160 | Option checkboxes (a scene's zones), filters, colours and swatches, content library items |
| Tile | 7 rem, 112 px | 3 | 7 × 128 | 13 × 114 | 16 × 112 | Thumbnails: the spotlight's photos, the layout gallery |

Not every list is a grid. **Scenes** stay a ranked list in one column: the first scene whose conditions hold wins (Q18), so rank reads top to bottom. **Cues** and **people** stay tables: they are compared column by column (level, cooldown; role, last seen), and a table already uses the width; on a phone each row is a card, as today. **Playlists** are picked beside the content library, a master–detail page.

**Spacing.** The gap between cards is `--canccu-gap` (1 rem), half that between tiles. The page keeps the shell's padding: 2.5 rem at the sides from 1100 px (beside the 16 rem menu), 1 rem below. Between a page's parts (bands, groups, the grid) the main column's 1.5 rem.

**Wide screens: columns keep coming, up to 120 rem of content.** A collection page, a board or a master–detail editor is a `wide` page: its content is at most 120 rem (1,920 px). The shell's `width: "wide"` option exists today but draws nothing; it becomes `.canccu-main--wide { max-width: 120rem; }`, and pages that are neither keep the 64 rem default (forms 40 rem). At 1920 px the content is 1,584 px; at 2560 px and on an ultra-wide it stops at 1,920 px and keeps the one left edge, the rest empty. Why a limit: past about 1,900 px a row is wider than the eye takes in at once, a page on a 2560 px desk keeps the shape it has on the common 1920 px one, and the bands and headings above the grid stay in reach of the menu.

**Unequal heights: rows align.** `align-items: stretch`: every card in a row is as tall as the row's tallest, and its last action row sits at its foot (a column flex card with `margin-block-start: auto` on the actions), so buttons line up. No masonry: it places a card under the shortest column, so a card that grows live (a zone gets one more waiting moment) sends the cards after it to other columns while the crew aims at them, and the reading order no longer runs left to right. A card's own list shows at most 4 rows, then "+n more", so no card is far taller than its row.

**Side panels go in bands, never in a column beside a collection.** A column of panels beside a grid grows taller than the grid (the screenshot book's On air, P16: one 1,900 px column) or leaves it short.
- Above the collection: the page's **crew actions** as one band (one row of buttons on a desk), then its **summary** (a count line, the sound desk's master strip, count tiles) and **filters** (one wrapping row of small fields).
- Below it: **related panels** (Storyboards and Scenes on On air, Recent on Devices) in `.canccu-band`: a flex row that wraps, each panel at least 22 rem and at most 48 rem wide, a row of panels as tall as its tallest, so a lone panel never stretches across a 1920 px page.

```css
.canccu-band { display: flex; flex-wrap: wrap; gap: var(--canccu-gap); align-items: stretch; }
.canccu-band > * { flex: 1 1 22rem; min-width: min(100%, 22rem); max-width: 48rem; }
```

Only a master–detail page keeps a column beside its list, because that column shows the item picked in it.

**Few and none.** One or two items keep their card width at the one left edge; the rest of the row stays empty (sheet 01, 5). None: the shared empty state (`emptyState`: icon, title, one sentence, the page's main action) replaces the grid; a group of a page with several groups says so in one dashed line with what to do (sheet 05).

**Order is stable.** Each kind has one order that a live change never alters: zones in Screen's order (by key, as the Studio lists them), devices by name, sounds A to Z, storyboards by catalogue number and then the event's own A to Z, pizza orders oldest first. A new item lands at its place in that order; a change of state (on air, offline, on or off) shows on the card and never moves it.

**Phone.** Under about 37 rem of content a card grid is one column (small items keep two, tiles three). The page's order is the phone's order: crew actions first, then the summary and filters, the collection and the panel band, so a screen reader meets them in the same order and no `order` is needed.

**Fixed columns stay where the layout means it:** a form's label and field (`.canccu-form__row`, the builder's two-column fields), a table and its rows, a master–detail editor (the builder, the zone editor, the schedule, the announcement composer and its preview), a row's own parts (a time and a label, a player's controls), a control with a fixed count (the 7 days, the 4 motion levels, the delay chips) and the screens' own layouts (the player's regions, the layout map). Each is marked in its CSS with its kind and reason; the guard below lets the marked ones through.

**The guard.** A test in `packages/ui` (it runs on every pull request in `lint-types-test (ui)`, so no workflow change) reads every tracked CSS file under `modules/` and `packages/ui/`, and the `grid-template-columns` written from TypeScript and JavaScript, and fails on a column list that is neither `ui.css`'s own `.canccu-grid` nor marked. A justified exception carries the marker on its line or the line above: `/* canccu-grid: fixed <kind> — <reason> */`, the kind one of `form`, `table`, `row`, `master-detail`, `control`, `screen`, `shell`. The full rules and its self-test are in [`grids/README.md`](grids/README.md#the-guard).

## Changes since v7

The finishing pass: seven narrow changes, no new sheets.

| # | Change | Where | What is drawn |
|---|---|---|---|
| 1 | Dashboard: the hero is a role, not a box | Sheets 10 and 13; `experience-map.md` | One of the six boxes holds the hero role (top-left by default) and plays the Director's features. A showcase grows it to 2 × 2: drawn for a surging game (sheet 10) and a crew spotlight (sheet 13), with the other five boxes slid aside and shrunk to a headline. The Screen studio card where the crew picks the hero box and switches growing on or off. Clip: `video/dashboard-showcase.webm` |
| 2 | Cues last long enough to be noticed | Sheet 14 | Every box effect is a small move (0.6 s) followed by a frame and soft glow that hold 60–120 s and fade over 10 s. The storyboards show 0 s, 0.3 s, 1 min and 2 min. Each event's hold time is a setting. On screen, a surge's glow now holds as long as its stage tint |
| 3 | Sound is fully configurable and linkable | Sheet 14, Screen studio → Cues | Two sections. "Screen effects": the effect boxes, the hold time, and whether a sound is linked. "Sound": any trigger (scene, widget event, crew button, agenda item, outside signal as planned) linked to any sound, with volume, cooldown, the zones that play it, a preview, and whether it plays with a picture or alone. A sound library with upload and preview. Master switches |
| 4 | "Right now": arrows on the baseline | Every screen with the widget | The arrow sits on the number's baseline. The dash that used to sit under the arrow is gone (it fades out as the arrow fades in). Measured at 1080p: the arrow's bottom is 1 px from the digits' bottom (`build/measure.mjs`, crop in `build/right-now.png`) |
| 5 | No half-empty large panel | Sheets 10, 11, 12, 13, 15 | Every feature fills the panel: the highlight carries the game's art, the hot game its numbers, "Today in numbers" a graph of the day, the spotlight's rows spread out |
| 6 | Photo wall | Sheets 13, 16 | Five tiles in two rows; the panel keeps a clear band for the "starts in" chip |
| 7 | Tournament roster and bracket | `experience-map.md` | Their own widget family under the Games system, to be planned later; the drawings are placeholders |

**Re-rendered:** `layouts`, `motion`, `scenes`, `director`, `cues`, `backgrounds`, `widgets` in all four themes. The other nine sheets are unchanged from v7.

**Clips:** all eight were re-recorded, because changes 4–6 show in every Pulse clip. New: `dashboard-showcase.webm`. In the `cues` clip the 1–2 minute hold is compressed to about 3 seconds, and the clip says so.

**Not re-run:** the full measuring audit. Only the "Right now" alignment was measured in this pass.

## Changes since v6

Everything is drawn night-first: the board opens on "Demo night". Five new sheets (12–16), an ownership map, a wider widget catalogue, seven clips.

### Files

| What | Where |
|---|---|
| The mockups: 16 sheets, four themes, animating in a browser | `mockups.html` |
| Every sheet as PNG | `png/<sheet>-<theme>.png` (64 files). New sheets: `scenes`, `director`, `cues`, `backgrounds`, `widgets` |
| Who builds what | `experience-map.md` |
| The widget catalogue | `widgets.md` |
| Clips (WebM, 1280×720, 10–24 s, 1–6 MB) | `video/lively.webm`, `party.webm`, `spotlight.webm`, `cues.webm`, `tint.webm`, `reactions.webm`, `heartbeat.webm`, `dashboard-showcase.webm` |
| Each clip as five frames | `strips/<name>.png` |
| The page the clips are recorded from; it opens on a menu | `stage.html` |

### The brief, section by section

| Brief | Where | What is drawn |
|---|---|---|
| 0 · Ownership map | `experience-map.md` | Each concept, its home module, step, issue and contract touch points; where each setting lives |
| 1 · Scenes | Sheet 12 | Screen studio → Scenes: a band chart of every day of the event, the scene list in priority order, one scene's conditions and changes, hold and blend times, the crew button, an outside signal drawn as planned. Five presets. Three scenes on screen (Daytime, Peak, Quiet). Quiet hours are a scene |
| 2 · Director and spotlight | Sheet 13 | Seven hero features; how the next is picked; the choreographer's pacing as lanes; the turn indicator as line, ring or off; the crew spotlight as four phone steps and its result on screen; a break arriving and playing |
| 3 · Cues | Sheet 14 | Six box-level effects as storyboards (pop, tilt, flip, ripple, slide, magnetic glow); sound categories with cooldowns; the effect-pool editor in Screen studio → Cues; the heartbeat at low and high activity |
| 4 · Two backgrounds | Sheet 15 | Stage against card as a table; a surge washing the stage in the game's art and promoting the game; card backgrounds for top games, photo wall, bracket and hot game |
| 5 · Widgets | Sheet 16 | Top games with banners, bars, tags and the leader's art; the activity graph as bars coloured by top game, as an area over the whole event, and as hour by day, with its settings; "Right now" without a sparkline; live standings and bracket; match called; reactions |
| 6 · Fixes | Sheets 4, 5, 11, 16 | See below |

### Fixes from the product owner

| Fix | Done |
|---|---|
| "Add between 19:45 and 21:15" | The gap line names both neighbours; the form picks the time and length (sheet 5) |
| "Seconds per photo" out of admin settings | It is a setting of the Photo wall widget in Screen studio (sheet 16); admin keeps "Default seconds per slide" |
| People tooltip contrast | The tooltip text is the background colour on the text colour |
| The screen's name on screens | Automatic (hidden with one screen), Always or Never: a setting drawn on sheet 16. The frames still show "Main hall", since the demo event has four screens |
| Glows never static | Every screen's stage has glows that drift all the time (44 s a turn at calm, 18 s at lively, 10 s at party) |
| Lively is livelier | At lively the large panel rotates, the stage breathes with a heartbeat, a changed box gets a sweep of light, the 5-minute chip pops, and the glows move more than twice as fast as at calm |
| Broadcast and Arcade | Motion packs a theme can choose: the setting and the three packs side by side on sheet 11. The separate alternatives page is gone |
| `stage.html` blank without a hash | It opens on a menu |

### What I checked, and how

- I cannot play video. I checked every clip through its strip of five frames, which are screenshots taken during the recording.
- In `cues`, the four transform effects (pop, tilt, flip, slide) last under half a second each, so the strip's five frames mostly catch ripple and glow. The storyboards on sheet 14 show all six.
- The measuring audit was run on the new sheets in two themes; see the end of this section for what it found.

## Decisions

1. **Ink is computed per ground, not per theme only.** Primary and status inks cover pages, cards, tints and notices; a second primary ink covers the hero panel, the glow and screens; muted text covers all of them.
2. **Fills that carry text are opaque computed colours**, so their contrast does not depend on what is behind them.
3. **A delay is one solid badge everywhere.**
4. **Pulse departs from mockup 02**: a 33 px floor, 54 px or more for times, the countdown in the hero, the solid delay badge, no developer words. The second "next" item, the slide credit and "Code changes every 30 s" are left out.
5. **The bottom bar always ends in More.** A page's pending row (Save, Publish) sits above the bar, is 52 px, and hides while scrolling.
6. **The run of show is one continuous list;** the day switch jumps and follows the scroll.
7. **Front pages keep the poster at one height** in every state.

## Questions for the product owner

- **Q1 · Event menu on desktop.** (a) At the side; it folds under 1100 px. *Recommended: (a).*
- **Q2 · Offline marker.** Fixed white on black, 42 px, in the header row in place of the date. (a) Accept; this is a contract change for size and position. (b) Keep `ui.css`'s corner and size. *Recommended: (a).* Someone must also check what `ui.css` draws today.
- **Q3 · Frames before a zone.** (a) The event's published tokens, with a fade. *Recommended: (a).*
- **Q4 · Item beside the day.** (a) Build it in step 3. (b) The item as its own page first. *Recommended: (a) if #383 has room.*
- **Q5 · Demo font.** (a) Drop Inter. *Recommended: (a).*
- **Q6 · Privacy on attendee pages.** v4 keeps the contract's colours but draws a small tag in a 44 px target. (a) Accept; a contract change for size. (b) Keep the slab. *Recommended: (a).*
- **Q7 · The phone's bottom bar.** Run of show, Notifications, Quick add, Screens, More. *Recommended: as drawn.*
- **Q8 · The live miniature Pulse** needs the virtual screen render. (a) Build it with #384. (b) A static preview until then. *Recommended: (a).*
- **Q9 · Pulse against mockup 02.** (a) Accept sheet 9; #375 builds from it. (b) Keep 02's sizes. *Recommended: (a).*
- **Q10 · A hostile theme.** (a) Publish with computed fixes, and say so. (b) Refuse past a set number of fixes. *Recommended: (a).*
- **Q11 · A light scheme on screens.** The Studio asks once and offers a dark variant for screens. (a) Accept; this means a theme can carry two schemes. (b) Warn only. *Recommended: (b) for step 3, (a) later.*
- **Q12 · Where the motion level is set.** The event sets it, a zone may pin its own, and "Follow the day" moves it one step with the phase. (a) As drawn. (b) Event level only. *Recommended: (a).*
- **Q13 · Motion in the theme.** Themes get a speed (slower, normal, faster), an intensity and a choice of spotlight effect, beside the eleven colour tokens. This is an additive theming-contract change. (a) Accept. (b) Fixed motion for every theme. *Recommended: (a).*
- **Q14 · Game art in the background.** Covers are blurred once on the server and sit under a computed scrim. (a) Accept, with the event able to switch the layer off. (b) Theme base and phase tint only. *Recommended: (a).*
- **Q15 · "Tell people" off.** A quiet delay or edit announces nothing; screens and the hub still show the new time. It needs the additive agenda contract change. (a) As drawn. *Recommended: (a).*
- **Q16 · Statistics widgets before the history exists.** `stats_history`, `top_games` and milestones need the bot's history in the platform database. (a) Ship the widgets with "Collecting…" until then. (b) Hold them back. *Recommended: (a).*
- **Q17 · Scenes belong to Moments, with their page in Screen studio.** (a) As drawn. (b) Scenes in Screen. *Recommended: (a); Screen only renders what a scene sets.*
- **Q18 · Scene priority.** The first scene in the list whose conditions hold wins, with Quiet at the top. (a) As drawn. (b) Scenes carry a rank number. *Recommended: (a).*
- **Q19 · Dynamic theme switching by a scene.** A scene may switch the palette or the whole theme. (a) Palette only in step 4, whole themes later. (b) Both at once. *Recommended: (a).*
- **Q20 · Reactions.** A fixed set (heart, star, four short words), one a second per screen, off in a quiet scene. (a) As drawn. (b) Free emoji with moderation. *Recommended: (a).*
- **Q21 · Sound cooldowns.** The table on sheet 14 is my proposal, not taken from the legacy engine. Someone who knows that engine should set the real values.
- **Q22 · The turn indicator's default.** (a) A thin line. (b) Off. *Recommended: (a).*

## Known limits

- Contrast is now measured on the rendered pages by `build/audit.sh`. Six samples inside `<code>` spans still read low; they look like sampling artefacts, unconfirmed.
- In Default, the stricter rule makes links and muted text lighter than the raw tokens (primary `#3b82f6` becomes `#89b4fa` as text, and text on a blue button is black).
- Under the Hostile theme pages read, but they stay pale: fills keep the event's tokens.
- The Screen studio pages (07–10) are not redrawn in the new shell.
- The takeover's red, the pairing code's black and the Discord preview's colours are fixed values outside the tokens, on purpose.
