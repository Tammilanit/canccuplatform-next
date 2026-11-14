/**
 * `ScreenState.display` (contracts/screen.md, Motion and burn-in drift): how the zone's screens
 * move. The player lowers the level once more under `prefers-reduced-motion`; nothing raises it.
 */
import { DEFAULT_MOTION_STYLE, legacyMotion, motionStyleOf } from "@canccu/ui";
import type { MotionStyle } from "@canccu/ui";
import { eventMotion, phaseItems, themeMotionOf, zoneMotion } from "./motion.js";
import type { LegacyMotion, MotionLevel, ZoneMotion } from "./motion.js";
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
}

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
}

export function displayOf(input: DisplayInput): { display: Display; motion: ZoneMotion } {
  const motion = zoneMotion(
    { ...eventMotion(input.settings), pin: input.pin, themeMotion: themeMotionOf(input.tokens) },
    input.items,
    input.at,
  );
  return {
    display: {
      motion_level: motion.level,
      motion_style: motionStyleOf(input.tokens?.motion_style),
      motion: legacyMotion(motion.level),
      drift: input.settings.get("burn_in_drift", false) === true,
    },
    motion,
  };
}
