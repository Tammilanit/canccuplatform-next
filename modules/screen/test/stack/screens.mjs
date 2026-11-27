// The screens' screenshots and their readability check (#191, L7, L9): every demo theme on the
// Pulse and the device-state frames, the default theme at 1080p and 4K, landscape and portrait,
// the others at 1080p; the claims of mockup 04, an emergency in the hero and the entrance zone of
// mockup 03 in the default theme. Each PNG is named as the view it shows,
// `theming-<theme>-screen-<view>-<w>x<h>.png`, and fails the run when its text does not read from
// across a hall (readability.mjs). States the demo stack cannot reach (refused, moved, archived, a
// claim from Moments) are the player's own answer to a device answer or a state the page is
// handed, so the frame is the real one. The other built-in layouts (#404, sheet 10) are shot
// landscape in every theme, at 4K in the default one, and Ambient once under an emergency
// takeover, which keeps its fixed red there too. Dashboard is handed sample statistics (#416),
// and shot once as the server draws it while they are missing.
// The Director's strips (#447, director.mjs) are frames a few seconds apart.
import { cleanUp } from "./cleanup.mjs";
import { CLEAR_CHECKS, panelFilled, venueOnOneLine } from "./clear.mjs";
import { expect } from "./client.mjs";
import { boxesGivenAway, graphsScaled, statsApart, stripNamesCountdown } from "./dashboard.mjs";
import { DIRECTOR_STRIPS, directorStrip, withDirector } from "./director.mjs";
import { LIVING_STRIPS, LIVING_THEMES, livingStrip, serveSlide, withLiving } from "./living.mjs";
import { publishTheme, saveZone, seedScreens, withQuickVenueRail } from "./fixture.mjs";
import { storiesOff } from "./stories.mjs";
import { withFoodClaim } from "./food.mjs";
import { MOTION_VIEWS, STAGE_VIEWS, withHeroArt, withMotion, withStage } from "./handed-stage.mjs";
import {
  CLAIM_OF,
  withHeroItemOnly,
  withCounts,
  withOneScreen,
  withPhoto,
  withHeroShowcase,
  withShowcase,
  withSmallShowcase,
  withStats,
  withTakeover,
  holdStream,
  stillOnline,
} from "./handed.mjs";
import { collectSamples, judgePage } from "./readability.mjs";
import { untouched } from "./frame-shots.mjs";
import { handStates, screenPages } from "./screen-pages.mjs";
import {
  THEMES,
  HD,
  sizesOf,
  UNTHEMED,
  CLAIMS,
  LAYOUTS,
  DEFAULT_LAYOUT_VIEWS,
  FOOD_VIEWS,
  foodSizes,
  landscapeOf,
  NEW_VIEWS,
  SURGE_MS,
  STAGE_FADE_MS,
  nameOf,
} from "./screen-views.mjs";
import {
  layout,
  agendaSettled,
  tickerFitted,
  emergencyIsRed,
  railShowsIdle,
  settle,
} from "./screen-waits.mjs";

import { ANNOUNCE_THEMES, ANNOUNCE_VIEWS, annSettled, annSizes } from "./announce-levels.mjs";

export { THEMES, planned } from "./screen-views.mjs";

