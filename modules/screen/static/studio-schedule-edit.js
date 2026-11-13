/*
 * The window editor's arithmetic (#267, plan #190 S4), apart from the page so the tests can run it
 * (test/studio-schedule-edit.test.ts). A drag works in axis minutes: a column's minutes from its
 * date's midnight, past 1440 where the axis runs on into the small hours. A weekly window holds
 * wall-clock minutes (contracts/screen.md, Schedule windows): an end of 1440 is midnight, an end
 * not after the start runs overnight, and the start and end are never equal. The legacy
 * `week-calendar-edit-client.ts` moved and resized one weekday; here a window keeps its days.
 */

const DAY = 1440;
const SNAP = 15;

const snap = (minute) => Math.round(minute / SNAP) * SNAP;
const mod = (minute) => ((minute % DAY) + DAY) % DAY;
/** A wall-clock end: midnight at the end of a day is 1440, never 0. */
const endOf = (minute) => mod(minute) || DAY;

/** "HH:MM" (24:00 allowed) as minutes, or null. */
export function minutesOf(text) {
  const m = /^([01][0-9]|2[0-4]):([0-5][0-9])$/.exec(text);
  if (m === null) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes > DAY ? null : minutes;
}

export function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 1 = Monday … 7 = Sunday, of a `YYYY-MM-DD` date. */
export function isoDay(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY * 60_000).toISOString().slice(0, 10);
}

/** A drag from `a` to `b` (axis minutes of `date`'s column) as a window on the day it starts. */
export function createdTimes(date, a, b) {
  const start = snap(Math.max(0, Math.min(a, b)));
  const end = Math.max(snap(Math.max(a, b)), start + SNAP);
  return {
    date: addDays(date, Math.floor(start / DAY)),
    start_minute: mod(start),
    end_minute: endOf(Math.min(end, start + DAY - SNAP)),
  };
}

const lengthOf = (t) =>
  t.end_minute > t.start_minute
    ? t.end_minute - t.start_minute
    : t.end_minute + DAY - t.start_minute;

/** The window moved by `delta` minutes, snapped; null when that changes nothing. */
export function movedTimes(times, delta) {
  const step = snap(delta);
  if (step === 0 || lengthOf(times) >= DAY) return null;
  return {
    start_minute: mod(times.start_minute + step),
    end_minute: endOf(times.end_minute + step),
  };
}

/** The window's end moved by `delta` minutes: a quarter long at least, short of a whole day. */
export function resizedTimes(times, delta) {
  const step = snap(delta);
  if (step === 0) return null;
  // Only a window from midnight may last the whole day: elsewhere its end would equal its start.
  const most = times.start_minute === 0 ? DAY : DAY - SNAP;
  const length = Math.max(SNAP, Math.min(most, lengthOf(times) + step));
  return { start_minute: times.start_minute, end_minute: endOf(times.start_minute + length) };
}

/**
 * The form's values as a `Schedule` body, or the message key of what is missing. The server
 * checks again; this only spares a round trip for what a person can see is wrong.
 */
export function windowBody(f) {
  if (!f.playlist_id) return { ok: false, error: "window.need_playlist" };
  const priority = /^[0-9]{1,3}$/.test(String(f.priority).trim()) ? Number(f.priority) : null;
  if (priority === null) return { ok: false, error: "window.need_priority" };
  const base = {
    zone_key: f.zone_key,
    playlist_id: f.playlist_id,
    priority,
    layout_id: f.layout_id || null,
  };
  if (f.kind === "bound") {
    if (!f.agenda_item_id) return { ok: false, error: "window.need_item" };
    return { ok: true, body: { ...base, agenda_item_id: f.agenda_item_id } };
  }
  const days = f.days.map(Number).sort((x, y) => x - y);
  if (days.length === 0) return { ok: false, error: "window.need_days" };
  const start = minutesOf(f.start);
  const typed = minutesOf(f.end);
  if (start === null || typed === null || start === DAY)
    return { ok: false, error: "window.need_times" };
  // An end of 00:00 is the midnight the window runs into: 24:00, so 00:00–00:00 is the whole day.
  const end = typed === 0 ? DAY : typed;
  if (start === end) return { ok: false, error: "window.same_times" };
  return { ok: true, body: { ...base, days, start_minute: start, end_minute: end } };
}
