// A living screen's moment strips (#787 D7, D8; sheets 02 and 05), handed to the main zone's Pulse
// as living.mjs hands its own: one order's food moments in the hero, each in one place at a time,
// and a result that steps down from the hero to the rail. The claims are drawn as Screen places
// Moments' overrides, their stages as a claim's steps, so the frames come on the screen's own clock.

const STEP_S = 6;
/** Far enough ahead for the page to load and draw the claim before its first stage. */
const LEAD_MS = 20_000;
const at = (ms) => new Date(ms).toISOString();

/** `HH:MM` in the event's time zone, as the server words a time. */
const hm = (s, ms) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: s.tenant.time_zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);

function qrImage(s) {
  const qr = s.regions.flatMap((r) => r.widgets).find((w) => w.widget === "qr");
  if (qr === undefined) throw new Error("the demo zone shows no QR to borrow");
  return qr.view.image_url;
}

/** One order's stages as the food box's view says each (src/compose/food.ts), with its kicker. */
function foodStages(s, start) {
  const join = { url: "https://demo.example/pizza/orders/po_3", label: "Join the order", image_url: qrImage(s) }; // prettier-ignore
  const closes = start + 12 * 60_000;
  const eta = start + 3 * STEP_S * 1000 + 15 * 60_000;
  const order = (state, status_text) => ({ state, seq: 3, pizzeria_name: "Demo Pizzeria", status_text }); // prettier-ignore
  const open = (title, closesAt) => ({
    title,
    state: "open",
    pizzeria_name: "Demo Pizzeria",
    big_label: "Open · closes",
    big_text: hm(s, closesAt),
    orders: [order("open", `Open · closes ${hm(s, closesAt)} · 9 pizzas`)],
    countdown_at: at(closesAt),
    join,
  });
  const card = (template, content) => ({ template, content, duration_ms: STEP_S * 1000 });
  return [
    card("pizza_placed", open("Pizza order open", closes)),
    // Five minutes before the close (#787 Q1).
    card("pizza_placed", open("Last call", start + STEP_S * 1000 + 5 * 60_000)),
    card("pizza_placed", {
      title: "On the way",
      state: "placed",
      pizzeria_name: "Demo Pizzeria",
      big_label: "On the way · about",
      big_text: hm(s, eta),
      orders: [order("placed", `On the way · about ${hm(s, eta)}`)],
      countdown_at: at(eta),
      join: null,
    }),
    card("announcement", {
      title: "Pizza is here",
      body: "Order 3 · Collect at the front desk",
      level: "important",
      placement: "hero",
      icon: "food",
      art: { kind: "food", url: null },
      starts_at: at(start + 3 * STEP_S * 1000),
      expires_at: at(start + 4 * STEP_S * 1000 + 180_000),
      countdown_at: null,
      second_line: "Collect at the front desk",
      qr: null,
      updated: false,
      ticker_line: null,
    }),
  ];
}

const claim = (id, role, start, over) => ({
  override_id: id,
  hidden: false,
  role,
  rank: 80,
  sound: null,
  on_end: "resume",
  starts_at: at(start),
  ends_at: null,
  ...over,
});

const RESULT = {
  title: "Semi-final 1: Team Aurora wins",
  body: "Team Aurora meets the winner of semi-final 2 in the final at 22:15",
  level: "info",
  icon: "trophy",
  updated: false,
  ticker_line: null,
};

/** When the strip's first stage starts: worked out once, as the page may ask for the state again. */
let startsAt = 0;

/** The state the strip hands the page: the moment's claims, and its box left out elsewhere (D7). */
export function withMoments(view) {
  startsAt = Math.ceil((Date.now() + LEAD_MS) / 1000) * 1000;
  const start = startsAt;
  return (s) => ({
    ...s,
    regions: s.regions.map((r) => {
      if (view === "living-food") {
        if (r.role === "hero")
          return { ...r, claim: claim("food.main", "hero", start, { template: "pizza_placed", content: {}, steps: foodStages(s, start), expires_at: at(start + 600_000) }) }; // prettier-ignore
        // The food moment covers the food box: out of the other regions' turns (One place).
        const order = r.order.filter((i) => r.widgets[i]?.widget !== "food_status");
        return { ...r, order };
      }
      // The result: the hero's for its hero time, then the rail's, which kept its run of show.
      if (r.role === "hero")
        return { ...r, claim: claim("result.main", "hero", start, { template: "announcement", content: { ...RESULT, starts_at: at(start), placement: "hero" }, steps: null, expires_at: at(start + STEP_S * 1000) }) }; // prettier-ignore
      if (r.role === "rail") {
        const shown = r.widgets[r.order[0] ?? 0];
        if (shown === undefined) throw new Error("the demo zone's rail shows nothing");
        const steps = [
          { template: shown.widget, content: shown.view, duration_ms: STEP_S * 1000 },
          { template: "announcement", content: { ...RESULT, starts_at: at(start), placement: "rail" }, duration_ms: 60_000 }, // prettier-ignore
        ];
        return { ...r, claim: claim("result.main.2", "rail", start, { template: "announcement", content: {}, steps, expires_at: at(start + 600_000) }) }; // prettier-ignore
      }
      return r;
    }),
  });
}

async function waitUntil(page, ms) {
  await page.waitForTimeout(Math.max(0, ms - Date.now()));
}

/**
 * The strip's frames, 2.5 s into each stage. `living-food`: order open, last call, on the way,
 * Pizza is here. `living-stepdown`: the result in the hero, then in the rail with the hero's
 * rotation back.
 */
export async function momentsStrip(page, view, shoot) {
  await page.waitForSelector('.canccu-region[data-role="hero"] > .canccu-widget.canccu-is-claim');
  const frames = view === "living-food" ? 4 : 2;
  for (let n = 0; n < frames; n += 1) {
    await waitUntil(page, startsAt + n * STEP_S * 1000 + 2500);
    await shoot(`f${String(n + 1)}`);
  }
  if (view === "living-food") {
    const repeated = await page.locator('.canccu-region:not([data-role="hero"]) .canccu-widget--food_status.canccu-is-active').count(); // prettier-ignore
    if (repeated !== 0) throw new Error("living-food: the food box repeats the hero's moment");
  }
}
