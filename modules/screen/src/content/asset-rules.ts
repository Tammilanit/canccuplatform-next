/**
 * What playlists and pushes may hold, checked against the assets themselves: this event's
 * assets only, with the kind rules of the legacy signage `playlist-builder.ts`; and slide ranges
 * kept within a deck that changed, as its `asset-replace.ts` did (`clampToSlideCount`).
 */
import type { SqlClient } from "@canccu/kit";
import { isDeck } from "../assets/store.js";
import { readAssets } from "../assets/reader.js";
import { invalidRequest } from "../http.js";
import type { PlaylistInput } from "./input.js";

const NO_SUCH_ASSET = "this event has no such asset.";

/** In the caller's transaction, which then holds the assets against a delete until it commits. */
export async function checkItemAssets(c: SqlClient, playlist: PlaylistInput): Promise<void> {
  const assets = await readAssets(c, [...new Set(playlist.items.map((i) => i.asset_id))], true);
  // A slideshow shows each image for the playlist's own dwell, so an item's length is unused.
  const slideshow = playlist.type === "slideshow" || playlist.break?.mode === "slideshow";
  playlist.items.forEach((item, i) => {
    const where = `items[${i}]`;
    const asset = assets.get(item.asset_id);
    if (asset === undefined) throw invalidRequest(`\`${where}.asset_id\`: ${NO_SUCH_ASSET}`);
    if (item.duration_seconds === null && asset.kind !== "video" && !slideshow) {
      throw invalidRequest(
        `\`${where}.duration_seconds\`: only a video can play for its own length (null); give the seconds.`,
      );
    }
    const slideFields = [item.slide_start, item.slide_end, item.slide_seconds];
    if (!isDeck(asset.kind)) {
      if (slideFields.some((v) => v !== null)) {
        throw invalidRequest(
          `\`${where}\`: \`slide_start\`, \`slide_end\` and \`slide_seconds\` go only on a PowerPoint deck or a PDF.`,
        );
      }
      return;
    }
    // An unrendered deck has no count yet; its render clamps the range (`clampToDeck`).
    const count = asset.slideCount;
    if (count !== null && Math.max(item.slide_start ?? 0, item.slide_end ?? 0) > count) {
      throw invalidRequest(`\`${where}\`: the deck has ${count} slides.`);
    }
  });
}

/** In the caller's transaction, as `checkItemAssets`. */
export async function checkPushAsset(c: SqlClient, assetId: string): Promise<void> {
  if (!(await readAssets(c, [assetId], true)).has(assetId)) {
    throw invalidRequest(`\`asset_id\`: ${NO_SUCH_ASSET}`);
  }
}

/**
 * Fits the slide ranges of the deck's playlist items to its current version's render, if it has
 * one: a start past the end shows the whole deck, an end past it ends there. The playlists it
 * changes get a new revision, so an editor's stale copy is a conflict, not a silent undo. It is
 * the replace's or revert's consequence, audited with it, so it writes no audit entry of its own.
 */
export async function clampToDeck(c: SqlClient, assetId: string): Promise<void> {
  const { rows } = await c.query(
    `SELECT jsonb_array_length(j.slides) AS slides FROM screen_assets a
     JOIN screen_render_jobs j ON j.tenant_id = a.tenant_id AND j.asset_id = a.id
       AND j.asset_version = a.version AND j.state = 'succeeded'
     WHERE a.id = $1`,
    [assetId],
  );
  const count = rows[0]?.slides as number | undefined;
  if (count === undefined) return;
  await c.query(
    `WITH clamped AS (
       UPDATE screen_playlist_items SET
         slide_start = CASE WHEN slide_start > $2 THEN NULL ELSE slide_start END,
         slide_end = CASE WHEN slide_start > $2 THEN NULL WHEN slide_end > $2 THEN $2 ELSE slide_end END
       WHERE asset_id = $1 AND (slide_start > $2 OR slide_end > $2)
       RETURNING playlist_id
     )
     UPDATE screen_playlists SET revision = revision + 1
     WHERE id IN (SELECT playlist_id FROM clamped)`,
    [assetId, count],
  );
}
