/**
 * Whether a story can be saved (contracts/moments.md, Storyboards; contracts/moments/
 * storyboard.schema.json): its shape, the plan's limits, and the placeholders (D10, SD3): an
 * unknown one fails, and one that not every trigger fills needs a fallback text. The message
 * names the culprit; null when it is fine.
 */
import {
  DOMAIN_TYPES,
  ENERGIES,
  LIMITS,
  MILESTONE_COUNTS,
  RUN_MODES,
  SOUND_ROUNDS,
  TRANSITIONS,
  fillsOf,
  isSting,
  isVideo,
  lastRoundKnown,
  placeholders,
  textsOf,
} from "./model.js";
import type { Story, StoryStep, Trigger } from "./model.js";
import { compileRound, floorSeconds } from "./timing.js";
import type { Timing } from "./timing.js";
import { gapMs } from "./schedule.js";

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TEMPLATE = /^[a-z][a-z_]{1,31}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, [lo, hi]: readonly [number, number]): boolean =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const strings = (v: unknown, re: RegExp): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && re.test(x));
const oneOf = (v: unknown, xs: readonly string[]): boolean =>
  typeof v === "string" && xs.includes(v);

function checkTrigger(t: Trigger, i: number): string | null {
  const at = `Trigger ${String(i + 1)}`;
  switch (t.kind) {
    case "item":
      if (!oneOf(t.anchor, ["start", "end"])) return `${at}: the anchor is start or end.`;
      // No kind and no item yet: it never fires (a preset's "pick an item"); a take asks for one.
      if (t.item_id === null && !strings(t.kinds, KEY))
        return `${at}: name item kinds, or one item.`;
      return null;
    case "domain":
      return DOMAIN_TYPES[t.type] === undefined ? `${at}: ${t.type} cannot start a story.` : null;
    case "clock":
      // No time yet: it never fires until one is set (Premiere's).
      if (t.mode === "once")
        return t.at !== null && Number.isNaN(Date.parse(t.at)) ? `${at}: a date-time.` : null;
      if (t.mode === "daily") return HHMM.test(t.at ?? "") ? null : `${at}: a time HH:MM.`;
      if (t.mode === "every") {
        if (!int(t.every_minutes, LIMITS.clockEveryMinutes))
          return `${at}: every 15 to 240 minutes.`;
        return HHMM.test(t.from ?? "") && HHMM.test(t.until ?? "")
          ? null
          : `${at}: a window HH:MM to HH:MM.`;
      }
      return oneOf(t.mode, ["event_start", "event_end"]) ? null : `${at}: an unknown clock.`;
    case "take":
      return null;
    case "scene":
      return KEY.test(t.scene_key) && oneOf(t.change, ["enters", "leaves"])
        ? null
        : `${at}: a scene and enters or leaves.`;
    case "milestone":
      return oneOf(t.count, MILESTONE_COUNTS) && (t.at === null || int(t.at, [1, 1_000_000]))
        ? null
        : `${at}: a count and a value, or a new peak.`;
    default:
      return `${at}: an unknown kind.`;
  }
}

function checkStep(s: StoryStep, at: string, finale: boolean): string | null {
  if (
    !isObj(s) ||
    typeof s.template !== "string" ||
    !TEMPLATE.test(s.template) ||
    !isObj(s.content)
  )
    return `${at}: a template and its content.`;
  if (!oneOf(s.transition, TRANSITIONS)) return `${at}: an unknown transition.`;
  if (s.cue !== null && (typeof s.cue !== "string" || s.cue.length > 64))
    return `${at}: a cue name.`;
  if (isVideo(s)) {
    if (finale) return `${at}: a finale has no video.`;
    return typeof s.content.asset_id === "string" ? null : `${at}: choose the video.`;
  }
  const range = isSting(s) ? LIMITS.stingSeconds : LIMITS.stepSeconds;
  if (!int(s.duration_seconds, range))
    return `${at}: ${String(range[0])} to ${String(range[1])} s${isSting(s) ? " for a sting" : ""}.`;
  if (finale && !isSting(s) && s.duration_seconds < LIMITS.minFloorSeconds)
    return `${at}: a finale step holds at least 8 s.`;
  if (s.duration_seconds < 3 && floorSeconds(s) > 0)
    return `${at}: a text step holds at least 3 s.`;
  return null;
}

