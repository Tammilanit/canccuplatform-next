/**
 * Render jobs in Postgres, the truth the fair queue orders (contracts/screen.md, The PPTX render
 * job). A succeeded job is its asset version's render: the slides under
 * `/files/<tenant>/screen/renders/<asset id>/<asset version>/`, counted against the event's
 * storage quota, and gone with the version (`dropJobs`), never before.
 */
import { rm } from "node:fs/promises";
import { requireTenant, tenantFile } from "@canccu/kit";
import type { Bus, Logger, SqlClient } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Db } from "../db.js";
import { newId } from "../http.js";
import { releaseHeld } from "../assets/storage.js";
import type { StorageQuota } from "../assets/storage.js";
import type { RenderWarning, SlideMeta } from "./client.js";
import type { RenderQueue } from "./queue.js";

export interface RenderDeps {
  db: Db;
  queue: RenderQueue;
  bus: Bus;
  storage: StorageQuota;
  filesRoot: string;
  now: () => number;
  log?: Logger;
}

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  asset_id: string;
  asset_version: number;
  state: JobState;
  attempts: number;
  lease_until: Date | null;
  submitted_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  slides: SlideMeta[] | null;
  warnings: RenderWarning[] | null;
  bytes: string;
  reserved_bytes: string;
}

export const JOB_COLUMNS = `id, asset_id, asset_version, state, attempts, lease_until, submitted_at,
  started_at, finished_at, error_code, error_message, slides, warnings, bytes, reserved_bytes`;

/** A container lost twice while drawing the same deck is the deck's doing, not bad luck. */
export const MAX_ATTEMPTS = 2;
const LOST_TWICE =
  "The renderer stopped twice while drawing this deck. Submit it again; if it stops again, export it as PDF and upload that.";
/** How often one container rebuilds an event's queue entries from Postgres. */
const RECONCILE_MS = 60_000;

const EVENT_OF: Record<JobState, string> = {
  queued: "screen.render.queued",
  running: "screen.render.started",
  succeeded: "screen.render.succeeded",
  failed: "screen.render.failed",
  cancelled: "screen.render.cancelled",
};

export const isLive = (row: JobRow): boolean => row.state === "queued" || row.state === "running";

export function renderDir(root: string, assetId: string, version: number): string {
  return tenantFile("screen", `renders/${assetId}/${version}`, root);
}

