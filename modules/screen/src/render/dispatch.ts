/**
 * The render dispatcher, in every screen container (plan #184, B3): takes the next job in fair
 * turn, streams its deck to the renderer, reserves each slide's bytes against the event's quota
 * before writing it (contracts/tenants.md, Storage quota), and moves the finished slides into
 * place in one rename. A job holds a lease, renewed while it runs: a cancel, a lost lease or a
 * lost renderer slot is seen at the next renewal and stops the render, and a lease that runs out
 * marks a lost container (`sweepLeases`).
 *
 * The invariant: from its take to a recorded end, a job is always findable again. Until it is
 * marked running it goes back to the head of its event's list on any failure; once running, its
 * lease stays watched until an end is committed, so the lease sweep recovers it. The bytes an
 * attempt reserved are on its row (`reserved_bytes`) and given back once, by whoever clears them.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";
import { KitError, requireTenant, withTenant } from "@canccu/kit";
import { filePath } from "../assets/files.js";
import { holdCount, releaseHeld } from "../assets/storage.js";
import { clampToDeck } from "../content/asset-rules.js";
import { RENDERER_FAILED, RendererUnavailable, openRenderer, renderDeck } from "./client.js";
import type { RenderOutcome } from "./client.js";
import {
  JOB_COLUMNS,
  announce,
  attemptDir,
  publishJob,
  readJob,
  recoverLost,
  renderDir,
} from "./jobs.js";
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
  /** Aborted when the container shuts down: the running job goes back to its place. */
  stop?: AbortSignal;
}

/**
 * How a run ended: an outcome to record; `requeue` when it was stopped through no fault of the
 * deck (the slot passed to another job, or a shutdown); `gone` when its row was cancelled,
 * deleted or recovered by the lease sweep meanwhile.
 */
type Result = RenderOutcome | "requeue" | "gone";

/** One turn: runs the next job if the renderer slot is free. True when a job ran. */
export async function dispatchOnce(d: DispatchDeps): Promise<boolean> {
  const taken = await d.queue.take(LEASE_MS, d.now());
  if (taken === null) return false;
  let settled = false;
  try {
    const run = await withTenant(taken.tenant, () => runJob(d, taken.jobId));
    settled = run.settled;
    return run.ran;
  } catch (err) {
    d.log?.warn({ err, job_id: taken.jobId }, "render dispatch failed");
    return false;
  } finally {
    await d.queue.release(taken.tenant, taken.jobId);
    // Running, with no end committed: the lease sweep finds it once the lease runs out.
    if (!settled) await d.queue.watch(taken.tenant, taken.jobId, d.now() + LEASE_MS);
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
         lease_until = $3, reserved_bytes = 0
       WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
      [jobId, new Date(d.now()), new Date(d.now() + LEASE_MS)],
    );
    return { row: rows[0] as unknown as JobRow, file: version.rows[0]?.file as string };
  });
}

/** A job taken but never started keeps its place and its attempts. */
async function backToHead(d: DispatchDeps, jobId: string): Promise<void> {
  const row = await d.db.tenant((c) => readJob(c, jobId));
  if (row?.state === "queued") {
    await d.queue.enqueue(requireTenant(), jobId, row.submitted_at.getTime(), { head: true });
  }
}

