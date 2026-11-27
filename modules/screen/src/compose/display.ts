/**
 * `ScreenState.display` (contracts/screen.md, Motion and burn-in drift): how the zone's screens
 * move. The player lowers the level once more under `prefers-reduced-motion`; nothing raises it.
 */
import { DEFAULT_MOTION_STYLE, legacyMotion, motionStyleOf } from "@canccu/ui";
import type { MotionStyle } from "@canccu/ui";
import {
  eventMotion,
  hypedLevel,
  phaseItems,
  sceneLevel,
  themeMotionOf,
  zoneMotion,
} from "./motion.js";
import type { LegacyMotion, MotionLevel, MotionPhase, ZoneMotion } from "./motion.js";
import type { ZoneHype, ZoneScene } from "./scenes.js";
import type { Stage } from "./stage.js";
import type { AgendaItem, AgendaNow } from "./widgets.js";

export type Motion = LegacyMotion;

export interface Display {
  motion_level: MotionLevel;
  motion_style: MotionStyle;
  motion: Motion;
  drift: boolean;
  /** Set once the zone's views are built (compose/stage.ts). */
  stage?: Stage;
  /** The zone's scene as the player draws it; absent while none is known (D5). */
  scene?: SceneLook;
  /** The zone's hype as Moments sent it (#787 D12); absent while none is known. */
  hype?: ZoneHype;
}

/** What of a scene the player draws itself: its palette, the heartbeat and the blend. */
export type SceneLook = Pick<
  ZoneScene,
  "key" | "name" | "since" | "palette" | "sound" | "quiet" | "blend_seconds" | "heartbeat_bpm"
>;

/** A state stored before `display`, and a zone not composed yet. */
export const NO_DISPLAY: Display = {
  motion_level: "lively",
  motion_style: DEFAULT_MOTION_STYLE,
  motion: "moderate",
  drift: false,
};

/**
 * The items the phase is read from: the event's whole agenda when held, else what now and next
 * name (enough for quiet hours and what runs; a wind-down may then start late).
 */
export function phaseSource(
  all: readonly AgendaItem[] | null,
  agenda: AgendaNow | null,
  zoneKey: string,
): AgendaItem[] {
  if (all !== null) return phaseItems(all, zoneKey);
  if (agenda === null) return [];
  return phaseItems([...agenda.current, ...agenda.next, ...(agenda.later ?? [])], zoneKey);
}

export interface DisplayInput {
  tokens: { motion?: unknown; motion_style?: unknown } | undefined;
  /** The zone's phase items (phaseSource). */
  items: readonly AgendaItem[];
  pin: MotionLevel | null;
  settings: { get(key: string, fallback: unknown): unknown };
  at: number;
  /** The zone's scene, which takes the phase's place where known (D5). */
  scene?: ZoneScene | null;
  /** The zone's hype, which moves the level under the ceiling (#787 D13). */
  hype?: ZoneHype | null;
}

/**
 * The level the screen draws: the hype's step under the ceiling the other steps compose, while
 * Follow the day is on and nothing is pinned (a pinned zone keeps its level all day, as it skips
 * the day's phase). Without a hype, as a Moments that predates it sends none, the ceiling itself.
 */
export function levelWithHype(
  ceiling: MotionLevel,
  hype: ZoneHype | null | undefined,
  o: { followTheDay: boolean; pin: MotionLevel | null },
): MotionLevel {
  if (hype == null || !o.followTheDay || o.pin !== null) return ceiling;
  return hypedLevel(ceiling, hype.level);
}

/** The stage's mood: the scene's, else the day's phase. */
export const moodOf = (scene: ZoneScene | null | undefined, phase: MotionPhase): MotionPhase =>
  scene?.stage_mood ?? phase;

export function displayOf(input: DisplayInput): { display: Display; motion: ZoneMotion } {
  const levels = {
    ...eventMotion(input.settings),
    pin: input.pin,
    themeMotion: themeMotionOf(input.tokens),
  };
  const byPhase = zoneMotion(levels, input.items, input.at);
  const scene = input.scene ?? null;
  const hype = input.hype ?? null;
  // Moments says when a scene or the hype changes: the phase's next change no longer moves the level.
  const ceiling =
    scene === null ? byPhase : { ...byPhase, level: sceneLevel(levels, scene), next: null };
  const motion =
    hype === null || !levels.followTheDay || levels.pin !== null
      ? ceiling
      : { ...ceiling, level: levelWithHype(ceiling.level, hype, levels), next: null };
  return {
    display: {
      motion_level: motion.level,
      motion_style: motionStyleOf(input.tokens?.motion_style),
      motion: legacyMotion(motion.level),
      drift: input.settings.get("burn_in_drift", false) === true,
      ...(hype === null ? {} : { hype }),
      ...(scene === null
        ? {}
        : {
            scene: {
              key: scene.key,
              name: scene.name,
              since: scene.since,
              palette: scene.palette,
              sound: scene.sound,
              quiet: scene.quiet,
              blend_seconds: scene.blend_seconds,
              heartbeat_bpm: scene.heartbeat_bpm,
            },
          }),
    },
    motion,
  };
}
