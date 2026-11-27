// The screen shots a package's changed files affect (#835, docs/ci.md#tiers): the per-shot mapping
// of #825 (a file is named for its views: `dashboard.css`, the Dashboard's), the theme a demo
// theme's own files change, and the strips only for motion and transitions. scripts/demo-stack-plan.mjs
// hands the choice to the screens shard; scripts/shots-local-pick.mjs --changed takes the same.
import { basename, dirname } from "node:path";
import { THEMES, chosen, planned } from "../modules/screen/test/stack/screen-views.mjs";
import { asModule, needsOf } from "./demo-screenshots-groups.mjs";

// The theme of a run whose changed files name none: one theme is enough to see a view drawn.
export const DEFAULT_THEME = "default";

// Motion and transitions: the spotlight's motion, the stage, the Director and its turns, the
// living rotation, an announcement's motion. Their strips (frames over time) run only for these.
const STRIP_FILE = /(^|[-_])(motion|stage|director|choreographer|turns|transitions?|rotation|living)([-_.]|$)/;

/** A screen shot's view and the words in it (screen-views.mjs `nameOf`). */
export const viewWords = (name) =>
  /^theming-.+?-screen-(.+)-\d+x\d+(?:-f\d+)?$/.exec(name)?.[1].split("-") ?? [];

/** The word a changed file is named for: its name's first word, or its folder's for an index. */
export const wordOf = (path) => {
  const stem = basename(path).replace(/\..*$/, "");
  return (stem === "index" ? basename(dirname(path)) : stem).split(/[-_]/)[0].toLowerCase();
};

/** The views a word names (`claims`: the claim views); none for the module's own name. */
const namedBy = (word, names) =>
  ["screen", "screens"].includes(word)
    ? []
    : names.filter((n) => viewWords(n).some((w) => w === word || `${w}s` === word));

/** Whether a changed path draws on the screens, and is then named for its views. */
const ofScreens = (path, needs) =>
  Array.isArray(needs) ? needs.includes("screens") : asModule(path).startsWith("modules/screen/");

/**
 * What the changed paths need of the screens: `themes`, `strips`, `shots` (the names of the views
 * they are named for, or null for every view) and `why`, one line per path that decided. Null when
 * no path draws on the screens. A path the map runs in full that is not the screen module's own
 * (a shared package, the theming module) draws on every view.
 */
export function screensFor(paths) {
  const all = planned();
  const themes = new Set();
  const named = new Set();
  let every = false;
  let strips = false;
  let touched = false;
  const why = [];
  for (const path of paths) {
    const needs = needsOf(path);
    if (needs === "docs") continue;
    const theme = /^events\/demo\/themes\/([^/]+)\//.exec(path)?.[1];
    if (THEMES.includes(theme)) themes.add(theme);
    const strip = STRIP_FILE.test(basename(path).toLowerCase());
    if (strip) strips = true;
    const notes = [theme && `the ${theme} theme`, strip && "motion or transitions: the strips"];
    if (ofScreens(path, needs)) {
      touched = true;
      const hit = namedBy(wordOf(path), all);
      if (hit.length) hit.forEach((n) => named.add(n));
      else every = true;
      const views = hit.length ? `the views named "${wordOf(path)}"` : "every view (it names none)";
      why.push(`${path}: ${[views, ...notes].filter(Boolean).join("; ")}`);
    } else if (needs === "full") {
      touched = true;
      every = true;
      why.push(`${path}: every view (shared)${notes.filter(Boolean).map((x) => `; ${x}`).join("")}`);
    }
  }
  if (!touched) return null;
  const choice = { themes: themes.size ? [...themes] : [DEFAULT_THEME], strips };
  // Whole attempts of the chosen themes and sizes; none when the views named are drawn only in
  // portrait or at 4K, which the book alone takes.
  const shots = every ? null : chosen({ ...choice, shots: [...named] });
  return { ...choice, shots, why };
}
