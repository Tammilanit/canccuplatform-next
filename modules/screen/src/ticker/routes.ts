/**
 * `/api/screen/ticker` and its windows (contracts/screen.md, Ticker): a person's line with an
 * optional end, and weekly windows that set the text in advance. Every change of what the ticker
 * shows is announced once as `screen.ticker.changed`, here or by the tick (`tickTicker`).
 * The line (set and clear) and window adds and deletes are audited, in the transaction that makes them.
 */
import type { FastifyInstance } from "fastify";
import type { Bus, RightsChecker, SqlClient, TenantContext } from "@canccu/kit";
import type { Audit } from "../audit.js";
import { weeklyInput } from "../content/input.js";
import type { Db } from "../db.js";
import type { Settings } from "../health.js";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  needsAny,
  newId,
  notFound,
  tenantOf,
} from "../http.js";
import { onlyKeys } from "../zone-input.js";
import { publishAll } from "../zones.js";
import type { Emit } from "../zones.js";
import type { TickerNow } from "./resolve.js";
import { announce, listWindows, lockTicker, tickerNow } from "./store.js";

const TEXT_MAX = 280;
const APPEARANCES = ["default", "high_contrast", "minimal", "broadcast"];

export interface TickerDeps {
  db: Db;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  settings: Settings;
  now?: () => number;
}

function tickerText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > TEXT_MAX) {
    throw invalidRequest("`text` must be 1 to 280 characters.");
  }
  return value.trim();
}

function tickerUntil(value: unknown, nowMs: number): Date | null {
  if (value === null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(ms))
    throw invalidRequest("`until` must be a date and time, or null for no end.");
  if (ms <= nowMs) throw invalidRequest("`until` must be in the future.");
  return new Date(ms);
}

/** The person's line as it stands, for the audit's `from`; read under the ticker's lock. */
async function lineNow(c: SqlClient): Promise<{ text: string | null; until: string | null }> {
  const { rows } = await c.query("SELECT text, until FROM screen_ticker");
  const row = rows[0] as { text: string | null; until: Date | null } | undefined;
  return { text: row?.text ?? null, until: row?.until?.toISOString() ?? null };
}

/**
 * Runs `write` with the ticker locked, then announces any change it made, after commit. The
 * contract's `Ticker` is answered with the event's appearance setting.
 */
async function changeTicker(
  deps: TickerDeps,
  ctx: TenantContext,
  actor: string | null,
  write: (c: SqlClient) => Promise<unknown>,
): Promise<TickerNow> {
  const nowMs = (deps.now ?? Date.now)();
  const { ticker, emits } = await deps.db.tenant(async (c) => {
    await lockTicker(c);
    await write(c);
    return announce(c, ctx.time_zone, nowMs, actor);
  });
  await publishAll(deps.bus, emits);
  return ticker;
}

async function withAppearance(settings: Settings, ticker: TickerNow) {
  await settings.ensure();
  const value = settings.get("ticker_appearance", "default");
  return {
    ...ticker,
    appearance: typeof value === "string" && APPEARANCES.includes(value) ? value : "default",
  };
}

/** The tick's part: announces a window starting or ending, or a line running out. */
export async function tickTicker(c: SqlClient, timeZone: string, nowMs: number): Promise<Emit[]> {
  await lockTicker(c);
  return (await announce(c, timeZone, nowMs, null)).emits;
}

export function tickerRoutes(app: FastifyInstance, deps: TickerDeps): void {
  const now = deps.now ?? Date.now;
  const write = { preHandler: needs(deps.rights, "screen.ticker.write") };
  const read = {
    preHandler: needsAny(deps.rights, ["screen.ticker.write", "screen.content.read"]),
  };

  app.get("/api/screen/ticker", read, async (request) => {
    const ctx = tenantOf(request);
    const ticker = await deps.db.tenant((c) => tickerNow(c, ctx.time_zone, now()));
    return withAppearance(deps.settings, ticker);
  });

  app.put("/api/screen/ticker", write, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const input = body(request);
    onlyKeys(input, ["text", "until"], "ticker");
    if (!("until" in input))
      throw invalidRequest("`until` is required: a time, or null for no end.");
    const text = tickerText(input.text);
    const until = tickerUntil(input.until, now());
    // The bot (step 6) will set `source: bot`; a person's request today is always admin's.
    const actor = actorOf(request);
    const ticker = await changeTicker(deps, ctx, actor, async (c) => {
      const before = await lineNow(c);
      await c.query("UPDATE screen_ticker SET text = $1, until = $2, source = 'admin'", [
        text,
        until,
      ]);
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.ticker.set",
        target: { type: "ticker", id: "line" },
        changes: {
          text: { from: before.text, to: text },
          until: { from: before.until, to: until?.toISOString() ?? null },
        },
      });
    });
    return withAppearance(deps.settings, ticker);
  });

  app.delete("/api/screen/ticker", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const actor = actorOf(request);
    await changeTicker(deps, ctx, actor, async (c) => {
      const before = await lineNow(c);
      await c.query("UPDATE screen_ticker SET text = NULL, until = NULL, source = NULL");
      // Clearing an empty line changes nothing, so there is nothing to record.
      if (before.text === null) return;
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.ticker.cleared",
        target: { type: "ticker", id: "line" },
        changes: { text: { from: before.text, to: null } },
      });
    });
    return reply.status(204).send();
  });

  app.get("/api/screen/ticker/windows", write, async () => ({
    windows: await deps.db.tenant(listWindows),
  }));

  app.post("/api/screen/ticker/windows", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const input = body(request);
    // `id` is the contract's read-only field; one sent back is ignored.
    onlyKeys(input, ["id", "text", "days", "start_minute", "end_minute"], "ticker window");
    const window = { id: newId("tw"), text: tickerText(input.text), ...weeklyInput(input) };
    await changeTicker(deps, ctx, actorOf(request), async (c) => {
      await c.query(
        `INSERT INTO screen_ticker_windows (id, text, days, start_minute, end_minute)
         VALUES ($1, $2, $3, $4, $5)`,
        [window.id, window.text, window.days, window.start_minute, window.end_minute],
      );
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.ticker_window.added",
        target: { type: "ticker_window", id: window.id },
        changes: { text: { from: null, to: window.text } },
      });
    });
    return reply.status(201).send(window);
  });

  app.delete<{ Params: { window_id: string } }>(
    "/api/screen/ticker/windows/:window_id",
    write,
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const id = request.params.window_id;
      await changeTicker(deps, ctx, actorOf(request), async (c) => {
        const { rows } = await c.query(
          "DELETE FROM screen_ticker_windows WHERE id = $1 RETURNING text",
          [id],
        );
        if (rows.length === 0) throw notFound();
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actorOf(request),
          action: "screen.ticker_window.deleted",
          target: { type: "ticker_window", id },
          changes: { text: { from: rows[0]?.text, to: null } },
        });
      });
      return reply.status(204).send();
    },
  );
}
