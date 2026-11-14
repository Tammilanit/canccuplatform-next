// The screens' screenshots and their readability check (#191, L7, L9): every demo theme on the
// Pulse and the device-state frames, the default theme at 1080p and 4K, landscape and portrait,
// the others at 1080p; the claims of mockup 04 and the entrance zone of mockup 03 in the default
// theme. Each PNG is named as the view it shows, `theming-<theme>-screen-<view>-<w>x<h>.png`, and
// fails the run when its text does not read from across a hall (readability.mjs). States the demo
// stack cannot reach (refused, moved, archived, a claim from Moments) are the player's own answer
// to a device answer or a state the page is handed, so the frame is the real one. The other
// built-in layouts (#404, sheet 10) are shot landscape in every theme, at 4K in the default one,
// and Ambient once under an emergency takeover, which keeps its fixed red there too. Dashboard is
// handed sample statistics (#416), and shot once as the server draws it while they are missing.
import { expect } from "./client.mjs";
import { boxesGivenAway, statsApart, stripNamesCountdown } from "./dashboard.mjs";
import { publishTheme, saveZone, seedScreens } from "./fixture.mjs";
import {
  CLAIM_OF,
  MOTION_VIEWS,
  withMotion,
  withHeroItemOnly,
  withCounts,
  withOneScreen,
  withPhoto,
  withShowcase,
  withStats,
  withTakeover,
} from "./handed.mjs";
import { collectSamples, judgePage } from "./readability.mjs";

export const THEMES = ["terminal", "level-up", "default"];
const HD = [
  [1920, 1080],
  [1080, 1920],
];
const UHD = [
  [3840, 2160],
  [2160, 3840],
];
const sizesOf = (theme) => (theme === "default" ? [...HD, ...UHD] : HD);
/** The frames that differ by theme; the others are drawn before any theme reaches the page. */
const THEMED = ["pulse", "identify", "offline", "unassigned", "archived"];
const UNTHEMED = ["pairing", "refused", "moved", "unreachable", "check"];
const CLAIMS = ["claim-rail", "claim-hero", "claim-overlay", "claim-takeover"];
/** The built-ins besides the Pulse and Portrait: 16:9 each, so drawn landscape only. */
const LAYOUTS = ["dashboard", "hero", "split", "ambient"];
const landscapeOf = (theme) => sizesOf(theme).filter(([w, h]) => w > h);

/** What each view of #443 must show (sheets 10, 13 and 16), waited for before its shot. */
const NEW_VIEWS = {
  photo: ".canccu-widget__wall .canccu-widget__tile:nth-child(5) img",
  "photo-pop": ".canccu-widget__pop img",
  "ambient-online": ".canccu-region--online .canccu-widget__still",
  "portrait-right-now": ".canccu-region--right_now .canccu-widget__peak",
};

const nameOf = (theme, view, [w, h]) => `theming-${theme}-screen-${view}-${w}x${h}`;

/** Every PNG the run takes, in order, for the dry run. */
export function planned() {
  const out = [];
  for (const theme of THEMES) {
    for (const size of sizesOf(theme)) {
      for (const view of THEMED) out.push(nameOf(theme, view, size));
      if (theme !== "default") continue;
      for (const view of UNTHEMED) out.push(nameOf(theme, view, size));
    }
    for (const size of landscapeOf(theme))
      for (const view of LAYOUTS) out.push(nameOf(theme, view, size));
  }
  out.push(nameOf("default", "dashboard-showcase", HD[0]));
  out.push(nameOf("default", "dashboard-waiting", HD[0]));
  out.push(nameOf("default", "ambient-takeover", HD[0]));
  out.push(nameOf("default", "ambient-online", HD[0]));
  for (const size of HD)
    for (const view of ["photo", "photo-pop", "rail-empty", ...CLAIMS])
      out.push(nameOf("default", view, size));
  out.push(nameOf("default", "entrance", HD[1]));
  out.push(nameOf("default", "pulse-one-screen", HD[0]));
  out.push(nameOf("default", "portrait-right-now", HD[1]));
  return out;
}

