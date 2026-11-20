/** The 409s of the lifecycle: why a step cannot run, and the unique indexes' backstops. */
import { KitError } from "@canccu/kit";
import type { ErrorBody, SqlClient } from "@canccu/kit";
import { UNPLACED } from "./model.js";
import type { OrderRow } from "./store.js";

/** A 409 with the fields a client needs to explain it (the holder, the open order, …). */
export class Conflict extends KitError {
  constructor(
    code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message, { status: 409, code });
  }
  override toBody(): ErrorBody {
    return { error: { ...super.toBody().error, ...this.extra } };
  }
}

const MESSAGES: Record<string, string> = {
  cancelled: "The order was cancelled.",
  done: "The order is done.",
  placed: "The order is already called in.",
  not_placed: "The order is not called in yet.",
  not_arrived: "The pizzas have not arrived yet.",
  closed: "The order is closed.",
};

/** Why `step` cannot run on an order in its current state. */
export function cannot(step: string, o: OrderRow): Conflict {
  const unplaced = UNPLACED.includes(o.state);
  let code = "conflict";
  if (o.state === "cancelled" || o.state === "done") code = o.state;
  else if (["arrive", "undo", "total"].includes(step)) code = unplaced ? "not_placed" : "conflict";
  else if (["done", "hand_out"].includes(step)) code = unplaced ? "not_placed" : "not_arrived";
  else if (!unplaced) code = "placed";
  else if (step === "add" && o.state === "closed") code = "closed";
  return new Conflict(code, MESSAGES[code] ?? "The order changed meanwhile.");
}

const UNIQUE = "23505";

/**
 * `fn` in a savepoint: a unique index (one open order per pizzeria, one held per person) that
 * refuses it becomes its 409 instead of aborting the whole transaction.
 */
export async function guarded<T>(
  c: SqlClient,
  fn: () => Promise<T>,
  onUnique: (constraint: string) => Error,
): Promise<T> {
  await c.query("SAVEPOINT pizza_guard", []);
  try {
    const out = await fn();
    await c.query("RELEASE SAVEPOINT pizza_guard", []);
    return out;
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT pizza_guard", []);
    const e = err as { code?: string; constraint?: string };
    if (e.code === UNIQUE) throw onUnique(e.constraint ?? "");
    throw err;
  }
}

export const uniqueConflict = (constraint: string): Error =>
  constraint === "pizza_orders_one_held"
    ? new Conflict("already_holding", "You already hold an open order.")
    : constraint === "pizza_orders_one_open"
      ? new Conflict("another_open", "Another order of this pizzeria is open.")
      : new Conflict("conflict", "That changed meanwhile.");
