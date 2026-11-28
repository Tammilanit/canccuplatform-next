// Tests of scripts/shots-local.mjs and the dry run of scripts/shots-local.sh (#817): which modules a
// branch changed, which screenshot groups and CI shards they need, and the steps the local run
// takes. The stack run itself is checked by hand against a known failure (the PR's Verification).
import { strict as assert } from "node:assert";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.throws(() => autoModules(["modules/screen/test/stack/a.mjs", "docs/ci.md"], KNOWN), /stack/);
  // The player is the screens' own page since #835, no longer the full tier.
  assert.deepEqual(autoModules(["modules/screen/player/a.ts"], KNOWN), ["screen"]);
  assert.deepEqual(autoModules(["modules/theming/src/a.ts", "modules/screen/src/a.ts"], KNOWN), ["screen", "theming"]);
  assert.deepEqual(autoModules(["docs/ci.md", "scripts/shots-local.sh"], KNOWN), []);
});

test("automatic mode drops names git lists that are not module directories", () => {
  assert.deepEqual(autoModules(["modules/gone/src/a.ts", "modules/moments/src/a.ts"], KNOWN), ["moments"]);
});

test("two worktrees get two stack names, so their runs never share a Compose project", () => {
  const names = [0, 1].map(() => {
    const root = mkdtempSync(join(tmpdir(), "shots-root-"));
    cpSync(join(ROOT, "scripts"), join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "modules", "screen"), { recursive: true });
    const run = spawnSync("scripts/shots-local.sh", ["--dry-run", "screen"], {
      cwd: root, encoding: "utf8", env: { ...process.env, CANCCU_SHOTS_PROJECT: "", COMPOSE_PROJECT_NAME: "" },
    });
    return /-p (canccu-shots-[a-z0-9-]+) /.exec(run.stdout)?.[1];
  });
  assert.ok(names[0] && names[1], "dry run names the project");
  assert.notEqual(names[0], names[1]);
});

// The per-shot mode (#825): CI's shot list, the names and globs a worker gives, the shots a
// branch's file names pick, and the stack a run reuses or refuses.
const pickMod = () => import("./shots-local-pick.mjs");
const views = () => import("../modules/screen/test/stack/screen-views.mjs");

test("a screen shot's attempt: the Pulse takes its frames, a strip its own, a view itself", async () => {
  const { attemptOf } = await views();
  const p = "theming-default-screen-";
  assert.equal(attemptOf(`${p}identify-1920x1080`), `${p}pulse-1920x1080`);
  assert.equal(attemptOf("theming-level-up-screen-offline-1080x1920"), "theming-level-up-screen-pulse-1080x1920");
  assert.equal(attemptOf(`${p}living-rotation-1920x1080-f3`), `${p}living-rotation-1920x1080`);
  assert.equal(attemptOf(`${p}stage-surge-during-1920x1080`), `${p}stage-surge-1920x1080`);
  assert.equal(attemptOf(`${p}pulse-one-screen-1920x1080`), `${p}pulse-one-screen-1920x1080`);
  assert.equal(attemptOf(`${p}claim-hero-1080x1920`), `${p}claim-hero-1080x1920`);
  assert.equal(attemptOf("admin-home-phone"), "admin-home-phone");
});

test("CI's shot list is the merge queue's check, each shot in its one group", async () => {
  const { shotList } = await pickMod();
  const list = await shotList();
  const group = new Map(list.map(({ name, group }) => [name, group]));
  assert.equal(group.size, list.length, "no shot listed twice");
  assert.equal(group.get("theming-default-screen-pulse-1920x1080"), "screens");
  assert.equal(group.get("admin-home"), "admin");
  assert.equal(group.get("dev-seed-agenda"), "dev-seed");
  assert.equal(group.get("theming-default-screen-motion-party-arcade-1920x1080-f4"), "screens", "the motion strips");
  assert.ok(!group.has("theming-default-screen-pulse-3840x2160"), "no 4K: the check takes 1080p only");
});

