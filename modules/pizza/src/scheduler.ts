/**
 * The module's scheduler (O2; contracts/pizza.md, The scheduler). Every container ticks every
 * 30 s through the events pizza serves. A tick first writes each live order's due steps as rows
 * (`pizza_due`) from the order and the event's settings, then takes the due ones one by one, each
 * `FOR UPDATE SKIP LOCKED` in its own transaction, checks it again against the order, takes the
 * step and marks the row sent in that same transaction, which also stores the step's events in the
 * outbox: a step happens once into the outbox, which sends it at least once (agenda's timers do
 * the same). So a restart loses nothing and two replicas never take one step twice.
 */
import { withTenant } from "@canccu/kit";
import type { CheckFn, CheckResult, SqlClient } from "@canccu/kit";
import { dueSteps, staleReason } from "./due.js";
import type { Due, Remind } from "./due.js";
import { emitOrder } from "./events.js";
import type { Emitter } from "./events.js";
import type { AppDeps } from "./http.js";
import { scheduled } from "./lifecycle.js";
import { remindUnpaid, shareReady } from "./notices.js";
import type { PizzaSettings } from "./settings.js";
import { getOrder, logStep, ordersWhere } from "./store.js";
import type { OrderRow } from "./store.js";

export const TICK_MS = 30_000;
/** Due steps one tick takes per event at most; the rest wait for the next tick. */
const PER_TICK = 200;
/** /health turns degraded past these. */
const LAG_LIMIT_S = 120;
const QUIET_LIMIT_MS = 3 * TICK_MS;

type Deps = Pick<AppDeps, "db" | "outbox" | "people" | "settings" | "tenants" | "log" | "now">;

interface Row {
  order_id: string;
  step: string;
}

const LIVE = ["open", "closed", "placed", "arrived"];

export class Scheduler {
  private lastTick: Date | null = null;
  private lagSeconds = 0;
  private running = false;

  constructor(private readonly deps: Deps) {}

