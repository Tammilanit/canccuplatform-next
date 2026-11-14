/**
 * What a region shows with nothing to rotate (contracts/screen.md, The Pulse options, `idle`), and
 * the zone's name a header's logo carries.
 */
import type { Region, ScreenState } from "./state.js";
import type { View } from "./widget.js";

/** What a region shows: `key` names the thing, so a new key fades and the same key updates. */
export interface Shown {
  key: string;
  type: string;
  template: string | null;
  view: View;
  /**
   * Dims while the page is offline. Kept out of the view `show()` compares: going offline must
   * not redraw a widget, which would reload an embed's frame just as the uplink drops.
   */
  dims: boolean;
}

/** The region's idle choice: what it shows with nothing to rotate, or with its rail emptied. */
export function idleOf(r: Region, state: ScreenState): Shown | "collapse" | null {
  if (r.idle === "blank") return null;
  if (r.idle === "collapse") return "collapse";
  const base = { template: null, dims: false };
  if (r.idle === "next" && r.idle_view !== null) {
    const view = { ...r.idle_view.view, next_up: true };
    return { ...base, key: "idle:next", type: "countdown", view };
  }
  // `logo`, and any idle value this player does not know (contracts/screen.md, The Pulse options).
  const view = { url: state.theme.logo_url, name: state.tenant.name, qr: null, empty: false };
  // The server sends no logo view without a theme logo, so the header's zone comes from here too.
  const zoneName = zoneNameOf(r, state);
  return { ...base, key: "idle:logo", type: "logo", view: { ...view, ...zoneName, stale: false } };
}

/**
 * The zone's name for a header logo, unless the zone hides it (`zone.show_name`, sheet 16: one
 * screen has nothing to tell apart). Only the header's: elsewhere the logo is the event's card.
 */
export function zoneNameOf(r: Region, state: ScreenState): { zone_name?: string } {
  const zone = state.zone;
  if (r.role !== "header" || zone === null || zone.show_name === false) return {};
  return { zone_name: zone.name };
}
