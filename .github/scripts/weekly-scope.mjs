#!/usr/bin/env node
// Whether a pull request's weekly run takes `screens (base)`, `screens (head)` and `screen-diff`
// (docs/ci.md#weekly, #861): only when it changes the weekly comparison itself. A change to the
// screenshot scripts or the screen stack tests is covered by its own demo-stack shots, and the
// weekly screens are the slowest and flakiest jobs of a pull request's CI (#845). The other
// short-form parts keep the run's pull_request paths; scheduled and by-hand runs skip this.
// Usage: weekly-scope.mjs --base REV   prints `screens=true|false` for $GITHUB_OUTPUT
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// A path ending in `/` is a folder, taken at any depth; each is also a pull_request path of
// weekly.yml, so a change to it starts the run (the test holds the two lists together).
export const COMPARISON = [
  ".github/workflows/weekly.yml",
  ".github/scripts/screenshot-compare.mjs",
  ".github/actions/demo-stack-up/",
];

export const comparesScreens = (paths) =>
  paths.some((path) => COMPARISON.some((c) => (c.endsWith("/") ? path.startsWith(c) : path === c)));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { base: { type: "string" } } });
  if (!values.base) {
    console.error("usage: weekly-scope.mjs --base REV");
    process.exit(2);
  }
  // --no-renames: a file moved out of the comparison counts under both its paths.
  const paths = execFileSync("git", ["diff", "--name-only", "--no-renames", values.base, "HEAD"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  console.log(`screens=${comparesScreens(paths)}`);
}
