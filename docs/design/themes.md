# Themes: the preset pack for the PO (#785, part 0)

## Questions for the PO
- **Q4: the schemes and their names.** Each new preset has five colour schemes (sheet 00). Keep, rename, drop or swap any of them. Each preset must keep 3–5 schemes, with at least one dark and one light. **Recommended: keep all 25 as they are.** Every scheme passes the contrast rules, and the names say the mood without naming anything real.
- **Q5: Cozy LAN and Daylight in the simple mode.** Options: (a) simple: colours, font pair, corners, background and motion style, with no CSS of their own; (b) advanced, with soft shadows and CSS of their own. **Recommended: (a).** An organiser who picks one of them stays in Make it yours and can change everything there. The platform's own backgrounds (particles and glows, gradient and waves) already give them the calm motion they need (sheets 01, 02).

The lead accepted the [plan](../plans/issue-785.md) on 2026-11-27, with Q1–Q3 as recommended. Q1: a parallel track, Themes, for which this plan and this pack stand in for the brief. Q2: three PRs, this pack, then Esports and Arcade, then Synthwave, Cozy LAN and Daylight. Q3: the presets stay in `events/demo/themes/`.

**How the sheets are made.** A script draws them; no sheet is drawn by hand. [`themes/build.mjs`](themes/build.mjs) writes each render as one HTML document, and Chromium renders it. The screens use the stable classes and a stand-in for the screen player's base layer (`style.mjs`). Each screen carries the preset's real colours, its font pair from `modules/theming/fonts/`, and, for the three advanced presets, the look's own CSS (`themes/looks/<id>.css`). That CSS is the first draft of the package CSS that Parts 1 and 2 ship (plan D9). The hub pages use packages/ui's `ui.css` with the same tokens. The build stops if a scheme fails the contrast rules or a preset lacks a dark or a light scheme. Every animation is frozen 1.2 s in, so each render is the same on every run.

## What the PO decides with this pack
1. **Q4 and Q5** above.
2. **The five looks** (sheets 01–05): how each preset feels on the screen (a hero, the everyday rail, an announcement), on a hub page at 1280 px and on a phone at 390 px.
3. **The screen effects** (sheet 06): Esports' sheen, Synthwave's grid and sun, and Arcade's scanlines, vignette and roll band, at the motion levels none, calm and lively.
4. **The gallery's order** (sheet 00), from neutral to bold: Default, Daylight, Cozy LAN, Esports, Level up, Synthwave, Arcade, Terminal.

## The new presets
| Preset | Feel | Mode | Font pair | Corners | Background | Motion style | Effects | Templates |
|---|---|---|---|---|---|---|---|---|
| Daylight | Light and calm: daytime or bright venues | simple | Space Grotesk / Inter | soft | gradient and waves (no glows: they wash out on a light ground) | Standard | none of its own | none |
| Cozy LAN | Warm, soft, rounded: small or family events | simple | Fredoka / Nunito | round | particles and glows | Standard | none of its own | none |
| Esports | Bold, angular, high contrast: broadcast style | advanced | Saira Condensed / Saira | square | gradient and glows | Broadcast | cut-corner slabs, skewed title tabs, a rule under the header; a sheen across the countdown every 12 s at lively and party | scoreboard (the leaderboard), lower third with a Live tab (the ticker) |
| Synthwave | Pink and purple neon, a grid to the horizon: the 80s | advanced | Audiowide / Titillium Web | soft | glows and gradient | Standard | a horizon grid (one cell every 20 s at calm, 8 s at lively, 4 s at party) and a striped sun behind every box; neon edges | none |
| Arcade | Pixel type, CRT glow, chunky colours | advanced | Pixelify Sans / IBM Plex Sans | square | particles and glows | Arcade | scanlines and a CRT vignette behind every box; chunky stepped boxes; a faint roll band every 9 s at lively and party | high-score table (the leaderboard), big digits (the clock) |

## The schemes (Q4)
The first scheme of each preset is its package's own colours. All 25 pass the contrast rules of contracts/theming.md (Brand kit). The hex values are in the [plan](../plans/issue-785.md#the-schemes-d5) and in [`themes/data.mjs`](themes/data.mjs).

| Preset | Schemes (kind) |
|---|---|
| Daylight | Morning (light) · Sand (light) · Mint (light) · Dusk (dark) · High contrast |
| Cozy LAN | Fireside (dark) · Meadow (colour variant) · Linen (light) · Blossom (light) · High contrast |
| Esports | Arena (dark) · Red side (colour variant) · Gold (colour variant) · Studio (light) · High contrast |
| Synthwave | Sunset grid (dark) · Night drive (colour variant) · Afterglow (colour variant) · Vapor (light) · High contrast |
| Arcade | Cabinet (dark) · Player two (colour variant) · Green screen (colour variant) · Handheld (light) · High contrast |