export async function screenShots({ browser, demo, at, out, fail, ok, cookieOn }) {
  await seedScreens(demo);
  const devices = [];
  const pair = async (name, zone) => {
    const device = await demo.pair(name, zone);
    devices.push(device);
    return device;
  };
  const open = async ([width, height], cookie) => {
    const context = await browser.newContext({ viewport: { width, height } });
    if (cookie) await context.addCookies([cookieOn(cookie)]);
    // The screen's state and stream are the only things the page waits on; nothing leaves the stack.
    await context.route(/^https:\/\/next-event\.example\//, (route) => route.abort());
    const page = await context.newPage();
    // A request still routed when the context closes (a state poll) would throw out of the run.
    const close = async () => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    };
    return { page, close };
  };
  /** The screenshot, then its text against the readability rules. */
  const shot = async (name, page) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    const problems = judgePage(await page.evaluate(collectSamples));
    if (problems.length === 0) ok(`${name}.png`);
    else
      fail(
        `${name}: ${problems.length} readability problems\n      ${problems.slice(0, 8).join("\n      ")}`,
      );
  };
  const attempt = async (name, run) => {
    try {
      await run();
    } catch (err) {
      fail(`${name}: ${String(err?.message ?? err).split("\n")[0]}`);
    }
  };

  try {
    const main = await pair("Hall left", "main");
    const spare = await pair("Café TV", undefined);
    const entrance = await pair("Entrance", "entrance");
    for (const theme of THEMES) {
      await publishTheme(demo, theme);
      for (const size of sizesOf(theme)) {
        await attempt(nameOf(theme, "pulse", size), () => pulse(theme, size));
        await attempt(nameOf(theme, "unassigned", size), async () => {
          const { page, close } = await open(size, spare.cookie);
          await page.goto(at("/screen/"));
          await page.waitForSelector(".canccu-frame--unassigned");
          await settle(page);
          await shot(nameOf(theme, "unassigned", size), page);
          await close();
        });
        await attempt(nameOf(theme, "archived", size), () =>
          handed(theme, "archived", size, (s) => ({
            ...s,
            tenant: { ...s.tenant, status: "archived" },
          })),
        );
        if (theme === "default")
          for (const view of UNTHEMED)
            await attempt(nameOf(theme, view, size), () => untouched(view, size));
      }
      try {
        for (const size of landscapeOf(theme))
          for (const view of LAYOUTS)
            await attempt(nameOf(theme, view, size), () => layoutShot(theme, view, size));
        if (theme === "default")
          await attempt(nameOf(theme, "dashboard-showcase", HD[0]), () =>
            layoutShot(theme, "dashboard", HD[0], "dashboard-showcase"),
          );
        if (theme === "default")
          await attempt(nameOf(theme, "dashboard-waiting", HD[0]), () =>
            layoutShot(theme, "dashboard", HD[0], "dashboard-waiting"),
          );
        if (theme === "default")
          await attempt(nameOf(theme, "ambient-takeover", HD[0]), () =>
            layoutShot(theme, "ambient", HD[0], "ambient-takeover"),
          );
        if (theme === "default")
          await attempt(nameOf(theme, "ambient-online", HD[0]), () =>
            layoutShot(theme, "ambient", HD[0], "ambient-online"),
          );
      } finally {
        await saveZone(demo, "main", { layout_id: null });
      }
    }
    for (const size of HD) {
      await attempt(nameOf("default", "photo", size), () =>
        handed("default", "photo", size, withPhoto),
      );
      await attempt(nameOf("default", "photo-pop", size), () =>
        handed("default", "photo-pop", size, (s) => withPhoto(s, true)),
      );
      await attempt(nameOf("default", "rail-empty", size), () =>
        handed("default", "rail-empty", size, withHeroItemOnly),
      );
      for (const view of CLAIMS) {
        const [role, placed] = CLAIM_OF[view];
        await attempt(nameOf("default", view, size), () =>
          handed("default", view, size, (s) => ({
            ...s,
            regions: s.regions.map((r) => (r.role === role ? { ...r, claim: placed } : r)),
          })),
        );
      }
    }
    await attempt(nameOf("default", "entrance", HD[1]), async () => {
      const { page, close } = await open(HD[1], entrance.cookie);
      await page.goto(at("/screen/"));
      await layout(page, HD[1]);
      await page.waitForSelector(".canccu-widget--checkin_qr img");
      await settle(page);
      await shot(nameOf("default", "entrance", HD[1]), page);
      await close();
    });

    for (const { view, level, pack } of MOTION_VIEWS) {
      await attempt(nameOf("default", view, HD[0]), () =>
        handed("default", view, HD[0], withMotion(level, pack)),
      );
    }
    await attempt(nameOf("default", "pulse-one-screen", HD[0]), () =>
      handed("default", "pulse-one-screen", HD[0], withOneScreen),
    );
    await attempt(nameOf("default", "portrait-right-now", HD[1]), () =>
      handed("default", "portrait-right-now", HD[1], withCounts),
    );

    /** The Pulse, then identify over it, then the offline marker. */
    async function pulse(theme, size) {
      const { page, close } = await open(size, main.cookie);
      await page.goto(at("/screen/"));
      await layout(page, size);
      await railShowsAgenda(page);
      await tickerFitted(page, theme === "default" && size === HD[0]);
      await settle(page);
      await shot(nameOf(theme, "pulse", size), page);
      expect(
        await demo.call("POST", `/api/screen/devices/${main.id}/commands`, {
          body: { command: "identify" },
        }),
        202,
        "the identify command",
      );
      await page.waitForSelector(".canccu-identify");
      await shot(nameOf(theme, "identify", size), page);
      // The uplink drops: a stream that cannot connect. Going offline in the browser would leave
      // the stream already open connected, and the page would never miss it.
      await page.route("**/api/screen/device/stream", (route) => route.abort());
      await page.reload();
      await layout(page, size);
      await page.waitForSelector(".canccu-offline-marker", { timeout: 30_000 });
      await settle(page);
      await shot(nameOf(theme, "offline", size), page);
      await close();
    }

    /**
     * The main zone on another built-in layout, as the server composes it. Dashboard is handed
     * the statistics the demo stack has no bot for, and its showcase a spotlight in its hero too,
     * grown as the server grows it for one (a claim from Moments, which the demo stack has not).
     * `dashboard-waiting` is the server's own Dashboard without them.
     */
    async function layoutShot(theme, id, size, view = id) {
      await saveZone(demo, "main", { layout_id: id });
      if (view === "dashboard") return handed(theme, view, size, withStats);
      if (view === "dashboard-showcase")
        return handed(theme, view, size, (s) => withShowcase(withStats(s)));
      if (view === "ambient-takeover") return handed(theme, view, size, withTakeover);
      if (view === "ambient-online") return handed(theme, view, size, withCounts);
      const { page, close } = await open(size, main.cookie);
      await page.goto(at("/screen/"));
      await page.waitForSelector(`.canccu-layout--${id}`, { timeout: 30_000 });
      await railShowsAgenda(page);
      if (view === "dashboard-waiting") await boxesGivenAway(page);
      await settle(page);
      await shot(nameOf(theme, view, size), page);
      await close();
    }

    /** The page handed a changed state, with no stream to replace it before the shot. */
    async function handed(theme, view, size, change) {
      const { page, close } = await open(size, main.cookie);
      // The server picks the layout of the orientation a heartbeat reports, so the page first plays
      // as it is, and the state handed to it then has its layout.
      if (view !== "archived") {
        await page.goto(at("/screen/"));
        await layout(page, size);
      }
      await page.route("**/api/screen/device/stream", (route) => route.abort());
      await page.route("**/api/screen/device/state", async (route) => {
        try {
          const answer = await route.fetch();
          await route.fulfill({ response: answer, json: change(await answer.json()) });
        } catch {
          // The page closed while its poll was in flight: nobody waits for the answer.
        }
      });
      await page.goto(at("/screen/"));
      if (view === "archived") await page.waitForSelector(".canccu-frame--archived");
      else await layout(page, size);
      if (view.startsWith("dashboard")) await statsApart(page);
      // #443's views draw what they are named for before the shot.
      const drawn = NEW_VIEWS[view];
      if (drawn !== undefined) await page.waitForSelector(drawn, { timeout: 30_000 });
      if (view === "rail-empty") await railShowsIdle(page);
      else if (view === "dashboard-showcase") {
        await stripNamesCountdown(page);
        await tickerFitted(page, true);
      } else if (view === "ambient-takeover") await takeoverIsRed(page);
      else if (view.startsWith("motion-")) {
        // A strip of four frames 0.4 s apart from the spotlight's start (sheet 11, #445).
        // From the moment the box has faded in (1.5 s at calm), so each frame shows the level.
        await page.waitForFunction(() => {
          const box = document.querySelector(".canccu-spotlight");
          return box !== null && getComputedStyle(box).opacity === "1";
        });
        for (const n of [1, 2, 3, 4]) {
          await shot(`${nameOf(theme, view, size)}-f${n}`, page);
          await page.waitForTimeout(400);
        }
        return await close();
      } else if (!["archived", "claim-rail", "claim-takeover"].includes(view))
        await railShowsAgenda(page);
      await settle(page);
      await shot(nameOf(theme, view, size), page);
      await close();
    }

    /** The frames drawn before a theme: a new screen, and the device answers of contracts/screen.md. */
    async function untouched(view, size) {
      const answers = {
        refused: [403, { error: { code: "venue_ip_refused", message: "not at the venue" } }],
        moved: [409, { error: { code: "device_moved", message: "moved" } }],
        unreachable: [503, { error: { code: "unavailable", message: "down" } }],
      };
      // The loopback holds 3 open pairing codes at most (contracts/screen.md, Pairing), and each
      // pairing frame leaves one.
      if (view === "pairing")
        expect(
          await demo.call("DELETE", "/api/screen/pairing"),
          204,
          "clearing open pairing codes",
        );
      const { page, close } = await open(size, view === "pairing" ? null : main.cookie);
      if (view in answers) {
        const [status, json] = answers[view];
        await page.route("**/api/screen/device/state", (route) => route.fulfill({ status, json }));
        await page.route("**/api/screen/device/home", (route) =>
          route.fulfill({ json: { url: "https://next-event.example/screen/" } }),
        );
      }
      await page.goto(at(view === "check" ? "/screen/check" : "/screen/"));
      const ready = {
        pairing: ".canccu-pairing-code",
        check: ".canccu-selfcheck__row",
        unreachable: ".canccu-frame__foot:not(:empty)",
      };
      await page.waitForSelector(ready[view] ?? `.canccu-frame--${view}`);
      await page.waitForTimeout(300);
      if (view === "pairing") await expiryLast(page);
      await shot(nameOf("default", view, size), page);
      await close();
    }
  } finally {
    for (const device of devices) await demo.revoke(device.id);
  }
}

