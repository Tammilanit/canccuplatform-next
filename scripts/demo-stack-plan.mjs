#!/usr/bin/env node
// The demo stack's first job (#461, docs/ci.md#tiers): which tier a run needs, from the event and
// the changed paths, and so which of the API tests, the soak and the screenshot shards run, and
// which screen shots (#835).
// Usage: node demo-stack-plan.mjs --event EVENT [--base REV] [--book] [--summary FILE]
//          KEY=value lines for $GITHUB_OUTPUT; with --summary, what runs and why as Markdown
//        node demo-stack-plan.mjs --self-test
// The changed paths are `git diff --name-only --no-renames REV HEAD`, read for a pull request, a
// merge queue entry and a push to main: each runs what its changes affect. The nightly run and a
// manual run are the full run; a manual run with --book is the screenshot book.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  GROUPS,
  SHARDS,
  apiOf,
  moduleOf,
  needsOf,
} from "./demo-screenshots-groups.mjs";
import { screensFor } from "./demo-stack-shots.mjs";

const PATH_EVENTS = new Set(["pull_request", "merge_group", "push"]);
const FULL_EVENTS = new Set(["schedule", "workflow_dispatch"]);
// The full run's screens in this many shards, cut by screen-views.mjs `chosen` (`--part`), so no
// shard runs past about 15 minutes.
const SCREEN_PARTS = 2;

/** The options scripts/demo-screenshots takes for a choice of screen shots. */
const flags = ({ themes, strips, book, shots }) =>
  [
    themes && `--themes ${themes.join(",")}`,
    strips && "--strips",
    book && "--book",
    shots?.length && `--shots ${shots.join(",")}`,
  ]
    .filter(Boolean)
    .join(" ");

const shardsFor = (wanted, select, parts) =>
  SHARDS.flatMap(({ shard, groups }) => {
    const own = groups.filter((g) => wanted.has(g)).join(",");
    if (!own) return [];
    if (shard !== "screens" || parts === 1)
      return [{ shard, groups: own, select }];
    return Array.from({ length: parts }, (_, i) => ({
      shard: `${shard}-${i + 1}`,
      groups: own,
      select: `${select} --part ${i + 1}/${parts}`.trim(),
    }));
  });

const inOrder = (wanted) => GROUPS.filter((g) => wanted.has(g)).join(",");

/**
 * The run an event and its changed paths need. `api` is the module list scripts/demo-stack-test
 * takes (`all`, or the modules whose tests cover the changed ones: its platform smoke runs
 * whatever the list). The soak guards the player's memory over a day, so it runs for screen and
 * on a full tier. `check`: the merge queue writes no PNG of a page and no artifact. `select` is
 * the screen shots' choice every shard hands scripts/demo-screenshots, `groups` every group of
 * the run (the weekly run's one stack), `why` a line for each decision.
 */
export function plan({ event, paths, book = false }) {
  if (!PATH_EVENTS.has(event) && !FULL_EVENTS.has(event))
    throw new Error(`unknown event ${event}`);
  if (book && event !== "workflow_dispatch")
    throw new Error("the screenshot book is a manual run's");
  const check = event === "merge_group";
  if (FULL_EVENTS.has(event)) {
    const select = flags({ strips: true, book });
    return {
      tier: "full",
      api: "all",
      soak: true,
      check,
      run: book ? "book" : "full",
      groups: GROUPS.join(","),
      select,
      shards: shardsFor(new Set(GROUPS), select, SCREEN_PARTS),
      why: [
        book
          ? `${event}, the book: every view in every theme, the strips, portrait and one 4K shot per layout`
          : `${event}: every view in every theme at 1920×1080, and the strips`,
      ],
    };
  }
  const needs = paths.map(needsOf);
  const code = paths.filter((_, i) => needs[i] !== "docs");
  if (code.length === 0)
    return {
      tier: "docs",
      api: "",
      soak: false,
      check,
      run: "affected",
      groups: "",
      select: "",
      shards: [],
      why: ["only docs changed"],
    };
  const full = needs.includes("full");
  const wanted = new Set(full ? GROUPS : needs.filter(Array.isArray).flat());
  const screens = screensFor(paths);
  const why = code.map((path) => {
    const n = needsOf(path);
    const what = n === "full" ? "every group" : n.length ? n.join(", ") : "no shots";
    return `${path}: ${what}`;
  });
  if (screens) why.push(...screens.why.map((line) => `screens: ${line}`));
  if (screens?.shots?.length === 0) {
    wanted.delete("screens");
    why.push("screens: the views named are drawn only in portrait or at 4K, which the book takes");
  }
  const select = screens ? flags({ ...screens, book: false }) : "";
  const modules = [...new Set(code.map(moduleOf))].sort();
  return {
    tier: full ? "full" : "module",
    api: full ? "all" : [...new Set(modules.map(apiOf))].sort().join(","),
    soak: full || modules.includes("screen"),
    check,
    run: "affected",
    groups: inOrder(wanted),
    select,
    shards: shardsFor(wanted, select, 1),
    why,
  };
}

