/**
 * The hero and the rail as one Pulse (sheet 9 of docs/design): the hero's countdown says when and
 * where its item starts, with its delay, and the rail never repeats the item the hero shows. The
 * countdown's view-model has only `label`, `target_at` and `ends_text` (contracts/screen.md,
 * Widgets), so its place and delay come from the rail's row of the same item: both views come
 * from the same agenda read, so a row with the countdown's name and start is its item. The items
 * after next (`later`) follow the rail's rows, so a rail that gives the hero's item away shows the
 * item after it as its Next (#397).
 */
import { clockText } from "./frames.js";
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

const rowsIn = (list: unknown): Row[] =>
  Array.isArray(list) ? list.filter((r): r is Row => typeof r === "object" && r !== null) : [];
const rowsOf = (view: View): Row[] => rowsIn(view.items);

const isItem = (row: Row, countdown: View): boolean =>
  typeof countdown.label === "string" &&
  row.name === countdown.label &&
  row.starts_at === countdown.target_at;

/** The countdown's start as `HH:MM`, or null when its target is not a time. */
function startsText(iso: unknown, timeZone: string): string | null {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : clockText(ms, timeZone);
}

/** A countdown with its start as text and, when a row names its item, its place and delay. */
function withItem(view: View, rows: Row[], timeZone: string): View {
  const row = rows.find((r) => isItem(r, view));
  const delay = typeof row?.delay_minutes === "number" && row.delay_minutes > 0;
  return {
    ...view,
    starts_text: startsText(view.target_at, timeZone),
    location: typeof row?.location === "string" ? row.location : null,
    // Left out at 0: a template's section shows for any number, 0 too.
    delay_minutes: delay ? row.delay_minutes : null,
  };
}

/** A claim is the crew's own message: the join never takes it for the hero or swaps it away. */
const isClaim = (p: Part): boolean => p.key.startsWith("claim:");

const isCountdownOf = (p: Part, hero: Part): boolean =>
  !isClaim(p) &&
  p.type === "countdown" &&
  p.view.label === hero.view.label &&
  p.view.target_at === hero.view.target_at;

/**
 * The parts as drawn: countdowns joined to their rows, and the rail without the hero's item. A
 * rail's countdown of that item gives its turn to the rail's run of show. A run of show left
 * with no row comes back `empty`.
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
    (p) => p.role === "hero" && p.type === "countdown" && !isClaim(p) && p.view.empty !== true,
  );
  // The run of show without the hero's item, and what comes after next behind it: the look shows
  // the first rows (rail.css), so the rail's Next is the first item the hero does not show.
  const without = (view: View): View => {
    const later = rowsIn(view.later);
    const kept = rowsOf(view).filter((r) => hero === undefined || !isItem(r, hero.view));
    if (kept.length === rowsOf(view).length && later.length === 0) return view;
    const ids = new Set(kept.map((r) => r.id));
    const items = [...kept, ...later.filter((r) => !ids.has(r.id))];
    // Nothing left: `empty` hands the region to its idle choice (screen.ts), never an empty card.
    return items.length === 0 ? { ...view, items, empty: true } : { ...view, items };
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
