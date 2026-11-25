/**
 * The demo event's second order (#788): a takeaway at Demo Trattoria, called in, so the screens'
 * food box and the Food pages show an order on its way or here beside the open one, all day. Each
 * hourly run of the seed moves it one stage, at least 45 minutes after the last, so a second run
 * changes nothing: on its way → here (with a pickup place) → handed out, with a fresh one called
 * in at once. Through the module's own steps, so Moments' "Pizza is here" and the hub follow it.
 *
 * Only the order the seed called in moves, and only while its `revision` is the one the seed left
 * (kept in the seed's mark): a step someone took on it keeps the seed away until it is over.
 */
import { addItem, openOrder } from "./items.js";
import { arrive, done, place } from "./lifecycle.js";
import type { Step } from "./lifecycle.js";
import { getOrder, listPizzerias, liveMenu, ordersWhere } from "./store.js";
import type { Actor, OrderRow } from "./store.js";
import { eventDay } from "./time.js";
import { parseItemBody, snapshotOf } from "./validate.js";

export const CALLED_IN_TAKEAWAY = "called in the demo takeaway order";
export const ARRIVED_TAKEAWAY = "the demo takeaway order is here";
export const NEXT_TAKEAWAY = "handed out the demo takeaway order and called in a fresh one";
export const TAKEAWAY_WAITS = "the demo takeaway order is under way; nothing changed";
export const HAND_MADE_TAKEAWAY =
  "the demo takeaway order was changed by hand; nothing changed" +
  " (reset the demo event to call in a fresh one)";
export const OTHER_CALLED_IN = "another order is called in; no demo takeaway order";
export const NO_TRATTORIA = "the demo event has no Demo Trattoria; no demo takeaway order";

/** The takeaway order the seed called in, and its `revision` as the seed left it. */
export interface Takeaway {
  id: string;
  revision: number;
}

const TRATTORIA = "Demo Trattoria";
const MIN = 60_000;
/** Under the hour between the deploy's seed runs, so each run moves it once. */
const STAGE_MS = 45 * MIN;
const ESTIMATE_MS = 40 * MIN;
const PICKUP = "Entrance table";
/** Placeholder people (no accounts), apart from the open order's holder. */
const PEOPLE: readonly (Actor & { number: string })[] = [
  { user_id: "u_demo_robin", name: "Robin", number: "7" },
  { user_id: "u_demo_kim", name: "Kim", number: "4" },
  { user_id: "u_demo_jo", name: "Jo", number: "15" },
];
const LIVE = ["open", "closed", "placed", "arrived"];

async function revisionOf(s: Step, id: string): Promise<number> {
  return (await getOrder(s.c, id))?.revision ?? 0;
}

async function callIn(s: Step, timeZone: string): Promise<Takeaway | null> {
  const [pz] = (await listPizzerias(s.c)).filter((p) => p.name === TRATTORIA);
  const [holder] = PEOPLE;
  if (pz === undefined || holder === undefined) return null;
  const order = await openOrder(s, holder, {
    pizzeria: { id: pz.id, name: pz.name },
    closes_at: new Date(s.now.getTime() + 15 * MIN),
    note: "Demo takeaway order",
    day: eventDay(s.now, timeZone),
    max_open: Number.MAX_SAFE_INTEGER,
  });
  const menu = await liveMenu(s.c, pz.id);
  for (const person of PEOPLE) {
    const entry = menu.items.find((m) => m.number === person.number);
    if (entry === undefined) continue;
    const input = parseItemBody({ kind: "menu", menu_item_id: entry.id }, menu);
    await addItem(
      s,
      person,
      order.id,
      input,
      snapshotOf(input, menu),
      Number.MAX_SAFE_INTEGER,
      pz.id,
    );
  }
  await place(s, order.id, {
    placed_at: s.now,
    estimate_at: new Date(s.now.getTime() + ESTIMATE_MS),
    payer: holder,
  });
  return { id: order.id, revision: await revisionOf(s, order.id) };
}

/** Whether the order's current stage has lasted long enough to move on. */
const due = (row: OrderRow, now: Date): boolean => {
  const since = row.state === "placed" ? row.placed_at : row.arrived_at;
  return since !== null && now.getTime() - since.getTime() >= STAGE_MS;
};

/** One run's step for the takeaway order; `mark` is the seed's own, if any. */
export async function stepTakeaway(
  s: Step,
  mark: Takeaway | null,
  timeZone: string,
): Promise<{ said: string; mark: Takeaway | null }> {
  const row = mark === null ? null : await getOrder(s.c, mark.id);
  if (mark !== null && row !== null && LIVE.includes(row.state)) {
    if (row.revision !== mark.revision || (row.state !== "placed" && row.state !== "arrived"))
      return { said: HAND_MADE_TAKEAWAY, mark };
    if (!due(row, s.now)) return { said: TAKEAWAY_WAITS, mark };
    if (row.state === "placed") {
      await arrive(s, row.id, PICKUP);
      return {
        said: ARRIVED_TAKEAWAY,
        mark: { id: row.id, revision: await revisionOf(s, row.id) },
      };
    }
    await done(s, row.id, "handed_out");
    const next = await callIn(s, timeZone);
    return { said: next === null ? NO_TRATTORIA : NEXT_TAKEAWAY, mark: next };
  }
  if ((await ordersWhere(s.c, `state = ANY($1::text[])`, [["placed", "arrived"]])).length > 0)
    return { said: OTHER_CALLED_IN, mark };
  const next = await callIn(s, timeZone);
  return { said: next === null ? NO_TRATTORIA : CALLED_IN_TAKEAWAY, mark: next };
}
