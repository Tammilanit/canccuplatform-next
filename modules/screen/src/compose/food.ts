/**
 * The food box (`food_status`, contracts/screen.md, Widgets; #643, step 5 D2, L3, L8, U11): Screen
 * keeps each pizza order's event-wide part from `pizza.order.*` and `pizza.item.*`. Main reads the
 * pizza streams from their start at every boot, as it does Moments' and the agenda's, and every
 * container reads every event, so events come twice and out of turn: the order's own `revision`
 * decides (it grows with every change, a pizza's too). A done or cancelled order keeps its row,
 * emptied of everything but its revision, so an older event cannot bring it back and no name
 * stays once it is over.
 */
import type { Event, SqlClient } from "@canccu/kit";
import type { Db } from "../db.js";

/** What the box keeps of an order: the catalog's Order, names only as its holder's. */
export interface FoodOrder {
  id: string;
  seq: number;
  state: string;
  pizzeria_name: string;
  target_at: string | null;
  closes_at: string | null;
  estimate_at: string | null;
  pickup: string | null;
  holder_name: string | null;
  pizza_count: number;
  people_count: number;
  placed_at: string | null;
  arrived_at: string | null;
}

const OVER = new Set(["done", "cancelled"]);
/** U11: a called-in order that never arrived leaves the box after this. */
export const PLACED_FOR_MS = 3 * 3600_000;
/** An order marked here but never done (the scheduler's timer is 2 h by default) leaves too. */
const HERE_FOR_MS = 3 * 3600_000;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function keep(o: Record<string, unknown>): FoodOrder | null {
  if (typeof o.id !== "string" || typeof o.state !== "string") return null;
  const pizzeria = (o.pizzeria ?? {}) as { name?: unknown };
  const holder = o.holder as { name?: unknown } | null | undefined;
  return {
    id: o.id,
    seq: num(o.seq),
    state: o.state,
    pizzeria_name: str(pizzeria.name) ?? "",
    target_at: str(o.target_at),
    closes_at: str(o.closes_at) ?? str(o.target_at),
    estimate_at: str(o.estimate_at),
    pickup: str(o.pickup),
    holder_name: str(holder?.name),
    pizza_count: num(o.pizza_count),
    people_count: num(o.people_count),
    placed_at: str(o.placed_at),
    arrived_at: str(o.arrived_at),
  };
}

const NEWER = "screen_food_orders.revision < EXCLUDED.revision";

/** Apply one event of a pizza tenant stream; run inside the event's tenant. */
export async function applyFoodEvent(db: Db, event: Event): Promise<void> {
  if (event.source !== "pizza") return;
  if (event.type.startsWith("pizza.item.")) {
    const id = event.data.order_id;
    const revision = event.data.order_revision;
    if (typeof id !== "string" || typeof revision !== "number") return;
    // A pizza moves the counts of an order Screen already keeps; it never makes one.
    await db.tenant((c) =>
      c.query(
        `UPDATE screen_food_orders SET revision = $2, updated_at = now(),
           "order" = "order" || jsonb_build_object('pizza_count', $3::int, 'people_count', $4::int)
         WHERE order_id = $1 AND revision < $2 AND NOT over`,
        [id, revision, num(event.data.pizza_count), num(event.data.people_count)],
      ),
    );
    return;
  }
  if (!event.type.startsWith("pizza.order.")) return;
  const raw = event.data.order as Record<string, unknown> | undefined;
  const o = raw === undefined ? null : keep(raw);
  if (o === null || typeof raw?.revision !== "number") return;
  const over = OVER.has(o.state);
  await db.tenant((c) =>
    c.query(
      `INSERT INTO screen_food_orders (order_id, revision, over, "order") VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, order_id) DO UPDATE SET
         revision = EXCLUDED.revision, over = EXCLUDED.over, "order" = EXCLUDED."order",
         updated_at = now()
       WHERE ${NEWER} AND NOT screen_food_orders.over`,
      [o.id, raw.revision, over, JSON.stringify(over ? {} : o)],
    ),
  );
}

/** The orders not over, for the box. */
export async function loadFood(c: SqlClient): Promise<FoodOrder[]> {
  const { rows } = await c.query(
    `SELECT "order" FROM screen_food_orders WHERE NOT over ORDER BY order_id`,
    [],
  );
  return rows.map((r) => (r as { order: FoodOrder }).order);
}

const RANK: Record<string, number> = { arrived: 0, open: 1, closed: 2, placed: 3 };
const at = (iso: string | null) => (iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso));

/** Most urgent first: here now, then closing soonest, then being called, then on the way. */
function urgency(a: FoodOrder, b: FoodOrder): number {
  const r = (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9);
  if (r !== 0) return r;
  if (a.state === "arrived") return at(b.arrived_at) - at(a.arrived_at);
  if (a.state === "placed")
    return at(a.estimate_at ?? a.placed_at) - at(b.estimate_at ?? b.placed_at);
  return at(a.closes_at) - at(b.closes_at) || a.seq - b.seq;
}

/** What the box shows of an order now, or nothing (L3, U11). */
function shown(o: FoodOrder, nowMs: number): boolean {
  if (o.state === "placed") return o.placed_at === null || nowMs - at(o.placed_at) < PLACED_FOR_MS;
  if (o.state === "arrived") return o.arrived_at === null || nowMs - at(o.arrived_at) < HERE_FOR_MS;
  return o.state === "open" || o.state === "closed";
}

/**
 * The `food_status` view-model: the first order's fields at the top, as one order's templates
 * read them, and every order in `orders` (D2); null when nothing is open or on the way.
 */
export function foodFields(
  orders: FoodOrder[],
  o: { nowMs: number; time: (iso: string | null) => string | null; names: boolean },
): Record<string, unknown> | null {
  const list = orders.filter((x) => shown(x, o.nowMs)).sort(urgency);
  if (list.length === 0) return null;
  const row = (x: FoodOrder) => {
    const holder = o.names ? x.holder_name : null;
    const status =
      x.state === "open"
        ? `Open · closes ${o.time(x.closes_at) ?? ""} · ${x.pizza_count} pizzas`
        : x.state === "closed"
          ? "Closed · being called"
          : x.state === "placed"
            ? x.estimate_at === null
              ? "On the way"
              : `On the way · about ${o.time(x.estimate_at) ?? ""}`
            : holder === null
              ? "Pizza is here"
              : `Pizza is here · collect from ${holder}`;
    return {
      state: x.state,
      seq: x.seq,
      pizzeria_name: x.pizzeria_name,
      target_at: x.target_at,
      closes_at: x.closes_at,
      estimate_at: x.estimate_at,
      pickup: x.pickup,
      pizza_count: x.pizza_count,
      people_count: x.people_count,
      holder_name: holder,
      status_text: status,
    };
  };
  const rows = list.map(row);
  const [first] = rows;
  return {
    title: "Food",
    state: first?.state,
    seq: first?.seq,
    pizzeria_name: first?.pizzeria_name,
    target_at: first?.target_at,
    pizza_count: first?.pizza_count,
    people_count: first?.people_count,
    holder_name: first?.holder_name,
    orders: rows,
  };
}
