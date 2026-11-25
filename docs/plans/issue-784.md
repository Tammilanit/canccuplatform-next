# Plan: issue #784: the theme studio for both kinds of organisers

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task by task in this session (the dispatcher's flow; no subagents), test first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One Theme studio that serves both kinds of organisers. **Pick a look** is a gallery of presets, each with its colour schemes. **Make it yours** covers the logo on a backdrop plate, colours, a font pair, roundness, the background and motion, all as choices. **Advanced** shows every token as a control, plus own fonts and backgrounds, widget looks and a checked CSS editor. All three show the screen, the phone and a hub page side by side as a live preview. Reset, Save as my preset, and export and import work at every depth.

**Architecture:** The studio stays server-rendered in `modules/theming` (`src/studio*.ts`, `static/studio*.js`) over the JSON API. The new choices are new optional **brand** fields: `logo_plate`, `font_pair`, `roundness` and `backdrop`. The simple mode generates tokens from them, as it does colours today, so an organiser who never leaves Make it yours stays in the simple mode. Presets are the theme packages the image already holds as starting points (`events/demo/themes/`). Each one gains `schemes` in its `theme.yaml`, and a draft remembers its `preset` so that Reset knows what to return to. The preview pages take token changes by `postMessage`, so a slider moves the preview before the draft saves. Every contract change is additive and ships with the package that uses it.

**Tech stack:** TypeScript, Fastify 5, Postgres (RLS), `sharp`, `css-tree`, `parse5`, `yazl`/`yauzl`, vitest, Playwright (browser tests and CI shots), `scripts/pack-page` (the PO's pack page).

**Spec:** [issue #784](https://github.com/Tammilanit/canccuplatform-next/issues/784) (Scope 1–5 and its acceptance criteria), [contracts/theming.md](../../contracts/theming.md), [contracts/theme.schema.json](../../contracts/theme.schema.json), the [design guideline](../design/README.md) (amendments 3 and 5), and the [briefs' mockup rules](../briefs/README.md#outline-of-a-research-pack). Linked: #785 (the Themes step designs the 5–10 presets this studio shows) and #725 (studio rows of the view audit; see Roadmap notes).

**Status:** accepted by the lead on 2026-11-25, Q1–Q5 as recommended (Q4: the pack shows all 14 pairs and the PO keeps 10–15). Part 0, the pack, is built in the plan's own PR (branch `784-feat-theming-the-theme`, not `pkg-784-pack`). The lead releases each later part after the one before it merges, and Part 1 only after the PO accepts the pack.

## Why a plan first
1. **The issue says design first.** A script-built pack goes to the PO for a `manual-accept` before any build. Part 0 below is that pack.
2. **Size.** The build, Parts 1–4 below, is estimated at about 9,100 changed lines of source and tests: more than twice the package limit of about 4,000 ([AGENTS.md](../../AGENTS.md#how-work-flows)). The issue says the lead may split it, and a worker may not, so this plan proposes the split (Q1).
3. **Two parts are high risk.** A new per-event table under RLS (Save as my preset, copied by clone) and a new upload type (video backgrounds) both need a maintainer's accept. The plan keeps them apart so that the normal parts merge on their own.

## Parts, size and risk (source plus tests, estimated)
| Part | What | Lines | Risk |
|---|---|---|---|
| 0. The pack | Script-built sheets for the PO: the gallery, Make it yours with a logo on a plate, Advanced with the preview, at 1280 and 1920 px; the plate in each preset; phone | 900 (script and text; renders are generated) | low, verdict `manual` (PO accepts) |
| 1. The brand model | Plate, font pairs (platform fonts), roundness, backdrop: contract, generation, the plate contrast check, the plate on every surface (shell, hub, screen, posters, Discord PNG, icons), the stage's backdrop in the screen player | 2,300 | normal |
| 2. Pick a look and Make it yours | Schemes in the presets, the gallery with thumbnails, the depth-2 page, the three-frame live preview, Reset to the preset, draft export and import | 3,000 | normal |
| 3. Advanced | Every token as a control, in groups and with tooltips; own fonts and background images; widget looks; the CSS and template editor checked as you type | 2,200 | normal |
| 4. My presets and video | Save as my preset (table `theming_presets`, migration 009, copied by clone) and video backgrounds (`videos/`, a new upload type) | 1,600 | **high** (RLS table; upload safety) |
| **Total** | | **≈ 10,000** | |

**Order:** 0 → 1 → 2 → 3 → 4. Each part is merged before the next one starts. Part 1 comes first because 2–4 draw what its brand fields produce. Part 2 builds the preview column that Part 3 reuses. Part 4 extends the gallery (Your looks) and the backdrop choice (video) that Parts 2 and 3 draw.

**PRs:** each PR's body starts with `Part <n> of #784` and `Refs #784`; only Part 4's says `Closes #784`. Branches are `pkg-784-<part>` (not `gh issue develop`), so merging Parts 0–3 leaves the issue open. After opening each PR, check that its `closingIssuesReferences` is empty.

## Global constraints
- **Additive only.** No field, code, path, class, custom property or event is removed or renamed. If a change turns out to be breaking, stop and ask the lead.
- **Migrations:** only Part 4 adds one, `009_presets.sql`, which only creates a table: no drop, rename or type change. A merged migration is never edited.
- **The simple mode stays simple.** Every choice in Pick a look and Make it yours is a brand field or `motion`. None of them sets `mode: advanced`. Advanced controls follow today's rule: any token change except `motion` and `motion_style` makes the theme advanced.
- **Contrast:** the simple mode never produces a failing pair (contracts/theming.md, Brand kit). Every scheme of every preset passes `contrastFailures` (a test, Part 2).
- **No typing in depths 1 and 2.** Colours use pickers and swatches. Sizes and levels use chips or sliders. Fonts are chosen from a list. The only text fields are the preset name in Save as my preset and the CSS and template editors in Advanced.
- **No internal words on screens.** The pages never show token keys, file paths, ids or CSS values as labels ([mockup rules](../briefs/README.md#outline-of-a-research-pack)). Every label is plain words, and every Advanced control has a tooltip.
- **Fonts are freely licensed and self-hosted.** Each font pair's `.woff2` files sit with their licence text in the image. Nothing is loaded from outside (the CSP blocks it anyway).
- **Pages work without a script** for saving and choosing (forms post). Scripts add the live preview, debounced saves and the check-as-you-type.
- **English and Finnish** for every new string, following the module's message files (or English only where the module has no Finnish yet).
- **File size:** about 400 lines per source file, with no new exemption. `studio-views.ts` (336 lines), `studio-preview.ts` (342) and `studio.js` (364) are split as the tasks below say.
- **Repo checks** before every push: `scripts/check-event-names`, `scripts/check-naming`, `scripts/check-file-size` (and `scripts/check-contracts` when `contracts/` changes).
- **Shots:** at 1280 and 1920 px for every depth, and at 390 px for the phone layout, in `scripts/demo-screenshots-theming.mjs`.

## Design decisions (the reviewer checks these)
| # | Decision | Reason |
|---|---|---|
| D1 | **The three depths are three studio pages** under one tab row, Pick a look · Make it yours · Advanced · History: `GET /theming/studio/` (the gallery), `…/yours` and `…/advanced`, with `…/history` as today. The brand-kit page becomes Make it yours. A draft-less visit to `…/yours` or `…/advanced` sends the person to the gallery | Scope 1–3. A tab row keeps each depth one click away, so the customise-everything organiser never has to pass through the gallery |
| D2 | **The preview column** is the same on every depth and sits right of the controls at 1280 px and wider: the screen (16:9) on top, then the phone (the hub at 390 px, scaled) and a hub page (the hub at 1280 px, scaled) side by side. Below 60rem it keeps today's phone layout: the preview first, one frame at a time behind a switch | Scope "both get the live preview beside the controls, always: the screen, the phone and a hub page together" |
| D3 | **Live preview by message.** A control's change posts `{type: "canccu-theme-live", vars: {"--canccu-…": value}}` (a direct token) or `{type: "canccu-theme-live", css}` (the draft's regenerated token CSS) to each preview frame. The frame accepts only same-origin messages and applies them as a `<style id="canccu-live">`. The draft saves 400 ms after the last change, and the page then posts the saved `tokens.css`. The page no longer reloads after a save. Publish is still held until every frame answers `canccu-screen-preview-drawn` for the saved draft version (today's D10) | Instant feedback without a draft write for every slider step, and Publish still proves that the frames show what will publish |
| D4 | **`brand.logo_plate`** (optional): `{kind: none\|light\|dark\|surface, shape: rounded\|circle, padding: small\|medium\|large}`, default `none`. Light is `#f7f7f8`, dark is `#121317` and surface is the `surface` token. Padding is a factor of the logo's drawn height: 0.08, 0.15 or 0.25. It is drawn through new custom properties `--canccu-logo-plate` (the colour, or `transparent`), `--canccu-logo-plate-radius` (`var(--canccu-radius)` or `50%`) and `--canccu-logo-plate-padding` (the factor). Each surface's logo rule computes its padding from its own logo height. These surfaces draw the plate: `canccu-header__logo` (ui.css, so the shell, the hub and the posters), the screen's `logo` widget, the generated `logo_png` and the hub icons | Scope 2: "none, light, dark or the theme surface; rounded or circle; with padding". One set of variables means every surface draws the same plate |
| D5 | **The plate check:** `plateAdvice(rgba, grounds)` in `src/logo-plate.ts`. It rasterises the logo once to 128 px (`sharp`, as `raster.ts` does) and counts the opaque pixels (alpha ≥ 128). A ground "shows" the logo when at least 50 % of those pixels have a WCAG contrast of 3:1 or more against it. The grounds are the theme's `background` (screen) and `surface` (hub and shell). A logo whose box is at least 98 % opaque brings its own ground and always shows. When a ground fails, the check suggests the first plate of light, dark and surface on which at least 80 % of the pixels reach 3:1; if none does, it suggests light for a dark logo (mean luminance < 0.5) and dark otherwise. A failing logo without a plate gives the warning problem `logo_unreadable` on the logo's path. Results are kept in memory by (file sha256, ground colours), up to 256 entries | Scope 2: "A contrast check suggests a plate when the logo would vanish". `contrastRatio` already exists in `src/contrast.ts` (the issue names `readability.ts`, but contrast lives in `contrast.ts`) |
| D6 | **`brand.font_pair`** (optional): the id of a platform font pair (`heading`, `body`). Fourteen pairs, all SIL OFL, are proposed in the pack and the PO picks 10–15 (Q4). They sit in `modules/theming/fonts/<pair>/` with their `.woff2` files, `LICENSE.txt` and `pair.json` (`name`, `heading`, `body`, the weights). They are served at `GET /theming/fonts/<pair>/<file>` (public, immutable) and listed at `GET /api/theming/font-pairs`. The generated token CSS adds their `@font-face` rules and sets `fonts.heading`, `fonts.display` and `fonts.body`. A pair that this platform version does not hold gives the warning `reference_unknown` and falls back to the system font | Scope 2: "a curated list (10–15 freely licensed pairs, self-hosted)". These are platform files and not package files, so the simple mode still holds no fonts |
| D7 | **`brand.roundness`** (optional): `square` (0), `soft` (`0.5rem`, today's default) or `round` (`1rem`), generated into `sizes.radius`. In Advanced, a token change to `sizes.radius` clears `brand.roundness`, and a change to `fonts.*` clears `brand.font_pair`, so each value has only one source | Scope 2 "corner roundness". Without the clearing rule, a later brand save would silently overwrite an advanced choice |
| D8 | **`brand.backdrop`** (optional): `{kind: glows\|gradient\|image\|game_art, image?: "images/…"}`, default `glows` (the stage as it is today). `gradient` is a still diagonal from `primary` through `background` to `accent`, under the scrim. `image` is a package image under `--canccu-stage-scrim`. `game_art` shows the current game's art (Screen's `display.stage.tint.art`) at every energy level, still at `none`, instead of only at lively and party. `GET /api/theming/current` gains `backdrop` (`kind`, `image_url`). The screen player adds `canccu-stage--backdrop-<kind>` and a `canccu-stage__backdrop` layer above `__glow`, and keeps the scrim on top so contrast stays true. The backdrop is for the screen; hub pages keep their plain background | Scope 2 "the background (a gradient, an image, or the current game's art)". Hub pages are read on phones, where an image behind text hurts reading (Roadmap note if the PO wants it there) |
| D9 | **Schemes:** a preset's `theme.yaml` gains `schemes`: 3–5 entries, each `{id, name, kind: dark\|light\|contrast\|accent, brand: {primary, accent, scheme}, colors?}`. `colors` is a whole colour-token set, for presets whose colours are tuned by hand (`terminal`, `level-up`). Without it, the colours are generated from `brand`. A draft gains `preset: {id, scheme}`, saying where it came from. The `schemes` of a package are kept as they are (the round trip loses nothing) and are read only by the gallery | Scope 1: "each with its 3–5 colour schemes (dark, light, high contrast, accent variants)" |
| D10 | **Presets are read from `events/demo/themes/`** at start, the same folder the starting points zip today (`STARTERS`), cached and validated against the schema. `GET /api/theming/presets` lists them with their schemes and the scheme's colours. #785 adds the new ones to the same folder unless Q2 moves them | Lean: the folder and its CI checks (`check-theme-refs`, shots per theme) already exist |
| D11 | **Applying a preset:** `PUT /api/theming/draft/preset` `{preset, scheme, draft_version?}` (creating the draft when there is none) replaces the draft's content with the preset package and the scheme's colours. It **keeps** the event's `images.logo`, `images.icon`, `brand.logo_plate` and `brand.embed_color`, and sets `preset`. Reset to the preset is the same call with the draft's own `preset`. A draft without `preset` shows "Start again from a preset…", which opens Pick a look. Replacing a draft whose CSS, fonts, templates or embeds would be lost asks first in a dialog. Embeds need `theming.embeds.write`, as a package upload does | Scope 4: "Reset to the preset is always there". It reuses the package path (`putPackage`), so a preset goes through every upload check |
| D12 | **Thumbnails** are inline SVG drawn on the server by `presetThumbnail(colors, opts)` (`src/preset-thumbs.ts`): a 16:9 mini screen (header with the event's logo on its plate, a hero card, a rail and a ticker) in the scheme's colours, with "Aa" in the pair's heading font, 240×135 at 1280 px. The page loads the `@font-face` rules of the fonts the gallery uses | Scope 1 asks for "small live thumbnails". A frame for every scheme would be 15–40 iframes on one page. Inline SVG stays as live as the logo, plate and colours it is drawn from, at almost no cost |
| D13 | **Colour suggestions:** `logoPalette(rgba)` gives up to 5 colours from the logo's opaque pixels (median cut). `matchesFor(hex)` gives the analogous (±30°), complementary (180°) and split pairs in OKLCH, each shaded as `brand.ts` shades a failing colour. Both appear as swatches under each colour picker | Scope 2: "pickers with swatches and suggested matches" |
| D14 | **Advanced controls come from one table**, `ADVANCED_CONTROLS` in `src/studio-controls.ts`. Each entry has `{group: colours\|type\|shapes\|screen\|motion, token, label, hint, control: colour\|font\|slider\|chips, range?, step?, css_var}`. The page, the tooltips and the browser test all read it. Slider ranges: corner roundness 0–24 px, border width 0–4 px, gap 8–32 px, screen edge margin 24–96 px | Scope 3: "Every token grouped by what it affects (screen, hub, motion), with pickers and sliders instead of raw fields, each with its tooltip". It also covers #725's Advanced rows |
| D15 | **Check as you type:** `POST /api/theming/draft/check` `{path, text}` (`theming.theme.write`) runs the checks of one `css/` or `templates/` file against the draft without storing anything, and answers `{problems}`. `Problem` gains optional `line` and `column` (1-based, from `css-tree`'s and `parse5`'s locations). The editor is a plain `<textarea>` with a line gutter. It checks 500 ms after the last keystroke, lists the problems with their line, and marks the lines. Save stores the file through `PUT …/draft/file` as today | Scope 3: "A CSS editor that shows the CSS checks' errors as you type". A dry run causes no file churn and no quota use. No editor library is added to the stack |
| D16 | **Widget looks:** the Advanced page lists each widget type that the draft's layouts place. Each can use the platform's look or a package template made for that type (`PUT …/draft/layouts/{id}` sets `template`), with a new template started from a skeleton and edited in the D15 editor | Scope 3: "Per-widget looks (templates)". Templates and their checks already exist; the page was missing |
| D17 | **Export and import of the draft:** `GET /api/theming/draft/package` zips the draft as the revision export does (`yazl`, `no-store`, `theming.theme.write`). Import is today's `PUT …/draft/package`. Both appear as buttons on every depth. Font pairs travel as `brand.font_pair` ids, not as files | Scope 4: "Export and import of the whole theme package". Today only a published revision exports |
| D18 | **My presets (Part 4):** table `theming_presets` (`id`, `tenant_id`, `name` ≤ 60, `manifest` jsonb, `created_by`, `created_at`, RLS per event like every table). Its files are kept through `theming_file_refs` with the owner `p:<id>`, so retention and the quota count them. The routes are `POST /api/theming/presets` `{name}` (from the draft), `DELETE /api/theming/presets/{id}` and the gallery's "Your looks" row. `POST /api/theming/clone` also copies the source's presets, under the clone's existing rights. Applying one works as D11, with `preset: {id: "event:<id>"}` | Scope 4: "Save as my preset, so the look is reused for the next event in the series". Clone is the series' existing path between events, so no new cross-event right is needed (Q3) |
| D19 | **Video backgrounds (Part 4):** a new package folder, `videos/`. Accepted are MP4 (`ftyp` box with an `isom`, `mp42` or `avc1` brand) and WebM (EBML header with the `webm` doctype), recognised by content, at most 20 MB each, at most 1 a theme, never transcoded, served like images (`nosniff`, CORP same-origin, `Content-Disposition` inline only for `video/*`). `brand.backdrop.kind: video` with `video` and a required `poster` image. The player plays it muted, looping and without controls under the scrim, and shows the poster at energy level `none` and under reduced motion. The package limits grow to 40 MB unpacked and a 41 MB body (Q5) | Scope 3: "own background images or video". It is a new upload type, so it is high risk and in its own part |
| D20 | **The black logo fixture** is `events/demo/images/logo-black.svg`: a synthetic mark, black on transparent, with no real name. Shots upload it on each preset with no plate, then with the suggested plate | AC 2: "a black transparent logo on a plate in each existing preset" |

## Legacy parity (Scope 5)
No legacy repo had a theme studio. The only appearance editor was the signage ticker's, in `canccusignage` (`src/lib/signage/ticker-appearance.ts`, `src/pages/admin/ops.astro`).

| Legacy | Here |
|---|---|
| Ticker presets: default, high contrast, minimal, broadcast | Schemes per preset (`contrast` kind, D9); the `broadcast` motion pack (existing) |
| Ticker colours: background, text, label, countdown | Colours in Advanced (D14). The ticker draws from `surface`, `text`, `accent` and `primary` |
| Background opacity 0–100 | The stage scrim (computed, contracts/theming.md) and the card veil. **Dropped as a free control**, because the scrim keeps text contrast true |
| Font size ×0.75–2, body and label weights | **Dropped:** the screen's type scale is fixed to keep text readable across a hall (`text_small`). Weights come with the font pair (D6) |
| Scroll speed 10–120 s | Screen's ticker, not the theme (contracts/screen.md). Motion speed is `motion_style.speed` |
| Live preview over a mirror of the screen, before saving | The three-frame live preview (D2, D3) |
| Header and footer on or off, duration bars, ready fallback image | Screen's layouts and zone settings (contracts/screen.md), not the theme |
| Slideshow transitions, pan and zoom | Screen and the motion pack, not the theme |
| Light, dark or auto per visitor (the website) | Schemes (D9). A per-visitor toggle is out of scope |
| Self-hosted OFL fonts | Font pairs (D6) |

Everything else the theming module has today stays: history and restore, git sync, the package upload, embeds, templates, pins and retention.

## Questions for the lead
- **Q1 — Parts.** Should the build be five PRs as above (0 the pack, 1–3 normal, 4 high)? Options: (a) as above; (b) 2 and 3 as one PR of about 5,200 lines, which is over the limit; (c) Part 4 dropped from this issue into a follow-up. **Recommend (a).**
- **Q2 — Where presets live.** Options: (a) `events/demo/themes/`, as the starting points today (D10); (b) a platform folder, `modules/theming/presets/`, with the demo event pointing at it. **Recommend (a) for this issue.** #785, which designs the presets, decides on the move with the Themes step.
- **Q3 — My presets across events.** Options: (a) copied by clone (D18), so the next event of a series has them from its first minute; (b) a series-wide library read across events, which needs a new cross-tenant read and right. **Recommend (a).**
- **Q4 — Font pairs.** The pack shows 14 OFL pairs (heading / body): Chakra Petch / Exo 2, Barlow Semi Condensed / Barlow, Space Grotesk / Inter, Oswald / Source Sans 3, Rajdhani / Nunito Sans, Orbitron / Exo 2, Pixelify Sans / IBM Plex Sans, Bebas Neue / Roboto, Fredoka / Nunito, Saira Condensed / Saira, Russo One / Roboto Condensed, Audiowide / Titillium Web, Josefin Sans / Lato, IBM Plex Mono / IBM Plex Sans. The PO keeps 10–15 when accepting the pack.
- **Q5 — Video limits.** Options: (a) 20 MB a video, one a theme, with the package limits raised to 40 MB unpacked (D19); (b) 50 MB, which needs the zip and quota limits raised further; (c) no video in this issue. **Recommend (a).**

## Review focus
1. **A transparent logo that is mostly transparent** (a thin outline): too few opaque pixels must not count as "shows". Part 1 pins a 1-px ring logo, which counts as not showing on a dark ground.
2. **Two admins in the studio:** a debounced save on a stale `draft_version` gets 409. The page must say so and reload, and must not save over the other admin's change. Part 2 adds a browser test.
3. **Applying a preset to a draft that holds embeds, by a person without the embeds right:** 403 and nothing changes. Part 2 adds a test.
4. **Font pair unknown after an import from a newer platform:** a warning, the system font, and the import is not refused. Part 1 adds a test.
5. **A preview frame that is still loading when a live message arrives:** the frame applies the last state when it is ready, and no change is lost. Part 2 adds a browser test.

---

## Part 0: the pack (branch `pkg-784-pack`)
**Files:**
- Create: `docs/design/theme-studio.md` (the pack text: what each sheet decides, the questions Q4 and the pair list, and an **Every mockup** table of the PNG sheets)
- Create: `docs/design/theme-studio/build.mjs` (writes each sheet as self-contained HTML from the real tokens: packages/ui's `ui.css` and the three presets' `theme.yaml` with the schemes this part proposes; fonts embedded as data URIs; then renders each one with Playwright to `NN-<name>-1280.png` and `-1920.png`)
- Create: `docs/design/theme-studio/NN-*.html` and `NN-*-{1280,1920}.png` (generated; exempt from size as HTML mockups are)
- Modify: `scripts/pack-page.mjs` and `scripts/pack-page.test.mjs` (the Every mockup table may list `.png` as well as `.svg`)

**Sheets:**
1. **Pick a look:** the gallery with the three presets × their 3–5 schemes as thumbnails, the chosen one marked, an empty "Your looks" row, and the preview column. 1280 and 1920 px.
2. **Make it yours:** the black transparent logo with its plate controls and the suggestion ("Your logo is hard to see on this dark background. Put it on a light plate?", one click), colour pickers with logo swatches and matches, the font pairs drawn in their own fonts, roundness chips, background chips, motion chips, the preview column, and Reset to the preset. 1280 and 1920 px.
3. **The plate in every preset:** the black logo with no plate, then with the suggested plate, on the screen header, the hub header, the shell header and the Discord card, for each of the three presets. 1280 px.
4. **Advanced:** the groups (Colours, Type, Shapes and spacing, Screen, Motion, Widget looks, CSS) with pickers, sliders and one tooltip open, the CSS editor with an error marked as you type, and the preview column. 1280 and 1920 px.
5. **Actions and states:** Save as my preset, Export and Import, the Reset confirmation, the dialog for applying a preset over custom CSS, loading, saving and a 409 from another admin. 1280 px.
6. **Phone:** the three depths at 390 px, preview first. 390 px.

- [ ] Step 1: Write the failing test `pack-page lists PNG sheets from Every mockup` in `scripts/pack-page.test.mjs`: a fixture brief whose table links `a.png` and `b.svg` gives two figures, in that order, each with `data-src`. Run `node --test scripts/pack-page.test.mjs` and see it fail.
- [ ] Step 2: Widen the table regex in `sheetsOf` to `\.(svg|png)`. Run the test and see it pass.
- [ ] Step 3: Write `build.mjs` with one function per sheet: `sheet(name: string, width: 1280|1920|390, body: string): string`. Its HTML links nothing outside the file.
- [ ] Step 4: Run `node docs/design/theme-studio/build.mjs`. Every PNG is written. Open each one and check that no text overlaps or is clipped (the mockup rules' render check).
- [ ] Step 5: Run `scripts/pack-page docs/design/theme-studio.md --out $TMPDIR/pack.html`, then the repo checks (`scripts/check-event-names`, `check-naming`, `check-file-size`), then commit `docs(design): theme studio pack for the PO (part 0 of #784)`, push, and open a PR that is ready, with verdict `manual — design pack for the PO`.

## Part 1: the brand model (branch `pkg-784-brand`)
**Files:**
- Modify: `contracts/theme.schema.json` (`brand.logo_plate`, `brand.font_pair`, `brand.roundness`, `brand.backdrop`), `contracts/theming.md` (Brand kit, the custom properties table, the `canccu-stage__backdrop` layer, `logo_unreadable`, the fonts path), `contracts/theming.openapi.yaml` (brand body, `GET /api/theming/font-pairs`, `backdrop` in the current answer), `contracts/screen.md` (the stage's backdrop layer)
- Create: `modules/theming/src/logo-plate.ts`, `src/font-pairs.ts`, `src/colour-match.ts`, `modules/theming/fonts/<pair>/…`
- Modify: `src/brand.ts` (generation from the new fields), `src/brand-routes.ts`, `src/tokens.ts` (plate variables, `@font-face` of the pair), `src/checks.ts` (`logo_unreadable`, unknown pair), `src/brand-images.ts` (plate in `logo_png` and the icons), `src/theme.ts` (`backdrop`), `src/file-routes.ts` (fonts path), `packages/ui/ui.css` (`canccu-header__logo` plate), `modules/screen/player/src/widgets.css` (logo plate), the player's stage (`canccu-stage__backdrop`)
- Test: `test/logo-plate.test.ts`, `test/font-pairs.test.ts`, `test/colour-match.test.ts`, `test/brand.test.ts`, `test/brand-images.test.ts`, the screen player's stage test

**Interfaces:**
- Produces: `plateAdvice(rgba: {data: Uint8Array, width: number, height: number}, grounds: {background: string, surface: string}): {shows: {background: boolean, surface: boolean}, suggest: "light"|"dark"|"surface"|null}`; `logoAdvice(store, sha256: string, colors: Colors): Promise<PlateAdvice>` (cached); `FONT_PAIRS: ReadonlyMap<string, FontPair>` with `FontPair = {id, name, heading: Face, body: Face}`; `logoPalette(rgba): string[]`; `matchesFor(hex: string, background: string): string[]`; `Brand` gains `logo_plate?`, `font_pair?`, `roundness?`, `backdrop?`.

- [ ] Step 1: Write the failing tests:
  - `logo-plate.test.ts`: a black square glyph on transparent has `shows.background === false` on `#0b0d1a`, `suggest === "light"`; the same on a light scheme's background has `shows.background === true`, `suggest === null`; a 98 % opaque logo always shows; a 1-px ring on transparent does not show on a dark ground (Review focus 1); a cache hit does not decode again.
  - `brand.test.ts`: a brand with `roundness: "round"` gives `sizes.radius: "1rem"`; `font_pair: "space-grotesk-inter"` gives the pair's families in `fonts.heading`, `display` and `body`; the default brand still gives the platform defaults exactly.
  - `font-pairs.test.ts`: every pair folder has `pair.json`, `LICENSE.txt` naming the SIL Open Font License, and woff2 files with the `wOF2` magic number; `GET /theming/fonts/<pair>/<file>` answers `font/woff2`, immutable and `nosniff`; a manifest naming an unknown pair gets the warning `reference_unknown` and publishes (Review focus 4).
  - `brand-images.test.ts`: with `logo_plate: {kind: "light", shape: "circle"}`, the 512 PNG's corner pixel is transparent and its centre ring is `#f7f7f8`.
  - `checks`: a draft with the black logo, a dark scheme and no plate lists `logo_unreadable`; with a light plate it does not.
  - Screen player: `backdrop.kind: "image"` draws `canccu-stage__backdrop` under `canccu-stage__scrim`; `game_art` shows the art at `calm`.

  Run `npm test -- logo-plate brand font-pairs brand-images checks` in `modules/theming` (and the player's stage test). They fail.
- [ ] Step 2: Push the tests-first commit `test(theming): the brand model's plate, pairs, roundness and backdrop (part 1 of #784)`.
- [ ] Step 3: Implement against the interfaces above, with the values D4–D8 pin. Add the contract text, schema and OpenAPI in the same commits as the code that uses them.
- [ ] Step 4: Run the module's tests above, `npm run lint && npm run typecheck` in `modules/theming`, `packages/ui` and `modules/screen`, then `scripts/check-contracts` and the repo checks. All pass.
- [ ] Step 5: Commit, push, and open a PR that is ready, `Risk: normal — additive brand fields and contract`.

## Part 2: Pick a look and Make it yours (branch `pkg-784-studio`)
**Files:**
- Modify: `events/demo/themes/*/theme.yaml` (`schemes`, as the accepted pack draws them), `contracts/theme.schema.json` (`schemes`, `preset`), `contracts/theming.md` and `contracts/theming.openapi.yaml` (`GET /api/theming/presets`, `PUT /api/theming/draft/preset`, `GET /api/theming/draft/package`)
- Create: `src/presets.ts` (load, validate and apply), `src/preset-routes.ts`, `src/preset-thumbs.ts`, `src/studio-gallery.ts` (the Pick a look view), `src/studio-yours.ts` (the Make it yours view, out of `studio-views.ts`), `src/studio-column.ts` (the preview column, out of `studio-preview.ts`), `static/studio-live.js` (D3)
- Modify: `src/studio.ts` (routes and tabs), `src/studio-views.ts` and `src/studio-preview.ts` (split to stay under 400 lines), `src/preview.ts` (frames accept `canccu-theme-live`), `static/studio.js` (no reload, debounced saves, 409 handling), `src/revision-routes.ts` (draft export, sharing the zip code), `scripts/demo-screenshots-theming.mjs`
- Test: `test/presets.test.ts`, `test/preset-routes.test.ts`, `test/export.test.ts`, `test/studio.test.ts`, `test/studio-live.browser.test.ts`

**Interfaces:**
- Consumes: Part 1's `Brand` fields, `logoAdvice`, `logoPalette`, `matchesFor`, `FONT_PAIRS`.
- Produces: `PRESETS: ReadonlyMap<string, Preset>` with `Preset = {id, name, dir, manifest, schemes: Scheme[]}` and `Scheme = {id, name, kind, brand, colors?}`; `applyPreset(c, tenant, presetId: string, schemeId: string, opts: {draftVersion?: number, canEmbeds: boolean}): Promise<Draft>`; `presetThumbnail(colors: Colors, opts: {logoUrl?: string, plate?: LogoPlate, headingFamily: string}): string`; `previewColumn(o: {draftVersion: number, zones: Zone[]}): Html`.

- [ ] Step 1: Write the failing tests:
  - `presets.test.ts`: every scheme of every preset has `contrastFailures(colors) == []`; each preset has 3–5 schemes, among them one `dark` and one `light`.
  - `preset-routes.test.ts`:
    - Applying `level-up`/`light` to a draft with the black logo and a light plate keeps `images.logo`, `brand.logo_plate` and `brand.embed_color`, sets `preset`, and takes the scheme's colours.
    - Reset with the draft's own `preset` after a colour change gives the preset's colours back.
    - Applying a preset with embeds without `theming.embeds.write` is 403 and the draft is unchanged (Review focus 3).
    - A stale `draft_version` is 409.
  - `export.test.ts`: a draft with plate, pair, roundness, an image backdrop, `preset` and `schemes` is exported, imported into a second event, and gives an equal manifest and the same file hashes (the AC's round trip).
  - `studio-live.browser.test.ts`:
    - Choosing a scheme in the gallery changes the screen frame's `--canccu-color-background`.
    - The plate suggestion's button sets the plate, and the screen frame's logo shows the plate.
    - A colour change reaches all three frames before the save answers.
    - Two pages on one draft: the second's save gets 409 and the page says so (Review focus 2).
    - A message posted while a frame loads is applied once it is ready (Review focus 5).
    - Publish stays off until the frames answer for the saved version.

  Run them and see them fail.
- [ ] Step 2: Push the tests-first commit.
- [ ] Step 3: Implement D1–D3 and D9–D13 and D17. The gallery and Make it yours follow the accepted sheets 1, 2, 5 and 6.
- [ ] Step 4: Add the shots to `scripts/demo-screenshots-theming.mjs`:
  - `theming-studio-pick-{1280,1920}` and `theming-studio-yours-{1280,1920}`, plus the phone shots `-390`.
  - `theming-<preset>-logo-black-{none,plate}-{screen,hub,admin}` for each of `default`, `terminal` and `level-up` (AC 2).
- [ ] Step 5: Run the module's tests above, lint, typecheck, `scripts/check-contracts`, `scripts/check-theme-refs` and the repo checks. All pass.
- [ ] Step 6: Commit, push, and open a PR that is ready, `Risk: normal`, with the shots next to sheets 1–3.

## Part 3: Advanced (branch `pkg-784-advanced`)
**Files:**
- Modify: `contracts/theming.md` and `contracts/theming.openapi.yaml` (`POST /api/theming/draft/check`; `Problem.line` and `Problem.column`)
- Create: `src/studio-controls.ts` (`ADVANCED_CONTROLS`, D14), `src/check-routes.ts` (D15), `src/studio-widgets.ts` (D16), `static/studio-editor.js`
- Modify: `src/studio-advanced.ts` (the groups and the preview column; the uploads of own fonts and background images, as in today's package section), `src/css.ts` and `src/template.ts` (locations on problems), `scripts/demo-screenshots-theming.mjs`
- Test: `test/check-routes.test.ts`, `test/studio-controls.test.ts`, `test/studio-advanced.browser.test.ts`

**Interfaces:**
- Consumes: Part 2's `previewColumn`, `static/studio-live.js`.
- Produces: `ADVANCED_CONTROLS: readonly Control[]` with `Control = {group, token, label, hint, control, range?: [number, number], step?: number, cssVar: string}`; `checkFile(c, tenant, path: string, text: string): Promise<Problem[]>`.

- [ ] Step 1: Write the failing tests:
  - `studio-controls.test.ts`: every token of `Tokens` (and `motion` and every `motion_style` key) has exactly one control, every control has a non-empty `hint`, and no label is a token key.
  - `check-routes.test.ts`: `@import url(x)` at line 3 answers `css_forbidden` with `line: 3`; a template with `{{{x}}}` answers `template_forbidden` with its line; nothing is stored (the draft's version is unchanged, and so is the quota use); a session without `theming.theme.write` gets 403.
  - `studio-advanced.browser.test.ts`:
    - For **each** entry of `ADVANCED_CONTROLS`, change the control and check that the screen frame's computed `cssVar` changes (the AC's "every advanced control updating the preview").
    - Typing a forbidden `url()` marks its line within 1 s.
    - Choosing a package template for `countdown` changes the screen frame's countdown markup.

  Run them and see them fail.
- [ ] Step 2: Push the tests-first commit.
- [ ] Step 3: Implement D14–D16 as the accepted sheet 4 draws them.
- [ ] Step 4: Add the shots `theming-studio-advanced-{1280,1920,390}` and `theming-studio-advanced-css-error-1280`.
- [ ] Step 5: Run the tests above, lint, typecheck, `scripts/check-contracts` and the repo checks. All pass.
- [ ] Step 6: Commit, push, and open a PR that is ready, `Risk: normal`.

## Part 4: My presets and video (branch `pkg-784-mine`, closes #784)
**Files:**
- Create: `modules/theming/migrations/009_presets.sql` (`theming_presets` with RLS like `theming_drafts`, and its grants to `canccu_theming_app`), `src/my-presets.ts`, `src/video.ts` (sniffing and limits)
- Modify: `contracts/theming.md` and `contracts/theming.openapi.yaml` (`POST`/`DELETE /api/theming/presets…`, "Your looks" in the list, clone copies presets, `videos/`, `backdrop.kind: video`, the package limits of Q5), `contracts/theme.schema.json`, `src/uploads.ts`, `src/zip.ts` and `src/package.ts` (the `videos/` folder and the limits), `src/retention.ts` and `src/stored.ts` (owner `p:<id>`), the clone route, `src/studio-gallery.ts` (Your looks), `src/studio-yours.ts` (the video choice), the screen player's stage (`<video muted loop playsinline>`, the poster at `none` and under reduced motion)
- Test: `test/my-presets.test.ts`, `test/video.test.ts`, the clone test, `test/retention.test.ts`, the player's stage test

- [ ] Step 1: Write the failing tests:
  - `my-presets.test.ts`:
    - Saving the draft as "Spring look" lists it under Your looks.
    - Applying it to a new draft gives the saved manifest with the event's logo kept.
    - Deleting it frees the files that only it held.
    - Event B cannot read or apply event A's preset (RLS, 404).
    - Clone copies the presets, and the copies' files count in B's quota.
  - `video.test.ts`:
    - An MP4 or WebM by content is accepted.
    - A `.mp4` holding HTML is `file_type`.
    - 20 MB + 1 byte is `file_too_large`.
    - A second video is a problem.
    - A video backdrop without a poster is `schema`.
    - The served file has `nosniff` and CORP.
  - Player: at `none` and under reduced motion, the poster shows and no `<video>` plays.

  Run them and see them fail.
- [ ] Step 2: Push the tests-first commit.
- [ ] Step 3: Implement D18 and D19.
- [ ] Step 4: Run the tests above, lint, typecheck, `scripts/check-contracts`, `scripts/check-tenancy` and the repo checks. All pass. Run `/security-review` as the review's part.
- [ ] Step 5: Commit, push, and open a PR that is ready, `Risk: high — new RLS table and a new upload type`, with `Closes #784`.

## Roadmap notes
- #725's Theme studio rows are rebuilt by Parts 2 and 3: the advanced labels, the boxes and the desktop grid. Its hub preview rows are not. The lead may narrow #725 to the hub preview after Part 3 merges.
- The backdrop on hub pages (D8) is left out on purpose. If the PO wants it, it is a later issue.
