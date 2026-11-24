/**
 * The AI reader's provider key, set in Admin → Integrations (`admin.integrations.write`; the plan,
 * The optional AI reader). Write-only: sealed with the platform's secrets key and bound to its
 * event, so it opens nowhere else; no answer, log line, audit entry or event holds it. Set,
 * replace and revoke are audited. The reader runs only while the event's `ai_reader` is on, the key
 * is set and the provider has not refused it, and the event's daily reads are not used up. Every
 * read is logged with how it ended and what it cost (#789 item 12), and the crew is told when the
 * reader stops on a refused key or an empty account (item 11).
 */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { body, eventArchived, tenantOf, whoIs } from "./http.js";
import type { AppDeps } from "./http.js";
import { NO_FACTS, authorize } from "./policy.js";
import { crewOf } from "./scheduler.js";
import { PROVIDER, costMicroUsd } from "./reader.js";
import type { ReadReason, ReadUsage, Reader } from "./reader.js";
import { eventDay } from "./time.js";
import { InvalidBody } from "./validate.js";

interface KeyRow {
  provider: string;
  sealed: string;
  last4: string;
  set_at: Date;
  set_by_user_id: string | null;
  set_by_name: string | null;
  last_used_at: Date | null;
  rejected_at: Date | null;
}

/** What binds a sealed key to its row: a key copied to another event does not open there. */
const aad = (tenant: string) => `pizza/reader_key/${tenant}`;
const KEY_RE = /^[\x21-\x7e]{8,300}$/;

export const readerOff = () =>
  new KitError("The reader is off here: type the numbers instead.", {
    status: 409,
    code: "reader_off",
  });

async function keyRow(c: SqlClient): Promise<KeyRow | null> {
  const { rows } = await c.query(`SELECT * FROM pizza_reader_keys`, []);
  return (rows[0] as KeyRow | undefined) ?? null;
}

