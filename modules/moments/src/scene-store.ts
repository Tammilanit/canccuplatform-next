/**
 * Scenes in Postgres (contracts/moments.md, Scenes): the event's list, copied from the presets on
 * first use and never changed by a later platform version (O7); the facts the conditions read,
 * kept from the catalog's events; each zone's scene as last sent; and the pass that sends
 * `moments.scene.changed` for each zone whose scene or heartbeat changed.
 */
import type { Event, Outbox, SqlClient } from "@canccu/kit";
import { CREW_WHY, pickScene, heartbeatOf } from "./scene-eval.js";
import type { AgendaItem, SceneFacts } from "./scene-eval.js";
import { PRESETS, crewMinutes, sceneEvent } from "./scenes.js";
import type { Scene } from "./scenes.js";
import { knownZones, lockSettings } from "./store.js";
import { holdsHandover } from "./story/handover.js";

/** The event's whole agenda as a module reads it (`GET /internal/agenda/items`), or null. */
export type AgendaReader = (
  tenantId: string,
) => Promise<{ agenda_version: number; items: AgendaItem[] } | null>;

export interface SceneList {
  scenes: Scene[];
  revision: number;
  /** False until the event's first use copied the presets. */
  copied: boolean;
}

export async function loadScenes(c: SqlClient): Promise<SceneList> {
  const { rows } = await c.query(`SELECT scenes, revision FROM moments_scenes`, []);
  const row = rows[0] as { scenes: Scene[]; revision: number } | undefined;
  return row === undefined
    ? { scenes: [...PRESETS], revision: 0, copied: false }
    : { scenes: row.scenes, revision: row.revision, copied: true };
}

/** The first use copies the presets as they are in this platform version, at revision 0. */
export async function ensureScenes(c: SqlClient): Promise<SceneList> {
  await c.query(
    `INSERT INTO moments_scenes (scenes, revision) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
    [JSON.stringify(PRESETS)],
  );
  return loadScenes(c);
}

export async function writeScenes(c: SqlClient, scenes: Scene[], revision: number): Promise<void> {
  await c.query(
    `INSERT INTO moments_scenes (scenes, revision) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET scenes = EXCLUDED.scenes, revision = EXCLUDED.revision`,
    [JSON.stringify(scenes), revision],
  );
}

/** A count older than this says nothing about who is online now. */
const PRESENCE_FRESH_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;
type Data = Record<string, unknown>;
const obj = (v: unknown): Data =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Data) : {};

/** Keeps what the conditions read from one event; true when it may change a zone's scene. */
export async function recordFact(c: SqlClient, e: Event): Promise<boolean> {
  const d = e.data;
  if (e.type === "notify.checkin.recorded") {
    const id = d.check_in_id;
    if (d.purpose !== "arrival" || typeof id !== "string") return false;
    // A time that does not parse takes the event's, as a presence count's does (#657).
    const own = Date.parse(typeof d.checked_in_at === "string" ? d.checked_in_at : "");
    const at = new Date(Number.isNaN(own) ? Date.parse(e.time) : own).toISOString();
    await c.query(
      `INSERT INTO moments_checkins (check_in_id, at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, at],
    );
    await c.query(`DELETE FROM moments_checkins WHERE at < $1::timestamptz - interval '2 hours'`, [
      at,
    ]);
    return true;
  }
  if (e.type === "bot.presence.counted" && typeof d.online === "number") {
    // A count whose own time does not parse takes the event's, else it would fail on every delivery.
    const counted = Date.parse(typeof d.counted_at === "string" ? d.counted_at : "");
    const at = Number.isNaN(counted) ? Date.parse(e.time) : counted;
    await c.query(
      `INSERT INTO moments_sources (kind, ref, data, revision) VALUES ('presence', '', $1, $2)
       ON CONFLICT (tenant_id, kind, ref) DO UPDATE SET data = EXCLUDED.data, revision = EXCLUDED.revision
       WHERE moments_sources.revision <= EXCLUDED.revision`,
      [{ online: d.online, counted_at: new Date(at).toISOString() }, at],
    );
    return true;
  }
  const game = obj(d.game).id;
  if (e.type === "games.surge.started" && typeof game === "string") {
    await c.query(
      `INSERT INTO moments_sources (kind, ref, data, revision) VALUES ('surge', $1, '{}', 0)
       ON CONFLICT DO NOTHING`,
      [game],
    );
    return true;
  }
  if (e.type === "games.surge.ended" && typeof game === "string") {
    await c.query(`DELETE FROM moments_sources WHERE kind = 'surge' AND ref = $1`, [game]);
    return true;
  }
  return false;
}

