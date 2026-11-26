/**
 * What each box shows at a tick (contracts/screen.md, The Director; sheets 9 and 13): a widget of
 * a region's rotation as drawn, the turn a box held back by the choreographer keeps, and the hero
 * and the rail joined on what the boxes show, a rail the join empties showing its idle choice.
 */
import { agendaOf, heroCountdownOf, joinHeroAndRail } from "./hero-rail.js";
import { idleOf, zoneNameOf } from "./idle.js";
import { lowerThirdAt } from "./lower-third.js";
import type { Shown } from "./idle.js";
import type { Region, ScreenState } from "./state.js";
import { dimsOffline, identity, liveView, shownView } from "./widget.js";

/** What a box shows: a widget, a claim or its idle choice; `collapse` gives its cells away. */
export type Choice = Shown | "collapse" | null;

/** The rotation's index a key names (`${index}:…`), or null for a claim or the idle choice. */
export function turnIndexOf(shown: Choice | undefined): number | null {
  if (typeof shown !== "object" || shown === null) return null;
  const turn = shown.key.slice(0, shown.key.indexOf(":"));
  return /^\d+$/.test(turn) ? Number(turn) : null;
}

/** Widget `index` of `r`'s rotation as the box draws it at `now`; undefined when there is none. */
export function turnShown(
  r: Region,
  index: number,
  state: ScreenState,
  now: number,
): Shown | undefined {
  const w = r.widgets[index];
  if (w === undefined) return undefined;
  const live = liveView(w.widget, w.view, now, state.tenant.time_zone);
  const shown = shownView(w.widget, live, now);
  // The header names the zone beside the event (mockup 02); the state has it, the logo's view not.
  const view = w.widget === "logo" ? { ...shown, ...zoneNameOf(r, state) } : shown;
  // A ticker's new text is a new thing to show, so it fades in (the calm fading line, L13);
  // so are a new photo and a new playlist frame.
  const text = w.widget === "ticker" ? JSON.stringify(view.text) : identity(w.widget, view);
  return {
    key: `${String(index)}:${text}`,
    type: w.widget,
    template: w.template ?? null,
    view,
    dims: dimsOffline(w.widget),
  };
}

/**
 * The turn `drawn` names, with its view as it is now: what a box the choreographer holds back
 * shows, so new data for it (a removed photo) still lands. Undefined when that turn is gone,
 * also when it has left the rotation: an empty widget is skipped and an emptying region never
 * waits (contracts/screen.md, The Director), so the box goes straight on to its next choice.
 */
export function heldShown(
  r: Region,
  drawn: Shown,
  state: ScreenState,
  now: number,
): Choice | undefined {
  const index = turnIndexOf(drawn);
  if (index !== null) return r.order.includes(index) ? turnShown(r, index, state, now) : undefined;
  return drawn.key.startsWith("idle:") ? idleOf(r, state) : undefined;
}

/**
 * The types with one event-wide source, so two boxes of the type show the same thing; a ticker's
 * or a countdown's text differs per entry (and the hero and the rail's run of show are joined
 * apart in hero-rail.ts).
 */
const ONE_SOURCE = new Set([
  "food_status",
  "agenda_timeline",
  "leaderboard",
  "now_playing",
  "stats",
]);

/** A QR the box shows now: its own QR handoff, or an order's join code (the food item, a claim). */
function showsQr(c: Choice | undefined): boolean {
  if (typeof c !== "object" || c === null) return false;
  const code = (v: unknown) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as { image_url?: unknown }).image_url === "string";
  return code(c.view.qr) || code(c.view.join);
}

/**
 * One place at a time (#787 D7): a box whose turn shows what the hero shows (the food item) goes
 * on to its next item of another type, or its idle choice. A QR shows once too (D14): while the
 * hero shows one, the hub QR leaves its turn to the next item.
 */
function onePlace(
  regions: readonly Region[],
  choices: readonly Choice[],
  state: ScreenState,
  now: number,
): Choice[] {
  const h = regions.findIndex((r) => r.role === "hero");
  const hero = choices[h];
  if (h === -1 || typeof hero !== "object" || hero === null) return [...choices];
  const left = new Set<string>(showsQr(hero) ? ["qr"] : []);
  if (turnIndexOf(hero) !== null) {
    // The slideshow's band says the food for its 15 s, so the food box leaves meanwhile (D6a).
    const band =
      hero.type === "playlist"
        ? lowerThirdAt(regions[h] as Region, state, now, turnIndexOf(hero))
        : null;
    const shows = band?.kind.startsWith("food_") === true ? "food_status" : hero.type;
    if (ONE_SOURCE.has(shows)) left.add(shows);
  }
  if (left.size === 0) return [...choices];
  return choices.map((c, i) => {
    const r = regions[i];
    const at = turnIndexOf(c);
    if (i === h || r === undefined || at === null || typeof c !== "object" || c === null) return c;
    if (!left.has(c.type)) return c;
    const from = r.order.indexOf(at);
    const rest = [...r.order.slice(from + 1), ...r.order.slice(0, from)];
    const other = rest.find((j) => !left.has(r.widgets[j]?.widget ?? ""));
    return (other === undefined ? undefined : turnShown(r, other, state, now)) ?? idleOf(r, state);
  });
}

/**
 * The boxes' choices as one Pulse (hero-rail.ts). A rail the join leaves without a row shows its
 * idle choice, never an empty card, and never the hero's own item again.
 */
export function joinedShown(
  regions: readonly Region[],
  choices: readonly Choice[],
  state: ScreenState,
  now: number,
): Choice[] {
  const placed = onePlace(regions, choices, state, now);
  const joined = joinHeroAndRail(
    placed.map((s, i) => {
      const r = regions[i];
      if (typeof s !== "object" || s === null || r === undefined) return null;
      return { ...s, role: r.role, agenda: agendaOf(r) };
    }),
    state.tenant.time_zone,
  );
  const hero = heroCountdownOf(joined)?.view ?? null;
  return regions.map((r, i) => {
    const part = joined[i];
    const own = placed[i];
    const emptied =
      part?.view.empty === true && !(typeof own === "object" && own?.view.empty === true);
    return emptied ? idleOf(r, state, hero) : (part ?? own ?? null);
  });
}
