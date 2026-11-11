/**
 * The reads behind the content widgets (`playlist`, `photo`, `checkin_qr`): the zone's stored
 * playback state with the event's content, the photos, and notify's code. The choices themselves
 * are the pure `playlistNow` and `photoNow`.
 */
import type { SqlClient, TenantContext } from "@canccu/kit";
import { playbackOf, readAssetRows } from "../assets/reader.js";
import type { AssetRow } from "../assets/store.js";
import type { Db } from "../db.js";
import type { Settings } from "../health.js";
import { loadContent } from "../tick/content.js";
import { loadZoneState } from "../tick/run.js";
import { playlistNow } from "./playing.js";
import type { AssetFile, PlayingInput } from "./playing.js";
import { photoDwell, photoNow } from "./photos.js";
import type { PhotoRow } from "./photos.js";
import type { Sources } from "./sources.js";
import type { ZoneFacts } from "./widgets.js";

const fileUrl = (name: string): string => `/api/screen/files/${name}`;

export async function readPlaying(
  c: SqlClient,
  zoneKey: string,
  nowMs: number,
): Promise<PlayingInput> {
  let rows: AssetRow[] = [];
  // The tick's own read of the content, so the widget plays from exactly what the tick advanced.
  const content = await loadContent(
    c,
    async (client, ids) => {
      rows = await readAssetRows(client, ids);
      return playbackOf(rows);
    },
    nowMs,
  );
  const files = new Map<string, AssetFile>(
    rows.map((r) => [r.id, { url: r.file === null ? r.url : fileUrl(r.file), version: r.version }]),
  );
  return {
    zoneKey,
    state: await loadZoneState(c, zoneKey),
    playlists: content.playlists,
    breakPlaylists: content.breakPlaylists,
    assets: content.assets,
    files,
  };
}

export async function readPhotos(c: SqlClient): Promise<PhotoRow[]> {
  const { rows } = await c.query(
    "SELECT id, file, caption, author_name, posted_at, created_at FROM screen_photos",
  );
  return rows.map((r) => ({
    id: r.id as string,
    url: fileUrl(r.file as string),
    caption: r.caption as string | null,
    author_name: r.author_name as string | null,
    posted_at: (r.posted_at as Date).toISOString(),
    created_at: (r.created_at as Date).getTime(),
  }));
}

export interface ContentDeps {
  db: Db;
  sources: Sources;
  settings: Settings;
}

/**
 * The content widgets' facts for the widget types the zone shows, and the next instant one of
 * them changes by itself (a frame ends, the photo turns, the code rotates), so the push channel
 * rebuilds the zone then and its screens get the change as a `widget` message.
 */
export async function contentFacts(
  deps: ContentDeps,
  ctx: TenantContext,
  zoneKey: string,
  used: ReadonlySet<string>,
  nowMs: number,
): Promise<{ facts: Partial<ZoneFacts>; changesAt: number | null }> {
  const facts: Partial<ZoneFacts> = {};
  const changes: number[] = [];
  if (used.has("playlist") || used.has("photo")) {
    await deps.db.tenant(async (c) => {
      if (used.has("playlist")) {
        const now = playlistNow(await readPlaying(c, zoneKey, nowMs), nowMs);
        facts.playlist = now?.view ?? null;
        if (now !== null) changes.push(now.changesAt);
      }
      if (used.has("photo")) {
        // The carousel is off unless the event turns it on (flag `screen.photos`).
        const now =
          ctx.flags["screen.photos"] === true
            ? photoNow(await readPhotos(c), photoDwell(deps.settings), nowMs)
            : null;
        facts.photo = now?.view ?? null;
        if (now !== null) changes.push(now.changesAt);
      }
    });
  }
  if (used.has("checkin_qr")) {
    // `arrival` only: a tournament's purpose comes with the tournament module's events.
    const code = await deps.sources.checkinCode(ctx.tenant_id, "arrival");
    facts.checkin = code;
    if (code !== null) changes.push(Date.parse(code.rotates_at));
  }
  const future = changes.filter((t) => Number.isFinite(t) && t > nowMs);
  return { facts, changesAt: future.length === 0 ? null : Math.min(...future) };
}
