/**
 * The playable facts of assets (kind, length, slides, health) as the tick, simulate and the
 * content checks take them: the current version's length and the slide count of its render.
 */
import type { SqlClient } from "@canccu/kit";
import type { Assets, PlaybackAsset } from "../playback/timeline.js";
import { ASSET_SELECT, type AssetRow } from "./store.js";

/**
 * `lock` holds the assets against a delete until the caller commits: the delete locks the row
 * before it looks for uses, so it then sees the playlist item or push that was being written.
 */
export async function readAssets(
  c: SqlClient,
  ids: readonly string[],
  lock = false,
): Promise<Assets> {
  if (ids.length === 0) return new Map();
  const { rows } = await c.query(
    `${ASSET_SELECT} WHERE a.id = ANY($1)${lock ? " FOR KEY SHARE OF a" : ""}`,
    [[...ids]],
  );
  return new Map(
    (rows as unknown as AssetRow[]).map((r): [string, PlaybackAsset] => [
      r.id,
      {
        id: r.id,
        kind: r.kind,
        durationSeconds: r.duration_seconds,
        slideCount: r.render_state === "succeeded" ? r.slide_count : null,
        health: r.health,
      },
    ]),
  );
}
