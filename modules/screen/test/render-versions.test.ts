/**
 * Renders over an asset's life and the queue's recovery: a replace renders the new deck and keeps
 * the old render for the undo, a dropped version takes its slides and quota with it, a lost
 * container's job runs once more, and the queue is rebuilt from Postgres.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTenant } from "@canccu/kit";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderCheck } from "../src/app.js";
import { MemoryRenderQueue } from "../src/render/queue.js";
import { DATABASE_URL, call, events, harness, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { fakeRenderer, pdfPages } from "./render-fake.js";
import type { FakeRenderer } from "./render-fake.js";

interface Job {
  id: string;
  asset_version: number;
  state: string;
  queue_position: number | null;
  error: { code: string } | null;
}

describe("the render health check", () => {
  it("is degraded once a deck has waited over 10 minutes", async () => {
    const queue = new MemoryRenderQueue();
    let now = 1_000_000;
    const check = renderCheck(queue, () => now);
    expect(await check()).toEqual({ status: "ok" });
    await queue.enqueue("alpha", "rj_1", now);
    now += 10 * 60_000;
    expect((await check()).status).toBe("ok");
    now += 60_000;
    expect(await check()).toEqual({
      status: "degraded",
      detail: "a deck has waited 11 minutes for the renderer",
    });
  });
});

describe.skipIf(!DATABASE_URL)("renders over an asset's life", () => {
  let h: Harness;
  let dir: string;
  let renderer: FakeRenderer;
  beforeAll(async () => {
    h = await harness();
    dir = await mkdtemp(join(tmpdir(), "canccu-render-versions-"));
    renderer = await fakeRenderer(dir, { slides: 3 });
  });
  afterAll(async () => {
    await renderer.close();
    await h.close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    renderer.behaviour = { slides: 3 };
  });
  afterEach(async () => {
    await h.pool.query(
      "UPDATE screen_render_jobs SET state = 'cancelled' WHERE state IN ('queued', 'running')",
    );
    for (let j; (j = await h.queue.take(1, h.clock.now));) await h.queue.release(j.tenant, j.jobId);
  });

  const admin = { host: "alpha.test", session: "admin" };
  let pages = 1;
  // The clock moves on with each upload, so jobs list newest first in a fixed order.
  const addDeck = async () => {
    h.clock.now += 1000;
    return (await upload(h, "/api/screen/assets", pdfPages(pages++), "Talk.pdf", admin)).json<{
      id: string;
    }>().id;
  };
  const replace = async (id: string) => {
    h.clock.now += 1000;
    return upload(h, `/api/screen/assets/${id}/replace`, pdfPages(pages++), "Talk v2.pdf", admin);
  };
  /** What the event's stored files and slides take on disk, which the quota count must match. */
  const onDisk = (path = join(h.filesRoot, "alpha", "screen")): number =>
    readdirSync(path, { withFileTypes: true })
      .filter((e) => e.name !== "tmp")
      .reduce(
        (n, e) =>
          n + (e.isDirectory() ? onDisk(join(path, e.name)) : statSync(join(path, e.name)).size),
        0,
      );
  const jobsOf = async (id: string) =>
    (await call(h, "GET", `/api/screen/render-jobs?asset_id=${id}`, admin)).json<{ jobs: Job[] }>()
      .jobs;
  const renders = (id: string, version: number) =>
    join(h.filesRoot, "alpha", "screen", "renders", id, String(version));

  it("renders a replaced deck, keeps the old render for the undo, and drops it after", async () => {
    const id = await addDeck();
    await h.dispatch(renderer.path);
    const replaced = await replace(id);
    expect(replaced.json()).toMatchObject({
      version: 2,
      render_state: "queued",
      slide_count: null,
    });
    expect((await jobsOf(id)).map((j) => [j.asset_version, j.state])).toEqual([
      [2, "queued"],
      [1, "succeeded"],
    ]);
    await h.dispatch(renderer.path);
    const reverted = await call(h, "POST", `/api/screen/assets/${id}/revert`, admin);
    expect(reverted.json()).toMatchObject({
      version: 1,
      render_state: "succeeded",
      slide_count: 3,
    });
    expect(existsSync(renders(id, 2))).toBe(false);
    expect(existsSync(renders(id, 1))).toBe(true);
    await replace(id);
    await h.dispatch(renderer.path);
    await replace(id);
    // The fourth version pushed out the first, whose slides go with it.
    expect(existsSync(renders(id, 1))).toBe(false);
    expect(h.storage.used.alpha).toBe(onDisk());
  });

  it("takes the slides, the quota and a waiting job with a deleted deck", async () => {
    const id = await addDeck();
    await h.dispatch(renderer.path);
    await replace(id);
    const [waiting] = await jobsOf(id);
    expect(waiting?.state).toBe("queued");
    expect((await call(h, "DELETE", `/api/screen/assets/${id}`, admin)).statusCode).toBe(204);
    expect(existsSync(join(h.filesRoot, "alpha", "screen", "renders", id, "1"))).toBe(false);
    expect(h.storage.used.alpha).toBe(onDisk());
    expect(events(h, "screen.render.cancelled").at(-1)).toMatchObject({ job_id: waiting?.id });
    expect(await jobsOf(id)).toEqual([]);
    expect(await h.dispatch(renderer.path)).toBe(false);
  });

  it("runs a lost container's job once more at the head of its event, then fails it", async () => {
    const id = await addDeck();
    const [job] = await jobsOf(id);
    const lose = async () => {
      // A container takes the job, marks it running and dies before its first renewal.
      const taken = await h.queue.take(30_000, h.clock.now);
      expect(taken?.jobId).toBe(job?.id);
      await h.pool.query(
        "UPDATE screen_render_jobs SET state = 'running', attempts = attempts + 1, lease_until = $2 WHERE id = $1",
        [job?.id, new Date(h.clock.now + 30_000)],
      );
      h.clock.now += 31_000;
      await h.sweepLeases();
    };
    await lose();
    expect((await jobsOf(id))[0]).toMatchObject({ state: "queued", queue_position: 1 });
    await lose();
    expect((await jobsOf(id))[0]).toMatchObject({
      state: "failed",
      error: { code: "renderer_failed" },
    });
    expect(events(h, "screen.render.failed").at(-1)).toMatchObject({ job_id: job?.id });
  });

  it("rebuilds an event's queue from Postgres when Valkey lost it", async () => {
    const id = await addDeck();
    const [job] = await jobsOf(id);
    await withTenant("alpha", () => h.queue.remove("alpha", job?.id ?? ""));
    expect(await h.dispatch(renderer.path)).toBe(false);
    h.clock.now += 61_000;
    expect((await jobsOf(id))[0]).toMatchObject({ state: "queued", queue_position: 1 });
    expect(await h.dispatch(renderer.path)).toBe(true);
    expect((await jobsOf(id))[0]?.state).toBe("succeeded");
  });
});
