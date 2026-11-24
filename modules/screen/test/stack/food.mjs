// The food box fits its slot (#775): on the screen shots its text stays inside its own box at
// 1080p, 4K and portrait, never under the hub QR beside it, and a cue draws one frame round it,
// not a second line through it. The page measures (measureFood, run in the page) and judgeFood
// judges, pure, so test/stack-food.test.ts holds the rules without a stack or a browser. The pizza
// shots check the real order's box (roomReady, scripts/demo-screenshots-pizza.mjs); the screen shots hand the
// page a long pizzeria name and the longest pickup note pizza accepts (screens.mjs, FOOD_VIEWS).
import { claim } from "./handed.mjs";

const NAME = "Pizzeria Napoletana della Nonna Maria";
/** 80 characters: pizza's LIMITS.pickup, the most a holder can type. */
const PICKUP = "the long table by the stage, left of the bar, under the screen by the side door.";
/** Moments' `pizza.placed` cue, as its catalogue sends it: the frame the check measures. */
const CUE = { name: "pop", hold_seconds: 60, fade_seconds: 10 };

/** A `pizza_placed` claim drawn as the food box draws its order: the server's foodFields view. */
function placed(state, lead, status) {
  const order = {
    state,
    seq: 7,
    pizzeria_name: NAME,
    target_at: "2026-03-14T18:30:00Z",
    closes_at: "2026-03-14T18:30:00Z",
    estimate_at: state === "placed" ? "2026-03-14T19:18:00Z" : null,
    pickup: state === "arrived" ? PICKUP : null,
    pizza_count: 12,
    people_count: 9,
    holder_name: null,
    status_text: status,
  };
  const content = {
    title: "Food",
    big_label: lead?.[0] ?? null,
    big_text: lead?.[1] ?? null,
    state,
    seq: order.seq,
    pizzeria_name: NAME,
    target_at: order.target_at,
    pizza_count: order.pizza_count,
    people_count: order.people_count,
    holder_name: null,
    orders: [order],
  };
  return ["venue_rail", { ...claim("venue_rail", "pizza_placed", content), effect: CUE }];
}

export const FOOD_CLAIM_OF = {
  "claim-food-long": placed("arrived", null, `Pizza is here · collect at ${PICKUP}`),
  "claim-food-on-the-way-long": placed(
    "placed",
    ["On the way · about", "23:18"],
    "On the way · about 23:18",
  ),
};

/** The state with the view's claim in its region. */
export const withFoodClaim = (view) => (s) => {
  const [role, put] = FOOD_CLAIM_OF[view];
  return { ...s, regions: s.regions.map((r) => (r.role === role ? { ...r, claim: put } : r)) };
};

/**
 * Runs in the page (Playwright's evaluate), so it uses nothing from outside: the food box drawn
 * now (not the ticker's one line), the cue's frame on its region where one is drawn, the hub QR's
 * card beside it, and the box of each piece of text the box draws. Hidden text draws no box.
 */
export function measureFood() {
  const edges = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const box = [
    ...document.querySelectorAll(
      '.canccu-region:not([data-role="ticker"]) > .canccu-widget--food_status',
    ),
  ].find((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).opacity === "1");
  if (box === undefined) return null;
  const region = box.parentElement;
  let frame = null;
  if (region.classList.contains("canccu-cue")) {
    const a = getComputedStyle(region, "::after");
    const r = region.getBoundingClientRect();
    const at = (v) => parseFloat(v) || 0;
    frame = {
      left: r.left + at(a.left),
      top: r.top + at(a.top),
      right: r.right - at(a.right),
      bottom: r.bottom - at(a.bottom),
    };
  }
  const qr = document.querySelector(".canccu-region--venue_rail-2 > .canccu-widget");
  const texts = [];
  const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
    const text = n.textContent.trim();
    if (text === "") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) continue;
    texts.push({
      text,
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    });
  }
  return {
    box: edges(box.getBoundingClientRect()),
    frame,
    qr: qr === null ? null : edges(qr.getBoundingClientRect()),
    texts,
  };
}

