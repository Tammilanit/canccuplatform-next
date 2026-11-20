// The `gh` calls the CI scripts share (release-tag.mjs, regressions.mjs). Each script takes `gh`
// as an argument, so its tests hand in fake-gh.mjs instead of the CLI.
import { execFileSync } from "node:child_process";

// The CLI with the job's GH_TOKEN. A failed call throws with gh's stderr, which fails the step.
export const realGh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 << 20 });

export const get = (gh, path) => JSON.parse(gh(["api", path]));

// Every page of a list endpoint: one JSON value a line, so pages need no merging. `key` names the
// array of an endpoint that wraps it in an object (`workflow_runs`, `jobs`).
export const list = (gh, path, key = "") =>
  gh(["api", "--paginate", "--jq", `.${key}[]`, path])
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

// An issue is found by a marker comment in its body, never by searching its title: the search
// API is fuzzy and lags, and a title may be edited by hand.
export const markerOf = (kind, key) => `<!-- canccu-${kind}: ${key} -->`;

// `state` is open, closed or all.
export function issueWith(gh, repo, label, marker, state = "open") {
  return list(gh, `repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=${state}&per_page=100`).find(
    (issue) => !issue.pull_request && (issue.body ?? "").includes(marker),
  );
}

// `gh issue create --label` fails on a label the repo lacks; creating one that exists fails too,
// which is the case this ignores.
export function ensureLabel(gh, repo, label, color, description) {
  try {
    gh(["label", "create", label, "--repo", repo, "--color", color, "--description", description]);
  } catch {
    // exists already
  }
}

export function createIssue(gh, repo, { title, body, label }) {
  const url = gh(["issue", "create", "--repo", repo, "--title", title, "--label", label, "--body", body]).trim();
  return Number(url.split("/").pop());
}
