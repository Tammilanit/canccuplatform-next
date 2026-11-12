/**
 * What a screen shows now, in words, for its device card ("Now: Dinner countdown"; mockup 07).
 * The player reports no `now_playing` of its own yet, so this reads the zone's composed state,
 * the same one its screens draw: a takeover, else the hero's claim, the widget its rotation is
 * on (epoch-anchored and reshuffled each cycle, as the player picks it, compose/build.ts shownAt),
 * or its idle choice.
 */
import { shownAt } from "../compose/build.js";
import type { ZoneRecord } from "../push/store.js";
import { nameOf } from "./messages.js";
import type { Translate } from "./messages.js";

function words(t: Translate, widget: string, view: Record<string, unknown>): string {
  const label = typeof view.label === "string" ? view.label : "";
  if (widget === "countdown" && label !== "") return t("device.now_countdown", { label });
  return nameOf(t, "widget", widget);
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
  const active = shownAt(region, record?.zone.key ?? "", nowMs);
  if (active !== null) return words(t, active.widget, active.view);
  if (region.idle_view !== null) return words(t, "countdown", region.idle_view.view);
  return region.idle === "logo" ? t("device.now_logo") : null;
}
