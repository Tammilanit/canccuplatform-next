// The views scripts/demo-screenshots takes (#376), in one Chromium: every user-facing surface of
// the demo event, signed in with the CI session stub's cookie (deploy/compose.ci.yml), and the
// screens of every demo theme with their readability check (#191,
// modules/screen/test/stack/screens.mjs). A user-visible PR's reviewer holds them against the
// mockups (AGENTS.md, A package run). A page that does not answer 200 itself or whose API reads
// are refused, a screen that does not draw the event, or a screen whose text does not read from
// across a hall fails the run, so a screenshot of an error never passes for a real one. Runs in
// Caddy's network namespace (scripts/demo-screenshots says why).
// Usage: node demo-screenshots.mjs [--dry-run] [--base BASE_URL] [--out DIR]
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEMO_HOST, SCREEN, SESSION, event, expect } from "../modules/screen/test/stack/client.mjs";
import { guestReads } from "../modules/screen/test/stack/fixture.mjs";
import { planned, screenShots } from "../modules/screen/test/stack/screens.mjs";

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
const CHECK_IN = "@check-in";
// Each surface people use, at the width they use it at, full page. A new page joins here.
const PAGES = [
  ["settings", "/admin/settings", DESK],
  ["settings-admin", "/admin/settings/admin", DESK],
  ["health-view", "/admin/health-view", DESK],
  ["profile", "/admin/profile", DESK],
  ["studio", "/theming/studio/", DESK],
  ["studio-advanced", "/theming/studio/advanced", DESK],
  ["studio-history", "/theming/studio/history", DESK],
  ["hub-preview-phone", "/theming/studio/preview/hub", PHONE],
  ["agenda", "/agenda/", DESK],
  ["agenda-new-item", "/agenda/items/new", DESK],
  ["agenda-quick-add-phone", "/agenda/add", PHONE],
  ["notify-topics", "/notify/admin/topics", DESK],
  ["check-in-phone", CHECK_IN, PHONE],
];

if (opts["dry-run"]) {
  console.log(`dry run, would screenshot into ${opts.out}/:`);
  for (const [name, path, { width, height }] of PAGES) {
    const shown = path === CHECK_IN ? "/notify/check-in?p=arrival&c=<a fresh code>" : path;
    console.log(`  ${name}.png  ${at(shown)}  (${width}×${height})`);
  }
  for (const name of planned()) console.log(`  ${name}.png  ${at("/screen/")}  (a paired screen)`);
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
  return { name: pair.slice(0, cut), value: pair.slice(cut + 1), domain: DEMO_HOST, path: "/" };
};
let count = 0;

const browser = await chromium.launch();
async function shot(name, path, viewport, cookie, { fullPage = true, ready } = {}) {
  const url = at(path);
  const context = await browser.newContext({ viewport });
  try {
    await context.addCookies([cookieOn(cookie)]);
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
    if (res?.status() !== 200) throw new Error(`answered HTTP ${res?.status()}, not 200`);
    // Signed out, a page sends the browser to the sign-in page, which answers 200.
    if (res.request().redirectedFrom())
      throw new Error(`was sent on to ${new URL(res.url()).pathname}`);
    // Pages read their data after load; one that keeps a stream open is shot after the wait.
    if (ready) await ready(page);
    else await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    if (refused.length) throw new Error(`its API reads answered ${refused.join(", ")}`);
    await page.screenshot({ path: `${opts.out}/${name}.png`, fullPage });
    console.log(`ok   ${name}.png  ${url}`);
    count++;
  } catch (err) {
    fail(`${name}: ${url}: ${firstLine(err)}`);
  } finally {
    await context.close();
  }
}

try {
  for (const [name, page, viewport] of PAGES) {
    let path = page;
    if (path === CHECK_IN) {
      // The code rotates (contracts/notify.md, Check-in), so it is fetched right before its shot.
      try {
        const code = await demo.call("GET", "/api/notify/check-in/code?purpose=arrival");
        const url = new URL(expect(code, 200, "the check-in code").body.url, at("/"));
        path = url.pathname + url.search;
      } catch (err) {
        fail(`${name}: ${firstLine(err)}`);
        continue;
      }
    }
    await shot(name, path, viewport, SESSION);
  }

  // A guest who never checked in reads every public page; the screens play without it too.
  try {
    await guestReads(demo);
  } catch (err) {
    fail(`guest: ${firstLine(err)}`);
  }
  try {
    await screenShots({
      browser,
      demo,
      at,
      out: opts.out,
      cookieOn,
      fail,
      ok: (name) => {
        console.log(`ok   ${name}`);
        count++;
      },
    });
  } catch (err) {
    fail(`screens: ${firstLine(err)}`);
  }
} finally {
  await browser.close();
  // The pairing frame leaves an open code of the 3 the loopback may hold (contracts/screen.md,
  // Pairing); the screens revoke their own devices.
  try {
    expect(await demo.call("DELETE", "/api/screen/pairing"), 204, "clearing open pairing codes");
  } catch (err) {
    fail(`cleanup: ${firstLine(err)}`);
  }
}

if (failures.length) {
  console.log(`demo-screenshots: ${failures.length} failed`);
  process.exit(1);
}
console.log(`demo-screenshots: ${count} views in ${opts.out}/`);
