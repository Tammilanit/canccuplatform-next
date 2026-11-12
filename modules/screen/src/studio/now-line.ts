/**
 * What a screen shows now, in words, for its device card ("Now: Dinner countdown"; mockup 07).
 * The player reports no `now_playing` of its own yet, so this reads the zone's composed state,
 * the same one its screens draw: a takeover, else the hero's claim, the widget its rotation is
 * on (anchored on the epoch, as every screen of the zone, compose/build.ts), or its idle choice.
 */
import type { RegionView, WidgetView } from "../compose/build.js";
import type { ZoneRecord } from "../push/store.js";
import { nameOf } from "./messages.js";
import type { Translate } from "./messages.js";

function words(t: Translate, widget: string, view: Record<string, unknown>): string {
  const label = typeof view.label === "string" ? view.label : "";
  if (widget === "countdown" && label !== "") return t("device.now_countdown", { label });
  return nameOf(t, "widget", widget);
}

/** The widget a rotating region is on at `nowMs`. */
function rotationAt(region: RegionView, nowMs: number): WidgetView | undefined {
  const shown = region.order.flatMap((i) => region.widgets[i] ?? []);
  const cycleMs = shown.reduce((sum, w) => sum + w.dwell_seconds * 1000, 0);
  if (cycleMs === 0) return undefined;
  let at = (((nowMs - Date.parse(region.cycle_started_at)) % cycleMs) + cycleMs) % cycleMs;
  for (const w of shown) {
    at -= w.dwell_seconds * 1000;
    if (at < 0) return w;
  }
  return shown[0];
}

export function nowShowing(
  t: Translate,
  record: ZoneRecord | null | undefined,
  portrait: boolean,
  nowMs: number,
): string | null {
  const regions = record?.views[portrait ? "portrait" : "landscape"]?.regions ?? [];
  const region =
    regions.find((r) => r.role === "full" && r.claim !== null) ??
    regions.find((r) => r.role === "hero");
  if (region === undefined) return null;
  const claim = region.claim;
  if (claim !== null) {
    const title = claim.content.title;
    return typeof title === "string" && title !== "" ? title : nameOf(t, "widget", claim.template);
  }
  const active = rotationAt(region, nowMs);
  if (active !== undefined) return words(t, active.widget, active.view);
  if (region.idle_view !== null) return words(t, "countdown", region.idle_view.view);
  return region.idle === "logo" ? t("device.now_logo") : null;
}
