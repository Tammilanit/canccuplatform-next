// The views scripts/demo-screenshots takes (#376), in one Chromium: every user-facing surface of
// the demo event, signed in with the CI session stub's cookie (deploy/compose.ci.yml), and the
// screens of every demo theme with their readability check (#191,
// modules/screen/test/stack/screens.mjs). A user-visible PR's reviewer holds them against the
// mockups (AGENTS.md, A package run). A page that does not answer its own status or whose API
// reads are refused, a screen that does not draw the event, or a screen whose text does not read
// from across a hall fails the run, so a screenshot of an error never passes for a real one. Runs
// in Caddy's network namespace (scripts/demo-screenshots says why).
// Usage: node demo-screenshots.mjs [--dry-run] [--base BASE_URL] [--out DIR]
import { mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  event,
  expect,
} from "../modules/screen/test/stack/client.mjs";
import {
  guestReads,
  seedScreens,
} from "../modules/screen/test/stack/fixture.mjs";
import { planned, screenShots } from "../modules/screen/test/stack/screens.mjs";
import {
  PLAYLIST_PAGES,
  LAYOUT_PAGES,
  SCHEDULE_PAGES,
  STUDIO_PAGES,
  FROZEN_PAGES,
  studioShots,
} from "../modules/screen/test/stack/studio-shots.mjs";

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
  // Before the fixture fills the run of show, so its empty state stays checked.
  ["agenda-empty", "/agenda/", DESK],
  ["agenda-new-item", "/agenda/items/new", DESK],
  ["agenda-quick-add-phone", "/agenda/add", PHONE],
  ["notify-new-topic", "/notify/admin/topics/new", DESK],
  ["check-in-phone", CHECK_IN, PHONE],
];
// The brand kit (mockup 12, design sheet 6), after the screens, so its screen preview is screen's
// player of the main zone with the fixture's run of show: first with no draft, then with one in the
// draft's look, and Preview shows it at full size. The shot waits for the Pulse's run of show, never
// a player that has drawn only the event's name. A phone page is shot with the window as tall as
// the page, so the bottom bar sits at its foot, as a phone shows it, not over the middle.
const SCREEN_PREVIEW = "iframe[data-screen-preview]";
const LOGO = new URL("../events/demo/assets/logo.svg", import.meta.url);
const drawn = async (page) => {
  await page.waitForFunction(
    (sel) =>
      document
        .querySelector(sel)
        ?.getAttribute("src")
        ?.startsWith("/screen/zones/"),
    SCREEN_PREVIEW,
    { timeout: 10000 },
  );
  // The rail turns between the run of show and a countdown (modules/screen/test/stack/screens.mjs).
  await page
    .frameLocator(SCREEN_PREVIEW)
    .locator(
      ".canccu-region--rail > .canccu-widget--agenda_now.canccu-is-active",
    )
    .waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
};
const STUDIO = [
  ["studio", DESK, { ready: drawn }],
  ["studio-phone", PHONE, { ready: drawn, tall: true }],
];
const DRAFT = [
  ["studio-draft", DESK, { ready: drawn }],
  ["studio-draft-phone", PHONE, { ready: drawn, tall: true }],
  ["studio-draft-advanced", DESK, { path: "/theming/studio/advanced" }],
  [
    "studio-draft-preview",
    DESK,
    {
      fullPage: false,
      ready: async (page) => {
        await drawn(page);
        await page.click('[data-action="preview"]');
        await page.waitForTimeout(500);
      },
    },
  ],
];
// The run of show's day view (sheet 5, #400) on the fixture's filled day: at both widths, at 1440 px
// with the item beside the list and the live miniature of the main zone, which the shot waits for,
// an item a row picks, over the day, and the delay confirm a chip opens over the day. `pick` and
// `delay` name the fixture's item.
const MINI = ".canccu-agenda-mini iframe";
const miniDrawn = async (page) => {
  await page
    .frameLocator(MINI)
    .locator(
      ".canccu-region--rail > .canccu-widget--agenda_now.canccu-is-active",
    )
    .waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
};
// Adding an item where it goes (#429): the line between Dinner and the next item, pointed at on a
// desktop and long-pressed on a phone (a touch held through the DevTools protocol, which Playwright
// has no call for). The day's own add row ends the full-page shots above.
const gapAfter = (page, title) =>
  page
    .locator(".canccu-agenda-row", { hasText: title })
    .locator("xpath=../following-sibling::li[1]");
