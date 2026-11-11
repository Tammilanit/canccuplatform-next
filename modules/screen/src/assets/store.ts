/** Asset rows and the contract's `Asset` view (contracts/screen.openapi.yaml, Asset). */
import type { SqlClient } from "@canccu/kit";
import type { Settings } from "../health.js";
import { notFound } from "../http.js";

export type AssetKind = "image" | "video" | "audio" | "pptx" | "pdf" | "web" | "youtube";
export const ASSET_KINDS: readonly AssetKind[] = [
  "image",
  "video",
  "audio",
  "pptx",
  "pdf",
  "web",
  "youtube",
];
export const FILE_KINDS: readonly AssetKind[] = ["image", "video", "audio", "pptx", "pdf"];

/** A PPTX or PDF deck: the kinds the render job draws as slides. */
export const isDeck = (kind: string): boolean => kind === "pptx" || kind === "pdf";

export interface AssetRow {
  id: string;
  kind: AssetKind;
  title: string;
  version: number;
  prev_version: number | null;
  last_version: number;
  url: string | null;
  health: "ok" | "degraded" | "error";
  health_message: string | null;
  created_at: Date;
  file: string | null;
  mime_type: string | null;
  size_bytes: string | null;
  duration_seconds: number | null;
  render_state: string | null;
  slide_count: number | null;
}

/**
 * The asset with its current version's file and the state of that version's newest render job;
 * `FOR UPDATE` locks only the asset row.
 */
export const ASSET_SELECT = `
  SELECT a.id, a.kind, a.title, a.version, a.prev_version, a.last_version, a.url, a.health,
         a.health_message, a.created_at, v.file, f.mime_type, f.size_bytes, v.duration_seconds,
         r.state AS render_state, r.slide_count
  FROM screen_assets a
  LEFT JOIN screen_asset_versions v
    ON v.tenant_id = a.tenant_id AND v.asset_id = a.id AND v.version = a.version
  LEFT JOIN screen_files f ON f.tenant_id = v.tenant_id AND f.name = v.file
  LEFT JOIN LATERAL (
    SELECT j.state, jsonb_array_length(j.slides) AS slide_count FROM screen_render_jobs j
    WHERE j.tenant_id = a.tenant_id AND j.asset_id = a.id AND j.asset_version = a.version
    ORDER BY j.submitted_at DESC, j.id DESC LIMIT 1
  ) r ON true`;

export async function readAsset(c: SqlClient, id: string, lock = false): Promise<AssetRow | null> {
  const { rows } = await c.query(
    `${ASSET_SELECT} WHERE a.id = $1${lock ? " FOR UPDATE OF a" : ""}`,
    [id],
  );
  return (rows[0] as unknown as AssetRow | undefined) ?? null;
}

/** The contract's `Asset` for `id`, read in the caller's transaction. */
export async function viewAsset(
  c: SqlClient,
  id: string,
  nowMs: number,
): Promise<Record<string, unknown>> {
  const row = await readAsset(c, id);
  if (row === null) throw notFound();
  return assetView(row, (await usedBy(c, [id], nowMs)).get(id) ?? []);
}

/** Where the screens and Studio load a stored file. */
export const fileUrl = (name: string): string => `/api/screen/files/${name}`;

export function assetView(row: AssetRow, users: readonly string[]): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    version: row.version,
    url: row.file === null ? row.url : fileUrl(row.file),
    mime_type: row.mime_type,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    duration_seconds: row.duration_seconds,
    slide_count: row.render_state === "succeeded" ? row.slide_count : null,
    render_state: isDeck(row.kind) ? row.render_state : null,
    health: row.health,
    health_message: row.health_message,
    can_revert: row.prev_version !== null,
    used_by: users,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * `used_by`: by asset, the playlists that hold it and the pushes playing it at `nowMs` (the
 * tick ends an expired push a moment later; it no longer plays, so it no longer counts).
 */
export async function usedBy(
  c: SqlClient,
  ids: readonly string[],
  nowMs: number,
): Promise<Map<string, string[]>> {
  const { rows } = await c.query(
    `SELECT DISTINCT asset_id, playlist_id AS user_id FROM screen_playlist_items WHERE asset_id = ANY($1)
     UNION ALL
     SELECT asset_id, id FROM screen_pushes
     WHERE asset_id = ANY($1) AND ended_at IS NULL AND until > $2
     ORDER BY 1, 2`,
    [[...ids], new Date(nowMs)],
  );
  const users = new Map<string, string[]>();
  for (const r of rows as { asset_id: string; user_id: string }[]) {
    users.set(r.asset_id, [...(users.get(r.asset_id) ?? []), r.user_id]);
  }
  return users;
}

/** What may keep an asset from being deleted, each answering why or null (`asset_in_use`). */
export type AssetUse = (
  c: SqlClient,
  id: string,
  at: { settings: Settings; nowMs: number },
) => Promise<string | null>;
export const ASSET_USES: AssetUse[] = [
  (_c, id, { settings }) =>
    Promise.resolve(
      settings.get("ready_fallback_asset_id", "") === id
        ? "The screens show this asset while their content loads (setting ready_fallback_asset_id). Choose another there first."
        : null,
    ),
  async (c, id) => {
    const { rows } = await c.query(
      `SELECT DISTINCT p.name FROM screen_playlist_items i
       JOIN screen_playlists p ON p.tenant_id = i.tenant_id AND p.id = i.playlist_id
       WHERE i.asset_id = $1 ORDER BY p.name`,
      [id],
    );
    if (rows.length === 0) return null;
    const names = rows.map((r) => `“${r.name as string}”`).join(", ");
    return `Playlists play this asset (${names}). Take it out of them first.`;
  },
  async (c, id, { nowMs }) => {
    const { rows } = await c.query(
      "SELECT 1 FROM screen_pushes WHERE asset_id = $1 AND ended_at IS NULL AND until > $2 LIMIT 1",
      [id, new Date(nowMs)],
    );
    return rows.length === 0
      ? null
      : "This asset is pushed to screens now. Clear the push first, or wait until it ends.";
  },
];
