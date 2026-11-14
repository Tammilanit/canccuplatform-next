/**
 * A zone's state through the store, and a device's `ScreenState` from it (contracts/screen.md,
 * Composed state). Every read and every push goes through `refreshZone`, so `state_version`
 * moves once per change, whichever container or request saw the change first.
 */
import { isDeepStrictEqual } from "node:util";
import type { TenantContext } from "@canccu/kit";
import type { DeviceRow } from "../db.js";
import { NO_THEME, composeZone, isPortrait, placement, themeView } from "../compose/state.js";
import type { ComposeDeps, ZoneComposed } from "../compose/state.js";
import { NO_DISPLAY } from "../compose/display.js";
import { themeFor } from "../pins/look.js";
import { readPin } from "../pins/store.js";
import { previewed } from "../preview/state.js";
import type { RunningPreview } from "../preview/state.js";
import { previewChanged } from "../preview/store.js";
import { diffZone } from "./diff.js";
import type { Orientation, ZoneRecord, ZoneRecordView } from "./store.js";

/** A composed zone as the store keeps it, at `version`. */
export function recordOf(composed: ZoneComposed, version: number): ZoneRecord {
  const view = (o: Orientation): ZoneRecordView => {
    const { layout, regions, placed, unplaced, hidden } = composed.views[o];
    return { layout, regions, placed, unplaced, hidden };
  };
  return {
    version,
    fingerprint: composed.fingerprint,
    zone: {
      key: composed.zone.key,
      name: composed.zone.name,
      epoch: composed.zone.epoch,
      show_name: composed.showName,
    },
    eventName: composed.eventName,
    theme: themeView(composed.theme),
    bundle: composed.bundle,
    ticker: composed.ticker,
    sound: { enabled: composed.zone.sound.enabled, device_id: composed.zone.sound.device_id },
    display: composed.display,
    views: { landscape: view("landscape"), portrait: view("portrait") },
    nextChangeAt: composed.nextChangeAt,
  };
}

/** A lost advance builds again; past this many the zone refresh (10 s) takes over. */
const ADVANCE_TRIES = 3;

/**
 * Compose the zone now and, when its inputs changed, store the next version and publish the
 * change; null when the zone does not exist. The answer is always freshly built (the clock,
 * cycles), at the version in effect.
 */
export async function refreshZone(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  zoneKey: string,
): Promise<ZoneRecord | null> {
  for (let attempt = 1; ; attempt++) {
    // Read before composing: a build from older inputs must not overwrite a newer one (advance
    // refuses once the version moved on).
    const before = await deps.zones.read(zoneKey);
    const composed = await composeZone(deps, ctx, host, zoneKey);
    if (composed === null) return null;
    const base = before?.version ?? 0;
    if (
      before !== null &&
      before.fingerprint === composed.fingerprint &&
      before.zone.epoch === composed.zone.epoch
    ) {
      return recordOf(composed, base);
    }
    const next = recordOf(composed, base + 1);
    const entry = {
      version: base + 1,
      epoch: composed.zone.epoch,
      messages: {
        landscape: diffZone(before, next, "landscape", base + 1),
        portrait: diffZone(before, next, "portrait", base + 1),
      },
    };
    if (await deps.zones.advance(zoneKey, base, next, entry)) {
      // Best effort, and errors are caught inside: a slow bus must not hold up the state.
      void reportClaims(deps, zoneKey, before, next);
      return next;
    }
    // Another container stored a change meanwhile, perhaps built from older inputs than these
    // (it read them first and finished first): build again on top of it, so a newer change is
    // never left waiting for the next refresh.
    if (attempt === ADVANCE_TRIES) return (await deps.zones.read(zoneKey)) ?? next;
  }
}

/** What `screen.claims.changed` says of a record: its landscape placement (see reportClaims). */
function claimsOf(record: ZoneRecord | null): Record<string, unknown> {
  const view = record?.views.landscape;
  return { placed: view?.placed ?? [], unplaced: view?.unplaced ?? [], hidden: view?.hidden ?? [] };
}

/**
 * Tell Moments where its claims went when that changed (contracts/screen.md, Events). Only the
 * container whose advance won reports, so a change is told once. The event has no orientation:
 * it reports the landscape layout, the primary target (L9); a portrait screen of the zone may
 * place a claim lower in its chain. A lost report is logged, not retried: the next change of
 * the zone's placement reports the whole of it again.
 */
