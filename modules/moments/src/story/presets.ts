/**
 * The 24 built-in storyboards (the storyboards plan, The preset catalogue (final); #114, #602):
 * platform data an event copies on first use and may reset (SD8, O7); a later platform version
 * never changes an event's copy, so an event that copied fewer sees the others in the picker and
 * copies one when it turns it on. "Every event" presets start on, "some venues" ones off.
 */
import type { Story } from "./model.js";
import { L5_PRESETS } from "./presets-l5.js";
import {
  CHAMPION_REPLAY,
  CHECKIN_OPEN,
  CLOSING_TIME,
  GOOD_MORNING,
  MEAL_SERVED,
  PIZZA_LAST_CALL,
  PIZZA_ORDER_OPEN,
  QUIET_HOURS_SOON,
  ROUND_START,
} from "./presets-every.js";
import {
  ARRIVAL_CHECKIN,
  GROUP_PHOTO,
  HOT_GAME,
  PREMIERE,
  PRIZE_DRAW,
  RECORD_CROWD,
  SPONSOR_THANKS,
  STAGE_BREAK,
  VENUE_INFO,
} from "./presets-venues.js";

/** In the catalogue's order: its number is the index plus one. */
export const PRESETS: readonly Story[] = [
  ...L5_PRESETS,
  MEAL_SERVED,
  QUIET_HOURS_SOON,
  GOOD_MORNING,
  CHECKIN_OPEN,
  PIZZA_ORDER_OPEN,
  CLOSING_TIME,
  ARRIVAL_CHECKIN,
  HOT_GAME,
  RECORD_CROWD,
  SPONSOR_THANKS,
  PRIZE_DRAW,
  GROUP_PHOTO,
  VENUE_INFO,
  STAGE_BREAK,
  PIZZA_LAST_CALL,
  ROUND_START,
  PREMIERE,
  CHAMPION_REPLAY,
];

export type PresetGroup = "every" | "venues";

/** The catalogue's number and group: "every event" (on by default) or "some venues" (off). */
export const PRESET_INFO: Readonly<Record<string, { number: number; group: PresetGroup }>> =
  Object.fromEntries(
    PRESETS.map((p, i) => [p.key, { number: i + 1, group: p.enabled ? "every" : "venues" }]),
  );

/**
 * Presets whose built-in rule shows the same happening (SD6, WD2): while one is on, its rule is
 * off for the event, for the events listed (all the rule's when none are).
 */
export const RULE_OF_PRESET: Readonly<Record<string, { rule: string; on?: readonly string[] }>> = {
  match_called: { rule: "match_called" },
  champion: { rule: "finals_result" },
  hot_game: { rule: "hot_game" },
};

/**
 * Presets the platform no longer has: an event's stored copy is ignored (never deleted, so a
 * revert brings it back). Pizza orders ready went with #777: Pizza is here is the `pizza` rule's
 * announcement, one path for the hall's biggest food moment.
 */
export const RETIRED_PRESETS: ReadonlySet<string> = new Set(["pizza_arrived"]);

/** The rules the event's presets that are on take over for an event of this type. */
export function rulesOff(stories: readonly Story[], type: string): Set<string> {
  const out = new Set<string>();
  for (const s of stories) {
    const o = s.enabled && s.preset !== null ? RULE_OF_PRESET[s.preset] : undefined;
    if (o !== undefined && (o.on === undefined || o.on.includes(type))) out.add(o.rule);
  }
  return out;
}

/** A preset turned on or off with another by default; each can still be turned off alone. */
export const FOLLOWS: Readonly<Record<string, string>> = { champion: "champion_replay" };

export const presetOf = (key: string): Story | undefined => PRESETS.find((p) => p.key === key);
