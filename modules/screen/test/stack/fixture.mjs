// The demo event's screen fixture for the screenshots (#375: "the demo event's fixture data"): a
// run of show around now with a delayed item, a ticker line, the main zone named as mockup 02
// names it and an entrance zone with the check-in QR in its hero (mockup 03). The venue's Wi-Fi is
// seeded by deploy/compose.ci.yml, since tenants takes no CI session. A rerun on the same stack
// adds nothing twice. Also the theme switch the screenshots of every demo theme need.
import { expect } from "./client.mjs";

const MIN = 60_000;
/**
 * Title, kind, start and end in minutes from the quarter hour before now, place, delay. The delayed
 * item has not started: a running item's delay moves only its end, so agenda shows no delay for it.
 */
const ITEMS = [
  ["Dinner", "meal", -30, 45, "Café", 0],
  ["Demo Game Cup, semis", "tournament", 60, 150, "Stage", 15],
  ["Board games corner", "activity", 90, 180, "Café", 0],
  ["Demo Game Cup, grand final", "tournament", 180, 270, "Stage", 0],
];
export const TICKER =
  "Pizza orders close at 20:00 · Lost and found at the info desk · Grand final on stage tonight";

/** The run of show, the ticker and the zones; answers the zones' keys. */
export async function seedScreens(demo, now = Date.now()) {
  const quarter = Math.floor(now / (15 * MIN)) * 15 * MIN;
  const at = (minutes) => new Date(quarter + minutes * MIN).toISOString();
  const { items } = expect(
    await demo.call("GET", "/api/agenda/items"),
    200,
    "the run of show",
  ).body;
  for (const [title, kind, start, end, location, delay] of ITEMS) {
    let item = items.find((i) => i.title === title);
    // Delayed once, when added: a rerun on the same stack would move it again.
    const added = item === undefined;
    if (added) {
      const body = { title, kind, starts_at: at(start), ends_at: at(end), location };
      item = expect(
        await demo.call("POST", "/api/agenda/items", { body: { ...body, visibility: "public" } }),
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
async function saveZone(demo, key, fields) {
  const before = await demo.call("GET", `/api/screen/zones/${key}`);
  const answer =
    before.status === 200
      ? await demo.call("PUT", `/api/screen/zones/${key}`, { body: { ...before.body, ...fields } })
      : await demo.call("POST", "/api/screen/zones", { body: { key, ...fields } });
  if (answer.status !== 200 && answer.status !== 201) expect(answer, 200, `saving the zone ${key}`);
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
