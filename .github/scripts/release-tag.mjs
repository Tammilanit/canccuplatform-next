#!/usr/bin/env node
// The release step of release-tag.yml (docs/ci.md#releases, #574): when CI and Demo stack have
// both finished on a push to main, tag the commit v0.<step>.<n> if both passed and it is still
// main's head, or file one `release-red` issue for it if either failed.
// Usage: release-tag.mjs [--dry-run]   with REPO (owner/name), SHA (the pushed commit) and
//        GH_TOKEN; GITHUB_OUTPUT, when set, gets `tag=<tag>` for the image build.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createIssue, ensureLabel, get, list, issueWith, markerOf, realGh } from "./gh.mjs";

const WORKFLOWS = { ci: ".github/workflows/ci.yml", demo: ".github/workflows/demo-stack.yml" };
const RED = ["failure", "timed_out", "startup_failure"];
const LABEL = "release-red";

const stepTag = (tag) => /^step-(\d+)$/.exec(tag)?.[1];

// The step milestones say `Step <n>` first in their description; the tracks' milestones do not.
// A step's checkpoint is its `step-<n>` tag, so the current step is the first open one after it.
// Milestones of finished steps stay open while a stray issue does, which is why the tag decides.
export function currentStep(milestones, tags) {
  const done = Math.max(0, ...tags.map(stepTag).filter(Boolean).map(Number));
  const open = milestones
    .filter((m) => m.state === "open")
    .map((m) => Number(/^Step (\d+)\b/.exec(m.description ?? "")?.[1]))
    .filter((n) => n > done);
  return open.length ? Math.min(...open) : null;
}

export function nextTag(step, tags) {
  const re = new RegExp(`^v0\\.${step}\\.(\\d+)$`);
  const used = tags.map((t) => re.exec(t)?.[1]).filter(Boolean).map(Number);
  return `v0.${step}.${used.length ? Math.max(...used) + 1 : 0}`;
}

// runs: { ci, demo }, each the newest run of that workflow for sha, or undefined before it starts.
// A failure is red at once, even on an older head: main was red at that commit. A cancelled run
// was replaced by a newer push, which gets its own decision.
export function decide({ sha, mainHead, runs, tagsAtSha }) {
  const all = [runs.ci, runs.demo];
  if (all.some((r) => r?.status === "completed" && RED.includes(r.conclusion))) return { action: "red" };
  if (all.some((r) => !r || r.status !== "completed")) return { action: "wait", reason: "a run has not finished" };
  if (all.some((r) => r.conclusion !== "success")) return { action: "skip", reason: "a run was cancelled or skipped" };
  if (sha !== mainHead) return { action: "skip", reason: "a newer push is main's head; it gets the tag" };
  if (tagsAtSha.some((t) => /^v0\.\d+\.\d+$/.test(t))) return { action: "skip", reason: "already tagged" };
  return { action: "tag" };
}

export function redIssue({ repo, sha, runs, lastTag }) {
  const server = "https://github.com";
  const failed = Object.values(runs)
    .filter((r) => r && RED.includes(r.conclusion))
    .map((r) => `- [${r.path.split("/").pop()}](${r.html_url}): ${r.conclusion}`);
  const since = lastTag
    ? `[the commits since ${lastTag}](${server}/${repo}/compare/${lastTag}...${sha})`
    : `the commits up to ${sha} (there is no v0 tag yet)`;
  return {
    title: `release red at ${sha.slice(0, 7)}`,
    body: [
      `The full pipeline failed on main at ${sha}, so it is not tagged as a release.`,
      "",
      "Failed:",
      ...failed,
      "",
      "**For the worker (the release investigator):** find the change that broke it, from the failing job's log",
      `(\`gh run view <run> --log-failed\`) and ${since}. Read that change closely, and fix it, or report why not`,
      "in a comment here. A fix comes with the test that would have caught the break (AGENTS.md, Run and test).",
      "",
      markerOf(LABEL, sha),
    ].join("\n"),
  };
}

export function run({ gh, env, dryRun = false }) {
  const { REPO: repo, SHA: sha } = env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
    throw new Error("REPO (owner/name) and SHA (40 hex) are needed");
  }
  const newest = (path) =>
    list(gh, `repos/${repo}/actions/runs?head_sha=${sha}&event=push&per_page=100`, "workflow_runs")
      .filter((r) => r.path === path)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const runs = { ci: newest(WORKFLOWS.ci), demo: newest(WORKFLOWS.demo) };
  const refs = list(gh, `repos/${repo}/git/matching-refs/tags/`);
  const tags = refs.map((r) => r.ref.replace(/^refs\/tags\//, ""));
  const tagsAtSha = refs.filter((r) => peel(gh, repo, r.object) === sha).map((r) => r.ref.replace(/^refs\/tags\//, ""));
  const mainHead = get(gh, `repos/${repo}/commits/main`).sha;
  const decision = decide({ sha, mainHead, runs, tagsAtSha });

  if (decision.action === "red") {
    const marker = markerOf(LABEL, sha);
    // A closed one counts too: closing it says the red was handled, not that it should be filed again.
    const known = issueWith(gh, repo, LABEL, marker, "all");
    if (known) return { action: "red", filed: false, issue: known.number };
    if (dryRun) return { action: "red", filed: false, dryRun: true };
    const lastTag = tags.filter((t) => /^v0\.\d+\.\d+$/.test(t)).sort(byVersion).pop();
    ensureLabel(gh, repo, LABEL, "b60205", "Main's full pipeline failed; the issue is the release investigator");
    createIssue(gh, repo, { ...redIssue({ repo, sha, runs, lastTag }), label: LABEL });
    return { action: "red", filed: true };
  }
  if (decision.action !== "tag") return decision;

  const step = currentStep(list(gh, `repos/${repo}/milestones?state=open&per_page=100`), tags);
  if (step === null) throw new Error("no open step milestone after the newest step-<n> tag");
  const tag = nextTag(step, tags);
  if (dryRun) return { action: "tag", tag, dryRun: true };
  // A lightweight tag, made through the API: the tag job checks nothing out.
  gh(["api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`]);
  return { action: "tag", tag };
}

// An annotated tag's ref points at a tag object, which points at the commit (or, rarely, at
// another tag object).
function peel(gh, repo, object) {
  let { sha, type } = object;
  while (type === "tag") ({ sha, type } = get(gh, `repos/${repo}/git/tags/${sha}`).object);
  return sha;
}

const byVersion = (a, b) => {
  const [x, y] = [a, b].map((t) => t.slice(1).split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run({ gh: realGh, env: process.env, dryRun: process.argv.includes("--dry-run") });
  console.log(JSON.stringify(result));
  if (result.tag && !result.dryRun && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\n`);
  }
}
