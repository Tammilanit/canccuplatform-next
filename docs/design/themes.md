# Themes: the preset pack for the PO (#785, part 0)

**Status:** built. Part 1 shipped Esports and Arcade with the box transparency (D11); Part 2 ships Synthwave, Cozy LAN and Daylight with the `pill` corners and the `hearth` and `sky` looks (D12). The eight presets are in Pick a look.

## The PO's decisions of 2026-11-27, and what this revision does with them
- **Q4: keep all 25 schemes as they are.** Done: no scheme changed.
- **Q5: (a).** Cozy LAN and Daylight stay simple, with no CSS of their own, and each now has a clear signature through the platform: Cozy LAN very round corners (a new roundness, `pill`) and a warm hearth glow (a new background look); Daylight a sky gradient with a soft sun (a new background look). Plan D12.
- **D11, box transparency for every preset.** The boxes let the background show through a little, and the organiser can set them fully opaque. Each preset has its own default (Esports 88 %, Synthwave 80 %, Cozy LAN and Daylight 90 %, **Arcade 100 %**). The build checks the text colours against the box composited on the background, the primary and the accent, so contrast holds at the worst point, and it stops if a scheme fails. No `backdrop-filter`. Plan D11 puts the contract change in Part 1.
- **Synthwave.** The slashed zero stays. The sun is on the horizon, in a band the layout leaves free and through the boxes. The grid moves all the time, faster at lively and party (plan D13).
- **Arcade.** The pixel face changed (sheet 07 compares three and recommends one); the type is one family on the whole screen, with a readable face for lines of text; the scanlines and the CRT vignette now sit over the screen and show; the boxes are fully opaque (plan D14).
- **From the lead's notes:** a demo logo per preset, the living screen's layout (#787), #780's announcement, the real hub layout at 1280 px, and an effects sheet with clips (plan D15).

The lead accepted the [plan](../plans/issue-785.md) on 2026-11-27, with Q1–Q3 as recommended. Q1: a parallel track, Themes, for which this plan and this pack stand in for the brief. Q2: three PRs, this pack, then Esports and Arcade, then Synthwave, Cozy LAN and Daylight. Q3: the presets stay in `events/demo/themes/`.

**How the sheets are made.** A script draws them; no sheet is drawn by hand. [`themes/build.mjs`](themes/build.mjs) writes each render as one HTML document, and Chromium renders it. The screens use the stable classes and a stand-in for the screen player's base layer and the living screen's boxes (`style.mjs`). Each screen carries the preset's real colours, its font pair (the platform's from `modules/theming/fonts/`, or Arcade's new pair from `themes/fonts/`), and, for the three advanced presets, the look's own CSS (`themes/looks/<id>.css`). That CSS is the first draft of the package CSS that Parts 1 and 2 ship (plan D9). The hub pages use packages/ui's `ui.css` with the same tokens. The build stops if a scheme fails the contrast rules or a preset lacks a dark or a light scheme. Every animation is frozen 1.2 s in (the effects sheet freezes each look inside its own motion), so each render is the same on every run; the clips set each frame's moment with the Web Animations API, so they are the same too.

## What the PO decides with this pack
1. **The revised looks** (sheets 01–05): each preset on the living screen (the rotation hero, the coming hours, a full rail), in its announcement, on a hub page at 1280 px and on a phone at 390 px, each with its own logo.
2. **The signatures** of the two simple presets (sheets 01 and 02): Daylight's sky and sun, Cozy LAN's round corners and hearth glow. Plan D12 lists what the platform gains for them.
3. **Synthwave** (sheet 04): the sun, the horizon band and the layout that leaves it room (plan D13).
4. **Arcade's type** (sheet 07): Press Start 2P for titles, digits and ranks, and Jersey 10 for text.
5. **The effects** (sheet 06 and the clips): at none, calm, lively and party.
6. **The gallery's order** (sheet 00), from neutral to bold: Default, Daylight, Cozy LAN, Esports, Level up, Synthwave, Arcade, Terminal.

## The new presets
| Preset | Feel | Mode | Font pair | Corners | Background | Motion style | Effects | Templates |
|---|---|---|---|---|---|---|---|---|
| Daylight | Light and calm: daytime or bright venues | simple | Space Grotesk / Inter | soft | **sky** (new: a sky gradient and a soft sun) and waves (no glows: they wash out on a light ground) | Standard | none of its own: the sky is its signature | none |
| Cozy LAN | Warm, soft, rounded: small or family events | simple | Fredoka / Nunito | **pill** (new: very round) | **hearth** (new: a warm glow from below) and particles | Standard | none of its own: the corners and the glow are its signature | none |
| Esports | Bold, angular, high contrast: broadcast style | advanced | Saira Condensed / Saira | square | gradient and glows | Broadcast | cut-corner slabs, skewed title tabs, a rule under the header; the announcement keeps the slab with a slanted tab and an accent rule; a sheen across the countdown every 12 s at lively, 7 s at party | scoreboard (the leaderboard), lower third with a Live tab (the ticker) |
| Synthwave | Pink and purple neon, a grid to the horizon: the 80s | advanced | Audiowide / Titillium Web | soft | glows and gradient | Standard | a striped sun on the horizon, in a free horizon band and through the boxes; a horizon grid that moves all the time (one cell every 8 s at calm, 3.5 s at lively, 1.6 s at party); neon edges; its own layout with the band | none |
| Arcade | Pixel type, CRT glow, chunky colours | advanced | **Press Start 2P / Jersey 10** (new pair) | square | particles and glows | Arcade | scanlines and a CRT vignette over the whole screen; chunky stepped boxes, fully opaque; a faint roll band every 9 s at lively, 6 s at party | high-score table (the leaderboard), big digits (the clock) |

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
| [00-overview-1920.png](themes/00-overview-1920.png) | **All eight presets** in the gallery's order. Each card shows what the preset is made of (mode, font pair, corners, box opacity, background, motion style, templates) and its schemes as small cards on their own ground, in the preset's fonts and corners |
| [01-daylight-hero-1920.png](themes/01-daylight-hero-1920.png) | **Daylight**, Morning: the rotation's now-and-next hero with its countdown, the run of show, food and Wi-Fi in the rail; the demo logo in the header; the sky gradient and the soft sun, boxes at 90 % over them |
| [01-daylight-rail-1920.png](themes/01-daylight-rail-1920.png) | Daylight, Dusk (its dark scheme): the coming hours timeline, standings and food in a full rail |
| [01-daylight-announcement-1920.png](themes/01-daylight-announcement-1920.png) | Daylight, Sand: an announcement over the screen (#780) at the lively level: the glow, the badge and the headline, with the details beside it |
| [01-daylight-hub-1280.png](themes/01-daylight-hub-1280.png) | Daylight, Morning: the hub page at 1280 px, laid out for the width (the hero and food, then three cards). The colours, fonts and corners, and none of the screen’s effects |
| [01-daylight-phone-390.png](themes/01-daylight-phone-390.png) | The same hub page on a phone, in one column |
| [02-cozy-lan-hero-1920.png](themes/02-cozy-lan-hero-1920.png) | **Cozy LAN**, Fireside: the rotation's now-and-next hero with its countdown, the run of show, food and Wi-Fi in the rail; the demo logo in the header; round corners and the warm hearth glow below the boxes |
| [02-cozy-lan-rail-1920.png](themes/02-cozy-lan-rail-1920.png) | Cozy LAN, Linen (light): the coming hours, with standings, next up and food |
| [02-cozy-lan-announcement-1920.png](themes/02-cozy-lan-announcement-1920.png) | Cozy LAN, Meadow: an announcement over the screen (#780) at the lively level: the same announcement, round and warm |
| [02-cozy-lan-hub-1280.png](themes/02-cozy-lan-hub-1280.png) | Cozy LAN, Fireside: the hub page at 1280 px, laid out for the width (the hero and food, then three cards). The colours, fonts and corners, and none of the screen’s effects |
| [02-cozy-lan-phone-390.png](themes/02-cozy-lan-phone-390.png) | The same hub page on a phone, in one column |
| [03-esports-hero-1920.png](themes/03-esports-hero-1920.png) | **Esports**, Arena: the rotation's now-and-next hero with its countdown, the run of show, food and Wi-Fi in the rail; the demo logo in the header; slab boxes with cut corners and a primary edge, skewed title tabs, the Live lower third |
| [03-esports-rail-1920.png](themes/03-esports-rail-1920.png) | Esports, Studio (light): the scoreboard as standings, beside the coming hours |
| [03-esports-announcement-1920.png](themes/03-esports-announcement-1920.png) | Esports, Red side: an announcement over the screen (#780) at the lively level: a slanted Important tab, the headline in capitals and an accent rule |
| [03-esports-hub-1280.png](themes/03-esports-hub-1280.png) | Esports, Arena: the hub page at 1280 px, laid out for the width (the hero and food, then three cards). Square corners and the pair’s fonts, with none of the screen’s effects |
| [03-esports-phone-390.png](themes/03-esports-phone-390.png) | The same hub page on a phone, in one column |
| [04-synthwave-hero-1920.png](themes/04-synthwave-hero-1920.png) | **Synthwave**, Sunset grid: the rotation's now-and-next hero with its countdown, the run of show, food and Wi-Fi in the rail; the demo logo in the header; the striped sun on the horizon, showing through the boxes and in the free horizon band, with the grid below it and neon edges |
| [04-synthwave-rail-1920.png](themes/04-synthwave-rail-1920.png) | Synthwave, Vapor (light): the coming hours; in the light scheme the boxes stay readable over the sun |
| [04-synthwave-announcement-1920.png](themes/04-synthwave-announcement-1920.png) | Synthwave, Night drive: an announcement over the screen (#780) at the lively level: neon frame and glowing headline, the horizon band still free |
| [04-synthwave-hub-1280.png](themes/04-synthwave-hub-1280.png) | Synthwave, Sunset grid: the hub page at 1280 px, laid out for the width (the hero and food, then three cards). The colours, fonts and corners, and none of the screen’s effects |
| [04-synthwave-phone-390.png](themes/04-synthwave-phone-390.png) | The same hub page on a phone, in one column |
| [05-arcade-hero-1920.png](themes/05-arcade-hero-1920.png) | **Arcade**, Cabinet: the rotation's now-and-next hero with its countdown, the run of show, food and Wi-Fi in the rail; the demo logo in the header; pixel type throughout, opaque stepped boxes, scanlines and the vignette over the whole screen |
| [05-arcade-rail-1920.png](themes/05-arcade-rail-1920.png) | Arcade, Handheld (light): the high-score table (1ST, 2ND, …) and the coming hours |
| [05-arcade-announcement-1920.png](themes/05-arcade-announcement-1920.png) | Arcade, Player two: an announcement over the screen (#780) at the lively level: the headline in Press Start 2P, the text in Jersey 10 |
| [05-arcade-hub-1280.png](themes/05-arcade-hub-1280.png) | Arcade, Cabinet: the hub page at 1280 px, laid out for the width (the hero and food, then three cards). The colours, fonts and corners, and none of the screen’s effects |
| [05-arcade-phone-390.png](themes/05-arcade-phone-390.png) | The same hub page on a phone, in one column |
| [06-effects-1280.png](themes/06-effects-1280.png) | **The effects at each motion level.** Each advanced preset at none, calm, lively and party, zoomed on its effect and frozen inside its motion, with the period in words and Synthwave's grid speed by heat |
| [06-effects-synthwave-clip.gif](themes/06-effects-synthwave-clip.gif) | Clip: Synthwave's grid at none, calm, lively and party side by side, 3 s |
| [06-effects-esports-clip.gif](themes/06-effects-esports-clip.gif) | Clip: Esports' sheen at the four levels |
| [06-effects-arcade-clip.gif](themes/06-effects-arcade-clip.gif) | Clip: Arcade's roll band at the four levels |
| [07-arcade-fonts-1280.png](themes/07-arcade-fonts-1280.png) | **Arcade's type:** Press Start 2P, Jersey 10, Silkscreen and today's Pixelify Sans side by side, with the digits 0–9 and a sample line; the recommendation is Press Start 2P for titles, digits and ranks and Jersey 10 for text |

## Rules the sheets keep
- **Readable from the hall.** No screen text is under 27 px at 1080p, in the pixel faces too. The module's own CSS check (`checkCss` and the small-text check) passes on each look's CSS. Its only warnings name the stage's glow layer and the motion-level classes: the contract lists them as stable, but the module's class list does not have them yet. Part 1 adds them (plan, Part 1, Task 1b).
- **Boxes let the background through, and contrast holds.** Every box is the surface colour at the preset's opacity (D11). The build checks the text and status colours on the box over the background, the primary and the accent, and stops if one fails. The sun, the grid and the glows hang on the stage's glow layer. Arcade's CRT is the exception: it sits over the screen on purpose, light and still, and the build checks the darkened pairs too.
- **Calm motion.** Keyframes move only `transform` and `opacity`. Each animation runs only at a motion level (calm, lively, party), so `none` and reduced motion are still. Nothing repeats faster than once every 1.6 s, and no transparency uses `backdrop-filter`.
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
The three GIF clips are made the same way with `node build.mjs --clips --html "$TMPDIR/themes-html"` in the same image, with `CANCCU_GIF_DIR` naming a folder where `gifenc` and `pngjs` are installed (`npm i gifenc pngjs`).
