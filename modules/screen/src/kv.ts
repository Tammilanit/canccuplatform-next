/**
 * The short-lived state the module keeps in Valkey (pairing codes, open-code counts, commands, device
 * health), behind a
 * small interface so tests run without Valkey. Keys come from the kit's `tenantKey` only.
 */
import { Valkey } from "iovalkey";

export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Set only when the key is free; false when it was taken. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Read and delete at once, so only one caller ever gets the value. */
  take(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<void>;
  /** Delete the key only while it still holds `value`, in one step; true when it was deleted. */
  delIfEquals(key: string, value: string): Promise<boolean>;
  /** A set whose members expire one by one (a sorted set scored by expiry). */
  addExpiring(key: string, member: string, expiresAtMs: number): Promise<void>;
  /** The members not yet expired at `nowMs`; expired ones are dropped first. */
  live(key: string, nowMs: number): Promise<string[]>;
  removeMember(key: string, member: string): Promise<void>;
  /** The members not yet expired at `nowMs`, and the set cleared, at once: one caller gets each. */
  takeLive(key: string, nowMs: number): Promise<string[]>;
  /**
   * A member falls due at `dueAtMs`; true when it was not in the set. Unlike `addExpiring`, a due
   * member stays until `takeDue` takes it, so whoever sweeps sees every one.
   */
  addDue(key: string, member: string, dueAtMs: number): Promise<boolean>;
  /** The members due at `nowMs`, removed at once: one caller gets each. */
  takeDue(key: string, nowMs: number): Promise<string[]>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const DUE_SET_GRACE_MS = 24 * 3600_000;

/** Sorted sets hold a few open codes at most; they expire with their newest member. */
export class ValkeyKv implements Kv {
  constructor(private readonly client: Valkey) {}

  static fromUrl(url: string): ValkeyKv {
    const client = new Valkey(url, { maxRetriesPerRequest: 2 });
    // Without a listener a lost connection is an unhandled error event; /health reports it.
    client.on("error", () => undefined);
    return new ValkeyKv(client);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(key, value, "PX", ttlMs);
  }
  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.client.set(key, value, "PX", ttlMs, "NX")) === "OK";
  }
  async take(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }
  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }
  async delIfEquals(key: string, value: string): Promise<boolean> {
    const deleted = await this.client.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      key,
      value,
    );
    return deleted === 1;
  }
  async addExpiring(key: string, member: string, expiresAtMs: number): Promise<void> {
    await this.client.zadd(key, expiresAtMs, member);
    await this.client.pexpireat(key, expiresAtMs, "GT");
    await this.client.pexpireat(key, expiresAtMs, "NX");
  }
  async live(key: string, nowMs: number): Promise<string[]> {
    await this.client.zremrangebyscore(key, "-inf", nowMs);
    return this.client.zrange(key, 0, -1);
  }
  async removeMember(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }
  async takeLive(key: string, nowMs: number): Promise<string[]> {
    const replies = await this.client
      .multi()
      .zremrangebyscore(key, "-inf", nowMs)
      .zrange(key, 0, -1)
      .del(key)
      .exec();
    return (replies?.[1]?.[1] as string[] | undefined) ?? [];
  }
  async addDue(key: string, member: string, dueAtMs: number): Promise<boolean> {
    const added = await this.client.zadd(key, dueAtMs, member);
    // A set nobody sweeps any more (its event has no device left) goes after a day.
    await this.client.pexpireat(key, dueAtMs + DUE_SET_GRACE_MS, "GT");
    await this.client.pexpireat(key, dueAtMs + DUE_SET_GRACE_MS, "NX");
    return added === 1;
  }
  async takeDue(key: string, nowMs: number): Promise<string[]> {
    const replies = await this.client
      .multi()
      .zrangebyscore(key, "-inf", nowMs)
      .zremrangebyscore(key, "-inf", nowMs)
      .exec();
    return (replies?.[0]?.[1] as string[] | undefined) ?? [];
  }
  async ping(): Promise<void> {
    await this.client.ping();
  }
  async close(): Promise<void> {
    await this.client.quit();
  }
}

/** In-memory Kv for tests, with an injected clock so expiry is testable. */
export class MemoryKv implements Kv {
  private readonly values = new Map<string, { value: string; until: number }>();
  private readonly sets = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<string | null> {
    const hit = this.values.get(key);
    if (hit === undefined || hit.until <= this.now()) {
      this.values.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(hit.value);
  }
  set(key: string, value: string, ttlMs: number): Promise<void> {
    this.values.set(key, { value, until: this.now() + ttlMs });
    return Promise.resolve();
  }
  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }
  async take(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.values.delete(key);
    return value;
  }
  async delIfEquals(key: string, value: string): Promise<boolean> {
    if ((await this.get(key)) !== value) return false;
    this.values.delete(key);
    return true;
  }
  del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.values.delete(key);
      this.sets.delete(key);
    }
    return Promise.resolve();
  }
  addExpiring(key: string, member: string, expiresAtMs: number): Promise<void> {
    const set = this.sets.get(key) ?? new Map<string, number>();
    set.set(member, expiresAtMs);
    this.sets.set(key, set);
    return Promise.resolve();
  }
  live(key: string, nowMs: number): Promise<string[]> {
    const set = this.sets.get(key) ?? new Map<string, number>();
    for (const [member, until] of set) if (until <= nowMs) set.delete(member);
    return Promise.resolve([...set.keys()]);
  }
  removeMember(key: string, member: string): Promise<void> {
    this.sets.get(key)?.delete(member);
    return Promise.resolve();
  }
  async takeLive(key: string, nowMs: number): Promise<string[]> {
    const members = await this.live(key, nowMs);
    this.sets.delete(key);
    return members;
  }
  addDue(key: string, member: string, dueAtMs: number): Promise<boolean> {
    const set = this.sets.get(key) ?? new Map<string, number>();
    const added = !set.has(member);
    set.set(member, dueAtMs);
    this.sets.set(key, set);
    return Promise.resolve(added);
  }
  takeDue(key: string, nowMs: number): Promise<string[]> {
    const due: string[] = [];
    for (const [member, at] of this.sets.get(key) ?? []) {
      if (at > nowMs) continue;
      due.push(member);
      this.sets.get(key)?.delete(member);
    }
    return Promise.resolve(due);
  }
  ping(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
