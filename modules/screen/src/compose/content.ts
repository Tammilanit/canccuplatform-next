/**
 * The reads behind the content widgets (`playlist`, `photo`, `checkin_qr`), `stats` and the graphs:
 * the zone's stored playback state with the event's content, the photos, notify's code and the counts. The
 * choices themselves are the pure `playlistNow`, `photoWall` and `statsView`.
 */
import type { SqlClient, TenantContext } from "@canccu/kit";
import { playbackOf, readAssetRows } from "../assets/reader.js";
import { fileUrl } from "../assets/store.js";
import type { AssetRow } from "../assets/store.js";
import type { Db } from "../db.js";
import type { Kv } from "../kv.js";
import { loadContent } from "../tick/content.js";
import { loadZoneState } from "../tick/run.js";
import { playlistNow } from "./playing.js";
import type { AssetFile, PlayingInput } from "./playing.js";
import { photoWall, wallKey, wallSettings } from "./photos.js";
import type { PhotoRow } from "./photos.js";
import type { Layout, Props, WidgetEntry } from "./layouts.js";
import { presenceFacts, readCounts, readStats } from "./stats.js";
import type { Sources } from "./sources.js";
import type { ZoneFacts } from "./widgets.js";

/**
 * A code whose rotation this clock has already passed (notify's clock a little behind ours) is
 * asked for again this soon, rather than left expired on screen until the next refresh.
 */
export const ROTATE_RETRY_MS = 1000;
const DAY_MS = 24 * 3600_000;

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

/**
 * Every widget entry of the zone's layouts, as build.ts picks them, also those of a box that waits
 * for its source and so is not in the built regions: its source must be read for it to come back.
 */
export function entriesOf(
  views: readonly { layout: Layout }[],
  zoneRegions: Record<string, Record<string, unknown>>,
): WidgetEntry[] {
  return views.flatMap((view) =>
    view.layout.regions.flatMap((r) => {
      const own = zoneRegions[r.id]?.widgets;
      return Array.isArray(own) ? (own as WidgetEntry[]) : r.widgets;
    }),
  );
}

/** The props of every `photo` entry. */
export const photoProps = (entries: readonly WidgetEntry[]): Props[] =>
  entries.filter((e) => e.widget === "photo").map((e) => e.props ?? {});

export interface ContentDeps {
  db: Db;
  kv: Kv;
  sources: Sources;
}

/**
 * The content widgets' facts for the widget types the zone shows (`photos`: the props of each of
 * its `photo` entries), and the next instant one of them changes by itself (a frame ends, the wall
 * turns, the code rotates, a count is due again), so the push channel rebuilds the zone then and
 * its screens get the change as a `widget` message.
 */
export async function contentFacts(
  deps: ContentDeps,
  ctx: TenantContext,
  zoneKey: string,
  used: ReadonlySet<string>,
  photos: readonly Props[],
  nowMs: number,
): Promise<{ facts: Partial<ZoneFacts>; changesAt: number | null }> {
  const facts: Partial<ZoneFacts> = {};
  const changes: number[] = [];
  // The wall is off unless the event turns it on (flag `screen.photos`).
  const wall = ctx.flags["screen.photos"] === true;
  const counted = wall && used.has("today_numbers");
  if (used.has("playlist") || used.has("photo") || counted) {
    await deps.db.tenant(async (c) => {
      if (used.has("playlist")) {
        const now = playlistNow(await readPlaying(c, zoneKey, nowMs), nowMs);
        facts.playlist = now?.view ?? null;
        if (now !== null) changes.push(now.changesAt);
      }
      const rows = wall && (used.has("photo") || counted) ? await readPhotos(c) : [];
      if (counted) facts.photosToday = rows.filter((r) => r.created_at > nowMs - DAY_MS).length;
      if (used.has("photo")) {
        const walls: Record<string, Record<string, unknown> | null> = {};
        for (const props of photos) {
          const settings = wallSettings(props);
          const key = wallKey(settings);
          if (key in walls) continue;
          const now = photoWall(rows, settings, zoneKey, nowMs);
          walls[key] = now?.view ?? null;
          if (typeof now?.changesAt === "number") changes.push(now.changesAt);
        }
        facts.photos = walls;
      }
    });
  }
  if (used.has("checkin_qr")) {
    // `arrival` only: a tournament's purpose comes with the tournament module's events.
    const code = await deps.sources.checkinCode(ctx.tenant_id, "arrival");
    facts.checkin = code;
    if (code !== null) {
      const rotatesAt = Date.parse(code.rotates_at);
      changes.push(rotatesAt > nowMs ? rotatesAt : nowMs + ROTATE_RETRY_MS);
    }
  }
  const graphs = used.has("activity_graph") || used.has("today_numbers");
  if (used.has("stats") || graphs) {
    const counts = await readCounts(deps.kv, nowMs);
    if (graphs) facts.presence = presenceFacts(counts, ctx.time_zone, nowMs);
    if (used.has("stats")) {
      const { kv, sources } = deps;
      const stats = await readStats(kv, sources, ctx.tenant_id, ctx.time_zone, nowMs, counts);
      facts.stats = stats.view;
      if (stats.changesAt !== null) changes.push(stats.changesAt);
    }
  }
  const future = changes.filter((t) => Number.isFinite(t) && t > nowMs);
  return { facts, changesAt: future.length === 0 ? null : Math.min(...future) };
}