function checkPlaceholders(s: Story): string | null {
  const fills = s.triggers.map((t) => fillsOf(t, s));
  const takeOnly = s.triggers.every((t) => t.kind === "take");
  for (const step of [...s.round.steps, ...(s.finale ?? [])]) {
    for (const text of textsOf(step.content)) {
      for (const p of placeholders(text)) {
        if (p.kind === "brace") return "A brace opens or closes no placeholder: remove it.";
        if (p.kind === "unknown") return `Unknown placeholder ${p.raw}.`;
        if (p.fallback !== null) continue;
        if (p.kind === "free" && !takeOnly)
          return `{${p.name}} is asked only at a take: give it a fallback, {${p.name}|…}.`;
        if (p.kind === "known" && fills.some((f) => !f.has(p.name)))
          return `Not every trigger fills {${p.name}}: give it a fallback, {${p.name}|…}.`;
      }
    }
  }
  return null;
}

function checkShape(s: Story): string | null {
  if (!isObj(s) || typeof s.key !== "string" || !KEY.test(s.key)) return "A key of a–z, 0–9 and _.";
  if (typeof s.name !== "string" || s.name.trim() === "" || s.name.length > 60)
    return "A name of at most 60 characters.";
  if (typeof s.enabled !== "boolean" || typeof s.full_screen !== "boolean")
    return "On or off, and full screen or not.";
  if (!Array.isArray(s.triggers) || s.triggers.length === 0 || s.triggers.length > 8)
    return "One to eight triggers: any one starts it.";
  for (const [i, t] of s.triggers.entries()) {
    const why = isObj(t) ? checkTrigger(t, i) : "A trigger is an object.";
    if (why !== null) return why;
  }
  if (!oneOf(s.run_mode, RUN_MODES)) return "Run mode: per source, restart or ignore.";
  if (!oneOf(s.sound, SOUND_ROUNDS)) return "Sound: first, every, last or first and last round.";
  const c = s.conditions;
  if (
    !isObj(c) ||
    !strings(c.zones, ZONE) ||
    typeof c.item_zone !== "boolean" ||
    !strings(c.scenes, KEY) ||
    !strings(c.not_scenes, KEY) ||
    !(c.energy_min === null || oneOf(c.energy_min, ENERGIES)) ||
    !(c.energy_max === null || oneOf(c.energy_max, ENERGIES)) ||
    !(
      c.window === null ||
      (isObj(c.window) && HHMM.test(c.window.from) && HHMM.test(c.window.until))
    ) ||
    !strings(c.days, DATE) ||
    !(c.once === null || oneOf(c.once, ["event", "day", "source"])) ||
    !int(c.cooldown_minutes, LIMITS.cooldownMinutes) ||
    !oneOf(c.quiet, ["calm", "skip"])
  )
    return "The conditions are not complete.";
  return null;
}

function checkRounds(s: Story, length: number): string | null {
  const r = s.rounds;
  // The list comes from a request: its mode may be anything until checked.
  const mode = r.mode as string;
  const open = mode !== "offsets";
  if (r.mode === "offsets") {
    const o = r.offsets_minutes;
    if (!Array.isArray(o) || o.length === 0 || o.length > LIMITS.rounds[1])
      return "One to twenty offsets.";
    if (!o.every((x) => int(x, LIMITS.offsetMinutes))) return "Offsets are −240 to +240 minutes.";
    if (o.some((x, i) => i > 0 && x <= (o[i - 1] as number))) return "Offsets go up, each once.";
  } else if (mode === "every") {
    if (!int(r.every_minutes, LIMITS.everyMinutes)) return "Every 2 to 120 minutes.";
    if (!int(r.from_minutes, LIMITS.offsetMinutes))
      return "The first round is −240 to +240 minutes.";
  } else return "Rounds at offsets or every n minutes.";
  const e = s.end;
  if (!isObj(e)) return "The loop needs an end.";
  if (e.rounds !== null && !int(e.rounds, LIMITS.rounds)) return "1 to 20 rounds.";
  if (e.for_minutes !== null && !int(e.for_minutes, LIMITS.forMinutes)) return "At most 6 hours.";
  if (e.until_clock !== null && !HHMM.test(e.until_clock)) return "Until a time HH:MM.";
  const u = e.until_event;
  if (u !== null && !(isObj(u) && (u.kind !== "domain" || DOMAIN_TYPES[u.type] !== undefined)))
    return "Until an event this story can know.";
  if (u !== null && u.kind !== "domain" && !s.triggers.some((t) => t.kind === "item"))
    return "Until the item starts or ends needs an item trigger.";
  if (
    open &&
    e.rounds === null &&
    e.for_minutes === null &&
    e.until_clock === null &&
    u === null &&
    !e.crew
  )
    return "Every loop ends: by a count, a time, a clock time, an event or the crew.";
  if (typeof e.crew !== "boolean") return "Crew stop is on or off.";
  const gap = gapMs(s);
  if (gap !== null && gap < length) return "The gap between rounds is at least the round's length.";
  if ((s.sound === "last" || s.sound === "first_and_last") && !lastRoundKnown(s))
    return "Last round is offered only when the last round is known (a count or offsets).";
  return null;
}

