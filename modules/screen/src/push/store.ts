/**
 * Each zone's composed state, its change log and the fan-out to every container's streams
 * (plan #109, S1 and S3). Containers keep no state: the state, its `state_version` and the last 5
 * minutes of changes live in Valkey, so a screen resumes on whichever container it reaches, and a
 * change published by one container reaches the streams that all the others hold.
 */
import { tenantKey } from "@canccu/kit";
import type { Valkey } from "iovalkey";
import type { RegionView } from "../compose/build.js";
import type { Display } from "../compose/display.js";

export type Orientation = "landscape" | "portrait";
export const ORIENTATIONS: readonly Orientation[] = ["landscape", "portrait"];

/** One SSE message: its `event:` name and its `data`. */
export interface Message {
  event: "state" | "widget" | "region" | "ticker" | "theme" | "command" | "ping";
  data: Record<string, unknown>;
}

/** What the zone's screens draw, the same for all of them; each device adds its own part. */
export interface ZoneRecord {
  version: number;
  /** Of the zone's inputs (compose/state.ts, zoneFingerprint): an equal one changes nothing. */
  fingerprint: string;
  zone: { key: string; name: string; epoch: string };
  eventName: string;
  theme: Record<string, unknown>;
  ticker: Record<string, unknown>;
  sound: { enabled: boolean; device_id: string | null };
  /** Absent in a record stored before it was added: screens then get the defaults. */
  display?: Display;
  views: Record<Orientation, ZoneRecordView>;
}

/** Where the zone's claims went; absent in a record stored before claims: none. */
export interface ZoneRecordView {
  layout: unknown;
  regions: RegionView[];
  placed?: { override_id: string; role: string }[];
  unplaced?: string[];
  hidden?: string[];
}

/** One change of the log: its messages per orientation, `null` where a whole `state` is sent. */
export interface Entry {
  version: number;
  epoch: string;
  messages: Record<Orientation, Message[] | null>;
}

/** How far back a screen can resume (contracts/screen.md, Resume). */
export const LOG_MS = 5 * 60_000;
// Long enough that a quiet zone keeps its count between events.
const STATE_TTL_MS = 400 * 24 * 3600_000;

/** In the current tenant's keys; a channel is no key, but it carries the tenant all the same. */
export const keys = {
  state: (zone: string) => tenantKey("screen", "zone", zone, "state"),
  log: (zone: string) => tenantKey("screen", "zone", zone, "log"),
  zoneChannel: (zone: string) => tenantKey("screen", "zone", zone, "changes"),
  deviceChannel: (device: string) => tenantKey("screen", "device", device, "nudges"),
};

export interface ZoneStore {
  read(zone: string): Promise<ZoneRecord | null>;
  /** The zone's `state_version`, 0 before its first state. */
  version(zone: string): Promise<number>;
  /**
   * Store `record` as version `expected + 1`, log `entry` and publish it on the zone's channel,
   * in one step, only while the stored version is still `expected`: of two containers that
   * built at once, one wins and the other reads the winner's state.
   */
  advance(zone: string, expected: number, record: ZoneRecord, entry: Entry): Promise<boolean>;
  /** The changes after `version`, oldest first; null unless the log holds every one of them. */
  since(zone: string, version: number): Promise<Entry[] | null>;
}

/** Messages to every container that subscribed to a channel, also the publisher's own. */
export interface Fanout {
  subscribe(channel: string, onMessage: (message: string) => void): () => void;
  publish(channel: string, message: string): Promise<void>;
}

function contiguous(entries: Entry[], after: number, current: number): Entry[] | null {
  if (after === current) return [];
  if (after > current) return null;
  const wanted = entries.filter((e) => e.version > after).sort((a, b) => a.version - b.version);
  const whole =
    wanted.length === current - after && wanted.every((e, i) => e.version === after + 1 + i);
  return whole ? wanted : null;
}

const ADVANCE = `
local current = tonumber(redis.call('HGET', KEYS[1], 'version') or '0')
if current ~= tonumber(ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], 'version', tonumber(ARGV[1]) + 1, 'record', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('XADD', KEYS[2], 'MINID', now - tonumber(ARGV[6]), '*', 'e', ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[6])
redis.call('PUBLISH', ARGV[4], ARGV[3])
return 1`;

export class ValkeyZoneStore implements ZoneStore {
  constructor(private readonly client: Valkey) {}

