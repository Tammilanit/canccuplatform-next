/**
 * The coming hours (`agenda_timeline`, contracts/screen.md, Widgets; #787 D1, sheet 01): the idle
 * rotation's moving timeline. Tonight from the event's current hour to midnight, three hours at
 * least and six at most, so the line keeps a steady scale and every screen of a zone draws the
 * same one; an open food order's close is a small mark on its axis.
 */
import type { FoodOrder } from "./food.js";
import type { AgendaItem } from "./widgets.js";

const HOUR_MS = 3600_000;
const MIN_HOURS = 3;
const MAX_HOURS = 6;
/** The line's columns, ten minutes each: a template cannot compute, so places travel as classes. */
const COLUMN_MS = 10 * 60_000;
/** The most lanes: a block that finds none free is left to the run of show beside it. */
const LANES = 3;
/**
 * How wide a block's label is at the least, in the look's unit (layouts.ts, unitsWide): its
 * time range at the size floor, with its padding. A short item's label runs on past its box,
 * so lanes are given by where the labels reach, and no label ever covers another block.
 */
const LABEL_UNITS = 22;
/** The width an hour needs at the least: its time on the axis at the size floor, and a gap. */
const HOUR_UNITS = 12;
/** The hero's padding on both sides, in the same unit: the line is the box less that. */
const PADDING_UNITS = 8;

/** The most items the line draws: the first by start. */
export const MAX_ITEMS = 5;

/** The event's own hour and minutes past it at `atMs` (time zones with half hours included). */
function localClock(atMs: number, timeZone: string): { hour: number; intoHourMs: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: num("hour"), intoHourMs: num("minute") * 60_000 + (atMs % 60_000) };
}

/** The window's start at `nowMs`: the event's current hour, so it moves each hour. */
export const windowFrom = (nowMs: number, timeZone: string): number =>
  nowMs - localClock(nowMs, timeZone).intoHourMs;
/** When the window next moves: the zone's next change for the line. */
export const windowChangeAt = (nowMs: number, timeZone: string): number =>
  windowFrom(nowMs, timeZone) + HOUR_MS;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Where a block reaches on the line, in columns: its box, and its label from its start. */
interface Reach {
  col: number;
  last: number;
  labelCol: number;
  labelLast: number;
}

/**
 * Each block's lane by where it reaches, the first free one; `undefined` for a block no lane has
 * room for. Then each label's room: up to the next block of its lane, else the line's end.
 */
function placeOf(reach: readonly Reach[], columns: number) {
  const freeFrom: number[] = Array.from({ length: LANES }, () => 1);
  let previous = -1;
  const lanes = reach.map((r) => {
    const from = Math.min(r.col, r.labelCol);
    // Staggered as sheet 01 draws them: the lane after the one before, where there is room.
    const free = freeFrom.flatMap((f, l) => (f <= from ? [l] : []));
    const lane = free.find((l) => l !== previous) ?? free[0];
    if (lane === undefined) return undefined;
    previous = lane;
    freeFrom[lane] = Math.max(r.last, r.labelLast) + 1;
    return lane;
  });
  return reach.map((r, n) => {
    const lane = lanes[n];
    if (lane === undefined) return undefined;
    const next = reach.findIndex((o, m) => m > n && lanes[m] === lane);
    const end =
      next === -1
        ? columns
        : Math.min((reach[next] as Reach).col, (reach[next] as Reach).labelCol) - 1;
    const labelEnd = r.labelCol < r.col ? columns : Math.max(r.labelLast, end);
    return { lane: lane + 1, labelCol: r.labelCol, labelCols: labelEnd - r.labelCol + 1 };
  });
}

