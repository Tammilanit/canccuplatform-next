/*
 * The playlist builder's rules (step 3 plan S7), ported from the legacy `playlist-builder.ts` with
 * its tests (test/studio-playlist-builder.test.ts). Changed: the API saves the whole list in one
 * `PUT`, so the legacy reorder and remove payload checks become moves on that list; refusals are
 * message keys the page words; and a deck is `pptx` or `pdf`. The server checks it all again
 * (src/content/asset-rules.ts); these only say so before a save.
 *
 * The run-order preview follows the tick's timeline (src/playback/timeline.ts, and the slideshow
 * of src/playback/engine.ts); a test holds the two to the same cycle, so they cannot drift.
 */

/** An asset dragged in starts with these seconds; a video plays its own length (null). */
const START_SECONDS = { image: 15, web: 30, youtube: 30, pptx: 8, pdf: 8 };
const isDeck = (kind) => kind === "pptx" || kind === "pdf";
// As the tick: an item that has no length of its own, and a slideshow's default time per image.
const FALLBACK_SECONDS = 30;
const SLIDESHOW_SECONDS = 10;
const MAX_ITEMS = 500;
/** "At most 12 hours ahead" (contracts/screen.md, Push content). */
export const PUSH_MAX_MS = 12 * 3600_000;

export function newItem(assetId, asset) {
  return {
    id: null,
    asset_id: assetId,
    duration_seconds: asset.kind === "video" ? null : (START_SECONDS[asset.kind] ?? 15),
    slide_start: null,
    slide_end: null,
    slide_seconds: null,
  };
}

const wholeFrom1 = (n) => Number.isInteger(n) && n >= 1;

/** null when the item can be saved, else the refusal's key (and its values). */
export function checkItem(item, asset, type) {
  if (!asset) return { key: "playlist.item_missing" };
  const seconds = item.duration_seconds;
  if (seconds === null) {
    // A slideshow shows each image for the playlist's own time, so an item's length is unused.
    if (asset.kind !== "video" && type !== "slideshow") return { key: "playlist.own_length" };
  } else if (!Number.isFinite(seconds) || seconds < 1) return { key: "playlist.too_short" };
  const { slide_start: start, slide_end: end, slide_seconds: slideSeconds } = item;
  if (start === null && end === null && slideSeconds === null) return null;
  if (!isDeck(asset.kind)) return { key: "playlist.deck_only" };
  if (slideSeconds !== null && !(Number.isFinite(slideSeconds) && slideSeconds >= 1)) {
    return { key: "playlist.too_short" };
  }
  if ((start !== null && !wholeFrom1(start)) || (end !== null && !wholeFrom1(end))) {
    return { key: "playlist.slide_whole" };
  }
  if (start !== null && end !== null && start > end) return { key: "playlist.slide_order" };
  const count = asset.slides;
  // An unrendered deck has no count yet: its render fits the range (`clampToDeck`).
  if (count !== null && Math.max(start ?? 0, end ?? 0) > count) {
    return { key: "playlist.slide_max", values: { count } };
  }
  return null;
}

/** Every refusal of the whole playlist, by field, before a save. */
export function checkPlaylist(playlist, assets) {
  const out = [];
  const name = playlist.name.trim();
  if (name === "") out.push({ field: "name", key: "playlist.name_needed" });
  else if (name.length > 80) out.push({ field: "name", key: "playlist.name_long" });
  const p = playlist.priority;
  if (!Number.isInteger(p) || p < 0 || p > 999) {
    out.push({ field: "priority", key: "playlist.priority_range" });
  }
  if (playlist.items.length > MAX_ITEMS) {
    out.push({ field: "items", key: "playlist.too_many" });
    return out;
  }
  playlist.items.forEach((item, index) => {
    const refused = checkItem(item, assets[item.asset_id], playlist.type);
    if (refused) out.push({ field: "items", index, ...refused });
  });
  return out;
}

