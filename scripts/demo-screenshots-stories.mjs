// Studio → Moments → Storyboards shots of scripts/demo-screenshots.mjs (group `moments`; step 4
// storyboards mockups 18 and 20, #114), on the screens' fixture: the list, the builder of Starting
// soon with its preview drawn in the real player, on a desk and a phone; then each of the five L5
// presets test-fired as one round on the main hall (silent) and shot at its message step (O3), and
// On air on a phone with Doors open's loop live (Stop loop). Every run is stopped and every screen
// revoked afterwards.
import { SESSION } from "../modules/screen/test/stack/client.mjs";
import { moments, placed } from "./demo-screenshots-moments.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";

const SCREEN_VIEW = { width: 1920, height: 1080 };

const shows = (text) => async (page) => {
  await page.getByText(text).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
};
const drawn = (selector) => async (page) => {
  await page.locator(selector).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
};
const previewed = async (page) => {
  await page
    .frameLocator("iframe[data-story-preview]")
    .locator(".canccu-widget--sting, .canccu-widget--countdown")
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
};

export const STORY_PAGES = [
  ["stories-list", "/moments/storyboards", DESK],
  [
    "stories-builder",
    "/moments/storyboards?edit=starting_soon",
    DESK,
    { ready: previewed },
  ],
  [
    "stories-builder-phone",
    "/moments/storyboards?edit=starting_soon",
    PHONE,
    { touch: true },
  ],
];

/** Each L5 preset's message step on the main hall, and what shows it is up. */
const PRESET_SHOTS = [
  ["doors_open", shows("Welcome to")],
  ["starting_soon", drawn(".canccu-widget--countdown")],
  ["match_called", shows("Match called")],
  ["champion", shows("Our champion")],
  ["midnight", shows("Night")],
];
const screen = (key, ready) => [
  `stories-screen-${key.replace(/_/g, "-")}`,
  "/screen/zones/main",
  SCREEN_VIEW,
  { fullPage: false, ready },
];
export const PRESET_PAGES = PRESET_SHOTS.map(([key, ready]) =>
  screen(key, ready),
);
export const LIVE_PAGES = [
  ["stories-on-air-phone", "/moments/on-air", PHONE, { touch: true }],
];

/** The dry run's lines. */
export function storiesListed(at) {
  return [
    [STORY_PAGES, "the storyboards list and the builder"],
    [PRESET_PAGES, "an L5 preset's message step, test-fired on the main hall"],
    [LIVE_PAGES, "a live loop with Stop loop"],
  ].flatMap(([pages, how]) =>
    pages.map(
      ([name, path, { width, height }]) =>
        `  ${name}.png  ${at(path)}  (${width}×${height}, ${how})`,
    ),
  );
}

async function testFire(key) {
  const r = await moments("POST", `/api/moments/storyboards/${key}/take`, {
    test: { zone: "main", sound: false },
  });
  if (r.status !== 201)
    throw new Error(
      `test-fire ${key}: HTTP ${r.status} ${JSON.stringify(r.body)}`,
    );
  return r.body.id;
}

async function stop(run) {
  await moments("POST", `/api/moments/storyboards/runs/${run}/stop`, {});
}

/** The round's moment, once Screen has placed it on the main hall. */
async function roundPlaced(key) {
  const r = await moments("GET", "/api/moments/moments");
  const m = r.body?.moments?.find((x) => x.class === "storyboard");
  if (m === undefined) throw new Error(`${key}: no round on air`);
  await placed(m.id, ["main"]);
}

export async function storiesShots({ demo, shot, fail }) {
  const runs = [];
  let screenOn = null;
  try {
    const paired = await demo.pair("Storyboard shots main", "main");
    const sse = demo.stream(paired.cookie);
    screenOn = { paired, sse };
    await sse.opened;
    for (const [name, path, viewport, o] of STORY_PAGES)
      await shot(name, path, viewport, SESSION, o);
    for (const [i, [key]] of PRESET_SHOTS.entries()) {
      const run = await testFire(key);
      runs.push(run);
      await roundPlaced(key);
      const [name, path, viewport, o] = PRESET_PAGES[i];
      await shot(name, path, viewport, SESSION, o);
      await stop(run);
    }
    // A live loop for On air: Doors open fired by hand would need its item; a test round shows the same card.
    runs.push(await testFire("doors_open"));
    for (const [name, path, viewport, o] of LIVE_PAGES)
      await shot(name, path, viewport, SESSION, o);
  } catch (err) {
    fail(`storyboards: ${firstLine(err)}`);
  } finally {
    try {
      for (const run of runs) await stop(run);
      if (screenOn !== null) {
        screenOn.sse.close();
        await demo.revoke(screenOn.paired.id);
      }
    } catch (err) {
      fail(`storyboards cleanup: ${firstLine(err)}`);
    }
  }
}
