/** Types for studio-schedule-edit.js, which the page loads as it is; only the tests read these. */

export interface Times {
  start_minute: number;
  end_minute: number;
}

export interface WindowFields {
  zone_key: string;
  playlist_id: string;
  priority: string;
  layout_id: string;
  kind: string;
  days: string[];
  start: string;
  end: string;
  agenda_item_id: string;
}

export function minutesOf(text: string): number | null;
export function clock(minutes: number): string;
export function isoDay(date: string): number;
export function createdTimes(date: string, a: number, b: number): Times & { date: string };
export function movedTimes(
  w: Times & { days: number[] },
  delta: number,
): (Times & { days: number[] }) | null;
export function resizedTimes(times: Times, delta: number): Times | null;
export function windowBody(
  f: WindowFields,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string };
