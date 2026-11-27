/**
 * The sound model's fixed parts (step 4 plan, The sound model D16; contracts/moments.md, Cues and
 * sound): the six categories, the 25 cues seeded from the legacy (canccusignage
 * src/lib/sound/cues.ts, names kept) and the storyboards' `story.*`, the screen effects (design
 * sheet 14) and the CC0 default pack (static/sounds/CREDITS.md). An event changes these per event and adds cues, never categories.
 */

export const CATEGORIES = [
  "urgent",
  "result",
  "attention",
  "something_new",
  "ended",
  "ambient",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** The legacy priorities (PLAN_18 §C); only urgent interrupts a playing sound. */
export const PRIORITY: Record<Category, number> = {
  urgent: 70,
  result: 50,
  attention: 40,
  something_new: 30,
  ended: 20,
  ambient: 10,
};

/** What each energy lets through (D16): calm the essential three, a quiet scene urgent only. */
export const CALM: ReadonlySet<Category> = new Set(["urgent", "attention", "result"]);

export const EFFECTS = ["pop", "tilt", "flip", "ripple", "slide", "glow", "ring_burst"] as const;
export type Effect = (typeof EFFECTS)[number];
/** L8: a cue's frame and glow hold 60–120 s, then fade over 10 s. */
export const HOLD_MIN = 60;
export const HOLD_MAX = 120;
export const FADE_SECONDS = 10;

export interface Cue {
  name: string;
  category: Category;
  enabled: boolean;
  /** 0–100, times its category's level and the master volume. */
  level: number;
  cooldown_seconds: number;
  /** How late a missed sound may still start (D17); 0: never late. */
  catch_up_seconds: number;
  /** Minutes before the source's start: sounds only from the first to the second (legacy windows). */
  catch_up_before_start: [number, number] | null;
  /** The tournament, strip and pizza cues: one source sounds once in 7 days (legacy `dedupeBlocks`). */
  once_per_source: boolean;
  /** Library sound ids, picked at random, never the same twice running on a zone. */
  sounds: string[];
  /** A recorded line played right after the sound, counted with it as one. */
  voice_line: string | null;
  /** The picture's pool; empty: the cue sounds only. */
  effects: Effect[];
  hold_seconds: number;
  builtin: boolean;
}

export interface CategorySettings {
  enabled: boolean;
  level: number;
}

export interface SoundSettings {
  enabled: boolean;
  /** The master volume, 0–100. */
  volume: number;
  muted_until: string | null;
  hourly_budget: number;
  per_minute: number;
  per_source_seconds: number;
  categories: Record<Category, CategorySettings>;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 80,
  muted_until: null,
  hourly_budget: 20,
  per_minute: 3,
  per_source_seconds: 10,
  categories: {
    urgent: { enabled: true, level: 100 },
    result: { enabled: true, level: 80 },
    attention: { enabled: true, level: 80 },
    something_new: { enabled: true, level: 80 },
    ended: { enabled: true, level: 80 },
    ambient: { enabled: true, level: 35 },
  },
};

/** The CC0 default pack: id, file under static/sounds/, length (static/sounds/CREDITS.md). */
export const PACK: readonly { id: string; file: string; title: string; length_ms: number }[] = [
  { id: "pack.chime-soft", file: "chime-soft.ogg", title: "Chime, soft", length_ms: 1470 },
  { id: "pack.chime-bright", file: "chime-bright.ogg", title: "Chime, bright", length_ms: 2255 },
  { id: "pack.happy-beep", file: "happy-beep.ogg", title: "Happy beep", length_ms: 1149 },
  { id: "pack.music-box", file: "music-box.ogg", title: "Music box", length_ms: 801 },
  { id: "pack.nudge", file: "nudge.ogg", title: "Nudge", length_ms: 918 },
  { id: "pack.gong", file: "gong.ogg", title: "Gong", length_ms: 5600 },
  { id: "pack.drum-roll", file: "drum-roll.ogg", title: "Drum roll", length_ms: 3980 },
  { id: "pack.ding", file: "ding.ogg", title: "Ding", length_ms: 1056 },
  { id: "pack.bicycle-bell", file: "bicycle-bell.ogg", title: "Bicycle bell", length_ms: 1483 },
  { id: "pack.alarm", file: "alarm.ogg", title: "Alarm", length_ms: 3199 },
  {
    id: "pack.airplane-chime",
    file: "airplane-chime.ogg",
    title: "Airplane chime",
    length_ms: 2934,
  },
  { id: "pack.applause", file: "applause.ogg", title: "Applause", length_ms: 6320 },
];

const MIN = 60;
const seed = (name: string, category: Category, sounds: string[], o: Partial<Cue> = {}): Cue => ({
  name,
  category,
  enabled: true,
  level: 100,
  cooldown_seconds: 0,
  catch_up_seconds: 120,
  catch_up_before_start: null,
  once_per_source: false,
  sounds: sounds.map((s) => `pack.${s}`),
  voice_line: null,
  effects: ["pop", "glow"],
  hold_seconds: 60,
  builtin: true,
  ...o,
});
const ONCE = { once_per_source: true };
const OFF = { enabled: false };
const CHIP = {
  cooldown_seconds: 10 * MIN,
  effects: ["tilt", "ripple", "glow"] as Effect[],
  hold_seconds: 90,
};

/**
 * The legacy's 25 cues with their categories, on/off and cooldowns; poll and cast have no emitter
 * yet and start off, as `ticker.message` did. The sounds and effects are the default pack's. Then
 * the storyboards' presets' own.
 */
export const BUILTIN_CUES: readonly Cue[] = [
  seed("announce.attention", "attention", ["chime-soft", "chime-bright", "happy-beep"], {
    effects: ["glow", "slide"],
    hold_seconds: 120,
  }),
  seed("announce.urgent", "urgent", ["alarm"], { effects: ["ripple"] }),
  // Important's break-in (#780): one bright chime; the sweep is the card's own entrance.
  seed("announce.important", "attention", ["chime-bright"], { effects: ["pop"] }),
  seed("announce.result", "result", ["ding"]),
  seed("announce.ended", "ended", ["airplane-chime"]),
  seed("announce.cleared", "ended", ["airplane-chime"], { effects: ["glow"] }),
  seed("emergency.start", "urgent", ["alarm"], { effects: [] }),
  seed("poll.open", "something_new", ["happy-beep"], OFF),
  seed("poll.result", "result", ["ding"], OFF),
  seed("nowplaying.start", "something_new", ["music-box"], { effects: ["flip", "slide"] }),
  seed("ticker.message", "ambient", ["nudge"], { ...OFF, cooldown_seconds: 2 * MIN, effects: [] }),
  seed("photo.showcase", "something_new", ["music-box"], { effects: ["glow"] }),
  seed("cast.live", "something_new", ["happy-beep"], OFF),
  seed("cast.ended", "ended", ["airplane-chime"], OFF),
  seed("tournament.pre", "something_new", ["chime-bright"], {
    ...ONCE,
    catch_up_before_start: [14, 2],
  }),
  seed("tournament.start", "something_new", ["gong", "drum-roll"], {
    ...ONCE,
    effects: ["ripple", "pop"],
    hold_seconds: 120,
  }),
  seed("tournament.post", "result", ["drum-roll", "chime-bright"], {
    ...ONCE,
    effects: ["pop", "flip", "ring_burst"],
  }),
  seed("chrome.hot", "ambient", ["nudge"], CHIP),
  seed("chrome.voice", "ambient", ["nudge"], CHIP),
  seed("chrome.spike", "ambient", ["nudge"], CHIP),
  seed("strip.tournament_next", "something_new", ["chime-bright"], {
    ...ONCE,
    catch_up_before_start: [29, 15],
  }),
  seed("strip.finals_open", "something_new", ["chime-bright"], ONCE),
  seed("strip.finals_start", "something_new", ["gong"], ONCE),
  seed("pizza.open", "something_new", ["bicycle-bell"], ONCE),
  // The last call (#787 D8): its own sound, on the phone and the screen at once.
  seed("pizza.last_call", "attention", ["chime-bright", "bicycle-bell"], ONCE),
  seed("pizza.closed", "ended", ["airplane-chime"], ONCE),
  seed("pizza.placed", "result", ["bicycle-bell", "ding"], { ...ONCE, effects: ["pop", "ripple"] }),
  // The storyboards' own (#114, #602): Doors open's sting and Midnight's countdown, one sound of
  // its length; the meal, check-in, record, photo and prize draw; and the soft chime of quiet
  // hours, the morning and closing time, at a low level, since it plays as the venue winds down.
  seed("story.doors", "attention", ["chime-soft"], { effects: ["glow"] }),
  seed("story.midnight", "attention", ["gong"], { effects: [] }),
  seed("story.meal", "attention", ["chime-bright"], { effects: ["glow"] }),
  seed("story.checkin", "attention", ["happy-beep"], { effects: ["glow"] }),
  seed("story.record", "something_new", ["applause"], { effects: ["pop", "ring_burst"] }),
  seed("story.photo", "attention", ["music-box"], { effects: ["glow"] }),
  seed("story.draw", "result", ["drum-roll"], { effects: ["pop"] }),
  seed("story.chime", "attention", ["chime-soft"], { level: 60, effects: [] }),
];

/** The cue a crew action asks for: the spotlight, the emergency and its "All clear". */
export const CREW_CUES = {
  spotlight: "announce.attention",
  emergency: "emergency.start",
  all_clear: "announce.cleared",
  photo: "photo.showcase",
} as const;
