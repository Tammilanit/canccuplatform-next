/**
 * Replace, revert and delete: the writes that end a file's use (contracts/screen.md, Content and
 * scheduling). Ported from the legacy `asset-replace.ts` and the delete of `asset-catalog.ts`:
 * the id and title stay, the previous version is kept for one undo, and an older undo version
 * goes. Versions are rows here, not renamed files, so a revert only moves a pointer back.
 */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { actorOf, assertWritable, invalidRequest, needs, notFound, tenantOf } from "../http.js";
import { lockFiles } from "./files.js";
import { ASSET_USES, FILE_KINDS, readAsset, viewAsset } from "./store.js";
import type { AssetRow } from "./store.js";
import { prepare, readUpload } from "./upload.js";
import { fileName, writeDroppingFiles, writeWithFile } from "./write.js";
import type { AssetDeps } from "./write.js";

const KIND_NAMES: Record<string, string> = {
  image: "an image",
  video: "a video",
  audio: "a sound",
  pptx: "a PowerPoint deck",
  pdf: "a PDF",
};

async function versionFile(
  c: SqlClient,
  id: string,
  version: number | null,
): Promise<string | null> {
  if (version === null) return null;
  const { rows } = await c.query(
    "SELECT file FROM screen_asset_versions WHERE asset_id = $1 AND version = $2",
    [id, version],
  );
  return (rows[0]?.file as string | undefined) ?? null;
}

async function fileAsset(c: SqlClient, id: string): Promise<AssetRow> {
  const row = await readAsset(c, id, true);
  if (row === null) throw notFound();
  return row;
}

const onlyFiles = () =>
  invalidRequest("Only an uploaded file can be replaced; add a new link instead.");

export function versionRoutes(app: FastifyInstance, deps: AssetDeps): void {
  const write = { preHandler: needs(deps.rights, "screen.content.write") };

  app.post("/api/screen/assets/:asset_id/replace", write, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const { asset_id: id } = request.params as { asset_id: string };
    // A cheap look first, so a missing asset or a link costs no upload, image or probe work; the
    // locked read in the transaction below decides.
    const found = await deps.db.tenant((c) => readAsset(c, id));
    if (found === null) throw notFound();
    if (!FILE_KINDS.includes(found.kind)) throw onlyFiles();
    const upload = await readUpload(request, deps.filesRoot);
    const prepared = await prepare(deps.filesRoot, upload.temp, deps.ffprobe);
    return writeWithFile(deps, prepared, async (c, placeFile) => {
      const before = await fileAsset(c, id);
      if (!FILE_KINDS.includes(before.kind)) throw onlyFiles();
      if (before.kind !== prepared.kind) {
        throw invalidRequest(
          `This asset is ${KIND_NAMES[before.kind]}; replace it with ${KIND_NAMES[before.kind]}, not ${KIND_NAMES[prepared.kind]}.`,
        );
      }
      const discarded = await versionFile(c, id, before.prev_version);
      await lockFiles(c, [fileName(prepared), ...(discarded ? [discarded] : [])]);
      const file = await placeFile();
      const version = before.last_version + 1;
      if (before.prev_version !== null) {
        await c.query("DELETE FROM screen_asset_versions WHERE asset_id = $1 AND version = $2", [
          id,
          before.prev_version,
        ]);
      }
      await c.query(
        `INSERT INTO screen_asset_versions (asset_id, version, file, original_name, duration_seconds)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, version, file, upload.filename.slice(0, 255), prepared.duration_seconds],
      );
      await c.query(
        `UPDATE screen_assets SET version = $2, prev_version = $3, last_version = $2,
           updated_at = now() WHERE id = $1`,
        [id, version, before.version],
      );
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.asset.replaced",
        target: { type: "asset", id },
        changes: {
          version: { from: before.version, to: version },
          file: { from: before.file, to: file },
        },
      });
      return { result: await viewAsset(c, id), unused: discarded ? [discarded] : [] };
    });
  });

  app.post("/api/screen/assets/:asset_id/revert", write, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const { asset_id: id } = request.params as { asset_id: string };
    return writeDroppingFiles(deps, async (c) => {
      const before = await fileAsset(c, id);
      if (before.prev_version === null) {
        throw new KitError("This asset has no earlier version to go back to.", {
          status: 409,
          code: "nothing_to_revert",
        });
      }
      await c.query("DELETE FROM screen_asset_versions WHERE asset_id = $1 AND version = $2", [
        id,
        before.version,
      ]);
      await c.query(
        `UPDATE screen_assets SET version = prev_version, prev_version = NULL, updated_at = now()
         WHERE id = $1`,
        [id],
      );
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.asset.reverted",
        target: { type: "asset", id },
        changes: { version: { from: before.version, to: before.prev_version } },
      });
      return {
        result: await viewAsset(c, id),
        unused: before.file ? [before.file] : [],
      };
    });
  });

  app.delete("/api/screen/assets/:asset_id", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const { asset_id: id } = request.params as { asset_id: string };
    await deps.settings.ensure();
    await writeDroppingFiles(deps, async (c) => {
      const before = await fileAsset(c, id);
      for (const use of ASSET_USES) {
        const why = await use(c, id, deps.settings);
        if (why !== null) throw new KitError(why, { status: 409, code: "asset_in_use" });
      }
      const { rows } = await c.query(
        "DELETE FROM screen_asset_versions WHERE asset_id = $1 RETURNING file",
        [id],
      );
      await c.query("DELETE FROM screen_assets WHERE id = $1", [id]);
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.asset.deleted",
        target: { type: "asset", id },
        changes: { title: { from: before.title, to: null } },
      });
      return { result: null, unused: rows.map((r) => r.file as string) };
    });
    return reply.status(204).send();
  });
}
