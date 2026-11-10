/**
 * Assets written straight into the tables, for tests about what uses them: an upload runs the
 * image, probe and render work those tests do not need.
 */
import { createHash } from "node:crypto";
import type { Harness } from "./helpers.js";

export interface SeedAsset {
  id: string;
  kind: "image" | "video" | "audio" | "pptx" | "pdf" | "web" | "youtube";
  tenant?: string;
  /** A video's measured length. */
  durationSeconds?: number;
  /** A deck's rendered slides; left out, the deck has no render yet. */
  slides?: number;
  health?: "ok" | "degraded" | "error";
}

export async function seedAssets(h: Harness, ...assets: SeedAsset[]): Promise<void> {
  for (const a of assets) {
    const tenant = a.tenant ?? "alpha";
    const link = a.kind === "web" || a.kind === "youtube";
    await h.pool.query(
      `INSERT INTO screen_assets (tenant_id, id, kind, title, url, health) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant, a.id, a.kind, a.id, link ? `https://example.org/${a.id}` : null, a.health ?? "ok"],
    );
    if (link) continue;
    const file = `${createHash("sha256").update(`${tenant}/${a.id}`).digest("hex")}.bin`;
    await h.pool.query(
      `INSERT INTO screen_files (tenant_id, name, mime_type, size_bytes) VALUES ($1, $2, 'application/octet-stream', 1)`,
      [tenant, file],
    );
    await h.pool.query(
      `INSERT INTO screen_asset_versions (tenant_id, asset_id, version, file, original_name, duration_seconds)
       VALUES ($1, $2, 1, $3, $2, $4)`,
      [tenant, a.id, file, a.durationSeconds ?? null],
    );
    if (a.slides === undefined) continue;
    const slides = Array.from({ length: a.slides }, (_, i) => ({
      index: i + 1,
      width: 1920,
      height: 1080,
      bytes: 1,
    }));
    await h.pool.query(
      `INSERT INTO screen_render_jobs (tenant_id, id, asset_id, asset_version, state, submitted_at, slides)
       VALUES ($1, $2, $3, 1, 'succeeded', now(), $4)`,
      [tenant, `rj_${a.id}`, a.id, JSON.stringify(slides)],
    );
  }
}
