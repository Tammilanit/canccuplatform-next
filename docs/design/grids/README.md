# Grids that scale: sheets, guard and build (#640)

The plan for amendment 3 of the design guideline ([`../README.md`](../README.md#3--grids-scale-with-their-content-2026-11-19)), from the PO's word at the step 4 gate (2026-11-19): "Any page that has a grid should scale", and "it needs to be planned well so that it works nicely". This folder holds the mockups, the [audit](audit.md) of every grid today and the [build issue's text](build-issue.md). No CSS changes here.

## The sheets

SVG in the dark organiser shell and the Demo night tokens of the step 4 polish sheets (`docs/briefs/step-4-polish/`), with demo names only. Every page is drawn at its full height, with the grid maths of the rule: the column counts and card widths in each frame's title are computed, not guessed. Numbered markers point to the notes under each sheet.

| Sheet | What it shows |
|---|---|
| [01](01-rule.svg) | The rule: the three sizes and their columns at each width; wide screens up to 3440 px; rows that align against masonry; bands against a side column; few and none; the phone's order; the fixed grids that stay |
| [02](02-on-air.svg) | On air with 2 and 8 zones at 1280 and 1920 px, and 8 zones on a 390 px phone: the crew band, the zones, the Storyboards and Scenes band |
| [03](03-sound-library.svg) | The sound library with 3 and 20 sounds at 1280 and 1920 px, and 20 on a phone: the master strip, the upload band, the sounds |
| [04](04-devices.svg) | Devices with 2 and 12 screens at 1280 and 1920 px, none at 1280 px, and 12 on a phone: the summary line, the screens, Recent in the band |
| [05](05-storyboards.svg) | The storyboard catalogue at 1280 px (a new event: none of its own) and 1920 px (two of its own), and on a phone: the Fire band, one grid per group |

**Checked for overflow.** Each text in the sheets carries `data-box`, the left and right edge of the box it sits in. Rendered in headless Chromium with DejaVu Sans (wider than the system fonts the shell uses, so a harder test), no text runs outside its box: no button label, card line or panel text in any frame.

## Choices the PO accepts or changes

The issue fixes the rule's topics; these are the sheets' answers where it left a choice:

- **Wide screens:** columns keep coming up to 120 rem of content, then the page stops at the one left edge (not "columns forever", not a centred page).
- **Heights:** rows align; no masonry.
- **Panels:** crew actions in a band above, related panels in a band below; no side column beside a collection (On air's, the storyboard catalogue's and Devices' side columns go).
- **Not every list is a grid:** scenes stay a ranked list, cues and people stay tables.
- **Storyboard cards:** the catalogue's rows become cards; Duplicate and Reset to default move into a ⋯ menu so a card fits 18 rem.
- **Sounds A to Z** (today in upload order); devices stay by name, zones by key.
- **On air on a phone:** crew actions, the zones, then Storyboards and Scenes. #639 puts Storyboards second, before the zones; keeping that means Storyboards joins the crew band above the zones on a desk too, which pushes the zones down by about 260 px at 1280 px.
- **Three sizes** (card 18 rem, small 10 rem, tile 7 rem); a module never sets its own minimum.

## The guard

How a new fixed-count grid on a collection is caught, and how a justified exception is marked. It is a test in `packages/ui`, so it runs on every pull request in the `lint-types-test (ui)` job, which CI runs for every change; no workflow changes.

- **Files:** `packages/ui/test/grid-rule.ts` (the checker, pure: it takes a file's path and text and returns findings) and `packages/ui/test/grid-rule.test.ts` (its cases, and one test that runs it on the repo's tracked files from `git ls-files`).
- **What it reads:** every tracked `*.css` under `modules/` and `packages/ui/`, and every tracked `*.ts`, `*.js` and `*.mjs` under `modules/` and `packages/` that is not a test, a declaration file or under `node_modules/`.
- **What it finds:** each `grid-template-columns` declaration, each `grid-template` shorthand with a column list (after its `/`), and in TypeScript and JavaScript each `gridTemplateColumns` assignment and `setProperty("grid-template-columns", …)` call.
- **What passes:**
  - the `.canccu-grid` rule and its modifiers in `packages/ui/ui.css` (the band is flex and has no column list);
  - a declaration with the marker on its line or the line above: in CSS `/* canccu-grid: fixed <kind> — <reason> */`, in TypeScript and JavaScript `// canccu-grid: fixed <kind> — <reason>`. The kind is one of `form`, `table`, `row`, `master-detail`, `control`, `screen`, `shell`; the reason is at least three words. An em dash or a plain hyphen separates them.
- **What fails,** each as `file:line` with the declaration and a hint ("a collection takes `.canccu-grid`; a fixed layout takes the marker with its kind and reason"):
  - any other declaration, `auto-fill` and `auto-fit` included (a module's own collection grid is what the rule replaces);
  - a marker with an unknown kind or no reason, and a marker on no declaration;
  - a module that sets `--canccu-grid-min` (the three sizes are `ui.css`'s).
- **Its cases** (the self-test): a plain fixed `repeat(3, …)` fails; `auto-fit` in a module fails; each kind with a reason passes, on the same line and on the line above; an unknown kind fails; a marker without a reason fails; a marker two lines above fails; the shorthand with and without a column list; `gridTemplateColumns` and `setProperty` with and without a `//` marker; a module setting `--canccu-grid-min` fails; `ui.css`'s own rule passes.
- **An exception** is visible in review: the marker is in the diff, with its kind and reason, and the reviewer checks the reason against amendment 3's list of fixed layouts. A collection marked `form` or `row` to dodge the rule is a finding.

The build's first commit adds the markers to the 100 rows the audit keeps, so the guard is green on main from the start.

## The build issue

[`build-issue.md`](build-issue.md) is the text for the lead to file once the PO accepts this plan, with its scope, acceptance criteria, risk and how On air from #638 comes in line.
