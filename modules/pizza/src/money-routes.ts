/**
 * Money on the order (the step 5 plan, Money), in the API only, never on the bus: the payer, the
 * total, each pizza's price, the split and settle to. A change once the order is closed is audited,
 * and the people whose amount it changed are told with `pizza.amount.changed`, without the amounts.
 */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import { body, notFound, ok, tenantOf, whoIs, write } from "./http.js";
import type { AppDeps, WriteCtx } from "./http.js";
import { Conflict, cannot } from "./conflicts.js";
import { CALLED_IN } from "./model.js";
import { amounts } from "./money.js";
import type { Amounts } from "./money.js";
import { authorize } from "./policy.js";
import type { As } from "./policy.js";
import { facts, orderFor } from "./present.js";
import { getItem, getOrder, itemsOf, logStep } from "./store.js";
import type { OrderRow } from "./store.js";
import { bad, parsePrice, parseTotal } from "./validate.js";

type Params = { id: string };
type Changes = Record<string, { old: unknown; new: unknown }>;

async function moneyView(c: SqlClient, o: OrderRow): Promise<Record<string, unknown>> {
  const items = await itemsOf(c, [o.id]);
  const a = amounts(o, items);
  return {
    order_id: o.id,
    payer: o.payer_user_id === null ? null : { user_id: o.payer_user_id, name: o.payer_name },
    total_cents: o.total_cents,
    split: o.split,
    split_effective: a.split,
    exact_possible: a.exact_possible,
    estimated: a.estimated,
    extras_cents: a.extras_cents,
    settle_to: o.settle_to,
    total_effective_cents: a.total_cents,
    people: a.people,
    prices: items.map((i) => ({
      item_id: i.id,
      user_id: i.user_id,
      label: i.label,
      price_cents: i.price_cents,
    })),
  };
}

const amountsOf = async (c: SqlClient, o: OrderRow): Promise<Amounts> =>
  amounts(o, await itemsOf(c, [o.id]));

/** After the change: audit it once the order is closed, and tell those whose amount moved (U14). */
async function afterChange(
  c: SqlClient,
  deps: AppDeps,
  w: WriteCtx,
  before: { order: OrderRow; amounts: Amounts },
  changes: Changes,
): Promise<OrderRow> {
  const order = (await getOrder(c, before.order.id)) as OrderRow;
  if (Object.keys(changes).length === 0) return order;
  await logStep(
    c,
    order.id,
    w.now,
    { user_id: w.session.userId, name: w.session.userName },
    "money_changed",
    {
      fields: Object.keys(changes),
    },
  );
  if (order.state === "open") return order;
  await deps.audit({
    tenant_id: w.ctx.tenant_id,
    actor_user_id: w.caller.user_id,
    action: "pizza.order.money_changed",
    target: { type: "order", id: order.id },
    changes,
  });
  const was = new Map(before.amounts.people.map((p) => [p.user_id, p.amount_cents]));
  const now = await amountsOf(c, order);
  const told = now.people
    .filter(
      (p) =>
        p.user_id !== null &&
        !p.user_id.startsWith("anon_") &&
        was.get(p.user_id) !== p.amount_cents,
    )
    .map((p) => p.user_id as string)
    .sort();
  if (told.length > 0) {
    await deps.outbox.add(
      c,
      "pizza.amount.changed",
      { order_id: order.id, user_ids: told, actor_user_id: w.caller.user_id },
      { version: 1 },
    );
  }
  return order;
}

/** Locks the order for a money change and checks who may make it. */
async function forMoney(
  c: SqlClient,
  w: WriteCtx,
  id: string,
  action: "money.edit" | "money.payer",
): Promise<{ order: OrderRow; as: As }> {
  const order = await getOrder(c, id, true);
  if (order === null) throw notFound();
  const { as } = authorize(action, w.caller, facts(w.ctx, w.now, order));
  if (order.state === "cancelled") throw cannot("money", order);
  return { order, as };
}

