// The guided pairing's Studio shots (#783), taken while the Screen studio's screens play
// (studio-shots.mjs). The screen paired for them is revoked afterwards, so the shots after these
// see the fleet as before.

const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

/**
 * The guided pairing (#783): Devices opened on a screen just paired, once on (the hall screen,
 * playing), once still waiting and once a minute later (a screen paired that never connects), and
 * the pair dialog saying a wrong code in its own words. `<hall>` and `<new>` are those screens' ids.
 */
export const PAIRED_PAGES = [
  ["screen-devices-paired", "/admin/screen/devices?paired=<hall>", DESK],
  ["screen-devices-paired-phone", "/admin/screen/devices?paired=<hall>", PHONE],
  ["screen-devices-waiting", "/admin/screen/devices?paired=<new>", DESK],
  ["screen-devices-waiting-phone", "/admin/screen/devices?paired=<new>", PHONE],
  ["screen-pair-error-phone", "/admin/screen/devices#pair=K7Q49WXP", PHONE],
  ["screen-devices-late", "/admin/screen/devices?paired=<new>", DESK],
  ["screen-devices-late-phone", "/admin/screen/devices?paired=<new>", PHONE],
];
/** A screen paired this long ago and never seen "has not connected" (src/studio/help.ts). */
const LATE_AFTER_MS = 62_000;

/** The pair dialog after Pair with a code no screen shows. */
const wrongCode = (ready) => async (page) => {
  await page.fill("#canccu-studio-pair-name", "Hall right");
  await page.click("#canccu-studio-pair button[type=submit]");
  await page.locator("[data-pair-error]:not([hidden])").waitFor();
  await ready(page);
};

/** Taken while the hall screen plays; `ready` is the Studio pages' own wait (studio-shots.mjs). */
export async function pairedShots({ demo, shot, hall, ready }) {
  const fresh = await demo.pair("New screen", null);
  const pairedAt = Date.now();
  try {
    for (const [name, path, viewport] of PAIRED_PAGES) {
      // The late shots wait out the minute a kiosk gets to connect.
      if (name.startsWith("screen-devices-late"))
        await new Promise((r) => setTimeout(r, Math.max(0, pairedAt + LATE_AFTER_MS - Date.now())));
      const url = path.replace("<hall>", hall.id).replace("<new>", fresh.id);
      await shot(name, url, viewport, {
        ready: name.endsWith("error-phone") ? wrongCode(ready) : ready,
      });
    }
  } finally {
    // Never seen, it would say "has not connected" on every later Devices shot.
    await demo.revoke(fresh.id);
  }
}
