// Studio → Moments → Storyboards shots of scripts/demo-screenshots.mjs (group `moments`; step 4
// storyboards mockups 18, 20, 21 and 22, #114 and #602), on the screens' fixture: the preset
// picker and the builder of Starting soon with its preview drawn in the real player, on a desk and
// a phone; each of the 24 presets test-fired as one round on the main hall (silent) and shot at
// its message step (O3), with a run-of-show item of the fixture where it has an item trigger;
// Premiere on the demo event (a "premiere" item, the demo film uploaded to Screen) with its
// builder and its three steps on the main hall; and On air on a phone with Doors open's loop live
// (Stop loop). Every run is stopped, and every item, file, screen and Premiere's settings made
// here are undone afterwards.
import { readFileSync } from "node:fs";
import { SESSION } from "../modules/screen/test/stack/client.mjs";
import { moments, placed } from "./demo-screenshots-moments.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";

const SCREEN_VIEW = { width: 1920, height: 1080 };
const FILM = new URL(
  "../events/demo/assets/video/demo-film.mp4",
  import.meta.url,
);

const shows =
  (text, timeout = 30_000) =>
  async (page) => {
    await page.getByText(text).first().waitFor({ timeout });
    await page.waitForTimeout(1500);
  };
const drawn =
  (selector, timeout = 30_000) =>
  async (page) => {
    await page.locator(selector).first().waitFor({ timeout });
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
  ["stories-list-phone", "/moments/storyboards", PHONE, { touch: true }],
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

/**
 * Each preset (Premiere apart, below), what shows its message step is up, and the run-of-show
 * item a test-fire takes: a kind of the fixture's (the next one), `quiet` (made here), or `any`.
 */
const PRESET_SHOTS = [
  ["doors_open", shows("Welcome to"), "doors"],
  ["starting_soon", drawn(".canccu-widget--countdown"), "tournament"],
  ["match_called", shows("Match called")],
  ["champion", shows("Our champion")],
  ["midnight", shows("Night")],
  ["meal_served", shows("is served"), "meal"],
  ["quiet_hours_soon", shows("Quiet hours from"), "quiet"],
  ["good_morning", shows("Today at"), "quiet"],
  ["checkin_open", shows("Check in for")],
  ["pizza_order_open", shows("Pizza order open")],
  ["closing_time", shows("ends at")],
  ["arrival_checkin", drawn(".canccu-widget--qr"), "doors"],
  ["hot_game", shows("is hot")],
  ["record_crowd", shows("of us online")],
  ["sponsor_thanks", shows("Thanks to our sponsors")],
  ["prize_draw", shows("Prize draw at"), "any"],
  ["group_photo", shows("Group photo"), "any"],
  ["venue_info", shows("Venue info")],
  ["stage_break", shows("Back at"), "tournament"],
  ["pizza_last_call", shows("Last call: pizza order")],
  ["pizza_arrived", shows("come and get it")],
  ["round_start", shows("starts now")],
  ["champion_replay", shows("Our champion")],
];
const screen = (name, ready) => [
  `stories-screen-${name.replace(/_/g, "-")}`,
  "/screen/zones/main",
  SCREEN_VIEW,
  { fullPage: false, ready },
];
export const PRESET_PAGES = PRESET_SHOTS.map(([key, ready]) =>
  screen(key, ready),
);
/** Premiere (mockup 22): its builder, then the countdown, the film full screen and the after-card. */
export const PREMIERE_PAGES = [
  [
    "stories-builder-premiere",
    "/moments/storyboards?edit=premiere",
    DESK,
    { ready: previewed },
  ],
  screen("premiere_countdown", drawn(".canccu-widget--countdown")),
  // After the 30 s countdown the film plays; the after-card follows its 12 s.
  screen("premiere_video", drawn(".canccu-widget--video video", 45_000)),
  screen("premiere_after", shows("Thanks for watching", 40_000)),
];
export const LIVE_PAGES = [
  ["stories-on-air-phone", "/moments/on-air", PHONE, { touch: true }],
];

/** The dry run's lines. */
export function storiesListed(at) {
  return [
    [STORY_PAGES, "the preset picker and the builder"],
    [PRESET_PAGES, "a preset's message step, test-fired on the main hall"],
    [PREMIERE_PAGES, "Premiere on the demo event, its builder and its steps"],
    [LIVE_PAGES, "a live loop with Stop loop"],
  ].flatMap(([pages, how]) =>
    pages.map(
      ([name, path, { width, height }]) =>
        `  ${name}.png  ${at(path)}  (${width}×${height}, ${how})`,
    ),
  );
}

/** One round on the main hall, silent; Moments learns a new item from the agenda's event, so a
 * test-fire that names one is asked again for a few seconds until Moments knows it. */
async function testFire(key, item = null) {
  const body = {
    test: { zone: "main", sound: false },
    ...(item ? { item_id: item.id } : {}),
  };
  for (let tries = 0; ; tries++) {
    const r = await moments(
      "POST",
      `/api/moments/storyboards/${key}/take`,
      body,
    );
    if (r.status === 201) return r.body.id;
    if (tries >= 20 || !(r.status === 400 && item))
      throw new Error(
        `test-fire ${key}: HTTP ${r.status} ${JSON.stringify(r.body)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
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

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ok = (r, status, what) => {
  if (r.status !== status)
    throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/** What the run adds to the demo event, and undoes after. */
function made(demo) {
  const items = [];
  const assets = [];
  return {
    async item(title, kind, fromMinutes, minutes, location) {
      const body = {
        title,
        kind,
        ...(location === null ? {} : { location }),
        visibility: "public",
        starts_at: iso(Date.now() + fromMinutes * 60_000),
        ends_at: iso(Date.now() + (fromMinutes + minutes) * 60_000),
      };
      const item = ok(
        await demo.call("POST", "/api/agenda/items", { body }),
        201,
        `adding ${title}`,
      );
      items.push(item);
      return item;
    },
    async film() {
      const boundary = "canccu-premiere-shot";
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="demo-film.mp4"\r\n` +
            "content-type: application/octet-stream\r\n\r\n",
        ),
        readFileSync(FILM),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const type = `multipart/form-data; boundary=${boundary}`;
      const asset = ok(
        await demo.call("POST", "/api/screen/assets", { body, type }),
        201,
        "uploading the demo film",
      );
      assets.push(asset.id);
      return asset;
    },
    async undo() {
      for (const { id, revision } of items.splice(0))
        await demo.call(
          "DELETE",
          `/api/agenda/items/${id}?revision=${revision}`,
        );
      for (const id of assets.splice(0))
        await demo.call("DELETE", `/api/screen/assets/${id}`);
    },
  };
}

