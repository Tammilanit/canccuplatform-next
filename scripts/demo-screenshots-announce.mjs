// Run the event → Announcements shots of scripts/demo-screenshots.mjs (group `moments`; step 4
// mockups 05 and 06, #115), on the screens' fixture: the composer with a template's preview drawn
// in the real player, on a desk and a phone; then on the main hall an info card in the rail with its
// ticker line, the same card edited ("Updated"), an urgent one and a full-screen one. The entrance's
// rail is hidden for the run, so there the card degrades to the ticker and shows both lines (L4);
// it is shown again afterwards. Every announcement sent here is withdrawn and every screen revoked.
import { SESSION } from "../modules/screen/test/stack/client.mjs";
import { saveZone } from "../modules/screen/test/stack/fixture.mjs";
import { moments, placed } from "./demo-screenshots-moments.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";

const SCREEN_VIEW = { width: 1920, height: 1080 };

const shows = (text) => async (page) => {
  await page.getByText(text).first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
};

/** The composer as an organiser uses it: a template's variable filled, then Preview. */
const previewed = async (page) => {
  await page.fill("input[name=var_place]", "the café");
  await page.check("input[name=ch_ticker]");
  await page.click("button[value=preview]");
  await page
    .frameLocator("iframe[data-announce-preview]")
    .getByText("Food is here")
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
};

const screen = (name, zone, text) => [
  name,
  `/screen/zones/${zone}`,
  SCREEN_VIEW,
  { fullPage: false, ready: shows(text) },
];

export const ANNOUNCE_PAGES = [
  [
    "announce-composer",
    "/moments/announce?template=food",
    DESK,
    { ready: previewed },
  ],
  ["announce-composer-phone", "/moments/announce", PHONE, { touch: true }],
  screen("announce-screen-info", "main", "Pizza is here"),
  screen("announce-screen-both-lines", "entrance", "Pizza is here"),
];
export const UPDATED_PAGES = [
  screen("announce-screen-updated", "main", "Updated"),
];
export const URGENT_PAGES = [
  screen("announce-screen-urgent", "main", "Semis in 15 min"),
];
export const FULL_PAGES = [
  screen("announce-screen-full", "main", "Doors close at 23:00"),
];

/** The dry run's lines. */
export function announceListed(at) {
  return [
    [ANNOUNCE_PAGES, "an info announcement with its ticker line"],
    [UPDATED_PAGES, "the same, edited"],
    [URGENT_PAGES, "an urgent announcement"],
    [FULL_PAGES, "a full-screen announcement"],
  ].flatMap(([pages, how]) =>
    pages.map(
      ([name, path, { width, height }]) =>
        `  ${name}.png  ${at(path)}  (${width}×${height}, ${how})`,
    ),
  );
}

async function send(body) {
  const r = await moments("POST", "/api/moments/announcements", body);
  if (r.status !== 201)
    throw new Error(`announce: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  await placed(r.body.moments.card, ["main", "entrance"]);
  return r.body.id;
}

export async function announceShots({ demo, shot, fail }) {
  const sent = [];
  const screens = [];
  let hidden = false;
  try {
    for (const zone of ["main", "entrance"]) {
      const paired = await demo.pair(`Announcement shots ${zone}`, zone);
      const sse = demo.stream(paired.cookie);
      screens.push({ paired, sse });
      await sse.opened;
    }
    const entrance = await demo.call("GET", "/api/screen/zones/entrance");
    await saveZone(demo, "entrance", {
      regions: { ...entrance.body.regions, rail: { hidden: true } },
    });
    hidden = entrance.body;
    const info = {
      title: "Pizza is here",
      body: "Pick up at {place}",
      variables: { place: "the café" },
      level: "info",
      channels: { screen: true, ticker: true },
      duration_seconds: 900,
    };
    const first = await send(info);
    sent.push(first);
    const pages = [
      [ANNOUNCE_PAGES, null],
      [
        UPDATED_PAGES,
        {
          title: info.title,
          body: "Now at {place}",
          variables: { place: "the info desk" },
        },
      ],
    ];
    for (const [list, edit] of pages) {
      if (edit !== null) {
        const r = await moments(
          "PATCH",
          `/api/moments/announcements/${first}`,
          edit,
        );
        if (r.status !== 200) throw new Error(`edit: HTTP ${r.status}`);
      }
      for (const [name, path, viewport, o] of list)
        await shot(name, path, viewport, SESSION, o);
    }
    for (const [list, body] of [
      [
        URGENT_PAGES,
        {
          title: "Semis in 15 min",
          body: "Players to the stage now",
          level: "urgent",
        },
      ],
      [
        FULL_PAGES,
        {
          title: "Doors close at 23:00",
          body: "Thanks for coming",
          level: "info",
          full_screen: true,
        },
      ],
    ]) {
      for (const id of sent.splice(0))
        await moments("POST", `/api/moments/announcements/${id}/withdraw`, {});
      sent.push(await send({ ...body, duration_seconds: 900 }));
      for (const [name, path, viewport, o] of list)
        await shot(name, path, viewport, SESSION, o);
    }
  } catch (err) {
    fail(`announce: ${firstLine(err)}`);
  } finally {
    try {
      for (const id of sent)
        await moments("POST", `/api/moments/announcements/${id}/withdraw`, {});
      if (hidden) await saveZone(demo, "entrance", { regions: hidden.regions });
      for (const { paired, sse } of screens) {
        sse.close();
        await demo.revoke(paired.id);
      }
    } catch (err) {
      fail(`announce cleanup: ${firstLine(err)}`);
    }
  }
}
