/**
 * Settling to the payer (M1, U12 A; the PO note of 2026-11-19): the holder's Paid ticks, a memo and
 * never a payment, and "Pay me with", the payer's MobilePay number or bank account, kept on their
 * own details so it is offered again. Both are personal data, in the API only, never on the bus:
 * each person sees their own mark and the payer's details; the holder and the crew see every mark.
 */
import type { FastifyInstance } from "fastify";
import { NotSignedIn } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { Conflict, cannot } from "./conflicts.js";
import { body, eventArchived, notFound, ok, tenantOf, whoIs, write } from "./http.js";
import type { AppDeps } from "./http.js";
import { moneyView } from "./money-view.js";
import { NO_FACTS, authorize } from "./policy.js";
import { facts } from "./present.js";
import { markedPaid, payToChanged } from "./notices.js";
import { getOrder, itemsOf, ordersWhere } from "./store.js";
import { InvalidBody } from "./validate.js";

export interface PayDetails {
  mobilepay: string | null;
  iban: string | null;
}

/** Who the order's payer has marked paid. */
export async function paidOf(c: SqlClient, orderId: string): Promise<Set<string>> {
  const { rows } = await c.query(`SELECT user_id FROM pizza_paid WHERE order_id = $1`, [orderId]);
  return new Set((rows as { user_id: string }[]).map((r) => r.user_id));
}

export async function payDetailsOf(
  c: SqlClient,
  userId: string,
): Promise<PayDetails & { updated_at: string | null }> {
  const { rows } = await c.query(
    `SELECT mobilepay, iban, updated_at FROM pizza_pay_details WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0] as (PayDetails & { updated_at: Date }) | undefined;
  return {
    mobilepay: r?.mobilepay ?? null,
    iban: r?.iban ?? null,
    updated_at: r?.updated_at.toISOString() ?? null,
  };
}

const PHONE = /^\+?[0-9][0-9 ]{5,19}$/;

/** "fi2112345600000785" → "FI21 1234 5600 0007 85", or null when its check digits fail. */
export function ibanOf(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(compact)) return null;
  const moved = compact.slice(4) + compact.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1 ? (compact.match(/.{1,4}/g) ?? []).join(" ") : null;
}

function detailsOf(b: Record<string, unknown>): PayDetails {
  const text = (v: unknown, field: string): string | null => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return null;
    if (typeof v !== "string") throw new InvalidBody(field, "must be a string");
    return v.trim();
  };
  const phone = text(b.mobilepay, "mobilepay");
  if (phone !== null && !PHONE.test(phone))
    throw new InvalidBody("mobilepay", "a phone number, digits and spaces");
  const rawIban = text(b.iban, "iban");
  const iban = rawIban === null ? null : ibanOf(rawIban);
  if (rawIban !== null && iban === null) throw new InvalidBody("iban", "a valid IBAN");
  return { mobilepay: phone, iban };
}

export function paidRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.put<{ Params: { id: string; user: string } }>(
    "/api/pizza/orders/:id/paid/:user",
    (request, reply) =>
      write(deps, request, reply, async (c, w) => {
        const order = await getOrder(c, request.params.id, true);
        if (order === null) throw notFound();
        authorize("paid.tick", w.caller, facts(w.ctx, w.now, order));
        if (order.state === "cancelled") throw cannot("money", order);
        if (order.settle_to !== "payer") {
          throw new Conflict(
            "not_settled_to_payer",
            "People pay the organiser for this order: there is nothing to mark.",
          );
        }
        const user = request.params.user;
        const people = new Set((await itemsOf(c, [order.id])).map((i) => i.user_id));
        if (!people.has(user) || user === order.payer_user_id)
          throw new InvalidBody("user_id", "someone in the order other than its payer");
        const paid = body(request).paid;
        if (typeof paid !== "boolean") throw new InvalidBody("paid", "true or false");
        if (paid) {
          const { rows } = await c.query(
            `INSERT INTO pizza_paid (order_id, user_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
             RETURNING user_id`,
            [order.id, user, w.now],
          );
          // A tick already there is no news (#703).
          if (rows.length === 1) await markedPaid(c, deps, order, user, w.caller.user_id);
        } else {
          await c.query(`DELETE FROM pizza_paid WHERE order_id = $1 AND user_id = $2`, [
            order.id,
            user,
          ]);
        }
        return ok(await moneyView(c, order));
      }),
  );

  app.get("/api/pizza/me/pay-details", async (request) => {
    tenantOf(request);
    const { caller } = await whoIs(deps, request);
    if (caller === null) throw new NotSignedIn("sign in first");
    return deps.db.tenant((c) => payDetailsOf(c, caller.user_id));
  });

  app.put("/api/pizza/me/pay-details", async (request) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    if (caller === null) throw new NotSignedIn("sign in first");
    if (ctx.status === "archived") throw eventArchived();
    authorize("order.read", caller, NO_FACTS);
    const d = detailsOf(body(request));
    const changed = await deps.db.tenant(async (c) => {
      const was = await payDetailsOf(c, caller.user_id);
      await c.query(
        `INSERT INTO pizza_pay_details (user_id, mobilepay, iban, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET mobilepay = EXCLUDED.mobilepay,
           iban = EXCLUDED.iban, updated_at = EXCLUDED.updated_at`,
        [caller.user_id, d.mobilepay, d.iban, deps.now()],
      );
      if (was.mobilepay !== d.mobilepay || was.iban !== d.iban) {
        // Those who still pay this person are told how to pay changed (#703), never the details.
        const orders = await ordersWhere(
          c,
          `payer_user_id = $1 AND settle_to = 'payer' AND shares_sent_at IS NOT NULL AND state <> 'cancelled'`,
          [caller.user_id],
        );
        for (const o of orders) await payToChanged(c, deps, o, caller.user_id);
      }
      return payDetailsOf(c, caller.user_id);
    });
    await deps.outbox.flush();
    return changed;
  });
}
