/**
 * Moments' sound per zone (contracts/screen.md, Sound; step 4 plan D14): Moments decides once per
 * zone and sends `moments.sound.played`; Screen keeps the zone's newest one and composes it into
 * `ScreenState.sound.play` until its catch-up window ends. Main reads the moments streams from their
 * start at every boot and every container reads every event, so the newest event id decides, as
 * for the overrides (compose/overrides.ts).
 */
import type { Event, SqlClient } from "@canccu/kit";
import type { Db } from "./db.js";

export interface Play {
  id: string;
  cue: string;
  category: string;
  url: string | null;
  voice_url: string | null;
  volume: number;
  play_at: string;
  catch_up_until: string;
  interrupts: boolean;
}

const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300;
/** Same-origin paths only: a sound is the event's file or the default pack, never another host's. */
const path = (v: unknown): boolean =>
  v === null || (typeof v === "string" && v.length <= 300 && /^\/(?!\/)/.test(v));

/** A sound as the event carries it, or null when the contract does not allow it. */
export function playOf(v: unknown): Play | null {
  if (typeof v !== "object" || v === null) return null;
  const p = v as Record<string, unknown>;
  if (
    !str(p.id) ||
    !str(p.cue) ||
    !str(p.category) ||
    !path(p.url) ||
    !path(p.voice_url ?? null) ||
    typeof p.volume !== "number" ||
    p.volume < 0 ||
    p.volume > 1 ||
    !isTime(p.play_at) ||
    !isTime(p.catch_up_until) ||
    typeof p.interrupts !== "boolean"
  ) {
    return null;
  }
  return {
    id: p.id,
    cue: p.cue,
    category: p.category,
    url: p.url as string | null,
    voice_url: (p.voice_url ?? null) as string | null,
    volume: p.volume,
    play_at: p.play_at,
    catch_up_until: p.catch_up_until,
    interrupts: p.interrupts,
  };
}

/** Keep one `moments.sound.played`; run inside the event's tenant. */
export async function applySoundEvent(db: Db, event: Event): Promise<void> {
  if (event.type !== "moments.sound.played") return;
  const zone = event.data.zone_key;
  const play = playOf(event.data.sound);
  if (typeof zone !== "string" || play === null) return;
  await db.tenant((c) =>
    c.query(
      `INSERT INTO screen_zone_sounds (zone_key, sound, event_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, zone_key) DO UPDATE SET sound = EXCLUDED.sound,
         event_id = EXCLUDED.event_id
       WHERE screen_zone_sounds.event_id < EXCLUDED.event_id`,
      [zone, JSON.stringify(play), event.id],
    ),
  );
}

/** The zone's sound while a screen may still start it (until `catch_up_until`), else null. */
export async function zonePlay(c: SqlClient, zone: string, nowMs: number): Promise<Play | null> {
  const { rows } = await c.query(`SELECT sound FROM screen_zone_sounds WHERE zone_key = $1`, [
    zone,
  ]);
  const play = playOf(rows[0]?.sound);
  return play !== null && Date.parse(play.catch_up_until) > nowMs ? play : null;
}

/** Only this host's files: a URL elsewhere would be refused by the screens' CSP anyway. */
const OWN_FILE = /^\/api\/screen\/files\/[A-Za-z0-9_.-]+$/;

/** Keep Moments' latest preload list (`moments.prefetch.changed`); run inside the event's tenant. */
export async function applyPrefetchEvent(db: Db, event: Event): Promise<void> {
  if (event.type !== "moments.prefetch.changed" || !Array.isArray(event.data.files)) return;
  const files = (event.data.files as unknown[]).flatMap((f) => {
    const x = f as { url?: unknown; zones?: unknown } | null;
    return typeof x?.url === "string" && OWN_FILE.test(x.url) && Array.isArray(x.zones)
      ? [{ url: x.url, zones: x.zones.filter((z): z is string => typeof z === "string") }]
      : [];
  });
  await db.tenant((c) =>
    c.query(
      `INSERT INTO screen_moments_prefetch (files, event_id) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET files = EXCLUDED.files, event_id = EXCLUDED.event_id
       WHERE screen_moments_prefetch.event_id < EXCLUDED.event_id`,
      [JSON.stringify(files), event.id],
    ),
  );
}

/** The files Moments asks the zone's screens to keep: its stories' videos (empty zones: every zone). */
export async function zonePrefetch(c: SqlClient, zone: string): Promise<string[]> {
  const { rows } = await c.query(`SELECT files FROM screen_moments_prefetch`, []);
  const files = (rows[0]?.files ?? []) as { url: string; zones: string[] }[];
  return [
    ...new Set(
      files.filter((f) => f.zones.length === 0 || f.zones.includes(zone)).map((f) => f.url),
    ),
  ];
}
