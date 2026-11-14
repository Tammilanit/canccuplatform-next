/**
 * A bar graph's value scale and hour labels (#523; contracts/screen.md, Widgets: `activity_graph`,
 * `today_numbers`). A template has no styles and no arithmetic, so the server says where the
 * gridlines go and how tall each bar is, and the look spaces the gridlines evenly (director.css).
 */

/** One hour of the last 24: its start as `HH:MM` and its average count. */
export interface Hour {
  time_text: string;
  value: number;
}

/** An hour as a bar: out of 10 against the scale's top, and its label on the hours it names. */
export interface Bar extends Hour {
  level: number;
  tick_text?: string;
}

/** Round steps a viewer reads at a glance; 2.5 only from 25 on, so the scale stays whole. */
const STEPS = [1, 2, 5, 10, 20, 25, 50];

/**
 * The gridlines' values, from the top down to 0: the smallest round step that covers the highest
 * value in three, so the base carries two or three lines over it and the highest bar fills at
 * least two thirds of the graph.
 */
export function scaleOf(highest: number): number[] {
  let step: number | undefined;
  // STEPS spans two decades, so each round of the search goes up a hundredfold.
  for (let power = 1; step === undefined; power *= 100)
    step = STEPS.map((s) => s * power).find((s) => 3 * s >= highest);
  const lines = Math.max(2, Math.ceil(highest / step));
  return Array.from({ length: lines + 1 }, (_, i) => (lines - i) * step);
}

/** The scale and bars of `hours`, naming every `everyHours`-th hour of the day under its bar. */
export function graphOf(
  hours: readonly Hour[],
  everyHours: number,
): { scale: { value: number }[]; points: Bar[] } {
  const scale = scaleOf(Math.max(0, ...hours.map((h) => h.value)));
  const top = scale[0] as number;
  const points = hours.map((h) => ({
    time_text: h.time_text,
    value: h.value,
    level: Math.round((10 * h.value) / top),
    // An absent label, never an undefined one: the fingerprint and the player read the same JSON.
    ...(Number.parseInt(h.time_text, 10) % everyHours === 0 ? { tick_text: h.time_text } : {}),
  }));
  return { scale: scale.map((value) => ({ value })), points };
}
