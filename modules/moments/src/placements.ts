/**
 * Where Screen placed Moments' overrides on a zone (`screen.claims.changed`, contracts/screen.md):
 * each becomes the moment's placement there, and each change of it a history row (placed,
 * hidden, queued, or back after a higher moment ended). Events come at least once and to every
 * container, so a report that changes nothing writes nothing.
 */
import type { Event, SqlClient } from "@canccu/kit";
import { passZone } from "./air.js";
import type { PassEngine } from "./air.js";
import { lockZone, pause, resume, saveSlot, slotsOn } from "./air-store.js";
import { titleOf, writeHistory } from "./store.js";
import type { MomentRow } from "./store.js";

export interface ClaimsReport {
  zone_key: string;
  placed: { override_id: string; role: string }[];
  unplaced: string[];
  hidden: string[];
}

/** The report in `data`, or null when it is not one the screen contract describes. */
export function claimsReportOf(data: Record<string, unknown>): ClaimsReport | null {
  const { zone_key: zone, placed, unplaced, hidden } = data;
  const ids = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  if (typeof zone !== "string" || !Array.isArray(placed) || !ids(unplaced) || !ids(hidden)) {
    return null;
  }
  const spots = placed.filter(
    (p): p is { override_id: string; role: string } =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>).override_id === "string" &&
      typeof (p as Record<string, unknown>).role === "string",
  );
  return { zone_key: zone, placed: spots, unplaced, hidden };
}

interface Stored {
  override_id: string;
  state: string;
  role: string | null;
  placed_once: boolean;
}

type Ours = MomentRow & { override_id: string };

/** A stream entry id (`<ms>-<seq>`) as its two numbers, or null; Postgres bigints hold them. */
function entryOf(id: string | undefined): [string, string] | null {
  const m = /^(\d{1,18})-(\d{1,18})$/.exec(id ?? "");
  return m === null ? null : [m[1] as string, m[2] as string];
}

/**
 * Whether the report in event `e` is newer than the last applied on its zone, which it then
 * becomes (under the mark's row lock, so the live and the replay subscriptions apply it once).
 * Reports are ordered by their entry in Screen's stream: ids come from several replicas' clocks
 * (#657). A mark from before the entries (null) is compared by event id, once. An event that was
 * not read from a stream has no place in its order, and applies nothing. The replay (`replayed`)
 * applies only on a zone the live subscription has marked (the mark outlives a replayed zone
 * removal), so a first boot never replays the stream's whole past into the history.
 * A report applies only on a zone Moments knows from Screen's zone events: Screen can report a
 * zone after removing it (a placement settling as it goes, or the replay behind the live
 * subscription), and a report that added its zone kept a removed zone on On air for good (#642).
 */
export async function newerClaims(
  c: SqlClient,
  zone: string,
  e: Pick<Event, "id" | "entry_id">,
  replayed: boolean,
): Promise<boolean> {
  const entry = entryOf(e.entry_id);
  if (entry === null) return false;
  const known = await c.query(`SELECT 1 FROM moments_zones WHERE zone_key = $1`, [zone]);
  if (known.rows.length === 0) return false;
  const older = (mark: string) =>
    `CASE WHEN ${mark}.claims_entry_ms IS NULL THEN ${mark}.claims_event_id < $2
       ELSE (${mark}.claims_entry_ms, ${mark}.claims_entry_seq) < ($3::bigint, $4::bigint) END`;
  const { rows } = await c.query(
    replayed
      ? `UPDATE moments_claims_marks m SET claims_event_id = $2, claims_entry_ms = $3,
           claims_entry_seq = $4
         WHERE zone_key = $1 AND ${older("m")} RETURNING zone_key`
      : `INSERT INTO moments_claims_marks (zone_key, claims_event_id, claims_entry_ms, claims_entry_seq)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, zone_key) DO UPDATE SET claims_event_id = EXCLUDED.claims_event_id,
           claims_entry_ms = EXCLUDED.claims_entry_ms, claims_entry_seq = EXCLUDED.claims_entry_seq
         WHERE ${older("moments_claims_marks")}
         RETURNING zone_key`,
    [zone, e.id, ...entry],
  );
  return rows.length > 0;
}

/**
 * Applies a zone's report: the history, and each held moment's clock (rule 2: it stops while
 * Screen hides it or leaves it unplaced, and runs again once placed), then the zone's pass.
 */
