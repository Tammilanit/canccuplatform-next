/**
 * What the Content page reads (#263): a page of the asset list as the API answers it, each deck's
 * render job of its current version with its place in the fair queue and the slides drawn so
 * far, and, for writers, the kind and use of every asset, which the upload's replace plan needs
 * for the ids `name-check` answers.
 */
import type { SqlClient, TenantContext } from "@canccu/kit";
import { listAssets } from "../assets/catalog.js";
import { webOn } from "../assets/routes.js";
import { isDeck } from "../assets/store.js";
import type { Db } from "../db.js";
import { currentJobs } from "../render/jobs.js";
import type { JobRow } from "../render/jobs.js";
import type { RenderQueue } from "../render/queue.js";
import type { DeckJob } from "./content-render.js";
import type { ContentAsset, ContentData } from "./content-view.js";

export interface ContentDeps {
  db: Db;
  renderQueue: RenderQueue;
  now: () => number;
}

/** A query parameter once, or empty; a repeated one reads as its first, as a form never sends it. */
function param(query: unknown, name: string): string {
  const value = (query as Record<string, unknown>)[name];
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : "";
}

export async function readContent(
  deps: ContentDeps,
  ctx: TenantContext,
  rights: ReadonlySet<string>,
  rawQuery: unknown,
): Promise<ContentData> {
  const query = {
    q: param(rawQuery, "q"),
    kind: param(rawQuery, "kind"),
    after: param(rawQuery, "after"),
  };
  const list = await listAssets(deps, {
    q: query.q,
    kind: query.kind === "" ? undefined : query.kind,
    cursor: query.after === "" ? undefined : query.after,
  });
  const assets = list.assets as unknown as ContentAsset[];
  const decks = assets.filter((a) => isDeck(a.kind)).map((a) => a.id);
  const [rows, index] = await deps.db.tenant(async (c) => [
    decks.length === 0 ? new Map<string, JobRow>() : await currentJobs(c, decks),
    rights.has("screen.content.write") ? await assetIndex(c, deps.now()) : null,
  ]);
  const live = [...rows.values()].filter((r) => r.state === "queued").map((r) => r.id);
  const positions = await deps.renderQueue.positions(ctx.tenant_id, live);
  const jobs = new Map<string, DeckJob>();
  for (const [assetId, r] of rows) {
    jobs.set(assetId, {
      id: r.id,
      asset_version: r.asset_version,
      state: r.state,
      position: r.state === "queued" ? (positions.get(r.id) ?? null) : null,
      slides_done: r.slides_done,
      slides: r.slides,
      warnings: r.warnings,
      error_message: r.error_message,
    });
  }
  return { assets, next: list.next_cursor, jobs, query, webOn: webOn(ctx), index };
}

/** Every asset's kind and whether a playlist or a push playing now holds it, as `used_by` says. */
async function assetIndex(c: SqlClient, nowMs: number): Promise<Record<string, [string, boolean]>> {
  const { rows } = await c.query(
    `SELECT a.id, a.kind,
       EXISTS (SELECT 1 FROM screen_playlist_items i WHERE i.asset_id = a.id)
       OR EXISTS (SELECT 1 FROM screen_pushes p
                  WHERE p.asset_id = a.id AND p.ended_at IS NULL AND p.until > $1) AS used
     FROM screen_assets a`,
    [new Date(nowMs)],
  );
  return Object.fromEntries(
    (rows as { id: string; kind: string; used: boolean }[]).map((r) => [r.id, [r.kind, r.used]]),
  );
}