  async read(zone: string): Promise<ZoneRecord | null> {
    const raw = await this.client.hget(keys.state(zone), "record");
    return raw === null ? null : (JSON.parse(raw) as ZoneRecord);
  }
  async version(zone: string): Promise<number> {
    return Number((await this.client.hget(keys.state(zone), "version")) ?? 0);
  }
  async advance(
    zone: string,
    expected: number,
    record: ZoneRecord,
    entry: Entry,
  ): Promise<boolean> {
    const done = await this.client.eval(
      ADVANCE,
      2,
      keys.state(zone),
      keys.log(zone),
      expected,
      JSON.stringify(record),
      JSON.stringify(entry),
      keys.zoneChannel(zone),
      STATE_TTL_MS,
      LOG_MS,
    );
    return done === 1;
  }
  async since(zone: string, version: number): Promise<Entry[] | null> {
    // One transaction, so the version and the log are read at the same moment.
    const replies = await this.client
      .multi()
      .hget(keys.state(zone), "version")
      .xrange(keys.log(zone), "-", "+")
      .exec();
    const current = Number((replies?.[0]?.[1] as string | null) ?? 0);
    const rows = (replies?.[1]?.[1] as [string, string[]][] | undefined) ?? [];
    const entries = rows.map(([, fields]) => JSON.parse(fields[1] ?? "{}") as Entry);
    return contiguous(entries, version, current);
  }
}

/**
 * One subscriber connection per container (a connection in subscribe mode can do nothing else),
 * shared by its streams; a channel is subscribed while at least one stream listens on it.
 */
export class ValkeyFanout implements Fanout {
  private readonly listeners = new Map<string, Set<(message: string) => void>>();

  constructor(
    private readonly subscriber: Valkey,
    private readonly publisher: Valkey,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {
    subscriber.on("message", (channel: string, message: string) => {
      for (const listener of this.listeners.get(channel) ?? []) listener(message);
    });
  }

  subscribe(channel: string, onMessage: (message: string) => void): () => void {
    let set = this.listeners.get(channel);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(channel, set);
      this.subscriber.subscribe(channel).catch(this.onError);
    }
    set.add(onMessage);
    return () => {
      const current = this.listeners.get(channel);
      if (current === undefined || !current.delete(onMessage) || current.size > 0) return;
      this.listeners.delete(channel);
      this.subscriber.unsubscribe(channel).catch(this.onError);
    };
  }
  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }
}

export class MemoryFanout implements Fanout {
  private readonly listeners = new Map<string, Set<(message: string) => void>>();

  subscribe(channel: string, onMessage: (message: string) => void): () => void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(onMessage);
    this.listeners.set(channel, set);
    return () => {
      set.delete(onMessage);
    };
  }
  publish(channel: string, message: string): Promise<void> {
    for (const listener of this.listeners.get(channel) ?? []) listener(message);
    return Promise.resolve();
  }
  /** How many listen on a channel, for tests. */
  count(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0;
  }
}

/** The same rules in memory, for tests, with an injected clock for the log's 5 minutes. */
export class MemoryZoneStore implements ZoneStore {
  private readonly states = new Map<string, ZoneRecord>();
  private readonly logs = new Map<string, { at: number; entry: Entry }[]>();

  constructor(
    private readonly fanout: Fanout,
    private readonly now: () => number = Date.now,
  ) {}

  read(zone: string): Promise<ZoneRecord | null> {
    return Promise.resolve(this.states.get(keys.state(zone)) ?? null);
  }
  version(zone: string): Promise<number> {
    return Promise.resolve(this.states.get(keys.state(zone))?.version ?? 0);
  }
  async advance(
    zone: string,
    expected: number,
    record: ZoneRecord,
    entry: Entry,
  ): Promise<boolean> {
    if ((await this.version(zone)) !== expected) return false;
    this.states.set(keys.state(zone), record);
    const log = (this.logs.get(keys.log(zone)) ?? []).filter((e) => e.at >= this.now() - LOG_MS);
    log.push({ at: this.now(), entry });
    this.logs.set(keys.log(zone), log);
    await this.fanout.publish(keys.zoneChannel(zone), JSON.stringify(entry));
    return true;
  }
  async since(zone: string, version: number): Promise<Entry[] | null> {
    const log = (this.logs.get(keys.log(zone)) ?? []).filter((e) => e.at >= this.now() - LOG_MS);
    return contiguous(
      log.map((e) => e.entry),
      version,
      await this.version(zone),
    );
  }
}
