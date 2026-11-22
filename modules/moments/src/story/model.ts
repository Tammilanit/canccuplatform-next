/**
 * A storyboard as data (contracts/moments.md, Storyboards; the storyboards plan, #114): one or
 * more triggers, conditions, a run mode, one round of steps with at most one inner repeat, the
 * rounds (offsets from the trigger time T, or every n minutes), the ends, an optional finale and
 * which rounds sound. Pure types, limits and the placeholder vocabulary (D10, SD3).
 */

export const TRANSITIONS = ["cut", "fade", "rise", "slide", "flash"] as const;
export const RUN_MODES = ["per_source", "restart", "ignore"] as const;
export const SOUND_ROUNDS = ["first", "every", "last", "first_and_last"] as const;
export const ENERGIES = ["none", "calm", "lively", "party"] as const;
export const MILESTONE_COUNTS = ["checkins", "online", "photos"] as const;

export type Transition = (typeof TRANSITIONS)[number];
export type RunMode = (typeof RUN_MODES)[number];
export type SoundRounds = (typeof SOUND_ROUNDS)[number];
export type EnergyLevel = (typeof ENERGIES)[number];

/** The limits of the plan (Timing, Repeats and loops, Ends; SO3). */
export const LIMITS = {
  stories: 40,
  steps: 12,
  roundMs: 120_000,
  holdMs: 180_000,
  stepSeconds: [1, 60] as const,
  stingSeconds: [1, 5] as const,
  repeatTimes: [2, 5] as const,
  offsetMinutes: [-240, 240] as const,
  everyMinutes: [2, 120] as const,
  clockEveryMinutes: [15, 240] as const,
  rounds: [1, 20] as const,
  forMinutes: [1, 360] as const,
  finaleSteps: 2,
  minFloorSeconds: 8,
  cooldownMinutes: [0, 1440] as const,
};

/**
 * The domain events a trigger may name (a fixed list), what identifies their source, and the
 * public placeholders each fills. Personal fields (`user_ids`, `people` of a pizza) are never read.
 */
export const DOMAIN_TYPES: Readonly<Record<string, { source: string; fills: readonly string[] }>> =
  {
    "tournament.registration.opened": {
      source: "session",
      fills: ["session.name", "session.game"],
    },
    "tournament.registration.closed": {
      source: "session",
      fills: ["session.name", "session.game"],
    },
    "tournament.checkin.opened": {
      source: "session",
      fills: ["session.name", "session.game", "checkin.closes_at"],
    },
    "tournament.checkin.closed": { source: "session", fills: ["session.name", "session.game"] },
    "tournament.match.called": {
      source: "match",
      fills: ["session.name", "session.game", "match.label", "match.teams"],
    },
    "tournament.match.started": {
      source: "match",
      fills: ["session.name", "session.game", "match.label", "match.teams"],
    },
    "tournament.match.finished": {
      source: "match",
      fills: [
        "session.name",
        "session.game",
        "match.label",
        "match.teams",
        "winner.name",
        "winner.names",
        "winner.points",
      ],
    },
    // Provisional (contracts/events.md): the round's facts once step 7's tournament emits it.
    "tournament.round.started": {
      source: "round",
      fills: ["session.name", "session.game", "round.number"],
    },
    "pizza.order.opened": { source: "order", fills: ["order.seq", "order.target_at"] },
    // Provisional (contracts/events.md): 10 minutes before the close, once step 5's pizza emits it.
    "pizza.order.closing": { source: "order", fills: ["order.seq", "order.closes_at"] },
    "pizza.order.placed": {
      source: "order",
      fills: ["order.seq", "order.target_at", "order.pizza_count"],
    },
    "pizza.order.arrived": { source: "order", fills: ["order.seq", "order.pizza_count"] },
    "pizza.order.closed": { source: "order", fills: ["order.seq"] },
    // D3: everyone got theirs, the holder's Done, or the timer (which starts nothing: triggers.ts).
    "pizza.order.done": { source: "order", fills: ["order.seq"] },
    "games.surge.started": { source: "game", fills: ["game.name", "game.players"] },
    "screen.photo.added": { source: "photo", fills: [] },
  };

