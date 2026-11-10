/**
 * The ticker's rows (contracts/screen.md, Ticker) and the one place that announces it. Kept in
 * Postgres, so a line and the windows survive restarts (0018), where the legacy kept the bot's
 * windows in memory.
 */
import type { SqlClient } from "@canccu/kit";
import type { Emit } from "../zones.js";
import { resolveTicker } from "./resolve.js";
import type { ManualTicker, TickerNow, TickerWindowTimes } from "./resolve.js";

export interface TickerWindowView {
  id: string;
  text: string;
  days: number[];
  start_minute: number;
  end_minute: number;
}

export async function listWindows(c: SqlClient): Promise<TickerWindowView[]> {
  const { rows } = await c.query(
    `SELECT id, text, days, start_minute, end_minute FROM screen_ticker_windows
     ORDER BY created_at, id`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    text: r.text as string,
    days: r.days as number[],
    start_minute: r.start_minute as number,
    end_minute: r.end_minute as number,
  }));
}

async function readManual(c: SqlClient, forUpdate: boolean): Promise<ManualTicker | null> {
  const { rows } = await c.query(
    `SELECT text, until, source FROM screen_ticker${forUpdate ? " FOR UPDATE" : ""}`,
  );
  const row = rows[0] as { text: string | null; until: Date | null; source: string } | undefined;
  if (row?.text == null) return null;
  return { text: row.text, until: row.until, source: row.source as ManualTicker["source"] };
}

/** What the ticker shows at `nowMs`; reads only. */
export async function tickerNow(c: SqlClient, timeZone: string, nowMs: number): Promise<TickerNow> {
  const manual = await readManual(c, false);
  const windows = (await listWindows(c)).map((w): TickerWindowTimes => ({
    id: w.id,
    text: w.text,
    days: w.days,
    startMinute: w.start_minute,
    endMinute: w.end_minute,
  }));
  return resolveTicker(manual, windows, timeZone, new Date(nowMs));
}

/**
 * Locks the event's ticker row, made on first use: every writer of the line or the windows and
 * the tick take it before `announce`, so two of them never announce the same change twice.
 */
export async function lockTicker(c: SqlClient): Promise<void> {
  await c.query("INSERT INTO screen_ticker DEFAULT VALUES ON CONFLICT DO NOTHING");
  await readManual(c, true);
}

/**
 * After a write (or a tick) under `lockTicker`: when the ticker now differs from the one last
 * announced, keeps it and returns `screen.ticker.changed` to publish after commit.
 */
export async function announce(
  c: SqlClient,
  timeZone: string,
  nowMs: number,
  actor: string | null,
): Promise<{ ticker: TickerNow; emits: Emit[] }> {
  const ticker = await tickerNow(c, timeZone, nowMs);
  const { rows } = await c.query("SELECT announced FROM screen_ticker");
  const last = (rows[0]?.announced as TickerNow | null | undefined) ?? null;
  // A first announcement of an empty ticker would tell no one anything new.
  const unchanged =
    last === null
      ? ticker.text === null
      : last.text === ticker.text && last.until === ticker.until && last.source === ticker.source;
  if (unchanged) return { ticker, emits: [] };
  await c.query("UPDATE screen_ticker SET announced = $1", [JSON.stringify(ticker)]);
  return { ticker, emits: [["screen.ticker.changed", { ...ticker, actor_user_id: actor }]] };
}
