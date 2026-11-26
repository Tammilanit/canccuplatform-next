// The announcement shots of #780 (docs/plans/issue-780.md, sheets 1–5): each level in its
// placement, handed to the page as Screen places it (screens.mjs, `handed`), in the default and
// level-up themes at 1080p, 4K and portrait. Before each shot the page is measured: label, title
// and body on one left edge, the title at least 6 % of the screen's height and the body 3.5 %.
import { GAME, claim, withShowcase, withStats } from "./handed.mjs";

// Every time is fixed when the view is made, not per state the page fetches: the page fetches
// again on every reconnect, and a moving start would enter again and again.
const at = (now, ms) => new Date(now + ms).toISOString();
const QR = {
  url: "https://demo.localhost/pizza/orders/o_7",
  label: "Your order",
  image_url: `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path fill="#111" d="M0 0h7v7H0zM14 0h7v7h-7zM0 14h7v7H0zM9 9h3v3H9zM15 15h3v3h-3z"/></svg>',
  ).toString("base64")}`,
};

/** A claimed announcement as Moments sends it (contracts/screen.md, the examples of #780). */
function card(now, role, content, more = {}) {
  return {
    ...claim(role, "announcement", {
      starts_at: at(now, -1000),
      expires_at: at(now, 179_000),
      countdown_at: null,
      second_line: null,
      qr: null,
      art: null,
      updated: false,
      ticker_line: null,
      ...content,
    }),
    starts_at: at(now, -1000),
    expires_at: at(now, 179_000),
    ...more,
  };
}

const PIZZA = {
  title: "Pizza is here",
  body: "Order 7 · Collect at the café",
  level: "important",
  icon: "food",
  art: { kind: "food", url: null },
  second_line: "Collect at the café",
  qr: QR,
};

/** The state with `put` in every region of `role`. */
const placing = (role, put) => (s) => ({
  ...s,
  regions: s.regions.map((r) => (r.role === role ? { ...r, claim: put } : r)),
});

/**
 * A full Info or Important keeps the ticker under it (`keep_ticker`): Screen spans `_full` over the
 * grid less a ticker along its bottom edge, and composes the nearby content: now and next here,
 * the rail's own (contracts/screen.md, Nearby content).
 */
const fullOver = (content, sinceMs) => (now) => (s) => {
  const ticker = s.regions.find((r) => r.role === "ticker");
  const { columns, rows } = s.layout.grid;
  const below =
    ticker !== undefined &&
    ticker.area.columns === columns &&
    ticker.area.row + ticker.area.rows - 1 === rows;
  const agenda = s.regions.flatMap((r) => r.widgets).find((w) => w.widget === "agenda_now");
  const put = {
    ...card(now, "full", { ...content, starts_at: at(now, -sinceMs) }),
    starts_at: at(now, -sinceMs),
    keep_ticker: true,
    ...(agenda !== undefined ? { aside: { widget: "agenda_now", view: agenda.view } } : {}),
  };
  return {
    ...s,
    regions: s.regions.map((r) =>
      r.role !== "full"
        ? r
        : {
            ...r,
            claim: put,
            ...(below ? { area: { ...r.area, rows: rows - ticker.area.rows } } : {}),
          },
    ),
  };
};

/** Dashboard's hero grown to 2 × 2 boxes for an Important (the grow rule), as sheet 3 draws it. */
const grownFor = (now) => (s) => {
  const grown = withShowcase(withStats(s));
  const finals = card(now, "hero", {
    title: "Finals start",
    body: "Team Alpha vs Team Gamma on the main stage",
    level: "important",
    icon: "trophy",
    art: { kind: "game", url: GAME.cover_url },
    countdown_at: at(now, 9 * 60_000),
  });
  return placing("hero", finals)(grown);
};

const placed = (role, content) => (now) => placing(role, card(now, role, content));

const LANDSCAPE = [1920, 1080];
const PORTRAIT = [1080, 1920];
const UHD = [3840, 2160];

/**
 * Every view: its layout (null: the zone's own Pulse), its sizes, and `make(now)`, the change it
 * hands the page, its times counted from `now`. The
 * full screen is shot as it breaks in, in its second beat (12 s into its 30), and past a minute.
 */
