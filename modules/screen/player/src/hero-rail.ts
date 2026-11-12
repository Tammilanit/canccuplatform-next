/**
 * The hero and the rail as one Pulse (sheet 9 of docs/design): the hero's countdown says when and
 * where its item starts, with its delay, and the rail never repeats the item the hero shows. The
 * countdown's view-model has only `label`, `target_at` and `ends_text` (contracts/screen.md,
 * Widgets), so its place and delay come from the rail's row of the same item: both views come
 * from the same agenda read, so a row with the countdown's name and start is its item.
 */
import type { Region } from "./state.js";
import type { View } from "./widget.js";

/** The region's run-of-show widget: what a rail shows instead of a countdown the hero shows. */
export interface Agenda {
  key: string;
  template: string | null;
  view: View;
}

/** What a region shows, as far as the join needs it. */
export interface Part {
  key: string;
  role: string | null;
  type: string;
  template: string | null;
  view: View;
  dims: boolean;
  agenda: Agenda | null;
}

/** The region's run-of-show widget, keyed as its turn in the rotation would be (screen.ts). */
export function agendaOf(r: Region): Agenda | null {
  const index = r.widgets.findIndex((w) => w.widget === "agenda_now" && w.view.empty !== true);
  const w = r.widgets[index];
  return w === undefined
    ? null
    : { key: `${String(index)}:`, template: w.template ?? null, view: w.view };
}

type Row = Record<string, unknown>;

const rowsOf = (view: View): Row[] =>
  Array.isArray(view.items)
    ? view.items.filter((r): r is Row => typeof r === "object" && r !== null)
    : [];

const isItem = (row: Row, countdown: View): boolean =>
  typeof countdown.label === "string" &&
  row.name === countdown.label &&
  row.starts_at === countdown.target_at;

function clockText(iso: unknown, timeZone: string): string | null {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return null;
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(ms);
  }
}

/** A countdown with its start as text and, when a row names its item, its place and delay. */
function withItem(view: View, rows: Row[], timeZone: string): View {
  const row = rows.find((r) => isItem(r, view));
  const delay = typeof row?.delay_minutes === "number" && row.delay_minutes > 0;
  return {
    ...view,
    starts_text: clockText(view.target_at, timeZone),
    location: typeof row?.location === "string" ? row.location : null,
    // Left out at 0: a template's section shows for any number, 0 too.
    delay_minutes: delay ? row.delay_minutes : null,
  };
}

const isCountdownOf = (p: Part, hero: Part): boolean =>
  p.type === "countdown" &&
  p.view.label === hero.view.label &&
  p.view.target_at === hero.view.target_at;

/**
 * The parts as drawn: countdowns joined to their rows, and the rail without the hero's item. A
 * rail's countdown of that item gives its turn to the rail's run of show.
 */
export function joinHeroAndRail<P extends Part>(
  parts: (P | null)[],
  timeZone: string,
): (P | null)[] {
  const shown = parts.filter((p): p is P => p !== null);
  const rows = shown.flatMap((p) => [
    ...(p.type === "agenda_now" ? rowsOf(p.view) : []),
    ...(p.agenda === null ? [] : rowsOf(p.agenda.view)),
  ]);
  const hero = shown.find(
    (p) => p.role === "hero" && p.type === "countdown" && p.view.empty !== true,
  );
  const without = (view: View): View => {
    if (hero === undefined) return view;
    const items = rowsOf(view).filter((r) => !isItem(r, hero.view));
    return items.length === rowsOf(view).length ? view : { ...view, items };
  };
  return parts.map((p) => {
    if (p === null) return p;
    if (hero !== undefined && p !== hero && p.agenda !== null && isCountdownOf(p, hero)) {
      const { key, template, view } = p.agenda;
      return { ...p, key, type: "agenda_now", template, view: without(view), dims: true };
    }
    if (p.type === "countdown") return { ...p, view: withItem(p.view, rows, timeZone) };
    return p.type === "agenda_now" ? { ...p, view: without(p.view) } : p;
  });
}
