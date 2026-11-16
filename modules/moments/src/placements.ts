/**
 * Where Screen placed Moments' overrides on a zone (`screen.claims.changed`, contracts/screen.md):
 * each becomes the moment's placement there, and each change of it a history row (placed,
 * hidden, queued, or back after a higher moment ended). Events come at least once and to every
 * container, so a report that changes nothing writes nothing.
 */
import type { SqlClient } from "@canccu/kit";
import { addZone, titleOf, writeHistory } from "./store.js";
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

export async function applyClaims(c: SqlClient, report: ClaimsReport, now: Date): Promise<void> {
  const zone = report.zone_key;
  await addZone(c, zone);
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