test("names and globs pick from CI's list, in its order; a pattern matching nothing fails", async () => {
  const { pick } = await pickMod();
  const list = [
    { name: "theming-terminal-screen-pulse-1920x1080", group: "screens" },
    { name: "theming-terminal-screen-pulse-1080x1920", group: "screens" },
    { name: "theming-default-screen-pulse-1920x1080", group: "screens" },
    { name: "admin-home", group: "admin" },
  ];
  const names = (shots) => shots.map((s) => s.name);
  // As CI prints them: a PNG name, or a FAIL line's name with its colon.
  assert.deepEqual(names(pick(["admin-home.png", "theming-default-screen-pulse-1920x1080:"], list)), [
    "theming-default-screen-pulse-1920x1080",
    "admin-home",
  ]);
  assert.deepEqual(names(pick(["theming-*-screen-pulse-1920x1080", "theming-terminal-*"], list)), [
    "theming-terminal-screen-pulse-1920x1080",
    "theming-terminal-screen-pulse-1080x1920",
    "theming-default-screen-pulse-1920x1080",
  ]);
  assert.deepEqual(names(pick(["admin-hom?"], list)), ["admin-home"]);
  // A FAIL line of a view that failed as a whole names the view, not a shot: it picks its shots.
  const p = "theming-default-screen-";
  const strip = [
    { name: `${p}stage-surge-before-1920x1080`, group: "screens" },
    { name: `${p}stage-surge-during-1920x1080`, group: "screens" },
    { name: `${p}living-rotation-1920x1080-f1`, group: "screens" },
    { name: `${p}living-rotation-1920x1080-f2`, group: "screens" },
    { name: `${p}pulse-1920x1080`, group: "screens" },
  ];
  assert.deepEqual(names(pick([`${p}stage-surge-1920x1080:`], strip)), [strip[0].name, strip[1].name]);
  assert.deepEqual(names(pick([`${p}living-rotation-1920x1080:`], strip)), [strip[2].name, strip[3].name]);
  assert.throws(() => pick(["theming-default-screen-pulse-3840x2160", "admin-home"], list), /pulse-3840x2160/);
  assert.throws(() => pick(["admin.home"], list), /admin\.home/, "a dot is a dot, not any character");
});

test("--changed picks the screen shots a changed file is named for, and says what it cannot pick", async () => {
  const { changedShots, shotList } = await pickMod();
  const list = await shotList();
  const run = (paths) => changedShots(paths, list);
  const views = (out) => [...new Set(out.shots.map((s) => s.name.replace(/^theming-.+?-screen-|-\d+x\d+.*$/g, "")))].sort();
  // The announcement drawn on the Dashboard is a dashboard view too.
  assert.deepEqual(views(run(["modules/screen/player/src/dashboard.css"])), [
    "ann-important-dashboard", "dashboard", "dashboard-chat", "dashboard-coming-hours", "dashboard-showcase", "dashboard-showcase-small", "dashboard-waiting",
  ]);
  assert.deepEqual(views(run(["modules/screen/test/stack/living.mjs"])), [
    "living-day", "living-food", "living-hype", "living-rotation", "living-slideshow", "living-stepdown",
  ]);
  assert.ok(views(run(["modules/screen/player/src/claims.ts"])).includes("claim-rail"), "claims names the claim views");
  assert.ok(run(["modules/screen/player/src/claims.ts"]).shots.every((s) => s.group === "screens"));
  // A file every view draws on names no shot: the run says so rather than pass on nothing.
  const generic = run(["modules/screen/player/src/main.ts"]);
  assert.deepEqual(generic.shots, []);
  assert.match(generic.notes.join("\n"), /modules\/screen\/player\/src\/main\.ts/);
  // The module's own name names no view (`pulse-one-screen` is not what screen-pages.mjs draws).
  for (const path of ["modules/screen/test/stack/screen-pages.mjs", "modules/screen/test/stack/screens.mjs"]) {
    const own = run([path]);
    assert.deepEqual(own.shots, [], path);
    assert.match(own.notes.join("\n"), /names no screen shot/);
  }
  // Another module's views are not picked shot by shot.
  const admin = run(["modules/admin/src/canccu_admin/app.py"]);
  assert.deepEqual(admin.shots, []);
  assert.match(admin.notes.join("\n"), /canccu_admin\/app\.py.*admin/);
  assert.deepEqual(run(["docs/ci.md", "modules/hello/src/a.ts"]), { shots: [], notes: [] });
});

test("a named shot the run never reached is reported, not passed", async () => {
  const { unreached } = await pickMod();
  const p = "theming-default-screen-";
  const log = [
    `ok   ${p}dashboard-1920x1080.png`,
    `FAIL ${p}hero-1920x1080: 2 readability problems`,
    `FAIL ${p}pulse-1080x1920: timeout`,
    `FAIL ${p}living-rotation-1920x1080: the state handed to the page`,
    "ok   admin-home.png  http://demo.localhost/admin/",
    "FAIL screens: boom",
  ].join("\n");
  assert.deepEqual(
    unreached(
      [
        `${p}dashboard-1920x1080`,
        `${p}hero-1920x1080`,
        `${p}identify-1080x1920`,
        `${p}living-rotation-1920x1080-f2`,
        "admin-home",
        `${p}split-1920x1080`,
        "admin-home-phone",
      ],
      log,
    ),
    [`${p}split-1920x1080`, "admin-home-phone"],
  );
});

