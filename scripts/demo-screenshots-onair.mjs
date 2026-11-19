/**
 * On air at 1280 px with 1, 2, 4 and 8 zones, and at 1920 px (#638; docs/design/moments-on-air.svg).
 * The demo's zones are set aside (only those nothing refers to can go: the others keep their place
 * and a count below them is skipped with a note), the shot's zones added, and everything put back.
 */
import { SESSION } from "../modules/screen/test/stack/client.mjs";
import { DESK, firstLine } from "./demo-screenshots-shot.mjs";

const WIDE = { width: 1920, height: 1080 };
export const COUNTS = [1, 2, 4, 8];

/** Waits until the page draws exactly `n` zone cards: Moments learns a zone from Screen's events, which lag up to a minute on a loaded CI stack (30 s timed out in CI). */
const drawn = (n) => async (page) => {
  await page.waitForFunction(
    (want) => document.querySelectorAll(".moments-zone").length === want,
    n,
    { timeout: 150_000 },
  );
  await page.waitForTimeout(500);
};

export async function onAirZoneShots({ demo, shot, fail }) {
  const removed = [];
  const added = [];
  try {
    const list = await demo.call("GET", "/api/screen/zones");
    let keys = list.body.zones.map((z) => z.key);
    for (const zone of list.body.zones) {
      if (zone.key === "main") continue;
      const gone = await demo.call("DELETE", `/api/screen/zones/${zone.key}`);
      if (gone.status === 204) removed.push(zone);
    }
    keys = keys.filter((k) => !removed.some((z) => z.key === k));
    for (const n of COUNTS) {
      if (n < keys.length) {
        console.log(
          `  on air with ${n} zones skipped: ${keys.length} zones are in use`,
        );
        continue;
      }
      while (keys.length < n) {
        const key = `shot-zone-${keys.length + 1}`;
        const made = await demo.call("POST", "/api/screen/zones", {
          body: { key, name: `Zone ${keys.length + 1}` },
        });
        if (made.status !== 201)
          throw new Error(`adding ${key}: HTTP ${made.status}`);
        added.push(key);
        keys.push(key);
      }
      await shot(
        `stories-on-air-${n}-zones`,
        "/moments/on-air",
        DESK,
        SESSION,
        {
          ready: drawn(n),
        },
      );
      if (n === 8)
        await shot(
          "stories-on-air-8-zones-1920",
          "/moments/on-air",
          WIDE,
          SESSION,
          {
            ready: drawn(n),
          },
        );
    }
  } catch (err) {
    fail(`on air zones: ${firstLine(err)}`);
  } finally {
    for (const key of added)
      await demo.call("DELETE", `/api/screen/zones/${key}`);
    for (const zone of removed) {
      const { revision: _r, ...body } = zone;
      await demo.call("POST", "/api/screen/zones", { body });
    }
  }
}
