// Tests of release-tag.mjs (docs/ci.md#releases): the step, the tag number, the decision and the
// release-red dedupe, against a fake `gh` that answers from memory and records every write.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { currentStep, decide, nextTag, run } from "./release-tag.mjs";
import { fakeGh } from "./fake-gh.mjs";

const SHA = "a".repeat(40);
const NEWER = "b".repeat(40);
const ms = (number, description, state = "open") => ({ number, description, state });
const MILESTONES = [
  ms(1, "Step 1: infrastructure"),
  ms(3, "Step 3: screen core"),
  ms(4, "Step 4"),
  ms(5, "Step 5"),
  ms(12, "Games and Cast"),
];

test("the current step is the lowest open step milestone after the newest step tag", () => {
  assert.equal(currentStep(MILESTONES, ["step-3", "v0.3.2"]), 4);
  assert.equal(currentStep(MILESTONES, ["step-2", "step-3", "step-10x"]), 4);
});

test("without a step tag the current step is the lowest open step milestone", () => {
  assert.equal(currentStep(MILESTONES, []), 1);
});

test("no open step milestone after the newest step tag is no step", () => {
  assert.equal(currentStep([ms(4, "Step 4", "closed"), ms(12, "Parallel")], ["step-3"]), null);
});

test("the first tag of a step is .0, then the next free number", () => {
  assert.equal(nextTag(4, ["step-3", "v0.3.7"]), "v0.4.0");
  assert.equal(nextTag(4, ["v0.4.0", "v0.4.1", "v0.4.10", "v0.40.3", "v0.4.x"]), "v0.4.11");
});

const runs = (ci, demo) => ({
  ci: ci && { status: ci === "pending" ? "in_progress" : "completed", conclusion: ci },
  demo: demo && { status: demo === "pending" ? "in_progress" : "completed", conclusion: demo },
});

test("both green on main's head tags it", () => {
  assert.equal(decide({ sha: SHA, mainHead: SHA, runs: runs("success", "success"), tagsAtSha: [] }).action, "tag");
});

test("a run still going or not started yet waits for it", () => {
  assert.equal(decide({ sha: SHA, mainHead: SHA, runs: runs("success", "pending"), tagsAtSha: [] }).action, "wait");
  assert.equal(decide({ sha: SHA, mainHead: SHA, runs: runs("success", null), tagsAtSha: [] }).action, "wait");
});

test("a green commit that is no longer main's head is skipped", () => {
  assert.equal(decide({ sha: SHA, mainHead: NEWER, runs: runs("success", "success"), tagsAtSha: [] }).action, "skip");
});

test("a commit that already has its v0 tag is skipped", () => {
  assert.equal(
    decide({ sha: SHA, mainHead: SHA, runs: runs("success", "success"), tagsAtSha: ["v0.4.2"] }).action,
    "skip",
  );
});

test("a failed or timed-out run is red, even before the other one ends and on an older head", () => {
  assert.equal(decide({ sha: SHA, mainHead: NEWER, runs: runs("failure", "pending"), tagsAtSha: [] }).action, "red");
  assert.equal(decide({ sha: SHA, mainHead: SHA, runs: runs("success", "timed_out"), tagsAtSha: [] }).action, "red");
});

test("a cancelled run (a newer push replaced it) is skipped, not red", () => {
  assert.equal(decide({ sha: SHA, mainHead: NEWER, runs: runs("success", "cancelled"), tagsAtSha: [] }).action, "skip");
});

// The repo as `gh api` sees it: the two workflows' runs for SHA, main's head, tags, milestones
// and the release-red issues.
function repo({ ci = "success", demo = "success", head = SHA, tags = [], issues = [] } = {}) {
  const runFor = (path, conclusion, id) => ({
    id,
    path,
    head_sha: SHA,
    created_at: `2026-11-16T10:00:0${id}Z`,
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    status: conclusion === "pending" ? "in_progress" : "completed",
    conclusion: conclusion === "pending" ? null : conclusion,
  });
  return fakeGh({
    "repos/o/r/actions/runs": {
      workflow_runs: [
        runFor(".github/workflows/ci.yml", ci, 1),
        runFor(".github/workflows/demo-stack.yml", demo, 2),
        runFor(".github/workflows/review-gate.yml", "failure", 3),
      ],
    },
    "repos/o/r/commits/main": { sha: head },
    "repos/o/r/git/matching-refs/tags/": tags.map(([name, sha]) => ({
      ref: `refs/tags/${name}`,
      object: { sha, type: "commit" },
    })),
    "repos/o/r/milestones": MILESTONES,
    "repos/o/r/issues": issues,
  });
}
const env = { REPO: "o/r", SHA };

test("a green head gets the next tag of the current step, once", () => {
  const gh = repo({ tags: [["step-3", "c".repeat(40)], ["v0.4.0", "d".repeat(40)]] });
  assert.deepEqual(run({ gh, env }), { action: "tag", tag: "v0.4.1" });
  assert.deepEqual(gh.writes, [["api", "-X", "POST", "repos/o/r/git/refs", "-f", "ref=refs/tags/v0.4.1", "-f", `sha=${SHA}`]]);
});

test("the second trigger for the same green head finds its tag and writes nothing", () => {
  const gh = repo({ tags: [["step-3", "c".repeat(40)], ["v0.4.0", SHA]] });
  assert.equal(run({ gh, env }).action, "skip");
  assert.deepEqual(gh.writes, []);
});

test("a dry run decides but writes nothing", () => {
  const gh = repo({ tags: [["step-3", "c".repeat(40)]] });
  assert.deepEqual(run({ gh, env, dryRun: true }), { action: "tag", tag: "v0.4.0", dryRun: true });
  assert.deepEqual(gh.writes, []);
});

test("a red push files one release-red issue named after its sha, with the investigator's brief", () => {
  const gh = repo({ demo: "failure", tags: [["step-3", "c".repeat(40)], ["v0.4.0", "d".repeat(40)]] });
  assert.deepEqual(run({ gh, env }), { action: "red", filed: true });
  const create = gh.writes.find((w) => w[0] === "issue" && w[1] === "create");
  assert.ok(create, "an issue was created");
  const arg = (flag) => create[create.indexOf(flag) + 1];
  assert.equal(arg("--title"), "release red at aaaaaaa");
  assert.equal(arg("--label"), "release-red");
  const body = arg("--body");
  assert.match(body, /<!-- canccu-release-red: a{40} -->/);
  assert.match(body, /actions\/runs\/2/, "links the failed run");
  assert.match(body, /compare\/v0\.4\.0\.\.\.a{40}/, "links the commits since the last v0 tag");
  assert.match(body, /fix it, or report why not/i);
});

test("a red push whose issue is already open files nothing more", () => {
  const open = { number: 9, title: "release red at aaaaaaa", body: `x\n<!-- canccu-release-red: ${SHA} -->` };
  const gh = repo({ ci: "failure", issues: [open] });
  assert.deepEqual(run({ gh, env }), { action: "red", filed: false, issue: 9 });
  assert.deepEqual(gh.writes, []);
});

test("the issue of another sha does not count as this one's", () => {
  const other = { number: 9, title: "release red at bbbbbbb", body: `<!-- canccu-release-red: ${NEWER} -->` };
  const gh = repo({ ci: "failure", issues: [other] });
  assert.equal(run({ gh, env }).filed, true);
});

test("no open step milestone fails the tag instead of guessing one", () => {
  const gh = repo({ tags: [["step-5", "c".repeat(40)]] });
  assert.throws(() => run({ gh, env }), /no open step milestone/);
  assert.deepEqual(gh.writes, []);
});
