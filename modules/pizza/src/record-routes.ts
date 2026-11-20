/**
 * The daily record and the export for the payment system (O10, M4; `pizza.record.read`), and the
 * caller's own: their orders (D14) and the privacy export and delete (contracts/README.md).
 */
import type { FastifyInstance } from "fastify";
import { NotSignedIn } from "@canccu/kit";
import type { SqlClient, TenantContext } from "@canccu/kit";
import { buildExport, exportId } from "./export-csv.js";
import type { ExportOrder } from "./export-csv.js";
import { tenantOf, whoIs } from "./http.js";
import type { AppDeps } from "./http.js";
import { amounts } from "./money.js";
import { NO_FACTS, authorize } from "./policy.js";
import { present } from "./present.js";
import { forgetUser } from "./privacy.js";
import { buildRecord } from "./record.js";
import { itemsOf, ordersWhere } from "./store.js";
import type { OrderRow } from "./store.js";
import { DAY } from "./time.js";
import { InvalidBody } from "./validate.js";

type DayQuery = { Querystring: { day?: string } };

function dayOf(q: { day?: string }): string | null {
  if (q.day === undefined) return null;
  if (!DAY.test(q.day)) throw new InvalidBody("day", "YYYY-MM-DD");
  return q.day;
}

const ordersOf = (c: SqlClient, day: string | null): Promise<OrderRow[]> =>
  day === null ? ordersWhere(c, "true", []) : ordersWhere(c, "day = $1::date", [day]);

async function exportOf(deps: AppDeps, c: SqlClient, ctx: TenantContext, day: string | null) {
  const orders = await ordersOf(c, day);
  const items = await itemsOf(
    c,
    orders.map((o) => o.id),
  );
  const discord = new Map<string, string | null>();
  for (const i of items) {
    if (i.user_id !== null && !i.user_id.startsWith("anon_") && !discord.has(i.user_id)) {
      discord.set(i.user_id, (await deps.people(i.user_id)).discord_user_id);
    }
  }
  const input: ExportOrder[] = orders.map((o) => ({
    day: o.day,
    seq: o.seq,
    state: o.state,
    placed_at: o.placed_at,
    pizzeria: o.pizzeria_name,
    payer_name: o.payer_name,
    total_cents: o.total_cents,
    split: o.split,
    settle_to: o.settle_to,
    rows: items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        user_id: i.user_id,
        name: i.name,
        price_cents: i.price_cents,
        discord_id: discord.get(i.user_id ?? "") ?? null,
      })),
  }));
  return {
    ...buildExport(input, ctx.time_zone),
    file_name: `pizza-${ctx.tenant_id}-${day ?? "all"}.csv`,
  };
}

export function recordRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<DayQuery>("/api/pizza/record", async (request) => {
    const { caller } = await whoIs(deps, request);
    authorize("record.read", caller, NO_FACTS);
    const day = dayOf(request.query);
    return deps.db.tenant(async (c) => {
      const orders = await ordersOf(c, day);
      const items = await itemsOf(
        c,
        orders.map((o) => o.id),
      );
      return buildRecord(
        orders.map((o) => ({
          ...o,
          pizzeria: o.pizzeria_name,
          cancelled_after_placed: o.state === "cancelled" && o.placed_at !== null,
          rows: items.filter((i) => i.order_id === o.id),
        })),
      );
    });
  });

  app.get<DayQuery>("/api/pizza/export", async (request) => {
    const { caller } = await whoIs(deps, request);
    authorize("record.export", caller, NO_FACTS);
    const day = dayOf(request.query);
    return deps.db.tenant((c) => exportOf(deps, c, tenantOf(request), day));
  });

  app.get<DayQuery>("/api/pizza/export.csv", async (request, reply) => {
    const { caller } = await whoIs(deps, request);
    authorize("record.export", caller, NO_FACTS);
    const day = dayOf(request.query);
    const out = await deps.db.tenant((c) => exportOf(deps, c, tenantOf(request), day));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${out.file_name}"`)
      .header("canccu-left-out", out.left_out.map((l) => l.order_id).join(","))
      .send(out.csv);
  });

  app.get("/api/pizza/me/orders", async (request) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    if (caller === null) throw new NotSignedIn("sign in first");
    const now = deps.now();
    return deps.db.tenant(async (c) => {
      const orders = await ordersWhere(
        c,
        `holder_user_id = $1 OR opened_by_user_id = $1 OR id IN (SELECT order_id FROM pizza_items WHERE user_id = $1)`,
        [caller.user_id],
      );
      orders.sort((a, b) => b.day.localeCompare(a.day) || b.seq - a.seq);
      const views = [];
      for (const o of orders) views.push(await present(c, caller, ctx, now, o));
      return { orders: views };
    });
  });

  app.get("/api/pizza/me/export", async (request) => {
    const { caller } = await whoIs(deps, request);
    if (caller === null) throw new NotSignedIn("sign in first");
    const me = caller.user_id;
    return deps.db.tenant(async (c) => {
      const orders = await ordersWhere(
        c,
        `holder_user_id = $1 OR opened_by_user_id = $1 OR payer_user_id = $1 OR id IN (SELECT order_id FROM pizza_items WHERE user_id = $1)`,
        [me],
      );
      const items = await itemsOf(
        c,
        orders.map((o) => o.id),
      );
      const mine = items.filter((i) => i.user_id === me);
      const { rows: history } = await c.query(
        `SELECT order_id, at, kind FROM pizza_order_log WHERE actor_user_id = $1 ORDER BY id`,
        [me],
      );
      const byId = new Map(orders.map((o) => [o.id, o]));
      return {
        items: mine.map((i) => ({
          order_id: i.order_id,
          order: exportId(byId.get(i.order_id) as OrderRow),
          pizzeria: byId.get(i.order_id)?.pizzeria_name,
          kind: i.kind,
          label: i.label,
          note: i.note,
          comment: i.comment,
          price_cents: i.price_cents,
          handed_out: i.handed_out_at !== null,
          created_at: i.created_at.toISOString(),
        })),
        amounts: orders
          .filter((o) => mine.some((i) => i.order_id === o.id))
          .map((o) => ({
            order_id: o.id,
            amount_cents:
              amounts(
                o,
                items.filter((i) => i.order_id === o.id),
              ).people.find((p) => p.user_id === me)?.amount_cents ?? null,
          })),
        orders: orders
          .filter(
            (o) => o.holder_user_id === me || o.opened_by_user_id === me || o.payer_user_id === me,
          )
          .map((o) => ({
            order_id: o.id,
            order: exportId(o),
            pizzeria: o.pizzeria_name,
            held: o.holder_user_id === me,
            opened: o.opened_by_user_id === me,
            paid: o.payer_user_id === me,
            total_cents: o.payer_user_id === me ? o.total_cents : null,
          })),
        history: (history as { order_id: string; at: Date; kind: string }[]).map((h) => ({
          order_id: h.order_id,
          at: h.at.toISOString(),
          kind: h.kind,
        })),
      };
    });
  });

  // No idempotency key, and also on an archived event: deleting one's data is always allowed.
  app.delete("/api/pizza/me", async (request, reply) => {
    tenantOf(request);
    const { caller } = await whoIs(deps, request);
    if (caller === null) throw new NotSignedIn("sign in first");
    await deps.db.tenant((c) => forgetUser(c, deps, caller.user_id, deps.now()));
    await deps.outbox.flush();
    return reply.status(204).send();
  });
}
