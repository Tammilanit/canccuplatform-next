#!/usr/bin/env node
// The demo stack's first job (#461, docs/ci.md#tiers): which tier a run needs, from the event and
// the changed paths, and so which of the API tests, the soak and the screenshot shards run.
// Usage: node demo-stack-plan.mjs --event EVENT [--base REV]   KEY=value lines for $GITHUB_OUTPUT
//        node demo-stack-plan.mjs --self-test
// The changed paths are `git diff --name-only --no-renames REV HEAD`, read only for a pull request
// or a merge queue entry; every other event (push to main, the nightly run, a manual run) is the
// full run.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  GROUPS,
  SHARDS,
  apiOf,
  moduleOf,
  needsOf,
} from "./demo-screenshots-groups.mjs";

const PATH_EVENTS = new Set(["pull_request", "merge_group"]);
const FULL_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);

const shardsFor = (wanted) =>
  SHARDS.map(({ shard, groups }) => ({
    shard,
    groups: groups.filter((g) => wanted.has(g)),
  }))
    .filter(({ groups }) => groups.length > 0)
    .map(({ shard, groups }) => ({ shard, groups: groups.join(",") }));

/**
 * The run an event and its changed paths need. `api` is the module list scripts/demo-stack-test
 * takes (`all`, or the modules whose tests cover the changed ones: its platform smoke runs
 * whatever the list). The soak
 * guards the player's memory over a day, so it runs for screen and on the full run. `check`: the
 * merge queue runs the shots' checks without capturing every theme and size.
 */
export function plan({ event, paths }) {
  if (!PATH_EVENTS.has(event) && !FULL_EVENTS.has(event))
    throw new Error(`unknown event ${event}`);
  const check = event === "merge_group";
  const needs = FULL_EVENTS.has(event) ? ["full"] : paths.map(needsOf);
  if (needs.includes("full"))
    return {
      tier: "full",
      api: "all",
      soak: true,
      check,
      shards: shardsFor(new Set(GROUPS)),
    };
  const code = paths.filter((_, i) => needs[i] !== "docs");
  if (code.length === 0)
    return { tier: "docs", api: "", soak: false, check, shards: [] };
  const modules = [...new Set(code.map(moduleOf))].sort();
  return {
    tier: "module",
    api: [...new Set(modules.map(apiOf))].sort().join(","),
    soak: modules.includes("screen"),
    check,
    shards: shardsFor(new Set(needs.filter(Array.isArray).flat())),
  };
}

export const format = ({ tier, api, soak, check, shards }) =>
  [
    `tier=${tier}`,
    `api=${api}`,
    `soak=${soak}`,
    `check=${check}`,
    `shards=${JSON.stringify(shards)}`,
  ].join("\n");

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
  },
});
if (opts["self-test"]) {
  const { selftest } = await import("./demo-stack-plan-test.mjs");
  selftest({ plan, format, changedPaths });
} else {
  if (!opts.event) {
    console.error(
      "usage: demo-stack-plan.mjs --event EVENT [--base REV] | --self-test",
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
  const out = plan({ event: opts.event, paths });
  console.error(
    `demo-stack-plan: ${opts.event}, ${paths.length} changed paths, tier ${out.tier}`,
  );
  console.log(format(out));
}