export function moneyRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: Params }>("/api/pizza/orders/:id/money", async (request) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    return deps.db.tenant(async (c) => {
      const { order } = await orderFor(c, request.params.id, "money.read", caller, ctx, deps.now());
      return moneyView(c, order);
    });
  });

  app.patch<{ Params: Params }>("/api/pizza/orders/:id/money", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const b = body(request);
      const { order } = await forMoney(
        c,
        w,
        request.params.id,
        b.payer_user_id === undefined ? "money.edit" : "money.payer",
      );
      const before = { order, amounts: await amountsOf(c, order) };
      const items = await itemsOf(c, [order.id]);
      const changes: Changes = {};
      const sets: string[] = [];
      const values: unknown[] = [];
      const set = (col: string, v: unknown, old: unknown, label = col) => {
        if (v === old) return;
        values.push(v);
        sets.push(`${col} = $${values.length + 1}`);
        if (label !== "") changes[label] = { old, new: v };
      };
      if (b.total_cents !== undefined) {
        // The total is what the pizzeria was paid: known once the order is called in.
        if (!CALLED_IN.includes(order.state)) throw cannot("total", order);
        set(
          "total_cents",
          b.total_cents === null ? null : parseTotal(b.total_cents),
          order.total_cents,
        );
      }
      if (b.split !== undefined) {
        if (b.split !== null && b.split !== "exact" && b.split !== "even")
          bad("split", "exact, even or null");
        if (
          b.split === "exact" &&
          !amounts({ total_cents: order.total_cents, split: "exact" }, items).exact_possible
        ) {
          throw new Conflict("prices_missing", "Exact needs a price on every pizza.");
        }
        set("split", b.split, order.split);
      }
      if (b.settle_to !== undefined) {
        if (b.settle_to !== "organiser" && b.settle_to !== "payer")
          bad("settle_to", "organiser or payer");
        if (b.settle_to === "payer" && !(await deps.settings(w.ctx.tenant_id)).settle_to_payer) {
          throw new Conflict(
            "settle_to_payer_off",
            "This event settles food through the organiser.",
          );
        }
        set("settle_to", b.settle_to, order.settle_to);
      }
      if (b.payer_user_id !== undefined) {
        const known = new Map<string, string>();
        for (const i of items)
          if (i.user_id !== null && i.name !== null) known.set(i.user_id, i.name);
        if (order.holder_user_id !== null && order.holder_name !== null)
          known.set(order.holder_user_id, order.holder_name);
        if (order.payer_user_id !== null && order.payer_name !== null)
          known.set(order.payer_user_id, order.payer_name);
        const name = typeof b.payer_user_id === "string" ? known.get(b.payer_user_id) : undefined;
        if (name === undefined) bad("payer_user_id", "must be someone in the order or its holder");
        set("payer_user_id", b.payer_user_id, order.payer_user_id, "payer");
        set("payer_name", name, order.payer_name, "");
      }
      if (sets.length > 0) {
        await c.query(
          `UPDATE pizza_orders SET ${sets.join(", ")}, revision = revision + 1 WHERE id = $1`,
          [order.id, ...values],
        );
      }
      return ok(await moneyView(c, await afterChange(c, deps, w, before, changes)));
    }),
  );

  app.put<{ Params: Params }>("/api/pizza/items/:id/price", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const item = await getItem(c, request.params.id);
      if (item === null) throw notFound("pizza");
      const { order } = await forMoney(c, w, item.order_id, "money.edit");
      const before = { order, amounts: await amountsOf(c, order) };
      const price = parsePrice(body(request).price_cents, "price_cents");
      const changes: Changes = {};
      if (price !== item.price_cents) {
        await c.query(`UPDATE pizza_items SET price_cents = $2, updated_at = $3 WHERE id = $1`, [
          item.id,
          price,
          w.now,
        ]);
        await c.query(`UPDATE pizza_orders SET revision = revision + 1 WHERE id = $1`, [order.id]);
        changes[`price:${item.id}`] = { old: item.price_cents, new: price };
      }
      return ok(await moneyView(c, await afterChange(c, deps, w, before, changes)));
    }),
  );
}
