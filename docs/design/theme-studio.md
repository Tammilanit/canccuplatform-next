# Theme studio: the pack for the PO (#784, part 0)

The PO's ask of 2026-11-23: a Theme studio for both kinds of organisers. Those who stick with presets pick a look and make it theirs with choices only. Those who want to customise everything get every token as a control, their own fonts and backgrounds, box looks and CSS. Both always see the screen, the phone and a hub page beside the controls. The [plan](../plans/issue-784.md) (accepted by the lead on 2026-11-25, Q1–Q5 as recommended) builds this in four parts after this pack is accepted.

**How the sheets are made.** A script draws them, not a person. [`theme-studio/build.mjs`](theme-studio/build.mjs) writes each sheet as one HTML page. The page uses packages/ui's `ui.css` (the shipped organiser shell and its components), the presets' real colours from `events/demo/themes/`, and every font of the 14 pairs. Chromium then renders each page at its widths. A revision changes the script and renders again, so only what changed moves. The script also checks every scheme against the contrast rules of contracts/theming.md (Brand kit), and the build stops if one fails. The HTML is not kept in the repo: it embeds about 1 MB of fonts, and the script rebuilds it exactly.

## What the PO decides with this pack
1. **The three depths and their tabs:** Pick a look · Make it yours · Advanced · History. The live preview column (screen, phone, hub page) sits beside the controls on every depth. On a phone, the preview comes first, one frame at a time.
2. **The schemes proposed for the three existing presets** (sheet 1). The Themes step (#785) designs the new presets with the same kinds of scheme.
3. **The logo plate** (sheets 2 and 3): none, light, dark or the theme's surface; rounded or circle; small, medium or large space around it. A contrast check suggests a plate when the logo would vanish, with one button to apply it.
4. **The font pairs (Q4).** Sheet 2 shows all 14. The PO keeps 10–15 of them, and Part 1 ships those.
5. **Advanced as one page of controls** (sheet 4): groups, controls with an ⓘ that explains each one in place, box looks, and a CSS editor that marks problems as you type.
6. **The shared actions and states** (sheet 5): Save as my look, Import, Export, Reset to the preset, using a look over your own changes, saving, another organiser's change, and the preview's loading and held states.

## The proposed schemes
Each preset's first scheme is its theme package's own colours. Every scheme passes the contrast rules.

| Preset | Schemes (kind) |
|---|---|
| Default | Night (dark, today's) · Daylight (light) · High contrast · Ember (colour variant: orange and gold) |
| Terminal | Cyan (dark, today's) · Phosphor (green) · Amber · Paper (light) · High contrast |
| Level up | Sunset (dark, today's) · Neon berry (pink and orange) · Daylight (light) · High contrast |

## The font pairs (Q4)
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
| [02-make-it-yours-1280.png](theme-studio/02-make-it-yours-1280.png) | **Make it yours** at 1280 px, on Default · Night with the black logo. The plate check has fired ("Only 1.1:1 against it"), and the light plate it suggests is chosen. Below: colours with matching swatches, all 14 font pairs drawn in their own fonts, corners, the screen background (glows, gradient, your picture, game art), motion, and Reset to the preset with Save as my look |
| [02-make-it-yours-1920.png](theme-studio/02-make-it-yours-1920.png) | The same at 1920 px: the font pairs in three columns |
| [02-make-it-yours-390.png](theme-studio/02-make-it-yours-390.png) | The same on a phone |
| [03-logo-plates-1280.png](theme-studio/03-logo-plates-1280.png) | **The black transparent logo in every preset:** on the screen, the phone, a hub page, the organiser header and a Discord card. One row with no plate, then one row on the suggested light plate |
| [04-advanced-1280.png](theme-studio/04-advanced-1280.png) | **Advanced** at 1280 px, on Level up · Sunset with a picture behind the screen. The groups as chips; every colour with a plain name, what it colours and whether text reads on it ("Quiet text" has its ⓘ open); the fonts, with your own font; sliders for corners, lines, spacing and the screen's edge margin (its ⓘ open); background picture or video; every motion choice; box looks; and the CSS editor with an error and a warning marked as typed |
| [04-advanced-1920.png](theme-studio/04-advanced-1920.png) | The same at 1920 px: the controls in two columns |
| [04-advanced-390.png](theme-studio/04-advanced-390.png) | The same on a phone: one column, and long CSS lines wrap |
| [05-actions-and-states-1280.png](theme-studio/05-actions-and-states-1280.png) | **Actions and states**, the same on every depth: Save as my look, Import and what an import found, Export, Reset to the preset, using a look over your own changes, the saving states, another organiser's change, and the preview loading, ready and holding Publish |

## Notes
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
