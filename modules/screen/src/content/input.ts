/**
 * The bodies of `/api/screen/playlists…`, `/api/screen/schedules…` and `/api/screen/push`,
 * checked against the contract's `Playlist`, `BreakSettings`, `Schedule` and `Push`
 * (contracts/screen.openapi.yaml), with the legacy signage's rules (`api-schemas.ts`,
 * `playlist-builder.ts`). What needs the database (zones, playlists) is the routes' check.
 * Unknown fields are refused rather than stored, as for zones.
 */
import { validateBreakWindow } from "../playback/breaks.js";
import { validateWeekly } from "../schedule/window.js";
import { invalidRequest } from "../http.js";
import { isObject, NAME_RE, onlyKeys, oneOf, zoneKey } from "../zone-input.js";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ITEMS = 500;
// Upper bounds keep values inside Postgres `integer` columns and the tick's arithmetic: a deck
// never has this many slides, and nothing on a screen lasts longer than a day.
const MAX_SLIDE = 10_000;
const MAX_SECONDS = 86_400;
/** "At most 12 hours ahead" (contracts/screen.md, Push content). */
export const PUSH_MAX_MS = 12 * 3600 * 1000;

export interface ItemInput {
  /** An existing item's id keeps it, so a bookmark on it survives the save; null is a new item. */
  id: string | null;
  asset_id: string;
  duration_seconds: number | null;
  slide_start: number | null;
  slide_end: number | null;
  slide_seconds: number | null;
}

export interface BreakInputSettings {
  zones: string[];
  period_seconds: number;
  break_seconds: number;
  window_start_minute: number | null;
  window_end_minute: number | null;
  play_once: boolean;
  region: "playlist" | "full";
  mode: "timeline" | "slideshow";
  slideshow_dwell_seconds: number | null;
  shuffle: boolean;
  /** The player's alone; kept only when sent. */
  transition?: string;
  pan_zoom?: string;
}

export interface PlaylistInput {
  name: string;
  type: "regular" | "slideshow" | "break";
  priority: number;
  slideshow_image_seconds: number | null;
  break: BreakInputSettings | null;
  items: ItemInput[];
  revision?: number;
}

export interface ScheduleInput {
  zone_key: string;
  playlist_id: string;
  priority: number;
  layout_id: string | null;
  days: number[] | null;
  start_minute: number | null;
  end_minute: number | null;
  agenda_item_id: string | null;
  revision?: number;
}

export interface PushInput {
  zones: string[];
  playlist_id: string | null;
  asset_id: string | null;
  until: Date;
}

type Json = Record<string, unknown>;

function id(value: unknown, where: string): string {
  if (typeof value !== "string" || !ID_RE.test(value))
    throw invalidRequest(`\`${where}\` must be an id.`);
  return value;
}

/** A whole number in [min, max]. */
function whole(value: unknown, where: string, min: number, max = Infinity): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    const range = max === Infinity ? `at least ${min}` : `from ${min} to ${max}`;
    throw invalidRequest(`\`${where}\` must be a whole number ${range}.`);
  }
  return value as number;
}

/** As `whole`, or null when null or left out. */
function wholeOrNull(value: unknown, where: string, min: number, max = Infinity): number | null {
  return value === null || value === undefined ? null : whole(value, where, min, max);
}

function bool(value: unknown, where: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalidRequest(`\`${where}\` must be true or false.`);
  return value;
}

function revisionOf(value: Json): { revision?: number } {
  return value.revision === undefined ? {} : { revision: whole(value.revision, "revision", 1) };
}

function zoneList(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidRequest(`\`${where}\` must be a list of zone keys.`);
  const keys = value.map((k, i) => zoneKey(k, `${where}[${i}]`));
  if (new Set(keys).size !== keys.length) throw invalidRequest(`\`${where}\` names a zone twice.`);
  return keys;
}

