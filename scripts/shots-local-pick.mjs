#!/usr/bin/env node
// The shots of scripts/shots-local.sh's per-shot mode (#825): a worker's command may run 10
// minutes, and a whole screen shard locally takes longer, so a run takes only the shots it names
// (CI's FAIL lines, say) or those whose file names a branch changed.
// Usage: node shots-local-pick.mjs shots NAME|GLOB...   `shot NAME GROUP` lines, in CI's order
//        node shots-local-pick.mjs changed               the same, and `note TEXT` lines for what
//                                                        it cannot pick (CANCCU_SHOTS_BASE)
//        node shots-local-pick.mjs unreached NAME... < LOG   the names the run's log never reached
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { GROUPS, asModule, needsOf } from "./demo-screenshots-groups.mjs";
import { attemptOf, chosen } from "../modules/screen/test/stack/screen-views.mjs";
import { changedPaths } from "./shots-local.mjs";
import { screensFor, viewWords, wordOf } from "./demo-stack-shots.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);

// The passes of scripts/demo-screenshots and the groups each can take; the dev-seed pass takes its
// own group only. The main pass alone takes the screens, so it alone knows `--strips`.
const PASSES = [
  ["demo-screenshots.mjs", GROUPS.filter((g) => g !== "dev-seed"), ["--strips"]],
  ["demo-screenshots-front.mjs", GROUPS.filter((g) => g !== "dev-seed"), []],
  ["demo-screenshots-dev-seed.mjs", ["dev-seed"], []],
];

/**
 * CI's shot list, which the local run names from: every shot's name and group at 1920×1080 in
 * every theme, the strips too, from the passes' own dry runs in the merge queue's check, one group
 * at a time.
 */
export async function shotList() {
  const lists = await Promise.all(
    PASSES.flatMap(([script, groups, own]) =>
      groups.map(async (group) => {
        const { stdout } = await run(
          "node",
          [`scripts/${script}`, "--dry-run", "--check", ...own, "--groups", group],
          { cwd: ROOT, maxBuffer: 16 << 20 },
        );
        return [...stdout.matchAll(/^ +(\S+)\.png +/gm)].map(([, name]) => ({ name, group }));
      }),
    ),
  );
  const seen = new Set();
  return lists.flat().filter(({ name }) => !seen.has(name) && seen.add(name));
}

/** A name or glob (`*`, `?`) as given: a PNG's name, or a FAIL line's with its colon. */
const matcher = (pattern) => {
  const bare = pattern.replace(/:$/, "").replace(/\.png$/, "");
  const re = bare.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`);
};

/**
 * The shots of `list` the patterns match, in its order; a pattern matching none throws. A name no
 * shot has may be a FAIL line's view (a strip or the surge that failed as a whole): it picks every
 * shot that view takes.
 */
export function pick(patterns, list) {
  const res = patterns.map((p) => [p, matcher(p)]);
  const hits = ([, re], shot) => re.test(shot.name) || re.test(attemptOf(shot.name));
  const byName = ([, re]) => list.some(({ name }) => re.test(name));
  const used = res.map((r) => (byName(r) ? (s) => r[1].test(s.name) : (s) => hits(r, s)));
  const missed = res.filter((r, i) => !list.some(used[i]));
  if (missed.length)
    throw new Error(
      `not in CI's shot list (1920×1080, every theme, the strips): ${missed.map(([p]) => p).join(", ")}`,
    );
  return list.filter((s) => used.some((u) => u(s)));
}

/**
 * The screen shots a branch's changed files are named for (`dashboard.css`: the dashboard views,
 * `claims.ts`: the claim views), in the themes and with the strips CI's run of the same paths
 * takes (demo-stack-shots.mjs), and a note for each file with views whose shots it cannot name:
 * a file every screen draws on, or another group's pages, which run whole.
 */
export function changedShots(paths, list) {
  const ci = screensFor(paths);
  const allowed = new Set(ci ? chosen({ themes: ci.themes, strips: ci.strips }) : []);
  const screens = list.filter((s) => s.group === "screens" && allowed.has(s.name));
  const shots = new Set();
  const notes = [];
  for (const path of paths) {
    const needs = needsOf(path);
    if (needs === "docs" || (Array.isArray(needs) && needs.length === 0)) continue;
    const ours = Array.isArray(needs)
      ? needs.includes("screens")
      : asModule(path).startsWith("modules/screen/");
    if (!ours) {
      const what = Array.isArray(needs) ? `the ${needs.join(", ")} views` : "every group's views";
      notes.push(`${path}: changes ${what}, which --changed does not pick shot by shot`);
      continue;
    }
    const word = wordOf(path);
    // The module's own name is in many of its files' names and says nothing of a view.
    const hit = ["screen", "screens"].includes(word)
      ? []
      : screens.filter(({ name }) =>
          viewWords(name).some((w) => w === word || `${w}s` === word),
        );
    if (hit.length === 0) notes.push(`${path}: names no screen shot; it may change any of them`);
    for (const { name } of hit) shots.add(name);
  }
  return { shots: screens.filter(({ name }) => shots.has(name)), notes };
}

/**
 * The names a run's log never reached: no `ok` line of the shot, and no `FAIL` line of it or of the
 * view that takes it (a failed view takes none of its shots). A run that broke off early, or a
 * name the screens' filter did not know, then fails instead of passing on nothing.
 */
export function unreached(names, log) {
  const ok = new Set([...log.matchAll(/^ok +(\S+)\.png\b/gm)].map(([, n]) => n));
  const failed = new Set([...log.matchAll(/^FAIL (\S+?):/gm)].map(([, n]) => n));
  return names.filter(
    (n) => !ok.has(n) && !failed.has(n) && !failed.has(attemptOf(n)),
  );
}

// Through a link to the script too: Node runs the file it points to.
if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "unreached") {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      for (const n of unreached(args, Buffer.concat(chunks).toString())) console.log(n);
    } else if (cmd === "shots" || cmd === "changed") {
      const list = await shotList();
      const out =
        cmd === "shots"
          ? { shots: pick(args, list), notes: [] }
          : changedShots(changedPaths(process.env.CANCCU_SHOTS_BASE || "origin/main"), list);
      for (const { name, group } of out.shots) console.log(`shot ${name} ${group}`);
      for (const note of out.notes) console.log(`note ${note}`);
    } else throw new Error(`usage: shots-local-pick.mjs shots|changed|unreached ...`);
  } catch (err) {
    console.error(`shots-local: ${err.message}`);
    process.exit(2);
  }
}
