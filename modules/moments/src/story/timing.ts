/**
 * How long each step of a round plays (the storyboards plan, Timing; SL1, SL2): the duration the
 * organiser set, never under the readable floor of a text step (finales too) nor, for the message
 * step, under the minimum card time; the busy venue factor stretches text steps, never stings.
 * A round over its limit first drops its inner repeat, then stops the stretch at the limit, and
 * no step goes under its ×1 length. Pure.
 */
import { LIMITS, isSting, isVideo, placeholders, textsOf } from "./model.js";
import type { Round, StoryStep } from "./model.js";

export const FACTORS = [1, 1.5, 2] as const;
export type Factor = (typeof FACTORS)[number];

export interface Timing {
  factor: Factor;
  /** The message step's minimum, 6 to 60 s (default 15). */
  min_card_seconds: number;
}

export const DEFAULT_TIMING: Timing = { factor: 1, min_card_seconds: 15 };

/** One step as it plays: its place in the round as written and its pass of the repeat. */
export interface Planned {
  step: number;
  pass: number;
  template: string;
  content: Record<string, unknown>;
  duration_ms: number;
  transition: StoryStep["transition"];
  cue: string | null;
  on_the_dot: boolean;
  video: boolean;
}

export interface Compiled {
  steps: Planned[];
  /** The round's length, its video's own length included. */
  length_ms: number;
  /** How early the round starts so its on-the-dot step lands on its time (0 without one). */
  lead_ms: number;
  repeat_dropped: boolean;
  /** The stretch was stopped at the limit. */
  capped: boolean;
}

const URL_LIKE = /^(\/|https?:)/;
const STEP_MAX_MS = 60_000;

/** The words a step shows: each placeholder counts as one. */
export function wordsOf(step: Pick<StoryStep, "content">): number {
  let n = 0;
  for (const text of textsOf(step.content)) {
    if (URL_LIKE.test(text)) continue;
    let plain = text;
    for (const p of placeholders(text)) if (p.kind !== "brace") n += 1;
    plain = plain.replace(/\{[^{}]*\}/g, " ");
    n += plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  return n;
}

/** 3 s plus 1 s per 3 words, never under 8 s, for a step that shows text; stings and video none. */
export function floorSeconds(step: Pick<StoryStep, "template" | "content">): number {
  if (isSting(step) || isVideo(step)) return 0;
  return Math.max(LIMITS.minFloorSeconds, 3 + Math.ceil(wordsOf(step) / 3));
}

/** A step's ×1 length: what was set, raised to its floor and, for the message, the card time. */
export function baseSeconds(step: StoryStep, t: Timing): number {
  if (isSting(step)) return step.duration_seconds;
  const card = step.message ? t.min_card_seconds : 0;
  return Math.max(step.duration_seconds, floorSeconds(step), card);
}

function unrolled(round: Round, times: number): { step: StoryStep; index: number; pass: number }[] {
  const out: { step: StoryStep; index: number; pass: number }[] = [];
  const r = round.repeat;
  round.steps.forEach((step, index) => {
    if (r === null || index < r.from || index > r.to) out.push({ step, index, pass: 0 });
  });
  if (r === null) return out;
  const block = round.steps.slice(r.from, r.to + 1);
  const repeated = Array.from({ length: times }, (_, pass) =>
    block.map((step, i) => ({ step, index: r.from + i, pass })),
  ).flat();
  const before = out.filter((o) => o.index < r.from);
  const after = out.filter((o) => o.index > r.to);
  return [...before, ...repeated, ...after];
}

/**
 * The round as it plays. `videoMs` gives a video step's own length (its asset's); a video plays
 * outside the round's limit. A finale is compiled the same way, without a repeat.
 */
export function compileRound(
  round: Round,
  t: Timing,
  videoMs: (step: StoryStep) => number = () => 0,
): Compiled {
  const limit = round.hold_seconds !== null ? LIMITS.holdMs : LIMITS.roundMs;
  const textStep = (s: StoryStep) => !isSting(s) && !isVideo(s);
  const lengths = (times: number, k: number) =>
    unrolled(round, times).map(({ step }) => {
      if (isVideo(step)) return 0;
      const base = baseSeconds(step, t) * 1000;
      // Screen plays a step for at most 60 s; only the last one holds longer, to the round's end.
      return textStep(step) ? Math.min(STEP_MAX_MS, base + base * (t.factor - 1) * k) : base;
    });
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  let times = round.repeat?.times ?? 1;
  let repeatDropped = false;
  if (round.repeat !== null && total(lengths(times, 1)) > limit) {
    times = 1;
    repeatDropped = true;
  }
  let k = 1;
  let capped = false;
  if (total(lengths(times, 1)) > limit && t.factor > 1) {
    // The share of the stretch that still fits; steps capped at 60 s make it not linear.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (total(lengths(times, mid)) > limit) hi = mid;
      else lo = mid;
    }
    k = lo;
    capped = true;
  }
  const order = unrolled(round, times);
  const ms = lengths(times, k).map((x) => Math.round(x));
  if (round.hold_seconds !== null && ms.length > 0) {
    // The long hold: the last step stays until the round has lasted its hold (SL2).
    const short = round.hold_seconds * 1000 - total(ms);
    if (short > 0) ms[ms.length - 1] = (ms[ms.length - 1] ?? 0) + short;
  }
  const steps: Planned[] = order.map(({ step, index, pass }, i) => ({
    step: index,
    pass,
    template: step.template,
    content: step.content,
    duration_ms: isVideo(step) ? Math.max(0, Math.round(videoMs(step))) : (ms[i] ?? 0),
    transition: step.transition,
    cue: step.cue,
    on_the_dot: step.on_the_dot,
    video: isVideo(step),
  }));
  const dot = steps.findIndex((s) => s.on_the_dot);
  const lead = dot < 0 ? 0 : total(steps.slice(0, dot).map((s) => s.duration_ms));
  return {
    steps,
    length_ms: total(steps.map((s) => s.duration_ms)),
    lead_ms: lead,
    repeat_dropped: repeatDropped,
    capped,
  };
}

/** A finale: one or two steps, each at least 8 s, compiled as a round of its own. */
export const compileFinale = (steps: StoryStep[], t: Timing): Compiled =>
  compileRound({ steps, repeat: null, hold_seconds: null }, t);