async function reportClaims(
  deps: ComposeDeps,
  zoneKey: string,
  before: ZoneRecord | null,
  next: ZoneRecord,
): Promise<void> {
  const now = claimsOf(next);
  if (deps.bus === undefined || isDeepStrictEqual(claimsOf(before), now)) return;
  try {
    await deps.bus.publish("screen.claims.changed", { zone_key: zoneKey, ...now }, { version: 1 });
  } catch (err) {
    deps.log?.warn({ err, zone_key: zoneKey }, "reporting the zone's claims failed");
  }
}

export interface DeviceSide {
  nowMs: number;
  ctx: TenantContext;
  device: Pick<DeviceRow, "id" | "name">;
  mirror: boolean;
  bundleVersion: string;
  /** Only for a device without a zone: the theme, the event's name and the pinned bundle. */
  fallback?: { theme: Record<string, unknown>; eventName: string; bundle: string | null };
}

/** The `ScreenState` of one device: the zone's part, and its own `device` and `sound`. */
export function assemble(
  record: ZoneRecord | null,
  orientation: Orientation,
  side: DeviceSide,
): Record<string, unknown> {
  const view = record?.views[orientation];
  const eventName = record?.eventName ?? side.fallback?.eventName ?? "";
  const sound = record?.sound;
  return {
    state_version: record?.version ?? 0,
    time: new Date(side.nowMs).toISOString(),
    tenant: {
      id: side.ctx.tenant_id,
      name: eventName,
      time_zone: side.ctx.time_zone,
      status: side.ctx.status,
    },
    device: { id: side.device.id, name: side.device.name, mirror: side.mirror },
    zone: record?.zone ?? null,
    bundle: { version: record?.bundle ?? side.fallback?.bundle ?? side.bundleVersion },
    theme: record?.theme ?? side.fallback?.theme ?? themeView(NO_THEME),
    layout: view?.layout ?? null,
    regions: view?.regions ?? [],
    unplaced: view?.unplaced ?? [],
    hidden: view?.hidden ?? [],
    ticker: record?.ticker ?? { text: null, until: null, source: null },
    // Only the zone's sound device plays sound; a mirror never does (contracts/screen.md, Zones).
    sound: {
      enabled: !side.mirror && sound?.enabled === true && sound.device_id === side.device.id,
      // Kept for Moments (step 4): the heartbeat's claims_sounded are dropped until then.
      sounded_claims: [],
    },
    prefetch: [],
    offline: { marker_after_seconds: 10 },
    display: record?.display ?? NO_DISPLAY,
  };
}

export interface Placed {
  zoneKey: string | null;
  mirror: boolean;
  orientation: Orientation;
  record: ZoneRecord | null;
  state: Record<string, unknown>;
  /** The preview on a screen the state was composed from, or null for the live zone. */
  preview: RunningPreview | null;
  /** False when a resume could hand the screen the wrong state (a preview changed lately). */
  resumable: boolean;
}

/** Where the device is, its zone's state brought up to date, and its `ScreenState`. */
export async function placeDevice(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  device: Pick<DeviceRow, "id" | "name">,
): Promise<Placed> {
  const nowMs = (deps.now ?? Date.now)();
  const where = await deps.db.tenant((c) => placement(c, device.id));
  const record = where.zoneKey === null ? null : await refreshZone(deps, ctx, host, where.zoneKey);
  const orientation = (await isPortrait(deps.kv, device.id, nowMs)) ? "portrait" : "landscape";
  const pin = record === null ? await deps.db.tenant(readPin) : null;
  const fallback =
    pin === null
      ? undefined
      : {
          theme: themeView((await themeFor(deps.sources, ctx.tenant_id, pin)) ?? NO_THEME),
          eventName: (await deps.sources.event(host))?.name ?? "",
          bundle: pin.bundle_version,
        };
  const side = { nowMs, ctx, device, mirror: where.mirror, bundleVersion: deps.bundleVersion };
  // A mirror of a device shows what the device shows, its preview too; a zone's mirror the live zone.
  const owner = where.mirror ? where.mirrorOf : device.id;
  const shown =
    record === null || owner === null
      ? null
      : await previewed(deps, ctx, host, { owner, record, orientation, side });
  const changed = owner !== null && (await previewChanged(deps.kv, owner).catch(() => true));
  return {
    zoneKey: record === null ? null : where.zoneKey,
    mirror: where.mirror,
    orientation,
    record,
    state:
      shown?.state ?? assemble(record, orientation, { ...side, ...(fallback ? { fallback } : {}) }),
    preview: shown?.preview ?? null,
    resumable: shown === null && !changed,
  };
}
