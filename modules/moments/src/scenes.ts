/**
 * Scenes as data (contracts/moments.md, Scenes; design sheet 12, D6, E7, L14): conditions (when)
 * and changes (then) per event, the five presets an event copies on first use (O7), the checks of
 * an organiser's list, and the scene part of `moments.scene.changed`.
 */

export const MOTIONS = ["none", "calm", "lively", "party", "calmer", "livelier"] as const;
export type SceneMotion = (typeof MOTIONS)[number];
/** The stage's moods are its phase tints (contracts/screen.md, The stage). */
export const MOODS = ["build_up", "doors", "peak", "wind_down", "quiet_hours"] as const;
export type Mood = (typeof MOODS)[number];
/** The hero's features a scene may switch off: the Director's (contracts/screen.md). */
export const HERO_FEATURES = [
  "bracket",
  "leaderboard",
  "countdown",
  "playlist",
  "photo",
  "hot_game",
  "today_numbers",
] as const;

export type Condition =
  | { type: "time"; from: string; to: string }
  | { type: "agenda"; kinds: string[]; starts_within_minutes?: number }
  | { type: "checkins"; over: number }
  | { type: "presence"; over?: number; under?: number }
  | { type: "games" }
  | { type: "crew"; minutes: number };

export interface Changes {
  motion: SceneMotion | null;
  /** Zone key → layout id; a zone not named keeps its own. */
  layouts: Record<string, string>;
  stage_mood: Mood | null;
  palette: { primary?: string; accent?: string } | null;
  /** Null keeps the zone's sound as it is. */
  sound: boolean | null;
  quiet: boolean;
  hero_off: string[];
}

export interface Scene {
  key: string;
  name: string;
  /** The preset it was copied from, or null for an organiser's own. */
  preset: string | null;
  /** Empty: every zone. */
  zones: string[];
  /** Any one is enough; an empty list always holds. */
  when: Condition[];
  then: Changes;
  hold_minutes: number;
  blend_seconds: number;
}

const KEEP: Changes = {
  motion: null,
  layouts: {},
  stage_mood: null,
  palette: null,
  sound: null,
  quiet: false,
  hero_off: [],
};

const preset = (key: string, name: string, when: Condition[], then: Partial<Changes>): Scene => ({
  key,
  name,
  preset: key,
  zones: [],
  when,
  then: { ...KEEP, ...then },
  hold_minutes: 0,
  blend_seconds: 0,
});

/**
 * The built-ins, platform data an event copies on first use (O7). In this order they are step 3's
 * day's phase exactly (contracts/screen.md, Motion and burn-in drift), with no hold or blend, so an
 * event that never opens Scenes looks as before; contracts/moments/follow-the-day.json proves it.
 */
export const PRESETS: readonly Scene[] = [
  preset("quiet", "Quiet", [{ type: "agenda", kinds: ["quiet_hours"] }], {
    stage_mood: "quiet_hours",
    quiet: true,
  }),
  preset(
    "wind_down",
    "Wind down",
    [{ type: "agenda", kinds: ["quiet_hours"], starts_within_minutes: 60 }],
    { motion: "calmer", stage_mood: "wind_down" },
  ),
  preset("doors", "Doors", [{ type: "agenda", kinds: ["doors"] }], {
    motion: "calmer",
    stage_mood: "doors",
  }),
  preset(
    "peak",
    "Peak",
    [
      { type: "agenda", kinds: ["tournament", "ceremony"] },
      { type: "crew", minutes: 30 },
    ],
    { motion: "livelier", stage_mood: "peak" },
  ),
  preset("daytime", "Daytime", [], { stage_mood: "build_up" }),
];

/** The scene part of `moments.scene.changed` for one zone; null while no scene holds. */
export function sceneEvent(s: Scene | null, zone: string): Record<string, unknown> | null {
  if (s === null) return null;
  return {
    key: s.key,
    name: s.name,
    motion: s.then.motion,
    layout: s.then.layouts[zone] ?? null,
    stage_mood: s.then.stage_mood,
    palette: s.then.palette,
    sound: s.then.sound,
    quiet: s.then.quiet,
    hero_off: s.then.hero_off,
    blend_seconds: s.blend_seconds,
  };
}

const KEY = /^[a-z][a-z0-9_-]{1,31}$/;
const ZONE = /^[a-z0-9_-]{2,32}$/;
const LAYOUT = /^[a-z][a-z0-9_-]{0,63}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
export const MAX_SCENES = 20;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown, min: number, max: number): boolean =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const strings = (v: unknown, re: RegExp): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string" && re.test(s));

