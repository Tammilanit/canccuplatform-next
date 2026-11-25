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
    }));
  return {
    title: "The coming hours",
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    now: new Date(o.nowMs).toISOString(),
    items: shown.map((i) => ({
      name: i.title,
      kind: i.kind,
      starts_at: i.starts_at,
      ends_at: i.ends_at,
      place: i.location,
      starts_text: o.time(i.starts_at),
    })),
    marks,
  };
}
