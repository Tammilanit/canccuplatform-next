// The views scripts/demo-screenshots takes (#376), in one Chromium: every user-facing surface of
// the demo event, signed in with the CI session stub's cookie (deploy/compose.ci.yml), and a
// screen paired for the run in landscape and portrait. A user-visible PR's reviewer holds them
// against the mockups (AGENTS.md, A package run). A page that does not answer 200 itself or whose
// API reads are refused, or a screen that does not draw the event, fails the run, so a screenshot of an error never passes for a
// real one. Runs in Caddy's network namespace (scripts/demo-screenshots says why).
// Usage: node demo-screenshots.mjs [--dry-run] [--base BASE_URL] [--out DIR]
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  event,
  expect,
} from "../modules/screen/test/stack/client.mjs";

const { values: opts } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    base: { type: "string", default: "http://127.0.0.1" },
    out: { type: "string", default: "screenshots" },
  },
});
const base = new URL(opts.base);
const port = base.port ? `:${base.port}` : "";
// Chromium resolves `*.localhost` to the loopback itself, so the event's hostname reaches Caddy.
const at = (path) => `http://${DEMO_HOST}${port}${path}`;

const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
// Settings' Last changes sit beside the list only from 1440 px (docs/design/mockups.html, sheet 2).
const WIDE = { width: 1440, height: 900 };
const CHECK_IN = "@check-in";
// Each surface people use, at the width they use it at, full page. A new page joins here. The
// organiser shell's pages are shot at both widths: on a phone the menu becomes the bottom bar.
const SHELL = [
  ["settings", "/admin/settings"],
  ["health-view", "/admin/health-view"],
  ["profile", "/admin/profile"],
  ["people", "/admin/people"],
  ["studio", "/theming/studio/"],
  ["agenda", "/agenda/"],
  ["notify-topics", "/notify/admin/topics"],
];
const PAGES = [
  ...SHELL.flatMap(([name, path]) => [
    [name, path, DESK],
    [`${name}-phone`, path, PHONE],
  ]),
  ["settings-wide", "/admin/settings", WIDE],
  ["settings-admin", "/admin/settings/admin", DESK],
  ["studio-advanced", "/theming/studio/advanced", DESK],
  ["studio-history", "/theming/studio/history", DESK],
  ["hub-preview-phone", "/theming/studio/preview/hub", PHONE],
  ["agenda-new-item", "/agenda/items/new", DESK],
  ["agenda-quick-add-phone", "/agenda/add", PHONE],
  ["notify-new-topic", "/notify/admin/topics/new", DESK],
  ["check-in-phone", CHECK_IN, PHONE],
];
// The front door, signed out, and one page of the error family (an item that does not exist),
// each at both widths. The error page must answer its own status, not 200.
const SIGN_IN = "/admin/sign-in";
const MISSING = "/agenda/items/00000000-0000-0000-0000-000000000000/delay";
const OTHERS = [
  ["sign-in", SIGN_IN, DESK, { cookie: null }],
  ["sign-in-phone", SIGN_IN, PHONE, { cookie: null }],
  ["error-not-found", MISSING, DESK, { status: 404 }],
  ["error-not-found-phone", MISSING, PHONE, { status: 404 }],
];
// The Screen studio, shot while the screen below is paired, so Devices and Live show it. The pair
// dialog opens from the fragment a kiosk's QR carries; the editor is shot with a preview drawn.
const STUDIO_PAGES = [
  ["screen-live", "/admin/screen/live"],
  ["screen-devices", "/admin/screen/devices"],
  ["screen-zones", "/admin/screen/zones"],
  ["screen-zone-editor", "/admin/screen/zones/main"],
  ["screen-ticker", "/admin/screen/ticker"],
].flatMap(([name, path]) => [
  [name, path, DESK],
  [`${name}-phone`, path, PHONE],
]);
STUDIO_PAGES.push(
  ["screen-pair-phone", "/admin/screen/devices#pair=K7Q49WXP", PHONE],
  // Devices' Recent panel sits beside the screens from 1440 px, as Settings' last changes.
  ["screen-devices-wide", "/admin/screen/devices", WIDE],
);
// The Pulse with the demo run of show (seedPulse below): the rail's Now and next, not the idle
// logo every region falls back to while nothing runs. A screen that never draws it fails the shot.
const PULSE_DRAWN = ".canccu-widget--agenda_now";
const drawn = (frame) => frame.locator(PULSE_DRAWN).first().waitFor({ timeout: 30_000 });
// Live views keep their streams open, so there is no network idle: each zone view the page has
// loaded must draw the run of show, then a second lets the entry motion end. Through the iframe
// element: page.frames() gave the page's own document for an iframe the server drew with `src`.
const studioReady = async (page) => {
  await page
    .locator("[data-zone-preview]")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  const views = page.locator(".canccu-studio-thumb iframe[src]");
  const count = await views.count();
  for (let i = 0; i < count; i++) await drawn(views.nth(i).contentFrame());
  await page.waitForTimeout(1500);
};