function itemInput(value: unknown, where: string): ItemInput {
  if (!isObject(value)) throw invalidRequest(`\`${where}\` must be an object.`);
  onlyKeys(
    value,
    ["id", "asset_id", "duration_seconds", "slide_start", "slide_end", "slide_seconds"],
    where,
  );
  const duration = value.duration_seconds ?? null;
  if (
    duration !== null &&
    (typeof duration !== "number" || !Number.isFinite(duration) || duration < 1)
  ) {
    throw invalidRequest(
      `\`${where}.duration_seconds\` must be at least 1 second, or null for the video's own length.`,
    );
  }
  const start = wholeOrNull(value.slide_start, `${where}.slide_start`, 1, MAX_SLIDE);
  const end = wholeOrNull(value.slide_end, `${where}.slide_end`, 1, MAX_SLIDE);
  if (start !== null && end !== null && start > end) {
    throw invalidRequest(`\`${where}\`: the start slide cannot be after the end slide.`);
  }
  return {
    id: value.id === undefined || value.id === null ? null : id(value.id, `${where}.id`),
    asset_id: id(value.asset_id, `${where}.asset_id`),
    duration_seconds: duration,
    slide_start: start,
    slide_end: end,
    slide_seconds: wholeOrNull(value.slide_seconds, `${where}.slide_seconds`, 1, MAX_SECONDS),
  };
}

const BREAK_FIELDS = [
  "zones",
  "period_seconds",
  "break_seconds",
  "window_start_minute",
  "window_end_minute",
  "play_once",
  "region",
  "mode",
  "slideshow_dwell_seconds",
  "transition",
  "pan_zoom",
  "shuffle",
];

function breakSettings(value: unknown): BreakInputSettings {
  if (!isObject(value)) throw invalidRequest("`break` must be an object.");
  onlyKeys(value, BREAK_FIELDS, "break");
  oneOf(value.region, ["playlist", "full"], "`break.region`");
  oneOf(value.mode, ["timeline", "slideshow"], "`break.mode`");
  oneOf(value.transition, ["cut", "crossfade"], "`break.transition`");
  oneOf(value.pan_zoom, ["none", "subtle", "strong"], "`break.pan_zoom`");
  const start = wholeOrNull(value.window_start_minute, "break.window_start_minute", 0, 1440);
  const end = wholeOrNull(value.window_end_minute, "break.window_end_minute", 0, 1440);
  const window = validateBreakWindow(start, end);
  if (!window.ok) throw invalidRequest(`\`break\`: ${window.error}.`);
  return {
    zones: zoneList(value.zones, "break.zones"),
    period_seconds: whole(value.period_seconds, "break.period_seconds", 60, MAX_SECONDS),
    break_seconds: whole(value.break_seconds, "break.break_seconds", 5, MAX_SECONDS),
    window_start_minute: start,
    window_end_minute: end,
    play_once: bool(value.play_once, "break.play_once"),
    region: (value.region as BreakInputSettings["region"] | undefined) ?? "playlist",
    mode: (value.mode as BreakInputSettings["mode"] | undefined) ?? "timeline",
    slideshow_dwell_seconds: wholeOrNull(
      value.slideshow_dwell_seconds,
      "break.slideshow_dwell_seconds",
      1,
      MAX_SECONDS,
    ),
    shuffle: bool(value.shuffle, "break.shuffle"),
    ...(value.transition === undefined ? {} : { transition: value.transition as string }),
    ...(value.pan_zoom === undefined ? {} : { pan_zoom: value.pan_zoom as string }),
  };
}

export function playlistInput(value: unknown): PlaylistInput {
  if (!isObject(value)) throw invalidRequest("The body must be a JSON object.");
  onlyKeys(
    value,
    ["id", "name", "type", "priority", "slideshow_image_seconds", "break", "items", "revision"],
    "playlist",
  );
  const { name, type } = value;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 80) {
    throw invalidRequest("`name` must be 1 to 80 characters.");
  }
  if (type === undefined) throw invalidRequest("`type` is required.");
  oneOf(type, ["regular", "slideshow", "break"], "`type`");
  if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS) {
    throw invalidRequest(`\`items\` must be a list of at most ${MAX_ITEMS}.`);
  }
  const items = value.items.map((item: unknown, i) => itemInput(item, `items[${i}]`));
  const ids = items.flatMap((item) => (item.id === null ? [] : [item.id]));
  if (new Set(ids).size !== ids.length) throw invalidRequest("`items` names an item id twice.");
  const settings = value.break ?? null;
  if (type === "break" && settings === null)
    throw invalidRequest("`break` is required for a break playlist.");
  if (type !== "break" && settings !== null)
    throw invalidRequest("`break` goes only on a break playlist.");
  return {
    name: name.trim(),
    type: type as PlaylistInput["type"],
    priority: value.priority === undefined ? 0 : whole(value.priority, "priority", 0, 999),
    slideshow_image_seconds: wholeOrNull(
      value.slideshow_image_seconds,
      "slideshow_image_seconds",
      1,
      MAX_SECONDS,
    ),
    break: settings === null ? null : breakSettings(settings),
    items,
    ...revisionOf(value),
  };
}

