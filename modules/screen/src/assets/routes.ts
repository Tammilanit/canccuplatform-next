/**
 * The asset library (contracts/screen.md, Content and scheduling): list, upload a file or add a
 * web or YouTube link, check names before an upload, rename or reset health. The list is
 * catalog.ts; the add paths are ported from the legacy `web-asset.ts` and `youtube-asset.ts`.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { TenantContext } from "@canccu/kit";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  newId,
  notFound,
  tenantOf,
} from "../http.js";
import { probeYouTube, webUrl, youtubeLink } from "./links.js";
import { listAssets } from "./catalog.js";
import { isDeck, readAsset, viewAsset } from "./store.js";
import type { AssetKind } from "./store.js";
import { assetTitle, prepare, readUpload, uploadTitle } from "./upload.js";
import { writeWithFile } from "./write.js";
import { announce, submitJob } from "../render/jobs.js";
import type { JobRow } from "../render/jobs.js";
import type { AssetDeps } from "./write.js";

/** `screen.web` (default on): web and YouTube assets may be added; Studio offers them by it too. */
export const webOn = (ctx: TenantContext): boolean => ctx.flags["screen.web"] !== false;

function featureOn(ctx: TenantContext): void {
  if (!webOn(ctx)) {
    throw new KitError("Web and YouTube assets are off for this event.", {
      status: 403,
      code: "feature_off",
    });
  }
}

/** A query parameter given once, or undefined; `?q=a&q=b` is a client's mistake, not ours. */
function param(query: unknown, name: string): string | undefined {
  const value = (query as Record<string, unknown>)[name];
  if (value === undefined || typeof value === "string") return value;
  throw invalidRequest(`\`${name}\` may be given once.`);
}

async function addLink(deps: AssetDeps, request: FastifyRequest, ctx: TenantContext) {
  featureOn(ctx);
  const input = body(request);
  const title = assetTitle(input.title);
  if (typeof input.url !== "string") throw invalidRequest("`url` is required.");
  let kind: AssetKind;
  let url: string;
  let health: { health: string; health_message: string | null } = {
    health: "ok",
    health_message: null,
  };
  if (input.kind === "web") {
    await deps.settings.ensure();
    kind = "web";
    url = webUrl(input.url, deps.settings.get("web_allowlist", []));
  } else if (input.kind === "youtube") {
    kind = "youtube";
    const link = youtubeLink(input.url);
    url = link.embed;
    health = await probeYouTube(link.watch, deps.fetch);
  } else {
    throw invalidRequest("`kind` must be web or youtube; upload files as multipart/form-data.");
  }
  const id = newId("as");
  return deps.db.tenant(async (c) => {
    await c.query(
      `INSERT INTO screen_assets (id, kind, title, url, health, health_message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, kind, title, url, health.health, health.health_message],
    );
    await deps.audit({
      tenant_id: ctx.tenant_id,
      actor_user_id: actorOf(request),
      action: "screen.asset.added",
      target: { type: "asset", id },
      changes: { kind: { from: null, to: kind }, url: { from: null, to: url } },
    });
    return await viewAsset(c, id, deps.now());
  });
}

async function addFile(deps: AssetDeps, request: FastifyRequest, ctx: TenantContext) {
  const upload = await readUpload(request, deps.filesRoot);
  const prepared = await prepare(deps.filesRoot, upload.temp, deps.ffprobe);
  const id = newId("as");
  const title = uploadTitle(upload);
  let job = null as JobRow | null;
  const asset = await writeWithFile(deps, prepared, async (c, placeFile) => {
    const file = await placeFile();
    await c.query("INSERT INTO screen_assets (id, kind, title) VALUES ($1, $2, $3)", [
      id,
      prepared.kind,
      title,
    ]);
    await c.query(
      `INSERT INTO screen_asset_versions (asset_id, version, file, original_name, duration_seconds)
       VALUES ($1, 1, $2, $3, $4)`,
      [id, file, upload.filename.slice(0, 255), prepared.duration_seconds],
    );
    await deps.audit({
      tenant_id: ctx.tenant_id,
      actor_user_id: actorOf(request),
      action: "screen.asset.added",
      target: { type: "asset", id },
      changes: { kind: { from: null, to: prepared.kind }, file: { from: null, to: file } },
    });
    if (isDeck(prepared.kind)) {
      const who = { tenant_id: ctx.tenant_id, actor_user_id: actorOf(request) };
      job = (await submitJob(c, deps, who, id, 1)).row;
    }
    return { result: await viewAsset(c, id, deps.now()), unused: [], freed: 0 };
  });
  if (job !== null) await announce(deps, job);
  return asset;
}

export function assetRoutes(app: FastifyInstance, deps: AssetDeps): void {
  const read = { preHandler: needs(deps.rights, "screen.content.read") };
  const write = { preHandler: needs(deps.rights, "screen.content.write") };

  app.get("/api/screen/assets", read, (request) =>
    listAssets(deps, {
      q: param(request.query, "q"),
      kind: param(request.query, "kind"),
      cursor: param(request.query, "cursor"),
    }),
  );

  app.post("/api/screen/assets", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const asset = request.isMultipart()
      ? await addFile(deps, request, ctx)
      : await addLink(deps, request, ctx);
    return reply.status(201).send(asset);
  });

  app.post("/api/screen/assets/name-check", write, async (request) => {
    const names = body(request).names;
    if (!Array.isArray(names) || names.length > 100) {
      throw invalidRequest("`names` must be a list of at most 100 names.");
    }
    const wanted = names.map((n) => {
      if (typeof n !== "string" || n.length > 200) {
        throw invalidRequest("Each name must be text of at most 200 characters.");
      }
      return n;
    });
    // The same rule as a title an upload gets from its file name: trimmed, any case.
    const { rows } = await deps.db.tenant((c) =>
      c.query(
        `SELECT lower(title) AS key, id FROM screen_assets
         WHERE lower(title) = ANY($1) ORDER BY created_at, id`,
        [wanted.map((n) => n.trim().toLowerCase())],
      ),
    );
    return {
      results: wanted.map((name) => ({
        name,
        asset_ids: rows.filter((r) => r.key === name.trim().toLowerCase()).map((r) => r.id),
      })),
    };
  });

  app.patch("/api/screen/assets/:asset_id", write, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const { asset_id: id } = request.params as { asset_id: string };
    const input = body(request);
    const title = input.title === undefined ? undefined : assetTitle(input.title);
    if (input.reset_health !== undefined && typeof input.reset_health !== "boolean") {
      throw invalidRequest("`reset_health` must be true or false.");
    }
    return deps.db.tenant(async (c) => {
      const before = await readAsset(c, id, true);
      if (before === null) throw notFound();
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (title !== undefined && title !== before.title)
        changes.title = { from: before.title, to: title };
      // A reset clears a YouTube error so the screens try the video again (legacy behaviour).
      if (input.reset_health === true && before.health !== "ok") {
        changes.health = { from: before.health, to: "ok" };
      }
      if (Object.keys(changes).length > 0) {
        await c.query(
          `UPDATE screen_assets SET title = $2, health = $3,
             health_message = CASE WHEN $3 = 'ok' THEN NULL ELSE health_message END,
             updated_at = now()
           WHERE id = $1`,
          [id, title ?? before.title, changes.health ? "ok" : before.health],
        );
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actorOf(request),
          action: "screen.asset.changed",
          target: { type: "asset", id },
          changes,
        });
      }
      return await viewAsset(c, id, deps.now());
    });
  });
}
