/**
 * The render dispatcher, in every screen container (plan #184, B3): takes the next job in fair
 * turn, streams its deck to the renderer, reserves each slide's bytes against the event's quota
 * before writing it (contracts/tenants.md, Storage quota), and moves the finished slides into
 * place in one rename. A job holds a lease, renewed while it runs: a cancel or a lost lease is
 * seen at the next renewal and stops the render, and a lease that runs out marks a lost
 * container (`sweepLeases`).
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KitError, requireTenant, tenantFile, withTenant } from "@canccu/kit";
import { filePath } from "../assets/files.js";
import { RENDERER_FAILED, RendererUnavailable, openRenderer, renderDeck } from "./client.js";
import type { RenderOutcome } from "./client.js";
import { JOB_COLUMNS, publishJob, readJob, recoverLost, renderDir } from "./jobs.js";
import type { JobRow, RenderDeps } from "./jobs.js";

export const LEASE_MS = 30_000;
const RENEW_MS = 5_000;
/** The renderer stops a job at 10 minutes; this only catches a renderer that stopped answering. */
const TIMEOUT_MS = 11 * 60_000;
const QUOTA_FULL =
  "The slides would pass this event's storage quota. Delete files the event no longer needs, or ask for a larger quota, then submit the deck again.";

export interface DispatchDeps extends RenderDeps {
  socketPath: string;
  timeoutMs?: number;
  renewMs?: number;
}

type Outcome = RenderOutcome | "cancelled";

/** One turn: runs the next job if the renderer slot is free. True when a job ran. */
export async function dispatchOnce(d: DispatchDeps): Promise<boolean> {
  const taken = await d.queue.take(LEASE_MS, d.now());
  if (taken === null) return false;
  try {
    return await withTenant(taken.tenant, () => runJob(d, taken.jobId));
  } finally {
    await d.queue.release(taken.tenant, taken.jobId);
  }
}

