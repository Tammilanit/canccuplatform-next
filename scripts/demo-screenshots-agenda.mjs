// The run of show's shots of scripts/demo-screenshots.mjs (group `agenda`): an item's own pages on
// items the run adds through the agenda's API and removes after, then the day view on the
// fixture's filled day.
import { SESSION, expect } from "../modules/screen/test/stack/client.mjs";
import { DESK, PHONE, WIDE, firstLine } from "./demo-screenshots-shot.mjs";

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
export const DAY_VIEW = [
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
  // The whole event with the earlier items shown (#433), and on a phone the strip that keeps what
  // is on now in view once the hero has scrolled away.
  ["agenda-earlier", DESK, { query: "?earlier=1" }],
  ["agenda-strip-phone", PHONE, { ready: scrollPast, fullPage: false }],
];
async function scrollPast(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page
    .locator(".canccu-agenda-strip.is-shown")
    .waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
}
const dayPath = (o, id) => {
  if (o.delay) return `/agenda/?delay=${id}&minutes=10`;
  if (o.query) return `/agenda/${o.query}`;
  return o.pick ? `/agenda/?item=${id}` : "/agenda/";
};
// The Delay page and Edit view of one item (#388), next to their mockups (docs/design/mockups.html):
// with the items after it, quiet, and the edit form. The items are made for the run.
// `chosen` is what the page's own form sends: then an unticked box means off.
export const ITEM_PAGES = [
  [
    "agenda-delay-following",
    "/delay?minutes=10&following=1&announce=1&chosen=1",
    DESK,
  ],
  ["agenda-delay-quiet", "/delay?minutes=10&chosen=1", DESK],
  // Only this item moves and it now runs into Board games corner: the confirm names the overlap
  // (#434).
  ["agenda-delay-overlap", "/delay?minutes=30&announce=1&chosen=1", DESK],
  ["agenda-edit", "/edit", DESK],
  ["agenda-cancel", "/cancel", DESK],
];
// A cancelled item comes back until the event ends (#434): its page after the cancel.
export const CANCELLED = [
  ["agenda-bring-back", DESK],
  ["agenda-bring-back-phone", PHONE],
];

/** The dry run's lines, in the dry run's order: the day, then the made items' pages. */
export function agendaListed(at) {
  const lines = [];
  for (const [name, { width, height }, o] of DAY_VIEW) {
    const path = dayPath(o, `<${o.pick ?? o.delay}>`);
    lines.push(
      `  ${name}.png  ${at(path)}  (${width}×${height}, the fixture's day)`,
    );
  }
  for (const [name, suffix, { width, height }] of ITEM_PAGES) {
    const path = `/agenda/items/<an item made for the run>${suffix}`;
    lines.push(`  ${name}.png  ${at(path)}  (${width}×${height})`);
  }
  for (const [name, { width, height }] of CANCELLED) {
    const path = "/agenda/items/<an item made for the run, cancelled>";
    lines.push(`  ${name}.png  ${at(path)}  (${width}×${height})`);
  }
  return lines;
}

// An item starting `from` minutes from now, through the agenda's API; the run removes it after.
const made = [];
async function addItem(demo, title, kind, from, minutes) {
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

/** Removes the items the run added; safe to call again. */
export async function removeMade(demo, fail) {
  for (const { id, title, revision } of made.splice(0)) {
    try {
      const path = `/api/agenda/items/${id}?revision=${revision}`;
      expect(await demo.call("DELETE", path), 204, `removing ${title}`);
    } catch (err) {
      fail(`cleanup: ${firstLine(err)}`);
    }
  }
}

/** An item's Delay, Edit and Cancel pages, and a cancelled item's, on items made for them. */
export async function itemShots({ demo, shot, fail }) {
  let item;
  try {
    item = await addItem(
      demo,
      "Demo Game Cup: semi-final",
      "tournament",
      60,
      75,
    );
    await addItem(demo, "Board games corner", "activity", 150, 60);
    await addItem(demo, "Quiz night", "activity", 240, 60);
  } catch (err) {
    fail(`agenda items for the shots: ${firstLine(err)}`);
  }
  if (item) {
    for (const [name, suffix, viewport] of ITEM_PAGES) {
      await shot(name, `/agenda/items/${item.id}${suffix}`, viewport, SESSION);
    }
  }
  try {
    const raffle = await addItem(demo, "Raffle", "activity", 300, 15);
    const cancel = await demo.call(
      "POST",
      `/api/agenda/items/${raffle.id}/cancel`,
      { body: { revision: 1 } },
    );
    raffle.revision = expect(cancel, 200, "cancelling the raffle").body
      .revision;
    for (const [name, viewport] of CANCELLED) {
      await shot(name, `/agenda/items/${raffle.id}`, viewport, SESSION);
    }
  } catch (err) {
    fail(`a cancelled item: ${firstLine(err)}`);
  }
}

/** The day view on the fixture's run of show; throws when the fixture lacks an item it names. */
export async function dayShots({ demo, shot }) {
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
}
