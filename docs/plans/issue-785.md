# Plan: issue #785: the Themes track: design and build the preset themes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task by task in this session (the dispatcher's flow; no subagents), test first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Five new presets in the Theme studio's Pick a look, beside Default, Level up and Terminal: **Esports**, **Synthwave**, **Arcade**, **Cozy LAN** and **Daylight**. Each has 3–5 colour schemes that pass the contrast rules, a font pair, a background, a motion style, screen effects that fit, and widget templates where the look needs them. The PO sees them first in a script-built pack and accepts it before any build.

**Architecture:** A preset is a theme package in `events/demo/themes/<id>/`, read at start by `modules/theming/src/presets.ts` (`PRESET_IDS` gives the gallery's order). The new presets use what #784 built and add no new mechanism: platform font pairs (`brand.font_pair`), `brand.roundness`, `brand.backdrop.looks`, the `motion_style.pack` token (`standard`, `broadcast`, `arcade`) and `schemes`. Effects are the package's own CSS on the stable classes. They are scoped to the screen and animate only `transform` and `opacity`. Two presets stay in the simple mode and hold no CSS at all. No contract field, endpoint, event or migration is added.

**Tech stack:** YAML theme packages, CSS on the stable classes, Mustache templates, TypeScript and vitest (`modules/theming`), `css-tree` (already a dependency), Playwright (CI shots, the pack's renders), `scripts/pack-page`.

**Spec:** [issue #785](https://github.com/Tammilanit/canccuplatform-next/issues/785) (Why, Scope) and the lead's comment of 2026-11-27 ("Design first: the pack (sheets and mockups) goes to the PO before any build"). It builds on [contracts/theming.md](../../contracts/theming.md) (Presets; Brand kit; Motion vocabulary; The two backgrounds; Stable classes), [theme.schema.json](../../contracts/theme.schema.json), the [plan of #784](issue-784.md) (D6–D10, D22, and its Q2, which it leaves to this issue) and the [design guideline](../design/README.md).

**Status:** proposed, waiting for the lead's and the PO's answers to Q1–Q5. Nothing is built.

## Why a plan first
1. **The roadmap.** The issue asks for a Themes step or a parallel track. The lead and the PO set its place (Q1). Part 0 writes the result into `docs/roadmap.md`.
2. **Design first.** The PO accepts a script-built pack (`manual`) before any build. Part 0 is that pack.
3. **Two build packages.** The issue asks for one package per 2–3 presets. Part 1 also fixes how a preset is applied, which Part 2 needs as well.

## Parts, size and risk (source plus tests, estimated)
| Part | What | Lines | Risk |
|---|---|---|---|
| 0. The pack and the track | Script-built sheets for the PO: for each new preset the screen (hero, rail, an announcement), a hub page at 1280 px and the phone at 390 px, plus an overview of all eight presets and an effects sheet. Also the Themes entry in `docs/roadmap.md` (Q1) | 1,000 (script and text; the PNGs are generated) | low, verdict `manual` (the PO accepts) |
| 1. Esports and Arcade | The preset-apply fix (D3), the preset rules test (D10), and the two advanced presets with their CSS, templates and shots | 1,500 | normal |
| 2. Synthwave, Cozy LAN, Daylight | One advanced preset and two simple ones, with their shots; closes #785 | 1,000 | normal |
| **Total** | | **≈ 3,500** | |

**Order:** 0 → 1 → 2. Each part merges before the next starts. Part 1 waits for the PO's accept of the pack, and Part 2 needs Part 1's fix and test.

**PRs:** Parts 0 and 1 start with `Part <n> of #785` and `Refs #785`. Only Part 2 says `Closes #785`. Branches are `pkg-785-pack`, `pkg-785-esports-arcade` and `pkg-785-synth-cozy-day`, not `gh issue develop`, so merging Parts 0 and 1 leaves the issue open. After opening each PR, check that its `closingIssuesReferences` is empty (Parts 0 and 1).

## Global constraints
- **No contract or migration change.** The only contract edit is one clarifying sentence in contracts/theming.md, Presets (D3). It adds nothing and removes nothing. If a preset turns out to need a new token, look or class, stop and write a `Roadmap note:`; do not add it.
- **Contrast:** every scheme passes `contrastFailures` (the existing test in `presets.test.ts` covers new presets automatically). The schemes in D5 were checked against the contract's rules when this plan was written.
- **Each preset has 3–5 schemes, among them one dark and one light** (`presets.test.ts`, existing). Its first scheme is its `tokens.colors`.
- **Effects only on the screen:** every rule in a preset's CSS that does more than colour starts with `.canccu-surface--screen`. Hub, phone, admin and sign-in pages get the colours, the font pair and the roundness only. Text on phones stays plain and readable.
- **Cheap and calm motion** (contracts/theming.md, Motion vocabulary): `@keyframes` change only `transform` and `opacity`. No `filter`, `backdrop-filter` or animated `box-shadow`. Static `text-shadow` and `box-shadow` are allowed. An `animation` is declared only under `.canccu-motion--calm`, `--lively` or `--party`, so the `none` level (and reduced motion, which the player turns into `none`) is still. No animation repeats faster than once a second (the 3-per-second rule, with room).
- **Readable from the hall:** no `text_small` warning. All screen text is 27 px or larger at 1080p.
- **Stable classes only:** CSS and templates use the stable classes and their own `t-<preset>-…` classes. `checkCss` gives no warning.
- **No real names:** no real event, venue, game title or trademark in any preset, scheme, template or sheet. Arcade and Synthwave evoke a period; they copy no game's art, characters or wording.
- **Fonts:** new presets hold no font files. They name a platform font pair (`brand.font_pair`), which already sits with its licence in `modules/theming/fonts/`.
- **Repo checks** before every push: `scripts/check-event-names`, `scripts/check-naming`, `scripts/check-file-size` (each new CSS file stays under 400 lines), `scripts/check-theme-refs` and `scripts/check-contracts`. A change to the screen's look also runs `scripts/shots-local.sh` (AGENTS.md, Run and test).

## Design decisions (the reviewer checks these)
| # | Decision | Reason |
|---|---|---|
| D1 | **The track:** a parallel track **Themes** in `docs/roadmap.md` (milestone "Parallel tracks"), after #784. Its plan is this file, and its research pack is Part 0's pack. It has no separate `docs/briefs/track-themes.md` (Q1) | The PO already chose the directions (the issue's table, 2026-11-23). A full research pack would ask questions that are already answered. The pack is still the PO's gate before any build, as 0026 asks |
| D2 | **Presets stay in `events/demo/themes/`** (#784's Q2, decided here, Q3). New ids: `esports`, `synthwave`, `arcade`, `cozy-lan`, `daylight`. Gallery order (`PRESET_IDS`): `default`, `daylight`, `cozy-lan`, `esports`, `level-up`, `synthwave`, `arcade`, `terminal`: from neutral to bold | Moving the folder touches the Dockerfile, three check scripts, the shots and ten tests, and gives no behaviour. Neutral looks come first because they fit most events |
| D3 | **Applying a preset keeps the package's brand choices.** `presetManifest` today sets `m.brand = {...scheme.brand, ...kept.brand}`, which drops the package's own `font_pair`, `roundness` and `backdrop`. The fix is `m.brand = {...packageBrand, ...scheme.brand, ...kept.brand}`. contracts/theming.md, Presets: "its `brand` is the package's, with the scheme's `primary`, `accent` and `scheme`" | Without it, every new preset loses its fonts, corners and background when it is applied. No existing preset has these fields, so nothing that works today changes |
| D4 | **Simple or advanced.** Esports, Synthwave and Arcade are `mode: advanced` (CSS, and templates for two of them). **Cozy LAN and Daylight are `mode: simple`**: brand, font pair, roundness, backdrop and motion style only, and no CSS | Their feel comes from colour, type, corners and a calm background, which the simple mode already draws. An organiser who picks them stays in Make it yours. That is the path the issue's "organisers who stick with presets" need |
| D5 | **The schemes** (below), each with all eleven colour tokens in `colors`. All 25 pass the contract's contrast rules. The PO may rename or drop schemes in the pack (Q4) | Scope: "3–5 colour schemes … contrast rules pass in every scheme". Hand-tuned colours keep each preset's character; generated ones drift towards the same look |
| D6 | **Per preset** (below): the font pair, roundness, the backdrop looks, the motion pack, the effects and the templates | Scope: "a font pair, a background, a motion style and screen effects that fit, and widget templates where the look needs them" |
| D7 | **Layouts:** each new preset holds the Default preset's `main` (16:9) and `portrait` (9:16) layouts. Advanced presets put their templates on those layouts' widgets. Each preset holds a copy of the Default preset's demo logo, `images/logo.svg`, as the three existing presets do | One proven layout set keeps the presets comparable and the shots stable. A fresh event shows a logo in every preset. Applying a preset keeps the event's own logo anyway (#784 D11) |
| D8 | **Effects hang on classes that exist today:** `canccu-surface--screen`, `canccu-stage` and its `::before`/`::after`, `canccu-stage__glow`, `canccu-widget`, `__title`, `canccu-motion--*` and `canccu-motion-pack--*`. They do not use the stage's `__look` layer, which #787 Part C has not built yet | The presets do not wait for #787. When `__look` lands, they still work: an effect sits over whatever look the cycle shows |
| D9 | **The pack draws with the presets' real CSS.** Part 0 writes each advanced preset's CSS against the stable classes and keeps it in the pack's folder (`docs/design/themes/looks/<id>.css`). The sheets are static HTML in the screen's and the hub's class markup, on packages/ui's `ui.css`, with the font pairs from `modules/theming/fonts/` (local files, no download). Parts 1 and 2 move that CSS into the packages and adapt it | What the PO accepts is what ships. Local font files make the build offline and exact |
| D10 | **One test pins the preset rules** for every preset, old and new: `modules/theming/test/preset-packages.test.ts` (see Part 1, Task 2) | The constraints above become checks. A later preset cannot break them without a red test |

### The schemes (D5)
Colours in token order: `background`, `surface`, `border`, `text`, `text_muted`, `primary`, `primary_text`, `accent`, `status_ok`, `status_degraded`, `status_down`. The first scheme of each preset is its `tokens.colors`.

| Preset | Scheme `id` (name, kind) | Colours |
|---|---|---|
| Esports | `arena` (Arena, dark) | `#0a0e17 #131a2a #2c3a57 #f4f7ff #a9b6d3 #00e0ff #0a0e17 #ff3b5c #3ee39a #ffd23f #ff5a6e` |
| | `red-side` (Red side, accent) | as Arena, with `primary #ff3b5c` and `accent #00e0ff` |
| | `gold` (Gold, accent) | `#0b0c10 #17181f #3a3b48 #f7f5ee #b9b6a8 #ffc400 #0b0c10 #5cc8ff #3ee39a #ffd23f #ff5a6e` |
| | `studio` (Studio, light) | `#eef1f6 #ffffff #c3cad8 #0d1220 #465068 #0050c8 #ffffff #c8102e #157a46 #8a6100 #c62828` |
| | `contrast` (High contrast, contrast) | `#000000 #0d0d0d #ffffff #ffffff #e6e6e6 #00e5ff #000000 #ffd400 #3ee39a #ffd400 #ff6b6b` |
| Synthwave | `sunset` (Sunset grid, dark) | `#120724 #1f0d3a #4a2a7a #fbefff #c9b3e6 #ff4fd8 #120724 #22e4ff #4cf2a7 #ffd166 #ff5c8a` |
| | `miami` (Night drive, accent) | `#081226 #0f1f3d #2b4a7a #eef6ff #a9c1e0 #22e4ff #081226 #ff4fd8 #4cf2a7 #ffd166 #ff5c8a` |
| | `outrun` (Afterglow, accent) | `#170612 #2a0b22 #5c2550 #fff0f6 #e0b0c8 #ff7a3c #170612 #ff4fd8 #4cf2a7 #ffd166 #ff6b8b` |
| | `vapor` (Vapor, light) | `#fbf2ff #ffffff #dcc2f0 #2a0e45 #5e3f80 #b0189a #ffffff #0077a8 #137a4a #8a6100 #c2185b` |
| | `contrast` (High contrast, contrast) | `#000000 #0e0618 #ff9ff0 #ffffff #f0e0ff #ff6fe0 #000000 #3ff0ff #4cf2a7 #ffd166 #ff7a9c` |
| Arcade | `cabinet` (Cabinet, dark) | `#0b0b1a #16163a #3a3a8a #ffffff #c4c4f0 #ffd400 #0b0b1a #ff3df0 #38f27a #ffd400 #ff4d4d` |
| | `player-two` (Player two, accent) | as Cabinet, with `primary #3df0ff` and `accent #ff9a1f` |
| | `green-screen` (Green screen, accent) | `#060c06 #0d1a0d #2f5a2f #e8ffe8 #9fd49f #7dff6a #060c06 #ffd400 #7dff6a #ffd400 #ff5c5c` |
| | `handheld` (Handheld, light) | `#e8f0d0 #f6fae8 #a8b880 #1f2a10 #4a5a2a #3b5c00 #ffffff #8a1f5c #2e6a10 #7a5a00 #b3261e` |
| | `contrast` (High contrast, contrast) | `#000000 #000000 #ffffff #ffffff #ffffff #ffff00 #000000 #00ffff #00ff66 #ffff00 #ff5555` |
| Cozy LAN | `fireside` (Fireside, dark) | `#1d1612 #2a201a #5a4636 #fff4e8 #d8c2ac #f0a35e #1d1612 #8fc7a0 #86d6a0 #f2c94c #ff7a6b` |
| | `meadow` (Meadow, accent) | `#121a15 #1c2720 #3e5646 #f0f8f0 #b8ccbc #8fd19e #121a15 #f0a35e #86d6a0 #f2c94c #ff7a6b` |
| | `linen` (Linen, light) | `#faf4ec #fffdf9 #e3d4c0 #3a2a1e #6b5444 #a24f12 #ffffff #2f6b4a #2f6b4a #7a5600 #b3261e` |
| | `blossom` (Blossom, light) | `#fbf1f2 #fffafa #ecc9cf #3b2228 #6e4a52 #b03a5b #ffffff #2f6b6b #2f6b4a #7a5600 #b3261e` |
| | `contrast` (High contrast, contrast) | `#000000 #14100c #ffd9b0 #ffffff #f3e6d8 #ffb36b #000000 #9fe0b4 #86d6a0 #f2c94c #ff8a7a` |
| Daylight | `morning` (Morning, light) | `#f6f8fb #ffffff #cfd6e2 #111827 #4b5563 #0b63ce #ffffff #b4235a #1a7f4b #8a6100 #c2283d` |
| | `sand` (Sand, light) | `#faf6ef #ffffff #e2d6c2 #1f1a12 #5a4e3c #9a4a00 #ffffff #00707a #1a7f4b #8a6100 #c2283d` |
| | `mint` (Mint, light) | `#f2faf6 #ffffff #c4ded1 #0f1f18 #435a50 #00745a #ffffff #6a3fc8 #1a7f4b #8a6100 #c2283d` |
| | `dusk` (Dusk, dark) | `#141821 #1d2330 #3a4458 #f3f5fa #b0b8c8 #6fb0ff #141821 #ff8fb1 #4ee39a #ffd25e #ff6b6b` |
| | `contrast` (High contrast, contrast) | `#ffffff #ffffff #000000 #000000 #1a1a1a #0040a0 #ffffff #a0003a #006b2e #6b4a00 #a00018` |

Each scheme's `brand` is `{primary, accent, scheme}` from its colours: `scheme` is `light` when `background` is the lighter of `background` and `text`, and `dark` otherwise.

### The looks (D6)
| Preset | Mode | Font pair | Roundness | Backdrop `looks` | Motion pack | Screen effects (CSS) | Templates |
|---|---|---|---|---|---|---|---|
| Esports | advanced | `saira` (Saira Condensed / Saira) | `square` | `gradient`, `glows` | `broadcast` | Titles as skewed tabs (static `skewX(-12deg)` on `__title`); cut corners on boxes (static `clip-path` polygon, 12 px); a thin `primary` rule under the header; at lively and party, a light sheen crosses the hero once every 12 s (`translateX` of a `::after` gradient, opacity ≤ 0.18) | `leaderboard` as a scoreboard (rank chip, name, points, rows on alternating `surface` shades); `ticker` as a lower third with a "Live" tab |
| Synthwave | advanced | `audiowide-titillium` (Audiowide / Titillium Web) | `soft` | `glows`, `gradient` | `standard` | A horizon grid on the stage (`.canccu-stage::before`, a `repeating-linear-gradient` in `accent`, tilted with `perspective` and `rotateX`; it scrolls by `translateY` once every 20 s at calm, 8 s at lively and 4 s at party); a striped sun behind it (`.canccu-stage::after`, static); neon edges on boxes (static `box-shadow` in `primary`) | none |
| Arcade | advanced | `pixelify-plex` (Pixelify Sans / IBM Plex Sans) | `square` | `particles`, `glows` | `arcade` | Scanlines over the stage (a static `repeating-linear-gradient`, 4 px period, opacity 0.08, `pointer-events: none`); a CRT vignette (a static radial gradient); chunky 4 px borders with stepped corners (static `box-shadow` steps); at lively and party, a soft roll band moves down the stage once every 9 s (`translateY`, opacity ≤ 0.06) | `leaderboard` as a high-score table (`1ST`, `2ND`, …, dotted leaders); `clock` with big digits |
| Cozy LAN | simple | `fredoka-nunito` (Fredoka / Nunito) | `round` | `particles`, `glows` | `standard` | none of its own: the warm particles and glows of the platform's looks | none |
| Daylight | simple | `space-inter` (Space Grotesk / Inter) | `soft` | `gradient`, `waves` | `standard` | none of its own; `glows` is left out, because glows wash out on a light ground | none |

`brand.backdrop` keeps `game_art`, `daylight` and `hype` at their defaults (all `true`). `tokens.motion_style` sets only `pack`, because #784 D22 dropped Speed and Strength.

## Questions for the lead and the PO
- **Q1 — Where on the roadmap.** Options: (a) a parallel track **Themes**, with this plan and Part 0's pack standing in for the track's brief (D1); (b) a parallel track with its own research pack and plan per 0026, which comes before any of this; (c) a numbered step on the main line after step 8. **Recommend (a).** The issue already fixes the directions, and #784's tooling (gallery, schemes, font pairs) is merged, so nothing waits.
- **Q2 — Parts.** Options: (a) three PRs as above (0 the pack, 1 Esports and Arcade, 2 Synthwave, Cozy LAN and Daylight); (b) one build PR for all five presets, about 2,500 lines, after the pack. **Recommend (a)**, as the issue says "one package per 2–3 presets". Each PR also stays small enough to review its shots well.
- **Q3 — Where presets live** (#784's Q2). Options: (a) stay in `events/demo/themes/` (D2); (b) move all eight to `modules/theming/presets/` in Part 1. **Recommend (a).** A move is a cleanup with no visible gain. If wanted, it is a later health-pass item.
- **Q4 — The schemes and names (for the PO, in the pack).** The PO may rename, drop or swap schemes. Each preset must keep 3–5 schemes, with one dark and one light. **Recommend D5 as it is.**
- **Q5 — Cozy LAN and Daylight in the simple mode** (D4). Options: (a) simple, with no CSS; (b) advanced, with soft shadows and their own CSS. **Recommend (a).** It keeps the organisers who stick with presets in Make it yours, and the platform's looks already give the calm motion these two need.

## Review focus
1. **Applying a scheme of a new preset keeps its font pair, corners and background** (D3). Part 1, Task 1 pins it for `esports` and for a simple preset (`cozy-lan` in Part 2).
2. **A preset applied over a draft with the event's logo and plate:** the logo and plate stay, and the preset's demo logo does not replace them. This is covered by #784's tests. Part 1 adds `esports` to the existing apply test's preset list.
3. **The `none` motion level and reduced motion:** the grid, sheen and roll band stand still. The rule test (Task 2) pins that every `animation` sits under a level class. The screen shots at `none` show a still frame.
4. **Light schemes with effects:** Esports · Studio, Synthwave · Vapor and Arcade · Handheld must keep text on boxes readable. The effects sit under the boxes' `surface` and never under text directly. The shots include each light scheme on the screen.
5. **A 4K or portrait screen:** the grid, scanlines and vignette scale with the stage, not in fixed pixels, apart from the scanline period. The screen shots take each advanced preset at 1080p and portrait.

---

## Part 0: the pack and the track (branch `pkg-785-pack`)
**Files:**
- Create: `docs/design/themes.md` (the pack text: what the PO decides, the schemes table, the looks table, the **Every mockup** table)
- Create: `docs/design/themes/build.mjs`, `data.mjs`, `sheets.mjs`, `style.mjs` (each under 400 lines), and `looks/esports.css`, `looks/synthwave.css`, `looks/arcade.css`
- Create: `docs/design/themes/*.png` (renders)
- Modify: `docs/roadmap.md` (the track per Q1, the Order section's list of tracks, a Change log line)

**Interfaces:**
- Produces: `docs/design/themes/looks/<id>.css`, the first draft of each advanced preset's package CSS (D9). `data.mjs` exports `PRESETS`, which holds the D5 schemes and the D6 looks. Parts 1 and 2 copy the colours from it.

- [ ] **Step 1:** Write `data.mjs` with all eight presets: the three existing ones from their `theme.yaml`, as #784's `data.mjs` reads them, and the five new ones from D5 and D6. Add a contrast check that throws on a failing scheme, using the rules of contracts/theming.md, Brand kit, as `docs/design/theme-studio/data.mjs` does.
- [ ] **Step 2:** Run `node docs/design/themes/build.mjs --check-only`. Expected: "25 new schemes pass". Then change one colour to fail and confirm that the build stops and names the scheme and the pair. Revert the change.
- [ ] **Step 3:** Write `looks/<id>.css` for Esports, Synthwave and Arcade under the Global constraints (screen-scoped, `transform`/`opacity` keyframes, animations only under the level classes). Run `checkCss` on each from a scratch vitest file in `modules/theming/test/` (not committed). Expected: `ok: true`, no warnings.
- [ ] **Step 4:** Write `sheets.mjs` and `build.mjs`. Each sheet is HTML on `packages/ui/ui.css` in the screen's and the hub's stable-class markup, with `@font-face` rules from `modules/theming/fonts/<pair>/`. Render with `--render` in `mcr.microsoft.com/playwright:v1.64.1-noble`, as `docs/design/theme-studio/build.mjs` does. The sheets:
  - `00-overview-1920.png`: all eight presets in the gallery order, each with its schemes as small screens.
  - `NN-<id>-screen-1920.png` for each new preset: three 1920×1080 frames stacked (a hero, the same hero stepped down to a rail, and an announcement at the lively level).
  - `NN-<id>-hub-1280.png` and `NN-<id>-phone-390.png` for each new preset: a hub page (now/next and the leaderboard) in the first scheme, and the same on the phone in the light scheme.
  - `07-effects-1280.png`: each advanced preset's effects at none, calm and lively as three frames, with the period in words.
- [ ] **Step 5:** Check every PNG at full size for clipped text, overlap and pages wider than their sheet. Fix any defects before commit.
- [ ] **Step 6:** Write `docs/design/themes.md`: what the PO decides (Q4, Q5 and the looks), the tables, and the Every mockup table with a caption for each render. Run `scripts/pack-page docs/design/themes.md --out $TMPDIR/themes.html`, then `scripts/pack-page --check HEAD`. Expected: all sheets match.
- [ ] **Step 7:** Edit `docs/roadmap.md` as Q1 decides. With (a), add a `### Themes` section under Parallel tracks (Goal, In it, Builds on #784, Exit criteria: "the eight presets are in Pick a look, each scheme passes the contrast rules, and the shots show each new preset on the screen, the hub and the phone", Issues: #785), name it in the Order section's list of tracks, and add a Change log line `- 2026-11-<dd>: the Themes track … (#785)`.
- [ ] **Step 8:** Run the repo checks. Commit `docs(design): themes track: the preset pack for the PO, part 0 of #785`, push, and open the PR with `Part 0 of #785` / `Refs #785`, `Risk: low`, verdict expected `manual — design pack for the PO`.

## Part 1: Esports and Arcade (branch `pkg-785-esports-arcade`)

### Task 1: Applying a preset keeps its brand choices (D3)
**Files:**
- Modify: `modules/theming/src/presets.ts:87-96` (`presetManifest`)
- Modify: `contracts/theming.md` (Presets, the `PUT /api/theming/draft/preset` sentence)
- Test: `modules/theming/test/presets.test.ts`

**Interfaces:**
- Produces: `presetManifest(preset, scheme, kept)`. Its signature is unchanged, but its `brand` is now `{...packageBrand, ...scheme.brand, ...kept.brand}`.

- [ ] **Step 1: Write the failing test** `it("keep the package's font pair, roundness and backdrop under any scheme")`. Build a `Preset` from the `level-up` manifest with `brand: {font_pair: "saira", roundness: "square", backdrop: {looks: ["gradient"]}}` added. Call `presetManifest(preset, preset.schemes[1], {images: {}, brand: {logo_plate: {kind: "light", shape: "rounded", padding: "medium"}}})`. Expect `m.brand` toEqual `{font_pair: "saira", roundness: "square", backdrop: {looks: ["gradient"]}, primary: "#ff6fae", accent: "#ffb347", scheme: "dark", logo_plate: {kind: "light", shape: "rounded", padding: "medium"}}`.
- [ ] **Step 2:** Run `cd modules/theming && npx vitest run test/presets.test.ts`. Expected: FAIL (no `font_pair`).
- [ ] **Step 3:** Change the `brand` line in `presetManifest`. Change the contract sentence to "its `brand` is the package's, with the scheme's `primary`, `accent` and `scheme`".
- [ ] **Step 4:** Run the same test. Expected: PASS. Also run `test/preset-routes.test.ts` and `test/my-presets.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(theming): applying a preset keeps its own font pair, corners and background`.

### Task 2: The preset rules test (D10)
**Files:**
- Create: `modules/theming/test/preset-packages.test.ts`

**Interfaces:**
- Consumes: `PRESETS` (`src/presets.ts`), `checkCss` (`src/css.ts`), `fontSizes` and `textSmallProblems` (`src/readability.ts`), `FONT_PAIRS` (`src/font-pairs.ts`), `css-tree`'s `parse` and `walk`.

- [ ] **Step 1: Write the tests.** One `describe("every preset")` with five `it`s, each looping over `PRESETS.values()` with the preset id as the message:
  - `"names a font pair the platform holds, or holds its own fonts"`: `brand.font_pair` is a key of `FONT_PAIRS`, or the manifest has `fonts`.
  - `"has CSS that passes the checks with no warning"`: `checkCss(path, bytes)` matches `{ok: true, warnings: []}` for each `css` entry.
  - `"has no screen text under 27 px at 1080p"`: `textSmallProblems` over the preset's CSS files is `[]`.
  - `"animates only transform and opacity"`: every declaration inside every `@keyframes` has a property in `["transform", "opacity", "offset"]`.
  - `"moves only at a motion level, and never faster than once a second"`: every rule that declares `animation` or `animation-name` has a selector containing `.canccu-motion--calm`, `--lively` or `--party`, and each `animation` duration is 1 s or longer.
- [ ] **Step 2:** Run `npx vitest run test/preset-packages.test.ts`. Expected: it passes on the three existing presets, or it fails on a rule that an existing preset breaks. In that case, read the failure. If the existing CSS is right and the rule is too strict (for example a `steps()` reveal), narrow the rule and write down why. Do not change an existing preset's look in this package.
- [ ] **Step 3:** Commit `test(theming): the rules every preset keeps`.

### Task 3: Esports
**Files:**
- Create: `events/demo/themes/esports/theme.yaml`, `css/esports.css` (from `docs/design/themes/looks/esports.css`), `templates/scoreboard.mustache`, `templates/lower-third.mustache`, `images/logo.svg` (a copy of Default's)
- Modify: `modules/theming/src/presets.ts` (`PRESET_IDS`: add `esports`, in the D2 order of the ids that exist so far)
- Modify: `modules/theming/test/presets.test.ts` (the gallery's order, and `esports` in the apply case of Review focus 2)
- Modify: `modules/screen/test/stack/screen-views.mjs` (`THEMES`), `scripts/demo-screenshots-theming.mjs` (a `PRESET_LOOKS` list, see Step 4)

- [ ] **Step 1: Write the failing test:** in `presets.test.ts`, the gallery order is `["default", "esports", "level-up", "terminal"]`, and `PRESETS.get("esports")` has the scheme ids `["arena", "red-side", "gold", "studio", "contrast"]` and `brand.font_pair` `"saira"`. Run it. Expected: FAIL.
- [ ] **Step 2:** Write the package per D5, D6 and D7. The first scheme is `tokens.colors`. `tokens.motion_style: {pack: broadcast}`. `brand: {primary, accent, scheme, font_pair: saira, roundness: square, backdrop: {looks: [gradient, glows]}}`. Put the templates on the layouts' `leaderboard` and `ticker` widgets.
- [ ] **Step 3:** Run `npx vitest run test/presets.test.ts test/preset-packages.test.ts`, then `scripts/check-theme-refs`. Expected: PASS and ok.
- [ ] **Step 4:** Shots. Add `esports` to `THEMES` (HD sizes and portrait, as `terminal`). Add `PRESET_LOOKS` in `demo-screenshots-theming.mjs`: for each new preset, `theming-preset-<id>-hub` at `PHONE` and at `DESK`, and `theming-preset-<id>-screen-<scheme>` at `HD` for the first scheme and the light scheme, after `PUT /api/theming/draft/preset`. Add the names to the dry-run listing. Run `scripts/shots-local.sh screen theming`. Expected: no failing checks. Look at each PNG beside its pack sheet.
- [ ] **Step 5:** Commit `feat(theming): the Esports preset`.

### Task 4: Arcade
Same as Task 3, with the files under `events/demo/themes/arcade/` (`css/arcade.css`, `templates/hiscore.mustache`, `templates/clock.mustache`). The scheme ids are `["cabinet", "player-two", "green-screen", "handheld", "contrast"]`, the pair is `pixelify-plex`, `pack: arcade`, `roundness: square` and the looks are `[particles, glows]`. The gallery order becomes `["default", "esports", "level-up", "arcade", "terminal"]`. Commit `feat(theming): the Arcade preset`.

### Task 5: Finish Part 1
- [ ] Run `cd modules/theming && npm run lint && npm run typecheck && npx vitest run test/presets.test.ts test/preset-packages.test.ts test/preset-routes.test.ts`, then `scripts/shots-local.sh screen theming`. Run the repo checks.
- [ ] Open the PR: `Part 1 of #785`, `Refs #785`, `Risk: normal — theming content and one internal fix; the contract gets one clarifying sentence`, screenshots beside the pack's sheets.

## Part 2: Synthwave, Cozy LAN, Daylight (branch `pkg-785-synth-cozy-day`, closes #785)

### Task 1: Synthwave
As Part 1, Task 3: `events/demo/themes/synthwave/` with `css/synthwave.css`, no templates, scheme ids `["sunset", "miami", "outrun", "vapor", "contrast"]`, pair `audiowide-titillium`, `pack: standard`, `roundness: soft`, looks `[glows, gradient]`. Commit `feat(theming): the Synthwave preset`.

### Task 2: Cozy LAN and Daylight (simple)
**Files:**
- Create: `events/demo/themes/cozy-lan/theme.yaml`, `events/demo/themes/daylight/theme.yaml`, each with `images/logo.svg`
- Modify: `PRESET_IDS` (the full D2 order), `presets.test.ts`, `screen-views.mjs`, `demo-screenshots-theming.mjs`

- [ ] **Step 1: Write the failing tests** in `presets.test.ts`:
  - The gallery order is the full D2 list.
  - `cozy-lan` and `daylight` have `manifest.mode` `"simple"`, no `css`, `fonts`, `templates` or `embeds`, and the scheme ids `["fireside", "meadow", "linen", "blossom", "contrast"]` and `["morning", "sand", "mint", "dusk", "contrast"]`.
  - Review focus 1: `presetManifest(PRESETS.get("cozy-lan")!, scheme "linen", empty kept).brand` has `font_pair: "fredoka-nunito"`, `roundness: "round"`, `backdrop: {looks: ["particles", "glows"]}` and `scheme: "light"`.
  - Run them. Expected: FAIL.
- [ ] **Step 2:** Write both packages per D5–D7, `mode: simple`, with the layouts of Default and no templates.
- [ ] **Step 3:** Run `npx vitest run test/presets.test.ts test/preset-packages.test.ts` and `scripts/check-theme-refs`. Expected: PASS and ok. Add the shots as in Part 1, Task 3, Step 4. Run `scripts/shots-local.sh screen theming`. Expected: no failing checks.
- [ ] **Step 4:** Commit `feat(theming): the Cozy LAN and Daylight presets`.

### Task 3: Finish
- [ ] Update `docs/design/themes.md`'s status line (built) and `modules/theming/README.md` if it lists the presets. Run the module checks and the repo checks.
- [ ] Re-read #785's Scope against the work: the track on the roadmap (Part 0), 3–5 schemes, a font pair, a background, a motion style and effects per preset, contrast in every scheme, the pack first. Open the PR with `Closes #785`.

---

## Roadmap notes
- A theme-brought background look (for example Synthwave's grid as a look in the cycle, not a layer over it) would need the `looks` enum to grow, which is an additive schema change. #787 Part C may want it. This plan does not add it (D8).
- Moving the presets out of `events/demo/` (Q3, option b) could be a health-pass item.
