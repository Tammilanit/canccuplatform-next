/**
 * The hub's view of a zone (contracts/screen.md, One source, two surfaces): the zone's landscape
 * composition with only the widgets a guest may see.
 */
import type { TenantContext } from "@canccu/kit";
import { composeZone } from "./state.js";
import type { ComposeDeps } from "./state.js";

/**
 * The widget types the hub may see (contracts/screen.md, One source, two surfaces). Never
 * `checkin_qr`: its rotating code proves presence at the venue only while it stays on the screen.
 */
export const NOW_TYPES = new Set([
  "clock",
  "agenda_now",
  "countdown",
  "hot_game",
  "bracket",
  "leaderboard",
  "announcement",
  "ticker",
  "food_status",
  "stats",
  "now_playing",
]);

export async function nowView(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  zoneKey: string,
  member: boolean,
): Promise<Record<string, unknown> | null> {
  const composed = await composeZone(deps, ctx, host, zoneKey, undefined, false);
  if (composed === null) return null;
  const regions = composed.views.landscape.regions.map((r) => {
    const kept = r.widgets.flatMap((w, i) => (NOW_TYPES.has(w.widget) ? [{ w, i }] : []));
    const index = new Map(kept.map(({ i }, n) => [i, n]));
    return {
      ...r,
      order: r.order.flatMap((i) => (index.has(i) ? [index.get(i) as number] : [])),
      widgets: kept.map(({ w }) =>
        // `now_playing` names go to signed-in members only (the bot gives them to no guest).
        w.widget === "now_playing" && !member ? { ...w, view: { ...w.view, names: undefined } } : w,
      ),
    };
  });
  return {
    time: new Date((deps.now ?? Date.now)()).toISOString(),
    zone: { key: composed.zone.key, name: composed.zone.name },
    regions,
    ticker: composed.ticker,
  };
}
