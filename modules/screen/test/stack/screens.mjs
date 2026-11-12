// The screens' screenshots and their readability check (#191, L7, L9): every demo theme on the
// Pulse and the device-state frames, the default theme at 1080p and 4K, landscape and portrait,
// the others at 1080p; the claims of mockup 04 and the entrance zone of mockup 03 in the default
// theme. Each PNG is named as the view it shows, `theming-<theme>-screen-<view>-<w>x<h>.png`, and
// fails the run when its text does not read from across a hall (readability.mjs). States the demo
// stack cannot reach (refused, moved, archived, a claim from Moments) are the player's own answer
// to a device answer or a state the page is handed, so the frame is the real one.
import { expect } from "./client.mjs";
import { publishTheme, seedScreens } from "./fixture.mjs";
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
  }
  for (const size of HD)
    for (const view of ["photo", ...CLAIMS]) out.push(nameOf("default", view, size));
  out.push(nameOf("default", "entrance", HD[1]));
  return out;
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const claim = (role, template, content) => ({
  override_id: `ov_${role}`,
  hidden: false,
  role,
  rank: role === "full" ? 100 : 80,
  template,
  content,
  steps: null,
  sound: null,
  on_end: "resume",
  starts_at: ago(1000),
  ends_at: null,
  expires_at: null,
});
// A cover and a photo drawn here: the page takes data: images (src/tree.ts).
const picture = (a, b) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/><circle cx="80" cy="52" r="22" fill="#fff" fill-opacity=".35"/><rect x="44" y="80" width="72" height="30" rx="12" fill="#fff" fill-opacity=".35"/></svg>`,
  ).toString("base64")}`;
/** What each claim view puts in the state (mockup 04). */
const CLAIM_OF = {
  "claim-rail": ["rail", claim("rail", "announcement", { title: "Dinner is served", body: "Café, until 19:15", level: "info" })],
  "claim-hero": ["hero", claim("hero", "hot_game", { game: { id: "g_1", name: "Demo Game", cover_url: picture("#7c3aed", "#0ea5e9") }, players: 14, since: ago(600_000) })],
  "claim-overlay": ["overlay", claim("overlay", "match_called", { label: "Team Alpha vs Team Gamma", game_name: "Go to Stage 2 · voice: Match 7", teams: [] })],
  "claim-takeover": ["full", claim("full", "announcement", { title: "Please leave the hall", body: "Follow the exit signs.", level: "emergency" })],
}; // prettier-ignore

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
    }
    for (const size of HD) {
      await attempt(nameOf("default", "photo", size), () =>
        handed("default", "photo", size, withPhoto),
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

    /** The Pulse, then identify over it, then the offline marker. */
    async function pulse(theme, size) {
      const { page, close } = await open(size, main.cookie);
      await page.goto(at("/screen/"));
      await layout(page, size);
      await railShowsAgenda(page);
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
      if (!["archived", "claim-rail", "claim-takeover"].includes(view)) await railShowsAgenda(page);
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
      await shot(nameOf("default", view, size), page);
      await close();
    }
  } finally {
    for (const device of devices) await demo.revoke(device.id);
  }
}

/** A photo in the hero beside the countdown, so the hero rotates (mockup 03's café). */
function withPhoto(s) {
  const photo = {
    widget: "photo",
    template: null,
    dwell_seconds: 3600,
    stale_after_seconds: null,
    view: { url: picture("#1e3a8a", "#6d28d9"), caption: 'New photo · "Setup day"', author_name: "Player One", qr: null, stale: false, empty: false },
  }; // prettier-ignore
  return {
    ...s,
    regions: s.regions.map((r) =>
      r.role !== "hero" || r.idle_view === null
        ? r
        : { ...r, order: [0, 1], widgets: [photo, { ...r.idle_view, template: null, dwell_seconds: 15, stale_after_seconds: null }] },
    ), // prettier-ignore
  };
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

/** Fonts and images loaded, the entry fade done. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}
