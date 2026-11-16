// Tests of regressions.mjs (docs/ci.md#regressions): which failures a scheduled run reports, and
// that each files one `regression` issue, or comments on the open one, against a fake `gh`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { failuresOf, run } from "./regressions.mjs";
import { fakeGh } from "./fake-gh.mjs";

const T = "2026-11-16T02:31:07.1234567Z";
const log = (...lines) => lines.map((l) => `${T} ${l}`).join("\n");
const API_LOG = log(
  "ok   hello health through Caddy is ok",
  "FAIL PUT settings with the current version saves (HTTP 500)",
  '{"error":"internal"}',
  "ok   unknown module is 404 not_found",
  "FAIL the push channel's latency",
  "p95 1.4 s",
  "demo-stack-test: tests failed",
  "##[error]Process completed with exit code 1.",
);
const job = (id, name, conclusion = "failure") => ({ id, name, conclusion });

test("each FAIL line of a failed job is one failure, named without its HTTP status, with its output", () => {
  const got = failuresOf([job(1, "demo-stack (api)")], { 1: API_LOG }, { perTest: true });
  assert.deepEqual(
    got.map((f) => f.name),
    ["PUT settings with the current version saves", "the push channel's latency"],
  );
  assert.match(got[0].output, /HTTP 500\)\n\{"error":"internal"\}$/);
  assert.doesNotMatch(got[0].output, /unknown module/, "the output stops at the next test");
  assert.match(got[1].output, /p95 1\.4 s/);
  assert.doesNotMatch(got[1].output, /2026-11-16T/, "timestamps are stripped");
});

test("a failed job with no FAIL line is one failure named after the job, with its log's tail", () => {
  const stackLog = log("Starting stack", "container canccuplatform-admin-1 is unhealthy");
  const got = failuresOf([job(2, "demo-stack (shots pages)")], { 2: stackLog }, { perTest: true });
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "demo-stack (shots pages)");
  assert.match(got[0].output, /unhealthy/);
});

test("passed, skipped and ignored jobs are not failures, and a test failing in two jobs is one", () => {
  const shots = log("FAIL the push channel's latency", "again");
  const got = failuresOf(
    [job(1, "demo-stack (api)"), job(3, "demo-stack (soak)"), job(4, "demo-stack"), job(5, "plan", "success"), job(6, "x", "skipped")],
    { 1: API_LOG, 3: shots, 4: log("FAIL aggregate") },
    { perTest: true, ignore: ["demo-stack"] },
  );
  assert.deepEqual(
    got.map((f) => f.name),
    ["PUT settings with the current version saves", "the push channel's latency"],
  );
  assert.match(got[1].output, /demo-stack \(soak\)/, "the output names every job it failed in");
});

test("per part (the weekly run), a failed job is one failure under its own name, FAIL lines or not", () => {
  const got = failuresOf([job(1, "upgrade")], { 1: API_LOG }, { perTest: false, prefix: "weekly: " });
  assert.deepEqual(got.map((f) => f.name), ["weekly: upgrade"]);
  assert.match(got[0].output, /FAIL PUT settings/);
});

const SHA = "c".repeat(40);
const GREEN = "a".repeat(40);
function repo({ issues = [], green = GREEN, jobs = [job(1, "demo-stack (api)"), job(4, "demo-stack")] } = {}) {
  return fakeGh({
    "repos/o/r/actions/runs/77/jobs": { jobs },
    "repos/o/r/actions/jobs/1/logs": API_LOG,
    "repos/o/r/actions/jobs/4/logs": log("::error::api is failure"),
    "repos/o/r/actions/workflows/demo-stack.yml/runs": (q) => {
      assert.equal(q.get("status"), "success");
      assert.equal(q.get("event"), "schedule");
      return { workflow_runs: green ? [{ id: 70, head_sha: green }] : [] };
    },
    [`repos/o/r/compare/${GREEN}...${SHA}`]: {
      commits: [
        { sha: "b".repeat(40), commit: { message: "fix(admin): settings save\n\nbody" } },
        { sha: SHA, commit: { message: "feat(screen): push" } },
      ],
    },
    "repos/o/r/issues": issues,
  });
}
const env = {
  REPO: "o/r",
  RUN_ID: "77",
  SHA,
  WORKFLOW: "demo-stack.yml",
  EVENT: "schedule",
  IGNORE: "demo-stack",
};
const created = (gh) => gh.writes.filter((w) => w[0] === "issue" && w[1] === "create");
const arg = (w, flag) => w[w.indexOf(flag) + 1];

