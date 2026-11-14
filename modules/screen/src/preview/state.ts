/**
 * A device's `ScreenState` while a preview on a screen runs on it, or on the device it mirrors
 * (contracts/screen.md, Zones and assignments: Preview on a screen). Composed from the preview's
 * zone, time and draft, at the live zone's `state_version` and epoch: a preview never moves the
 * zone's version, so every other screen of the zone keeps the live state.
 */
import type { TenantContext } from "@canccu/kit";
import { composeZone } from "../compose/state.js";
import type { ComposeDeps } from "../compose/state.js";
import { assemble, recordOf } from "../push/device-state.js";
import type { DeviceSide } from "../push/device-state.js";
import type { Orientation, ZoneRecord } from "../push/store.js";
import { dropDraft, runningPreview } from "./store.js";

/** What a stream keeps of the preview it draws: when to look again by itself. */
export interface RunningPreview {
  endsAt: number;
  themeKey: string | null;
  /** False while a key is kept but its read failed: the minute's read that succeeds redraws. */
  drawn: boolean;
}

export async function previewed(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  o: { owner: string; record: ZoneRecord; orientation: Orientation; side: DeviceSide },
): Promise<{ state: Record<string, unknown>; preview: RunningPreview } | null> {
  const row = await deps.db.tenant((c) => runningPreview(c, o.owner, o.side.nowMs));
  // A preview belongs to the zone it was started on; an assignment change ends it (assignments.ts).
  if (row === null || row.zone_key !== o.record.zone.key) return null;
  const composed = await composeZone(
    deps,
    ctx,
    host,
    row.zone_key,
    row.zone === null ? undefined : { ...row.zone, epoch: o.record.zone.epoch },
    true,
    { at: row.at?.getTime() ?? null, themeKey: row.theme_preview_key },
  );
  if (composed === null) return null;
  let themeKey = row.theme_preview_key;
  if (composed.draft === "gone" && themeKey !== null) {
    // Published, discarded or 12 hours old: the screen draws the theme in effect from now on.
    const dead = themeKey;
    await deps.db.tenant((c) => dropDraft(c, o.owner, dead));
    themeKey = null;
  }
  const state = assemble(recordOf(composed, o.record.version), o.orientation, o.side);
  return {
    state: {
      ...state,
      // A preview plays no sound.
      sound: { ...(state.sound as Record<string, unknown>), enabled: false },
      preview: {
        until: row.until?.toISOString() ?? null,
        at: row.at?.toISOString() ?? null,
        theme: composed.draft === "drawn",
      },
    },
    preview: { endsAt: row.ends_at.getTime(), themeKey, drawn: composed.draft === "drawn" },
  };
}
