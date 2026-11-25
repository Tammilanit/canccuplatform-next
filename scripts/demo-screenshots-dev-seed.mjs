// The dev server's demo content (#715, #788, docs/operations/dev-server.md), a pass of
// scripts/demo-screenshots on a stack of its own (group and shard `dev-seed`): after the script ran
// the modules' dev-seed commands as setup/deploy does, the run of show, the Food page with its two
// orders, Moments, the announcements and the main zone at phone (390 px) and desktop (1280 px)
// width (0032, amendment 5). Each shot waits for the seeded content, so a page left empty fails
// the pass; then the main zone's state must show something new in each box within a minute.
// Usage: node demo-screenshots-dev-seed.mjs [--dry-run] [--base BASE_URL] [--out DIR]
//          [--groups LIST] [--check]   (the groups and the check as in demo-screenshots.mjs)
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  event,
  expect,
} from "../modules/screen/test/stack/client.mjs";
import { GROUPS, pickGroups } from "./demo-screenshots-groups.mjs";
import { DESK, PHONE, firstLine, shooter } from "./demo-screenshots-shot.mjs";

const { values: opts } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    base: { type: "string", default: "http://127.0.0.1" },
    out: { type: "string", default: "screenshots" },
    groups: { type: "string", default: GROUPS.join(",") },
    check: { type: "boolean", default: false },
  },
});
const base = new URL(opts.base);
const port = base.port ? `:${base.port}` : "";
const at = (path) => `http://${DEMO_HOST}${port}${path}`;

const seen = (text) => (page) =>
  page
    .getByText(text)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 30_000 });
// The screen draws once its zone's state is built: its hero or rail names one of the seed's items.
const SEEDED =
  /Doors open|Tournament: |Pizza order|Dinner|Raffle|Breakfast|Closing ceremony/;
const drawn = async (page) => {
  await page
    .getByText(SEEDED)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
};
const VIEWS = [
  ["agenda", "/agenda/", { ready: seen(/Tournament: /) }],
  // The open order and the takeaway one called in (#788).
  ["pizza", "/pizza/", { ready: seen("Demo Trattoria") }],
  ["moments-on-air", "/moments/on-air", {}],
  ["moments-announce", "/moments/announce", { ready: seen(/Raffle at /) }],
  [
    "moments-storyboards",
    "/moments/storyboards",
    { ready: seen("Prize draw") },
  ],
  ["screen-main", "/screen/zones/main", { ready: drawn, fullPage: false }],
];
// What a box shows by itself, at least once a minute, while it has content: the clock's minute,
// the photo wall's next lead, the loop's next item, the ticker's crawl. The logo and the hub QR
// stay put by design (contracts/screen.md, Header and hub QR), beside a box that moves.
const TICKING = {
  clock: () => true,
  photo: (v) => (v.tiles ?? []).length >= 2,
  playlist: (v) => v.item != null,
  ticker: (v) => typeof v.text === "string" && v.text.length > 0,
};
const STILL = new Set(["logo", "qr"]);
/** The ids of the zone's boxes that would show nothing new for a minute (#788). */
function standing(regions) {
  return regions
    .filter((r) => {
      const shown = (r.order ?? []).map((i) => r.widgets[i]).filter(Boolean);
      if (shown.length >= 2) return shown.some((w) => w.dwell_seconds > 60);
      if (shown.length === 1) {
        const [w] = shown;
        return !STILL.has(w.widget) && !TICKING[w.widget]?.(w.view ?? {});
      }
      return !(r.widgets ?? []).every((w) => STILL.has(w.widget));
    })
    .map((r) => r.id);
}

/** [name, path, viewport, options]: each view at desktop width, then at phone width. */
const SHOTS = pickGroups(opts.groups).has("dev-seed")
  ? VIEWS.flatMap(([name, path, o]) => [
      [`dev-seed-${name}`, path, DESK, o],
      [`dev-seed-${name}-phone`, path, PHONE, { ...o, touch: true }],
    ])
  : [];

if (opts["dry-run"]) {
  if (SHOTS.length === 0) process.exit(0);
  console.log(
    `dry run, would ${opts.check ? "check, writing no PNG of a page" : `screenshot into ${opts.out}/`}, after the dev seed:`,
  );
  for (const [name, path, { width, height }] of SHOTS)
    console.log(`  ${name}.png  ${at(path)}  (${width}×${height})`);
  process.exit(0);
}
if (SHOTS.length === 0) process.exit(0);

Object.assign(SCREEN, { host: base.hostname, port: Number(base.port || 80) });
const { chromium } = await import("playwright-core");
mkdirSync(opts.out, { recursive: true });
const failures = [];
let count = 0;
const browser = await chromium.launch();
const shot = shooter({
  browser,
  at,
  out: opts.out,
  check: opts.check,
  fail: (what) => {
    failures.push(what);
    console.log(`FAIL ${what}`);
  },
  ok: (what) => {
    console.log(`ok   ${what}`);
    count++;
  },
});
try {
  // The screens' default zones (the main one) exist once Studio has read them.
  expect(
    await event(DEMO_HOST).call("GET", "/api/screen/zones"),
    200,
    "the screens' zones",
  );
  for (const [name, path, viewport, o] of SHOTS)
    await shot(name, path, viewport, SESSION, o);
  const state = expect(
    await event(DEMO_HOST).call("GET", "/api/screen/zones/main/state"),
    200,
    "the main zone's state",
  ).body;
  const still = standing(state.regions ?? []);
  if (still.length > 0) {
    failures.push(
      `main zone: nothing new within a minute in ${still.join(", ")}`,
    );
    console.log(
      `FAIL main zone: nothing new within a minute in ${still.join(", ")}`,
    );
  } else
    console.log("ok   main zone: something new in each box within a minute");
} catch (err) {
  failures.push(firstLine(err));
  console.log(`FAIL ${firstLine(err)}`);
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`demo-screenshots-dev-seed: ${failures.length} failed`);
  process.exit(1);
}
console.log(`demo-screenshots-dev-seed: ${count} views in ${opts.out}/`);
