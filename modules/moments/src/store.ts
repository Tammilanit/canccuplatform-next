/** The engine's rows and their SQL; every function runs inside the caller's tenant transaction. */
import type { SqlClient } from "@canccu/kit";
import { DEFAULT_ORDERS, isClass } from "./arbiter.js";
import type { Class, Held, Orders, SentOverride } from "./arbiter.js";
import type { Picture } from "./cues/service.js";

export type Origin = "rule" | "crew" | "emergency" | "module";
export type Kind = "takeover" | "block" | "overlay";
export interface Actor {
  user_id: string;
  name: string;
}
export interface Source {
  module: string;
  event_id: string | null;
  ref: string | null;
}
export interface Qr {
  path: string;
  label: string;
}
export interface Binding {
  source: "none" | "leaderboard" | "session";
  ref?: string | null;
}

export interface MomentRow {
  id: string;
  class: Class;
  kind: Kind;
  regions: string[];
  template: string;
  content: Record<string, unknown>;
  zones: string[];
  left_zones: string[];
  origin: Origin;
  rule_id: string | null;
  source: Source;
  why: string;
  actor_user_id: string | null;
  actor_name: string | null;
  dedupe_key: string | null;
  starts_at: Date;
  expires_at: Date | null;
  ttl_seconds: number | null;
  patience_seconds: number;
  qr: Qr | null;
  binding: Binding | null;
  /** The picture its cue picked (contracts/moments.md, Cues and sound), or null. */
  effect: Picture | null;
  ended_at: Date | null;
  end_reason: string | null;
}

const COLUMNS = `id, class, kind, regions, template, content, zones, left_zones, origin, rule_id,
  source, why, actor_user_id, actor_name, dedupe_key, starts_at, expires_at, ttl_seconds,
  patience_seconds, qr, binding, ended_at, end_reason, effect`;

const momentOf = (r: Record<string, unknown>): MomentRow => r as unknown as MomentRow;

export async function lockMoment(c: SqlClient, id: string): Promise<MomentRow | null> {
  const { rows } = await c.query(`SELECT ${COLUMNS} FROM moments WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] ? momentOf(rows[0]) : null;
}

export async function lockRunningByKey(c: SqlClient, key: string): Promise<MomentRow | null> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments WHERE dedupe_key = $1 AND ended_at IS NULL FOR UPDATE`,
    [key],
  );
  return rows[0] ? momentOf(rows[0]) : null;
}

/**
 * Running moments, highest rank first is the caller's. `lock` "skip" leaves rows another
 * transaction holds (only the expiry pass may: it retries next tick); "wait" blocks for them,
 * for changes that must reach every moment (end, re-rank, archive). Both take rows in
 * `starts_at, id` order, which `applyClaims` follows too, so the waits cannot deadlock.
 */
export async function runningMoments(
  c: SqlClient,
  where = "TRUE",
  values: unknown[] = [],
  lock: false | "skip" | "wait" = false,
): Promise<MomentRow[]> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments WHERE ended_at IS NULL AND (${where})
     ORDER BY starts_at, id${lock === "skip" ? " FOR UPDATE SKIP LOCKED" : lock === "wait" ? " FOR UPDATE" : ""}`,
    values,
  );
  return rows.map(momentOf);
}

export async function insertMoment(c: SqlClient, m: MomentRow): Promise<void> {
  await c.query(
    `INSERT INTO moments (${COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24)`,
    [
      m.id,
      m.class,
      m.kind,
      m.regions,
      m.template,
      m.content,
      m.zones,
      m.left_zones,
      m.origin,
      m.rule_id,
      m.source,
      m.why,
      m.actor_user_id,
      m.actor_name,
      m.dedupe_key,
      m.starts_at,
      m.expires_at,
      m.ttl_seconds,
      m.patience_seconds,
      m.qr,
      m.binding,
      m.ended_at,
      m.end_reason,
      m.effect,
    ],
  );
}

/** Writes the fields a moment may change after its start. */
export async function saveMoment(c: SqlClient, m: MomentRow): Promise<void> {
  await c.query(
    `UPDATE moments SET template = $2, content = $3, left_zones = $4, expires_at = $5,
       ended_at = $6, end_reason = $7 WHERE id = $1`,
    [m.id, m.template, m.content, m.left_zones, m.expires_at, m.ended_at, m.end_reason],
  );
}

export interface StoredOverride {
  override_id: string;
  sent: SentOverride;
}

export async function liveOverrides(c: SqlClient, momentId: string): Promise<StoredOverride[]> {
  const { rows } = await c.query(
    `SELECT override_id, sent FROM moment_overrides WHERE moment_id = $1 AND NOT ended
     ORDER BY override_id`,
    [momentId],
  );
  return rows as unknown as StoredOverride[];
}

export async function putOverride(
  c: SqlClient,
  momentId: string,
  sent: SentOverride,
): Promise<void> {
  await c.query(
    `INSERT INTO moment_overrides (override_id, moment_id, sent) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, override_id) DO UPDATE SET sent = EXCLUDED.sent, ended = false`,
    [sent.id, momentId, sent],
  );
}

export async function endOverride(c: SqlClient, overrideId: string): Promise<void> {
  await c.query(`UPDATE moment_overrides SET ended = true WHERE override_id = $1`, [overrideId]);
  await c.query(`DELETE FROM moment_placements WHERE override_id = $1`, [overrideId]);
}

export async function dropPlacements(
  c: SqlClient,
  overrideId: string,
  zones: string[],
): Promise<void> {
  await c.query(
    `DELETE FROM moment_placements WHERE override_id = $1 AND zone_key = ANY($2::text[])`,
    [overrideId, zones],
  );
}

/** The event's zones, `main` first: every event starts with it (contracts/screen.md, Zones). */
/** The zones already split off into overrides of their own (`<id>.<zone>`). */
export async function splitZones(c: SqlClient, momentId: string): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT override_id FROM moment_overrides WHERE moment_id = $1 AND override_id <> $1`,
    [momentId],
  );
  return rows.map((r) => (r.override_id as string).slice(momentId.length + 1));
}

