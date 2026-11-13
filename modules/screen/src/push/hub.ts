/**
 * The open streams of one container, and what the bus tells them (plan #109, S2). Every
 * container reads every event (the bus has no consumer groups), so each rebuilds only the zones
 * its own streams show; the store's one-step advance makes the first build win and the others
 * find nothing new. Builds are coalesced for 100 ms, so a burst of events costs one build and the
 * change still reaches the screens well within the contract's second.
 */
import { platformKey, tenantKey, withTenant } from "@canccu/kit";
import type { Event, Logger } from "@canccu/kit";
import { PREVIEW_CHANNEL } from "../preview/store.js";
import { refreshZone } from "./device-state.js";
import type { Feed, StreamDeps } from "./feed.js";

export const COALESCE_MS = 100;
/**
 * Every zone with a stream is also rebuilt this often (in one container, by a claim): schedule
 * windows start and end, and settings change, with no event of their own, and an event may come
 * while no container read the bus.
 */
export const REFRESH_MS = 10_000;
/**
 * A container that lost a change's claim looks this long after the change whether the winner
 * built and planned on; a rebuild that failed is tried again this soon.
 */
export const FOLLOW_MS = 1000;
/**
 * The tick tells every container here which zones' playback it stored (PushHub.played). It spans
 * events, as the tick does, and carries a tenant id and zone keys only.
 */
const PLAYED_CHANNEL = platformKey("screen", "zone", "played");

