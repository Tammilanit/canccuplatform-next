// The demo event's screen fixture for the screenshots (#375: "the demo event's fixture data"): a
// run of show around now over two days with a running and a delayed item (day.mjs), a ticker line, the main
// zone named as mockup 02 names it and an entrance zone with the check-in QR in its hero (mockup
// 03). The venue's Wi-Fi is seeded by deploy/compose.ci.yml, since the CI session holds no tenants
// right. A rerun on the same stack adds nothing twice, but keeps the first run's times, which drift
// from now: shots of the run of show around now need a fresh stack. Also the theme switch the
// screenshots of every demo theme need.
import { expect } from "./client.mjs";
import { placeDay } from "./day.mjs";

export const TICKER =
  "Pizza orders close at 20:00 · Lost and found at the info desk · Grand final on stage tonight";

/** The run of show, the ticker and the zones; answers the zones' keys. */
export async function seedScreens(demo, now = Date.now()) {
  const { items } = expect(
    await demo.call("GET", "/api/agenda/items"),
    200,
    "the run of show",
  ).body;
  for (const { delay, ...placed } of placeDay(now)) {
    const { title } = placed;
    let item = items.find((i) => i.title === title);
    // Delayed once, when added: a rerun on the same stack would move it again.
    const added = item === undefined;
    if (added) {
      item = expect(
        await demo.call("POST", "/api/agenda/items", { body: { ...placed, visibility: "public" } }),
        201,
        `adding "${title}" to the run of show`,
      ).body;
    }
    if (delay > 0 && added) {
      expect(
        await demo.call("POST", `/api/agenda/items/${item.id}/delay`, {
          body: { revision: item.revision, minutes: delay },
        }),
        200,
        `delaying "${title}"`,
      );
    }
  }
  await demo.setTicker(TICKER);
  await saveZone(demo, "main", { name: "Main hall" });
  await saveZone(demo, "entrance", {
    name: "Entrance",
    regions: { hero: { widgets: [{ widget: "checkin_qr" }], idle: "next" } },
  });
}

/** A zone with these fields: a new one, or the one saved before with them changed. */
export async function saveZone(demo, key, fields) {
  const before = await demo.call("GET", `/api/screen/zones/${key}`);
  const answer =
    before.status === 200
      ? await demo.call("PUT", `/api/screen/zones/${key}`, { body: { ...before.body, ...fields } })
      : await demo.call("POST", "/api/screen/zones", { body: { key, ...fields } });
  if (answer.status !== 200 && answer.status !== 201) expect(answer, 200, `saving the zone ${key}`);
}

/**
 * `fn` run with the main zone's venue rail turning every 10 s (`Zone.regions.<id>.dwell_seconds`),
 * then its regions as they were. Since #787 D14 the rail turns with the hero (45 s) and gives the
 * hub QR a turn; its turns are anchored on the epoch, so the venue card can be off the screen for
 * 90 s, past the 30 s its check waits (clear.mjs, `venueOnOneLine`). At 10 s it is back within 20.
 */
export async function withQuickVenueRail(demo, fn) {
  const { regions } = expect(await demo.call("GET", "/api/screen/zones/main"), 200, "the main zone").body; // prettier-ignore
  const venue = { ...regions.venue_rail, dwell_seconds: 10 };
  await saveZone(demo, "main", { regions: { ...regions, venue_rail: venue } });
  try {
    return await fn();
  } finally {
    await saveZone(demo, "main", { regions });
  }
}

/** Publishes a demo theme as the Theme studio's starting points do (contracts/theming.md). */
export async function publishTheme(demo, theme) {
  const zip = expect(
    await demo.call("GET", `/theming/studio/starters/${theme}.zip`),
    200,
    `the ${theme} starting point`,
  ).bytes;
  const draft = await demo.call("GET", "/api/theming/draft");
  const query = draft.status === 200 ? `?draft_version=${draft.body.draft_version}` : "";
  const put = expect(
    await demo.call("PUT", `/api/theming/draft/package${query}`, {
      body: zip,
      type: "application/zip",
    }),
    200,
    `the ${theme} package as the draft`,
  );
  expect(
    await demo.call("POST", "/api/theming/draft/publish", {
      body: { draft_version: put.body.draft_version },
    }),
    201,
    `publishing ${theme}`,
  );
}

/**
 * Someone who never checks in still sees every public page and screen (0027; the notify plan's
 * Q4): the public reads answer a guest, with no session and no check-in.
 */
export async function guestReads(demo) {
  const paths = [
    "/api/agenda/now",
    "/api/screen/now?zone=main",
    "/api/theming/current",
    "/api/notify/topics",
  ];
  for (const path of paths)
    expect(await demo.call("GET", path, { cookie: "" }), 200, `a guest's ${path}`);
}