/** Keeps the agenda read for `agenda_version`, unless a newer one is kept already. */
export async function storeAgenda(
  c: SqlClient,
  agenda: { agenda_version: number; items: AgendaItem[] },
): Promise<void> {
  await c.query(
    `INSERT INTO moments_sources (kind, ref, data, revision) VALUES ('agenda', '', $1, $2)
     ON CONFLICT (tenant_id, kind, ref) DO UPDATE SET data = EXCLUDED.data, revision = EXCLUDED.revision
     WHERE moments_sources.revision <= EXCLUDED.revision`,
    [JSON.stringify({ items: agenda.items }), agenda.agenda_version],
  );
}

export async function agendaItems(c: SqlClient): Promise<AgendaItem[]> {
  const { rows } = await c.query(
    `SELECT data FROM moments_sources WHERE kind = 'agenda' AND ref = ''`,
    [],
  );
  const items = obj(rows[0]?.data).items;
  return Array.isArray(items) ? (items as AgendaItem[]) : [];
}

export interface Crew {
  scene_key: string;
  zones: string[];
  until: Date;
  actor_user_id: string | null;
}

export async function loadCrew(c: SqlClient): Promise<Crew | null> {
  const { rows } = await c.query(
    `SELECT scene_key, zones, until, actor_user_id FROM moments_scene_crew`,
    [],
  );
  return (rows[0] as Crew | undefined) ?? null;
}

async function factsOf(c: SqlClient, timeZone: string, now: Date): Promise<SceneFacts> {
  const counted = await c.query(
    `SELECT count(*)::int AS n FROM moments_checkins WHERE at > $1 AND at <= $2`,
    [new Date(now.getTime() - HOUR_MS), now],
  );
  const live = await c.query(
    `SELECT kind, data FROM moments_sources WHERE kind IN ('presence', 'surge')`,
    [],
  );
  const presence = obj(live.rows.find((r) => r.kind === "presence")?.data);
  const countedAt = Date.parse(String(presence.counted_at));
  const crew = await loadCrew(c);
  return {
    now: now.getTime(),
    timeZone,
    items: await agendaItems(c),
    checkinsLastHour: (counted.rows[0] as { n: number }).n,
    online:
      typeof presence.online === "number" && now.getTime() - countedAt <= PRESENCE_FRESH_MS
        ? presence.online
        : null,
    surging: live.rows.some((r) => r.kind === "surge"),
    crew:
      crew === null
        ? null
        : { scene: crew.scene_key, until: crew.until.getTime(), zones: crew.zones },
  };
}

/** JSON with its keys sorted: jsonb keeps no key order, so a plain string would always differ. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === "object" && x !== null && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

/**
 * Decides every zone's scene now and sends `moments.scene.changed` (in the outbox, in this
 * transaction) for each zone whose scene or heartbeat changed. Serialised per event, so two
 * containers never send one change twice.
 */
