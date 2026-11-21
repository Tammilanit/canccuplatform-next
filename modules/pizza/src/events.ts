/**
 * The events the module emits (contracts/pizza.md, Events; the catalog's pizza section), stored in
 * the write's own transaction and sent after it commits (E12). Money never travels on the bus.
 */
import type { Outbox, SqlClient } from "@canccu/kit";
import type { People } from "./people.js";
import { countsOf, itemsOf } from "./store.js";
import type { ItemRow, OrderRow } from "./store.js";

export interface Person {
  user_id: string | null;
  discord_user_id: string | null;
  name: string;
}

export interface Emitter {
  outbox: Outbox;
  people: People;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function personOf(
  people: People,
  userId: string | null,
  name: string | null,
): Promise<Person | null> {
  // An anonymised row names nobody: it never appears as a Person.
  if (userId === null || name === null || userId.startsWith("anon_")) return null;
  return { user_id: userId, discord_user_id: (await people(userId)).discord_user_id, name };
}

/** The catalog's Order, with the additive `closes_at`, `estimate_at`, `pickup` and `done_at` (D3). */
export async function orderShape(
  e: Emitter,
  o: OrderRow,
  items: ItemRow[],
): Promise<Record<string, unknown>> {
  return {
    id: o.id,
    seq: o.seq,
    state: o.state,
    pizzeria: { id: o.pizzeria_id, name: o.pizzeria_name },
    // Kept as the legacy's name for the time: the close time is when the holder calls (U3).
    target_at: iso(o.closes_at),
    closes_at: iso(o.closes_at),
    estimate_at: iso(o.estimate_at),
    pickup: o.pickup,
    holder: await personOf(e.people, o.holder_user_id, o.holder_name),
    ...countsOf(items),
    opened_at: iso(o.opened_at),
    closed_at: iso(o.closed_at),
    placed_at: iso(o.placed_at),
    arrived_at: iso(o.arrived_at),
    done_at: iso(o.done_at),
    revision: o.revision,
  };
}

/** Everyone with a pizza in the order: `user_ids` for Notify, `people` for the bot and screens. */
export async function peopleOf(e: Emitter, items: ItemRow[]) {
  const seen = new Map<string, string>();
  for (const i of items)
    if (i.user_id !== null && i.name !== null && !i.user_id.startsWith("anon_"))
      seen.set(i.user_id, i.name);
  const ids = [...seen.keys()].sort();
  const people: Person[] = [];
  for (const id of ids) {
    const p = await personOf(e.people, id, seen.get(id) ?? null);
    if (p !== null) people.push(p);
  }
  return { user_ids: ids, people };
}

/** Emits `type` for the order as it is now, with `extra` fields beside `order`. */
export async function emitOrder(
  c: SqlClient,
  e: Emitter,
  type: string,
  o: OrderRow,
  extra: Record<string, unknown> = {},
  withPeople = false,
): Promise<void> {
  const items = await itemsOf(c, [o.id]);
  const data: Record<string, unknown> = {
    order: await orderShape(e, o, items),
    ...(withPeople ? await peopleOf(e, items) : {}),
    ...extra,
  };
  await e.outbox.add(c, type, data, { version: 1 });
}

/** `pizza.item.added`, `.removed` and `.changed`: personal to the row's owner, with the counts. */
export async function emitItem(
  c: SqlClient,
  e: Emitter,
  type: string,
  o: OrderRow,
  item: ItemRow,
  actorUserId: string | null,
): Promise<void> {
  const items = await itemsOf(c, [o.id]);
  await e.outbox.add(
    c,
    type,
    {
      order_id: o.id,
      order_revision: o.revision,
      item_id: item.id,
      user_id: item.user_id,
      person: await personOf(e.people, item.user_id, item.name),
      ...countsOf(items),
      actor_user_id: actorUserId,
      // For Notify, which cannot compare two fields: the owner hears only of someone else's edit.
      order_seq: o.seq,
      by_owner: actorUserId !== null && actorUserId === item.user_id,
    },
    { version: 1 },
  );
}
