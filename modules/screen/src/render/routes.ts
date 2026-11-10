/**
 * The render-job API and the slides (contracts/screen.md, The PPTX render job): submit, status,
 * list, cancel, result, and `GET /api/screen/renders/{asset_id}/{asset_version}/slide-<n>.png`,
 * served only from a render row of the current tenant, its path built from that row.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import type { Audit } from "../audit.js";
import { contentAccess } from "../assets/serve.js";
import { isDeck, readAsset } from "../assets/store.js";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  notFound,
  tenantOf,
} from "../http.js";
import {
  JOB_COLUMNS,
  announce,
  isLive,
  publishJob,
  readJob,
  reconcile,
  renderDir,
  slideUrl,
  submitJob,
  viewJobs,
} from "./jobs.js";
import type { JobRow, RenderDeps } from "./jobs.js";

export interface RenderRouteDeps extends RenderDeps {
  rights: RightsChecker;
  audit: Audit;
}

const LIST_LIMIT = 200;
const SLIDE = /^slide-([0-9]{1,3})\.png$/;

/** Rebuilding the queue is housekeeping: a request never fails for it. */
async function tidy(deps: RenderRouteDeps): Promise<void> {
  await reconcile(deps).catch((err: unknown) =>
    deps.log?.warn({ err }, "rebuilding the render queue failed"),
  );
}

async function oneJob(deps: RenderRouteDeps, id: string): Promise<JobRow> {
  const row = await deps.db.tenant((c) => readJob(c, id));
  if (row === null) throw notFound();
  return row;
}

export function renderRoutes(app: FastifyInstance, deps: RenderRouteDeps): void {
  const read = { preHandler: needs(deps.rights, "screen.content.read") };
  const write = { preHandler: needs(deps.rights, "screen.content.write") };

  app.get("/api/screen/render-jobs", read, async (request) => {
    const assetId = (request.query as Record<string, unknown>).asset_id;
    if (assetId !== undefined && typeof assetId !== "string") {
      throw invalidRequest("`asset_id` may be given once.");
    }
    await tidy(deps);
    const rows = await deps.db.tenant(
      async (c) =>
        (
          await c.query(
            `SELECT ${JOB_COLUMNS} FROM screen_render_jobs WHERE ($1::text IS NULL OR asset_id = $1)
             ORDER BY submitted_at DESC, id DESC LIMIT ${LIST_LIMIT}`,
            [assetId ?? null],
          )
        ).rows as unknown as JobRow[],
    );
    return { jobs: await viewJobs(deps, rows) };
  });

  app.post("/api/screen/render-jobs", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const assetId = body(request).asset_id;
    if (typeof assetId !== "string") throw invalidRequest("`asset_id` is required.");
    const { row, created } = await deps.db.tenant(async (c) => {
      const asset = await readAsset(c, assetId, true);
      if (asset === null) throw notFound();
      if (!isDeck(asset.kind)) {
        throw new KitError("Only a PowerPoint deck or a PDF can be rendered.", {
          status: 400,
          code: "not_pptx",
        });
      }
      return submitJob(
        c,
        deps,
        { tenant_id: ctx.tenant_id, actor_user_id: actorOf(request) },
        asset.id,
        asset.version,
      );
    });
    if (created) await announce(deps, row);
    const [view] = await viewJobs(deps, [row]);
    return reply.status(created ? 202 : 200).send(view);
  });

  app.get("/api/screen/render-jobs/:job_id", read, async (request) => {
    await tidy(deps);
    const { job_id: id } = request.params as { job_id: string };
    const [view] = await viewJobs(deps, [await oneJob(deps, id)]);
    return view;
  });

  app.delete("/api/screen/render-jobs/:job_id", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const { job_id: id } = request.params as { job_id: string };
    const row = await deps.db.tenant(async (c) => {
      const job = await readJob(c, id, true);
      if (job === null) throw notFound();
      if (!isLive(job)) {
        throw new KitError(`This job has already ended (${job.state}).`, {
          status: 409,
          code: "render_finished",
        });
      }
      const { rows } = await c.query(
        `UPDATE screen_render_jobs SET state = 'cancelled', finished_at = $2, lease_until = NULL
         WHERE id = $1 RETURNING ${JOB_COLUMNS}`,
        [id, new Date(deps.now())],
      );
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.render.cancelled",
        target: { type: "render_job", id },
        changes: { state: { from: job.state, to: "cancelled" } },
      });
      return rows[0] as unknown as JobRow;
    });
    // A running job's container sees the state at its next lease renewal and hangs up.
    // The cancel is committed: a failure to tidy the queue or announce it must not answer 500,
    // since a retry would then get 409. The dispatcher skips a cancelled job it still takes.
    try {
      await deps.queue.remove(ctx.tenant_id, id);
      await publishJob(deps.bus, row);
    } catch (err) {
      deps.log?.warn({ err, job_id: id }, "announcing a cancelled render job failed");
    }
    return reply.status(204).send();
  });

  app.get("/api/screen/render-jobs/:job_id/result", read, async (request) => {
    const { job_id: id } = request.params as { job_id: string };
    const job = await oneJob(deps, id);
    if (job.state !== "succeeded") {
      throw new KitError(`The slides are not ready: the job is ${job.state}.`, {
        status: 409,
        code: "render_not_finished",
      });
    }
    const slides = job.slides ?? [];
    return {
      job_id: job.id,
      slide_count: slides.length,
      slides: slides.map((s) => ({
        index: s.index,
        url: slideUrl(job.asset_id, job.asset_version, s.index),
        width: s.width,
        height: s.height,
      })),
      warnings: job.warnings ?? [],
    };
  });

  app.get(
    "/api/screen/renders/:asset_id/:asset_version/:slide",
    { preHandler: contentAccess(app, deps) },
    async (request, reply) => {
      const params = request.params as { asset_id: string; asset_version: string; slide: string };
      const index = Number(SLIDE.exec(params.slide)?.[1]);
      const version = Number(params.asset_version);
      if (!Number.isInteger(index) || !/^[0-9]{1,9}$/.test(params.asset_version)) throw notFound();
      const job = await deps.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT ${JOB_COLUMNS} FROM screen_render_jobs
           WHERE asset_id = $1 AND asset_version = $2 AND state = 'succeeded'`,
          [params.asset_id, version],
        );
        return rows[0] as unknown as JobRow | undefined;
      });
      const slide = job?.slides?.find((s) => s.index === index);
      if (job === undefined || slide === undefined) throw notFound();
      const path = `${renderDir(deps.filesRoot, job.asset_id, job.asset_version)}/slide-${slide.index}.png`;
      const size = (await stat(path).catch(() => null))?.size;
      if (size === undefined) throw notFound();
      return reply
        .header("content-type", "image/png")
        .header("content-length", size)
        .header("cache-control", "private, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .send(createReadStream(path));
    },
  );
}
