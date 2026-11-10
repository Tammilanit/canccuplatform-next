/**
 * The dispatcher when something fails between a take and a recorded outcome (plan #184, R11):
 * no job drops out of the queue, a stopped run gives its quota bytes back, and a job that loses
 * the renderer slot or is stopped by a shutdown goes back to its place without counting.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTenant } from "@canccu/kit";
import type { Bus, SqlClient } from "@canccu/kit";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recount } from "../src/assets/upkeep.js";
import type { Db } from "../src/db.js";
import { DATABASE_URL, call, harness, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { fakeRenderer, pdfPages } from "./render-fake.js";
import type { FakeRenderer } from "./render-fake.js";

interface Job {
  id: string;
  state: string;
  queue_position: number | null;
}

describe.skipIf(!DATABASE_URL)("render dispatch failures", () => {
  let h: Harness;
  let dir: string;
  let renderer: FakeRenderer;
  beforeAll(async () => {
    h = await harness();
    dir = await mkdtemp(join(tmpdir(), "canccu-render-failures-"));
  });
  afterAll(async () => {
    await h.close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    renderer = await fakeRenderer(dir, { slides: 2 });
  });
  afterEach(async () => {
    await h.pool.query(
      "UPDATE screen_render_jobs SET state = 'cancelled' WHERE state IN ('queued', 'running')",
    );
    for (let j; (j = await h.queue.take(1, h.clock.now + 3_600_000));) {
      await h.queue.release(j.tenant, j.jobId);
    }
    await renderer.close();
  });

  const admin = { host: "alpha.test", session: "admin" };
  let pages = 1;
  const addDeck = async () => {
    h.clock.now += 1000;
    const res = await upload(h, "/api/screen/assets", pdfPages(pages++), "Deck.pdf", admin);
    return res.json<{ id: string }>().id;
  };
  const jobOf = async (assetId: string) =>
    (await call(h, "GET", `/api/screen/render-jobs?asset_id=${assetId}`, admin)).json<{
      jobs: Job[];
    }>().jobs[0];
  const attempts = async (jobId: string): Promise<number> => {
    const { rows } = await h.pool.query<{ attempts: number }>(
      "SELECT attempts FROM screen_render_jobs WHERE id = $1",
      [jobId],
    );
    return Number(rows[0]?.attempts);
  };
  const tmpFiles = () => readdirSync(join(h.filesRoot, "alpha", "screen", "tmp"));
  /** The harness's database, failing once the first statement matching `match`. */
  const failingOnce = (match: RegExp): Db => {
    let armed = true;
    const wrap = (c: SqlClient): SqlClient => ({
      query: (text, values) => {
        if (armed && match.test(text)) {
          armed = false;
          return Promise.reject(new Error("the pool timed out"));
        }
        return c.query(text, values);
      },
    });
    return {
      tenant: (fn) => h.db.tenant((c) => fn(wrap(c))),
      global: (fn) => h.db.global(fn),
    };
  };
  const until = async (done: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 200 && !(await done()); i++) await new Promise((r) => setTimeout(r, 20));
  };

  it("puts a job back at its place when marking it running fails", async () => {
    const id = await addDeck();
    const db = failingOnce(/SET state = 'running'/);
    expect(await h.dispatch(renderer.path, { db })).toBe(false);
    expect(await jobOf(id)).toMatchObject({ state: "queued", queue_position: 1 });
    expect(await h.dispatch(renderer.path)).toBe(true);
    expect((await jobOf(id))?.state).toBe("succeeded");
  });

  it("hangs up on the renderer when the attempt's scratch directory cannot be made", async () => {
    const id = await addDeck();
    const jobId = (await jobOf(id))?.id ?? "";
    // A file where the first attempt's directory goes makes its mkdir fail.
    await mkdir(join(h.filesRoot, "alpha", "screen", "tmp"), { recursive: true });
    await writeFile(join(h.filesRoot, "alpha", "screen", "tmp", `render-${jobId}-1`), "");
    expect(await h.dispatch(renderer.path)).toBe(true);
    await until(() => renderer.closed === 1);
    expect(renderer.closed).toBe(1);
    expect(renderer.requests).toBe(0);
    expect((await jobOf(id))?.state).toBe("failed");
    expect(tmpFiles()).toEqual([]);
  });

  it("still renders when announcing the start fails", async () => {
    const id = await addDeck();
    const bus = {
      publish: (
        type: string,
        ...rest: Parameters<Bus["publish"]> extends [string, ...infer R] ? R : never
      ) =>
        type === "screen.render.started"
          ? Promise.reject(new Error("the bus is down"))
          : h.bus.publish(type, ...rest),
    } as unknown as Bus;
    expect(await h.dispatch(renderer.path, { bus })).toBe(true);
    expect((await jobOf(id))?.state).toBe("succeeded");
  });

  it("leaves a job it could not record to the lease sweep, which gives its bytes back", async () => {
    const id = await addDeck();
    const before = h.storage.used.alpha ?? 0;
    const db = failingOnce(/SET state = 'succeeded'/);
    await h.dispatch(renderer.path, { db });
    const job = await jobOf(id);
    expect(job?.state).toBe("running");
    expect(h.storage.used.alpha ?? 0).toBeGreaterThan(before);
    h.clock.now += 31_000;
    await h.sweepLeases();
    expect(await jobOf(id)).toMatchObject({ state: "queued", queue_position: 1 });
    expect(h.storage.used.alpha ?? 0).toBe(before);
    expect(tmpFiles()).toEqual([]);
    expect(await h.dispatch(renderer.path)).toBe(true);
    expect((await jobOf(id))?.state).toBe("succeeded");
  });

  it("stops a render that lost the renderer slot and puts it back without counting", async () => {
    renderer.behaviour = { slides: 2, hang: true };
    const id = await addDeck();
    const before = h.storage.used.alpha ?? 0;
    const running = h.dispatch(renderer.path);
    await until(() => (h.storage.used.alpha ?? 0) > before);
    // The slot expired during a stall and another container gave it to another event's job.
    await h.queue.enqueue("beta", "rj_other", 0);
    expect((await h.queue.take(30_000, h.clock.now + 31_000))?.jobId).toBe("rj_other");
    await running;
    await h.queue.release("beta", "rj_other");
    const job = await jobOf(id);
    expect(job).toMatchObject({ state: "queued", queue_position: 1 });
    expect(await attempts(job?.id ?? "")).toBe(0);
    expect(renderer.closed).toBe(1);
    expect(h.storage.used.alpha ?? 0).toBe(before);
    expect(tmpFiles()).toEqual([]);
  }, 20_000);

  it("takes no slide after a timeout, though more were already buffered", async () => {
    renderer.behaviour = { slides: 2, hang: true };
    const id = await addDeck();
    const jobId = (await jobOf(id))?.id ?? "";
    const before = h.storage.used.alpha ?? 0;
    // The first slide's row write stalls past the deadline, while the second slide sits in the
    // reader's buffer: once the stall ends, nothing may reserve or write for the ended run.
    let stalled!: () => void;
    const reached = new Promise<void>((resolve) => (stalled = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    let armed = true;
    const db: Db = {
      tenant: (fn) =>
        h.db.tenant((c) =>
          fn({
            query: async (text, values) => {
              if (armed && text.includes("SET reserved_bytes = $3")) {
                armed = false;
                stalled();
                await gate;
              }
              return c.query(text, values);
            },
          }),
        ),
      global: (fn) => h.db.global(fn),
    };
    const running = h.dispatch(renderer.path, { db, timeoutMs: 300 });
    await reached;
    await new Promise((r) => setTimeout(r, 500));
    resume();
    await running;
    await new Promise((r) => setTimeout(r, 300));
    expect((await jobOf(id))?.state).toBe("failed");
    const { rows } = await h.pool.query<{ reserved_bytes: string }>(
      "SELECT reserved_bytes FROM screen_render_jobs WHERE id = $1",
      [jobId],
    );
    expect(Number(rows[0]?.reserved_bytes)).toBe(0);
    expect(h.storage.used.alpha ?? 0).toBe(before);
    expect(tmpFiles()).toEqual([]);
  }, 20_000);

  const upkeep = () => ({ db: h.db, storage: h.quota, filesRoot: h.filesRoot });
  /** A recount run now, against one run after everything settled: equal unless one was raced. */
  const recountRaced = async () => {
    const raced = h.storage.used.alpha;
    await withTenant("alpha", () => recount(upkeep()));
    return [raced, h.storage.used.alpha];
  };
  const slidesOf = (jobId: string) => {
    const dir = join(h.filesRoot, "alpha", "screen", "tmp", `render-${jobId}-1`);
    return existsSync(dir) ? readdirSync(dir).length : 0;
  };

  it("gives a running render's reservation back with the delete of its asset", async () => {
    renderer.behaviour = { slides: 2, hang: true };
    const id = await addDeck();
    const jobId = (await jobOf(id))?.id ?? "";
    const shutdown = new AbortController();
    // No renewal: the run notices nothing until the shutdown, after the recount.
    const running = h.dispatch(renderer.path, { stop: shutdown.signal, renewMs: 60_000 });
    await until(() => slidesOf(jobId) === 2);
    expect((await call(h, "DELETE", `/api/screen/assets/${id}`, admin)).statusCode).toBe(204);
    await withTenant("alpha", () => recount(upkeep()));
    shutdown.abort();
    await running;
    const [raced, clean] = await recountRaced();
    expect(raced).toBe(clean);
  }, 20_000);

  it("gives a slide's reserve back itself when its job row went meanwhile", async () => {
    renderer.behaviour = { slides: 2, hang: true };
    const id = await addDeck();
    let stalled!: () => void;
    const reached = new Promise<void>((resolve) => (stalled = resolve));
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => (resume = resolve));
    let armed = true;
    const db: Db = {
      tenant: (fn) =>
        h.db.tenant((c) =>
          fn({
            query: async (text, values) => {
              if (armed && text.includes("SET reserved_bytes = $3")) {
                armed = false;
                stalled();
                await gate;
              }
              return c.query(text, values);
            },
          }),
        ),
      global: (fn) => h.db.global(fn),
    };
    const shutdown = new AbortController();
    const running = h.dispatch(renderer.path, { db, stop: shutdown.signal, renewMs: 60_000 });
    await reached;
    expect((await call(h, "DELETE", `/api/screen/assets/${id}`, admin)).statusCode).toBe(204);
    resume();
    await new Promise((r) => setTimeout(r, 300));
    shutdown.abort();
    await running;
    const [raced, clean] = await recountRaced();
    expect(raced).toBe(clean);
  }, 20_000);

  it("puts the running job back at its place on shutdown, without counting it", async () => {
    renderer.behaviour = { slides: 2, hang: true };
    const id = await addDeck();
    const before = h.storage.used.alpha ?? 0;
    const shutdown = new AbortController();
    const running = h.dispatch(renderer.path, { stop: shutdown.signal });
    await until(() => (h.storage.used.alpha ?? 0) > before);
    shutdown.abort();
    await running;
    const job = await jobOf(id);
    expect(job).toMatchObject({ state: "queued", queue_position: 1 });
    expect(await attempts(job?.id ?? "")).toBe(0);
    expect(h.storage.used.alpha ?? 0).toBe(before);
    expect(tmpFiles()).toEqual([]);
  }, 20_000);
});
