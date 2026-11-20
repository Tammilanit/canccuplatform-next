#!/usr/bin/env node
// Files what a scheduled run found (docs/ci.md#regressions, #575): one `regression` issue per
// failing test of the nightly demo stack, or per failing part of the weekly run, found again by
// its name on later runs, which comment on the open issue instead of filing another.
// Usage: regressions.mjs   with GH_TOKEN and
//   REPO      owner/name          RUN_ID  the run to report      SHA  its commit
//   WORKFLOW  its file name, whose last green run (EVENT, default schedule) starts the commit list
//   PER       test (default: each `FAIL <name>` line of a failed job, the convention of
//             scripts/demo-stack-test and scripts/demo-screenshots) or job (each failed job)
//   PREFIX    put before every name (`weekly: `)      IGNORE  job names never reported, comma-separated
import { pathToFileURL } from "node:url";
import { createIssue, ensureLabel, get, list, issueWith, markerOf, realGh } from "./gh.mjs";

const LABEL = "regression";
const FAILED = ["failure", "timed_out"];
const MAX_OUTPUT = 6000;
const TAIL_LINES = 40;

const clean = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").replace(/\x1b\[[0-9;]*m/g, ""));

// A test's output is its FAIL line and what it printed until the next test's line. Its name stops
// before the first `: ` (the screenshot scripts print `FAIL <shot>: <url>: <error>`) or the
// ` (HTTP n)` of demo-stack-test, so the same test keeps its name however it failed.
function testsOf(lines) {
  const tests = [];
  for (const line of lines) {
    const fail = /^FAIL (.+?)(?:: .*| \(HTTP \d+\))?$/.exec(line);
    if (fail) tests.push({ name: fail[1], lines: [line] });
    else if (/^(ok|FAIL) /.test(line) || /^##\[/.test(line)) tests.push(null);
    else if (tests.at(-1)) tests.at(-1).lines.push(line);
  }
  return tests.filter(Boolean);
}

export function failuresOf(jobs, logs, { perTest, prefix = "", ignore = [] }) {
  const byName = new Map();
  const add = (name, job, output) => {
    const text = `${job.name}:\n${output.trim()}`;
    const known = byName.get(name);
    if (known) known.output += `\n\n${text}`;
    else byName.set(name, { name, output: text });
  };
  for (const job of jobs) {
    if (!FAILED.includes(job.conclusion) || ignore.includes(job.name)) continue;
    const lines = clean(logs[job.id] ?? "");
    const tests = perTest ? testsOf(lines) : [];
    if (tests.length) for (const t of tests) add(prefix + t.name, job, t.lines.join("\n"));
    else add(prefix + job.name, job, lines.filter((l) => l.trim()).slice(-TAIL_LINES).join("\n"));
  }
  return [...byName.values()];
}

// Text from a log or a commit goes into an issue: a bare `@` would mention someone.
const unmention = (text) => text.replaceAll("@", "@​");

// Log text must also not end the code block it sits in.
const fenced = (text) => {
  const safe = unmention(text.replaceAll("```", "'''"));
  const cut = safe.length > MAX_OUTPUT ? `…\n${safe.slice(-MAX_OUTPUT)}` : safe;
  return ["```", cut, "```"].join("\n");
};

// One page holding one run: `list()` would page through every green run there is.
function commitsSince({ gh, repo, workflow, event, sha }) {
  const green = get(gh, `repos/${repo}/actions/workflows/${workflow}/runs?status=success&event=${event}&per_page=1`).workflow_runs[0];
  if (!green) return `no green run of ${workflow} yet.`;
  if (green.head_sha === sha) return "none: the last green run was on this commit.";
  const since = green.head_sha.slice(0, 7);
  let commits;
  try {
    ({ commits } = get(gh, `repos/${repo}/compare/${green.head_sha}...${sha}`));
  } catch (err) {
    // A rewritten history (404) or the rate limit must not keep the night's failures unfiled.
    console.error(`compare ${since}...${sha.slice(0, 7)} failed: ${err.message}`);
    return `unknown: comparing with the last green run (${since}) failed.`;
  }
  return [
    `since the last green run (${since}):`,
    ...commits.map((c) => `- ${c.sha.slice(0, 7)} ${unmention(c.commit.message.split("\n")[0])}`),
  ].join("\n");
}

export function run({ gh, env }) {
  const { REPO: repo, RUN_ID: runId, SHA: sha, WORKFLOW: workflow } = env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !/^\d+$/.test(runId ?? "") || !/^[0-9a-f]{40}$/.test(sha ?? "") || !workflow) {
    throw new Error("REPO, RUN_ID, SHA and WORKFLOW are needed");
  }
  const jobs = list(gh, `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, "jobs");
  const ignore = (env.IGNORE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const failedJobs = jobs.filter((j) => FAILED.includes(j.conclusion) && !ignore.includes(j.name));
  const logs = Object.fromEntries(failedJobs.map((j) => [j.id, gh(["api", `repos/${repo}/actions/jobs/${j.id}/logs`])]));
  const failures = failuresOf(failedJobs, logs, { perTest: env.PER !== "job", prefix: env.PREFIX ?? "", ignore });
  if (!failures.length) return [];

  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  const commits = commitsSince({ gh, repo, workflow, event: env.EVENT || "schedule", sha });
  const report = (f) =>
    [`Failed in [the ${workflow} run](${runUrl}) on ${sha.slice(0, 7)}:`, "", fenced(f.output), "", `Commits ${commits}`].join("\n");
  ensureLabel(gh, repo, LABEL, "d93f0b", "A scheduled run found it failing; the lead triages it");
  return failures.map((f) => {
    const marker = markerOf(LABEL, f.name);
    const open = issueWith(gh, repo, LABEL, marker);
    if (open) {
      gh(["issue", "comment", String(open.number), "--repo", repo, "--body", `Still failing.\n\n${report(f)}`]);
      return { name: f.name, commented: open.number };
    }
    const body = [
      report(f),
      "",
      "Find the change that broke it in the commits above, fix it with the test that would have caught it, or report",
      "why not (AGENTS.md, Run and test). The same failure on a later run comments here instead of filing again.",
      "",
      marker,
    ].join("\n");
    return { name: f.name, filed: createIssue(gh, repo, { title: `regression: ${f.name}`.slice(0, 240), body, label: LABEL }) };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const r of run({ gh: realGh, env: process.env })) console.log(JSON.stringify(r));
}
