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
import { moneyView } from "./money-view.js";
import { amountChanged, payToChanged } from "./notices.js";
import { getReceipt } from "./receipts.js";
import { InvalidBody, bad, parseTotal, requiredPrice } from "./validate.js";

type Params = { id: string };
type Changes = Record<string, { old: unknown; new: unknown }>;

const amountsOf = async (c: SqlClient, o: OrderRow): Promise<Amounts> =>
  amounts(o, await itemsOf(c, [o.id]));

/**
 * After the change: audit it once the order is closed, and tell those whose amount moved (U14);
 * once their shares went out, also whose amount or whom they pay changed (#703).
 */
async function afterChange(
  c: SqlClient,
  deps: AppDeps,
  w: WriteCtx,
  before: { order: OrderRow; amounts: Amounts; as: As },
  changes: Changes,
): Promise<OrderRow> {
  if (Object.keys(changes).length === 0) return (await getOrder(c, before.order.id)) as OrderRow;
  await c.query(`UPDATE pizza_orders SET money_changed_at = $2 WHERE id = $1`, [
    before.order.id,
    w.now,
  ]);
  const order = (await getOrder(c, before.order.id)) as OrderRow;
  await logStep(
    c,
    order.id,
    w.now,
    { user_id: w.session.userId, name: w.session.userName },
    "money_changed",
    {
      fields: Object.keys(changes),
      // The record flags the crew's money edits after call-in, not the holder entering the total.
      crew: before.as === "crew",
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
  await amountChanged(c, deps, order, told, w.caller.user_id);
  if ("settle_to" in changes || "payer" in changes)
    await payToChanged(c, deps, order, w.caller.user_id);
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
      const { order, as } = await forMoney(
        c,
        w,
        request.params.id,
        b.payer_user_id === undefined ? "money.edit" : "money.payer",
      );
      const before = { order, as, amounts: await amountsOf(c, order) };
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
        const total = b.total_cents === null ? null : parseTotal(b.total_cents);
        // Confirming a read names its receipt; a total typed in names none (mockups 18 E, 19).
        let receipt: string | null = null;
        if (b.receipt_id !== undefined && b.receipt_id !== null) {
          const r = typeof b.receipt_id === "string" ? await getReceipt(c, b.receipt_id) : null;
          if (r === null || r.order_id !== order.id)
            bad("receipt_id", "must be a receipt of this order");
          receipt = b.receipt_id as string;
        }
        set("total_cents", total, order.total_cents);
        set("total_receipt_id", receipt, order.total_receipt_id, "");
        if (total !== order.total_cents || receipt !== order.total_receipt_id) {
          set("total_set_at", w.now, order.total_set_at, "");
          set("total_set_by_name", w.session.userName, order.total_set_by_name, "");
          set("total_set_by_user_id", w.session.userId, order.total_set_by_user_id, "");
        }
      }
      if (b.prices !== undefined) {
        if (!Array.isArray(b.prices)) bad("prices", "a list of { item_id, price_cents }");
        for (const p of b.prices as unknown[]) {
          const e = (p ?? {}) as Record<string, unknown>;
          const item = items.find((i) => i.id === e.item_id);
          if (item === undefined)
            throw new InvalidBody("prices", "every item_id must be a pizza of this order");
          const price = requiredPrice(e, "price_cents");
          if (price === item.price_cents) continue;
          await c.query(`UPDATE pizza_items SET price_cents = $2, updated_at = $3 WHERE id = $1`, [
            item.id,
            price,
            w.now,
          ]);
          changes[`price:${item.id}`] = { old: item.price_cents, new: price };
          item.price_cents = price;
        }
      }
      if (b.split !== undefined) {
        // After `prices`: a confirmed read may be what makes exact possible.
        if (b.split !== null && b.split !== "exact" && b.split !== "even")
          bad("split", "exact, even or null");
        if (b.split === "exact" && !amounts({ ...order, split: "exact" }, items).exact_possible) {
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
      if (sets.length > 0 || Object.keys(changes).length > 0) {
        await c.query(
          `UPDATE pizza_orders SET ${[...sets, "revision = revision + 1"].join(", ")} WHERE id = $1`,
          [order.id, ...values],
        );
      }
      return ok(await moneyView(c, await afterChange(c, deps, w, before, changes)));
    }),
  );

  app.put<{ Params: Params }>("/api/pizza/items/:id/price", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const found = await getItem(c, request.params.id);
      if (found === null) throw notFound("pizza");
      const { order, as } = await forMoney(c, w, found.order_id, "money.edit");
      // Read again under the order's lock: a removal that held it first has taken the pizza (#789).
      const item = await getItem(c, found.id);
      if (item === null) throw notFound("pizza");
      const before = { order, as, amounts: await amountsOf(c, order) };
      const price = requiredPrice(body(request), "price_cents");
      const changes: Changes = {};
      if (price !== item.price_cents) {
        // The erase path deletes pizzas without the order's lock: no row back means the pizza is gone.
        const upd = await c.query(
          `UPDATE pizza_items SET price_cents = $2, updated_at = $3 WHERE id = $1 RETURNING id`,
          [item.id, price, w.now],
        );
        if (upd.rows.length === 0) throw notFound("pizza");
        await c.query(`UPDATE pizza_orders SET revision = revision + 1 WHERE id = $1`, [order.id]);
        changes[`price:${item.id}`] = { old: item.price_cents, new: price };
      }
      return ok(await moneyView(c, await afterChange(c, deps, w, before, changes)));
    }),
  );
}