test("a failing nightly test files one regression issue, with its output and the commits since green", () => {
  const gh = repo();
  const got = run({ gh, env });
  assert.deepEqual(got, [
    { name: "PUT settings with the current version saves", filed: 100 },
    { name: "the push channel's latency", filed: 100 },
  ]);
  const [first] = created(gh);
  assert.equal(arg(first, "--title"), "regression: PUT settings with the current version saves");
  assert.equal(arg(first, "--label"), "regression", "labelled regression, never ready");
  const body = arg(first, "--body");
  assert.match(body, /\{"error":"internal"\}/);
  assert.match(body, /actions\/runs\/77/);
  assert.match(body, /bbbbbbb fix\(admin\): settings save\n/);
  assert.match(body, /ccccccc feat\(screen\): push/);
  assert.match(body, /<!-- canccu-regression: PUT settings with the current version saves -->/);
});

test("the same failure the next night comments on the open issue instead of filing again", () => {
  const open = {
    number: 41,
    title: "regression: the push channel's latency",
    body: "...\n<!-- canccu-regression: the push channel's latency -->",
  };
  const gh = repo({ issues: [open] });
  const got = run({ gh, env });
  assert.deepEqual(got[1], { name: "the push channel's latency", commented: 41 });
  assert.equal(created(gh).length, 1, "only the other test files an issue");
  const comment = gh.writes.find((w) => w[0] === "issue" && w[1] === "comment");
  assert.equal(comment[2], "41");
  assert.match(arg(comment, "--body"), /p95 1\.4 s/);
});

test("a screenshot failing with another error the next night keeps its name and comments on the open issue", () => {
  const night = (err) =>
    log(`FAIL settings: http://demo.localhost/admin/settings: ${err}`, "  at page.goto", "screenshots: 1 failed");
  const first = failuresOf([job(1, "demo-stack (shots pages)")], { 1: night("page.goto: Timeout 30000ms exceeded.") }, { perTest: true });
  const second = failuresOf([job(1, "demo-stack (shots pages)")], { 1: night("locator.waitFor: 502 Bad Gateway") }, { perTest: true });
  assert.deepEqual([first[0].name, second[0].name], ["settings", "settings"]);
  assert.match(second[0].output, /FAIL settings: http:\/\/demo\.localhost\/admin\/settings: locator\.waitFor: 502/, "the full line stays in the output");

  const open = { number: 52, title: "regression: settings", body: "...\n<!-- canccu-regression: settings -->" };
  const gh = fakeGh({
    "repos/o/r/actions/runs/77/jobs": { jobs: [job(1, "demo-stack (shots pages)")] },
    "repos/o/r/actions/jobs/1/logs": night("locator.waitFor: 502 Bad Gateway"),
    "repos/o/r/actions/workflows/demo-stack.yml/runs": { workflow_runs: [] },
    "repos/o/r/issues": [open],
  });
  assert.deepEqual(run({ gh, env }), [{ name: "settings", commented: 52 }]);
  assert.equal(created(gh).length, 0, "no second issue for the same shot");
  const comment = gh.writes.find((w) => w[0] === "issue" && w[1] === "comment");
  assert.match(arg(comment, "--body"), /locator\.waitFor: 502 Bad Gateway/);
});

test("a new screenshot failure is titled by the shot's name alone, with the full FAIL line in its body", () => {
  const gh = fakeGh({
    "repos/o/r/actions/runs/77/jobs": { jobs: [job(1, "demo-stack (shots front)")] },
    "repos/o/r/actions/jobs/1/logs": log("FAIL screens: browserType.launch: Executable doesn't exist"),
    "repos/o/r/actions/workflows/demo-stack.yml/runs": { workflow_runs: [] },
    "repos/o/r/issues": [],
  });
  assert.deepEqual(run({ gh, env }), [{ name: "screens", filed: 100 }]);
  const [issue] = created(gh);
  assert.equal(arg(issue, "--title"), "regression: screens");
  assert.match(arg(issue, "--body"), /FAIL screens: browserType\.launch: Executable doesn't exist/);
  assert.match(arg(issue, "--body"), /<!-- canccu-regression: screens -->/);
});

test("without a green run yet the issue says so instead of listing commits", () => {
  const gh = repo({ green: null });
  run({ gh, env });
  assert.match(arg(created(gh)[0], "--body"), /no green run of demo-stack\.yml yet/);
});

test("a run where nothing failed files nothing", () => {
  const gh = repo({ jobs: [job(1, "demo-stack (api)", "success")] });
  assert.deepEqual(run({ gh, env }), []);
  assert.deepEqual(gh.writes, []);
});

test("log text cannot mention people or close the code block", () => {
  const gh = fakeGh({
    "repos/o/r/actions/runs/77/jobs": { jobs: [job(1, "audit")] },
    "repos/o/r/actions/jobs/1/logs": log("see @someone", "```", "done"),
    "repos/o/r/actions/workflows/weekly.yml/runs": { workflow_runs: [] },
    "repos/o/r/issues": [],
  });
  run({ gh, env: { ...env, WORKFLOW: "weekly.yml", PER: "job", PREFIX: "weekly: " } });
  const body = arg(created(gh)[0], "--body");
  assert.doesNotMatch(body, /@someone/);
  assert.equal(body.split("```").length, 3, "one code block, opened and closed");
});