export async function applyClaims(
  c: SqlClient,
  report: ClaimsReport,
  now: Date,
  engine?: PassEngine,
): Promise<void> {
  // The zone first, as the pass and `lockMoment` take it: moments and slots are locked after it,
  // so a pass in between neither loses its write to ours nor deadlocks with it (#777).
  if (engine !== undefined) await lockZone(c, report.zone_key, "wait");
  await placementRows(c, report, now);
  if (engine === undefined) return;
  for (const slot of await slotsOn(c, report.zone_key)) {
    if (
      slot.override_id === null ||
      (slot.granted !== "hero" && slot.granted !== "pass" && slot.granted !== "down")
    )
      continue;
    if (report.hidden.includes(slot.override_id) || report.unplaced.includes(slot.override_id))
      pause(slot, now);
    else if (report.placed.some((p) => p.override_id === slot.override_id)) resume(slot, now);
    else continue;
    await saveSlot(c, slot);
  }
  await passZone(c, engine, report.zone_key, now);
}

async function placementRows(c: SqlClient, report: ClaimsReport, now: Date): Promise<void> {
  const zone = report.zone_key;
  const states = new Map<string, { state: string; role: string | null }>();
  for (const p of report.placed) states.set(p.override_id, { state: "placed", role: p.role });
  // A hidden claim keeps its role (screen.md, Placement); the report names only the id.
  for (const id of report.hidden) states.set(id, { state: "hidden", role: null });
  for (const id of report.unplaced) states.set(id, { state: "unplaced", role: null });
  const { rows: ours } = await c.query(
    `SELECT o.override_id, m.* FROM moment_overrides o
     JOIN moments m ON m.tenant_id = o.tenant_id AND m.id = o.moment_id
     WHERE o.override_id = ANY($1::text[]) AND NOT o.ended AND m.ended_at IS NULL
     ORDER BY m.starts_at, m.id
     FOR UPDATE OF m`,
    [[...states.keys()]],
  );
  const { rows: before } = await c.query(
    `SELECT override_id, state, role, placed_once FROM moment_placements WHERE zone_key = $1`,
    [zone],
  );
  const old = new Map((before as unknown as Stored[]).map((s) => [s.override_id, s]));
  const moments = new Map((ours as unknown as Ours[]).map((m) => [m.override_id, m]));
  for (const [id, now_] of states) {
    const m = moments.get(id);
    if (m === undefined) continue;
    const was = old.get(id);
    const role = now_.state === "hidden" ? (was?.role ?? null) : now_.role;
    if (was !== undefined && was.state === now_.state && was.role === role) continue;
    await c.query(
      `INSERT INTO moment_placements (override_id, zone_key, moment_id, state, role, since,
         placed_once)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, override_id, zone_key) DO UPDATE SET state = EXCLUDED.state,
         role = EXCLUDED.role, since = EXCLUDED.since,
         placed_once = moment_placements.placed_once OR EXCLUDED.placed_once`,
      [id, zone, m.id, now_.state, role, now, now_.state === "placed"],
    );
    const action =
      now_.state === "placed"
        ? was?.placed_once === true && was.state !== "placed"
          ? "back"
          : "placed"
        : now_.state === "hidden"
          ? "hidden"
          : "queued";
    await writeHistory(c, {
      at: now,
      zone_key: zone,
      action,
      moment_id: m.id,
      class: m.class,
      origin: m.origin,
      title: titleOf(m),
      region: role,
      why: m.why,
      displaced: action === "placed" ? displaced(id, role, report, old, moments) : null,
    });
  }
  // Claims Screen no longer lists (it ended them at their time) hold nothing on this zone now.
  const gone = [...old.keys()].filter((id) => !states.has(id));
  if (gone.length > 0) {
    await c.query(
      `DELETE FROM moment_placements WHERE zone_key = $1 AND override_id = ANY($2::text[])`,
      [zone, gone],
    );
  }
}

/** What the newly placed claim took its role from: the claim that held it, or under a takeover, everything. */
function displaced(
  id: string,
  role: string | null,
  report: ClaimsReport,
  old: Map<string, Stored>,
  moments: Map<string, Ours>,
): string | null {
  if (role === "full") return report.hidden.length > 0 ? "everything (hidden)" : null;
  for (const [other, s] of old) {
    if (other === id || s.state !== "placed" || s.role !== role) continue;
    const m = moments.get(other);
    if (m !== undefined) return titleOf(m);
  }
  return null;
}