async function runJob(d: DispatchDeps, jobId: string): Promise<{ ran: boolean; settled: boolean }> {
  let socket: Socket;
  let started: { row: JobRow; file: string } | null;
  try {
    socket = await openRenderer(d.socketPath);
  } catch (err) {
    if (!(err instanceof RendererUnavailable)) throw err;
    d.log?.warn({ err }, "the renderer is unavailable");
    await backToHead(d, jobId);
    return { ran: false, settled: true };
  }
  try {
    started = await start(d, jobId);
  } catch (err) {
    socket.destroy();
    d.log?.warn({ err, job_id: jobId }, "starting a render job failed");
    await backToHead(d, jobId);
    return { ran: false, settled: true };
  }
  if (started === null) {
    socket.destroy();
    return { ran: false, settled: true };
  }
  await publishJob(d.bus, started.row).catch((err: unknown) =>
    d.log?.warn({ err, job_id: jobId }, "announcing a render job failed"),
  );
  const attempt = started.row.attempts;
  const tmp = attemptDir(d.filesRoot, jobId, attempt);
  let reserved = 0;
  let inHand: Promise<void> = Promise.resolve();
  let closed = false;
  let stopped = null as "requeue" | "gone" | null;
  const controller = new AbortController();
  const halt = (why: "requeue" | "gone"): void => {
    stopped ??= why;
    controller.abort();
  };
  const onShutdown = (): void => {
    halt("requeue");
  };
  const keep = async (): Promise<void> => {
    const { rows } = await d.db.tenant((c) =>
      c.query(
        `UPDATE screen_render_jobs SET lease_until = $3
         WHERE id = $1 AND state = 'running' AND attempts = $2 RETURNING 1`,
        [jobId, attempt, new Date(d.now() + LEASE_MS)],
      ),
    );
    if (rows.length === 0) halt("gone");
    // Another job holds the slot: two decks must never draw at once on the one renderer.
    else if (!(await d.queue.renew(requireTenant(), jobId, LEASE_MS, d.now()))) halt("requeue");
  };
  const renewer = setInterval(() => {
    keep().catch((err: unknown) =>
      d.log?.warn({ err, job_id: jobId }, "renewing a render lease failed"),
    );
  }, d.renewMs ?? RENEW_MS);
  d.stop?.addEventListener("abort", onShutdown, { once: true });
  if (d.stop?.aborted) onShutdown();
  let result: Result;
  try {
    await mkdir(tmp, { recursive: true });
    result = await renderDeck({
      socket,
      deckPath: filePath(d.filesRoot, started.file),
      signal: controller.signal,
      timeoutMs: d.timeoutMs ?? TIMEOUT_MS,
      onSlide: (slide, png) => {
        // The reader keeps serving slides it buffered before renderDeck returned; one of those
        // would reserve after settle and write into a scratch directory already settled.
        if (closed) return Promise.reject(new Error("the render already ended"));
        // renderDeck returns on a cancel or a shutdown without waiting for the slide in hand;
        // settle waits for it, or bytes it reserves after the settle would never go back.
        const work = (async () => {
          // The reserve and the row that holds it in one transaction under the count lock, so a
          // recount (assets/upkeep.ts) sees the bytes in the row or not yet reserved.
          await d.db.tenant(async (c) => {
            await holdCount(c);
            await d.storage.reserve(png.length);
            reserved += png.length;
            await c.query(
              "UPDATE screen_render_jobs SET reserved_bytes = $3 WHERE id = $1 AND attempts = $2",
              [jobId, attempt, reserved],
            );
          });
          await writeFile(join(tmp, `slide-${slide.index}.png`), png, { flag: "wx" });
        })();
        inHand = work.catch(() => undefined);
        return work;
      },
    });
  } catch (err) {
    if (stopped !== null) result = stopped;
    else if (err instanceof KitError && err.code === "storage_quota_exceeded") {
      result = { ok: false, code: "storage_quota_exceeded", message: QUOTA_FULL };
    } else {
      d.log?.warn({ err, job_id: jobId }, "a render failed");
      result = { ok: false, code: "renderer_failed", message: RENDERER_FAILED };
    }
  } finally {
    clearInterval(renewer);
    d.stop?.removeEventListener("abort", onShutdown);
    socket.destroy();
  }
  closed = true;
  await inHand;
  return { ran: true, settled: await settle(d, started.row, attempt, result, tmp, reserved) };
}

/** The end to write for a run that is still this container's. */
function endOf(result: RenderOutcome | "requeue", reserved: number): [string, unknown[]] {
  if (result === "requeue") {
    // Not the deck's fault, so the attempt does not count towards a lost container's retry.
    return [
      `state = 'queued', attempts = attempts - 1, started_at = NULL, lease_until = NULL,
       reserved_bytes = 0`,
      [],
    ];
  }
  if (result.ok) {
    return [
      `state = 'succeeded', finished_at = $2, lease_until = NULL, slides = $3, warnings = $4,
       bytes = $5, reserved_bytes = 0`,
      [JSON.stringify(result.slides), JSON.stringify(result.warnings), reserved],
    ];
  }
  return [
    `state = 'failed', finished_at = $2, lease_until = NULL, reserved_bytes = 0,
     error_code = $3, error_message = $4`,
    [result.code, result.message],
  ];
}

/**
 * Commits the run's end if the job is still this container's run, and gives back the bytes this
 * run reserved, before that commit, unless its slides are kept or someone else already gave them
 * back. False when nothing could be committed: the row then still holds the bytes and the lease
 * sweep recovers it.
 */