/** A pixel of rounding either way. */
const SLACK = 1;
const SIDES = ["left", "top", "right", "bottom"];
const overlaps = (a, b) =>
  a.right > b.left + SLACK &&
  a.left < b.right - SLACK &&
  a.bottom > b.top + SLACK &&
  a.top < b.bottom - SLACK;

/** The food box's problems, one line each; none when it fits its slot. */
export function judgeFood(m) {
  if (m === null) return ["no food box on the screen"];
  const out = [];
  const side =
    m.frame === null ? undefined : SIDES.find((s) => Math.abs(m.frame[s] - m.box[s]) > SLACK);
  if (side !== undefined) {
    const px = (v) => Math.round(v);
    out.push(
      `the cue's frame is drawn apart from the box (${side} edge ${px(m.frame[side])} px, the box's ${px(m.box[side])} px): two frames`,
    );
  }
  for (const t of m.texts) {
    const what = `"${t.text}"`;
    if (t.right > m.box.right + SLACK) out.push(`${what} runs past the box's right edge`);
    if (t.left < m.box.left - SLACK) out.push(`${what} runs past the box's left edge`);
    if (m.qr !== null && overlaps(t, m.qr)) out.push(`${what} runs under the QR`);
    if (t.bottom > m.box.bottom + SLACK) out.push(`${what} runs off the box's foot`);
    if (t.top < m.box.top - SLACK) out.push(`${what} runs off the box's top`);
  }
  return out;
}

/** The check on a page drawing the food box: thrown, so the view or the shot fails with it. */
export async function foodFits(page) {
  await page.locator(".canccu-widget--food_status .canccu-widget__row").first().waitFor();
  // The cue's pop (0.6 s) and the box's fade-in are over, and the fit (fit.ts) has measured it.
  // The rail takes turns, so the box may leave while we wait: measure as soon as it is drawn
  // and settled, and look again for a turn that moved on, never judge a box that is not there.
  await page.waitForTimeout(1000);
  let m = null;
  for (let i = 0; i < 40 && m === null; i++) {
    m = await page.evaluate(measureFood);
    if (m === null) await page.waitForTimeout(500);
  }
  const problems = judgeFood(m);
  if (problems.length > 0)
    throw new Error(`the food box does not fit its slot: ${problems.slice(0, 4).join("; ")}`);
}

/** A storyboard's message card on air in the hero (Moments' Pizza order open story). */
const HERO_CARD = '.canccu-region[data-role="hero"] > .canccu-widget--title_card.canccu-is-claim';
/** Pizza is here: the `pizza` rule's announcement (#777), once it holds the hero. */
const HERO_HERE = '.canccu-region[data-role="hero"] > .canccu-widget--announcement.canccu-is-claim';

/**
 * The room's screen at the order's `step` (the pizza shots), ready for its shot. The hero first:
 * at `arrived`, Pizza is here must be on air in it (#775; since #777 the `pizza` rule's
 * announcement, which may wait in the rail behind what holds the hero); Moments puts the open
 * order's 20 s card on air some 20–30 s after the order opens (its round starts on a tick), so
 * that shot has it when it comes within that time and goes without it if not. Then the box: the
 * rail takes turns (venue info, the food box), so it is shot once the box has faded in, again
 * from its next turn when the rail moved on meanwhile, and checked to fit.
 */
export async function roomReady(page, step) {
  // 150 s: it may wait out the holder's floor (90 s) and the gap (10 s), and on the full run's
  // slower stack the hero came ~35 s after the order's event.
  if (step === "arrived")
    await page
      .locator(HERO_HERE)
      .filter({ hasText: "Pizza is here" })
      .waitFor({ timeout: 150_000 });
  else if (step === "open")
    await page
      .locator(HERO_CARD)
      .waitFor({ timeout: 45_000 })
      .catch(() => undefined);
  const box = page.locator(".canccu-widget--food_status .canccu-widget__row").first();
  for (let turn = 0; turn < 4; turn++) {
    await box.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(900);
    if (await box.isVisible()) return foodFits(page);
  }
  throw new Error("the food box never stayed on the screen");
}