/** The layout of the screen's orientation is on the page (the heartbeat tells the server). */
async function layout(page, [width, height]) {
  await page.waitForFunction(
    (portrait) => {
      const el = document.querySelector(".canccu-layout");
      const ratio = Number(el?.style.getPropertyValue("--canccu-layout-ratio"));
      return el !== null && ratio > 0 && ratio < 1 === portrait;
    },
    height > width,
    { timeout: 30_000 },
  );
}

/**
 * The rail turns between the run of show and a countdown every 15 s (BUILT_IN_LAYOUTS); the shot
 * waits for the run of show, which mockup 02 draws there, so the hero's countdown is not shown twice.
 */
async function railShowsAgenda(page) {
  await page.waitForSelector(".canccu-region--rail > .canccu-widget--agenda_now.canccu-is-active", {
    timeout: 40_000,
  });
}

/**
 * The built-in ticker is never cut off (#442): every line that says it fits does, so one measured
 * off the page cannot pass. With `crawls`, where the demo's ticker is wider than its box, the line
 * crawls. A theme's own ticker template draws no built-in line and is left alone.
 */
async function tickerFitted(page, crawls) {
  const sel = ".canccu-widget--ticker .canccu-widget__line";
  await page.waitForFunction(
    (lines) => [...document.querySelectorAll(lines)].every((el) => el.dataset.fit !== undefined),
    sel,
    { timeout: 10_000 },
  );
  const lines = await page.$$eval(sel, (els) =>
    els.map((el) => ({ fit: el.dataset.fit, cut: el.scrollWidth > el.clientWidth + 1 })),
  );
  if (lines.some((line) => line.fit === "fits" && line.cut))
    throw new Error("the ticker's line is cut off: it was measured as fitting");
  if (crawls && !lines.some((line) => line.fit === "crawl"))
    throw new Error("the demo's long ticker does not crawl");
}

