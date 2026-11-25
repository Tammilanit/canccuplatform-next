# Theme studio: the pack for the PO (#784, part 0)

The PO's ask of 2026-11-23: a Theme studio for both kinds of organisers. Those who stick with presets pick a look and make it theirs with choices only. Those who want to customise everything get every token as a control, their own fonts and backgrounds, box looks and CSS. Both always see the screen, the phone and a hub page beside the controls, and the screen's background is alive. The [plan](../plans/issue-784.md) (accepted by the lead on 2026-11-25, Q1–Q5 as recommended) builds this in four parts after this pack is accepted.

**How the sheets are made.** A script draws them, not a person. [`theme-studio/build.mjs`](theme-studio/build.mjs) writes each sheet as one HTML page. The page uses packages/ui's `ui.css` (the shipped organiser shell and its components), the presets' real colours from `events/demo/themes/`, and every font of the 14 pairs. Chromium then renders each page at its widths. A revision changes the script and renders again, so only what changed moves. The script also checks every scheme against the contrast rules of contracts/theming.md (Brand kit), and the build stops if one fails. The HTML is not kept in the repo: it embeds about 1 MB of fonts, and the script rebuilds it exactly.

## What the PO decides with this pack
1. **The three depths and their tabs:** Pick a look · Make it yours · Advanced · History. The live preview column (screen, phone, hub page) sits beside the controls on every depth. On a phone, the preview comes first, one frame at a time.
2. **The schemes proposed for the three existing presets** (sheet 1). The Themes step (#785) designs the new presets with the same kinds of scheme.
3. **The logo plate** (sheets 2 and 3): none, light, dark or the theme's surface; rounded or circle; small, medium or large space around it. A contrast check suggests a plate when the logo would vanish, with one button to apply it.
4. **The font pairs (Q4).** Still open for the PO: which of the 14 to keep. Sheet 2 now shows them as compact name plates, each in its own heading font. The PO keeps 10–15 of them, and Part 1 ships those.
5. **Advanced as one page of controls** (sheet 4): groups, controls with an ⓘ that explains each one in place, box looks, and a CSS editor that marks problems as you type.
6. **The living screen background** (sheets 2 and 6): the background slowly cycles at random among the looks the organiser leaves on (glows, gradient, particles and any look a theme brings), with a long crossfade every few minutes. Three switches, all on: the game's art while a game is on, the time of day, and more life when something big is near. Your picture and Your video stay, on Advanced only. The preview's chips (Quiet, Building, Live; Morning, Day, Late night) show each change before publishing.
7. **Motion in one place** (sheets 2 and 4): the level (still, calm, lively, party) is the zone's setting in Screen settings, not the theme's. The theme keeps its motion style (Standard, Broadcast, Arcade) and the countdown's look, with the spotlight in the countdown's box look. Speed and Strength are dropped.
8. **The shared actions and states** (sheet 5): Save as my look, Import, Export, Reset to the preset, using a look over your own changes, saving, another organiser's change, and the preview's loading and held states.

## The proposed schemes
Each preset's first scheme is its theme package's own colours. Every scheme passes the contrast rules.

| Preset | Schemes (kind) |
|---|---|
| Default | Night (dark, today's) · Daylight (light) · High contrast · Ember (colour variant: orange and gold) |
| Terminal | Cyan (dark, today's) · Phosphor (green) · Amber · Paper (light) · High contrast |
| Level up | Sunset (dark, today's) · Neon berry (pink and orange) · Daylight (light) · High contrast |

## The font pairs (Q4, still open)
**Question for the PO:** which of these 14 pairs should the studio keep (10–15)? Recommended: keep all 14 and drop any the PO finds off-brand.

All 14 pairs are under the SIL Open Font License on Google Fonts. Part 1 serves them from the event's own address with their licence files, never from Google. Before the files ship, Part 1 checks each family's licence file.

| # | Mood | Headings | Text |
|---|---|---|---|
| 1 | Game night | Chakra Petch | Exo 2 |
| 2 | Broadcast | Barlow Semi Condensed | Barlow |
| 3 | Modern | Space Grotesk | Inter |
| 4 | Poster | Oswald | Source Sans 3 |
| 5 | Tech | Rajdhani | Nunito Sans |
| 6 | Sci-fi | Orbitron | Exo 2 |
| 7 | Pixel | Pixelify Sans | IBM Plex Sans |
| 8 | Arena | Bebas Neue | Roboto |
| 9 | Cozy | Fredoka | Nunito |
| 10 | Esports | Saira Condensed | Saira |
| 11 | Bold | Russo One | Roboto Condensed |
| 12 | Synth | Audiowide | Titillium Web |
| 13 | Elegant | Josefin Sans | Lato |
| 14 | Terminal | IBM Plex Mono | IBM Plex Sans |

"Platform font", the device's own font, stays the default and is not a pair.

## Every mockup
| Sheet | What it shows |
|---|---|
| [01-pick-a-look-1280.png](theme-studio/01-pick-a-look-1280.png) | **Pick a look** at 1280 px. The three presets, each with its schemes as small screens that carry the event's logo on its plate and "Aa" in the preset's heading font. Level up · Sunset is chosen, and the preview shows it on the screen. "Your looks" is still empty |
| [01-pick-a-look-1920.png](theme-studio/01-pick-a-look-1920.png) | The same at 1920 px: four schemes a row, and the screen, phone and hub page larger in the preview column |
| [01-pick-a-look-390.png](theme-studio/01-pick-a-look-390.png) | The same on a phone: the preview first behind a Screen · Phone · Hub page switch, then two schemes a row |
| [02-make-it-yours-1280.png](theme-studio/02-make-it-yours-1280.png) | **Make it yours** at 1280 px, on Default · Night with the black logo. The plate check has fired ("Only 1.1:1 against it"), and the light plate it suggests is chosen. Below: colours with matching swatches, the 14 font pairs as compact name plates, corners, the screen background (the looks of the cycle to tick, three switches: game art, time of day, hype), and Reset to Default · Night with Save as my look. The preview has chips for how busy it is and the time of day. Motion is not here: a note says it is set in Screen settings |
| [02-make-it-yours-1920.png](theme-studio/02-make-it-yours-1920.png) | The same at 1920 px: the font pairs in more columns |
| [02-make-it-yours-390.png](theme-studio/02-make-it-yours-390.png) | The same on a phone |
| [02-make-it-yours-1280-scrolled.png](theme-studio/02-make-it-yours-1280-scrolled.png) | The same at 1280 px, scrolled to the end: the live preview stays beside the controls all the way down (sticky) |
| [03-logo-plates-1280.png](theme-studio/03-logo-plates-1280.png) | **The black transparent logo in every preset:** on the screen, the phone, a hub page, the organiser header and a Discord card. One row with no plate, then one row on the suggested light plate |
| [04-advanced-1280.png](theme-studio/04-advanced-1280.png) | **Advanced** at 1280 px, on Level up · Sunset with a picture behind the screen. The groups as chips; every colour with a plain name, what it colours and whether text reads on it ("Quiet text" has its ⓘ open); the fonts, with your own font; sliders for corners, lines, spacing and the screen's edge margin (its ⓘ open); the background picture or video that replaces the cycle (Advanced only); the motion style, with a note that the level is set in Screen settings; box looks, the countdown's with its spotlight; Reset to Level up · Sunset; and the CSS editor with an error and a warning marked as typed |
| [04-advanced-1920.png](theme-studio/04-advanced-1920.png) | The same at 1920 px: the controls in two columns |
| [04-advanced-390.png](theme-studio/04-advanced-390.png) | The same on a phone: one column, and long CSS lines wrap |
| [05-actions-and-states-1280.png](theme-studio/05-actions-and-states-1280.png) | **Actions and states**, the same on every depth: Save as my look, Import and what an import found, Export, Reset to the preset, using a look over your own changes, the saving states, another organiser's change, and the preview loading, ready and holding Publish; the Reset dialog names Level up · Sunset, the look the sheet is on |
| [06-background-alive-1280.png](theme-studio/06-background-alive-1280.png) | **The living background** on Level up · Sunset: the cycle of looks; quiet, building and live; morning, day and late night; the game's art while a game is on, then the cycle again; and the rule that the level follows how active the screen is |

## Notes
- **Level follows activity.** The zone's level (still, calm, lively, party) is the ceiling. The screen goes from calm up to it with the hype (quiet → building → live), by itself, and quiet hours cap it at calm. This is #787's rule; sheets 2, 4 and 6 say so in words.
- **Reset labels** name the preset and scheme the look came from: sheet 2 "Reset to Default · Night", sheets 4 and 5 "Level up · Sunset".
- **Words.** The pages never show a token key, file path, id or CSS value as a label. The only typed fields are a look's name and the CSS editor. The Advanced labels answer #725's rows ("Corner roundness", "Edge margin on screens", "Save" without "tokens").
- **No new chrome.** The shell, tabs, chips, buttons, notices, tables and fields are packages/ui's. On a phone the shell folds the tabs it cannot show under "2 more" and keeps its bottom bar. The sheets put that bar at the end of the page, because a full-page shot would otherwise paint it over the middle.
- **Legacy parity** (Scope 5) is in the [plan](../plans/issue-784.md#legacy-parity-scope-5). The only appearance editor the old system had, the signage ticker's, is covered by schemes, the Advanced colours and the preview.

## Rebuild
```sh
node docs/design/theme-studio/build.mjs              # the HTML, into $TMPDIR (fetches the fonts once)
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CANCCU_PLAYWRIGHT_DIR=<dir with playwright-core 1.64.1> \
  -v "$PWD:$PWD" -v "$TMPDIR:$TMPDIR" -w "$PWD/docs/design/theme-studio" \
  mcr.microsoft.com/playwright:v1.64.1-noble node build.mjs --render --html "$TMPDIR/theme-studio-html"
```
`--render` warns about any element whose text is wider than its box, and about a page wider than its sheet. It is the render check of the [mockup rules](../briefs/README.md#outline-of-a-research-pack).