/** Marks the job running if it still waits, with the file its version keeps. */
async function start(
  d: DispatchDeps,
  jobId: string,
): Promise<{ row: JobRow; file: string } | null> {
  return d.db.tenant(async (c) => {
    const job = await readJob(c, jobId, true);
    if (job === null || job.state !== "queued") return null;
    const version = await c.query(
      "SELECT file FROM screen_asset_versions WHERE asset_id = $1 AND version = $2",
      [job.asset_id, job.asset_version],
    );
    const { rows } = await c.query(
      `UPDATE screen_render_jobs SET state = 'running', attempts = attempts + 1, started_at = $2,
         lease_until = $3
       WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
      [jobId, new Date(d.now()), new Date(d.now() + LEASE_MS)],
    );
    return { row: rows[0] as unknown as JobRow, file: version.rows[0]?.file as string };
  });
}

async function runJob(d: DispatchDeps, jobId: string): Promise<boolean> {
  let socket;
  try {
    socket = await openRenderer(d.socketPath);
  } catch (err) {
    if (!(err instanceof RendererUnavailable)) throw err;
    // Nothing started: the job keeps its place and its attempts.
    const row = await d.db.tenant((c) => readJob(c, jobId));
    if (row?.state === "queued") {
      await d.queue.enqueue(requireTenant(), jobId, row.submitted_at.getTime(), { head: true });
    }
    d.log?.warn({ err }, "the renderer is unavailable");
    return false;
  }
  const started = await start(d, jobId).catch((err: unknown) => {
    socket.destroy();
    throw err;
  });
  if (started === null) {
    socket.destroy();
    return false;
  }
  await publishJob(d.bus, started.row);
  const attempt = started.row.attempts;
  const tmp = tenantFile("screen", `tmp/render-${jobId}-${attempt}`, d.filesRoot);
  let reserved = 0;
  const controller = new AbortController();
  const keep = async (): Promise<void> => {
    const { rows } = await d.db.tenant((c) =>
      c.query(
        `UPDATE screen_render_jobs SET lease_until = $3
         WHERE id = $1 AND state = 'running' AND attempts = $2 RETURNING 1`,
        [jobId, attempt, new Date(d.now() + LEASE_MS)],
      ),
    );
    if (rows.length === 0) controller.abort();
    else await d.queue.renew(requireTenant(), jobId, LEASE_MS, d.now());
  };
  const renewer = setInterval(() => {
    keep().catch((err: unknown) =>
      d.log?.warn({ err, job_id: jobId }, "renewing a render lease failed"),
    );
  }, d.renewMs ?? RENEW_MS);
  let outcome: Outcome;
  try {
    await mkdir(tmp, { recursive: true });
    outcome = await renderDeck({
      socket,
      deckPath: filePath(d.filesRoot, started.file),
      signal: controller.signal,
      timeoutMs: d.timeoutMs ?? TIMEOUT_MS,
      onSlide: async (slide, png) => {
        await d.storage.reserve(png.length);
        reserved += png.length;
        await writeFile(join(tmp, `slide-${slide.index}.png`), png, { flag: "wx" });
      },
    });
  } catch (err) {
    if (controller.signal.aborted) outcome = "cancelled";
    else if (err instanceof KitError && err.code === "storage_quota_exceeded") {
      outcome = { ok: false, code: "storage_quota_exceeded", message: QUOTA_FULL };
    } else {
      d.log?.warn({ err, job_id: jobId }, "a render failed");
      outcome = { ok: false, code: "renderer_failed", message: RENDERER_FAILED };
    }
  } finally {
    clearInterval(renewer);
  }
  await finish(d, started.row, attempt, outcome, tmp, reserved);
  return true;
}

/**
 * Records the outcome if the job is still this container's run (not cancelled, deleted or
 * requeued meanwhile). Only a recorded success keeps its slides; anything else gives their bytes
 * back.
 */
async function finish(
  d: DispatchDeps,
  job: JobRow,
  attempt: number,
  outcome: Outcome,
  tmp: string,
  reserved: number,
): Promise<void> {
  const target = renderDir(d.filesRoot, job.asset_id, job.asset_version);
  let placed = false as boolean;
  try {
    if (outcome !== "cancelled") {
      const row = await d.db.tenant(async (c) => {
        const now = await readJob(c, job.id, true);
        if (now === null || now.state !== "running" || now.attempts !== attempt) return null;
        if (outcome.ok) {
          // Anything already there is an orphan: a version has one render, and it is this one.
          await rm(target, { recursive: true, force: true });
          await mkdir(dirname(target), { recursive: true });
          await rename(tmp, target);
          placed = true;
        }
        const { rows } = await c.query(
          outcome.ok
            ? `UPDATE screen_render_jobs SET state = 'succeeded', finished_at = $2, lease_until = NULL,
                 slides = $3, warnings = $4, bytes = $5
               WHERE id = $1 RETURNING ${JOB_COLUMNS}`
            : `UPDATE screen_render_jobs SET state = 'failed', finished_at = $2, lease_until = NULL,
                 error_code = $3, error_message = $4
               WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
          outcome.ok
            ? [
                job.id,
                new Date(d.now()),
                JSON.stringify(outcome.slides),
                JSON.stringify(outcome.warnings),
                reserved,
              ]
            : [job.id, new Date(d.now()), outcome.code, outcome.message],
        );
        return rows[0] as unknown as JobRow;
      });
      if (row !== null) {
        await publishJob(d.bus, row).catch((err: unknown) =>
          d.log?.warn({ err, job_id: job.id }, "announcing a render job failed"),
        );
        if (row.state === "succeeded") return;
      }
    }
  } catch (err) {
    d.log?.warn({ err, job_id: job.id }, "recording a render job failed");
    if (placed) await rm(target, { recursive: true, force: true });
  }
  await rm(tmp, { recursive: true, force: true });
  if (reserved > 0) await d.storage.release(reserved);
}

/** Recovers the jobs whose containers stopped renewing their leases. */
export async function sweepLeases(d: RenderDeps): Promise<void> {
  for (const lost of await d.queue.expiredLeases(d.now())) {
    try {
      await withTenant(lost.tenant, () => recoverLost(d, lost.jobId));
    } catch (err) {
      d.log?.warn(
        { err, tenant_id: lost.tenant, job_id: lost.jobId },
        "recovering a render job failed",
      );
    }
  }
}

/** The dispatcher and the lease sweep, as main runs them; `stop` ends both. */
export function renderLoop(d: DispatchDeps): { stop: () => void } {
  let busy = false;
  const dispatcher = setInterval(() => {
    if (busy) return;
    busy = true;
    dispatchOnce(d)
      .catch((err: unknown) => d.log?.warn({ err }, "render dispatch failed"))
      .finally(() => {
        busy = false;
      });
  }, 1000);
  const sweeper = setInterval(() => {
    sweepLeases(d).catch((err: unknown) => d.log?.warn({ err }, "render lease sweep failed"));
  }, 5000);
  return {
    stop: () => {
      clearInterval(dispatcher);
      clearInterval(sweeper);
    },
  };
}
