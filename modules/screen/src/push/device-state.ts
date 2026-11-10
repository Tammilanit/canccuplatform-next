/**
 * A zone's state through the store, and a device's `ScreenState` from it (contracts/screen.md,
 * Composed state). Every read and every push goes through `refreshZone`, so `state_version`
 * moves once per change, whichever container or request saw the change first.
 */
import type { TenantContext } from "@canccu/kit";
import type { DeviceRow } from "../db.js";
import { NO_THEME, composeZone, isPortrait, placement, themeView } from "../compose/state.js";
import type { ComposeDeps, ZoneComposed } from "../compose/state.js";
import { diffZone } from "./diff.js";
import type { Orientation, ZoneRecord } from "./store.js";

function recordOf(composed: ZoneComposed, version: number): ZoneRecord {
  const view = (o: Orientation) => ({
    layout: composed.views[o].layout,
    regions: composed.views[o].regions,
  });
  return {
    version,
    fingerprint: composed.fingerprint,
    zone: { key: composed.zone.key, name: composed.zone.name, epoch: composed.zone.epoch },
    eventName: composed.eventName,
    theme: themeView(composed.theme),
    ticker: composed.ticker,
    sound: { enabled: composed.zone.sound.enabled, device_id: composed.zone.sound.device_id },
    views: { landscape: view("landscape"), portrait: view("portrait") },
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
    if (await deps.zones.advance(zoneKey, base, next, entry)) return next;
    // Another container stored a change meanwhile, perhaps built from older inputs than these
    // (it read them first and finished first): build again on top of it, so a newer change is
    // never left waiting for the next refresh.
    if (attempt === ADVANCE_TRIES) return (await deps.zones.read(zoneKey)) ?? next;
  }
}

export interface DeviceSide {
  nowMs: number;
  ctx: TenantContext;
  device: Pick<DeviceRow, "id" | "name">;
  mirror: boolean;
  bundleVersion: string;
  /** Only for a device without a zone: the theme and the event's name it shows. */
  fallback?: { theme: Record<string, unknown>; eventName: string };
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
    bundle: { version: side.bundleVersion },
    theme: record?.theme ?? side.fallback?.theme ?? themeView(NO_THEME),
    layout: view?.layout ?? null,
    regions: view?.regions ?? [],
    unplaced: [],
    hidden: [],
    ticker: record?.ticker ?? { text: null, until: null, source: null },
    // Only the zone's sound device plays sound; a mirror never does (contracts/screen.md, Zones).
    sound: {
      enabled: !side.mirror && sound?.enabled === true && sound.device_id === side.device.id,
      // Kept for Moments (step 4): the heartbeat's claims_sounded are dropped until then.
      sounded_claims: [],
    },
    prefetch: [],
    offline: { marker_after_seconds: 10 },
  };
}

export interface Placed {
  zoneKey: string | null;
  mirror: boolean;
  orientation: Orientation;
  record: ZoneRecord | null;
  state: Record<string, unknown>;
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
  const fallback =
    record === null
      ? {
          theme: themeView((await deps.sources.theme(host)) ?? NO_THEME),
          eventName: (await deps.sources.event(host))?.name ?? "",
        }
      : undefined;
  const side = { nowMs, ctx, device, mirror: where.mirror, bundleVersion: deps.bundleVersion };
  return {
    zoneKey: record === null ? null : where.zoneKey,
    mirror: where.mirror,
    orientation,
    record,
    state: assemble(record, orientation, { ...side, ...(fallback ? { fallback } : {}) }),
  };
}