export function slideUrl(assetId: string, version: number, index: number): string {
  return `/api/screen/renders/${assetId}/${version}/slide-${index}.png`;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** The contract's `RenderJob`. */
export function jobView(row: JobRow, position: number | null): Record<string, unknown> {
  return {
    id: row.id,
    asset_id: row.asset_id,
    asset_version: row.asset_version,
    state: row.state,
    queue_position: row.state === "queued" ? position : null,
    submitted_at: row.submitted_at.toISOString(),
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    error:
      row.error_code === null ? null : { code: row.error_code, message: row.error_message ?? "" },
  };
}

export async function viewJobs(
  deps: RenderDeps,
  rows: JobRow[],
): Promise<Record<string, unknown>[]> {
  const queued = rows.filter((r) => r.state === "queued").map((r) => r.id);
  const positions = await deps.queue.positions(requireTenant(), queued);
  return rows.map((row) => jobView(row, positions.get(row.id) ?? null));
}

/** The scratch directory of one attempt, where its slides wait until the job is recorded. */
export function attemptDir(root: string, jobId: string, attempt: number): string {
  return tenantFile("screen", `tmp/render-${jobId}-${attempt}`, root);
}

export async function readJob(c: SqlClient, id: string, lock = false): Promise<JobRow | null> {
  const { rows } = await c.query(
    `SELECT ${JOB_COLUMNS} FROM screen_render_jobs WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return (rows[0] as unknown as JobRow | undefined) ?? null;
}

/** `screen.render.<…>` for the job's state, in its tenant. */
export async function publishJob(bus: Bus, row: JobRow): Promise<void> {
  await bus.publish(
    EVENT_OF[row.state],
    {
      job_id: row.id,
      asset_id: row.asset_id,
      asset_version: row.asset_version,
      state: row.state,
      slide_count: row.state === "succeeded" ? (row.slides?.length ?? 0) : null,
      error:
        row.error_code === null ? null : { code: row.error_code, message: row.error_message ?? "" },
    },
    { version: 1 },
  );
}

/**
 * In the caller's transaction: the version's live job or its render if it has one (rendering
 * the same bytes again would draw the same slides), otherwise a new queued job, audited.
 */
export async function submitJob(
  c: SqlClient,
  deps: { audit: Audit; now: () => number },
  who: { tenant_id: string; actor_user_id: string | null },
  assetId: string,
  version: number,
): Promise<{ row: JobRow; created: boolean }> {
  const { rows } = await c.query(
    `SELECT ${JOB_COLUMNS} FROM screen_render_jobs
     WHERE asset_id = $1 AND asset_version = $2 AND state IN ('queued', 'running', 'succeeded')
     ORDER BY submitted_at DESC LIMIT 1`,
    [assetId, version],
  );
  const existing = rows[0] as unknown as JobRow | undefined;
  if (existing !== undefined) return { row: existing, created: false };
  const id = newId("rj");
  const inserted = await c.query(
    `INSERT INTO screen_render_jobs (id, asset_id, asset_version, submitted_at)
     VALUES ($1, $2, $3, $4) RETURNING ${JOB_COLUMNS}`,
    [id, assetId, version, new Date(deps.now())],
  );
  await deps.audit({
    ...who,
    action: "screen.render.submitted",
    target: { type: "render_job", id },
    changes: { asset: { from: null, to: { id: assetId, version } } },
  });
  return { row: inserted.rows[0] as unknown as JobRow, created: true };
}

/**
 * After the commit: a job joins its event's turn and is announced. A failure leaves the row
 * queued, and `reconcile` puts it in the queue later.
 */
export async function announce(deps: RenderDeps, row: JobRow, opts: { head?: boolean } = {}) {
  try {
    await deps.queue.enqueue(requireTenant(), row.id, row.submitted_at.getTime(), opts);
    await publishJob(deps.bus, row);
  } catch (err) {
    deps.log?.warn({ err, job_id: row.id }, "queueing a render job failed");
  }
}

export interface Dropped {
  renders: { asset_id: string; asset_version: number }[];
  live: JobRow[];
}

/**
 * In the transaction that removes asset versions (all of the asset's when `versions` is null):
 * their jobs go first, as the foreign key asks, and their renders' bytes go back. A running job's
 * container notices the row is gone at its next lease renewal and stops.
 */
export async function dropJobs(
  c: SqlClient,
  storage: StorageQuota,
  assetId: string,
  versions: number[] | null,
): Promise<Dropped> {
  const { rows } = await c.query(
    `DELETE FROM screen_render_jobs WHERE asset_id = $1 AND ($2::int[] IS NULL OR asset_version = ANY($2))
     RETURNING ${JOB_COLUMNS}`,
    [assetId, versions],
  );
  const jobs = rows as unknown as JobRow[];
  const renders = jobs.filter((j) => j.state === "succeeded");
  await releaseHeld(
    c,
    storage,
    renders.reduce((sum, j) => sum + Number(j.bytes), 0),
  );
  return {
    renders: renders.map((j) => ({ asset_id: j.asset_id, asset_version: j.asset_version })),
    live: jobs.filter(isLive),
  };
}

/** After the commit of `dropJobs`: the slides go, live jobs end as cancelled. */
export async function afterDrop(deps: RenderDeps, dropped: Dropped): Promise<void> {
  for (const render of dropped.renders) {
    try {
      await rm(renderDir(deps.filesRoot, render.asset_id, render.asset_version), {
        recursive: true,
        force: true,
      });
    } catch (err) {
      deps.log?.warn({ err, asset_id: render.asset_id }, "removing a render failed");
    }
  }
  for (const job of dropped.live) {
    try {
      await deps.queue.remove(requireTenant(), job.id);
      await publishJob(deps.bus, { ...job, state: "cancelled" });
    } catch (err) {
      deps.log?.warn({ err, job_id: job.id }, "ending a dropped render job failed");
    }
  }
}

/**
 * A running job whose lease ran out lost its container (plan #184, R11): it goes back to the
 * head of its event's list once, then fails. A lease renewed meanwhile leaves it alone.
 */
export async function recoverLost(deps: RenderDeps, jobId: string): Promise<void> {
  const now = new Date(deps.now());
  const lost = await deps.db.tenant(async (c) => {
    const job = await readJob(c, jobId, true);
    if (job === null || job.state !== "running") return null;
    if (job.lease_until !== null && job.lease_until > now) {
      // Renewed after the lease index fell due: keep watching it, or it would never be seen again.
      await deps.queue.watch(requireTenant(), jobId, job.lease_until.getTime());
      return null;
    }
    const again = job.attempts < MAX_ATTEMPTS;
    const { rows } = await c.query(
      again
        ? `UPDATE screen_render_jobs SET state = 'queued', started_at = NULL, lease_until = NULL,
             reserved_bytes = 0
           WHERE id = $1 RETURNING ${JOB_COLUMNS}`
        : `UPDATE screen_render_jobs SET state = 'failed', finished_at = $2, lease_until = NULL,
             reserved_bytes = 0, error_code = 'renderer_failed', error_message = $3
           WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
      again ? [jobId] : [jobId, now, LOST_TWICE],
    );
    // The lost attempt's bytes: the row no longer holds them, so they go back once.
    await releaseHeld(c, deps.storage, Number(job.reserved_bytes));
    return { row: rows[0] as unknown as JobRow, attempt: job.attempts };
  });
  if (lost === null) return;
  await rm(attemptDir(deps.filesRoot, jobId, lost.attempt), { recursive: true, force: true });
  if (lost.row.state === "queued") await announce(deps, lost.row, { head: true });
  else await publishJob(deps.bus, lost.row);
}

const reconciled = new WeakMap<RenderQueue, Map<string, number>>();

/**
 * Rebuilds the current event's queue entries from its queued rows and recovers its lost running
 * jobs, at most once a minute per container. Valkey keeps its data (append-only file), so this
 * matters after a lost Valkey or a crash between a commit and its enqueue.
 */
export async function reconcile(deps: RenderDeps): Promise<void> {
  const tenant = requireTenant();
  const seen = reconciled.get(deps.queue) ?? new Map<string, number>();
  reconciled.set(deps.queue, seen);
  const last = seen.get(tenant);
  if (last !== undefined && deps.now() - last < RECONCILE_MS) return;
  seen.set(tenant, deps.now());
  const rows = await deps.db.tenant(
    async (c) =>
      (
        await c.query(
          `SELECT ${JOB_COLUMNS} FROM screen_render_jobs WHERE state IN ('queued', 'running')
           ORDER BY submitted_at, id`,
        )
      ).rows as unknown as JobRow[],
  );
  for (const row of rows) {
    if (row.state === "queued") {
      await deps.queue.enqueue(tenant, row.id, row.submitted_at.getTime());
    } else if (row.lease_until === null || row.lease_until.getTime() <= deps.now()) {
      await recoverLost(deps, row.id);
    }
  }
}