/** The item a preset's test-fire takes: the fixture's next one of the kind, or one made here. */
async function itemsFor(demo, quiet) {
  const { items } = ok(
    await demo.call("GET", "/api/agenda/items"),
    200,
    "the run of show",
  );
  const now = Date.now();
  const ahead = items
    .filter((i) => i.status === "scheduled" && i.visibility === "public")
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const next = (kind) =>
    ahead.find((i) => i.kind === kind && Date.parse(i.starts_at) > now) ??
    ahead.find((i) => i.kind === kind);
  return (pick) =>
    pick === undefined
      ? null
      : pick === "quiet"
        ? quiet
        : pick === "any"
          ? (next("activity") ?? ahead[0])
          : next(pick);
}

/** Premiere on the demo event: its kind, an item, the film in its video step, an after-card. */
async function setUpPremiere(demo, add) {
  const kind = await demo.call("PUT", "/api/agenda/kinds/premiere", {
    body: { name: "Premiere" },
  });
  if (kind.status !== 200 && kind.status !== 201 && kind.status !== 409)
    ok(kind, 201, "adding the kind premiere");
  const item = await add.item(
    "Demo Event: the film",
    "premiere",
    180,
    30,
    "Main hall",
  );
  const film = await add.film();
  const doc = ok(
    await moments("GET", "/api/moments/storyboards"),
    200,
    "the storyboards",
  );
  const stories = doc.stories.map((s) => {
    if (s.key !== "premiere") return s;
    const [countdown, video, after] = s.round.steps;
    return {
      ...s,
      enabled: true,
      round: {
        ...s.round,
        steps: [
          countdown,
          { ...video, content: { asset_id: film.id } },
          {
            ...after,
            content: { ...after.content, subtitle: "Again at 21:00 on Stage" },
          },
        ],
      },
    };
  });
  ok(
    await moments("PUT", "/api/moments/storyboards", {
      stories,
      revision: doc.revision,
    }),
    200,
    "turning Premiere on with the demo film",
  );
  return item;
}

async function resetPremiere() {
  const doc = await moments("GET", "/api/moments/storyboards");
  if (doc.status !== 200) return;
  await moments("POST", "/api/moments/storyboards/reset", {
    key: "premiere",
    revision: doc.body.revision,
  });
}

export async function storiesShots({ demo, shot, fail }) {
  const runs = [];
  const add = made(demo);
  let screenOn = null;
  try {
    const paired = await demo.pair("Storyboard shots main", "main");
    const sse = demo.stream(paired.cookie);
    screenOn = { paired, sse };
    await sse.opened;
    // Far enough ahead that no scene of quiet hours starts while the shots run.
    const quiet = await add.item(
      "Quiet hours",
      "quiet_hours",
      12 * 60,
      360,
      null,
    );
    const premiere = await setUpPremiere(demo, add);
    const itemOf = await itemsFor(demo, quiet);
    for (const [i, [key, , pick]] of PRESET_SHOTS.entries()) {
      const run = await testFire(key, itemOf(pick));
      runs.push(run);
      await roundPlaced(key);
      const [name, path, viewport, o] = PRESET_PAGES[i];
      await shot(name, path, viewport, SESSION, o);
      await stop(run);
    }
    // After the test-fires, which wait until Moments knows the items made here.
    for (const [name, path, viewport, o] of STORY_PAGES)
      await shot(name, path, viewport, SESSION, o);
    const [builder, ...steps] = PREMIERE_PAGES;
    await shot(builder[0], builder[1], builder[2], SESSION, builder[3]);
    const film = await testFire("premiere", premiere);
    runs.push(film);
    await roundPlaced("premiere");
    for (const [name, path, viewport, o] of steps)
      await shot(name, path, viewport, SESSION, o);
    await stop(film);
    // A live loop for On air: Doors open fired by hand would need its item; a test round shows the same card.
    runs.push(await testFire("doors_open"));
    for (const [name, path, viewport, o] of LIVE_PAGES)
      await shot(name, path, viewport, SESSION, o);
  } catch (err) {
    fail(`storyboards: ${firstLine(err)}`);
  } finally {
    try {
      for (const run of runs) await stop(run);
      await resetPremiere();
      await add.undo();
      if (screenOn !== null) {
        screenOn.sse.close();
        await demo.revoke(screenOn.paired.id);
      }
    } catch (err) {
      fail(`storyboards cleanup: ${firstLine(err)}`);
    }
  }
}
