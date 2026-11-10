/**
 * Device health (contracts/screen.md, Devices: heartbeat and device health). All of it lives in
 * Valkey under the event's keys, so a heartbeat every 15 seconds from every screen writes nothing
 * to Postgres (docs/plans/issue-107.md, D6 and D11). A device is online until its deadline, the
 * last heartbeat plus `offline_after_seconds`; the deadlines sit in one set per event, which the
 * offline sweep empties as they pass.
 */
import { isTenantId, tenantKey, withTenant } from "@canccu/kit";
import type { Bus, Logger, SettingValue } from "@canccu/kit";
import type { Db } from "./db.js";
import type { Kv } from "./kv.js";

/** The settings client's reads that health needs (the kit's SettingsClient in main). */
export interface Settings {
  ensure(): Promise<void>;
  get(key: string, fallback: SettingValue): SettingValue;
}

export interface NowPlaying {
  region_id: string;
  widget: string;
  item_id: string | null;
  claim_id: string | null;
}

export interface Viewport {
  width: number;
  height: number;
}

/** A heartbeat as the route accepted it; times in epoch milliseconds. */
export interface Beat {
  state_version: number;
  bundle_version: string;
  theme_revision: number;
  now_playing: NowPlaying | null;
  audio_unlocked?: boolean;
  viewport?: Viewport;
  client_time?: number;
  rtt_ms?: number;
  instance_id?: string;
}

/** What the device's last heartbeat said, with what health has derived from it. */
interface HealthRecord {
  last_seen_ms: number;
  online_until_ms: number;
  now_playing: NowPlaying | null;
  /** The `now_playing` last announced in `playing_changed`, as JSON. */
  announced: string;
  // Kept for the state lag, which needs the zone's state version from the composed state (#109).
  state_version: number;
  bundle_version: string;
  theme_revision: number;
  audio_unlocked?: boolean;
  viewport?: Viewport;
  clock_offset_ms: number | null;
}

/** Long enough that admin still shows when a device was last seen after a weekend off. */
const RECORD_TTL_MS = 7 * 24 * 3600_000;
const PLAYING_QUIET_MS = 10_000;
const CLOCK_DRIFT_MS = 2_000;

const keys = {
  record: (id: string) => tenantKey("screen", "health", id),
  instances: (id: string) => tenantKey("screen", "health", id, "instances"),
  playingQuiet: (id: string) => tenantKey("screen", "health", id, "playing_quiet"),
  online: () => tenantKey("screen", "online"),
};