/**
 * The events that take a source past a domain `until_event` (#771): a run still waiting for it
 * ends at once, without its finale, and a finale on air ends too, since either would tell a step
 * the source has left behind ("Order closed" beside an order already called in or cancelled).
 */
export const PASSED: Readonly<Record<string, readonly string[]>> = {
  "pizza.order.closed": [
    "pizza.order.placed",
    "pizza.order.arrived",
    "pizza.order.done",
    "pizza.order.cancelled",
  ],
};

/** Domain types no module sends yet: provisional in contracts/events.md, with who will send them. */
export const PROVISIONAL: Readonly<Record<string, string>> = {
  "pizza.order.closing": "the pizza module, step 5",
  "tournament.round.started": "the tournament module, step 7",
};

export type Trigger =
  | { kind: "item"; kinds: string[]; item_id: string | null; anchor: "start" | "end" }
  | { kind: "domain"; type: string; final_only: boolean }
  | {
      kind: "clock";
      mode: "once" | "daily" | "event_start" | "event_end" | "every";
      /** `once`: a date-time; `daily`: HH:MM. */
      at: string | null;
      every_minutes: number | null;
      /** `every`: the window, HH:MM on the event's days. */
      from: string | null;
      until: string | null;
    }
  | { kind: "take" }
  | { kind: "scene"; scene_key: string; change: "enters" | "leaves" }
  | {
      kind: "milestone";
      count: (typeof MILESTONE_COUNTS)[number];
      /** A value to cross, or null: a new peak. */
      at: number | null;
    };

export interface Conditions {
  /** Empty: every zone. */
  zones: string[];
  /** The item's own zone, else every zone. */
  item_zone: boolean;
  /** In one of these scenes (empty: any), and in none of `not_scenes`. */
  scenes: string[];
  not_scenes: string[];
  energy_min: EnergyLevel | null;
  energy_max: EnergyLevel | null;
  window: { from: string; until: string } | null;
  /** The event's days (YYYY-MM-DD in its time zone); empty: every day. */
  days: string[];
  once: "event" | "day" | "source" | null;
  cooldown_minutes: number;
  /** In a quiet scene: play calm and silent (E11), or skip. */
  quiet: "calm" | "skip";
}

export interface StoryStep {
  /** A Screen widget (`title_card`, `sting`, `countdown`, …) or `video`. */
  template: string;
  /** The widget's view-model as written: strings may hold placeholders. */
  content: Record<string, unknown>;
  duration_seconds: number;
  transition: Transition;
  /** An event cue played at the step's start, or null. */
  cue: string | null;
  on_the_dot: boolean;
  /** The round's message step: it holds at least the minimum card time. */
  message: boolean;
}

export interface Round {
  steps: StoryStep[];
  /** One inner repeat over steps `from`..`to` (indexes, inclusive). */
  repeat: { from: number; to: number; times: number } | null;
  /** The long hold (SL2): the round's last step held so the round lasts this long, ≤ 180 s. */
  hold_seconds: number | null;
}

export type Rounds =
  | { mode: "offsets"; offsets_minutes: number[] }
  | { mode: "every"; every_minutes: number; from_minutes: number };

export type UntilEvent =
  | { kind: "item_starts" }
  | { kind: "item_ends" }
  | { kind: "next_item_starts" }
  | { kind: "domain"; type: string };

export interface Ends {
  rounds: number | null;
  for_minutes: number | null;
  /** HH:MM in the event's time zone, the first after T. */
  until_clock: string | null;
  until_event: UntilEvent | null;
  /** Ends on the crew's Stop loop. */
  crew: boolean;
}

export interface Story {
  key: string;
  name: string;
  /** The preset it was copied from, or null. */
  preset: string | null;
  enabled: boolean;
  triggers: Trigger[];
  conditions: Conditions;
  run_mode: RunMode;
  full_screen: boolean;
  round: Round;
  rounds: Rounds;
  end: Ends;
  /** One or two steps played once on every planned end, or null. */
  finale: StoryStep[] | null;
  sound: SoundRounds;
}

export const EMPTY_CONDITIONS: Conditions = {
  zones: [],
  item_zone: false,
  scenes: [],
  not_scenes: [],
  energy_min: null,
  energy_max: null,
  window: null,
  days: [],
  once: null,
  cooldown_minutes: 0,
  quiet: "calm",
};

