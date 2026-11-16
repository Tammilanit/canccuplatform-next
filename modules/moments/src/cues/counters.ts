/**
 * The flood guard's and the hourly budget's counts per zone, in Valkey with expiry (D15): a
 * restart of Moments loses no count, and every container counts the same. Keys come from the
 * kit's `tenantKey` only; the windows are whole minutes and hours of the server's clock, as the
 * sound desk shows them ("this minute", "this hour").
 */
import { Valkey } from "iovalkey";
import { tenantKey } from "@canccu/kit";

export interface Counters {
  /** The current values of `keys` (0 for a missing key). */
  get(keys: string[]): Promise<number[]>;
  /** Adds one and keeps the key `ttlMs` from its first count. */
  incr(key: string, ttlMs: number): Promise<number>;
  close(): Promise<void>;
}

export class ValkeyCounters implements Counters {
  constructor(private readonly client: Valkey) {}

  static fromUrl(url: string): ValkeyCounters {
    return new ValkeyCounters(new Valkey(url, { lazyConnect: false, maxRetriesPerRequest: 2 }));
  }

  async get(keys: string[]): Promise<number[]> {
    if (keys.length === 0) return [];
    const values = await this.client.mget(...keys);
    return values.map((v) => (v === null ? 0 : Number(v)));
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    const [[, n]] = (await this.client.multi().incr(key).pexpire(key, ttlMs, "NX").exec()) as [
      [unknown, number],
    ];
    return n;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A zone's counter keys at `nowMs`; only inside a tenant (the kit's `tenantKey`). */
export const soundKeys = {
  minute: (zone: string, nowMs: number) =>
    tenantKey("moments", "sound", zone, "m", String(Math.floor(nowMs / MINUTE))),
  hour: (zone: string, nowMs: number) =>
    tenantKey("moments", "sound", zone, "h", String(Math.floor(nowMs / HOUR))),
  ttl: { minute: 2 * MINUTE, hour: 2 * HOUR },
};