/** Events after which a zone may draw something else. */
const REBUILDS = [
  "screen.zone.saved",
  "screen.ticker.changed",
  "screen.content.",
  "screen.photo.",
  "screen.pin.changed",
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
  /** By tenant and zone: the rebuild at the zone's next content change (a frame, a photo, a code). */
  private readonly changes = new Map<string, NodeJS.Timeout>();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: HubDeps) {
    const played = deps.fanout.subscribe(PLAYED_CHANNEL, (message) => {
      this.onPlayed(message);
    });
    const previews = deps.fanout.subscribe(PREVIEW_CHANNEL, (message) => {
      this.onPreview(message);
    });
    this.unsubscribe = () => {
      played();
      previews();
    };
  }

  add(stream: Feed): void {
    const set = this.streams.get(stream.tenant) ?? new Set();
    set.add(stream);
    this.streams.set(stream.tenant, set);
  }

  remove(stream: Feed): void {
    const set = this.streams.get(stream.tenant);
    set?.delete(stream);
    if (set?.size === 0) this.streams.delete(stream.tenant);
    // A planned change with no stream left here would still take the claim and then build nothing,
    // leaving a container that does hold a stream to wait for the refresh.
    const zone = stream.zoneKey;
    if (zone !== null && !this.zonesOf(stream.tenant).has(zone))
      this.plan(stream.tenant, zone, null);
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

  /**
   * The tick stored a change of these zones' playback (a push began or ended, a window or a break
   * switched). It writes after the event that caused it, so the rebuild that event started may
   * have read the old frame; every container hears this and rebuilds the zones its streams show.
   */
  played(tenant: string, zones: readonly string[]): void {
    if (zones.length === 0) return;
    this.deps.fanout
      .publish(PLAYED_CHANNEL, JSON.stringify({ tenant, zones }))
      .catch((err: unknown) => {
        this.deps.log?.warn({ err, tenant_id: tenant }, "zone playback notice failed");
      });
  }

  private onPlayed(message: string): void {
    let notice: { tenant?: unknown; zones?: unknown };
    try {
      notice = JSON.parse(message) as typeof notice;
    } catch {
      return;
    }
    const { tenant, zones } = notice;
    if (typeof tenant !== "string" || !Array.isArray(zones)) return;
    const held = this.zonesOf(tenant);
    for (const zone of zones)
      if (typeof zone === "string" && held.has(zone)) this.schedule(tenant, zone);
  }

  /**
   * A preview on a screen started, was replaced or ended on a device (src/preview/store.ts): its
   * streams and every mirror draw again, as after an assignment, each with one whole `state`.
   */
  private onPreview(message: string): void {
    let notice: { tenant?: unknown; device_id?: unknown };
    try {
      notice = JSON.parse(message) as typeof notice;
    } catch {
      return;
    }
    const { tenant, device_id: deviceId } = notice;
    if (typeof tenant !== "string" || typeof deviceId !== "string") return;
    for (const s of this.streams.get(tenant) ?? []) {
      if (s.deviceId === deviceId || s.mirror) void s.replace();
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
    this.unsubscribe();
    for (const timer of [...this.pending.values(), ...this.changes.values()]) clearTimeout(timer);
    this.pending.clear();
    this.changes.clear();
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
      const startedAt = this.now();
      const next = await withTenant(tenant, async () => {
        const record = await refreshZone(this.deps, ctx, stream.req.host, zone);
        const at = record?.nextChangeAt ?? null;
        // For the containers that lost this change's claim (see `follow`).
        await this.deps.kv.set(
          plannedKey(zone),
          JSON.stringify({ builtAt: startedAt, at } satisfies Planned),
          PLANNED_MS,
        );
        return at;
      });
      this.plan(tenant, zone, next);
    } catch (err) {
      this.deps.log?.warn({ err, tenant_id: tenant, zone_key: zone }, "zone rebuild failed");
      // Its screens would otherwise hold the last frame until the zone refresh.
      this.plan(tenant, zone, this.now() + FOLLOW_MS);
    } finally {
      this.running.delete(key);
      if (this.dirty.delete(key)) this.schedule(tenant, zone);
    }
  }

  /**
   * Rebuild the zone when its content next changes by itself: after each build here, and when a
   * stream is placed (its build was the stream's own). Every container with a stream on the zone
   * plans it; a claim on the instant hands the build to one of them.
   */
  plan(tenant: string, zone: string, at: number | null): void {
    const key = `${tenant}\n${zone}`;
    clearTimeout(this.changes.get(key));
    this.changes.delete(key);
    if (at === null) return;
    const delay = Math.max(0, at - this.now());
    const timer = setTimeout(() => {
      this.changes.delete(key);
      // Claim only for a zone this container still draws for (see `remove`).
      if (!this.zonesOf(tenant).has(zone)) return;
      void withTenant(tenant, () =>
        this.deps.kv.setIfAbsent(
          tenantKey("screen", "zone", zone, "change", String(at)),
          "1",
          REFRESH_MS,
        ),
      )
        .then((claimed) => {
          if (claimed) this.schedule(tenant, zone);
          else this.follow(tenant, zone, at);
        })
        .catch((err: unknown) => {
          this.deps.log?.warn({ err, tenant_id: tenant, zone_key: zone }, "zone change failed");
        });
    }, delay);
    this.changes.set(key, timer);
  }

  /**
   * After a lost claim, keep the zone planned here too: the winner may lose its last stream on
   * the zone or fail to build, and then no container would plan the change after it. Once the
   * winner has built, plan its next change; if it has not, build here.
   */
  private follow(tenant: string, zone: string, at: number): void {
    const key = `${tenant}\n${zone}`;
    // A plan made meanwhile (a build here) is newer than this change.
    if (this.changes.has(key)) return;
    const timer = setTimeout(() => {
      this.changes.delete(key);
      if (!this.zonesOf(tenant).has(zone)) return;
      void withTenant(tenant, () => this.deps.kv.get(plannedKey(zone)))
        .then((raw) => {
          if (this.changes.has(key)) return;
          const planned = raw === null ? null : (JSON.parse(raw) as Planned);
          if (planned !== null && planned.builtAt >= at) this.plan(tenant, zone, planned.at);
          else this.schedule(tenant, zone);
        })
        .catch((err: unknown) => {
          this.deps.log?.warn({ err, tenant_id: tenant, zone_key: zone }, "zone change failed");
        });
    }, FOLLOW_MS);
    this.changes.set(key, timer);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

/** The last build of a zone in any container: when it began, and the change it planned. */
interface Planned {
  builtAt: number;
  at: number | null;
}

/** Outlives the follow-up's look by far; a later build writes it again. */
const PLANNED_MS = 60_000;

function plannedKey(zone: string): string {
  return tenantKey("screen", "zone", zone, "planned");
}
