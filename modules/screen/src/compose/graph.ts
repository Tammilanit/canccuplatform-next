/**
 * A bar graph's value scale and hour labels (#523, #527; contracts/screen.md, Widgets:
 * `activity_graph`, `today_numbers`). A template has no styles and no arithmetic, so the server
 * says where the gridlines go and how tall each bar is, and the look spaces the gridlines evenly
 * (director.css). Erasable TypeScript with no imports: the Demo stack's fixtures import this file
 * as it is (test/stack/handed.mjs), so their graphs follow the same rule.
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

/** Round steps of a decade a viewer reads at a glance; 2.5 only where it stays whole. */
const STEPS = [1, 2, 2.5, 5];

/**
 * The gridlines' values, from the top down to 0: the smallest round step that covers the highest
 * value in three, so the base carries two or three lines over it and the highest bar fills at
 * least two thirds of the graph.
 */
export function scaleOf(highest: number): number[] {
  let step: number | undefined;
  for (let decade = 1; step === undefined; decade *= 10)
    step = STEPS.map((s) => s * decade).find((s) => Number.isInteger(s) && 3 * s >= highest);
  const lines = Math.max(2, Math.ceil(highest / step));
  return Array.from({ length: lines + 1 }, (_, i) => (lines - i) * step);
}

/**
 * The look's hour labels, in units of the screen's short side (director.css): a label `HH:MM` at
 * 3 units is about 8.5 wide, so labels this far apart never meet; the gutter, its gap and the
 * card's padding take the rest of the box's width from the bars.
 */
const LABEL_ROOM_UNITS = 10;
const LABEL_HALF_UNITS = 4.25;
const GRAPH_CHROME_UNITS = 15;
const TICK_HOURS = [3, 6, 12];

/**
 * Every how many hours of the day a graph `unitsWide` wide names under its bar, at 24 bars; none
 * when even every twelfth hour's labels would meet.
 */
function tickHoursOf(unitsWide: number): number | undefined {
  const bars = unitsWide - GRAPH_CHROME_UNITS;
  return TICK_HOURS.find((h) => (h * bars) / 24 >= LABEL_ROOM_UNITS);
}

/**
 * The scale and bars of `hours` in a box `unitsWide` units wide (compose/layouts.ts, unitsWide):
 * no scale over no hours, since no data is not zero, and the newest hour named when none of the
 * step falls among a few hours, or the box has room for no step, so a graph always says when it is.
 */
export function graphOf(
  hours: readonly Hour[],
  unitsWide: number,
): { scale: { value: number }[]; points: Bar[] } {
  if (hours.length === 0) return { scale: [], points: [] };
  const scale = scaleOf(Math.max(0, ...hours.map((h) => h.value)));
  const top = scale[0] as number;
  const every = tickHoursOf(unitsWide);
  const named = hours.map(
    (h) => every !== undefined && Number.parseInt(h.time_text, 10) % every === 0,
  );
  if (!named.includes(true)) named[named.length - 1] = true;
  spaceByBar(named, (unitsWide - GRAPH_CHROME_UNITS) / hours.length);
  const points = hours.map((h, i) => ({
    time_text: h.time_text,
    value: h.value,
    level: Math.round((10 * h.value) / top),
    // An absent label, never an undefined one: the fingerprint and the player read the same JSON.
    ...(named[i] ? { tick_text: h.time_text } : {}),
  }));
  return { scale: scale.map((value) => ({ value })), points };
}

/**
 * Leaves unnamed each label that would meet the one after it, from the newest back. Measured in
 * bars, not hours of the day: an hour without counts has no bar, so two hours of the step can sit
 * on neighbouring bars (#548). The look ends the newest hour's label on the box's edge instead of
 * centring it under its bar (director.css, `.canccu-widget__hour:last-child`), which moves it left
 * by half a label less half a bar (#527).
 */
function spaceByBar(named: boolean[], barUnits: number): void {
  const newest = named.length - 1;
  const shift = Math.max(0, LABEL_HALF_UNITS - barUnits / 2);
  let kept: number | null = null;
  for (let i = newest; i >= 0; i--) {
    if (!named[i]) continue;
    const room = kept === null ? Infinity : (kept - i) * barUnits - (kept === newest ? shift : 0);
    if (room < LABEL_ROOM_UNITS) named[i] = false;
    else kept = i;
  }
}
