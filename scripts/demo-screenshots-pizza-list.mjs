// The Food pages' shot list for scripts/demo-screenshots-pizza.mjs (group `pizza`): each page at
// the step of the shots' order it is taken at, and who looks; every phone shot also at desk width
// (amendment 5). Kept apart from the steps that take them, as the list grows with each slice.
import { DESK, PHONE } from "./demo-screenshots-shot.mjs";

export const ORDER = "<order>";
export const PIZZERIA = "<pizzeria>";
export const RECEIPT = "<receipt>";
const GUEST = null;
/**
 * The order's other people (#704): Players 1–3 of the CI session stub (deploy/compose.ci.yml), each
 * with a pizza, so the money step shows who owes the holder; two are marked paid once it settles
 * to the holder, as mockup 19 C.
 */
export const PLAYERS = [
  ["canccu_session=demo-player-1", "1"],
  ["canccu_session=demo-player-2", "1"],
  ["canccu_session=demo-player-3", "3"],
];
export const PAID = ["u_demo_01", "u_demo_02"];
const HALL = { width: 1920, height: 1080 };
/** The main zone's screen, as Studio mirrors it (#643, mockup 14): the food box in its rail. */
export const BOX = "/screen/zones/main";
/**
 * [name, path, viewport, step, cookie]: the step the order is at when the shot is taken, and who
 * looks (the CI session unless GUEST). The attendee's shots are named as attendee.browser.test.ts
 * walks the flow: the Food page, the menu, my order at each step.
 */
