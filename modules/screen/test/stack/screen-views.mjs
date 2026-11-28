// The screen shots' views (screens.mjs): the themes and sizes each is taken at, and every PNG
// name in the order the run takes them, for the dry run (scripts/demo-screenshots.mjs).
import { DIRECTOR_STRIPS, stripNames } from "./director.mjs";
import { ANNOUNCE_THEMES, ANNOUNCE_VIEWS } from "./announce-levels.mjs";
import { MOTION_VIEWS, STAGE_VIEWS } from "./handed-stage.mjs";
import { LIVING_STRIPS, LIVING_THEMES } from "./living.mjs";

export const THEMES = ["terminal", "level-up", "esports", "arcade", "default"];
// The presets drawn in the same frames as the others and whose own looks the theming group's preset
// shots take (demo-screenshots-presets.mjs): here only the Pulse and the Dashboard, so the screens
// shard stays inside its 25 minutes (a full theme costs it about two more).
export const LEAN_THEMES = ["esports", "arcade"];
export const leanSkips = (theme, view) =>
  LEAN_THEMES.includes(theme) &&
  ["unassigned", "archived", "hero", "split", "ambient"].includes(view);
export const HD = [
  [1920, 1080],
  [1080, 1920],
];
export const UHD = [
  [3840, 2160],
  [2160, 3840],
];
// Every size a view is drawn for; a run takes those `chosen` keeps. The level-up theme, whose
// widgets lie in the flow and whose fonts reach below their line box, is drawn at 4K too (#779).
export function sizesOf(theme) {
  if (theme === "default") return [...HD, ...UHD];
  return theme === "level-up" ? [...HD, UHD[0]] : HD;
}
/** The frames that differ by theme; the others are drawn before any theme reaches the page. */
export const THEMED = ["pulse", "identify", "test-pattern", "offline", "unassigned", "archived"];
export const UNTHEMED = ["pairing", "insecure", "refused", "moved", "unreachable", "check"];
export const CLAIMS = [
  "claim-rail",
  "claim-hero",
  "claim-overlay",
  "claim-takeover",
  "claim-hero-emergency",
];
/** The food box handed a long pizzeria name and pickup note (food.mjs, #775): 1080p, portrait, 4K. */
export const FOOD_VIEWS = ["claim-food-long", "claim-food-on-the-way-long"];
export const FOOD_SIZES = [...HD, UHD[0]];
/** The built-ins besides the Pulse and Portrait: 16:9 each, so drawn landscape only. */
export const LAYOUTS = ["dashboard", "hero", "split", "ambient"];
/** The default theme's other views of those layouts at 1080p: each view and its layout. */
export const DEFAULT_LAYOUT_VIEWS = [
  // The Dashboard's narrow hero held on the coming hours (handed.mjs, withComingHours).
  ["dashboard-coming-hours", "dashboard"],
  ["dashboard-showcase-small", "dashboard"],
  ["dashboard-waiting", "dashboard"],
  ["ambient-takeover", "ambient"],
  ["ambient-online", "ambient"],
  ["ambient-showcase", "ambient"],
];
// Level-up's 4K is the Pulse's and the frames' only: its other layouts set fixed sizes in rem.
export const landscapeOf = (theme) =>
  (theme === "level-up" ? HD : sizesOf(theme)).filter(([w, h]) => w > h);

/** What each view of #443 must show (sheets 10, 13 and 16), waited for before its shot. */
export const NEW_VIEWS = {
  photo: ".canccu-widget__wall .canccu-widget__tile:nth-child(5) img",
  "photo-pop": ".canccu-widget__pop img",
  "ambient-online": ".canccu-region--online .canccu-widget__still",
  "portrait-right-now": ".canccu-region--right_now .canccu-widget__peak",
};

/** The surge's strip (sheet 15): before the tint, while it holds with its art, after it ended. */
export const SURGE_FRAMES = ["before", "during", "after"];
/** How long the strip's tint holds, and the stage's longest fade (stage.css). */
export const SURGE_MS = 12_000;
export const STAGE_FADE_MS = 3000;

export const nameOf = (theme, view, [w, h]) => `theming-${theme}-screen-${view}-${w}x${h}`;