export function timelineFields(
  items: readonly AgendaItem[],
  o: {
    nowMs: number;
    timeZone: string;
    zoneKey: string | undefined;
    /** The box's width (layouts.ts, unitsWide): how many columns a label needs. */
    unitsWide: number;
    orders: readonly FoodOrder[];
    time: (iso: string) => string | null;
  },
): Record<string, unknown> | null {
  const from = windowFrom(o.nowMs, o.timeZone);
  const toMidnight = 24 - localClock(o.nowMs, o.timeZone).hour;
  const lineUnits = Math.max(LABEL_UNITS, o.unitsWide - PADDING_UNITS);
  // A narrow box (the Dashboard's hero) holds fewer hours, so its hour times never meet.
  const hours = clamp(
    toMidnight,
    MIN_HOURS,
    clamp(Math.floor(lineUnits / HOUR_UNITS), MIN_HOURS, MAX_HOURS),
  );
  const to = from + hours * HOUR_MS;
  const columns = (hours * HOUR_MS) / COLUMN_MS;
  /** The 1-based column a time falls in on the line. */
  const columnOf = (atMs: number): number =>
    clamp(Math.floor((atMs - from) / COLUMN_MS) + 1, 1, columns);
  /** From the line's second half a mark's label grows to the left, where there is room. */
  const alignOf = (col: number): "start" | "end" => (col > columns / 2 ? "end" : "start");
  const labelCols = clamp(Math.ceil(LABEL_UNITS / (lineUnits / columns)), 1, columns);
  const shown = items
    .filter(
      (i) =>
        i.visibility === "public" &&
        (i.status ?? "scheduled") === "scheduled" &&
        (i.zone == null || i.zone === o.zoneKey) &&
        Date.parse(i.starts_at) < to &&
        Date.parse(i.ends_at ?? i.starts_at) >= o.nowMs,
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    // Lanes share the hero's height (timeline.css): more than this and a small box cuts their text.
    .slice(0, MAX_ITEMS);
  if (shown.length === 0) return null;
  const starts = shown.map((i) => Date.parse(i.starts_at));
  // An item with no end takes one column.
  const ends = shown.map((i, n) =>
    i.ends_at === null ? (starts[n] as number) + COLUMN_MS : Date.parse(i.ends_at),
  );
  const reach = shown.map((_, n): Reach => {
    const col = columnOf(starts[n] as number);
    // One that runs on past the line ends at its edge.
    const last = clamp(Math.ceil(((ends[n] as number) - from) / COLUMN_MS), col, columns);
    // A label that would run past the line's end reaches back from it instead.
    const labelCol = Math.min(col, columns - labelCols + 1);
    return { col, last, labelCol, labelLast: labelCol + labelCols - 1 };
  });
  const places = placeOf(reach, columns);
  const marks = o.orders
    .filter((x) => x.state === "open" && x.closes_at !== null)
    .filter((x) => {
      const at = Date.parse(x.closes_at as string);
      return at >= o.nowMs && at < to;
    })
    .map((x) => {
      const col = columnOf(Date.parse(x.closes_at as string));
      return {
        label: "Pizza order closes",
        at: x.closes_at,
        at_text: o.time(x.closes_at as string),
        col,
        align: alignOf(col),
      };
    });
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    title: "The coming hours",
    subtitle: hours === toMidnight ? "Tonight from now to midnight" : `The next ${hours} hours`,
    from: iso(from),
    to: iso(to),
    now: iso(o.nowMs),
    from_text: o.time(iso(from)),
    to_text: o.time(iso(to)),
    hours,
    span_seconds: hours * 3600,
    ticks: Array.from({ length: hours + 1 }, (_, h) => ({ text: o.time(iso(from + h * HOUR_MS)) })),
    items: shown.flatMap((i, n) => {
      const r = reach[n] as Reach;
      const place = places[n];
      if (place === undefined) return [];
      const startsText = o.time(i.starts_at);
      return [
        {
          name: i.title,
          kind: i.kind,
          starts_at: i.starts_at,
          ends_at: i.ends_at,
          place: i.location,
          starts_text: startsText,
          range_text:
            i.ends_at === null ? startsText : `${startsText ?? ""}–${o.time(i.ends_at) ?? ""}`,
          col: r.col,
          cols: r.last - r.col + 1,
          row: place.lane,
          label_col: place.labelCol,
          label_cols: place.labelCols,
          align: place.labelCol < r.col ? "end" : "start",
        },
      ];
    }),
    marks,
  };
}
