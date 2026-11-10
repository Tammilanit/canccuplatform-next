/**
 * The fair render queue in Valkey (contracts/screen.md, The PPTX render job; plan #184, R8):
 * each event's waiting jobs in its own list, a ring of the events that have any, and one renderer
 * slot. A take serves the event at the head of the ring and moves it to the back, so an event
 * waits behind at most one job of each other event, never behind another's backlog. The one
 * renderer draws one deck at a time, so one slot also means one running job per event.
 *
 * Postgres holds the truth (`screen_render_jobs`); these keys only order it and are rebuilt from
 * it (`reconcile` in jobs.ts). Members of the global sets are `<tenant>/<job id>`; neither id can
 * hold a `/`.
 */
import { isTenantId, platformKey, tenantKey, withTenant } from "@canccu/kit";
import type { Valkey } from "iovalkey";

export interface QueuedJob {
  tenant: string;
  jobId: string;
}

export interface RenderQueue {
  /** Adds the job to its event's list once (at the head for a requeue) and the event to the ring. */
  enqueue(
    tenant: string,
    jobId: string,
    submittedMs: number,
    opts?: { head?: boolean },
  ): Promise<void>;
  /** The next job in turn, holding the slot for `leaseMs`; null while the slot is busy or nothing waits. */
  take(leaseMs: number, nowMs: number): Promise<QueuedJob | null>;
  /** Extends the slot and the lease of the job that holds it; false when another job holds it. */
  renew(tenant: string, jobId: string, leaseMs: number, nowMs: number): Promise<boolean>;
  /** Frees the slot if this job holds it, and forgets its lease. */
  release(tenant: string, jobId: string): Promise<void>;
  /** Drops a waiting job (cancelled, or its deck deleted). */
  remove(tenant: string, jobId: string): Promise<void>;
  /**
   * Watches a running job's lease without the slot: a job whose container could not record its
   * end is recovered by `expiredLeases` once `untilMs` passes.
   */
  watch(tenant: string, jobId: string, untilMs: number): Promise<void>;
  /** Each waiting job's place, 1 for the job taken next; a job not waiting is left out. */
  positions(tenant: string, jobIds: string[]): Promise<Map<string, number>>;
  /** The submit time of the longest-waiting job of any event, for the `render` health check. */
  oldestWaiting(): Promise<number | null>;
  /** The jobs whose lease ran out by `nowMs`, each handed out once (plan #184, R11). */
  expiredLeases(nowMs: number): Promise<QueuedJob[]>;
}

/**
 * The fair-turn arithmetic: a job at index `i` of its event's list is taken in round `i`, after
 * up to `i` jobs of every other event, plus one more of each event ahead of it in the ring.
 */
function fairPosition(
  ring: string[],
  lengths: Map<string, number>,
  tenant: string,
  index: number,
): number {
  const at = ring.indexOf(tenant);
  let ahead = index;
  ring.forEach((other, i) => {
    if (other !== tenant) ahead += Math.min(lengths.get(other) ?? 0, index + (i < at ? 1 : 0));
  });
  return ahead + 1;
}

const member = (tenant: string, jobId: string): string => `${tenant}/${jobId}`;

function parseMember(value: string): QueuedJob | null {
  const [tenant, jobId] = value.split("/");
  return tenant && jobId && isTenantId(tenant) ? { tenant, jobId } : null;
}

/**
 * Cross-event keys: the ring and the slot span every event by design (0013 item 27). They hold
 * ids and times only, never an event's content.
 */
const RING = platformKey("screen", "render", "ring");
const SLOT = platformKey("screen", "render", "slot");
const WAITING = platformKey("screen", "render", "waiting");
const LEASES = platformKey("screen", "render", "leases");

const queueKey = (tenant: string): string =>
  withTenant(tenant, () => tenantKey("screen", "render", "queue"));

const ENQUEUE = `
if not redis.call('LPOS', KEYS[3], ARGV[2]) then
  if ARGV[4] == '1' then redis.call('LPUSH', KEYS[3], ARGV[2]) else redis.call('RPUSH', KEYS[3], ARGV[2]) end
end
if not redis.call('LPOS', KEYS[1], ARGV[1]) then redis.call('RPUSH', KEYS[1], ARGV[1]) end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1] .. '/' .. ARGV[2])
return 1`;