export async function knownZones(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT zone_key FROM moments_zones ORDER BY zone_key <> 'main', zone_key`,
    [],
  );
  return rows.map((r) => r.zone_key as string);
}

export async function addZone(c: SqlClient, zone: string): Promise<void> {
  await c.query(`INSERT INTO moments_zones (zone_key) VALUES ($1) ON CONFLICT DO NOTHING`, [zone]);
}

/**
 * Serialises the event's saves of one settings document until the transaction ends. A row lock
 * would not do: before the first save there is no row to lock, and two saves of revision 0 would
 * both pass their revision check.
 */
export async function lockSettings(c: SqlClient, name: string): Promise<void> {
  await c.query(
    `SELECT pg_advisory_xact_lock(hashtext('moments:' || current_setting('canccu.tenant') || ':' || $1))`,
    [name],
  );
}

export async function loadOrders(c: SqlClient): Promise<Orders & { revision: number }> {
  const { rows } = await c.query(
    `SELECT event_order, zone_orders, revision FROM moments_priorities`,
    [],
  );
  const row = rows[0];
  if (row === undefined) return { ...DEFAULT_ORDERS, revision: 0 };
  const order = (row.event_order as unknown[]).filter(isClass);
  return {
    order,
    zones: row.zone_orders as Record<string, Class[]>,
    revision: row.revision as number,
  };
}

/** The claims on `zones` as Screen last placed them, with the rank each was sent with. */
export async function heldOn(c: SqlClient, zones: string[]): Promise<(Held & { zone: string })[]> {
  const { rows } = await c.query(
    `SELECT p.zone_key AS zone, p.override_id, p.role, p.state, (o.sent->>'rank')::int AS rank
     FROM moment_placements p
     JOIN moment_overrides o ON o.tenant_id = p.tenant_id AND o.override_id = p.override_id
     WHERE p.zone_key = ANY($1::text[]) AND NOT o.ended`,
    [zones],
  );
  return rows as unknown as (Held & { zone: string })[];
}

export interface HistoryEntry {
  at: Date;
  zone_key: string | null;
  action: "started" | "refused" | "placed" | "hidden" | "queued" | "back" | "changed" | "ended";
  moment_id: string | null;
  class: Class;
  origin: Origin;
  title: string;
  region?: string | null;
  why: string;
  displaced?: string | null;
  outcome?: string | null;
  actor?: Actor | null;
}

export async function writeHistory(c: SqlClient, e: HistoryEntry): Promise<void> {
  await c.query(
    `INSERT INTO moments_history (at, zone_key, action, moment_id, class, origin, title, region,
       why, displaced, outcome, actor_user_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      e.at,
      e.zone_key,
      e.action,
      e.moment_id,
      e.class,
      e.origin,
      e.title,
      e.region ?? null,
      e.why,
      e.displaced ?? null,
      e.outcome ?? null,
      e.actor?.user_id ?? null,
      e.actor?.name ?? null,
    ],
  );
}

/** What people read a moment as: its content's own title, else its template. */
export function titleOf(m: Pick<MomentRow, "content" | "template">): string {
  const c = m.content;
  const game = c.game as { name?: unknown } | undefined;
  for (const v of [c.title, c.label, game?.name, c.pizzeria_name, c.caption, c.text]) {
    if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, 120);
  }
  return m.template;
}
