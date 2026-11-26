#!/usr/bin/env node
// The plan of scripts/shots-local.sh (#817): which modules to shoot, which screenshot groups their
// views are in and which of CI's shards take them, from CI's own map (demo-screenshots-groups.mjs),
// so a local run shoots what a PR's demo-stack run would.
// Usage: node shots-local.mjs [MODULE...]   without names, the modules changed against the base,
//        CANCCU_SHOTS_BASE (default origin/main)
// Prints `module NAME GROUPS` and `shard NAME GROUPS MODULES` lines (comma lists, `-` for none).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHARDS, asModule, needsOf } from "./demo-screenshots-groups.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// CI runs everything for these (the full tier), as every surface draws on them; before a push
// that is too slow, so a local run takes the module's own pages and the screens, where its tokens
// meet the readability check.
const LOCAL = { theming: ["theming", "screens"] };

/** The modules the changed paths belong to, sorted. */
export const modulesOf = (paths) =>
  [
    ...new Set(
      paths
        .map(asModule)
        .filter((p) => p.startsWith("modules/"))
        .map((p) => p.split("/")[1]),
    ),
  ].sort();

/** The screenshot groups of a module's views; none for a module without pages. */
export function groupsOf(module) {
  if (LOCAL[module]) return LOCAL[module];
  // A path of the module itself, not its dev seed, which also takes the dev-seed shard.
  const needs = needsOf(`modules/${module}/src/index`);
  if (!Array.isArray(needs))
    throw new Error(`${module}: no local groups (scripts/shots-local.mjs)`);
  return needs;
}

/** The modules' groups and CI's shards for them, in CI's order. */
export function plan(modules, known) {
  for (const m of modules)
    if (!known.includes(m)) throw new Error(`unknown module ${m}`);
  const sorted = [...new Set(modules)].sort();
  const mods = sorted.map((module) => ({ module, groups: groupsOf(module) }));
  const shards = SHARDS.map(({ shard, groups }) => ({
    shard,
    groups: groups.filter((g) => mods.some((m) => m.groups.includes(g))),
    modules: mods
      .filter((m) => m.groups.some((g) => groups.includes(g)))
      .map((m) => m.module),
  })).filter(({ groups }) => groups.length > 0);
  return { modules: mods, shards };
}

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .split("\n")
    .filter(Boolean);

/** The paths the branch and its working tree change against `ref`, untracked files too. */
function changedPaths(ref) {
  let base;
  try {
    base = git("merge-base", ref, "HEAD")[0];
  } catch {
    throw new Error(`no merge base of ${ref} and HEAD (CANCCU_SHOTS_BASE)`);
  }
  return [
    ...git("diff", "--name-only", "--no-renames", base),
    ...git("ls-files", "--others", "--exclude-standard"),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const known = readdirSync(`${ROOT}/modules`, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const names = process.argv.slice(2);
  let out;
  try {
    const base = process.env.CANCCU_SHOTS_BASE || "origin/main";
    out = plan(names.length ? names : modulesOf(changedPaths(base)), known);
  } catch (err) {
    console.error(`shots-local: ${err.message}`);
    process.exit(2);
  }
  const list = (xs) => (xs.length ? xs.join(",") : "-");
  for (const { module, groups } of out.modules)
    console.log(`module ${module} ${list(groups)}`);
  for (const { shard, groups, modules } of out.shards)
    console.log(`shard ${shard} ${list(groups)} ${list(modules)}`);
}