/** The list with item `from` moved to `to` (clamped to the ends); the list given is kept. */
export function moveItem(items, from, to) {
  const out = [...items];
  const [moved] = out.splice(from, 1);
  if (moved === undefined) return out;
  out.splice(Math.max(0, Math.min(out.length, to)), 0, moved);
  return out;
}

export function removeItem(items, index) {
  return items.filter((_, i) => i !== index);
}

/** As the tick: a manual length rounded up; auto plays a video's real length, never cut. */
function itemSeconds(item, asset) {
  if (item.duration_seconds !== null) return Math.max(1, Math.ceil(item.duration_seconds));
  const real = asset.duration_seconds;
  if (asset.kind === "video" && Number.isFinite(real) && real > 0) return Math.ceil(real);
  return FALLBACK_SECONDS;
}

/** The slides an item shows: its range clamped to the deck, as `clampSlideRange`. */
function slidesOf(item, count) {
  const start = Math.max(1, item.slide_start ?? 1);
  const end = Math.max(start, Math.min(count, item.slide_end ?? count));
  return end - start + 1;
}

/** Why the screens skip an item, or null when they play it. */
function skipOf(asset, type) {
  if (!asset || asset.health === "error" || asset.kind === "audio") return "error";
  if (type === "slideshow") return asset.kind === "image" ? null : "slideshow";
  if (isDeck(asset.kind) && !(asset.slides >= 1)) return "unrendered";
  return null;
}

/** Each item's start and length in one cycle, and the cycle's length, in whole seconds. */
export function runOrder(playlist, assets) {
  const imageSeconds = Math.max(1, playlist.slideshow_image_seconds ?? SLIDESHOW_SECONDS);
  let start = 0;
  const rows = playlist.items.map((item, index) => {
    const asset = assets[item.asset_id];
    const skipped = skipOf(asset, playlist.type);
    let seconds = 0;
    let slides = null;
    if (skipped === null && playlist.type === "slideshow") seconds = imageSeconds;
    else if (skipped === null && isDeck(asset.kind)) {
      slides = slidesOf(item, asset.slides);
      // A slide time turns the slides inside one item of its own length; else each slide plays it.
      const each = itemSeconds(item, asset);
      seconds = item.slide_seconds === null ? each * slides : each;
    } else if (skipped === null) seconds = itemSeconds(item, asset);
    const row = { index, start, seconds, slides, skipped };
    start += seconds;
    return row;
  });
  return { rows, total: start };
}

/** 1:36, or 1:02:05 past an hour. */
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const two = (n) => String(n).padStart(2, "0");
  const [h, m] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60)];
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** Minutes since midnight of `ms` on the wall clock of `timeZone`. */
function wallMinutes(timeZone, ms) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  return part("hour") * 60 + part("minute");
}

/**
 * The next instant after `nowMs` the event's clock shows `hhmm` ("00:00" is the end of today).
 * A step of the minutes between the two wall clocks, then one correction, so a change of daylight
 * saving time in between still lands on the wall clock asked for.
 */
export function nextAt(timeZone, nowMs, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const target = h * 60 + m;
  const base = Math.floor(nowMs / 60_000) * 60_000;
  const ahead = (target - wallMinutes(timeZone, base) + 1440) % 1440 || 1440;
  let at = base + ahead * 60_000;
  const off = (wallMinutes(timeZone, at) - target + 1440) % 1440;
  if (off !== 0) at -= (off > 720 ? off - 1440 : off) * 60_000;
  return at;
}

/** The push's end for a preset (minutes, `day` or `at` a time), or the key of why not. */
export function pushUntil(choice, nowMs, timeZone, at) {
  let ms;
  if (choice === "day") ms = nextAt(timeZone, nowMs, "00:00");
  else if (choice === "at") {
    if (!/^\d{2}:\d{2}$/.test(at)) return { error: "push.time_needed" };
    ms = nextAt(timeZone, nowMs, at);
  } else ms = nowMs + Number(choice) * 60_000;
  return ms - nowMs > PUSH_MAX_MS ? { error: "push.too_far" } : { ms };
}