/** Why `s` cannot be saved, or null. */
export function checkStory(s: Story, t: Timing): string | null {
  const shape = checkShape(s);
  if (shape !== null) return shape;
  const round = s.round;
  if (!isObj(round) || !Array.isArray(round.steps) || round.steps.length === 0)
    return "The round has at least one step.";
  for (const [i, step] of round.steps.entries()) {
    const why = checkStep(step, `Step ${String(i + 1)}`, false);
    if (why !== null) return why;
  }
  if (round.steps.every(isSting)) return "A sting is a transition, never the only step of a round.";
  if (round.steps.filter((x) => x.on_the_dot).length > 1) return "At most one step on the dot.";
  if (round.steps.filter(isVideo).length > 1) return "At most one video step.";
  if (round.steps.filter((x) => x.message).length > 1) return "At most one message step.";
  const rep = round.repeat;
  if (rep !== null) {
    if (!int(rep.times, LIMITS.repeatTimes)) return "A repeat plays 2 to 5 times.";
    if (
      !int(rep.from, [0, round.steps.length - 1]) ||
      !int(rep.to, [rep.from, round.steps.length - 1])
    )
      return "The repeat covers neighbouring steps of the round.";
    if (round.steps.slice(rep.from, rep.to + 1).some(isVideo)) return "A video does not repeat.";
  }
  if (round.hold_seconds !== null && !int(round.hold_seconds, [10, 180]))
    return "A long hold is at most 180 s.";
  if (
    round.hold_seconds !== null &&
    s.rounds.mode === "offsets" &&
    s.rounds.offsets_minutes.length > 1
  )
    return "A long hold story has one round.";
  const compiled = compileRound(round, t);
  if (compiled.steps.length > LIMITS.steps) return "At most 12 steps a round, its repeat unrolled.";
  const limit = round.hold_seconds !== null ? LIMITS.holdMs : LIMITS.roundMs;
  if (compiled.length_ms > limit)
    return `The round lasts ${String(Math.round(compiled.length_ms / 1000))} s: at most ${String(limit / 1000)} s.`;
  if (s.finale !== null) {
    if (!Array.isArray(s.finale) || s.finale.length === 0 || s.finale.length > LIMITS.finaleSteps)
      return "A finale is one or two steps.";
    for (const [i, step] of s.finale.entries()) {
      const why = checkStep(step, `Finale step ${String(i + 1)}`, true);
      if (why !== null) return why;
    }
  }
  return checkRounds(s, compiled.length_ms) ?? checkPlaceholders(s);
}

/** The event's list: at most 40 stories, each valid, each key once. */
export function checkStories(list: unknown, t: Timing): string | null {
  if (!Array.isArray(list)) return "A list of stories.";
  if (list.length > LIMITS.stories) return "At most 40 stories an event.";
  const keys = new Set<string>();
  for (const s of list as Story[]) {
    const why = checkStory(s, t);
    if (why !== null)
      return `${isObj(s) && typeof s.name === "string" ? s.name : "A story"}: ${why}`;
    if (keys.has(s.key)) return `The key ${s.key} is used twice.`;
    keys.add(s.key);
  }
  return null;
}
