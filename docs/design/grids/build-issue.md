# Build issue: the text for the lead to file

Filed only after the PO accepts the plan (#640). Labels: `module:ui`, `module:moments`, `module:screen`, `module:theming`. One package: the shared CSS, its guard and the pages it changes share files, and the guard fails until every page is in line.

---

**Title:** `feat(ui): grids that scale with their content (amendment 3)`

## Goal

Build amendment 3 of the design guideline (`docs/design/README.md`, "Grids scale with their content") as drawn on the sheets in `docs/design/grids/`: collections fill the width they have with one shared auto-fill grid, side panels move into bands, wide pages stop at 120 rem, and a guard keeps new fixed-count grids out. The PO at the step 4 gate: "Any page that has a grid should scale."

## Acceptance criteria

The shared parts (`packages/ui`)
- [ ] `ui.css` has `.canccu-grid` with `--small` and `--tile`, `.canccu-band`, and `.canccu-main--wide { max-width: 120rem; }`, exactly as amendment 3 gives them; `shell.ts` renders `canccu-main--wide` for `width: "wide"`.
- [ ] A card in `.canccu-grid` is a column flex box whose last action row sits at its foot, so a row's buttons line up.
- [ ] `.canccu-stats` takes the rule's small size with `auto-fill` (audit row 112).

The guard
- [ ] `packages/ui/test/grid-rule.ts` and `grid-rule.test.ts` as specified in `docs/design/grids/README.md` (The guard), with every case listed there, and the repo test green.
- [ ] Every row the audit (`docs/design/grids/audit.md`) keeps carries the marker with its kind and the audit's reason.

The pages
- [ ] Only these pages pass `width: "wide"`: Moments' On air, Storyboards (the catalogue and the builder) and Cues → Library; the Screen studio's Live, Devices, Zones and layouts (the gallery and the zone editor), Schedule and Content. Every other Moments and Screen studio page drops it and keeps the 64 rem default.
- [ ] The 12 Rule rows of the audit use `.canccu-grid` at the size it names, and their own column lists are gone; the 5 Remove rows are gone.
- [ ] **On air** (sheet 02): crew actions as one band above the zones (one row from 1100 px: Announce…, Spotlight…, the emergency's hold at the right); the zones in `.canccu-grid`; Storyboards and Scenes in `.canccu-band` under the zones. On a phone: crew actions, the zones, Storyboards, Scenes. A zone card lists at most 4 entries, then "+n more". Zones in Screen's order (by key).
- [ ] **Storyboards** (sheet 05): the Fire panel is a band above the catalogue; each group (Your storyboards, Every event, Some venues) is a `.canccu-grid` of storyboard cards: name (the builder's link), number and trigger, rounds and sound, status, On or Off, Turn on or off, and a ⋯ menu with Duplicate and Reset to default. Built-ins by catalogue number, the event's own A to Z. A group without cards is one dashed line with what to do.
- [ ] **Sound library** (sheet 03): the master strip, then the upload band, then the sounds in `.canccu-grid`, A to Z by title.
- [ ] **Devices** (sheet 04): the summary line, then the screens in `.canccu-grid` (by name, as today), then Recent in `.canccu-band`; no side column at any width. No screens: the shared empty state, and Recent says nothing has happened yet.
- [ ] Live, the scene editor's checkboxes, History's filters, the spotlight's photos, the layout gallery, the content library and the Theme studio's colours and swatches use the sizes the audit names.

Tests and screenshots
- [ ] A Moments browser test (as `test/priorities.browser.test.ts`, with `@canccu/ui/ui.css`) renders On air with 1, 2 and 8 zones at content widths of 358, 944 and 1,584 px: the zones take 1, 3 and 5 columns; one zone is at most 440 px wide; the crew actions are above the zones and Storyboards and Scenes below them at every width; on the phone width the order is crew actions, zones, Storyboards, Scenes.
- [ ] The same test shape for the storyboard catalogue (5 columns at 1,584 px, the Fire band above) and, in `packages/ui`, for `.canccu-band` (a lone panel is at most 48 rem wide; two panels share a row from 2 × 22 rem).
- [ ] Screenshots next to sheets 02–05: On air with 1, 2 and 8 zones at 1280 px and 8 at 1920 px and on a phone (the shots #639 added stay and are redrawn); the sound library with 3 and 20 sounds at 1280 and 1920 px and on a phone; Devices with 2 and 12 screens at 1280 and 1920 px, none, and on a phone; the storyboard catalogue at 1280 and 1920 px and on a phone. The scripts make the zones, sounds and screens they need and remove them afterwards.

## Room to design

Fixed: the rule's numbers, the three sizes, the band's limits, the 120 rem width, the guard's marker and kinds, and the page orders above. Free: the markup and class names inside each page, how a card puts its parts within the sheets' look, the "+n more" wording, and how the scripts make their test data.

## Files likely involved

`packages/ui/ui.css`, `packages/ui/src/shell.ts`, `packages/ui/test/grid-rule*.ts`; `modules/moments/src/{views,on-air-data,page-kit}.ts`, `modules/moments/src/story/{picker-view,views}.ts`, `modules/moments/src/cues/library-view.ts`, `modules/moments/static/*.css`, `modules/moments/test/*.browser.test.ts`; `modules/screen/src/studio/{page,devices-view,views}.ts`, `modules/screen/static/*.css`; `modules/theming/static/studio.css`; the CSS of agenda, notify and the player for markers only; `scripts/demo-screenshots-*.mjs`, `modules/screen/test/stack/`.

## Out of scope

The screens' own layouts and widgets (they get markers only); Python pages' widths (agenda, notify, admin keep theirs, and `kit-py` gets no `wide`); a zone order setting; turning scenes, cues or people into grids; any contract or migration.

## On air from #638

#639 (open) draws On air as one auto-fill grid in which Crew actions, Storyboards and Scenes are siblings of the zone cards (`.moments-board` in `static/on-air.css`, the zones' wrapper `display: contents`). This plan differs: the panels are not items of the collection, because a panel then moves when a zone is added and is squeezed to one card's width (the Fire chooser at 304 px). If #639 merges first, this issue replaces `.moments-board` with the three parts above in the page's order, drops `display: contents`, and moves Storyboards after the zones on a phone (the PO's choice on #640 may keep it second, in the crew band). If this issue starts first, it waits for #639 and builds on it.

Risk: normal — layout of several modules' pages and a shared CSS class with its test; no contract, migration, workflow, rights or data change.
