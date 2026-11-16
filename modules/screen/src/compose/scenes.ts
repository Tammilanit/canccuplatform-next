/**
 * Screen's copy of each zone's scene (contracts/screen.md, Motion and burn-in drift; D5), kept
 * from `moments.scene.changed`. Moments decides the scene; Screen only composes it into the zone's
 * display, layout and hero, and keeps the last one it was told while Moments is down. Events come
 * twice and out of turn (main reads the moments streams from their start at every boot): the
 * newest event id decides, as for overrides (overrides.ts).
 */
import type { Event, SqlClient } from "@canccu/kit";
import type { Db } from "../db.js";
import { isMotionLevel } from "./motion.js";
import type { MotionLevel, MotionPhase } from "./motion.js";

export type SceneMotion = MotionLevel | "calmer" | "livelier";

export interface ZoneScene {
  key: string;
  name: string;
  motion: SceneMotion | null;
  layout: string | null;
  stage_mood: MotionPhase | null;
  palette: { primary?: string; accent?: string } | null;
  sound: boolean | null;
  quiet: boolean;
  hero_off: string[];
  blend_seconds: number;
  since: string;
  heartbeat_bpm: number;
}

const MOODS = new Set(["build_up", "doors", "peak", "wind_down", "quiet_hours"]);
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[a-z][a-z0-9_-]{0,63}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function paletteOf(v: unknown): ZoneScene["palette"] {
  if (!isObj(v)) return null;
  const out: { primary?: string; accent?: string } = {};
  for (const k of ["primary", "accent"] as const) {
    const c = v[k];
    if (typeof c === "string" && COLOUR.test(c)) out[k] = c;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The zone's scene from an event's `data`, or null when none holds or it is not one. */
export function sceneOf(data: Record<string, unknown>): ZoneScene | null {
  const s = data.scene;
  if (!isObj(s) || typeof s.key !== "string" || !KEY.test(s.key)) return null;
  const motion = s.motion;
  const bpm = data.heartbeat_bpm;
  return {
    key: s.key,
    name: typeof s.name === "string" ? s.name : s.key,
    motion: isMotionLevel(motion) || motion === "calmer" || motion === "livelier" ? motion : null,
    layout: typeof s.layout === "string" && KEY.test(s.layout) ? s.layout : null,
    stage_mood: MOODS.has(s.stage_mood as string) ? (s.stage_mood as MotionPhase) : null,
    palette: paletteOf(s.palette),
    sound: typeof s.sound === "boolean" ? s.sound : null,
    quiet: s.quiet === true,
    hero_off: Array.isArray(s.hero_off)
      ? s.hero_off.filter((f): f is string => typeof f === "string")
      : [],
    blend_seconds:
      typeof s.blend_seconds === "number" && s.blend_seconds >= 0
        ? Math.min(600, Math.round(s.blend_seconds))
        : 0,
    since: typeof data.since === "string" ? data.since : "",
    heartbeat_bpm: typeof bpm === "number" ? Math.min(30, Math.max(4, Math.round(bpm))) : 8,
  };
}

/** Keeps one `moments.scene.changed`; run inside the event's tenant. */
export async function applySceneEvent(db: Db, event: Event): Promise<void> {
  if (event.type !== "moments.scene.changed") return;
  const zone = event.data.zone_key;
  if (typeof zone !== "string") return;
  const scene = sceneOf(event.data);
  await db.tenant((c) =>
    c.query(
      `INSERT INTO screen_scenes (zone_key, scene, event_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, zone_key) DO UPDATE SET scene = EXCLUDED.scene,
         event_id = EXCLUDED.event_id
       WHERE screen_scenes.event_id < EXCLUDED.event_id`,
      [zone, scene === null ? null : JSON.stringify(scene), event.id],
    ),
  );
}

/** The zone's scene as last told, or null: the day's phase then. */
export async function loadScene(c: SqlClient, zone: string): Promise<ZoneScene | null> {
  const { rows } = await c.query(`SELECT scene FROM screen_scenes WHERE zone_key = $1`, [zone]);
  return (rows[0]?.scene as ZoneScene | null | undefined) ?? null;
}