// The demo event's main zone in the default theme. Every theme and the 4K sizes are #191's.
const SCREENS = [
  ["pulse-landscape", { width: 1920, height: 1080 }],
  ["pulse-portrait", { width: 1080, height: 1920 }],
];

if (opts["dry-run"]) {
  console.log(`dry run, would screenshot into ${opts.out}/:`);
  for (const [name, path, { width, height }] of PAGES) {
    const shown =
      path === CHECK_IN ? "/notify/check-in?p=arrival&c=<a fresh code>" : path;
    console.log(`  ${name}.png  ${at(shown)}  (${width}×${height})`);
  }
  for (const [name, path, { width, height }, o] of OTHERS) {
    const how = o.cookie === null ? ", signed out" : `, answering ${o.status}`;
    console.log(`  ${name}.png  ${at(path)}  (${width}×${height}${how})`);
  }
  for (const [name, { width, height }] of SCREENS) {
    console.log(
      `  ${name}.png  ${at("/screen/")}  (${width}×${height}, a paired screen)`,
    );
  }
  for (const [name, path, { width, height }] of STUDIO_PAGES) {
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, while paired)`,
    );
  }
  process.exit(0);
}

// client.mjs calls screen in its own namespace; here every call goes through Caddy, which routes
// each module's API by its path prefix, and the screen's calls then come from the loopback too.
Object.assign(SCREEN, { host: base.hostname, port: Number(base.port || 80) });
const demo = event(DEMO_HOST);
const { chromium } = await import("playwright-core");
mkdirSync(opts.out, { recursive: true });

const failures = [];
const fail = (what) => {
  failures.push(what);
  console.log(`FAIL ${what}`);
};
const firstLine = (err) =>
  String(err?.message ?? err)
    .split("\n")[0]
    .slice(0, 300);
const cookieOn = (pair) => {
  const cut = pair.indexOf("=");
  return {
    name: pair.slice(0, cut),
    value: pair.slice(cut + 1),
    domain: DEMO_HOST,
    path: "/",
  };
};
let count = 0;

const browser = await chromium.launch();
async function shot(
  name,
  path,
  viewport,
  cookie,
  { fullPage = true, ready, status = 200 } = {},
) {
  const url = at(path);
  const context = await browser.newContext({ viewport });
  try {
    if (cookie !== null) await context.addCookies([cookieOn(cookie)]);
    const page = await context.newPage();
    // A page whose data read is refused still answers 200 and draws an error view. A 404 is how
    // some reads say "nothing yet", so it passes.
    const refused = [];
    page.on("response", (r) => {
      const { pathname } = new URL(r.url());
      if (
        pathname.startsWith("/api/") &&
        (r.status() === 401 || r.status() === 403 || r.status() >= 500)
      ) {
        refused.push(`${pathname} ${r.status()}`);
      }
    });
    const res = await page.goto(url);
    if (res?.status() !== status)
      throw new Error(`answered HTTP ${res?.status()}, not ${status}`);
    // Signed out, a page sends the browser to the sign-in page, which answers 200.
    if (res.request().redirectedFrom())
      throw new Error(`was sent on to ${new URL(res.url()).pathname}`);
    // Pages read their data after load; one that keeps a stream open is shot after the wait.
    if (ready) await ready(page);
    else
      await page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => undefined);
    if (refused.length)
      throw new Error(`its API reads answered ${refused.join(", ")}`);
    await page.screenshot({ path: `${opts.out}/${name}.png`, fullPage });
    console.log(`ok   ${name}.png  ${url}`);
    count++;
  } catch (err) {
    fail(`${name}: ${url}: ${firstLine(err)}`);
  } finally {
    await context.close();
  }
}

// Saved changes, so Settings shows when its parts last changed and what changed.
async function changeSettings(module, values) {
  const now = expect(
    await demo.call("GET", `/api/admin/settings/${module}`),
    200,
    `the ${module} settings`,
  ).body;
  const body = {
    settings_version: now.settings_version,
    values: { ...now.values, ...values(now.values) },
  };
  const put = await demo.call("PUT", `/api/admin/settings/${module}`, { body });
  expect(put, 200, `a change to the ${module} settings`);
}

// What the Pulse shows comes from the event's data, and the demo event starts with none: a run of
// show (one item running, two next), a ticker line and the venue's Wi-Fi, all placeholder text.
// Added after the other pages' shots, so those still show a new event; the run of show and the
// ticker are removed again at the end (the Wi-Fi stays, as a rerun writes the same).
const MIN = 60_000;
const inMinutes = (n) => new Date(Date.now() + n * MIN).toISOString();
const seeded = [];
async function seedPulse() {
  const items = [
    ["Demo Game Cup: group stage", "tournament", -20, 70, "Main stage"],
    ["Dinner", "meal", 35, 95, "Café"],
    ["Demo Game Cup: finals", "tournament", 120, 210, "Main stage"],
  ];
  for (const [title, kind, start, end, location] of items) {
    const body = {
      title,
      kind,
      starts_at: inMinutes(start),
      ends_at: inMinutes(end),
      location,
      visibility: "public",
    };
    const added = await demo.call("POST", "/api/agenda/items", { body });
    seeded.push(expect(added, 201, `the run-of-show item ${title}`).body);
  }
  const text = "Welcome to Demo Event · the finals start on the main stage tonight";
  expect(
    await demo.call("PUT", "/api/screen/ticker", { body: { text, until: null } }),
    200,
    "the ticker line",
  );
  const venue = expect(
    await demo.call("GET", "/api/tenants/current/venue-info"),
    200,
    "the venue info",
  ).body;
  const wifi = [{ ssid: "DemoEvent", password: "demo-guest", note: "", visibility: "public" }];
  const put = await demo.call("PUT", "/api/tenants/current/venue-info", {
    body: { revision: venue.revision, house_rules: venue.house_rules ?? "", wifi },
  });
  expect(put, 200, "the venue's Wi-Fi");
}
async function unseedPulse() {
  for (const item of seeded) {
    const path = `/api/agenda/items/${item.id}?revision=${item.revision}`;
    expect(await demo.call("DELETE", path), 204, `removing ${item.title}`);
  }
  expect(await demo.call("DELETE", "/api/screen/ticker"), 204, "clearing the ticker");
}

let device;
try {
  try {
    await changeSettings("screen", (v) => ({
      offline_after_seconds: v.offline_after_seconds === 60 ? 45 : 60,
    }));
    await changeSettings("admin", () => ({ timezone: "UTC", language: "en" }));
  } catch (err) {
    fail(`settings changes: ${firstLine(err)}`);
  }
  for (const [name, page, viewport] of PAGES) {
    let path = page;
    if (path === CHECK_IN) {
      // The code rotates (contracts/notify.md, Check-in), so it is fetched right before its shot.
      try {
        const code = await demo.call(
          "GET",
          "/api/notify/check-in/code?purpose=arrival",
        );
        const url = new URL(
          expect(code, 200, "the check-in code").body.url,
          at("/"),
        );
        path = url.pathname + url.search;
      } catch (err) {
        fail(`${name}: ${firstLine(err)}`);
        continue;
      }
    }
    await shot(name, path, viewport, SESSION);
  }
  for (const [name, path, viewport, o] of OTHERS) {
    await shot(name, path, viewport, o.cookie === null ? null : SESSION, o);
  }

  // Paired as a kiosk would be (contracts/screen.md, Pairing), from a venue address.
  let reads = false;
  try {
    await seedPulse();
    device = await demo.pair("Screenshots", "main");
    const state = await demo.call("GET", "/api/screen/device/state", {
      cookie: device.cookie,
    });
    reads = Boolean(expect(state, 200, "the paired screen's state"));
  } catch (err) {
    fail(`pulse: ${firstLine(err)}`);
  }
  if (reads) {
    for (const [name, viewport] of SCREENS) {
      await shot(name, "/screen/", viewport, device.cookie, {
        fullPage: false,
        // The run of show is drawn only from a state read; a pairing or error page has none. The
        // player keeps its stream open, so there is no network idle: a second lets the motion end.
        ready: async (page) => {
          await drawn(page);
          await page.waitForTimeout(1000);
        },
      });
    }
    for (const [name, path, viewport] of STUDIO_PAGES) {
      await shot(name, path, viewport, SESSION, { ready: studioReady });
    }
  }
} finally {
  await browser.close();
  try {
    await unseedPulse();
  } catch (err) {
    fail(`cleanup: ${firstLine(err)}`);
  }
  // A rerun on the same stack would otherwise leave one more paired screen each time, or, after a
  // failed pairing, an open code of the 3 the loopback may hold (contracts/screen.md, Pairing).
  const [what, method, path] = device
    ? ["revoking the screen", "POST", `/api/screen/devices/${device.id}/revoke`]
    : ["clearing open pairing codes", "DELETE", "/api/screen/pairing"];
  try {
    expect(await demo.call(method, path), 204, what);
  } catch (err) {
    fail(`cleanup: ${firstLine(err)}`);
  }
}

if (failures.length) {
  console.log(`demo-screenshots: ${failures.length} failed`);
  process.exit(1);
}
console.log(`demo-screenshots: ${count} views in ${opts.out}/`);
