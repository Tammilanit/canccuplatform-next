// The Themes track's preset shots (group `theming`; plan docs/plans/issue-785.md, Part 1 Task 3):
// each new preset applied to the draft, its hub at phone and desk width in its first scheme, and
// its screen at 1080p in the first scheme and in its light one, beside the pack's sheets
// (docs/design/themes/). Taken inside draftShots, on its draft, which it discards after.
import { SESSION, expect } from "../modules/screen/test/stack/client.mjs";
import { DESK, PHONE } from "./demo-screenshots-shot.mjs";

const HD = { width: 1920, height: 1080 };
const PREVIEW = "/theming/studio/preview/";

/** Each new preset: its id, its first scheme and its light scheme. */
const NEW_PRESETS = [["esports", "arena", "studio"]];

export const PRESET_LOOKS = NEW_PRESETS.flatMap(([preset, first, light]) => [
  [
    `theming-preset-${preset}-hub-phone`,
    PHONE,
    { preset, scheme: first, surface: "hub" },
  ],
  [
    `theming-preset-${preset}-hub-desk`,
    DESK,
    { preset, scheme: first, surface: "hub" },
  ],
  [
    `theming-preset-${preset}-screen-${first}`,
    HD,
    { preset, scheme: first, surface: "screen" },
  ],
  [
    `theming-preset-${preset}-screen-${light}`,
    HD,
    { preset, scheme: light, surface: "screen" },
  ],
]);

const pathOf = ({ surface }) => `${PREVIEW}${surface}?canccu_theme=draft`;

/** The dry run's lines. */
export const presetsListed = (at) =>
  PRESET_LOOKS.map(
    ([name, { width, height }, o]) =>
      `  ${name}.png  ${at(pathOf(o))}  (${width}×${height}, ${o.preset} · ${o.scheme})`,
  );

/** Applies each shot's preset and scheme to the draft and shoots it; answers the draft's version. */
export async function presetShots({ demo, shot }, from) {
  let version = from;
  for (const [name, viewport, o] of PRESET_LOOKS) {
    const applied = await demo.call("PUT", "/api/theming/draft/preset", {
      body: { preset: o.preset, scheme: o.scheme, draft_version: version },
    });
    version = expect(applied, 200, `${o.preset} · ${o.scheme}`).body
      .draft_version;
    await shot(name, pathOf(o), viewport, SESSION, {
      fullPage: o.surface === "hub",
    });
  }
  return version;
}