## Every mockup
| Sheet | What it shows |
|---|---|
| [00-overview-1920.png](themes/00-overview-1920.png) | **All eight presets** in the gallery's order. Each card shows what the preset is made of (mode, font pair, corners, background, motion style, templates) and its schemes as small cards on their own ground, in the preset's fonts and corners |
| [01-daylight-hero-1920.png](themes/01-daylight-hero-1920.png) | **Daylight** on a 1920×1080 screen, Morning: the countdown as the hero, the next items and the top three in the rail beside it |
| [01-daylight-rail-1920.png](themes/01-daylight-rail-1920.png) | Daylight, Dusk (its dark scheme): the everyday screen, with now and next, the leaderboard, the countdown and a welcome note |
| [01-daylight-announcement-1920.png](themes/01-daylight-announcement-1920.png) | Daylight, Sand: an announcement over the whole screen at the lively level |
| [01-daylight-hub-1280.png](themes/01-daylight-hub-1280.png) | Daylight, Morning: a hub page at 1280 px, with what is coming up, now and next, the leaderboard, food and announcements |
| [01-daylight-phone-390.png](themes/01-daylight-phone-390.png) | The same hub page on a phone at 390 px |
| [02-cozy-lan-hero-1920.png](themes/02-cozy-lan-hero-1920.png) | **Cozy LAN**, Fireside: the countdown as the hero, round corners, warm particles |
| [02-cozy-lan-rail-1920.png](themes/02-cozy-lan-rail-1920.png) | Cozy LAN, Linen (light): the everyday screen |
| [02-cozy-lan-announcement-1920.png](themes/02-cozy-lan-announcement-1920.png) | Cozy LAN, Meadow: an announcement at the lively level |
| [02-cozy-lan-hub-1280.png](themes/02-cozy-lan-hub-1280.png) | Cozy LAN, Fireside: the hub page at 1280 px |
| [02-cozy-lan-phone-390.png](themes/02-cozy-lan-phone-390.png) | The same on a phone |
| [03-esports-hero-1920.png](themes/03-esports-hero-1920.png) | **Esports**, Arena: slab boxes with cut corners and a primary edge, skewed title tabs, the top three as a scoreboard, the ticker as a lower third with a Live tab |
| [03-esports-rail-1920.png](themes/03-esports-rail-1920.png) | Esports, Studio (light): the everyday screen with the full scoreboard |
| [03-esports-announcement-1920.png](themes/03-esports-announcement-1920.png) | Esports, Red side: an announcement at the lively level |
| [03-esports-hub-1280.png](themes/03-esports-hub-1280.png) | Esports, Arena: the hub page at 1280 px. Square corners and the pair's fonts, with none of the screen's effects |
| [03-esports-phone-390.png](themes/03-esports-phone-390.png) | The same on a phone |
| [04-synthwave-hero-1920.png](themes/04-synthwave-hero-1920.png) | **Synthwave**, Sunset grid: the horizon grid and the striped sun behind the boxes, with neon edges and glowing numbers |
| [04-synthwave-rail-1920.png](themes/04-synthwave-rail-1920.png) | Synthwave, Vapor (light): the everyday screen. The boxes are opaque, so the grid and the sun never stripe the text |
| [04-synthwave-announcement-1920.png](themes/04-synthwave-announcement-1920.png) | Synthwave, Night drive: an announcement at the lively level |
| [04-synthwave-hub-1280.png](themes/04-synthwave-hub-1280.png) | Synthwave, Sunset grid: the hub page at 1280 px |
| [04-synthwave-phone-390.png](themes/04-synthwave-phone-390.png) | The same on a phone |
| [05-arcade-hero-1920.png](themes/05-arcade-hero-1920.png) | **Arcade**, Cabinet: pixel type, chunky stepped boxes, scanlines and a vignette on the background, the top three as a high-score table, big clock digits |
| [05-arcade-rail-1920.png](themes/05-arcade-rail-1920.png) | Arcade, Handheld (light): the everyday screen with the full high-score table |
| [05-arcade-announcement-1920.png](themes/05-arcade-announcement-1920.png) | Arcade, Player two: an announcement at the lively level |
| [05-arcade-hub-1280.png](themes/05-arcade-hub-1280.png) | Arcade, Cabinet: the hub page at 1280 px |
| [05-arcade-phone-390.png](themes/05-arcade-phone-390.png) | The same on a phone |
| [06-effects-1280.png](themes/06-effects-1280.png) | **The effects at each motion level.** Each advanced preset's hero at none, calm and lively, frozen 1.2 s into its motion, with how often each effect moves |

## Rules the sheets keep
- **Readable from the hall.** No screen text is under 27 px at 1080p. The module's own CSS check (`checkCss` and the small-text check) passes on each look's CSS. Its only warnings name the stage's glow layer and the motion-level classes: the contract lists them as stable, but the module's class list does not have them yet. Part 1 adds them (plan, Part 1, Task 1b).
- **Effects stay behind the boxes.** The grid, the sun, the scanlines, the vignette and the roll band hang on the stage's glow layer, never behind text. A light scheme shows that the boxes stay clean (sheets 03–05, rail).
- **Calm motion.** Keyframes move only `transform` and `opacity`. Each animation runs only at a motion level (calm, lively, party), so `none` and reduced motion are still. Nothing repeats faster than once every 4 s.
- **Effects only on the screen.** Hub and phone pages take the colours, the font pair and the corners, and nothing else from a look.
- **No real names.** The event, teams, rooms and texts are the demo event's.

## Rebuild
```sh
node docs/design/themes/build.mjs --check-only   # the schemes against the preset rules
node docs/design/themes/build.mjs                # the HTML, into $TMPDIR/themes-html
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CANCCU_PLAYWRIGHT_DIR=<dir with playwright-core 1.64.1> \
  -v "$PWD:$PWD" -v "$TMPDIR:$TMPDIR" -w "$PWD/docs/design/themes" \
  mcr.microsoft.com/playwright:v1.64.1-noble node build.mjs --render --html "$TMPDIR/themes-html"
```
The documents name the repo's files by absolute path, so build and render in the same checkout. `--render` warns about any element whose text is wider than its box, and about a page wider than its sheet.
