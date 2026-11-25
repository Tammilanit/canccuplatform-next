/**
 * The coming hours (`agenda_timeline`, contracts/screen.md, Widgets; #787 D1): the idle
 * rotation's moving timeline. A fixed window from the last half hour, so the line moves under a
 * steady scale and every screen of a zone draws the same one; an open food order's close is a
 * mark on it, as sheet 01 has it.
 */
import type { FoodOrder } from "./food.js";
import type { AgendaItem } from "./widgets.js";

const STEP_MS = 30 * 60_000;
const SPAN_MS = 3 * 3600_000;
/** The line's columns, ten minutes each: a template cannot compute, so places travel as classes. */
const COLUMN_MS = 10 * 60_000;
const COLUMNS = SPAN_MS / COLUMN_MS;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
/** The 1-based column a time falls in on the line from `from`. */
const columnOf = (atMs: number, from: number): number =>
  clamp(Math.floor((atMs - from) / COLUMN_MS) + 1, 1, COLUMNS);

export function timelineFields(
  items: readonly AgendaItem[],
  o: {
    nowMs: number;
    zoneKey: string | undefined;
    orders: readonly FoodOrder[];
    time: (iso: string) => string | null;
  },
): Record<string, unknown> | null {
  const from = Math.floor(o.nowMs / STEP_MS) * STEP_MS;
  const to = from + SPAN_MS;
  const shown = items
    .filter(
      (i) =>
        i.visibility === "public" &&
        (i.status ?? "scheduled") === "scheduled" &&
        (i.zone == null || i.zone === o.zoneKey) &&
        Date.parse(i.starts_at) < to &&
        Date.parse(i.ends_at ?? i.starts_at) >= o.nowMs,
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  if (shown.length === 0) return null;
  const marks = o.orders
    .filter((x) => x.state === "open" && x.closes_at !== null)
    .filter((x) => {
      const at = Date.parse(x.closes_at as string);
      return at >= o.nowMs && at < to;
    })
    .map((x) => ({
      label: "Pizza order closes",
      at: x.closes_at,
      at_text: o.time(x.closes_at as string),
      col: columnOf(Date.parse(x.closes_at as string), from),
    }));
  return {
    title: "The coming hours",
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    now: new Date(o.nowMs).toISOString(),
    from_text: o.time(new Date(from).toISOString()),
    to_text: o.time(new Date(to).toISOString()),
    items: shown.map((i) => {
      const start = Date.parse(i.starts_at);
      const col = columnOf(start, from);
      // An item with no end takes one column; one that runs on past the line ends at its edge.
      const end = i.ends_at === null ? start + COLUMN_MS : Date.parse(i.ends_at);
      const last = clamp(Math.ceil((end - from) / COLUMN_MS), col, COLUMNS);
      return {
        name: i.title,
        kind: i.kind,
        starts_at: i.starts_at,
        ends_at: i.ends_at,
        place: i.location,
        starts_text: o.time(i.starts_at),
        col,
        cols: last - col + 1,
      };
    }),
    marks,
  };
}