export function scheduleInput(value: unknown): ScheduleInput {
  if (!isObject(value)) throw invalidRequest("The body must be a JSON object.");
  onlyKeys(
    value,
    [
      "id",
      "zone_key",
      "playlist_id",
      "priority",
      "layout_id",
      "days",
      "start_minute",
      "end_minute",
      "agenda_item_id",
      "revision",
      "changed_by",
      "changed_at",
    ],
    "schedule",
  );
  const layout = value.layout_id ?? null;
  if (layout !== null && (typeof layout !== "string" || !NAME_RE.test(layout))) {
    throw invalidRequest("`layout_id` must be a layout id such as `pulse`, or null.");
  }
  const base = {
    zone_key: zoneKey(value.zone_key, "zone_key"),
    playlist_id: id(value.playlist_id, "playlist_id"),
    priority: whole(value.priority, "priority", 0, 999),
    layout_id: layout,
  };
  // An explicit null counts as left out, as everywhere in these bodies.
  const weekly = ["days", "start_minute", "end_minute"].some(
    (k) => value[k] !== undefined && value[k] !== null,
  );
  const bound = value.agenda_item_id !== undefined && value.agenda_item_id !== null;
  if (weekly === bound) {
    throw invalidRequest(
      "A window is either weekly (`days`, `start_minute`, `end_minute`) or bound to a run-of-show item (`agenda_item_id`).",
    );
  }
  if (bound) {
    const item = id(value.agenda_item_id, "agenda_item_id");
    return {
      ...base,
      days: null,
      start_minute: null,
      end_minute: null,
      agenda_item_id: item,
      ...revisionOf(value),
    };
  }
  const days = value.days;
  const start = value.start_minute;
  const end = value.end_minute;
  if (!Array.isArray(days))
    throw invalidRequest("Days must be one or more of Monday (1) to Sunday (7), each once.");
  const check = validateWeekly({
    days: days as number[],
    startMinute: start as number,
    endMinute: end as number,
  });
  if (!check.ok) throw invalidRequest(`${check.error}.`);
  return {
    ...base,
    days: days as number[],
    start_minute: start as number,
    end_minute: end as number,
    agenda_item_id: null,
    ...revisionOf(value),
  };
}

export function pushInput(value: unknown, nowMs: number): PushInput {
  if (!isObject(value)) throw invalidRequest("The body must be a JSON object.");
  onlyKeys(value, ["id", "zones", "playlist_id", "asset_id", "until"], "push");
  if (!Array.isArray(value.zones))
    throw invalidRequest("`zones` is required: a list of zone keys, empty for every zone.");
  const hasPlaylist = value.playlist_id !== undefined && value.playlist_id !== null;
  if (hasPlaylist === (value.asset_id !== undefined && value.asset_id !== null)) {
    throw invalidRequest("Name exactly one of `playlist_id` and `asset_id`.");
  }
  const untilMs = typeof value.until === "string" ? Date.parse(value.until) : NaN;
  if (Number.isNaN(untilMs)) throw invalidRequest("`until` must be a time (RFC 3339).");
  if (untilMs <= nowMs || untilMs > nowMs + PUSH_MAX_MS) {
    throw invalidRequest("`until` must lie in the future, at most 12 hours ahead.");
  }
  return {
    zones: zoneList(value.zones, "zones"),
    playlist_id: hasPlaylist ? id(value.playlist_id, "playlist_id") : null,
    asset_id: hasPlaylist ? null : id(value.asset_id, "asset_id"),
    until: new Date(untilMs),
  };
}
