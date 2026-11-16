/** The cues' rows (migrations/002_cues.sql), read and written in the caller's tenant transaction. */
import type { SqlClient } from "@canccu/kit";
import { BUILTIN_CUES, DEFAULT_SOUND_SETTINGS, PACK } from "./catalog.js";
import type { Cue, SoundSettings } from "./catalog.js";
import { EMPTY_ZONE } from "./decide.js";
import type { ZoneSound } from "./decide.js";

export const PACK_PATH = "/api/moments/sounds/pack/";

export async function loadSettings(c: SqlClient): Promise<SoundSettings & { revision: number }> {
  const { rows } = await c.query(`SELECT settings, revision FROM moments_sound_settings`, []);
  const row = rows[0] as { settings: Partial<SoundSettings>; revision: number } | undefined;
  return { ...DEFAULT_SOUND_SETTINGS, ...(row?.settings ?? {}), revision: row?.revision ?? 0 };
}

/** Saves when `revision` is the stored one; false on a stale one. */
export async function saveSettings(
  c: SqlClient,
  s: SoundSettings,
  revision: number,
): Promise<boolean> {
  const { rows } =
    revision === 0
      ? await c.query(
          `INSERT INTO moments_sound_settings (settings, revision) VALUES ($1, 1)
           ON CONFLICT DO NOTHING RETURNING 1`,
          [JSON.stringify(s)],
        )
      : await c.query(
          `UPDATE moments_sound_settings SET settings = $1, revision = revision + 1
           WHERE revision = $2 RETURNING 1`,
          [JSON.stringify(s), revision],
        );
  return rows.length > 0;
}

export type CueView = Cue & { revision: number };

export async function loadCues(c: SqlClient): Promise<CueView[]> {
  const { rows } = await c.query(`SELECT name, settings, revision FROM moments_cues`, []);
  const saved = new Map(
    (rows as { name: string; settings: Partial<Cue>; revision: number }[]).map((r) => [r.name, r]),
  );
  const builtins = BUILTIN_CUES.map((b) => {
    const row = saved.get(b.name);
    return {
      ...b,
      ...(row?.settings ?? {}),
      name: b.name,
      builtin: true,
      revision: row?.revision ?? 0,
    };
  });
  const own = [...saved.values()]
    .filter((r) => !BUILTIN_CUES.some((b) => b.name === r.name))
    .map((r) => ({ ...(r.settings as Cue), name: r.name, builtin: false, revision: r.revision }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...builtins, ...own];
}

export async function loadCue(c: SqlClient, name: string): Promise<CueView | null> {
  return (await loadCues(c)).find((x) => x.name === name) ?? null;
}

/**
 * Saves a cue when `revision` is the stored one (0: never saved; a row the picture made for its
 * last effect has revision 0 too); false on a stale one.
 */
export async function saveCue(c: SqlClient, cue: Cue, revision: number): Promise<boolean> {
  const { name } = cue;
  const settings: Partial<Cue> = { ...cue };
  delete settings.name;
  delete settings.builtin;
  if (revision === 0) {
    const { rows } = await c.query(
      `INSERT INTO moments_cues (name, settings, revision) VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, name) DO UPDATE SET settings = EXCLUDED.settings, revision = 1
       WHERE moments_cues.revision = 0 RETURNING 1`,
      [name, JSON.stringify(settings)],
    );
    return rows.length > 0;
  }
  const { rows } = await c.query(
    `UPDATE moments_cues SET settings = $2, revision = revision + 1
     WHERE name = $1 AND revision = $3 RETURNING 1`,
    [name, JSON.stringify(settings), revision],
  );
  return rows.length > 0;
}

/** An event's own cue goes; a built-in goes back to its seed. */
export async function deleteCue(c: SqlClient, name: string): Promise<boolean> {
  const { rows } = await c.query(`DELETE FROM moments_cues WHERE name = $1 RETURNING 1`, [name]);
  return rows.length > 0;
}

/** The effect the cue picked last, and the new pick stored, in one locked step. */
export async function swapEffect(
  c: SqlClient,
  name: string,
  pick: (last: string | null) => string,
) {
  await c.query(
    `INSERT INTO moments_cues (name, settings, revision) VALUES ($1, '{}', 0) ON CONFLICT DO NOTHING`,
    [name],
  );
  const { rows } = await c.query(
    `SELECT last_effect FROM moments_cues WHERE name = $1 FOR UPDATE`,
    [name],
  );
  const next = pick((rows[0]?.last_effect as string | null | undefined) ?? null);
  await c.query(`UPDATE moments_cues SET last_effect = $2 WHERE name = $1`, [name, next]);
  return next;
}

export interface LibrarySound {
  id: string;
  title: string;
  url: string;
  length_ms: number;
  source: "pack" | "upload";
  asset_id: string | null;
  size_bytes: number | null;
}

export async function loadLibrary(c: SqlClient): Promise<LibrarySound[]> {
  const { rows } = await c.query(
    `SELECT id, asset_id, title, url, length_ms, size_bytes FROM moments_sounds ORDER BY created_at, id`,
    [],
  );
  return [
    ...PACK.map((p) => ({
      id: p.id,
      title: p.title,
      url: `${PACK_PATH}${p.file}`,
      length_ms: p.length_ms,
      source: "pack" as const,
      asset_id: null,
      size_bytes: null,
    })),
    ...(rows as Omit<LibrarySound, "source">[]).map((r) => ({ ...r, source: "upload" as const })),
  ];
}

export async function addSound(c: SqlClient, s: LibrarySound, at: Date): Promise<void> {
  await c.query(
    `INSERT INTO moments_sounds (id, asset_id, title, url, length_ms, size_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [s.id, s.asset_id, s.title, s.url, s.length_ms, s.size_bytes, at],
  );
}

export async function removeSound(c: SqlClient, id: string): Promise<boolean> {
  const { rows } = await c.query(`DELETE FROM moments_sounds WHERE id = $1 RETURNING 1`, [id]);
  return rows.length > 0;
}

/** The zone's sound state, locked until the transaction ends (one decision at a time). */
export async function lockZone(c: SqlClient, zone: string): Promise<ZoneSound> {
  await c.query(
    `INSERT INTO moments_sound_zones (zone_key, state) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [zone, JSON.stringify(EMPTY_ZONE)],
  );
  const { rows } = await c.query(
    `SELECT state FROM moments_sound_zones WHERE zone_key = $1 FOR UPDATE`,
    [zone],
  );
  return { ...EMPTY_ZONE, ...(rows[0]?.state as Partial<ZoneSound> | undefined) };
}

export async function saveZone(c: SqlClient, zone: string, state: ZoneSound): Promise<void> {
  await c.query(`UPDATE moments_sound_zones SET state = $2 WHERE zone_key = $1`, [
    zone,
    JSON.stringify(state),
  ]);
}

/** Zones with a sound waiting, for the tick. */
export async function queuedZones(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT zone_key FROM moments_sound_zones
     WHERE jsonb_array_length(state->'queue') > 0 ORDER BY zone_key`,
    [],
  );
  return rows.map((r) => r.zone_key as string);
}

export async function oncePlayed(
  c: SqlClient,
  zone: string,
  cue: string,
  source: string,
  now: Date,
): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM moments_sound_sources WHERE zone_key = $1 AND cue = $2 AND source = $3
       AND at > $4::timestamptz - interval '7 days'`,
    [zone, cue, source, now],
  );
  return rows.length > 0;
}