  /** One pass over every event pizza has served. Overlapping calls in one container wait their turn. */
  async tick(): Promise<void> {
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 5));
    this.running = true;
    try {
      const now = this.deps.now();
      const { rows } = await this.deps.db.global((c) =>
        c.query(`SELECT tenant_id FROM pizza_tenants ORDER BY tenant_id`, []),
      );
      let lag = 0;
      for (const { tenant_id } of rows as { tenant_id: string }[]) {
        try {
          lag = Math.max(lag, await this.tickTenant(tenant_id, now));
        } catch (err) {
          this.deps.log.warn({ err, tenant_id }, "the pizza scheduler failed for an event");
        }
      }
      this.lagSeconds = lag;
      this.lastTick = now;
    } finally {
      this.running = false;
    }
  }

  /** The `scheduler` check of /health: how late the oldest due step was when a tick found it. */
  check(): CheckFn {
    const result = (): CheckResult => {
      if (this.lastTick === null) return { status: "degraded", detail: "not run yet" };
      const quiet = this.deps.now().getTime() - this.lastTick.getTime();
      if (quiet > QUIET_LIMIT_MS)
        return { status: "degraded", detail: `no tick for ${Math.round(quiet / 1000)} s` };
      const detail = `lag ${this.lagSeconds} s`;
      return { status: this.lagSeconds > LAG_LIMIT_S ? "degraded" : "ok", detail };
    };
    return () => Promise.resolve(result());
  }

  /** Answers the lag in seconds: how late the oldest due step was. */
  private async tickTenant(tenant: string, now: Date): Promise<number> {
    const ctx = await this.deps.tenants.byId(tenant);
    // An archived event is read-only, and a deleted one is gone.
    if (ctx === null || ctx.status === "archived") return 0;
    return withTenant(tenant, async () => {
      const settings = await this.deps.settings(tenant);
      const zone = ctx.time_zone;
      const due = await this.deps.db.tenant(async (c) => {
        await this.plan(c, settings, zone);
        const { rows } = await c.query(
          `SELECT order_id, step, due_at FROM pizza_due WHERE sent_at IS NULL AND due_at <= $1
           ORDER BY due_at, order_id, step LIMIT ${PER_TICK}`,
          [now],
        );
        return rows as unknown as (Row & { due_at: Date })[];
      });
      const first = due[0];
      const lag =
        first === undefined ? 0 : Math.round((now.getTime() - first.due_at.getTime()) / 1000);
      for (const row of due) {
        try {
          await this.deps.db.tenant((c) => this.take(c, row, settings, zone, now));
          await this.deps.outbox.flush();
        } catch (err) {
          this.deps.log.warn({ err, ...row }, "a pizza step failed; the next tick tries again");
        }
      }
      return lag;
    });
  }

  /**
   * Writes the due steps of every live order, and drops the unsent ones its state or anchors no
   * longer have. Sent rows stay: they are the record of what ran.
   * One container plans an event at a time; another finds the lock taken and leaves it to it.
   */
  private async plan(c: SqlClient, settings: PizzaSettings, zone: string): Promise<void> {
    const { rows } = await c.query(
      `SELECT pg_try_advisory_xact_lock(hashtext(current_setting('canccu.tenant') || ':pizza-due')) AS mine`,
      [],
    );
    if (!(rows[0] as { mine: boolean }).mine) return;
    // A done order still has its money steps until the payment reminder was taken.
    const orders = await ordersWhere(
      c,
      `state = ANY($1::text[]) OR (state = 'done' AND total_cents IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM pizza_due d WHERE d.order_id = pizza_orders.id AND d.step = 'unpaid'
         AND d.sent_at IS NOT NULL) AND (shares_sent_at IS NULL OR settle_to = 'payer'))`,
      [LIVE],
    );
    const ids: string[] = [];
    const steps: string[] = [];
    const times: Date[] = [];
    for (const o of orders)
      for (const d of dueSteps(o, settings, zone)) {
        ids.push(o.id);
        steps.push(d.step);
        times.push(d.due_at);
      }
    await c.query(
      `INSERT INTO pizza_due (order_id, step, due_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[]) ORDER BY 1, 2
       ON CONFLICT (tenant_id, order_id, step) DO UPDATE SET due_at = EXCLUDED.due_at
       WHERE pizza_due.sent_at IS NULL AND pizza_due.due_at <> EXCLUDED.due_at`,
      [ids, steps, times],
    );
    await c.query(
      `DELETE FROM pizza_due d WHERE sent_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM unnest($1::text[], $2::text[]) w(order_id, step)
         WHERE w.order_id = d.order_id AND w.step = d.step)`,
      [ids, steps],
    );
  }

  /** Takes one due step, unless another container holds it or the order moved on meanwhile. */
  private async take(
    c: SqlClient,
    row: Row,
    settings: PizzaSettings,
    zone: string,
    now: Date,
  ): Promise<void> {
    const { rows } = await c.query(
      `SELECT 1 FROM pizza_due WHERE order_id = $1 AND step = $2 AND sent_at IS NULL
       FOR UPDATE SKIP LOCKED`,
      [row.order_id, row.step],
    );
    if (rows.length === 0) return;
    const o = await getOrder(c, row.order_id, true);
    const all = o === null ? [] : dueSteps(o, settings, zone);
    const d = all.find((x) => x.step === row.step);
    if (o === null || d === undefined || d.due_at.getTime() > now.getTime()) {
      // Not this order's step any more, or not yet: the next plan writes it again if it is.
      await c.query(`DELETE FROM pizza_due WHERE order_id = $1 AND step = $2`, [
        row.order_id,
        row.step,
      ]);
      return;
    }
    const skipped = staleReason(d, all, now) !== null || !(await this.run(c, o, d, now));
    await c.query(
      `UPDATE pizza_due SET sent_at = $3, skipped = $4 WHERE order_id = $1 AND step = $2`,
      [row.order_id, row.step, now, skipped],
    );
  }

  /** The step itself; false when there was nothing to do. */
  private async run(c: SqlClient, o: OrderRow, d: Due, now: Date): Promise<boolean> {
    const e: Emitter = this.deps;
    switch (d.does) {
      case "last_call":
        // A last call after the close would be news of the past.
        if (o.closes_at.getTime() <= now.getTime()) return false;
        await emitOrder(c, e, "pizza.order.closing", o, { closes_at: o.closes_at.toISOString() });
        await logStep(c, o.id, now, null, "last_call");
        return true;
      case "close":
        return scheduled(c, e, o.id, "close", now);
      case "done":
        return scheduled(c, e, o.id, "done", now);
      case "forgotten":
        return scheduled(
          c,
          e,
          o.id,
          o.state === "open" || o.state === "closed" ? "cancel" : "done",
          now,
        );
      case "release": {
        const holder = o.holder_user_id;
        if (!(await scheduled(c, e, o.id, "release", now))) return false;
        const after = (await getOrder(c, o.id)) ?? o;
        await this.remind(
          c,
          after,
          { kind: "released", minutes: minutesSince(o, now), to: "crew_only", family: "release" },
          holder,
          now,
        );
        return true;
      }
      case "share":
        return shareReady(c, e, o, now);
      case "unpaid":
        return remindUnpaid(c, e, o, now);
      case "remind":
        if (d.remind === undefined) return false;
        await this.remind(c, o, d.remind, null, now);
        return true;
    }
  }

  /** One `pizza.reminder.triggered` per person who hears it (D12). */
  private async remind(
    c: SqlClient,
    o: OrderRow,
    r: Remind,
    skip: string | null,
    now: Date,
  ): Promise<void> {
    const crew = (await crewOf(c)).filter((u) => u !== o.holder_user_id && u !== skip);
    const to: { user_id: string; role: "holder" | "crew" }[] = [];
    if (r.to !== "crew_only" && o.holder_user_id !== null)
      to.push({ user_id: o.holder_user_id, role: "holder" });
    if (r.to !== "holder" || o.holder_user_id === null)
      for (const u of crew) to.push({ user_id: u, role: "crew" });
    if (to.length > 0)
      await logStep(c, o.id, now, null, "reminded", {
        kind: r.kind,
        minutes: r.minutes,
        to: to.some((p) => p.role === "crew") ? "crew" : "holder",
      });
    for (const p of to) {
      await emitOrder(c, this.deps, "pizza.reminder.triggered", o, {
        kind: r.kind,
        minutes: r.minutes,
        user_id: p.user_id,
        role: p.role,
      });
    }
  }
}

/** Minutes the release waited: from the close or the last claim. */
function minutesSince(o: OrderRow, now: Date): number {
  const since = Math.max(o.closed_at?.getTime() ?? 0, o.claimed_at?.getTime() ?? 0);
  return Math.round((now.getTime() - since) / 60_000);
}

/** The crew as pizza has seen it (pizza_crew), oldest first. */
export async function crewOf(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(`SELECT user_id FROM pizza_crew ORDER BY seen_at, user_id`, []);
  return (rows as { user_id: string }[]).map((r) => r.user_id);
}