export async function screenShots({ browser, demo, at, out, fail, ok, cookieOn, check, only }) {
  // Before the run of show, whose items start Moments' stories (stories.mjs says why).
  const storiesBack = await storiesOff(demo);
  const devices = [];
  const pair = async (name, zone) => {
    const device = await demo.pair(name, zone);
    devices.push(device);
    return device;
  };
  const { open, attempt } = screenPages({ browser, cookieOn, fail, only });
  /** The screenshot, then its text against the readability rules. */
  const shot = async (name, page) => {
    // Taken in the merge queue's check too: without it the next view of the same screen did not
    // draw within its wait (CI, #461), as the shot paces the views; the queue uploads none.
    await page.screenshot({ path: `${out}/${name}.png` });
    const problems = judgePage(await page.evaluate(collectSamples));
    if (problems.length === 0) ok(`${name}.png`);
    else
      fail(
        `${name}: ${problems.length} readability problems\n      ${problems.slice(0, 8).join("\n      ")}`,
      );
  };
  const playing = async (name, page) => {
    await stillOnline(page);
    await shot(name, page);
  };

  let threw = false;
  try {
    await seedScreens(demo);
    const main = await pair("Hall left", "main");
    const spare = await pair("Café TV", undefined);
    const entrance = await pair("Entrance", "entrance");
    for (const theme of THEMES) {
      await publishTheme(demo, theme);
      for (const size of sizesOf(theme, check)) {
        await attempt(nameOf(theme, "pulse", size), () =>
          withQuickVenueRail(demo, () => pulse(theme, size)),
        );
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
            await attempt(nameOf(theme, view, size), () =>
              untouched({ demo, open, at, shot, cookie: main.cookie }, view, size),
            );
      }
      try {
        for (const size of landscapeOf(theme, check))
          for (const view of LAYOUTS)
            await attempt(nameOf(theme, view, size), () => layoutShot(theme, view, size));
        await attempt(nameOf(theme, "dashboard-showcase", HD[0]), () =>
          layoutShot(theme, "dashboard", HD[0], "dashboard-showcase"),
        );
        if (theme === "default")
          for (const [view, id] of DEFAULT_LAYOUT_VIEWS)
            await attempt(nameOf(theme, view, HD[0]), () => layoutShot(theme, id, HD[0], view));
        // The announcement's levels (#780): handed as Screen places them, measured, then shot.
        for (const v of ANNOUNCE_THEMES.includes(theme) ? ANNOUNCE_VIEWS : [])
          for (const size of annSizes(v, check))
            await attempt(nameOf(theme, v.view, size), async () => {
              await saveZone(demo, "main", { layout_id: v.layout });
              await handed(theme, v.view, size, v.make(Date.now()));
            });
      } finally {
        await saveZone(demo, "main", { layout_id: null });
      }
      // #787's strips, in this theme while it is published.
      if (LIVING_THEMES.includes(theme))
        for (const size of HD)
          for (const { view } of LIVING_STRIPS)
            await attempt(nameOf(theme, view, size), () =>
              handed(theme, view, size, withLiving(view)),
            );
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
    for (const view of FOOD_VIEWS)
      for (const size of foodSizes(check))
        await attempt(nameOf("default", view, size), () =>
          handed("default", view, size, withFoodClaim(view)),
        );
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
    await attempt(nameOf("default", "portrait-showcase", HD[1]), () =>
      handed("default", "portrait-showcase", HD[1], withHeroShowcase),
    );
    for (const { view, level, surge } of STAGE_VIEWS) {
      await attempt(nameOf("default", view, HD[0]), () =>
        handed("default", view, HD[0], withStage(level, surge, SURGE_MS)),
      );
    }
    await attempt(nameOf("default", "pulse-hero-art", HD[0]), () =>
      handed("default", "pulse-hero-art", HD[0], withHeroArt),
    );
    for (const { view } of DIRECTOR_STRIPS)
      await attempt(nameOf("default", view, HD[0]), () =>
        handed("default", view, HD[0], withDirector(view)),
      );

    /** The Pulse, then identify over it, then the offline marker. */
    async function pulse(theme, size) {
      const { page, close } = await open(size, main.cookie);
      await page.goto(at("/screen/"));
      await layout(page, size);
      await tickerFitted(page, theme === "default" && size === HD[0]);
      await agendaSettled(page);
      await panelFilled(page);
      if (theme === "default") await venueOnOneLine(page);
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
      // The test pattern Studio sends after a pairing (#783) takes identify's place over the page.
      expect(
        await demo.call("POST", `/api/screen/devices/${main.id}/commands`, {
          body: { command: "test_pattern" },
        }),
        202,
        "the test_pattern command",
      );
      await page.waitForSelector(".canccu-test-pattern");
      await shot(nameOf(theme, "test-pattern", size), page);
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
     * grown as the server grows it for one (a claim from Moments, which the demo stack has not),
     * or at the hero's size for a zone that does not grow it (`dashboard-showcase-small`).
     * `dashboard-waiting` is the server's own Dashboard without them.
     */
    async function layoutShot(theme, id, size, view = id) {
      await saveZone(demo, "main", { layout_id: id });
      if (view === "dashboard") return handed(theme, view, size, withStats);
      if (view === "dashboard-showcase")
        return handed(theme, view, size, (s) => withShowcase(withStats(s)));
      if (view === "dashboard-showcase-small")
        return handed(theme, view, size, (s) => withSmallShowcase(withStats(s)));
      if (view === "ambient-takeover") return handed(theme, view, size, withTakeover);
      if (view === "ambient-online") return handed(theme, view, size, withCounts);
      if (view === "ambient-showcase") return handed(theme, view, size, withHeroShowcase);
      const { page, close } = await open(size, main.cookie);
      await page.goto(at("/screen/"));
      await page.waitForSelector(`.canccu-layout--${id}`, { timeout: 30_000 });
      await agendaSettled(page);
      if (view === "dashboard-waiting") await boxesGivenAway(page);
      if (view === "hero") await panelFilled(page);
      await shot(nameOf(theme, view, size), page);
      await close();
    }

    /**
     * The surge's strip: the stage before the tint (the state as the server had it a moment
     * earlier), while it holds with the game's art, and after it ended on the screen's own clock.
     */
    async function surgeStrip(page, theme, view, size, close, race) {
      await page.waitForSelector(".canccu-stage--art");
      await page.waitForTimeout(STAGE_FADE_MS + 200);
      await playing(nameOf(theme, `${view}-during`, size), page);
      await page.waitForFunction(() => !document.querySelector(".canccu-stage--tinted"), null, {
        timeout: SURGE_MS + 5000,
      });
      await page.waitForTimeout(STAGE_FADE_MS + 200);
      await playing(nameOf(theme, `${view}-after`, size), page);
      await close();
      if (race.lost) return;
      // Before: the same stage at the same level, no box asking yet.
      await handed(theme, `${view}-before`, size, withStage("lively", false));
    }

    /**
     * The page handed a changed state, its stream held open and empty so nothing replaces it. A
     * state that cannot be handed (an answer not JSON, a `change` that throws) fails the view with
     * its own error, not with the layout wait it would otherwise run out.
     */
    async function handed(theme, view, size, change) {
      const { page, close } = await open(size, main.cookie);
      // The server picks the layout of the orientation a heartbeat reports, so the page first plays
      // as it is, and the state handed to it then has its layout.
      if (view !== "archived") {
        await page.goto(at("/screen/"));
        await layout(page, size);
      }
      await holdStream(page);
      const { unhanded, close: closeView } = await handStates(page, close, change);
      // When `unhanded` wins, `shown` runs on: `race.lost` keeps it from opening another page
      // after the run's cleanup closed every page (stage-surge's "-before").
      const race = { lost: false };
      await Promise.race([
        shown(theme, view, size, page, closeView, race),
        unhanded.catch((err) => {
          race.lost = true;
          throw err;
        }),
      ]);
    }

    /** The handed page drawing `view`, checked, and its shots. */
    async function shown(theme, view, size, page, close, race) {
      if (view === "living-slideshow") await serveSlide(page);
      await page.goto(at("/screen/"));
      if (view === "archived") await page.waitForSelector(".canccu-frame--archived");
      else await layout(page, size);
      // A showcase pauses Right now, the Dashboard's one `stats` box (#447): no numbers to keep apart.
      if (view.startsWith("dashboard") && view !== "dashboard-showcase") await statsApart(page);
      if (view === "dashboard") await graphsScaled(page);
      // #443's views draw what they are named for before the shot.
      const drawn = NEW_VIEWS[view];
      if (drawn !== undefined) await page.waitForSelector(drawn, { timeout: 30_000 });
      // A showcase's checks measure its hero once the claim has faded in and its fonts are in.
      const showcase = view.includes("showcase");
      if (!showcase) await CLEAR_CHECKS[view]?.(page);
      let settled = settle;
      if (view === "rail-empty") await railShowsIdle(page);
      else if (view === "dashboard-showcase") {
        await stripNamesCountdown(page);
        // Level-up draws its own ticker template: no built-in line there to crawl.
        await tickerFitted(page, theme !== "level-up");
      } else if (view === "ambient-takeover") await emergencyIsRed(page, "_full");
      else if (view === "claim-hero-emergency") await emergencyIsRed(page, "hero");
      else if (view === "stage-surge")
        return await surgeStrip(page, theme, view, size, close, race);
      else if (view.startsWith("living-")) {
        await settle(page);
        await livingStrip(page, view, (f) => shot(`${nameOf(theme, view, size)}-${f}`, page));
        return await close();
      } else if (view.startsWith("director-") || view === "choreographer") {
        await settle(page);
        await directorStrip(page, view, (f) => shot(`${nameOf(theme, view, size)}-${f}`, page));
        return await close();
      } else if (view.startsWith("stage-") || view === "pulse-hero-art") {
        // The kind and phase tints fade in over the stage's longest fade.
        await page.waitForSelector(".canccu-stage--phase-peak");
        await page.waitForTimeout(STAGE_FADE_MS + 200);
      } else if (view.startsWith("motion-")) {
        // A strip of four frames 0.4 s apart from the spotlight's start (sheet 11, #445).
        // From the moment the box has faded in (1.5 s at calm), so each frame shows the level.
        await page.waitForFunction(() => {
          const box = document.querySelector(".canccu-spotlight");
          return box !== null && getComputedStyle(box).opacity === "1";
        });
        for (const n of [1, 2, 3, 4]) {
          await playing(`${nameOf(theme, view, size)}-f${n}`, page);
          await page.waitForTimeout(400);
        }
        return await close();
      } else if (ANNOUNCE_VIEWS.some((v) => v.view === view)) {
        settled = (p) =>
          annSettled(
            p,
            ANNOUNCE_VIEWS.find((v) => v.view === view),
          );
      } else if (!["archived", "claim-rail", "claim-takeover"].includes(view))
        settled = agendaSettled;
      await settled(page);
      if (showcase) await CLEAR_CHECKS[view]?.(page);
      await playing(nameOf(theme, view, size), page);
      await close();
    }
  } catch (err) {
    threw = true;
    throw err;
  } finally {
    await cleanUp([...devices.map((device) => () => demo.revoke(device.id)), storiesBack], threw);
  }
}