const pointGap = async (page) => {
  await gapAfter(page, "Dinner").locator("a").hover();
  await page.waitForTimeout(300);
};
const pressGap = async (page) => {
  const gap = gapAfter(page, "Dinner");
  // Clear of the bottom bar, which would take the touch.
  await gap.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await gap.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [{ x: box.x + box.width / 2, y: box.y }]);
  await page.waitForTimeout(700);
  await touch("touchEnd", []);
  await page.locator(".canccu-agenda-gap.is-shown").waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
};
const DAY_VIEW = [
  ["agenda", DESK, {}],
  ["agenda-gap", DESK, { ready: pointGap, fullPage: false }],
  ["agenda-gap-wide", WIDE, { ready: pointGap, fullPage: false }],
  [
    "agenda-gap-phone",
    PHONE,
    { ready: pressGap, fullPage: false, touch: true },
  ],
  ["agenda-wide", WIDE, { ready: miniDrawn }],
  ["agenda-phone", PHONE, {}],
  ["agenda-item", DESK, { pick: "Demo Game Cup, semis", fullPage: false }],
  [
    "agenda-item-phone",
    PHONE,
    { pick: "Demo Game Cup, semis", fullPage: false },
  ],
  ["agenda-delay", DESK, { delay: "Demo Game Cup, semis", fullPage: false }],
  [
    "agenda-delay-phone",
    PHONE,
    { delay: "Demo Game Cup, semis", fullPage: false },
  ],
];
const dayPath = (o, id) => {
  if (o.delay) return `/agenda/?delay=${id}&minutes=10`;
  return o.pick ? `/agenda/?item=${id}` : "/agenda/";
};
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
// The Delay page and Edit view of one item (#388), next to their mockups (docs/design/mockups.html):
// with the items after it, quiet, and the edit form. The items are made for the run.
// `chosen` is what the page's own form sends: then an unticked box means off.
const ITEM_PAGES = [
  [
    "agenda-delay-following",
    "/delay?minutes=10&following=1&announce=1&chosen=1",
    DESK,
  ],
  ["agenda-delay-quiet", "/delay?minutes=10&chosen=1", DESK],
  ["agenda-edit", "/edit", DESK],
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
  for (const [name, { width, height }] of STUDIO) {
    console.log(
      `  ${name}.png  ${at("/theming/studio/")}  (${width}×${height})`,
    );
  }
  for (const [name, { width, height }, o] of DRAFT) {
    const path = o.path ?? "/theming/studio/";
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, with a draft)`,
    );
  }
  for (const [name, { width, height }, o] of DAY_VIEW) {
    const path = dayPath(o, `<${o.pick ?? o.delay}>`);
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, the fixture's day)`,
    );
  }
  for (const [name, suffix, { width, height }] of ITEM_PAGES) {
    const path = `/agenda/items/<an item made for the run>${suffix}`;
    console.log(`  ${name}.png  ${at(path)}  (${width}×${height})`);
  }
  for (const name of planned()) {
    console.log(`  ${name}.png  ${at("/screen/")}  (a paired screen)`);
  }
  for (const [name, path, { width, height }] of STUDIO_PAGES) {
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, while two screens play)`,
    );
  }
  for (const [name, path, { width, height }] of FROZEN_PAGES) {
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, while frozen)`,
    );
  }
  for (const [name, path, { width, height }] of PLAYLIST_PAGES) {
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, with a playlist and its push)`,
    );
  }
  for (const [name, path, { width, height }] of LAYOUT_PAGES) {
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, the box editor, unsaved)`,
    );
  }
  for (const [name, path, { width, height }] of SCHEDULE_PAGES) {
    console.log(
      `  ${name}.png  ${at(path)}  (${width}×${height}, on windows made for it)`,
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
  { fullPage = true, ready, status = 200, tall = false, touch = false } = {},
) {
  const url = at(path);
  // A touch screen has no hover, so a phone page's `(hover: none)` rules apply.
  const finger = touch ? { hasTouch: true, isMobile: true } : {};
  const context = await browser.newContext({ viewport, ...finger });
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
    if (tall) {
      // A full-page capture would leave the sticky bottom bar where the window ended.
      const { width, height } = page.viewportSize();
      const full = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      if (full > height) await page.setViewportSize({ width, height: full });
      await page.waitForTimeout(500);
    } else if (fullPage && viewport.width === PHONE.width) {
      // A phone page is shot as tall as it is, so what sticks to the bottom (the bar, an action
      // row) sits where it does once the page is scrolled to its end, not over its middle.
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      if (height > viewport.height)
        await page.setViewportSize({ ...viewport, height });
    }
    await page.screenshot({
      path: `${opts.out}/${name}.png`,
      fullPage: fullPage && !tall,
    });
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

// An item starting `from` minutes from now, through the agenda's API; the run removes it after.
const made = [];
async function addItem(title, kind, from, minutes) {
  const time = (m) =>
    new Date(Date.now() + m * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const body = {
    title,
    kind,
    starts_at: time(from),
    ends_at: time(from + minutes),
    visibility: "public",
  };
  const res = await demo.call("POST", "/api/agenda/items", { body });
  const item = expect(res, 201, `adding ${title}`).body;
  made.push(item);
  return item;
}
async function removeMade() {
  for (const { id, title } of made.splice(0)) {
    try {
      const path = `/api/agenda/items/${id}?revision=1`;
      expect(await demo.call("DELETE", path), 204, `removing ${title}`);
    } catch (err) {
      fail(`cleanup: ${firstLine(err)}`);
    }
  }
}

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
  let item;
  try {
    item = await addItem("Demo Game Cup: semi-final", "tournament", 60, 75);
    await addItem("Board games corner", "activity", 150, 60);
    await addItem("Quiz night", "activity", 240, 60);
  } catch (err) {
    fail(`agenda items for the shots: ${firstLine(err)}`);
  }
  if (item) {
    for (const [name, suffix, viewport] of ITEM_PAGES) {
      await shot(name, `/agenda/items/${item.id}${suffix}`, viewport, SESSION);
    }
  }
  // Gone before the fixture: it finds its run of show by title and would take these.
  await removeMade();

  try {
    await seedScreens(demo);
    const { items } = expect(
      await demo.call("GET", "/api/agenda/items"),
      200,
      "the run of show",
    ).body;
    for (const [name, viewport, o] of DAY_VIEW) {
      const title = o.pick ?? o.delay;
      const id = title && items.find((i) => i.title === title)?.id;
      if (title && !id) throw new Error(`the fixture has no "${title}"`);
      await shot(name, dayPath(o, id), viewport, SESSION, o);
    }
  } catch (err) {
    fail(`the run of show's day: ${firstLine(err)}`);
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
  for (const [name, viewport, o] of STUDIO) {
    await shot(name, "/theming/studio/", viewport, SESSION, o);
  }
  // After the screens, so the zone plays the fixture's run of show: a draft with mockup 12's
  // brand and the demo logo, which the previews draw before anything is published.
  try {
    const draft = await demo.call("POST", "/api/theming/draft", {
      body: { from: "defaults" },
    });
    let version = expect(draft, 201, "a draft").body.draft_version;
    const logo = await demo.call(
      "PUT",
      `/api/theming/draft/file?path=images/logo.svg&draft_version=${version}`,
      { body: readFileSync(LOGO), type: "image/svg+xml" },
    );
    version = expect(logo, 200, "the draft's logo").body.draft_version;
    const brand = {
      primary: "#ff7a45",
      accent: "#7c5cff",
      scheme: "dark",
      logo: "images/logo.svg",
    };
    const set = await demo.call("PUT", "/api/theming/draft/brand", {
      body: { draft_version: version, ...brand },
    });
    version = expect(set, 200, "the draft's brand").body.draft.draft_version;
    try {
      for (const [name, viewport, o] of DRAFT) {
        await shot(name, o.path ?? "/theming/studio/", viewport, SESSION, o);
      }
    } finally {
      // Left behind, the draft would greet the next run's "studio" shot instead of the start.
      const gone = await demo.call(
        "DELETE",
        `/api/theming/draft?draft_version=${version}`,
      );
      expect(gone, 204, "discarding the draft");
    }
  } catch (err) {
    fail(`studio draft: ${firstLine(err)}`);
  }
  // The Screen studio, on the fixture and theme the screens left.
  try {
    await studioShots({
      browser,
      demo,
      at,
      cookieOn,
      shot: (name, path, viewport, o) => shot(name, path, viewport, SESSION, o),
    });
  } catch (err) {
    fail(`studio: ${firstLine(err)}`);
  }
} finally {
  await browser.close();
  await removeMade();
  // The pairing frame leaves an open code of the 3 the loopback may hold (contracts/screen.md,
  // Pairing); the screens revoke their own devices.
  try {
    expect(
      await demo.call("DELETE", "/api/screen/pairing"),
      204,
      "clearing open pairing codes",
    );
  } catch (err) {
    fail(`cleanup: ${firstLine(err)}`);
  }
}

if (failures.length) {
  console.log(`demo-screenshots: ${failures.length} failed`);
  process.exit(1);
}
console.log(`demo-screenshots: ${count} views in ${opts.out}/`);