/** The reads since `day`; `billed` leaves out those the provider billed nothing for (D6). */
async function readsSince(c: SqlClient, day: string, billed: boolean): Promise<number> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM pizza_reads WHERE day >= $1${billed ? " AND counted" : ""}`,
    [day],
  );
  return (rows[0] as { n: number }).n;
}

const lockReads = (c: SqlClient) =>
  c.query(
    `SELECT pg_advisory_xact_lock(hashtext(current_setting('canccu.tenant') || ':pizza-reads'))`,
    [],
  );

/** Whether an admin has set a provider key: without one the reader's setting is not shown. */
export async function readerKeySet(deps: AppDeps): Promise<boolean> {
  return (await deps.db.tenant(keyRow)) !== null;
}

/** Whether pages offer the reader at all: on, with a key the provider has not refused. */
export async function readerAvailable(deps: AppDeps, tenant: string): Promise<boolean> {
  if (!(await deps.settings(tenant)).ai_reader) return false;
  const key = await deps.db.tenant(keyRow);
  return key !== null && key.rejected_at === null;
}

/** One reserved read: its row, and the sealed key it will be tried with. */
export interface Taken {
  reader: Reader;
  readId: string;
  sealed: string;
}

/**
 * The event's reader for one read, or why there is none. The read is reserved here, under a lock
 * on the event's reads and committed with the caller's transaction, so concurrent scans cannot
 * together pass the daily cap; `noteRead` records how the call ended. A reservation that is never
 * noted (the process died mid-call) stays counted as failed: the provider may have charged for it.
 */
export async function takeReader(
  c: SqlClient,
  deps: AppDeps,
  tenant: string,
  zone: string,
  now: Date,
  kind: "receipt" | "menu",
  pages = 1,
): Promise<Taken> {
  const settings = await deps.settings(tenant);
  const key = await keyRow(c);
  if (!settings.ai_reader || key === null || key.rejected_at !== null || deps.secrets === null)
    throw readerOff();
  await lockReads(c);
  const day = eventDay(now, zone);
  if ((await readsSince(c, day, true)) >= settings.ai_reader_daily_reads) {
    throw new KitError("Today's reads are used up: type the numbers instead.", {
      status: 429,
      code: "reader_limit",
    });
  }
  const { rows } = await c.query(
    `INSERT INTO pizza_reads (at, day, kind, outcome, pages) VALUES ($1, $2, $3, 'failed', $4)
     RETURNING id::text AS id`,
    [now, day, kind, pages],
  );
  return {
    reader: deps.readerFor(deps.secrets.openText(key.sealed, aad(tenant))),
    readId: (rows[0] as { id: string }).id,
    sealed: key.sealed,
  };
}

export type ReadOutcome = "ok" | "rejected" | ReadReason;

/** Ends the provider billed nothing for: logged, but not counted against the day (D6). */
const NOT_BILLED: ReadonlySet<ReadOutcome> = new Set([
  "rejected",
  "rate_limited",
  "service_down",
  "timeout",
  "out_of_credit",
]);

export interface ReadResult {
  outcome: ReadOutcome;
  /** The model's own words for an unreadable photo. */
  reason: string | null;
  usage: ReadUsage | null;
  ms: number;
}

/**
 * How a reserved read ended, in its log row. A refused key stops the reader only if it is still
 * the key this read used: a key an admin set meanwhile is not marked for the old key's refusal.
 * The crew hears of a refused key once (the read that marked it) and of an empty account once per
 * event day, by `pizza.reader.stopped` stored in this transaction; the caller flushes the outbox.
 */
export async function noteRead(
  c: SqlClient,
  deps: Pick<AppDeps, "outbox">,
  taken: Taken,
  r: ReadResult,
  now: Date,
): Promise<void> {
  // Serialised with the day's other reads, so two empty-account reads at once tell the crew once.
  if (r.outcome === "out_of_credit") await lockReads(c);
  const { rows } = await c.query(
    `UPDATE pizza_reads SET outcome = $2, reason = $3, input_tokens = $4, output_tokens = $5,
       cost_micro_usd = $6, ms = $7, counted = $8
     WHERE id = $1::bigint RETURNING day::text AS day`,
    [
      taken.readId,
      r.outcome,
      r.reason?.slice(0, 200) ?? null,
      r.usage?.input_tokens ?? null,
      r.usage?.output_tokens ?? null,
      r.usage === null ? 0 : costMicroUsd(r.usage),
      Math.max(0, Math.round(r.ms)),
      !NOT_BILLED.has(r.outcome),
    ],
  );
  await c.query(`UPDATE pizza_reader_keys SET last_used_at = $1 WHERE sealed = $2`, [
    now,
    taken.sealed,
  ]);
  let tell = false;
  if (r.outcome === "rejected") {
    const marked = await c.query(
      `UPDATE pizza_reader_keys SET rejected_at = $1 WHERE sealed = $2 AND rejected_at IS NULL
       RETURNING 1`,
      [now, taken.sealed],
    );
    tell = marked.rows.length > 0;
  } else if (r.outcome === "out_of_credit") {
    const day = (rows[0] as { day: string } | undefined)?.day;
    const earlier = await c.query(
      `SELECT 1 FROM pizza_reads WHERE day = $1 AND outcome = 'out_of_credit' AND id <> $2::bigint
       LIMIT 1`,
      [day, taken.readId],
    );
    tell = earlier.rows.length === 0;
  }
  if (tell) {
    await deps.outbox.add(
      c,
      "pizza.reader.stopped",
      {
        reason: r.outcome === "rejected" ? "key_rejected" : "out_of_credit",
        user_ids: await crewOf(c),
      },
      { version: 1 },
    );
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The newest reads the log lists; the month's totals count them all. */
const LOG_ROWS = 500;

interface ReadRow {
  at: Date;
  kind: string;
  pages: number;
  outcome: string;
  reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_micro_usd: number | null;
  ms: number | null;
}

/** The read log of one month (`YYYY-MM`, by event day) and its totals against the set limit. */
export async function readsOf(c: SqlClient, month: string, limitUsd: number) {
  const from = `${month}-01`;
  const range = `day >= $1::date AND day < ($1::date + interval '1 month')`;
  const { rows } = await c.query(
    `SELECT at, kind, pages, outcome, reason, input_tokens, output_tokens, cost_micro_usd, ms
     FROM pizza_reads WHERE ${range} ORDER BY at DESC, id DESC LIMIT ${LOG_ROWS}`,
    [from],
  );
  const totals = await c.query(
    `SELECT count(*)::int AS reads, COALESCE(sum(cost_micro_usd), 0)::bigint::text AS cost
     FROM pizza_reads WHERE ${range}`,
    [from],
  );
  const t = totals.rows[0] as { reads: number; cost: string };
  return {
    month,
    reads: (rows as unknown as ReadRow[]).map((r) => ({
      at: r.at.toISOString(),
      kind: r.kind,
      pages: r.pages,
      outcome: r.outcome,
      reason: r.reason,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cost_micro_usd: r.cost_micro_usd ?? 0,
      ms: r.ms,
    })),
    totals: {
      reads: t.reads,
      cost_micro_usd: Number(t.cost),
      limit_micro_usd: limitUsd > 0 ? Math.round(limitUsd * 1_000_000) : null,
    },
  };
}

async function status(c: SqlClient, zone: string, now: Date) {
  const key = await keyRow(c);
  const month = `${eventDay(now, zone).slice(0, 7)}-01`;
  return {
    provider: PROVIDER.name,
    model: PROVIDER.model,
    set: key !== null,
    last4: key?.last4 ?? null,
    set_by:
      key?.set_by_user_id == null ? null : { user_id: key.set_by_user_id, name: key.set_by_name },
    set_at: key?.set_at.toISOString() ?? null,
    last_used_at: key?.last_used_at?.toISOString() ?? null,
    rejected: key?.rejected_at != null,
    reads_this_month: await readsSince(c, month, false),
  };
}

export function readerKeyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const gate = async (request: Parameters<typeof tenantOf>[0]) => {
    const ctx = tenantOf(request);
    const { session, caller } = await whoIs(deps, request);
    authorize("reader.key", caller, NO_FACTS);
    return { ctx, session: session as NonNullable<typeof session> };
  };

  app.get("/api/pizza/reader/key", async (request) => {
    const { ctx } = await gate(request);
    return deps.db.tenant((c) => status(c, ctx.time_zone, deps.now()));
  });

  app.get<{ Querystring: { month?: string } }>("/api/pizza/reader/reads", async (request) => {
    const { ctx } = await gate(request);
    const month = request.query.month ?? eventDay(deps.now(), ctx.time_zone).slice(0, 7);
    if (!MONTH_RE.test(month)) throw new InvalidBody("month", "a month as YYYY-MM");
    const { ai_reader_monthly_limit_usd: limit } = await deps.settings(ctx.tenant_id);
    return deps.db.tenant((c) => readsOf(c, month, limit));
  });

  app.put("/api/pizza/reader/key", async (request) => {
    const { ctx, session } = await gate(request);
    if (ctx.status === "archived") throw eventArchived();
    const key = body(request).api_key;
    if (typeof key !== "string" || !KEY_RE.test(key.trim()))
      throw new InvalidBody("api_key", "the provider's key, 8 to 300 characters without spaces");
    if (deps.secrets === null) {
      throw new KitError("No secrets key is set on this platform, so no API key can be kept.", {
        status: 503,
        code: "secrets_unavailable",
      });
    }
    const sealed = deps.secrets.seal(key.trim(), aad(ctx.tenant_id));
    const last4 = key.trim().slice(-4);
    const now = deps.now();
    return deps.db.tenant(async (c) => {
      const had = await keyRow(c);
      await c.query(
        `INSERT INTO pizza_reader_keys (provider, sealed, last4, set_at, set_by_user_id, set_by_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id) DO UPDATE SET provider = EXCLUDED.provider, sealed = EXCLUDED.sealed,
           last4 = EXCLUDED.last4, set_at = EXCLUDED.set_at, set_by_user_id = EXCLUDED.set_by_user_id,
           set_by_name = EXCLUDED.set_by_name, last_used_at = NULL, rejected_at = NULL`,
        [PROVIDER.id, sealed, last4, now, session.userId, session.userName],
      );
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: session.userId,
        action: had === null ? "pizza.reader_key.set" : "pizza.reader_key.replaced",
        target: { type: "integration", id: "ai_reader" },
        changes: { last4: { old: had?.last4 ?? null, new: last4 } },
      });
      return status(c, ctx.time_zone, now);
    });
  });

  app.delete("/api/pizza/reader/key", async (request, reply) => {
    const { ctx, session } = await gate(request);
    await deps.db.tenant(async (c) => {
      const had = await keyRow(c);
      if (had === null) return;
      await c.query(`DELETE FROM pizza_reader_keys`, []);
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: session.userId,
        action: "pizza.reader_key.revoked",
        target: { type: "integration", id: "ai_reader" },
        changes: { last4: { old: had.last4, new: null } },
      });
    });
    return reply.status(204).send();
  });
}