export const ANNOUNCE_VIEWS = [
  {
    view: "ann-info-rail",
    layout: null,
    sizes: [LANDSCAPE, UHD, PORTRAIT],
    make: placed("rail", { title: "The raffle at 21", body: "Tickets at the info desk", level: "info", icon: "megaphone" }),
  },
  {
    view: "ann-important-hero",
    layout: null,
    sizes: [LANDSCAPE, UHD, PORTRAIT],
    make: placed("hero", PIZZA),
  },
  { view: "ann-important-dashboard", layout: "dashboard", sizes: [LANDSCAPE, UHD], make: grownFor },
  { view: "ann-full-enter", layout: null, sizes: [LANDSCAPE, UHD, PORTRAIT], make: fullOver(PIZZA, 0), wait: ".canccu-ann--alive" },
  { view: "ann-full-beat", layout: null, sizes: [LANDSCAPE, UHD, PORTRAIT], make: fullOver(PIZZA, 12_000), wait: ".canccu-ann--second" },
  { view: "ann-full-minute", layout: null, sizes: [LANDSCAPE, UHD, PORTRAIT], make: fullOver(PIZZA, 62_000), wait: ".canccu-ann--alive" },
  {
    view: "ann-urgent-full",
    layout: null,
    sizes: [LANDSCAPE, UHD, PORTRAIT],
    make: placed("full", { title: "Semis in 15 min", body: "Players to the stage now", level: "urgent", ticker_line: "Semis in 15 min · players to the stage now" }),
  },
  {
    view: "ann-emergency-portrait",
    layout: null,
    sizes: [PORTRAIT, [2160, 3840]],
    make: placed("full", { title: "Please leave the hall", body: "Follow the exit signs.", level: "emergency" }),
  },
]; // prettier-ignore

export const ANNOUNCE_THEMES = ["level-up", "default"];

/** The merge queue's check reads 1080p and portrait only (screen-views.mjs, `sizesOf`). */
export const annSizes = (v, check) =>
  check ? v.sizes.filter(([w, h]) => Math.max(w, h) === 1920) : v.sizes;

/**
 * Runs in the page: every claimed card drawn outside the ticker, and how it measures against the
 * floors. Returns the problems, none when it reads across a hall.
 */
export function measureCards() {
  const problems = [];
  const height = window.innerHeight;
  const cards = document.querySelectorAll(
    '.canccu-region:not([data-role="ticker"]) > .canccu-widget--announcement.canccu-is-claim',
  );
  if (cards.length === 0) problems.push("no announcement card drawn");
  for (const box of cards) {
    const part = (cls) => box.querySelector(`.canccu-widget__level > .canccu-widget__${cls}`);
    const [kicker, title, body] = ["kicker", "title", "body"].map(part);
    if (title === null || body === null || kicker === null) {
      problems.push("a card without its label, title or body");
      continue;
    }
    // A body the alarm's band carries is drawn once, in the band (announce.css): the band's type
    // then holds the body's floor.
    const shown = body.getClientRects().length > 0;
    const line = shown ? body : box.querySelector(".canccu-widget__instruction");
    const edge = shown ? [kicker, title, body] : [kicker, title];
    const lefts = edge.map((el) => Math.round(el.getBoundingClientRect().left));
    if (Math.max(...lefts) - Math.min(...lefts) > 2)
      problems.push(`label, title and body start at ${lefts.join(", ")} px, not one left edge`);
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    if (px(title) < 0.06 * height - 0.5)
      problems.push(`the title is ${px(title)} px, under 6 % of ${height} px`);
    if (line === null) problems.push("a body neither drawn nor carried by the band");
    else if (px(line) < 0.035 * height - 0.5)
      problems.push(`the body is ${px(line)} px, under 3.5 % of ${height} px`);
  }
  return problems;
}

/** What the view waits for, then the measure; a card off the floors fails the shot. */
export async function annSettled(page, v) {
  await page.evaluate(() => document.fonts.ready);
  if (v.wait !== undefined) await page.waitForSelector(v.wait, { timeout: 30_000 });
  // The entrance is the shot: the rest settle past it, the breathing glow included.
  if (v.view !== "ann-full-enter") await page.waitForTimeout(1500);
  const problems = await page.evaluate(measureCards);
  if (problems.length > 0) throw new Error(`${v.view}: ${problems.join("; ")}`);
}
