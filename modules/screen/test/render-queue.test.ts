/**
 * The fair render queue (plan #184, R8): events served in turn, one running job at a time, an
 * event waiting behind at most one job of each other event. The same cases run on the in-memory
 * queue and, with `CANCCU_VALKEY_URL`, on the Lua scripts against a real Valkey.
 */
import { Valkey } from "iovalkey";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRenderQueue, ValkeyRenderQueue } from "../src/render/queue.js";
import type { RenderQueue } from "../src/render/queue.js";

const VALKEY_URL = process.env.CANCCU_VALKEY_URL;
/** A database of its own, emptied before each case, so the run never touches the stack's keys. */
const TEST_DB = 15;
const LEASE = 30_000;

/** Each kind gives a fresh, empty queue per test. */
const kinds: [string, () => { fresh: () => Promise<RenderQueue> } | null][] = [
  ["memory", () => ({ fresh: () => Promise.resolve(new MemoryRenderQueue()) })],
  [
    "valkey",
    () => {
      if (!VALKEY_URL) return null;
      const client = new Valkey(VALKEY_URL, { db: TEST_DB });
      clients.push(client);
      return {
        fresh: async () => {
          await client.flushdb();
          return new ValkeyRenderQueue(client);
        },
      };
    },
  ],
];
const clients: Valkey[] = [];
afterAll(async () => {
  await Promise.all(clients.map((c) => c.quit()));
});

for (const [kind, make] of kinds) {
  const made = make();
  describe.skipIf(made === null)(`render queue (${kind})`, () => {
    let queue: RenderQueue;
    beforeEach(async () => {
      queue = (await made?.fresh()) as RenderQueue;
    });

    const position = async (tenant: string, jobId: string) =>
      (await queue.positions(tenant, [jobId])).get(jobId) ?? null;
    const drain = async (): Promise<string[]> => {
      const order: string[] = [];
      for (;;) {
        const job = await queue.take(LEASE, 0);
        if (job === null) return order;
        order.push(`${job.tenant}/${job.jobId}`);
        await queue.release(job.tenant, job.jobId);
      }
    };

    it("serves events in turn: one event's 20 decks hold another's one back by one job", async () => {
      for (let i = 1; i <= 20; i++) await queue.enqueue("alpha", `a${i}`, i);
      await queue.enqueue("beta", "b1", 100);
      expect(await position("beta", "b1")).toBe(2);
      const order = await drain();
      expect(order.indexOf("beta/b1")).toBeLessThanOrEqual(1);
      expect(order.filter((o) => o.startsWith("alpha/"))).toEqual(
        Array.from({ length: 20 }, (_, i) => `alpha/a${i + 1}`),
      );
    });

    it("runs one job at a time: the slot is taken until it is released", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.enqueue("beta", "b1", 2);
      const first = await queue.take(LEASE, 0);
      expect(first).toEqual({ tenant: "alpha", jobId: "a1" });
      expect(await queue.take(LEASE, 0)).toBeNull();
      await queue.release("alpha", "a1");
      expect(await queue.take(LEASE, 0)).toEqual({ tenant: "beta", jobId: "b1" });
    });

    it("adds a job once, and a requeued job goes to the head of its event's list", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.enqueue("alpha", "a2", 2);
      await queue.enqueue("alpha", "a1", 1);
      await queue.enqueue("alpha", "a0", 0, { head: true });
      expect(await drain()).toEqual(["alpha/a0", "alpha/a1", "alpha/a2"]);
    });

    it("gives queue positions across events and none for an unknown job", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.enqueue("alpha", "a2", 2);
      await queue.enqueue("alpha", "a3", 3);
      await queue.enqueue("beta", "b1", 4);
      await queue.enqueue("beta", "b2", 5);
      // alpha is ahead in the ring: a1, b1, a2, b2, a3.
      expect(await position("alpha", "a1")).toBe(1);
      expect(await position("beta", "b1")).toBe(2);
      expect(await position("alpha", "a2")).toBe(3);
      expect(await position("beta", "b2")).toBe(4);
      expect(await position("alpha", "a3")).toBe(5);
      expect(await position("alpha", "nope")).toBeNull();
    });

    it("removes a cancelled job, and an event with nothing left leaves the ring", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.enqueue("beta", "b1", 2);
      await queue.remove("alpha", "a1");
      expect(await position("beta", "b1")).toBe(1);
      expect(await drain()).toEqual(["beta/b1"]);
    });

    it("reports the oldest waiting job's submit time until it is taken", async () => {
      expect(await queue.oldestWaiting()).toBeNull();
      await queue.enqueue("beta", "b1", 500);
      await queue.enqueue("alpha", "a1", 200);
      expect(await queue.oldestWaiting()).toBe(200);
      const job = await queue.take(LEASE, 0);
      expect(job?.jobId).toBe("b1");
      expect(await queue.oldestWaiting()).toBe(200);
    });

    it("hands out each expired lease once; a renewed lease is not expired", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.take(LEASE, 1000);
      expect(await queue.expiredLeases(1000 + LEASE - 1)).toEqual([]);
      expect(await queue.renew("alpha", "a1", LEASE, 20_000)).toBe(true);
      expect(await queue.expiredLeases(1000 + LEASE)).toEqual([]);
      expect(await queue.expiredLeases(20_000 + LEASE)).toEqual([{ tenant: "alpha", jobId: "a1" }]);
      expect(await queue.expiredLeases(20_000 + LEASE)).toEqual([]);
    });

    it("watches a lease without the slot, so an unrecorded job is still recovered", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.take(LEASE, 0);
      await queue.release("alpha", "a1");
      await queue.watch("alpha", "a1", LEASE);
      expect(await queue.take(LEASE, 0)).toBeNull();
      expect(await queue.expiredLeases(LEASE)).toEqual([{ tenant: "alpha", jobId: "a1" }]);
    });

    it("renews only the job that holds the slot", async () => {
      await queue.enqueue("alpha", "a1", 1);
      await queue.take(LEASE, 0);
      expect(await queue.renew("beta", "b9", LEASE, 1)).toBe(false);
      await queue.release("beta", "b9");
      expect(await queue.take(LEASE, 0)).toBeNull();
    });
  });
}
