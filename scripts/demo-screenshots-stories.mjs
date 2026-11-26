// Studio → Moments → Storyboards shots of scripts/demo-screenshots.mjs (group `moments`; step 4
// storyboards mockups 18, 20, 21 and 22, #114 and #602), on the screens' fixture: the preset
// picker and the builder of Starting soon with its preview drawn in the real player, on a desk and
// a phone; each of the 23 presets test-fired as one round on the main hall (silent) and shot at
// its message step (O3), with a run-of-show item of the fixture where it has an item trigger;
// Premiere on the demo event (a "premiere" item, the demo film uploaded to Screen) with its
// builder and its three steps on the main hall; and On air on a phone with Doors open's loop live
// (Stop loop). Every run is stopped, and every item, file, screen and Premiere's settings made
// here are undone afterwards. The hero rule (#625, docs/briefs/step-4-polish sheets 07–10): every
// screen shot here is judged by the screens' readability check, and four rounds are shot step by
// step on one open page (S1 Starting soon with its finale, S2 Midnight on the main hall and the
// portrait entrance, R17 Doors open), at 1080p and 4K, with a crew photo spotlight.
import { readFileSync } from "node:fs";
import { SESSION } from "../modules/screen/test/stack/client.mjs";
import { image, moments, placed } from "./demo-screenshots-moments.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";
import { placeStories } from "./demo-screenshots-fire-inputs.mjs";

const SCREEN_VIEW = { width: 1920, height: 1080 };
const SCREEN_4K = { width: 3840, height: 2160 };
const PORTRAIT = { width: 1080, height: 1920 };
const FILM = new URL("../events/demo/media/demo-film.mp4", import.meta.url);

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

/** The builder on a phone at one of its tabs (step 4 polish sheet 06). */
const tab = (name) => async (page) => {
  await page.getByRole("tab", { name }).click();
  await page.waitForTimeout(800);
};

export const STORY_PAGES = [
  ["stories-list", "/moments/storyboards", DESK],
  ["stories-list-phone", "/moments/storyboards", PHONE, { touch: true }],
  // The catalogue's card grid at 1920 px: 5 columns (amendment 3, sheet 05).
  ["stories-list-1920", "/moments/storyboards", { width: 1920, height: 1080 }],
  [
    "stories-builder",
    "/moments/storyboards?edit=starting_soon",
    DESK,
    { ready: previewed },
  ],
  // Its triggers and Until in words, "A match is called" (#638, P14).
  [
    "stories-builder-match-called",
    "/moments/storyboards?edit=match_called",
    DESK,
    { ready: previewed },
  ],
  // Its step's "Fills with" in the test-fire's sample text (#668, R21).
  [
    "stories-builder-match-called-phone",
    "/moments/storyboards?edit=match_called&step=0",
    PHONE,
    { touch: true, ready: tab("Round") },
  ],
  [
    "stories-builder-phone",
    "/moments/storyboards?edit=starting_soon",
    PHONE,
    { touch: true },
  ],
  [
    "stories-builder-phone-round",
    "/moments/storyboards?edit=starting_soon&step=1",
    PHONE,
    { touch: true, ready: tab("Round") },
  ],
  [
    "stories-builder-phone-preview",
    "/moments/storyboards?edit=starting_soon",
    PHONE,
    { touch: true, ready: tab("Preview") },
  ],
  // A loop: Doors open plays its round every 10 minutes (sheet 05, 3).
  [
    "stories-builder-loop",
    "/moments/storyboards?edit=doors_open&step=1",
    DESK,
    { ready: previewed },
  ],
];

/**
 * Each preset (Premiere apart, below), what shows its message step is up, and the run-of-show
 * item a test-fire takes: a kind of the fixture's (the next one), `quiet` (made here), or `any`.
 */