export const format = ({ tier, api, soak, check, run, groups, select, shards }) =>
  [
    `tier=${tier}`,
    `api=${api}`,
    `soak=${soak}`,
    `check=${check}`,
    `run=${run}`,
    `groups=${groups}`,
    `select=${select}`,
    `shards=${JSON.stringify(shards)}`,
  ].join("\n");

/** What runs and why, as the run's summary (docs/ci.md#tiers). */
export function summary(event, out) {
  const shots = /--shots (\S+)/.exec(out.select)?.[1].split(",");
  const themes = /--themes (\S+)/.exec(out.select)?.[1] ?? "every theme";
  const sizes = out.run === "book"
    ? "1920×1080, portrait 1080×1920 and one 4K shot per layout"
    : "1920×1080 (no portrait, no 4K)";
  return [
    `### demo-stack: ${out.run} run (${event}), tier ${out.tier}`,
    "",
    out.shards.length
      ? `Shards: ${out.shards.map((s) => `\`${s.shard}\` (${s.groups})`).join(", ")}.`
      : "No screenshot shard.",
    ...(out.groups.split(",").includes("screens")
      ? [
          "",
          `Screens: ${themes}; ${sizes}; ${/--strips/.test(out.select) ? "with" : "without"} the frame strips; ${shots ? `${shots.length} shots: ${shots.join(", ")}` : "every view"}.`,
        ]
      : []),
    "",
    "Why:",
    ...out.why.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

// --no-renames: git lists a moved file only under its new path, so a file moved out of a shared
// path into one module would plan that module's tier; both paths must be mapped.
export const changedPaths = (base, cwd) =>
  execFileSync("git", ["diff", "--name-only", "--no-renames", base, "HEAD"], {
    cwd,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

const { values: opts } = parseArgs({
  options: {
    "self-test": { type: "boolean", default: false },
    event: { type: "string" },
    base: { type: "string" },
    book: { type: "boolean", default: false },
    summary: { type: "string" },
  },
});
if (opts["self-test"]) {
  const { selftest } = await import("./demo-stack-plan-test.mjs");
  selftest({ plan, format, summary, changedPaths });
} else {
  if (!opts.event) {
    console.error(
      "usage: demo-stack-plan.mjs --event EVENT [--base REV] [--book] [--summary FILE] | --self-test",
    );
    process.exit(2);
  }
  let paths = [];
  if (PATH_EVENTS.has(opts.event)) {
    if (!opts.base) {
      console.error(`demo-stack-plan: --base is needed for ${opts.event}`);
      process.exit(2);
    }
    paths = changedPaths(opts.base);
  }
  const out = plan({ event: opts.event, paths, book: opts.book });
  if (opts.summary) appendFileSync(opts.summary, summary(opts.event, out));
  console.error(
    `demo-stack-plan: ${opts.event}, ${paths.length} changed paths, tier ${out.tier}`,
  );
  console.log(format(out));
}