export async function evaluateScenes(
  c: SqlClient,
  outbox: Pick<Outbox, "add">,
  o: { timeZone: string; now: Date; actor?: string | null },
): Promise<void> {
  await lockSettings(c, "scene-zones");
  const { scenes } = await ensureScenes(c);
  const facts = await factsOf(c, o.timeZone, o.now);
  const { rows } = await c.query(
    `SELECT zone_key, scene_key, since, why, sent FROM moments_scene_zones`,
    [],
  );
  type State = {
    zone_key: string;
    scene_key: string | null;
    since: Date;
    why: string;
    sent: unknown;
  };
  const states = new Map((rows as State[]).map((r) => [r.zone_key, r]));
  for (const zone of await knownZones(c)) {
    const st = states.get(zone);
    const current =
      st?.scene_key == null
        ? null
        : { key: st.scene_key, since: st.since.getTime(), crew: st.why === CREW_WHY };
    const picked = pickScene(scenes, facts, zone, current);
    const key = picked?.scene.key ?? null;
    const scene = sceneEvent(picked?.scene ?? null, zone);
    const sent = {
      scene,
      heartbeat_bpm: heartbeatOf(picked?.scene.then.stage_mood ?? null, facts),
    };
    if (st !== undefined && st.scene_key === key && canonical(st.sent) === canonical(sent))
      continue;
    // A story's round live on the zone plays first (SD9); the scene follows within the hand-over.
    if (st !== undefined && st.scene_key !== key && (await holdsHandover(c, zone, o.now))) continue;
    const since = st !== undefined && st.scene_key === key ? st.since : o.now;
    const why = picked?.why ?? "no scene holds";
    await c.query(
      `INSERT INTO moments_scene_zones (zone_key, scene_key, since, why, sent) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, zone_key) DO UPDATE SET scene_key = EXCLUDED.scene_key,
         since = EXCLUDED.since, why = EXCLUDED.why, sent = EXCLUDED.sent`,
      [zone, key, since, why, JSON.stringify(sent)],
    );
    await outbox.add(
      c,
      "moments.scene.changed",
      {
        zone_key: zone,
        scene,
        since: since.toISOString(),
        why,
        heartbeat_bpm: sent.heartbeat_bpm,
        actor_user_id: o.actor ?? null,
      },
      { version: 1 },
    );
  }
}

/**
 * The crew button (E7): a press puts `scene` on for its minutes on `zones` (empty: every zone);
 * pressing the scene that is on takes it off. Answers what is pressed now, or null.
 */
export async function pressCrew(
  c: SqlClient,
  scene: Scene,
  zones: string[],
  actor: string,
  now: Date,
): Promise<{ crew: Crew | null; before: Crew | null }> {
  await lockSettings(c, "scene-zones");
  const before = await loadCrew(c);
  if (before !== null && before.scene_key === scene.key && before.until > now) {
    await c.query(`DELETE FROM moments_scene_crew`, []);
    return { crew: null, before };
  }
  const until = new Date(now.getTime() + (crewMinutes(scene) ?? 0) * 60_000);
  await c.query(
    `INSERT INTO moments_scene_crew (scene_key, zones, until, actor_user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET scene_key = EXCLUDED.scene_key, zones = EXCLUDED.zones,
       until = EXCLUDED.until, actor_user_id = EXCLUDED.actor_user_id`,
    [scene.key, zones, until, actor],
  );
  return { crew: { scene_key: scene.key, zones, until, actor_user_id: actor }, before };
}

/** Each zone's scene now, for the API and the pages. */
export async function sceneZones(c: SqlClient): Promise<Data[]> {
  const { rows } = await c.query(
    `SELECT zone_key, scene_key, since, why, sent FROM moments_scene_zones ORDER BY zone_key`,
    [],
  );
  return rows.map((r) => ({
    zone_key: r.zone_key,
    scene_key: r.scene_key,
    since: (r.since as Date).toISOString(),
    why: r.why,
    heartbeat_bpm: obj(r.sent).heartbeat_bpm,
  }));
}

export const crewView = (crew: Crew | null): Data | null =>
  crew === null
    ? null
    : { scene_key: crew.scene_key, zones: crew.zones, until: crew.until.toISOString() };
