/**
 * The flood guard's and the hourly budget's counts per zone, and the claims on an event every
 * container gets, in Valkey with expiry (D15): a
 * restart of Moments loses no count, and every container counts the same. Keys come from the
 * kit's `tenantKey` only; the windows are whole minutes and hours of the server's clock, as the
 * sound desk shows them ("this minute", "this hour").
 */
import { Valkey } from "iovalkey";
import { tenantKey } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { afterCommit } from "../db.js";

export interface Counters {
  /** The current values of `keys` (0 for a missing key). */
  get(keys: string[]): Promise<number[]>;
  /** Adds one and keeps the key `ttlMs` from its first count. */
  incr(key: string, ttlMs: number): Promise<number>;
  /** True when `owner` holds `key` now: it was free and is now `owner`'s for `ttlMs`, or it was already. */
  claim(key: string, owner: string, ttlMs: number): Promise<boolean>;
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

  async claim(key: string, owner: string, ttlMs: number): Promise<boolean> {
    if ((await this.client.set(key, owner, "PX", ttlMs, "NX")) === "OK") return true;
    return (await this.client.get(key)) === owner;
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

/**
 * The counts as the decisions of one transaction see them: Valkey's and the transaction's own,
 * which reach Valkey only once it commits, so a rollback, or a savepoint's, counts nothing (#657).
 * While Valkey does not answer, its counts are 0 and nothing is added: the sound, and the moment
 * it belongs to, go on (#592).
 */
export class TransactionCounts {
  private readonly uncommitted = new WeakMap<SqlClient, Map<string, number>>();

  constructor(private readonly counters: Counters) {}

  /** The zone's minute and hour at `at`, as a decision in `c` sees them. */
  async get(c: SqlClient, zone: string, at: number): Promise<[number, number]> {
    const keys = [soundKeys.minute(zone, at), soundKeys.hour(zone, at)];
    const [minute, hour] = await this.counters.get(keys).catch(() => [0, 0]);
    const own = this.uncommitted.get(c);
    return [
      (minute ?? 0) + (own?.get(keys[0] as string) ?? 0),
      (hour ?? 0) + (own?.get(keys[1] as string) ?? 0),
    ];
  }

  /** One sound in the zone's minute and hour. */
  add(c: SqlClient, zone: string, at: number): void {
    const keys: [string, number][] = [
      [soundKeys.minute(zone, at), soundKeys.ttl.minute],
      [soundKeys.hour(zone, at), soundKeys.ttl.hour],
    ];
    const own = this.uncommitted.get(c) ?? new Map<string, number>();
    this.uncommitted.set(c, own);
    const add = (n: number) => {
      for (const [key] of keys) own.set(key, (own.get(key) ?? 0) + n);
    };
    add(1);
    afterCommit(
      c,
      async () => {
        for (const [key, ttl] of keys) await this.counters.incr(key, ttl).catch(() => 0);
      },
      () => {
        add(-1);
      },
    );
  }
}