async function settle(
  d: DispatchDeps,
  job: JobRow,
  attempt: number,
  result: Result,
  tmp: string,
  reserved: number,
): Promise<boolean> {
  const target = renderDir(d.filesRoot, job.asset_id, job.asset_version);
  let placed = false as boolean;
  let ended: JobRow | null = null;
  try {
    await d.db.tenant(async (c) => {
      // The count lock before the job row, the order onSlide keeps, so a waiting recount never
      // stands between the two.
      await holdCount(c);
      const now = await readJob(c, job.id, true);
      if (now === null) {
        await releaseHeld(c, d.storage, reserved, d.log);
        return;
      }
      if (result === "gone" || now.state !== "running" || now.attempts !== attempt) {
        // Cancelled, or recovered by the sweep, which then gave the bytes back already.
        if (now.attempts === attempt && Number(now.reserved_bytes) > 0) {
          await c.query("UPDATE screen_render_jobs SET reserved_bytes = 0 WHERE id = $1", [job.id]);
          await releaseHeld(c, d.storage, reserved, d.log);
        }
        return;
      }
      if (result !== "requeue" && result.ok) {
        // Anything already there is an orphan: a version has one render, and it is this one.
        await rm(target, { recursive: true, force: true });
        await mkdir(dirname(target), { recursive: true });
        await rename(tmp, target);
        placed = true;
      }
      const [set, values] = endOf(result, reserved);
      const { rows } = await c.query(
        `UPDATE screen_render_jobs SET ${set} WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
        [job.id, ...(result === "requeue" ? [] : [new Date(d.now())]), ...values],
      );
      ended = rows[0] as unknown as JobRow;
      if (!placed) await releaseHeld(c, d.storage, reserved, d.log);
      // The deck's slide count is known only now: a replace's ranges are fitted to it here.
      if (placed) await clampToDeck(c, job.asset_id);
    });
  } catch (err) {
    d.log?.warn({ err, job_id: job.id }, "recording a render job failed");
    if (placed) await rm(target, { recursive: true, force: true }).catch(() => undefined);
    return false;
  }
  if (!placed) {
    await rm(tmp, { recursive: true, force: true }).catch((err: unknown) =>
      d.log?.warn({ err, job_id: job.id }, "removing a render's scratch failed"),
    );
  }
  const row = ended as JobRow | null;
  if (row?.state === "queued") await announce(d, row, { head: true });
  else if (row !== null) {
    await publishJob(d.bus, row).catch((err: unknown) =>
      d.log?.warn({ err, job_id: job.id }, "announcing a render job failed"),
    );
  }
  return true;
}

/** Recovers the jobs whose containers stopped renewing their leases. */
export async function sweepLeases(d: RenderDeps): Promise<void> {
  for (const lost of await d.queue.expiredLeases(d.now())) {
    try {
      await withTenant(lost.tenant, () => recoverLost(d, lost.jobId));
    } catch (err) {
      // Keep watching it, so a database hiccup here does not lose the job for good.
      await d.queue.watch(lost.tenant, lost.jobId, d.now() + LEASE_MS).catch(() => undefined);
      d.log?.warn(
        { err, tenant_id: lost.tenant, job_id: lost.jobId },
        "recovering a render job failed",
      );
    }
  }
}

/**
 * The dispatcher and the lease sweep, as main runs them. `stop` puts a running job back at its
 * place and resolves once it is recorded, so main closes the database and Valkey only after.
 */
export function renderLoop(d: DispatchDeps): { stop: () => Promise<void> } {
  const shutdown = new AbortController();
  const deps = { ...d, stop: shutdown.signal };
  let current: Promise<unknown> | null = null;
  const dispatcher = setInterval(() => {
    if (current !== null) return;
    current = dispatchOnce(deps)
      .catch((err: unknown) => d.log?.warn({ err }, "render dispatch failed"))
      .finally(() => {
        current = null;
      });
  }, 1000);
  const sweeper = setInterval(() => {
    sweepLeases(d).catch((err: unknown) => d.log?.warn({ err }, "render lease sweep failed"));
  }, 5000);
  return {
    stop: async () => {
      clearInterval(dispatcher);
      clearInterval(sweeper);
      shutdown.abort();
      await current;
    },
  };
}
