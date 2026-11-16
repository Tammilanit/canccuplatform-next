// Studio → Moments shots of scripts/demo-screenshots.mjs (group `moments`; step 4 mockups 03, 04,
// 07, 08 and 09), on the screens' fixture (the main and entrance zones): a crew spotlight of the
// standings, then one with a message that takes the hero from it, so On air shows one placed and
// one waiting with why; On air at both widths, the spotlight form on a phone, Priorities with its
// preview drawn, History, Scenes with its band chart and Peak's editor, and the main hall's live
// view with "From the crew"; then "Peak now" pressed, on On air and the main hall. Then an emergency:
// On air and the main hall under it. Screen places a zone's claims, and reports where, only while
// a screen of it is connected, so a screen is paired into each zone and its stream kept open while
// the shots run. Every moment and screen started here ends afterwards.
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
} from "../modules/screen/test/stack/client.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";

const SCREEN_VIEW = { width: 1920, height: 1080 };
const PLACED_MS = 30_000;

/** A call to Moments through Caddy (SCREEN is Caddy's address here), with a fresh key. */
function moments(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        ...SCREEN,
        method,
        path,
        timeout: 10_000,
        headers: {
          host: DEMO_HOST,
          cookie: SESSION,
          "idempotency-key": randomBytes(12).toString("base64url"),
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: text ? JSON.parse(text) : null,
          }),
        );
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error(`${method} ${path} timed out`)),
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function start(path, body) {
  const r = await moments("POST", path, body);
  if (r.status !== 201)
    throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

/** On air draws what Screen reported: wait until every zone of the moment `id` has its place. */
async function placed(id, zones) {
  const until = Date.now() + PLACED_MS;
  while (Date.now() < until) {
    const r = await moments("GET", "/api/moments/moments");
    const m = r.body?.moments?.find((x) => x.id === id);
    const here = new Set((m?.placements ?? []).map((p) => p.zone_key));
    if (zones.every((z) => here.has(z))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Screen did not place ${id} on ${zones.join(", ")} within ${PLACED_MS / 1000} s`,
  );
}

const shows = (text) => async (page) => {
  await page.getByText(text).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
};
const previewed = async (page) => {
  await page.click("[data-preview-run]");
  await page
    .frameLocator("iframe[data-preview]")
    .getByText("Pizza is here")
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
};

export const MOMENTS_PAGES = [
  ["moments-on-air", "/moments/on-air", DESK],
  ["moments-on-air-phone", "/moments/on-air", PHONE, { touch: true }],
  ["moments-spotlight-phone", "/moments/spotlight", PHONE, { touch: true }],
  ["moments-priorities", "/moments/priorities", DESK, { ready: previewed }],
  ["moments-priorities-phone", "/moments/priorities", PHONE, { touch: true }],
  ["moments-history", "/moments/history?zone=main", DESK],
  ["moments-scenes", "/moments/scenes", DESK],
  ["moments-scenes-phone", "/moments/scenes", PHONE, { touch: true }],
  ["moments-scenes-edit", "/moments/scenes?edit=peak", DESK],
  [
    "moments-screen-spotlight",
    "/screen/zones/main",
    SCREEN_VIEW,
    { fullPage: false, ready: shows("From the crew") },
  ],
];
/** With the crew's "Peak now" pressed (mockup 14): On air's scene card and the main hall. */
export const PEAK_PAGES = [
  ["moments-on-air-peak-phone", "/moments/on-air", PHONE, { touch: true }],
  [
    "moments-screen-peak",
    "/screen/zones/main",
    SCREEN_VIEW,
    { fullPage: false, ready: shows("From the crew") },
  ],
];
export const EMERGENCY_PAGES = [
  ["moments-on-air-emergency", "/moments/on-air", DESK],
  ["moments-on-air-emergency-phone", "/moments/on-air", PHONE, { touch: true }],
  [
    "moments-screen-emergency",
    "/screen/zones/main",
    SCREEN_VIEW,
    { fullPage: false, ready: shows("Please leave the hall") },
  ],
];

/** The dry run's lines of Studio → Moments. */
export function momentsListed(at) {
  return [
    ...MOMENTS_PAGES.map(([name, path, { width, height }]) => [
      name,
      path,
      width,
      height,
      "two crew spotlights",
    ]),
    ...PEAK_PAGES.map(([name, path, { width, height }]) => [
      name,
      path,
      width,
      height,
      "Peak now pressed",
    ]),
    ...EMERGENCY_PAGES.map(([name, path, { width, height }]) => [
      name,
      path,
      width,
      height,
      "an emergency",
    ]),
  ].map(
    ([name, path, w, h, how]) =>
      `  ${name}.png  ${at(path)}  (${w}×${h}, ${how})`,
  );
}

export async function momentsShots({ demo, shot, fail }) {
  const ids = [];
  const screens = [];
  let emergency = false;
  let peak = false;
  try {
    for (const zone of ["main", "entrance"]) {
      const paired = await demo.pair(`Moments shots ${zone}`, zone);
      const sse = demo.stream(paired.cookie);
      screens.push({ paired, sse });
      await sse.opened;
    }
    ids.push(
      await start("/api/moments/spotlight", {
        show: "standings",
        zones: ["main"],
      }),
    );
    ids.push(
      await start("/api/moments/spotlight", {
        show: "message",
        title: "Pizza is here",
        body: "Pick up at the café",
        zones: ["main", "entrance"],
        qr: { path: "/notify/", label: "Scan for the hub" },
      }),
    );
    await placed(ids[0], ["main"]);
    await placed(ids[1], ["main", "entrance"]);
    for (const [name, path, viewport, o] of MOMENTS_PAGES) {
      await shot(name, path, viewport, SESSION, o);
    }
    const press = await moments("POST", "/api/moments/scenes/peak/take", {});
    if (press.status !== 200)
      throw new Error(`Peak now: HTTP ${press.status} ${JSON.stringify(press.body)}`);
    peak = true;
    for (const [name, path, viewport, o] of PEAK_PAGES) {
      await shot(name, path, viewport, SESSION, o);
    }
    const id = await start("/api/moments/emergency", {});
    emergency = true;
    await placed(id, ["main", "entrance"]);
    for (const [name, path, viewport, o] of EMERGENCY_PAGES) {
      await shot(name, path, viewport, SESSION, o);
    }
  } catch (err) {
    fail(`moments: ${firstLine(err)}`);
  } finally {
    try {
      if (emergency)
        await moments("POST", "/api/moments/emergency/end", {
          all_clear: false,
        });
      // A second press of the same button takes the scene off (E7).
      if (peak) await moments("POST", "/api/moments/scenes/peak/take", {});
      for (const id of ids)
        await moments("POST", `/api/moments/moments/${id}/end`, {});
      for (const { paired, sse } of screens) {
        sse.close();
        await demo.revoke(paired.id);
      }
    } catch (err) {
      fail(`moments cleanup: ${firstLine(err)}`);
    }
  }
}
