// Tests of scripts/shots-local.mjs and the dry run of scripts/shots-local.sh (#817): which modules a
// branch changed, which screenshot groups and CI shards they need, and the steps the local run
// takes. The stack run itself is checked by hand against a known failure (the PR's Verification).
import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { autoModules, groupsOf, modulesOf, plan } from "./shots-local.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KNOWN = ["admin", "hello", "moments", "pizza", "screen", "screen-render", "tenants", "theming"];

test("the changed modules are the modules/<name>/ paths, and the contract files a module's image reads", () => {
  assert.deepEqual(
    modulesOf([
      "modules/screen/src/a.ts",
      "modules/moments/static/x.css",
      "modules/screen/player/b.ts",
      "contracts/theme.schema.json",
      "packages/ui/tokens.css",
      "docs/ci.md",
      "AGENTS.md",
    ]),
    ["moments", "screen", "theming"],
  );
  assert.deepEqual(modulesOf(["docs/ci.md", "contracts/screen.md"]), []);
});

test("each module's groups are CI's for its pages; theming adds the screens its tokens draw", () => {
  assert.deepEqual(groupsOf("screen"), ["screens", "screen-studio"]);
  assert.deepEqual(groupsOf("moments"), ["moments"]);
  assert.deepEqual(groupsOf("theming"), ["theming", "screens"]);
  assert.deepEqual(groupsOf("screen-render"), ["screens"]);
  assert.deepEqual(groupsOf("tenants"), ["admin"]);
  assert.deepEqual(groupsOf("hello"), []);
});

test("the shards are CI's, in CI's order, each with only the groups the modules need", () => {
  const out = plan(["theming", "moments"], KNOWN);
  assert.deepEqual(out.modules, [
    { module: "moments", groups: ["moments"] },
    { module: "theming", groups: ["theming", "screens"] },
  ]);
  assert.deepEqual(out.shards, [
    { shard: "pages", groups: ["theming", "moments"], modules: ["moments", "theming"] },
    { shard: "screens", groups: ["screens"], modules: ["theming"] },
  ]);
});

test("a module with no pages needs no shard; an unknown name fails rather than shoot nothing", () => {
  assert.deepEqual(plan(["hello"], KNOWN), { modules: [{ module: "hello", groups: [] }], shards: [] });
  assert.throws(() => plan(["scren"], KNOWN), /unknown module scren/);
});

const sh = (...args) =>
  spawnSync("scripts/shots-local.sh", args, { cwd: ROOT, encoding: "utf8" });

test("the dry run names the stack, the platform smoke and CI's check-mode pass for each shard", () => {
  const run = sh("--dry-run", "screen");
  assert.equal(run.status, 0, run.stderr);
  const out = run.stdout;
  assert.match(out, /docker compose --env-file \/dev\/null -p \S+ -f deploy\/compose\.yml -f deploy\/compose\.ci\.yml -f \S+/);
  assert.match(out, /shard screens \(screens; screen\)/);
  assert.match(out, /shard studio \(screen-studio; screen\)/);
  assert.match(out, /scripts\/demo-stack-test --only "" http:\/\/127\.0\.0\.1:<port>/);
  assert.match(out, /scripts\/demo-screenshots --groups screens --check http:\/\/127\.0\.0\.1 /);
  assert.match(out, /scripts\/demo-screenshots --groups screen-studio --check /);
  assert.ok(out.indexOf("shard screens") < out.indexOf("shard studio"), "CI's shard order");
});

test("the dry run of a module with no pages says so and starts nothing", () => {
  const run = sh("--dry-run", "hello");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ok   hello: no views/);
  assert.doesNotMatch(run.stdout, /docker compose/);
});

test("an unknown module or option is a usage error", () => {
  assert.equal(sh("--dry-run", "scren").status, 2);
  assert.equal(sh("--frobnicate").status, 2);
});

test("without names it takes the modules the working tree changes against the base", () => {
  // CANCCU_SHOTS_BASE=HEAD: CI's shallow checkout has no origin/main. The tree's own changes
  // decide; the test holds the dry run to the same list.
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const changed = modulesOf([
    ...git("diff", "--name-only", "--no-renames", "HEAD"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]);
  const run = spawnSync("scripts/shots-local.sh", ["--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CANCCU_SHOTS_BASE: "HEAD" },
  });
  // A tree that changes a path CI runs in full (the scripts it shares, say) stops, loudly.
  if (run.status === 2) return assert.match(run.stderr, /CI runs every shard/);
  assert.equal(run.status, 0, run.stderr);
  for (const m of changed) assert.match(run.stdout, new RegExp(`^(ok   )?${m}[: ]`, "m"));
  if (changed.length === 0) assert.match(run.stdout, /no module changed against HEAD/);
});

test("a base git cannot find is a clear error, not an empty run", () => {
  const run = spawnSync("scripts/shots-local.sh", ["--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CANCCU_SHOTS_BASE: "no-such-ref" },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no-such-ref/);
});

test("the run never touches a stack it did not start: the host's project names are refused", () => {
  for (const env of [{ CANCCU_SHOTS_PROJECT: "canccuplatform" }, { CANCCU_SHOTS_PROJECT: "x", COMPOSE_PROJECT_NAME: "x" }]) {
    const run = spawnSync("scripts/shots-local.sh", ["--dry-run", "screen"], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, COMPOSE_PROJECT_NAME: "", ...env },
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /host's own stack/);
  }
  // COMPOSE_PROJECT_NAME alone does not name the shots project.
  const run = spawnSync("scripts/shots-local.sh", ["--dry-run", "screen"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, CANCCU_SHOTS_PROJECT: "", COMPOSE_PROJECT_NAME: "mine" },
  });
  assert.match(run.stdout, /--env-file \/dev\/null -p canccu-shots-[a-z0-9-]+ /);
});

test("automatic mode stops for paths CI runs in full or on the dev-seed shard, never 'no module changed'", () => {
  assert.throws(() => autoModules(["packages/ui/tokens.css"], KNOWN), /full tier.*packages\/ui\/tokens\.css/);
  assert.throws(() => autoModules(["modules/screen/src/dev-seed.ts"], KNOWN), /dev-seed/);
  assert.throws(() => autoModules(["modules/screen/player/a.ts", "docs/ci.md"], KNOWN), /player/);
  assert.deepEqual(autoModules(["modules/theming/src/a.ts", "modules/screen/src/a.ts"], KNOWN), ["screen", "theming"]);
  assert.deepEqual(autoModules(["docs/ci.md", "scripts/shots-local.sh"], KNOWN), []);
});

test("automatic mode drops names git lists that are not module directories", () => {
  assert.deepEqual(autoModules(["modules/gone/src/a.ts", "modules/moments/src/a.ts"], KNOWN), ["moments"]);
});
