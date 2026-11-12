/**
 * The schedule calendar's pointer maths: minutes of a day on a 15-minute grid, and a block's place
 * in a day column. Ported from the legacy signage `calendar-pointer.ts`. The page places blocks
 * with `placement`; the drag helpers serve the window editor (#267), which drags on this grid.
 * Legacy's `createDragSelectionStyle` is gone: the Studio's CSP refuses inline styles.
 */
import { MINUTES_PER_DAY } from "../schedule/window.js";

export const CALENDAR_SNAP_MINUTES = 15;

export function snapMinuteOfDay(minute: number, step = CALENDAR_SNAP_MINUTES): number {
  const snapped = Math.round(minute / step) * step;
  return Math.max(0, Math.min(MINUTES_PER_DAY, snapped));
}

export function minuteFromDayOffset(offsetY: number, dayHeight: number): number {
  if (dayHeight <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, offsetY / dayHeight));
  return snapMinuteOfDay(ratio * MINUTES_PER_DAY);
}

/** A drag's range in either direction, snapped, at least one quarter long within the day. */
export function normalizeDragRange(
  startMinute: number,
  endMinute: number,
): { startMinute: number; endMinute: number } {
  const start = snapMinuteOfDay(Math.min(startMinute, endMinute));
  let end = snapMinuteOfDay(Math.max(startMinute, endMinute));
  if (end <= start) end = Math.min(MINUTES_PER_DAY, start + CALENDAR_SNAP_MINUTES);
  return { startMinute: start, endMinute: end };
}

export function snapMinuteDelta(delta: number, step = CALENDAR_SNAP_MINUTES): number {
  return Math.round(delta / step) * step;
}

/**
 * Top and height in percent of a column that runs from minute `from` to `to` (the whole day by
 * default; the schedule page's axis otherwise); a block stays tall enough to see and to tap.
 */
export function placement(
  startMinute: number,
  endMinute: number,
  from = 0,
  to = MINUTES_PER_DAY,
): { top: number; height: number } {
  const length = to - from;
  const top = ((startMinute - from) / length) * 100;
  const height = ((endMinute - startMinute) / length) * 100;
  return { top, height: Math.max(height, (CALENDAR_SNAP_MINUTES / length) * 100) };
}
