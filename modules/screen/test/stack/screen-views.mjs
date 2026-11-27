// The screen shots' views (screens.mjs): the themes and sizes each is taken at, and every PNG
// name in the order the run takes them, for the dry run (scripts/demo-screenshots.mjs).
import { DIRECTOR_STRIPS, stripNames } from "./director.mjs";
import { ANNOUNCE_THEMES, ANNOUNCE_VIEWS, annSizes } from "./announce-levels.mjs";
import { STAGE_VIEWS } from "./handed.mjs";
import { LIVING_STRIPS, LIVING_THEMES } from "./living.mjs";

export const THEMES = ["terminal", "level-up", "default"];
export const HD = [
  [1920, 1080],
  [1080, 1920],
];
export const UHD = [
  [3840, 2160],
  [2160, 3840],
];
// The merge queue's check (scripts/demo-screenshots --check) reads every theme at 1080p only. The
// level-up theme, whose widgets lie in the flow and whose fonts reach below their line box, is shot
// at 4K too (#779: no clipped letters at 1080p, 4K and portrait in both themes).
export function sizesOf(theme, check) {
  if (check) return HD;
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
export const foodSizes = (check) => (check ? HD : [...HD, UHD[0]]);
/** The built-ins besides the Pulse and Portrait: 16:9 each, so drawn landscape only. */
export const LAYOUTS = ["dashboard", "hero", "split", "ambient"];
/** The default theme's other views of those layouts at 1080p: each view and its layout. */
export const DEFAULT_LAYOUT_VIEWS = [
  ["dashboard-showcase-small", "dashboard"],
  ["dashboard-waiting", "dashboard"],
  ["ambient-takeover", "ambient"],
  ["ambient-online", "ambient"],
  ["ambient-showcase", "ambient"],
];
// Level-up's 4K is the Pulse's and the frames' only: its other layouts set fixed sizes in rem.
export const landscapeOf = (theme, check) =>
  (theme === "level-up" ? HD : sizesOf(theme, check)).filter(([w, h]) => w > h);

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

/** Every PNG the run takes, in order, for the dry run. */
export function planned(check = false) {
  const out = [];
  for (const theme of THEMES) {
    for (const size of sizesOf(theme, check)) {
      for (const view of THEMED) out.push(nameOf(theme, view, size));
      if (theme !== "default") continue;
      for (const view of UNTHEMED) out.push(nameOf(theme, view, size));
    }
    for (const size of landscapeOf(theme, check))
      for (const view of LAYOUTS) out.push(nameOf(theme, view, size));
    out.push(nameOf(theme, "dashboard-showcase", HD[0]));
    for (const v of ANNOUNCE_THEMES.includes(theme) ? ANNOUNCE_VIEWS : [])
      for (const size of annSizes(v, check)) out.push(nameOf(theme, v.view, size));
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
    for (const size of foodSizes(check)) out.push(nameOf("default", view, size));
  out.push(nameOf("default", "entrance", HD[1]));
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
