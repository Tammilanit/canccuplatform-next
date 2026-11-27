/** The history (D21, mockup 09): rows by zone, region, origin and action, newest first, and as CSV. */
import type { SqlClient } from "@canccu/kit";
import { invalid } from "./content.js";

export interface HistoryFilter {
  zone?: string;
  region?: string;
  origin?: string;
  action?: string;
  /** The rows a person acted on (their privacy export). */
  actor?: string;
}

export interface HistoryRow {
  seq: number;
  at: string;
  zone_key: string | null;
  action: string;
  moment_id: string | null;
  class: string;
  origin: string;
  title: string;
  region: string | null;
  why: string;
  displaced: string | null;
  outcome: string | null;
  actor_name: string | null;
}

const ORIGINS = ["rule", "crew", "emergency", "module"];
const ACTIONS = [
  "started",
  "refused",
  "placed",
  "hidden",
  "queued",
  "back",
  "stepped_down",
  "changed",
  "ended",
];
const ROLES = ["full", "hero", "rail", "venue_rail", "ticker", "overlay"];

/** The filters of a query string; an unknown value is refused, never ignored. */
export function filterOf(q: Record<string, unknown>): HistoryFilter {
  const f: HistoryFilter = {};
  const pick = (name: keyof HistoryFilter, ok: (v: string) => boolean) => {
    const v = q[name];
    if (v === undefined || v === "") return;
    if (typeof v !== "string" || !ok(v)) throw invalid(`\`${name}\` is not one the history knows.`);
    f[name] = v;
  };
  pick("zone", (v) => /^[a-z0-9_-]{2,32}$/.test(v));
  pick("region", (v) => ROLES.includes(v));
  pick("origin", (v) => ORIGINS.includes(v));
  pick("action", (v) => ACTIONS.includes(v));
  return f;
}

export async function historyRows(
  c: SqlClient,
  f: HistoryFilter,
  limit: number,
  before?: number,
): Promise<HistoryRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replace("?", `$${values.length}`));
  };
  // A zone's rows are its own and the whole-moment ones (started, refused, ended everywhere).
  if (f.zone !== undefined) add("(zone_key = ? OR zone_key IS NULL)", f.zone);
  if (f.region !== undefined) add("region = ?", f.region);
  if (f.origin !== undefined) add("origin = ?", f.origin);
  if (f.action !== undefined) add("action = ?", f.action);
  if (f.actor !== undefined) add("actor_user_id = ?", f.actor);
  if (before !== undefined) add("seq < ?", before);
  values.push(limit);
  const { rows } = await c.query(
    `SELECT seq, at, zone_key, action, moment_id, class, origin, title, region, why, displaced,
       outcome, actor_name
     FROM moments_history ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY seq DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map((r) => ({
    ...(r as unknown as HistoryRow),
    seq: Number(r.seq),
    at: (r.at as Date).toISOString(),
  }));
}

const CSV_COLUMNS = [
  "at",
  "zone",
  "action",
  "moment",
  "class",
  "region",
  "why",
  "displaced",
  "outcome",
];

/**
 * RFC 4180, with a leading quote on text a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@`): titles and reasons come from people and catalog events.
 */
function cell(v: string | null): string {
  const s = v ?? "";
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function historyCsv(rows: HistoryRow[]): string {
  const lines = rows.map((r) =>
    [r.at, r.zone_key, r.action, r.title, r.class, r.region, r.why, r.displaced, r.outcome]
      .map(cell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}