function seconds(value: SettingValue, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The current event's heartbeat interval and offline delay. The delay is at least two heartbeats,
 * so one late heartbeat never takes a screen offline, whatever the two settings say (#252).
 */
export function timing(settings: Settings): { heartbeatMs: number; offlineAfterMs: number } {
  const heartbeat = seconds(settings.get("heartbeat_seconds", 15), 15);
  const offlineAfter = seconds(settings.get("offline_after_seconds", 45), 45);
  return {
    heartbeatMs: heartbeat * 1000,
    offlineAfterMs: Math.max(offlineAfter, 2 * heartbeat) * 1000,
  };
}

async function readRecord(kv: Kv, id: string): Promise<HealthRecord | null> {
  const raw = await kv.get(keys.record(id));
  return raw === null ? null : (JSON.parse(raw) as HealthRecord);
}

/** The zone each device shows, for the events' `zone_key`; a mirror or an unassigned device has none. */
async function zonesOf(db: Db, ids: string[]): Promise<Map<string, string | null>> {
  const { rows } = await db.tenant((c) =>
    c.query("SELECT device_id, zone_key FROM screen_assignments WHERE device_id = ANY($1)", [ids]),
  );
  return new Map(rows.map((r) => [r.device_id as string, (r.zone_key as string | null) ?? null]));
}

export interface HealthDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  now: () => number;
  log?: Logger;
}

/** Keep one heartbeat of a device of the current event, and emit what changed. */
export async function recordHeartbeat(
  deps: HealthDeps & { settings: Settings },
  id: string,
  beat: Beat,
  receivedMs: number,
): Promise<void> {
  const { kv } = deps;
  const { heartbeatMs, offlineAfterMs } = timing(deps.settings);
  const before = await readRecord(kv, id);
  // A device showing nothing has nothing to announce until it shows something.
  const announcedBefore = before?.announced ?? "null";
  const playing = JSON.stringify(beat.now_playing);
  const announce =
    playing !== announcedBefore &&
    (await kv.setIfAbsent(keys.playingQuiet(id), "1", PLAYING_QUIET_MS));
  const record: HealthRecord = {
    last_seen_ms: receivedMs,
    online_until_ms: receivedMs + offlineAfterMs,
    now_playing: beat.now_playing,
    announced: announce ? playing : announcedBefore,
    state_version: beat.state_version,
    bundle_version: beat.bundle_version,
    theme_revision: beat.theme_revision,
    ...(beat.audio_unlocked === undefined ? {} : { audio_unlocked: beat.audio_unlocked }),
    ...(beat.viewport === undefined ? {} : { viewport: beat.viewport }),
    clock_offset_ms:
      beat.client_time === undefined
        ? (before?.clock_offset_ms ?? null)
        : Math.round(beat.client_time + (beat.rtt_ms ?? 0) / 2 - receivedMs),
  };
  await kv.set(keys.record(id), JSON.stringify(record), RECORD_TTL_MS);
  if (beat.instance_id !== undefined) {
    await kv.addExpiring(
      keys.instances(id),
      `${beat.instance_id}.${receivedMs}`,
      receivedMs + 2 * heartbeatMs,
    );
  }
  // New in the set only when the sweep took it out (or never saw it): it was offline until now.
  const cameOnline = await kv.addDue(keys.online(), id, record.online_until_ms);
  if (!cameOnline && !announce) return;
  const zoneKey = (await zonesOf(deps.db, [id])).get(id) ?? null;
  if (cameOnline) {
    await deps.bus.publish(
      "screen.device.online",
      { device_id: id, zone_key: zoneKey, last_seen_at: new Date(receivedMs).toISOString() },
      { version: 1 },
    );
  }
  if (announce) {
    await deps.bus.publish(
      "screen.device.playing_changed",
      { device_id: id, zone_key: zoneKey, now_playing: beat.now_playing },
      { version: 1 },
    );
  }
}

/**
 * Drop the current event's health of a device that has left it (moved away or deleted), so the
 * sweep never reports it offline there and a later return starts afresh.
 */
export async function forgetHealth(kv: Kv, id: string): Promise<void> {
  await kv.del(keys.record(id), keys.instances(id), keys.playingQuiet(id));
  await kv.removeMember(keys.online(), id);
}

/** Two page loads each reporting at least twice in the window: one token in two places. */
function sharedToken(members: string[]): boolean {
  const reports = new Map<string, number>();
  for (const member of members) {
    const instance = member.slice(0, member.indexOf("."));
    reports.set(instance, (reports.get(instance) ?? 0) + 1);
  }
  return [...reports.values()].filter((n) => n >= 2).length >= 2;
}

/** The contract's `DeviceHealth` of each of the current event's devices `ids`. */
export async function healthOf(
  kv: Kv,
  ids: string[],
  nowMs: number,
): Promise<Map<string, Record<string, unknown>>> {
  const views = await Promise.all(
    ids.map(async (id): Promise<[string, Record<string, unknown>]> => {
      const record = await readRecord(kv, id);
      if (record === null) {
        const none = {
          online: false,
          last_seen_at: null,
          now_playing: null,
          clock_offset_ms: null,
        };
        return [id, { ...none, flags: [] }];
      }
      const flags: string[] = [];
      const offset = record.clock_offset_ms;
      if (offset !== null && Math.abs(offset) > CLOCK_DRIFT_MS) flags.push("clock_drift");
      if (sharedToken(await kv.live(keys.instances(id), nowMs))) flags.push("shared_token");
      const view = {
        online: record.online_until_ms > nowMs,
        last_seen_at: new Date(record.last_seen_ms).toISOString(),
        now_playing: record.now_playing,
        bundle_version: record.bundle_version,
        theme_revision: record.theme_revision,
        ...(record.audio_unlocked === undefined ? {} : { audio_unlocked: record.audio_unlocked }),
        ...(record.viewport === undefined ? {} : { viewport: record.viewport }),
        clock_offset_ms: offset,
        flags,
      };
      return [id, view];
    }),
  );
  return new Map(views);
}

/**
 * Emit `screen.device.offline` for every device whose deadline has passed. Main runs it every 5
 * seconds in every container; `takeDue` hands each deadline to one caller only, so each offline
 * is emitted once with no lock between containers.
 */
export async function sweepOffline(deps: HealthDeps): Promise<void> {
  // An event whose last device left drops off this list; a deadline left in its set lapses with
  // the set (Kv.addDue), unswept, since that device now serves another event or none.
  const tenants = await deps.db.global(async (c) =>
    (
      await c.query(
        "SELECT DISTINCT current_tenant_id FROM devices WHERE current_tenant_id IS NOT NULL",
      )
    ).rows.map((r) => r.current_tenant_id as string),
  );
  for (const tenant of tenants.filter(isTenantId)) {
    try {
      await withTenant(tenant, async () => {
        const due = await deps.kv.takeDue(keys.online(), deps.now());
        if (due.length === 0) return;
        const zones = await zonesOf(deps.db, due);
        for (const id of due) {
          const record = await readRecord(deps.kv, id);
          await deps.bus.publish(
            "screen.device.offline",
            {
              device_id: id,
              zone_key: zones.get(id) ?? null,
              last_seen_at: record === null ? null : new Date(record.last_seen_ms).toISOString(),
            },
            { version: 1 },
          );
        }
      });
    } catch (err) {
      // One event's failure never holds back the others' offline events.
      deps.log?.warn({ err, tenant_id: tenant }, "offline sweep failed");
    }
  }
}