const LISTED = [
  // The hall's screen first at each step Moments shows (#775): Pizza order open plays its card for
  // 20 s, and Pizza is here, the `pizza` rule's announcement (#777), holds the hero three minutes
  // from the order's event, after any moment that holds it has had its floor.
  ["pizza-screen-food-open", BOX, HALL, "open"],
  ["pizza-food-phone", "/pizza/", PHONE, "open"],
  ["pizza-food-guest-phone", "/pizza/", PHONE, "open", GUEST],
  ["pizza-food-start-phone", "/pizza/start", PHONE, "open"],
  ["pizza-food-menu-phone", `/pizza/orders/${ORDER}/add`, PHONE, "open"],
  ["pizza-food-menu-filter-phone", `/pizza/orders/${ORDER}/add?q=kebab`, PHONE, "open"],
  ["pizza-food-own-pizza-phone", `/pizza/orders/${ORDER}/add?tab=own`, PHONE, "open"],
  ["pizza-food-other-phone", `/pizza/orders/${ORDER}/add?tab=other`, PHONE, "open"],
  ["pizza-food-added-phone", `/pizza/orders/${ORDER}?added=1`, PHONE, "open"],
  ["pizza-holder-checklist-phone", `/pizza/hold/${ORDER}`, PHONE, "open"],
  // #789: the holder's card (also on on-the-way, which this session holds), and the photo viewer.
  ["pizza-food-holder-card-open-phone", `/pizza/orders/${ORDER}`, PHONE, "open"],
  ["pizza-food-closed-phone", `/pizza/orders/${ORDER}`, PHONE, "closed"],
  ["pizza-holder-call-phone", `/pizza/hold/${ORDER}/call`, PHONE, "closed"],
  ["pizza-holder-called-in-phone", `/pizza/hold/${ORDER}/called-in`, PHONE, "closed"],
  ["pizza-holder-placed-phone", `/pizza/hold/${ORDER}`, PHONE, "placed"],
  ["pizza-food-on-the-way-phone", `/pizza/orders/${ORDER}`, PHONE, "placed"],
  ["pizza-screen-food-on-the-way", BOX, HALL, "placed"],
  ["pizza-holder-here-phone", `/pizza/hold/${ORDER}/here`, PHONE, "placed"],
  ["pizza-crew-phone", "/pizza/crew", PHONE, "placed"],
  ["pizza-crew-order-phone", `/pizza/crew/orders/${ORDER}`, PHONE, "placed"],
  // Mockups 18 and 19: the money step, with the AI reader on (CI's fake reader).
  ["pizza-holder-money-phone", `/pizza/hold/${ORDER}/money`, PHONE, "placed"],
  ["pizza-holder-money-scan-phone", `/pizza/hold/${ORDER}/money/scan`, PHONE, "placed"],
  ["pizza-holder-money-total-phone", `/pizza/hold/${ORDER}/money/total`, PHONE, "placed"],
  ["pizza-holder-money-check-phone", `/pizza/hold/${ORDER}/money/check?receipt=${RECEIPT}`, PHONE, "read"],
  // #789 items 2 and 11: the photo on its way, and three reads that gave nothing, each with its
  // way on (a busy reader counting down, the reader's own reason with photo tips, no credit).
  ["pizza-holder-money-progress-phone", `/pizza/hold/${ORDER}/money/scan`, PHONE, "read"],
  ["pizza-holder-money-read-busy-phone", `/pizza/hold/${ORDER}/money/scan?failed=rate_limited&receipt=${RECEIPT}&after=60`, PHONE, "read"],
  ["pizza-holder-money-read-unreadable-phone", `/pizza/hold/${ORDER}/money/scan?failed=unreadable&receipt=${RECEIPT}&why=${encodeURIComponent("The photo is blurred: hold the phone still and take it again.")}`, PHONE, "read"],
  ["pizza-holder-money-read-no-credit-phone", `/pizza/hold/${ORDER}/money/scan?failed=out_of_credit&receipt=${RECEIPT}`, PHONE, "read"],
  ["pizza-holder-money-confirmed-phone", `/pizza/hold/${ORDER}/money`, PHONE, "confirmed"],
  ["pizza-holder-photo-viewer-phone", `/pizza/hold/${ORDER}/money`, PHONE, "confirmed"],
  ["pizza-holder-money-payer-phone", `/pizza/hold/${ORDER}/money`, PHONE, "payer"],
  // The plan's "Pay me with": what a member who still owes the holder sees on their order (#769).
  ["pizza-food-pay-phone", `/pizza/orders/${ORDER}`, PHONE, "payer", PLAYERS[2][0]],
  ["pizza-screen-food-here", BOX, HALL, "arrived"],
  ["pizza-food-here-phone", `/pizza/orders/${ORDER}`, PHONE, "arrived"],
  ["pizza-holder-hand-out-phone", `/pizza/hold/${ORDER}/hand-out`, PHONE, "arrived"],
  ["pizza-holder-done-phone", `/pizza/hold/${ORDER}/hand-out`, PHONE, "done"],
  ["pizza-food-done-phone", `/pizza/orders/${ORDER}`, PHONE, "done"],
  ["pizza-food-earlier-phone", "/pizza/", PHONE, "done"],
  ["pizza-pizzerias-phone", "/pizza/crew/pizzerias", PHONE, "done"],
  ["pizza-pizzeria-phone", `/pizza/crew/pizzerias/${PIZZERIA}`, PHONE, "done"],
  ["pizza-import-preview-phone", "/pizza/crew/pizzerias/import", PHONE, "done"],
  ["pizza-menu-read-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read`, PHONE, "done"],
  // #789 items 1–5 and 15: three pages as thumbnails with the cost; the photos on their way; the
  // read of two pages as the table (categories, notes, the own pizza, gathered toppings); and two
  // reads that gave nothing, each with its way on.
  ["pizza-menu-read-pages-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read`, PHONE, "done"],
  ["pizza-menu-read-progress-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read`, PHONE, "done"],
  ["pizza-menu-read-table-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read`, PHONE, "done"],
  ["pizza-menu-read-unreadable-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read?failed=unreadable&why=${encodeURIComponent("This is not a menu: it shows a receipt.")}`, PHONE, "done"],
  ["pizza-menu-read-too-many-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read?failed=too_many_pages`, PHONE, "done"],
  ["pizza-settings-phone", "/pizza/crew/settings", PHONE, "done"],
  // Mockup 12: the daily record, one order's money and the export; mockup 20: Integrations.
  ["pizza-record-phone", "/pizza/crew/record", PHONE, "done"],
  ["pizza-record-order-phone", `/pizza/crew/record/${ORDER}`, PHONE, "done"],
  ["pizza-export-phone", "/pizza/crew/export", PHONE, "done"],
  // With the month's read log under the key (#789 item 12).
  ["pizza-integrations-phone", "/pizza/integrations", PHONE, "done"],
];
/** Every page at both widths (amendment 5): a phone shot not listed at desk width gets it next. */
export const SHOTS = LISTED.flatMap((s) => {
  const desk = s[0].replace(/-phone$/, "");
  const twin = s[2] === PHONE && !LISTED.some((t) => t[0] === desk);
  return twin ? [s, [desk, s[1], DESK, ...s.slice(3)]] : [s];
});

export function pizzaListed(at) {
  return SHOTS.map(
    ([name, path, { width, height }]) =>
      `  ${name}.png  ${at(path)}  (${width}×${height}, the order ${path.includes(ORDER) ? "made for it" : "of the day"})`,
  );
}