// KEYS: slot, ring, waiting, leases, then one list per tenant of ARGV[3..]. An event that joined
// the ring after the caller read it has no key here: it is passed over and served next time.
const TAKE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return false end
local queues = {}
for i = 3, #ARGV do queues[ARGV[i]] = KEYS[i + 2] end
for _ = 1, redis.call('LLEN', KEYS[2]) do
  local t = redis.call('LINDEX', KEYS[2], 0)
  local q = queues[t]
  if q == nil then
    redis.call('LMOVE', KEYS[2], KEYS[2], 'LEFT', 'RIGHT')
  else
    redis.call('LPOP', KEYS[2])
    local job = redis.call('LPOP', q)
    if job then
      if redis.call('LLEN', q) > 0 then redis.call('RPUSH', KEYS[2], t) end
      local m = t .. '/' .. job
      redis.call('SET', KEYS[1], m, 'PX', ARGV[1])
      redis.call('ZREM', KEYS[3], m)
      redis.call('ZADD', KEYS[4], tonumber(ARGV[2]) + tonumber(ARGV[1]), m)
      return {t, job}
    end
  end
end
return false`;

const RENEW = `
local held = redis.call('GET', KEYS[1])
if held == ARGV[1] or (not held and redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')) then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  redis.call('ZADD', KEYS[2], tonumber(ARGV[3]) + tonumber(ARGV[2]), ARGV[1])
  return 1
end
return 0`;

const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
redis.call('ZREM', KEYS[2], ARGV[1])
return 1`;

const REMOVE = `
redis.call('LREM', KEYS[3], 0, ARGV[2])
if redis.call('LLEN', KEYS[3]) == 0 then redis.call('LREM', KEYS[1], 0, ARGV[1]) end
redis.call('ZREM', KEYS[2], ARGV[1] .. '/' .. ARGV[2])
return 1`;

export class ValkeyRenderQueue implements RenderQueue {
  constructor(private readonly client: Valkey) {}

  async enqueue(
    tenant: string,
    jobId: string,
    submittedMs: number,
    opts: { head?: boolean } = {},
  ): Promise<void> {
    await this.client.eval(
      ENQUEUE,
      3,
      RING,
      WAITING,
      queueKey(tenant),
      tenant,
      jobId,
      submittedMs,
      opts.head ? "1" : "0",
    );
  }

  async take(leaseMs: number, nowMs: number): Promise<QueuedJob | null> {
    const tenants = [...new Set(await this.client.lrange(RING, 0, -1))].filter(isTenantId);
    const keys = [SLOT, RING, WAITING, LEASES, ...tenants.map(queueKey)];
    const taken = (await this.client.eval(
      TAKE,
      keys.length,
      ...keys,
      leaseMs,
      nowMs,
      ...tenants,
    )) as [string, string] | null;
    return taken === null ? null : { tenant: taken[0], jobId: taken[1] };
  }

  async renew(tenant: string, jobId: string, leaseMs: number, nowMs: number): Promise<boolean> {
    const ok = await this.client.eval(
      RENEW,
      2,
      SLOT,
      LEASES,
      member(tenant, jobId),
      leaseMs,
      nowMs,
    );
    return ok === 1;
  }

  async release(tenant: string, jobId: string): Promise<void> {
    await this.client.eval(RELEASE, 2, SLOT, LEASES, member(tenant, jobId));
  }

  async remove(tenant: string, jobId: string): Promise<void> {
    await this.client.eval(REMOVE, 3, RING, WAITING, queueKey(tenant), tenant, jobId);
  }

  async watch(tenant: string, jobId: string, untilMs: number): Promise<void> {
    await this.client.zadd(LEASES, untilMs, member(tenant, jobId));
  }

  async positions(tenant: string, jobIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (jobIds.length === 0) return out;
    const own = await this.client.lrange(queueKey(tenant), 0, -1);
    const ring = (await this.client.lrange(RING, 0, -1)).filter(isTenantId);
    const lengths = new Map<string, number>();
    for (const t of ring) lengths.set(t, await this.client.llen(queueKey(t)));
    for (const id of jobIds) {
      const index = own.indexOf(id);
      if (index >= 0) out.set(id, fairPosition(ring, lengths, tenant, index));
    }
    return out;
  }

  async oldestWaiting(): Promise<number | null> {
    const [, score] = await this.client.zrange(WAITING, 0, 0, "WITHSCORES");
    return score === undefined ? null : Number(score);
  }

  async expiredLeases(nowMs: number): Promise<QueuedJob[]> {
    const replies = await this.client
      .multi()
      .zrangebyscore(LEASES, "-inf", nowMs)
      .zremrangebyscore(LEASES, "-inf", nowMs)
      .exec();
    const members = (replies?.[0]?.[1] as string[] | undefined) ?? [];
    return members.map(parseMember).filter((m): m is QueuedJob => m !== null);
  }
}

/** The same queue in memory, for tests. */
export class MemoryRenderQueue implements RenderQueue {
  private ring: string[] = [];
  private readonly queues = new Map<string, string[]>();
  private slot: { member: string; until: number } | null = null;
  private readonly waiting = new Map<string, number>();
  private readonly leases = new Map<string, number>();

  private list(tenant: string): string[] {
    const list = this.queues.get(tenant) ?? [];
    this.queues.set(tenant, list);
    return list;
  }

  enqueue(
    tenant: string,
    jobId: string,
    submittedMs: number,
    opts: { head?: boolean } = {},
  ): Promise<void> {
    const list = this.list(tenant);
    if (!list.includes(jobId)) {
      if (opts.head) list.unshift(jobId);
      else list.push(jobId);
    }
    if (!this.ring.includes(tenant)) this.ring.push(tenant);
    this.waiting.set(member(tenant, jobId), submittedMs);
    return Promise.resolve();
  }

  take(leaseMs: number, nowMs: number): Promise<QueuedJob | null> {
    if (this.slot !== null && this.slot.until > nowMs) return Promise.resolve(null);
    for (const tenant of [...this.ring]) {
      this.ring.shift();
      const jobId = this.list(tenant).shift();
      if (jobId === undefined) continue;
      if (this.list(tenant).length > 0) this.ring.push(tenant);
      const m = member(tenant, jobId);
      this.slot = { member: m, until: nowMs + leaseMs };
      this.waiting.delete(m);
      this.leases.set(m, nowMs + leaseMs);
      return Promise.resolve({ tenant, jobId });
    }
    return Promise.resolve(null);
  }

  renew(tenant: string, jobId: string, leaseMs: number, nowMs: number): Promise<boolean> {
    const m = member(tenant, jobId);
    const free = this.slot === null || this.slot.until <= nowMs;
    if (!free && this.slot?.member !== m) return Promise.resolve(false);
    this.slot = { member: m, until: nowMs + leaseMs };
    this.leases.set(m, nowMs + leaseMs);
    return Promise.resolve(true);
  }

  release(tenant: string, jobId: string): Promise<void> {
    const m = member(tenant, jobId);
    if (this.slot?.member === m) this.slot = null;
    this.leases.delete(m);
    return Promise.resolve();
  }

  remove(tenant: string, jobId: string): Promise<void> {
    const list = this.list(tenant).filter((j) => j !== jobId);
    this.queues.set(tenant, list);
    if (list.length === 0) this.ring = this.ring.filter((t) => t !== tenant);
    this.waiting.delete(member(tenant, jobId));
    return Promise.resolve();
  }

  watch(tenant: string, jobId: string, untilMs: number): Promise<void> {
    this.leases.set(member(tenant, jobId), untilMs);
    return Promise.resolve();
  }

  positions(tenant: string, jobIds: string[]): Promise<Map<string, number>> {
    const lengths = new Map(this.ring.map((t) => [t, this.list(t).length]));
    const out = new Map<string, number>();
    for (const id of jobIds) {
      const index = this.list(tenant).indexOf(id);
      if (index >= 0) out.set(id, fairPosition(this.ring, lengths, tenant, index));
    }
    return Promise.resolve(out);
  }

  oldestWaiting(): Promise<number | null> {
    const times = [...this.waiting.values()];
    return Promise.resolve(times.length === 0 ? null : Math.min(...times));
  }

  expiredLeases(nowMs: number): Promise<QueuedJob[]> {
    const out: QueuedJob[] = [];
    for (const [m, until] of this.leases) {
      if (until > nowMs) continue;
      this.leases.delete(m);
      const parsed = parseMember(m);
      if (parsed !== null) out.push(parsed);
    }
    return Promise.resolve(out);
  }
}
