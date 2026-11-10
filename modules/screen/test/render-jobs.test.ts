/**
 * Render jobs over HTTP and through the dispatcher, on a real Postgres with a scripted renderer:
 * submit on upload, status, result, the slides, refusals, cancel and the quota
 * (contracts/screen.md, The PPTX render job).
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE_URL, call, code, events, harness, png, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { fakeRenderer, pdfPages } from "./render-fake.js";
import type { FakeRenderer } from "./render-fake.js";

interface Job {
  id: string;
  asset_id: string;
  asset_version: number;
  state: string;
  queue_position: number | null;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: { code: string; message: string } | null;
}

describe.skipIf(!DATABASE_URL)("render jobs", () => {
  let h: Harness;
  let dir: string;
  let renderer: FakeRenderer;
  beforeAll(async () => {
    h = await harness();
    dir = await mkdtemp(join(tmpdir(), "canccu-render-jobs-"));
  });
  afterAll(async () => {
    await h.close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    renderer = await fakeRenderer(dir, { slides: 2 });
  });
  afterEach(async () => {
    // Each case starts with nothing waiting, in Postgres or in the queue.
    await h.pool.query(
      "UPDATE screen_render_jobs SET state = 'cancelled' WHERE state IN ('queued', 'running')",
    );
    for (let j; (j = await h.queue.take(1, h.clock.now));) await h.queue.release(j.tenant, j.jobId);
    await renderer.close();
  });

  const admin = (host = "alpha.test") => ({ host, session: "admin" });
  let deckSeed = 1;
  const addDeck = async (host = "alpha.test") => {
    const res = await upload(
      h,
      "/api/screen/assets",
      pdfPages(deckSeed++),
      "Keynote.pdf",
      admin(host),
    );
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; render_state: string | null; slide_count: number | null }>();
  };
  const jobsOf = async (assetId: string, host = "alpha.test") =>
    (await call(h, "GET", `/api/screen/render-jobs?asset_id=${assetId}`, admin(host))).json<{
      jobs: Job[];
    }>().jobs;
  const asset = async (id: string) =>
    (await call(h, "GET", "/api/screen/assets", admin()))
      .json<{ assets: { id: string; render_state: string | null; slide_count: number | null }[] }>()
      .assets.find((a) => a.id === id);

  it("submits a job when a deck is uploaded, audited, with its place in the queue", async () => {
    const deck = await addDeck();
    expect(deck.render_state).toBe("queued");
    const [job] = await jobsOf(deck.id);
    expect(job).toMatchObject({
      asset_id: deck.id,
      asset_version: 1,
      state: "queued",
      queue_position: 1,
      started_at: null,
      error: null,
    });
    expect(events(h, "screen.render.queued").at(-1)).toEqual({
      job_id: job?.id,
      asset_id: deck.id,
      asset_version: 1,
      state: "queued",
      slide_count: null,
      error: null,
    });
    expect(h.audits.map((a) => a.action)).toContain("screen.render.submitted");
    const one = await call(h, "GET", `/api/screen/render-jobs/${job?.id}`, admin());
    expect(one.json<Job>().id).toBe(job?.id);
  });

  it("answers the live job on a second submit, and refuses what is not a deck", async () => {
    const deck = await addDeck();
    const [job] = await jobsOf(deck.id);
    const again = await call(h, "POST", "/api/screen/render-jobs", {
      ...admin(),
      body: { asset_id: deck.id },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<Job>().id).toBe(job?.id);
    const image = (await upload(h, "/api/screen/assets", await png(77), "a.png", admin())).json<{
      id: string;
    }>();
    const notDeck = await call(h, "POST", "/api/screen/render-jobs", {
      ...admin(),
      body: { asset_id: image.id },
    });
    expect([notDeck.statusCode, code(notDeck)]).toEqual([400, "not_pptx"]);
    const missing = await call(h, "POST", "/api/screen/render-jobs", {
      ...admin(),
      body: { asset_id: "as_nope" },
    });
    expect(missing.statusCode).toBe(404);
    const reader = await call(h, "POST", "/api/screen/render-jobs", {
      host: "alpha.test",
      session: "content",
      body: { asset_id: deck.id },
    });
    expect(reader.statusCode).toBe(403);
  });

  it("renders the slides into the files volume, counts them and serves them", async () => {
    const deck = await addDeck();
    const [job] = await jobsOf(deck.id);
    const early = await call(h, "GET", `/api/screen/render-jobs/${job?.id}/result`, admin());
    expect([early.statusCode, code(early)]).toEqual([409, "render_not_finished"]);
    const before = h.storage.used.alpha ?? 0;
    expect(await h.dispatch(renderer.path)).toBe(true);
    const done = (await call(h, "GET", `/api/screen/render-jobs/${job?.id}`, admin())).json<Job>();
    expect(done).toMatchObject({ state: "succeeded", queue_position: null, error: null });
    expect(done.started_at).not.toBeNull();
    expect(done.finished_at).not.toBeNull();
    const result = (
      await call(h, "GET", `/api/screen/render-jobs/${job?.id}/result`, admin())
    ).json<{
      slide_count: number;
      slides: { index: number; url: string; width: number; height: number }[];
      warnings: unknown[];
    }>();
    expect(result.slide_count).toBe(2);
    expect(result.slides[1]).toEqual({
      index: 2,
      url: `/api/screen/renders/${deck.id}/1/slide-2.png`,
      width: 32,
      height: 18,
    });
    const slide = await call(h, "GET", result.slides[0]?.url ?? "", admin());
    expect(slide.statusCode).toBe(200);
    expect(slide.headers["content-type"]).toBe("image/png");
    const onDisk = join(h.filesRoot, "alpha", "screen", "renders", deck.id, "1");
    expect(readdirSync(onDisk).sort()).toEqual(["slide-1.png", "slide-2.png"]);
    expect((h.storage.used.alpha ?? 0) - before).toBe(
      slide.rawPayload.length +
        (await call(h, "GET", result.slides[1]?.url ?? "", admin())).rawPayload.length,
    );
    expect(await asset(deck.id)).toMatchObject({ render_state: "succeeded", slide_count: 2 });
    expect(events(h, "screen.render.started").at(-1)).toMatchObject({
      job_id: job?.id,
      state: "running",
    });
    expect(events(h, "screen.render.succeeded").at(-1)).toMatchObject({
      job_id: job?.id,
      slide_count: 2,
      error: null,
    });
    const none = await call(h, "GET", `/api/screen/renders/${deck.id}/1/slide-3.png`, admin());
    expect(none.statusCode).toBe(404);
  });

  it("keeps a refusal's code and message, and a failed deck can be submitted again", async () => {
    renderer.behaviour = {
      error: { code: "file_invalid", message: "This deck links to content outside the file." },
    };
    const deck = await addDeck();
    await h.dispatch(renderer.path);
    const [failed] = await jobsOf(deck.id);
    expect(failed).toMatchObject({
      state: "failed",
      error: { code: "file_invalid", message: "This deck links to content outside the file." },
    });
    expect(events(h, "screen.render.failed").at(-1)).toMatchObject({
      job_id: failed?.id,
      error: { code: "file_invalid" },
    });
    expect(await asset(deck.id)).toMatchObject({ render_state: "failed", slide_count: null });
    const again = await call(h, "POST", "/api/screen/render-jobs", {
      ...admin(),
      body: { asset_id: deck.id },
    });
    expect(again.statusCode).toBe(202);
    expect(again.json<Job>()).toMatchObject({ state: "queued", queue_position: 1 });
  });

  it("fails as storage_quota_exceeded when the slides would pass the quota, keeping nothing", async () => {
    const deck = await addDeck();
    const used = h.storage.used.alpha ?? 0;
    h.storage.quota.alpha = used + 10;
    try {
      await h.dispatch(renderer.path);
    } finally {
      delete h.storage.quota.alpha;
    }
    const [job] = await jobsOf(deck.id);
    expect(job?.error?.code).toBe("storage_quota_exceeded");
    expect(h.storage.used.alpha).toBe(used);
    expect(existsSync(join(h.filesRoot, "alpha", "screen", "renders", deck.id))).toBe(false);
    expect(readdirSync(join(h.filesRoot, "alpha", "screen", "tmp"))).toEqual([]);
  });

  it("cancels a queued job, which then never runs", async () => {
    const deck = await addDeck();
    const [job] = await jobsOf(deck.id);
    const res = await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, admin());
    expect(res.statusCode).toBe(204);
    expect(events(h, "screen.render.cancelled").at(-1)).toMatchObject({
      job_id: job?.id,
      state: "cancelled",
    });
    expect(h.audits.at(-1)?.action).toBe("screen.render.cancelled");
    expect(await h.dispatch(renderer.path)).toBe(false);
    expect(renderer.requests).toBe(0);
    const twice = await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, admin());
    expect([twice.statusCode, code(twice)]).toEqual([409, "render_finished"]);
  });

  it.each([
    [
      "the queue cannot be tidied",
      () => vi.spyOn(h.queue, "remove").mockRejectedValueOnce(new Error("valkey is down")),
    ],
    [
      "the cancel cannot be announced",
      () => {
        const publish = h.bus.publish.bind(h.bus);
        return vi
          .spyOn(h.bus, "publish")
          .mockImplementation((type, ...rest) =>
            type === "screen.render.cancelled"
              ? Promise.reject(new Error("the bus is down"))
              : publish(type, ...rest),
          );
      },
    ],
  ])("answers 204 for a cancel that happened when %s", async (_name, fail) => {
    const deck = await addDeck();
    const [job] = await jobsOf(deck.id);
    const spy = fail();
    try {
      const res = await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, admin());
      expect(res.statusCode).toBe(204);
    } finally {
      spy.mockRestore();
    }
    expect((await jobsOf(deck.id))[0]?.state).toBe("cancelled");
    expect(await h.dispatch(renderer.path)).toBe(false);
    expect(renderer.requests).toBe(0);
  });

  it("cancels a running job by hanging up on the renderer", async () => {
    renderer.behaviour = "hang";
    const deck = await addDeck();
    const [job] = await jobsOf(deck.id);
    const running = h.dispatch(renderer.path);
    for (let i = 0; i < 100 && renderer.requests === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect((await jobsOf(deck.id))[0]?.state).toBe("running");
    expect(
      (await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, admin())).statusCode,
    ).toBe(204);
    await running;
    expect(renderer.closed).toBe(1);
    expect((await jobsOf(deck.id))[0]?.state).toBe("cancelled");
    expect(existsSync(join(h.filesRoot, "alpha", "screen", "renders", deck.id))).toBe(false);
  }, 20_000);

  it("fails as render_timeout when the renderer passes the deadline", async () => {
    renderer.behaviour = "hang";
    const deck = await addDeck();
    await h.dispatch(renderer.path, { timeoutMs: 200 });
    expect((await jobsOf(deck.id))[0]?.error?.code).toBe("render_timeout");
  });

  it("leaves the job waiting at its place when no renderer answers", async () => {
    const deck = await addDeck();
    expect(await h.dispatch(join(dir, "nobody.sock"))).toBe(false);
    const [job] = await jobsOf(deck.id);
    expect(job).toMatchObject({ state: "queued", queue_position: 1 });
    expect(await h.dispatch(renderer.path)).toBe(true);
  });

  it("shows nothing of one event's jobs or slides to another", async () => {
    const deck = await addDeck();
    const [job] = await jobsOf(deck.id);
    await h.dispatch(renderer.path);
    const beta = admin("beta.test");
    expect((await call(h, "GET", `/api/screen/render-jobs/${job?.id}`, beta)).statusCode).toBe(404);
    expect((await call(h, "DELETE", `/api/screen/render-jobs/${job?.id}`, beta)).statusCode).toBe(
      404,
    );
    expect(await jobsOf(deck.id, "beta.test")).toEqual([]);
    const slide = await call(h, "GET", `/api/screen/renders/${deck.id}/1/slide-1.png`, beta);
    expect(slide.statusCode).toBe(404);
  });
});
