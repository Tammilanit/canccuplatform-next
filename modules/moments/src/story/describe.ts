/**
 * A story in words and numbers for the builder (mockup 18): each trigger as a sentence, the
 * conditions, the rounds, the placeholders every trigger fills, the meters (its airtime share of
 * its loop and its sounds per run against the story cap) and the checks the organiser sees
 * before saving. Pure.
 */
import { checkStory } from "./check.js";
import { fillsOf, isSting, isVideo, lastRoundKnown, roundCount } from "./model.js";
import type { Story, Trigger } from "./model.js";
import { RUN_SOUNDS, ROUND_SOUNDS } from "./round.js";
import { gapMs, patienceMs, roundAt, roundSounds } from "./schedule.js";
import { baseSeconds, compileFinale, compileRound, floorSeconds, wordsOf } from "./timing.js";
import type { Compiled, Timing } from "./timing.js";

const text = (v: unknown, d = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : d;
const s = (n: number): string => `${String(Math.round(n / 100) / 10)} s`;
const min = (n: number): string =>
  n === 0 ? "at T" : `${n > 0 ? "+" : "−"}${String(Math.abs(n))}`;

export function triggerText(t: Trigger): string {
  switch (t.kind) {
    case "item":
      return `${t.item_id !== null ? `The item ${t.item_id}` : `A run-of-show item of kind ${t.kinds.join(" or ")}`} · its ${t.anchor} · follows delays`;
    case "domain":
      return `When ${t.type} arrives${t.final_only ? " for a final" : ""}`;
    case "clock":
      if (t.mode === "every")
        return `Every ${String(t.every_minutes)} min from ${t.from ?? ""} to ${t.until ?? ""}, each a run of its own`;
      if (t.mode === "daily") return `Every day at ${t.at ?? ""}`;
      if (t.mode === "once")
        return t.at === null ? "Once, at a time not set yet" : `Once, at ${t.at}`;
      return `At the event's ${t.mode === "event_start" ? "start" : "end"}`;
    case "take":
      return "Taken by hand · On air and the phone (moments.take)";
    case "scene":
      return `When a zone ${t.change} the scene ${t.scene_key}`;
    case "milestone":
      return `When ${t.count} ${t.at === null ? "reach a new peak" : `reach ${String(t.at)}`}`;
  }
}

export function conditionsText(st: Story): string[] {
  const k = st.conditions;
  const out = [
    `Zones: ${k.item_zone ? "the item's zone, else all" : k.zones.length === 0 ? "every zone" : k.zones.join(", ")}`,
    `In a quiet scene: ${k.quiet === "calm" ? "play calm and silent" : "skip"}`,
  ];
  if (k.scenes.length > 0) out.push(`Only in ${k.scenes.join(" or ")}`);
  if (k.not_scenes.length > 0) out.push(`Not in ${k.not_scenes.join(" or ")}`);
  if (k.energy_min !== null) out.push(`Energy at least ${k.energy_min}`);
  if (k.energy_max !== null) out.push(`Energy at most ${k.energy_max}`);
  if (k.window !== null) out.push(`Between ${k.window.from} and ${k.window.until}`);
  if (k.days.length > 0) out.push(`On ${k.days.join(", ")}`);
  if (k.once !== null) out.push(`Once per ${k.once}`);
  out.push(`Cooldown: ${k.cooldown_minutes === 0 ? "none" : `${String(k.cooldown_minutes)} min`}`);
  out.push(`Run mode: ${st.run_mode.replace("_", " ")}`);
  return out;
}

export function roundsText(st: Story): string {
  const r = st.rounds;
  const at =
    r.mode === "offsets"
      ? r.offsets_minutes.length === 1 && r.offsets_minutes[0] === 0
        ? "At T"
        : `At ${r.offsets_minutes.map(min).join(", ")} min of T`
      : `Every ${String(r.every_minutes)} min from ${min(r.from_minutes)} min`;
  const e = st.end;
  const ends = [
    e.rounds === null ? null : `${String(e.rounds)} rounds`,
    e.for_minutes === null ? null : `for ${String(e.for_minutes)} min`,
    e.until_clock === null ? null : `until ${e.until_clock}`,
    e.until_event === null
      ? null
      : `until ${e.until_event.kind === "domain" ? e.until_event.type : e.until_event.kind.replace(/_/g, " ")}`,
    e.crew ? "or the crew's Stop loop" : null,
  ].filter((x) => x !== null);
  const finale =
    st.finale === null
      ? ""
      : ` · finale ${st.finale.map((x) => text(x.content.title, x.template)).join(" · ")}`;
  return `${at} · ${ends.join(" · ")}${finale}`;
}

/** The placeholders every trigger fills, for the builder's hint. */
export function sharedPlaceholders(st: Story): string[] {
  const sets = st.triggers.map((t) => fillsOf(t, st));
  const first = sets[0] ?? new Set<string>();
  return [...first].filter((p) => sets.every((x) => x.has(p))).sort();
}

export interface StepCard {
  index: number;
  template: string;
  played_ms: number;
  set_seconds: number;
  floor_seconds: number;
  words: number;
  under_floor: boolean;
  transition: string;
  cue: string | null;
  message: boolean;
  on_the_dot: boolean;
  repeated: boolean;
}

export interface Described {
  compiled: Compiled;
  finale: Compiled | null;
  cards: StepCard[];
  /** Each round's start relative to T, minutes (at most 20). */
  rounds_at: number[];
  sounding: boolean[];
  patience_s: number;
  /** The share of its loop a story holds a region (the gap rule), or null for one round. */
  loop_share: number | null;
  sounds_per_run: number;
  checks: { ok: boolean; text: string }[];
}

export function describeStory(
  st: Story,
  t: Timing,
  videoMs: (c: Record<string, unknown>) => number,
): Described {
  const compiled = compileRound(st.round, t, (x) => videoMs(x.content));
  const finale = st.finale === null ? null : compileFinale(st.finale, t);
  const first = new Map<number, number>();
  for (const p of compiled.steps) if (!first.has(p.step)) first.set(p.step, p.duration_ms);
  const rep = st.round.repeat;
  const cards: StepCard[] = st.round.steps.map((x, i) => ({
    index: i,
    template: x.template,
    played_ms: first.get(i) ?? 0,
    set_seconds: x.duration_seconds,
    floor_seconds: floorSeconds(x),
    words: wordsOf(x),
    under_floor: !isSting(x) && !isVideo(x) && x.duration_seconds < baseSeconds(x, t),
    transition: x.transition,
    cue: x.cue,
    message: x.message,
    on_the_dot: x.on_the_dot,
    repeated: rep !== null && i >= rep.from && i <= rep.to,
  }));
  const n = Math.min(roundCount(st) ?? 6, 20);
  const roundsAt = Array.from({ length: n }, (_, i) => roundAt(st, 0, i, compiled.lead_ms)).flatMap(
    (x) => (x === null ? [] : [x / 60_000]),
  );
  const sounding = roundsAt.map((_, i) => roundSounds(st, i));
  const perRound = Math.min(
    ROUND_SOUNDS,
    new Set(compiled.steps.filter((p) => p.cue !== null && p.pass === 0).map((p) => p.step)).size,
  );
  const finaleSounds = st.finale?.some((x) => x.cue !== null) === true ? 1 : 0;
  const sounds = Math.min(RUN_SOUNDS, perRound * sounding.filter(Boolean).length + finaleSounds);
  const gap = gapMs(st);
  const why = checkStory(st, t);
  const checks = [
    { ok: why === null, text: why ?? "Every loop ends, and every limit holds." },
    ...(gap === null
      ? []
      : [
          { ok: gap >= compiled.length_ms, text: `Gap ${s(gap)} ≥ round ${s(compiled.length_ms)}` },
        ]),
    ...cards
      .filter((c) => c.under_floor)
      .map((c) => ({
        ok: false,
        text: `Step ${String(c.index + 1)} plays ${s(c.played_ms)}: its floor (${String(c.words)} words) or the card time is longer than the ${String(c.set_seconds)} s set`,
      })),
    ...(lastRoundKnown(st) || (st.sound !== "last" && st.sound !== "first_and_last")
      ? []
      : [{ ok: false, text: "Last round needs a known last round" }]),
    ...(compiled.repeat_dropped
      ? [{ ok: false, text: "The busy venue factor drops the repeat: the round plays one pass" }]
      : []),
  ];
  return {
    compiled,
    finale,
    cards,
    rounds_at: roundsAt,
    sounding,
    patience_s: patienceMs(st) / 1000,
    loop_share: gap === null ? null : compiled.length_ms / gap,
    sounds_per_run: sounds,
    checks,
  };
}
