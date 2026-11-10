/**
 * An event's content as the pure scheduler and playback cores take it: one read shared by the
 * tick and simulate, so "what would play" is worked out from exactly what the tick plays.
 */
import type { SqlClient } from "@canccu/kit";
import { loadAgendaItems } from "../content/agenda.js";
import { loadPlaylists, type PlaylistView } from "../content/playlists.js";
import { activePushes, type ActivePush } from "../content/push.js";
import type { BreakPlaylist } from "../playback/break-play.js";
import type { BreakInput } from "../playback/breaks.js";
import type { Assets, PlaybackPlaylist } from "../playback/timeline.js";
import type { AgendaTimes, ScheduleWindow } from "../schedule/winner.js";

/**
 * The playable facts of the assets named (kind, length, slides, health). The assets slice
 * (#217) reads them from its tables; until then main passes `noAssets`, so nothing is playable
 * and the tick keeps what plays without frames.
 */
export type AssetReader = (c: SqlClient, ids: readonly string[]) => Promise<Assets>;
export const noAssets: AssetReader = () => Promise.resolve(new Map());

export interface EventContent {
  zones: { key: string; layoutId: string | null }[];
  windows: ScheduleWindow[];
  /** Regular and slideshow playlists, by id. */
  playlists: Map<string, PlaybackPlaylist>;
  breakPlaylists: BreakPlaylist[];
  playlistPriorities: Map<string, number>;
  agendaItems: Map<string, AgendaTimes>;
  assets: Assets;
  pushes: ActivePush[];
}

function playback(view: PlaylistView): PlaybackPlaylist {
  return {
    id: view.id,
    type: view.type,
    slideshowImageSeconds: view.slideshow_image_seconds,
    items: view.items.map((i) => ({
      id: i.id,
      assetId: i.asset_id,
      durationSeconds: i.duration_seconds,
      slideStart: i.slide_start,
      slideEnd: i.slide_end,
      slideSeconds: i.slide_seconds,
    })),
  };
}

function breakPlaylist(
  view: PlaylistView & { break: NonNullable<PlaylistView["break"]> },
): BreakPlaylist {
  const b = view.break;
  return {
    ...playback(view),
    name: view.name,
    priority: view.priority,
    break: {
      zones: b.zones,
      periodSeconds: b.period_seconds,
      breakSeconds: b.break_seconds,
      windowStartMinute: b.window_start_minute,
      windowEndMinute: b.window_end_minute,
      playOnce: b.play_once,
      region: b.region,
      mode: b.mode,
      slideshowDwellSeconds: b.slideshow_dwell_seconds,
      shuffle: b.shuffle,
    },
  };
}

export async function loadWindows(c: SqlClient, zoneKey?: string): Promise<ScheduleWindow[]> {
  const { rows } = await c.query(
    `SELECT id, zone_key, playlist_id, priority, layout_id, days, start_minute, end_minute, agenda_item_id
     FROM screen_schedules ${zoneKey === undefined ? "" : "WHERE zone_key = $1"}`,
    zoneKey === undefined ? [] : [zoneKey],
  );
  return rows.map((r) => {
    const base = {
      id: r.id as string,
      zoneKey: r.zone_key as string,
      playlistId: r.playlist_id as string,
      priority: r.priority as number,
      layoutId: r.layout_id as string | null,
    };
    if (typeof r.agenda_item_id === "string") return { ...base, agendaItemId: r.agenda_item_id };
    return {
      ...base,
      days: r.days as number[],
      startMinute: r.start_minute as number,
      endMinute: r.end_minute as number,
      agendaItemId: null,
    };
  });
}

export async function loadContent(
  c: SqlClient,
  assets: AssetReader,
  nowMs: number,
): Promise<EventContent> {
  const zones = await c.query("SELECT key, layout_id FROM screen_zones ORDER BY key");
  const views = await loadPlaylists(c);
  const playlists = new Map<string, PlaybackPlaylist>();
  const breakPlaylists: BreakPlaylist[] = [];
  for (const view of views) {
    if (view.break !== null) breakPlaylists.push(breakPlaylist({ ...view, break: view.break }));
    else playlists.set(view.id, playback(view));
  }
  const pushes = await activePushes(c, nowMs);
  const assetIds = new Set(views.flatMap((v) => v.items.map((i) => i.asset_id)));
  for (const push of pushes) if (push.assetId !== null) assetIds.add(push.assetId);
  return {
    zones: zones.rows.map((r) => ({
      key: r.key as string,
      layoutId: r.layout_id as string | null,
    })),
    windows: await loadWindows(c),
    playlists,
    breakPlaylists,
    playlistPriorities: new Map(views.map((v) => [v.id, v.priority])),
    agendaItems: await loadAgendaItems(c),
    assets: await assets(c, [...assetIds]),
    pushes,
  };
}

/** The zone's breaks as `stepBreaks` takes them. */
export function breakInputFor(
  content: EventContent,
  zoneKey: string,
  timeZone: string,
  minGapSeconds: number,
): BreakInput {
  return {
    zoneKey,
    playlists: content.breakPlaylists,
    assets: content.assets,
    timeZone,
    minGapSeconds,
  };
}

/** The newest active push that names the zone, or names none (every zone). */
export function pushFor(content: EventContent, zoneKey: string): ActivePush | null {
  return content.pushes.find((p) => p.zones.length === 0 || p.zones.includes(zoneKey)) ?? null;
}