function checkCondition(c: unknown): string | null {
  if (!isObj(c)) return "A condition is an object with a `type`.";
  switch (c.type) {
    case "time":
      return typeof c.from === "string" &&
        typeof c.to === "string" &&
        CLOCK.test(c.from) &&
        CLOCK.test(c.to) &&
        c.from !== c.to
        ? null
        : "A time condition runs `from` one HH:MM `to` another.";
    case "agenda":
      if (!strings(c.kinds, LAYOUT) || c.kinds.length === 0)
        return "An agenda condition names its `kinds`.";
      return c.starts_within_minutes === undefined || count(c.starts_within_minutes, 1, 720)
        ? null
        : "`starts_within_minutes` is 1 to 720.";
    case "checkins":
      return count(c.over, 0, 100_000) ? null : "A check-ins condition is `over` a count an hour.";
    case "presence":
      if (c.over === undefined && c.under === undefined)
        return "A presence condition is `over` or `under` a count.";
      return [c.over, c.under].every((n) => n === undefined || count(n, 0, 1_000_000))
        ? null
        : "A presence count is a whole number.";
    case "games":
      return null;
    case "crew":
      return count(c.minutes, 1, 720) ? null : "A crew button holds for 1 to 720 minutes.";
    default:
      return "That condition is not one scenes know.";
  }
}

function checkChanges(t: unknown): string | null {
  if (!isObj(t)) return "`then` lists the scene's changes.";
  if (t.motion !== null && !MOTIONS.includes(t.motion as SceneMotion))
    return "`motion` is a level, `calmer`, `livelier` or null.";
  if (
    !isObj(t.layouts) ||
    !Object.entries(t.layouts).every(
      ([z, l]) => ZONE.test(z) && typeof l === "string" && LAYOUT.test(l),
    )
  )
    return "`layouts` maps zone keys to layout ids.";
  if (t.stage_mood !== null && !MOODS.includes(t.stage_mood as Mood))
    return "`stage_mood` is one of the stage's moods or null.";
  if (t.palette !== null) {
    if (!isObj(t.palette)) return "`palette` is null or its colours.";
    for (const [k, v] of Object.entries(t.palette)) {
      if ((k !== "primary" && k !== "accent") || typeof v !== "string" || !COLOUR.test(v))
        return "A palette sets `primary` and `accent`, each a colour such as #1a2b3c.";
    }
  }
  if (t.sound !== null && typeof t.sound !== "boolean") return "`sound` is on, off or null.";
  if (typeof t.quiet !== "boolean") return "`quiet` is true or false.";
  if (!Array.isArray(t.hero_off) || !t.hero_off.every((f) => HERO_FEATURES.includes(f as never)))
    return "`hero_off` names the hero's features.";
  return null;
}

/** Why `list` is no valid scene list, or null. */
export function checkScenes(list: unknown): string | null {
  if (!Array.isArray(list) || list.length > MAX_SCENES)
    return `\`scenes\` lists at most ${MAX_SCENES} scenes.`;
  const seen = new Set<string>();
  for (const s of list as unknown[]) {
    if (!isObj(s)) return "A scene is an object.";
    const key = s.key;
    if (typeof key !== "string" || !KEY.test(key))
      return "A scene's `key` is 2 to 32 lowercase letters, digits, - and _.";
    if (seen.has(key)) return `${key}: each key once.`;
    seen.add(key);
    const why = ((): string | null => {
      if (typeof s.name !== "string" || s.name.trim() === "" || s.name.length > 60)
        return "`name` is 1 to 60 characters.";
      if (s.preset !== null && !PRESETS.some((p) => p.key === s.preset))
        return "`preset` names a preset or is null.";
      if (!strings(s.zones, ZONE)) return "`zones` lists zone keys.";
      if (!Array.isArray(s.when) || s.when.length > 10) return "`when` lists up to 10 conditions.";
      for (const c of s.when) {
        const bad = checkCondition(c);
        if (bad !== null) return bad;
      }
      if (!count(s.hold_minutes, 0, 240)) return "`hold_minutes` is 0 to 240.";
      if (!count(s.blend_seconds, 0, 600)) return "`blend_seconds` is 0 to 600.";
      return checkChanges(s.then);
    })();
    if (why !== null) return `${key}: ${why}`;
  }
  return null;
}

/** A checked list as stored: only the fields scenes know, in their order. */
export function scenesOf(list: readonly Scene[]): Scene[] {
  return list.map((s) => ({
    key: s.key,
    name: s.name.trim(),
    preset: s.preset,
    zones: s.zones,
    when: s.when,
    then: {
      motion: s.then.motion,
      layouts: s.then.layouts,
      stage_mood: s.then.stage_mood,
      palette: s.then.palette,
      sound: s.then.sound,
      quiet: s.then.quiet,
      hero_off: s.then.hero_off,
    },
    hold_minutes: s.hold_minutes,
    blend_seconds: s.blend_seconds,
  }));
}

/** The crew button of a scene: how long a press holds, or null without one. */
export const crewMinutes = (s: Scene): number | null =>
  s.when.find((c): c is Extract<Condition, { type: "crew" }> => c.type === "crew")?.minutes ?? null;