export async function rememberOnce(
  c: SqlClient,
  zone: string,
  cue: string,
  source: string,
  now: Date,
): Promise<void> {
  await c.query(
    `INSERT INTO moments_sound_sources (zone_key, cue, source, at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, zone_key, cue, source) DO UPDATE SET at = EXCLUDED.at`,
    [zone, cue, source, now],
  );
}

export interface LogRow {
  at: Date;
  zone_key: string;
  cue: string;
  sound: string | null;
  outcome: string;
  reason: string;
  detail: string | null;
  source: string | null;
}

export async function writeLog(c: SqlClient, r: LogRow): Promise<void> {
  await c.query(
    `INSERT INTO moments_sound_log (at, zone_key, cue, sound, outcome, reason, detail, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [r.at, r.zone_key, r.cue, r.sound, r.outcome, r.reason, r.detail, r.source],
  );
}

export async function readLog(
  c: SqlClient,
  f: { zone?: string; limit: number; before?: number },
): Promise<(LogRow & { seq: number })[]> {
  const { rows } = await c.query(
    `SELECT seq, at, zone_key, cue, sound, outcome, reason, detail, source FROM moments_sound_log
     WHERE ($1::text IS NULL OR zone_key = $1) AND ($2::bigint IS NULL OR seq < $2)
     ORDER BY seq DESC LIMIT $3`,
    [f.zone ?? null, f.before ?? null, f.limit],
  );
  return (rows as unknown as (LogRow & { seq: string })[]).map((r) => ({
    ...r,
    seq: Number(r.seq),
  }));
}

/** Whether an emergency runs on the zone: then only urgent sounds (the issue's correction). */
export async function emergencyOn(c: SqlClient, zone: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM moments WHERE ended_at IS NULL AND class = 'emergency'
       AND (cardinality(zones) = 0 OR $1 = ANY (zones)) AND NOT ($1 = ANY (left_zones)) LIMIT 1`,
    [zone],
  );
  return rows.length > 0;
}
