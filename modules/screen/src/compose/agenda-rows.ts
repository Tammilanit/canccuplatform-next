/**
 * The run of show's rows read from the event's whole agenda (contracts/screen.md, `agenda_now`):
 * what follows the next items, and the rail as it stands at a given time.
 */
import type { AgendaItem } from "./widgets.js";

const LATER_MAX = 2;

/**
 * The `public`, `scheduled` items of the zone or of no zone that start after the next ones, at most
 * two, in order of start (contracts/screen.md, `agenda_now`): what follows the item a hero counts
 * down to. None while nothing is next.
 */
export function laterOf(all: AgendaItem[], next: AgendaItem[], zoneKey: string): AgendaItem[] {
  const after = Math.max(...next.map((i) => Date.parse(i.starts_at)));
  if (!Number.isFinite(after)) return [];
  return all
    .filter(
      (i) =>
        i.visibility === "public" &&
        i.status === "scheduled" &&
        (i.zone == null || i.zone === zoneKey) &&
        Date.parse(i.starts_at) > after,
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, LATER_MAX);
}

/**
 * The rail's run of show at `atMs`, as the screens read it (`agenda_now`): the zone's items and
 * those of no zone, public and scheduled; what runs then, and every item at the first start after
 * it, as the agenda's now and next gives several when they start at once.
 */
export function railAt(
  items: readonly AgendaItem[],
  zone: string,
  atMs: number,
): { now: AgendaItem[]; next: AgendaItem[] } {
  const shown = items
    .filter(
      (i) =>
        i.visibility === "public" &&
        (i.status ?? "scheduled") === "scheduled" &&
        (i.zone == null || i.zone === zone),
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const now = shown.filter(
    (i) => Date.parse(i.starts_at) <= atMs && i.ends_at !== null && atMs < Date.parse(i.ends_at),
  );
  const first = shown.find((i) => Date.parse(i.starts_at) > atMs)?.starts_at;
  const next =
    first === undefined ? [] : shown.filter((i) => Date.parse(i.starts_at) === Date.parse(first));
  return { now, next };
}
