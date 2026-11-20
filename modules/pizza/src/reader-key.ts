/**
 * The AI reader's provider key, set in Admin → Integrations (`admin.integrations.write`; the plan,
 * The optional AI reader). Write-only: sealed with the platform's secrets key and bound to its
 * event, so it opens nowhere else; no answer, log line, audit entry or event holds it. Set,
 * replace and revoke are audited. The reader runs only while the event's `ai_reader` is on, the key
 * is set and the provider has not refused it, and the event's daily reads are not used up.
 */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { body, eventArchived, tenantOf, whoIs } from "./http.js";
import type { AppDeps } from "./http.js";
import { NO_FACTS, authorize } from "./policy.js";
import { PROVIDER } from "./reader.js";
import type { Reader } from "./reader.js";
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
const aad = (tenant: string) => `pizza:reader_key:${tenant}`;
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

async function readsSince(c: SqlClient, column: "day" | "at", since: string | Date): Promise<number> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM pizza_reads WHERE ${column} >= $1`,
    [since],
  );
  return (rows[0] as { n: number }).n;
}

/** Whether pages offer the reader at all: on, with a key the provider has not refused. */
export async function readerAvailable(deps: AppDeps, tenant: string): Promise<boolean> {
  if (!(await deps.settings(tenant)).ai_reader) return false;
  const key = await deps.db.tenant(keyRow);
  return key !== null && key.rejected_at === null;
}

/** The event's reader for one read, or why there is none; the read counts once it is tried. */
export async function takeReader(
  c: SqlClient,
  deps: AppDeps,
  tenant: string,
  zone: string,
  now: Date,
): Promise<Reader> {
  const settings = await deps.settings(tenant);
  const key = await keyRow(c);
  if (!settings.ai_reader || key === null || key.rejected_at !== null || deps.secrets === null)
    throw readerOff();
  if ((await readsSince(c, "day", eventDay(now, zone))) >= settings.ai_reader_daily_reads) {
    throw new KitError("Today's reads are used up: type the numbers instead.", {
      status: 429,
      code: "reader_limit",
    });
  }
  return deps.readerFor(deps.secrets.openText(key.sealed, aad(tenant)));
}

/** One call to the provider, in its own transaction so a failed read still counts. */
export async function noteRead(
  c: SqlClient,
  kind: "receipt" | "menu",
  outcome: "ok" | "failed" | "rejected",
  zone: string,
  now: Date,
): Promise<void> {
  await c.query(`INSERT INTO pizza_reads (at, day, kind, outcome) VALUES ($1, $2, $3, $4)`, [
    now,
    eventDay(now, zone),
    kind,
    outcome,
  ]);
  await c.query(
    `UPDATE pizza_reader_keys SET last_used_at = $1,
       rejected_at = CASE WHEN $2 THEN $1 ELSE rejected_at END`,
    [now, outcome === "rejected"],
  );
}

async function status(c: SqlClient, zone: string, now: Date) {
  const key = await keyRow(c);
  const month = `${eventDay(now, zone).slice(0, 7)}-01`;
  return {
    provider: PROVIDER.name,
    model: PROVIDER.model,
    set: key !== null,
    last4: key?.last4 ?? null,
    set_by: key?.set_by_user_id == null ? null : { user_id: key.set_by_user_id, name: key.set_by_name },
    set_at: key?.set_at.toISOString() ?? null,
    last_used_at: key?.last_used_at?.toISOString() ?? null,
    rejected: key?.rejected_at != null,
    reads_this_month: await readsSince(c, "day", month),
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