test("the screens' dry run with --shots lists exactly the Pulse attempt's four shots", () => {
  const run = spawnSync(
    "node",
    ["scripts/demo-screenshots.mjs", "--dry-run", "--check", "--groups", "screens", "--shots", "theming-default-screen-identify-1920x1080"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const listed = [...run.stdout.matchAll(/^ +(\S+)\.png +/gm)].map((m) => m[1]);
  assert.deepEqual(listed, ["pulse", "identify", "test-pattern", "offline"].map((v) => `theming-default-screen-${v}-1920x1080`));
});

test("the per-shot dry run hands CI's check-mode pass the named shots of their groups", () => {
  const run = sh("--dry-run", "--shots", "theming-default-screen-identify-1920x1080", "admin-home.png");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /scripts\/demo-screenshots --groups admin,screens --shots admin-home,theming-default-screen-identify-1920x1080 --strips --check http:\/\/127\.0\.0\.1 shots-local\/shots/);
  assert.match(run.stdout, /admin-home \(admin: its whole group runs\)/);
  assert.equal(sh("--dry-run", "--shots", "no-such-shot").status, 2);
  assert.equal(sh("--dry-run", "--shots").status, 2);
  assert.equal(sh("--keep", "screen").status, 2, "--keep only with --shots or --changed");
  assert.equal(sh("--down", "x").status, 2);
});

/** A repo root of links to this one, with a fake docker that logs its calls. */
function fakeRoot(containers) {
  const root = mkdtempSync(join(tmpdir(), "shots-keep-"));
  for (const d of ["scripts", "modules", "deploy", "events"]) symlinkSync(join(ROOT, d), join(root, d));
  mkdirSync(join(root, "bin"));
  const log = join(root, "docker.log");
  writeFileSync(
    join(root, "bin", "docker"),
    `#!/bin/sh\necho "$*" >> ${log}\ncase "$*" in "ps -aq"*) [ -z "${containers}" ] || echo ${containers || "-"} ;; esac\n`,
    { mode: 0o755 },
  );
  const run = (...args) =>
    spawnSync(join(root, "scripts", "shots-local.sh"), args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, CANCCU_SHOTS_PROJECT: "canccu-shots-t", COMPOSE_PROJECT_NAME: "" },
    });
  const keep = () => {
    mkdirSync(join(root, "shots-local"), { recursive: true });
    writeFileSync(join(root, "shots-local", "kept"), "canccu-shots-t\n");
  };
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  return { root, run, keep, calls };
}

test("a stack --keep left is reused; one it did not leave is refused; none is started fresh", () => {
  const name = "theming-default-screen-pulse-1920x1080";
  let f = fakeRoot("abc123");
  f.keep();
  let run = f.run("--dry-run", "--shots", name);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /the stack: canccu-shots-t, kept by an earlier --keep: reused/);
  f = fakeRoot("abc123");
  run = f.run("--dry-run", "--shots", name);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /canccu-shots-t already has containers shots-local did not keep/);
  for (const kept of [false, true]) {
    f = fakeRoot("");
    if (kept) f.keep(); // a mark whose stack is gone
    run = f.run("--dry-run", "--shots", name);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /the stack: canccu-shots-t, fresh: built, started, the platform smoke/);
  }
});

test("--down removes only the stack --keep left", () => {
  let f = fakeRoot("abc123");
  f.keep();
  let run = f.run("--down");
  assert.equal(run.status, 0, run.stderr);
  assert.match(f.calls(), /compose --env-file \/dev\/null -p canccu-shots-t .* down -v/);
  assert.ok(!existsSync(join(f.root, "shots-local", "kept")), "the mark goes with the stack");
  f = fakeRoot("abc123");
  run = f.run("--down");
  assert.equal(run.status, 2);
  assert.doesNotMatch(f.calls(), / down /);
  f = fakeRoot("");
  run = f.run("--down");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /no stack kept/);
  assert.doesNotMatch(f.calls(), / down /);
});

test("the per-shot mode refuses the host's project names too", () => {
  for (const args of [["--dry-run", "--shots", "admin-home"], ["--down"]]) {
    const run = spawnSync("scripts/shots-local.sh", args, {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, CANCCU_SHOTS_PROJECT: "canccuplatform" },
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /host's own stack/);
  }
});
