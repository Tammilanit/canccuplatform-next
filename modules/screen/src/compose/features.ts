/**
 * The hero's own features and the Dashboard's graph (contracts/screen.md, The Director and
 * Widgets; design guideline sheets 10 and 13): tonight's highlight, "Today in numbers" and the
 * activity graph, each from facts the composed state already reads.
 */
import type { MotionPhase } from "./motion.js";
import { graphOf } from "./graph.js";
import type { Hour } from "./graph.js";
import type { AgendaItem } from "./widgets.js";

/** The kinds the day's phase calls its peak (Motion and burn-in drift): the evening's big items. */
const BIG_KINDS = new Set(["tournament", "ceremony"]);
const HIGHLIGHT_AHEAD_MS = 12 * 3600_000;
/** Fewer hours than this are not yet a graph (widgets.md: "Collecting…"); the box waits. */
const GRAPH_MIN_HOURS = 3;

/** The zone's next tournament or ceremony of the next 12 hours; `items` are its phase items. */
export function highlightOf(items: readonly AgendaItem[], nowMs: number): AgendaItem | null {
  const ahead = items.filter((i) => {
    const starts = Date.parse(i.starts_at);
    return BIG_KINDS.has(i.kind) && starts > nowMs && starts <= nowMs + HIGHLIGHT_AHEAD_MS;
  });
  ahead.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return ahead[0] ?? null;
}

/**
 * The next time highlightOf's answer may change: the soonest big item starting (it leaves) or
 * coming within 12 hours (it may enter). The zone is rebuilt then, as at a phase change.
 */
export function highlightChangeAt(items: readonly AgendaItem[], nowMs: number): number | null {
  let soonest: number | null = null;
  for (const i of items) {
    if (!BIG_KINDS.has(i.kind)) continue;
    const starts = Date.parse(i.starts_at);
    for (const t of [starts - HIGHLIGHT_AHEAD_MS, starts]) {
      if (t > nowMs && (soonest === null || t < soonest)) soonest = t;
    }
  }
  return soonest;
}

/** Screen's presence counts as the graphs read them (compose/stats.ts, presenceFacts). */
export interface Presence {
  online: Hour[];
  in_voice: Hour[];
  online_peak?: unknown;
  in_voice_peak?: unknown;
}

/** What the features read of a zone's facts. */
export interface FeatureFacts {
  now: Date;
  timeZone: string;
  phase?: MotionPhase;
  presence?: Presence | null;
  photosToday?: number | null;
}

/**
 * "Today in numbers" at wind-down (sheet 13): the last 24 hours, as the peaks count them, so a
 * night past midnight keeps its evening. Hours played wait for the bot's history (#389).
 */
export function todayFields(
  facts: FeatureFacts,
  unitsWide: number,
): Record<string, unknown> | null {
  if (facts.phase !== "wind_down") return null;
  const peak = facts.presence?.online_peak;
  const photos = facts.photosToday ?? 0;
  if (peak === undefined && photos === 0) return null;
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: facts.timeZone });
  return {
    title: "Today in numbers",
    day_text: day.format(facts.now),
    ...(peak === undefined ? {} : { online_peak: peak }),
    ...(facts.photosToday == null ? {} : { photos }),
    ...graphOf(facts.presence?.online ?? [], unitsWide),
  };
}

const METRICS = {
  online: { label: "Online · 24 h", peak: "online_peak" },
  in_voice: { label: "In voice · 24 h", peak: "in_voice_peak" },
} as const;

/**
 * The activity graph (`props.metric`: `online`, the default, or `in_voice`) of the last 24 hours,
 * in a box `unitsWide` units wide.
 */
export function graphFields(
  metric: unknown,
  facts: FeatureFacts,
  unitsWide: number,
): Record<string, unknown> | null {
  const key = metric === "in_voice" ? "in_voice" : "online";
  const hours = facts.presence?.[key] ?? [];
  if (hours.length < GRAPH_MIN_HOURS) return null;
  const peak = facts.presence?.[METRICS[key].peak];
  return {
    metric: key,
    label: METRICS[key].label,
    ...(peak === undefined ? {} : { peak }),
    ...graphOf(hours, unitsWide),
  };
}