const COMMON = ["event.name", "event.ends_at", "now.time", "now.day"];
const ITEM = [
  "item.title",
  "item.starts_at",
  "item.starts_in",
  "item.ends_at",
  "item.location",
  "item.kind",
  "item.game",
];
const NEXT = ["next.title", "next.starts_at"];

/** Every placeholder a story may name; anything else fails validation (D10). */
export const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  ...COMMON,
  ...ITEM,
  ...NEXT,
  ...Object.values(DOMAIN_TYPES).flatMap((d) => d.fills),
  "scene.name",
  "milestone.value",
]);

/** The placeholders one trigger fills (the plan's trigger table); a take fills free variables. */
export function fillsOf(t: Trigger, s: Pick<Story, "triggers" | "end">): Set<string> {
  const out = new Set(COMMON);
  const add = (xs: readonly string[]) => {
    xs.forEach((x) => out.add(x));
  };
  const next = s.end.until_event?.kind === "next_item_starts";
  const hasItem = s.triggers.some((x) => x.kind === "item");
  if (t.kind === "item" || (t.kind === "take" && hasItem)) {
    // A take of a story with an item trigger asks for the item (SU3).
    add(ITEM);
    if (next) add(NEXT);
  }
  if (t.kind === "domain") add(DOMAIN_TYPES[t.type]?.fills ?? []);
  if (t.kind === "scene") out.add("scene.name");
  if (t.kind === "milestone") out.add("milestone.value");
  return out;
}

/** `{ns.field}`, `{ns.field|fallback}`, a free `{name}` or `{name|fallback}`, or a stray brace. */
export const TOKEN = /\{([^{}]*)\}|[{}]/g;
const FREE = /^[a-z][a-z0-9_]{0,31}$/;

export type Placeholder =
  | { kind: "known"; name: string; fallback: string | null }
  | { kind: "free"; name: string; fallback: string | null }
  | { kind: "unknown"; raw: string }
  | { kind: "brace" };

export function* placeholders(text: string): Generator<Placeholder> {
  for (const m of text.matchAll(TOKEN)) {
    const inner = m[1];
    if (inner === undefined) {
      yield { kind: "brace" };
      continue;
    }
    const bar = inner.indexOf("|");
    const name = bar < 0 ? inner : inner.slice(0, bar);
    const fallback = bar < 0 ? null : inner.slice(bar + 1);
    if (KNOWN_PLACEHOLDERS.has(name)) yield { kind: "known", name, fallback };
    else if (FREE.test(name)) yield { kind: "free", name, fallback };
    else yield { kind: "unknown", raw: `{${inner}}` };
  }
}

/** Every string of a step's content, deep: the texts a placeholder may sit in. */
export function textsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(textsOf);
  if (typeof v === "object" && v !== null) return Object.values(v).flatMap(textsOf);
  return [];
}

/** The free variables a story's texts name: a take asks for them (SU3). */
export function freeVariablesOf(s: Pick<Story, "round" | "finale">): string[] {
  const names: string[] = [];
  for (const step of [...s.round.steps, ...(s.finale ?? [])])
    for (const text of textsOf(step.content))
      for (const p of placeholders(text))
        if (p.kind === "free" && !names.includes(p.name)) names.push(p.name);
  return names;
}

/** Whether `last` and `first_and_last` may be offered: the last round is known ahead. */
export const lastRoundKnown = (s: Pick<Story, "rounds" | "end">): boolean =>
  s.rounds.mode === "offsets" || s.end.rounds !== null;

/** The planned number of rounds, or null when an event or the crew ends the loop. */
export function roundCount(s: Pick<Story, "rounds" | "end">): number | null {
  const byOffsets = s.rounds.mode === "offsets" ? s.rounds.offsets_minutes.length : null;
  if (byOffsets !== null && s.end.rounds !== null) return Math.min(byOffsets, s.end.rounds);
  return byOffsets ?? s.end.rounds;
}

export const isSting = (step: Pick<StoryStep, "template">): boolean => step.template === "sting";
export const isVideo = (step: Pick<StoryStep, "template">): boolean => step.template === "video";
