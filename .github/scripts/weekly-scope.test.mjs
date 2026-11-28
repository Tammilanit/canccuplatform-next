// Tests of weekly-scope.mjs (docs/ci.md#weekly, #861): which pull requests take the weekly
// screens, and that weekly.yml runs its screens and screen-diff by that answer.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { COMPARISON, comparesScreens } from "./weekly-scope.mjs";

const SCRIPT = new URL("weekly-scope.mjs", import.meta.url).pathname;
const WEEKLY = readFileSync(new URL("../workflows/weekly.yml", import.meta.url), "utf8");

test("the screen stack tests and the screenshot scripts take no weekly screens: their demo-stack shots cover them", () => {
  for (const path of [
    "modules/screen/test/stack/screens.mjs",
    "scripts/demo-screenshots-pages.mjs",
    "scripts/demo-screenshots-shot.mjs",
    "scripts/demo-stack-plan.mjs",
    "scripts/demo-stack-shots.mjs",
    "scripts/a11y-check.mjs",
    ".github/scripts/regressions.mjs",
    ".github/scripts/mutation-score.mjs",
    "packages/kit-py/pyproject.toml",
  ])
    assert.equal(comparesScreens([path]), false, path);
  assert.equal(comparesScreens([]), false);
});

test("the comparison's own files take them, the stack's action at any depth", () => {
  for (const path of [
    ".github/workflows/weekly.yml",
    ".github/scripts/screenshot-compare.mjs",
    ".github/actions/demo-stack-up/action.yml",
    ".github/actions/demo-stack-up/lib/cache.sh",
  ])
    assert.equal(comparesScreens(["modules/screen/test/stack/screens.mjs", path]), true, path);
  // Only the action's own folder, not one named like it.
  assert.equal(comparesScreens([".github/actions/demo-stack-upper/action.yml"]), false);
});

// The pull_request paths of weekly.yml, as written: one `- path` line each under `paths:`.
const prPaths = () => {
  const block = /\n  pull_request:\n    paths:\n((?:      - .+\n)+)/.exec(WEEKLY);
  assert.ok(block, "weekly.yml has pull_request paths");
  return block[1].trim().split("\n").map((l) => l.replace(/^\s*- /, "").trim());
};

test("a pull request that changes the comparison starts the weekly run", () => {
  const paths = prPaths();
  for (const path of COMPARISON) {
    const glob = path.endsWith("/") ? `${path}**` : path;
    assert.ok(paths.includes(glob), `${glob} is a pull_request path of weekly.yml`);
  }
});

// A job's block of weekly.yml: from its `  <name>:` line to the next line at the jobs' indent (the
// next job, or the comment over it).
const job = (name) => {
  const m = new RegExp(`\\n  ${name}:\\n((?:(?:    .*)?\\n)+)`).exec(WEEKLY);
  assert.ok(m, `weekly.yml has the job ${name}`);
  return m[1];
};

test("weekly.yml runs screens on a pull request only when the scope says so, and screen-diff only after them", () => {
  const scope = job("scope");
  assert.match(scope, /if: github\.event_name == 'pull_request'/);
  assert.match(scope, /node \.github\/scripts\/weekly-scope\.mjs --base HEAD\^1/);
  const screens = job("screens");
  assert.match(screens, /needs: scope\n/);
  // Scheduled and by-hand runs skip the scope; their screens run all the same.
  assert.match(
    screens,
    /if: \$\{\{ !cancelled\(\) && \(github\.event_name != 'pull_request' \|\| needs\.scope\.outputs\.screens == 'true'\) \}\}/,
  );
  // always() would run the diff after skipped screens, and fail on their missing artifacts.
  assert.match(job("screen-diff"), /needs\.screens\.result != 'skipped'/);
});

test("the CLI reads a pull request's changed paths and prints screens=true|false", () => {
  const dir = mkdtempSync(join(tmpdir(), "canccu-weekly-scope-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, stdio: "pipe" });
  const write = (path) => {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), `${path}\n`);
  };
  const scope = () => execFileSync(process.execPath, [SCRIPT, "--base", "HEAD^1"], { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q");
    write("README.md");
    git("add", ".");
    git("commit", "-qm", "base");
    write("modules/screen/test/stack/screens.mjs");
    git("add", ".");
    git("commit", "-qm", "stack tests");
    assert.equal(scope(), "screens=false\n");
    write(".github/scripts/screenshot-compare.mjs");
    git("add", ".");
    git("commit", "-qm", "compare");
    assert.equal(scope(), "screens=true\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
