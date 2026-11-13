/**
 * What the Content page's playlists and Push now read (#264): the event's playlists, the chosen
 * one as the document its `PUT` takes back with the windows that play it, every asset the builder
 * may add (the library page shows only 50), and the pushes playing now. The contract has no list
 * of pushes; the page is screen's own, so it reads screen's table as `activePushes` does.
 */
import { ASSET_SELECT } from "../assets/store.js";
import type { AssetKind, AssetRow } from "../assets/store.js";
import { loadPlaylists } from "../content/playlists.js";
import type { PlaylistView } from "../content/playlists.js";
import type { Db } from "../db.js";

/** What the builder knows of an asset (static/studio-playlist-builder.d.ts, `BuilderAsset`). */
export interface LibraryAsset {
  kind: AssetKind;
  title: string;
  duration_seconds: number | null;
  slides: number | null;
  health: AssetRow["health"];
}

export interface ActivePushView {
  id: string;
  zones: string[];
  /** The playlist's name or the asset's title; null once it is gone. */
  what: string | null;
  until: string;
}

export interface PlaylistsData {
  playlists: Pick<PlaylistView, "id" | "name" | "type">[];
  chosen: (PlaylistView & { windows: number }) | null;
  library: Record<string, LibraryAsset>;
  pushes: ActivePushView[];
}

export async function readPlaylists(db: Db, nowMs: number, wanted: string): Promise<PlaylistsData> {
  return db.tenant(async (c) => {
    const all = await loadPlaylists(c);
    // Without a choice, the first one a window or a push can play, as mockup 10 opens.
    const chosen =
      all.find((p) => p.id === wanted) ?? all.find((p) => p.type !== "break") ?? all[0] ?? null;
    const windows =
      chosen === null
        ? 0
        : Number(
            (
              await c.query("SELECT count(*) AS n FROM screen_schedules WHERE playlist_id = $1", [
                chosen.id,
              ])
            ).rows[0]?.n ?? 0,
          );
    // Sounds are Moments' claim sounds: no playlist plays them.
    const assets = await c.query(`${ASSET_SELECT} WHERE a.kind <> 'audio' ORDER BY a.title, a.id`);
    const library: Record<string, LibraryAsset> = {};
    for (const r of assets.rows as unknown as AssetRow[]) {
      library[r.id] = {
        kind: r.kind,
        title: r.title,
        duration_seconds: r.duration_seconds,
        slides: r.render_state === "succeeded" ? r.slide_count : null,
        health: r.health,
      };
    }
    const pushes = await c.query(
      `SELECT p.id, p.zones, p.until, COALESCE(l.name, a.title) AS what
       FROM screen_pushes p
       LEFT JOIN screen_playlists l ON l.tenant_id = p.tenant_id AND l.id = p.playlist_id
       LEFT JOIN screen_assets a ON a.tenant_id = p.tenant_id AND a.id = p.asset_id
       WHERE p.ended_at IS NULL AND p.until > $1 ORDER BY p.created_at DESC, p.id DESC`,
      [new Date(nowMs)],
    );
    return {
      playlists: all.map(({ id, name, type }) => ({ id, name, type })),
      chosen: chosen === null ? null : { ...chosen, windows },
      library,
      pushes: pushes.rows.map((r) => ({
        id: r.id as string,
        zones: r.zones as string[],
        what: r.what as string | null,
        until: (r.until as Date).toISOString(),
      })),
    };
  });
}