const PRESET_SHOTS = [
  ["doors_open", shows("Welcome to"), "doors"],
  // The step's countdown, not the Pulse's own (the book's R21 caught the sting).
  [
    "starting_soon",
    drawn(".canccu-widget--countdown.canccu-is-claim"),
    "tournament",
  ],
  // A test-fire fills the match it lacks with sample text, never "Match called:" alone (#668, R21).
  ["match_called", shows("Semi-final 1")],
  ["champion", shows("Our champion")],
  // The card, not "Tonight on stage" on the Pulse (the book's R21).
  ["midnight", drawn(".canccu-region--_full > .canccu-widget--title_card")],
  ["meal_served", shows("is served"), "meal"],
  ["quiet_hours_soon", shows("Quiet hours from"), "quiet"],
  ["good_morning", shows("Today at"), "quiet"],
  ["checkin_open", shows("Check in for")],
  ["closing_time", shows("ends at")],
  ["arrival_checkin", drawn(".canccu-widget--qr"), "doors"],
  ["hot_game", shows("is hot")],
  ["record_crowd", shows("of us online")],
  ["sponsor_thanks", shows("Thanks to our sponsors")],
  ["prize_draw", shows("Prize draw at"), "any"],
  ["group_photo", shows("Group photo"), "any"],
  ["venue_info", shows("Venue info")],
  ["stage_break", shows("Back at"), "tournament"],
  ["round_start", shows("starts now")],
  ["champion_replay", shows("Our champion")],
];
const screen = (name, ready) => [
  `stories-screen-${name.replace(/_/g, "-")}`,
  "/screen/zones/main",
  SCREEN_VIEW,
  { fullPage: false, ready, readable: true },
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
/**
 * On air before and after Fire (#638; docs/design/moments-on-air.svg): the Fire… chooser open on
 * the desktop, the phone with crew actions first, then Starting soon fired from the page on its
 * picker's item (the next coming one), with the notice that says when it plays. The phone's
 * "after" opens the page Fire answered with, so it shows the same notice.
 */
const chooserOpen = async (page) => {
  await page.locator(".moments-fire__chooser > summary").click();
  await page.waitForTimeout(300);
};
export const FIRE_PAGES = [
  ["stories-on-air", "/moments/on-air", DESK, { ready: chooserOpen }],
  ["stories-on-air-before-phone", "/moments/on-air", PHONE, { touch: true }],
  ["stories-on-air-fired", "/moments/on-air", DESK],
  ["stories-on-air-fired-phone", "/moments/on-air", PHONE, { touch: true }],
];
/** Fire with two of the event's own stories that both ask `{place}`: once for each (#646). */
export const INPUT_PAGES = [
  [
    "stories-on-air-fire-inputs",
    "/moments/on-air",
    DESK,
    { ready: chooserOpen },
  ],
];
export const LIVE_PAGES = [
  ["stories-on-air-phone", "/moments/on-air", PHONE, { touch: true }],
];

/** A frame: the selector it waits for, drawn and settled (the step's flash and fade, 600 ms). */
const frame =
  (selector, timeout = 30_000) =>
  async (page) => {
    await page.locator(selector).first().waitFor({ timeout });
    await page.waitForTimeout(900);
  };
const CLAIM = ".canccu-is-claim";
const FULL = ".canccu-region--_full >";

/**
 * The rounds shot step by step (#625): `[name, zone, viewport, story, item kind, frames]`. A
 * test round plays no finale, so a frame named `finale` stops it and fires the story by hand on an
 * item that has just started, which goes straight to the finale (R22). Each frame is judged for
 * readability.
 */
export const SEQUENCES = [
  ...[
    ["1080p", SCREEN_VIEW],
    ["4k", SCREEN_4K],
  ].flatMap(([size, viewport]) => [
    [
      `stories-seq-starting-soon-${size}`,
      "main",
      viewport,
      "starting_soon",
      "tournament",
      [
        ["1-sting", frame(`.canccu-widget--sting${CLAIM}`)],
        ["2-countdown", frame(`.canccu-widget--countdown${CLAIM}`)],
        [
          "3-finale",
          frame(`.canccu-step--flash.canccu-widget--title_card${CLAIM}`),
        ],
      ],
    ],
    [
      `stories-seq-doors-open-${size}`,
      "main",
      viewport,
      "doors_open",
      "doors",
      [
        ["1-sting", frame(`.canccu-widget--sting${CLAIM}`)],
        // The event's name filled on the first fire (A5, R19).
        ["2-welcome", frame(`${CLAIM} :text("Welcome to Demo Event")`)],
        ["3-title", frame(`${CLAIM} :text("Wi-Fi and venue info")`, 40_000)],
        // The code drawn, not a white square (R20).
        [
          "4-qr",
          frame(
            `.canccu-widget--qr${CLAIM} img[src^="data:image/svg"]`,
            40_000,
          ),
        ],
      ],
    ],
  ]),
  [
    "stories-seq-midnight-1080p",
    "main",
    SCREEN_VIEW,
    "midnight",
    undefined,
    [
      ["1-countdown", frame(`${FULL} .canccu-widget--countdown`)],
      ["2-sting", frame(`${FULL} .canccu-widget--sting`)],
      ["3-card", frame(`${FULL} .canccu-widget--title_card`)],
    ],
  ],
  [
    "stories-seq-midnight-portrait",
    "entrance",
    PORTRAIT,
    "midnight",
    undefined,
    [
      ["1-countdown", frame(`${FULL} .canccu-widget--countdown`)],
      ["2-sting", frame(`${FULL} .canccu-widget--sting`)],
      ["3-card", frame(`${FULL} .canccu-widget--title_card`)],
    ],
  ],
];

/** A crew photo spotlight on the main hall (R2; sheets 07 B, 08 1 and 10), at 1080p and 4K. */
export const PHOTO_PAGES = [
  ["1080p", SCREEN_VIEW],
  ["4k", SCREEN_4K],
].map(([size, viewport]) => [
  `stories-screen-crew-photo-${size}`,
  "/screen/zones/main",
  viewport,
  {
    fullPage: false,
    ready: frame(`.canccu-widget--photo${CLAIM} img`),
    readable: true,
  },
]);

/** The dry run's lines. */
export function storiesListed(at) {
  return [
    [STORY_PAGES, "the preset picker and the builder"],
    [PRESET_PAGES, "a preset's message step, test-fired on the main hall"],
    [PREMIERE_PAGES, "Premiere on the demo event, its builder and its steps"],
    [FIRE_PAGES, "On air before and after Starting soon fired from the page"],
    [INPUT_PAGES, "Fire's inputs, each under the story that asks it"],
    [LIVE_PAGES, "a live loop with Stop loop"],
    [PHOTO_PAGES, "a crew photo spotlight"],
  ]
    .flatMap(([pages, how]) =>
      pages.map(
        ([name, path, { width, height }]) =>
          `  ${name}.png  ${at(path)}  (${width}×${height}, ${how})`,
      ),
    )
    .concat(
      SEQUENCES.flatMap(([name, zone, { width, height }, key, , frames]) =>
        frames.map(
          ([suffix]) =>
            `  ${name}-${suffix}.png  ${at(`/screen/zones/${zone}`)}  (${width}×${height}, ${key} test-fired, step by step)`,
        ),
      ),
    );
}

/** One round on the main hall, silent; Moments learns a new item from the agenda's event, so a
 * test-fire that names one is asked again for a few seconds until Moments knows it. */
async function testFire(key, item = null, zone = "main") {
  const body = {
    test: { zone, sound: false },
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

/** Starting soon fired from On air's chooser; the page Fire answered with, and its notice. */
async function fireFromPage(page) {
  await chooserOpen(page);
  await Promise.all([
    page.waitForURL(/[?&](done|error)=/),
    page.getByRole("button", { name: /Fire Starting soon/ }).click(),
  ]);
  const url = new URL(page.url());
  const error = url.searchParams.get("error");
  if (error !== null) throw new Error(`Fire: ${error}`);
  await page.waitForTimeout(500);
  return `${url.pathname}${url.search}`;
}

/** The live runs fired by hand, not by a test, so the shots' cleanup stops them. */
async function liveRuns() {
  const r = await moments("GET", "/api/moments/storyboards");
  return (r.body?.runs ?? [])
    .filter((x) => x.status === "live" && !x.test)
    .map((x) => x.id);
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

/** A round test-fired on a page already drawing the zone, then shot step by step. */
async function sequenceShots(sequence, itemOf, add, runs) {
  for (const [name, zone, viewport, key, pick, frames] of SEQUENCES) {
    let run = null;
    const steps = frames.map(([suffix, ready]) => [
      suffix,
      suffix.endsWith("finale")
        ? async (page) => {
            await stop(run);
            // Made only now: its own start may fire the story too, which shows the same finale.
            const started = await add.item(
              "Demo Cup, final",
              "tournament",
              -1,
              60,
              "Stage",
            );
            const fired = await fireByHand(key, started);
            if (fired !== null) runs.push(fired);
            await ready(page);
            if (fired !== null) await stop(fired);
          }
        : ready,
    ]);
    await sequence(
      name,
      `/screen/zones/${zone}${viewport.height > viewport.width ? "?orientation=portrait" : ""}`,
      viewport,
      SESSION,
      async () => {
        run = await testFire(key, itemOf(pick), zone);
        runs.push(run);
      },
      steps,
    );
    if (run !== null) await stop(run);
  }
}

/**
 * The story fired by hand on `item`, asked again until Moments knows the new item; null when the
 * item's own start fired it first (the run that owns it shows the same finale).
 */
async function fireByHand(key, item) {
  for (let tries = 0; ; tries++) {
    const r = await moments("POST", `/api/moments/storyboards/${key}/take`, {
      item_id: item.id,
    });
    if (r.status === 201) return r.body.id;
    if (r.status === 409) return null;
    if (tries >= 20 || r.status !== 400)
      throw new Error(
        `firing ${key}: HTTP ${r.status} ${JSON.stringify(r.body)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The crew photo spotlight: an image uploaded, shown on the main hall, then ended. */
async function photoShots(demo, shot) {
  const photo = await image(demo);
  let id = null;
  try {
    const r = await moments("POST", "/api/moments/spotlight", {
      show: "photo",
      photo_url: photo.url,
      caption: "Pizza is here",
      zones: ["main"],
    });
    if (r.status !== 201 && r.status !== 200)
      throw new Error(
        `the photo spotlight: HTTP ${r.status} ${JSON.stringify(r.body)}`,
      );
    id = r.body.id;
    await placed(id, ["main"]);
    for (const [name, path, viewport, o] of PHOTO_PAGES)
      await shot(name, path, viewport, SESSION, o);
  } finally {
    if (id !== null)
      await moments("POST", `/api/moments/moments/${id}/end`, {});
    await demo.call("DELETE", `/api/screen/assets/${photo.id}`);
  }
}

export async function storiesShots({ demo, shot, sequence, fail }) {
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
    // Started a minute ago: Starting soon fired by hand on it plays its finale at once.
    const started = await add.item(
      "Demo Cup, final",
      "tournament",
      -1,
      60,
      "Stage",
    );
    await sequenceShots(sequence, itemOf, add, runs);
    await photoShots(demo, shot);
    const [before, beforePhone, fired, firedPhone] = FIRE_PAGES;
    for (const [name, path, viewport, o] of [before, beforePhone])
      await shot(name, path, viewport, SESSION, o);
    await placeStories(true);
    for (const [name, path, viewport, o] of INPUT_PAGES)
      await shot(name, path, viewport, SESSION, o);
    await placeStories(false);
    // The `started` item above is already running, so Moments' own clock may have fired Starting
    // soon for it by now (a race with the shots' pace, not a fixed order). Fire from the page then
    // refuses with "it already runs for this source"; end such a run so the page's Fire is the one.
    for (const run of await liveRuns()) await stop(run);
    let answered = null;
    await shot(fired[0], fired[1], fired[2], SESSION, {
      ready: async (page) => {
        answered = await fireFromPage(page);
      },
    });
    if (answered !== null)
      await shot(
        firedPhone[0],
        answered,
        firedPhone[2],
        SESSION,
        firedPhone[3],
      );
    runs.push(...(await liveRuns()));
    // A live loop for On air: Doors open fired by hand would need its item; a test round shows the same card.
    runs.push(await testFire("doors_open"));
    for (const [name, path, viewport, o] of LIVE_PAGES)
      await shot(name, path, viewport, SESSION, o);
  } catch (err) {
    fail(`storyboards: ${firstLine(err)}`);
  } finally {
    try {
      for (const run of runs) await stop(run);
      await placeStories(false);
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