/** The emergency takeover wears its fixed red (claims.css) whatever the layout does to its cards. */
async function takeoverIsRed(page) {
  const sel = ".canccu-region--_full > .canccu-widget--announcement";
  await page.waitForSelector(sel, { timeout: 30_000 });
  const background = await page.$eval(sel, (card) => getComputedStyle(card).backgroundColor);
  if (background !== "rgb(185, 28, 28)")
    throw new Error(`the emergency takeover's background is ${background}, not its fixed red`);
}

/** The rail shows its idle choice, on both of its turns: never the emptied run of show. */
async function railShowsIdle(page) {
  await page.waitForSelector(".canccu-region--rail > .canccu-widget--logo.canccu-is-active", {
    timeout: 40_000,
  });
  if ((await page.$(".canccu-region--rail .canccu-widget--agenda_now")) !== null)
    throw new Error("the rail drew its run of show without a row");
  if ((await page.$(".canccu-region--rail .canccu-widget__zone")) !== null)
    throw new Error("the rail's logo names the zone: a second header, not the event's card");
}

/** The pairing code's expiry is the frame's last line, under the instruction (mockup 05, sheet 9). */
async function expiryLast(page) {
  const [foot, lines] = await Promise.all(
    [".canccu-frame__foot", ".canccu-frame--pairing .canccu-frame__bottom"].map((sel) =>
      page.$eval(sel, (node) => node.getBoundingClientRect().toJSON()),
    ),
  );
  if (foot.top < lines.bottom)
    throw new Error("the pairing frame's expiry sits above its instruction");
}

/** Fonts and images loaded, the entry fade done. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}