/** Every PNG the views are drawn for, in the run's order; a run takes those `chosen` keeps. */
export function planned() {
  const out = [];
  for (const theme of THEMES) {
    for (const size of sizesOf(theme)) {
      for (const view of THEMED) if (!leanSkips(theme, view)) out.push(nameOf(theme, view, size));
      if (theme !== "default") continue;
      for (const view of UNTHEMED) out.push(nameOf(theme, view, size));
    }
    out.push(nameOf(theme, "coming-hours", HD[0]));
    for (const size of landscapeOf(theme))
      for (const view of LAYOUTS) if (!leanSkips(theme, view)) out.push(nameOf(theme, view, size));
    out.push(nameOf(theme, "dashboard-showcase", HD[0]));
    for (const v of ANNOUNCE_THEMES.includes(theme) ? ANNOUNCE_VIEWS : [])
      for (const size of v.sizes) out.push(nameOf(theme, v.view, size));
    if (LIVING_THEMES.includes(theme))
      for (const size of HD)
        for (const { view, frames } of LIVING_STRIPS)
          out.push(...stripNames(nameOf(theme, view, size), frames));
  }
  for (const [view] of DEFAULT_LAYOUT_VIEWS) out.push(nameOf("default", view, HD[0]));
  for (const size of HD)
    for (const view of ["photo", "photo-pop", "rail-empty", ...CLAIMS])
      out.push(nameOf("default", view, size));
  for (const view of FOOD_VIEWS)
    for (const size of FOOD_SIZES) out.push(nameOf("default", view, size));
  out.push(nameOf("default", "entrance", HD[1]));
  for (const { view } of MOTION_VIEWS) out.push(...stripNames(nameOf("default", view, HD[0]), 4));
  out.push(nameOf("default", "pulse-one-screen", HD[0]));
  out.push(nameOf("default", "portrait-right-now", HD[1]));
  out.push(nameOf("default", "portrait-showcase", HD[1]));
  for (const { view, surge } of STAGE_VIEWS) {
    if (!surge) out.push(nameOf("default", view, HD[0]));
    else for (const f of SURGE_FRAMES) out.push(nameOf("default", `${view}-${f}`, HD[0]));
  }
  out.push(nameOf("default", "pulse-hero-art", HD[0]));
  for (const { view, frames } of DIRECTOR_STRIPS)
    out.push(...stripNames(nameOf("default", view, HD[0]), frames));
  return out;
}

// A screen shot's name taken apart: `theming-<theme>-screen-<view>-<w>x<h>`, and a strip's frame
// after the size (director.mjs's `stripNames`).
const SHOT = /^(theming-.+?-screen-)(.+)-(\d+x\d+)(?:-f\d+)?$/;
/** The Pulse's attempt takes these frames over it too (screens.mjs, `pulse`). */
const OVER_PULSE = ["identify", "test-pattern", "offline"];

/**
 * The view screens.mjs `attempt`s to take the shot `name`, by its own name: the Pulse's attempt
 * takes identify, the test pattern and offline; a strip's takes its frames; the surge's its three
 * stages. Any other name is its own attempt, a page's name too.
 */
export function attemptOf(name) {
  const m = SHOT.exec(name);
  if (!m) return name;
  let [, head, view, size] = m;
  if (OVER_PULSE.includes(view)) view = "pulse";
  const surge = STAGE_VIEWS.find(
    (v) => v.surge && SURGE_FRAMES.some((f) => view === `${v.view}-${f}`),
  );
  if (surge) view = surge.view;
  return `${head}${view}-${size}`;
}

/** A strip: frames of one view over time, `-f1…fN` or the surge's before, during and after. */
const isStrip = (name) => /-f\d+$/.test(name) || attemptOf(name).includes("-stage-surge-");

/**
 * The book's 4K (docs/ci.md#tiers): one shot per layout, in the default theme. The Pulse's attempt
 * takes identify, the test pattern and offline with it; the Pulse in portrait is the Portrait.
 */
export const BOOK_4K = [
  ...["pulse", ...LAYOUTS].map((view) => nameOf("default", view, UHD[0])),
  nameOf("default", "pulse", UHD[1]),
];

const sizeOf = (name) => SHOT.exec(name)?.[3];
const themeOf = (name) => /^theming-(.+?)-screen-/.exec(name)?.[1];

/**
 * The screen shots a run takes, in the run's order (docs/ci.md#tiers): the views of `themes` at
 * 1920×1080, the strips only with `strips`; the book (`book`) adds portrait 1080×1920 and
 * BOOK_4K. `shots` narrows to the views that take those names; `part` [i, n] keeps the i-th of n
 * runs of the rest, cut in order where each holds about as much (a screens shard each). Whole
 * attempts always: a view that takes several shots is taken with all of them.
 */
export function chosen({
  themes = THEMES,
  strips = false,
  book = false,
  shots = null,
  part = null,
} = {}) {
  for (const t of themes) if (!THEMES.includes(t)) throw new Error(`unknown theme ${t}`);
  const all = planned();
  const sized = (n) =>
    sizeOf(n) === "1920x1080" ||
    (book && (sizeOf(n) === "1080x1920" || BOOK_4K.includes(attemptOf(n))));
  const keep = (n) => themes.includes(themeOf(n)) && sized(n) && (strips || !isStrip(n));
  let attempts = [...new Set(all.filter(keep).map(attemptOf))];
  if (shots) {
    const named = new Set(shots.map(attemptOf));
    attempts = attempts.filter((a) => named.has(a));
  }
  if (part) attempts = partOf(attempts, all, part);
  const taken = new Set(attempts);
  return all.filter((n) => taken.has(attemptOf(n)));
}

/**
 * The i-th (from 1) of n runs of `attempts`, cut in order by weight: a page opened and each PNG
 * it takes, which is most of a view's time (a strip's frames, the Pulse's four).
 */
function partOf(attempts, all, [i, n]) {
  if (!(Number.isInteger(i) && Number.isInteger(n) && i >= 1 && i <= n))
    throw new Error(`bad part ${i}/${n}`);
  const weight = new Map(attempts.map((a) => [a, 1]));
  for (const name of all) {
    const a = attemptOf(name);
    if (weight.has(a)) weight.set(a, weight.get(a) + 1);
  }
  const total = [...weight.values()].reduce((x, y) => x + y, 0);
  let before = 0;
  return attempts.filter((a) => {
    const w = weight.get(a);
    const at = Math.min(n - 1, Math.floor(((before + w / 2) / total) * n));
    before += w;
    return at === i - 1;
  });
}
