/**
 * The open streams of one container, and what the bus tells them (plan #109, S2). Every
 * container reads every event (the bus has no consumer groups), so each rebuilds only the zones
 * its own streams show; the store's one-step advance makes the first build win and the others
 * find nothing new. Builds are coalesced for 100 ms, so a burst of events costs one build and the
 * change still reaches the screens well within the contract's second.
 */
import { tenantKey, withTenant } from "@canccu/kit";
import type { Event, Logger } from "@canccu/kit";
import { refreshZone } from "./device-state.js";
import type { Feed, StreamDeps } from "./feed.js";

export const COALESCE_MS = 100;
/**
 * Every zone with a stream is also rebuilt this often (in one container, by a claim): schedule
 * windows start and end, and settings change, with no event of their own, and an event may come
 * while no container read the bus.
 */
export const REFRESH_MS = 10_000;

/** Events after which a zone may draw something else. */
const REBUILDS = [
  "screen.zone.saved",
  "screen.ticker.changed",
  "screen.content.",
  "screen.photo.",
  "agenda.item.",
  "agenda.items.",
  "agenda.kind.",
  "tenants.tenant.changed",
  "tenants.status.changed",
  "tenants.venue_info.changed",
  "theming.theme.published",
  // Main hands these on only once src/compose/overrides.ts has kept them.
  "moments.override.",
];
/** The event's context changed: every stream checks its device again and may redraw. */
const RECHECKS = new Set([
  "tenants.tenant.changed",
  "tenants.status.changed",
  "tenants.venue_ip_check.changed",
  "tenants.venue.changed",
]);
/** The device no longer serves this event, or its token stopped: its streams end. */
const ENDS = new Set(["screen.device.revoked", "screen.device.released", "screen.device.moved"]);

export interface HubDeps extends StreamDeps {
  log?: Logger;
  /**
   * Forget the cached context of the event a `tenants` event is about (the kit's TenantResolver).
   * Its cache hears only the platform stream; these events come on the event's own stream, and a
   * rebuild or recheck from a cached context would see nothing new for up to 30 seconds.
   */
  tenantChanged(event: Event): void;
}

export class PushHub {
  private readonly streams = new Map<string, Set<Feed>>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private readonly dirty = new Set<string>();

  constructor(private readonly deps: HubDeps) {}

  add(stream: Feed): void {
    const set = this.streams.get(stream.tenant) ?? new Set();
    set.add(stream);
    this.streams.set(stream.tenant, set);
  }

  remove(stream: Feed): void {
    const set = this.streams.get(stream.tenant);
    set?.delete(stream);
    if (set?.size === 0) this.streams.delete(stream.tenant);
  }

  /** How many streams this container holds, for tests and logs. */
  get size(): number {
    let n = 0;
    for (const set of this.streams.values()) n += set.size;
    return n;
  }

  /** One event of the screen, agenda, tenants, theming or moments tenant streams. */
  handleEvent(event: Event): void {
    if (event.source === "tenants") this.deps.tenantChanged(event);
    const tenant = event.tenant;
    const streams = tenant === undefined ? undefined : this.streams.get(tenant);
    if (tenant === undefined || streams === undefined) return;
    const deviceId = event.data.device_id;
    if (ENDS.has(event.type)) {
      for (const s of [...streams]) if (s.deviceId === deviceId) s.end();
      return;
    }
    if (event.type === "screen.device.assigned" || event.type === "screen.zone.removed") {
      // A mirror of a device follows that device's zone, so every mirror looks again too.
      for (const s of streams) {
        if (s.deviceId === deviceId || s.mirror || s.zoneKey === event.data.zone_key) {
          void s.replace();
        }
      }
      return;
    }
    if (RECHECKS.has(event.type)) for (const s of streams) void s.refresh();
    if (!REBUILDS.some((p) => (p.endsWith(".") ? event.type.startsWith(p) : event.type === p))) {
      return;
    }
    const zone = event.type.startsWith("screen.zone.") ? event.data.zone_key : undefined;
    for (const key of this.zonesOf(tenant)) {
      if (zone === undefined || zone === key) this.schedule(tenant, key);
    }
  }

  /** Main runs it every REFRESH_MS. */
  async refreshAll(): Promise<void> {
    for (const tenant of [...this.streams.keys()]) {
      for (const zone of this.zonesOf(tenant)) {
        try {
          const claimed = await withTenant(tenant, () =>
            this.deps.kv.setIfAbsent(
              tenantKey("screen", "zone", zone, "refresh"),
              "1",
              REFRESH_MS - 500,
            ),
          );
          if (claimed) this.schedule(tenant, zone);
        } catch (err) {
          this.deps.log?.warn({ err, tenant_id: tenant, zone_key: zone }, "zone refresh failed");
        }
      }
    }
  }

  close(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const set of [...this.streams.values()]) for (const s of [...set]) s.end();
  }

  private zonesOf(tenant: string): Set<string> {
    const zones = new Set<string>();
    for (const s of this.streams.get(tenant) ?? []) if (s.zoneKey !== null) zones.add(s.zoneKey);
    return zones;
  }

  private schedule(tenant: string, zone: string): void {
    const key = `${tenant}\n${zone}`;
    if (this.pending.has(key)) return;
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.run(tenant, zone, key);
    }, COALESCE_MS);
    this.pending.set(key, timer);
  }

  private async run(tenant: string, zone: string, key: string): Promise<void> {
    // One build of a zone at a time; an event during it builds once more afterwards.
    if (this.running.has(key)) {
      this.dirty.add(key);
      return;
    }
    this.running.add(key);
    try {
      const stream = [...(this.streams.get(tenant) ?? [])].find((s) => s.zoneKey === zone);
      if (stream === undefined) return;
      const ctx = await this.deps.contextOf(stream.req.host);
      // A hostname that serves another event now builds nothing for this one.
      if (ctx === null || ctx.tenant_id !== tenant) return;
      await withTenant(tenant, () => refreshZone(this.deps, ctx, stream.req.host, zone));
    } catch (err) {
      this.deps.log?.warn({ err, tenant_id: tenant, zone_key: zone }, "zone rebuild failed");
    } finally {
      this.running.delete(key);
      if (this.dirty.delete(key)) this.schedule(tenant, zone);
    }
  }
}
