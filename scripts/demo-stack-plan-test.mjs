// The self-test of scripts/demo-stack-plan.mjs (`--self-test`, run first in CI's plan job): the
// tiers, the path map of scripts/demo-screenshots-groups.mjs and the screenshot scripts' groups.
// The planner hands its functions in, so this file never imports the planner, whose CLI runs on
// import.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GROUPS,
  SHARDS,
  groupOf,
  needsOf,
} from "./demo-screenshots-groups.mjs";
import { shotChecks } from "./demo-stack-plan-shots-test.mjs";

export function selftest({ plan, format, summary, changedPaths }) {
  let failed = 0;
  const check = (name, run) => {
    try {
      run();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(
        `FAIL ${name}\n     ${String(err.message).split("\n").join("\n     ")}`,
      );
    }
  };
  // The tier and the shards' groups; demo-stack-plan-shots-test.mjs checks the screens' choice.
  const core = ({ tier, api, soak, check, shards }) => ({
    tier,
    api,
    soak,
    check,
    shards: shards.map(({ shard, groups }) => ({ shard, groups })),
  });
  const pr = (...paths) => core(plan({ event: "pull_request", paths }));
  const FULL = {
    tier: "full",
    api: "all",
    soak: true,
    check: false,
    shards: SHARDS.map(({ shard, groups }) => ({
      shard,
      groups: groups.join(","),
    })),
  };
  // The full run cuts the screens in two.
  const FULL_RUN = {
    ...FULL,
    shards: FULL.shards.flatMap((s) =>
      s.shard === "screens"
        ? [1, 2].map((i) => ({ ...s, shard: `screens-${i}` }))
        : [s],
    ),
  };

  check("docs, contracts, ADRs and any .md need no stack", () =>
    assert.deepEqual(
      pr(
        "docs/ci.md",
        "contracts/screen.md",
        "docs/decisions/0030-x.md",
        "modules/agenda/README.md",
        "AGENTS.md",
      ),
      { tier: "docs", api: "", soak: false, check: false, shards: [] },
    ),
  );
  check(
    "an agenda change runs agenda's API tests and only the run of show's shots",
    () =>
      assert.deepEqual(
        pr("modules/agenda/src/canccu_agenda/app.py", "docs/ci.md"),
        {
          tier: "module",
          api: "agenda",
          soak: false,
          check: false,
          shards: [{ shard: "pages", groups: "agenda" }],
        },
      ),
  );
  check("admin and notify share the pages shard", () =>
    assert.deepEqual(pr("modules/notify/x.py", "modules/admin/y.ts").shards, [
      { shard: "pages", groups: "admin,notify" },
    ]),
  );
  check(
    "a screen change runs screen's tests, the soak, the screens and the Screen studio",
    () =>
      assert.deepEqual(pr("modules/screen/src/zones.ts"), {
        tier: "module",
        api: "screen",
        soak: true,
        check: false,
        shards: [
          { shard: "screens", groups: "screens" },
          { shard: "studio", groups: "screen-studio" },
        ],
      }),
  );
  check(
    "a module without pages gets its API tests and the platform smoke, no shots",
    () =>
      assert.deepEqual(pr("modules/hello/src/main.ts"), {
        tier: "module",
        api: "hello",
        soak: false,
        check: false,
        shards: [],
      }),
  );
  check(
    "tenants is shot through admin's front door; screen-render through the screens",
    () => {
      assert.deepEqual(pr("modules/tenants/a.py").shards, [
        { shard: "pages", groups: "admin" },
      ]);
      assert.deepEqual(pr("modules/screen-render/a.ts").shards, [
        { shard: "screens", groups: "screens" },
      ]);
    },
  );
  // scripts/demo-stack-test has tests of admin, agenda, notify and screen only.
  check(
    "tenants runs admin's API tests and screen-render screen's, without the soak",
    () => {
      assert.equal(pr("modules/tenants/a.py").api, "admin");
      const render = pr("modules/screen-render/a.ts");
      assert.equal(render.api, "screen");
      assert.equal(render.soak, false);
      assert.equal(
        pr("modules/tenants/a.py", "modules/admin/b.ts").api,
        "admin",
      );
    },
  );
  check("contract files an image reads at runtime are their module's", () => {
    assert.deepEqual(pr("contracts/profile.schema.json"), {
      tier: "module",
      api: "admin",
      soak: false,
      check: false,
      shards: [{ shard: "pages", groups: "admin" }],
    });
    assert.deepEqual(pr("contracts/flags.yaml"), {
      tier: "module",
      api: "admin",
      soak: false,
      check: false,
      shards: [{ shard: "pages", groups: "admin" }],
    });
    assert.deepEqual(pr("contracts/theme.schema.json"), FULL);
    assert.equal(pr("contracts/admin.openapi.yaml").tier, "docs");
  });
  const stackTest = (script, ...args) =>
    execFileSync(script, ["--dry-run", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .filter((l) => l.startsWith("  "));
  const STACK_TEST = new URL("demo-stack-test", import.meta.url).pathname;
  check("every module the API list names has tests of its own", () => {
    const smoke = stackTest(STACK_TEST, "--only", "").length;
    for (const path of [
      "modules/admin/x",
      "modules/agenda/x",
      "modules/notify/x",
      "modules/screen/x",
      "modules/tenants/x",
      "modules/screen-render/x",
    ]) {
      const { api } = pr(path);
      assert.ok(
        stackTest(STACK_TEST, "--only", api).length > smoke,
        `${path}: ${api}`,
      );
    }
  });
  check("demo-stack-test refuses tags out of step with its tests", () => {
    const dir = mkdtempSync(join(tmpdir(), "canccu-tags-"));
    try {
      mkdirSync(join(dir, "scripts"));
      const copy = join(dir, "scripts/demo-stack-test");
      const source = readFileSync(STACK_TEST, "utf8");
      // One tag fewer: every later test would run under its neighbour's module.
      const short = source.replace(/^(TAGS=\(\n\s*)platform /m, "$1");
      assert.notEqual(short, source);
      writeFileSync(copy, short, { mode: 0o755 });
      assert.throws(
        () => stackTest(copy),
        (err) => err.status === 2 && /tags/.test(String(err.stderr)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  for (const path of [
    "packages/ui/ui.css",
    "packages/kit-ts/src/index.ts",
    "packages/kit-py/canccu_kit/x.py",
    "modules/theming/src/x.ts",
    "modules/screen/test/stack/screens.mjs",
    "deploy/compose.yml",
    "events/demo/profile.yaml",
    ".github/workflows/demo-stack.yml",
    ".github/actions/demo-stack-up/action.yml",
    "scripts/demo-screenshots.mjs",
    "scripts/demo-stack-test",
    "scripts/screen-soak",
  ])
    check(`a shared change (${path}) is the full run`, () =>
      assert.deepEqual(pr(path, "modules/agenda/x.py"), FULL),
    );
  check(
    "a path the map does not know is the full run, never a skipped one",
    () => assert.deepEqual(pr("setup/install.sh"), FULL),
  );
  for (const event of ["schedule", "workflow_dispatch"])
    check(`${event} is the full run whatever changed`, () =>
      assert.deepEqual(core(plan({ event, paths: ["docs/ci.md"] })), FULL_RUN),
    );
  check("a push to main runs what its changes affect, as its PR did", () => {
    assert.deepEqual(core(plan({ event: "push", paths: ["docs/ci.md"] })).tier, "docs");
    assert.deepEqual(
      core(plan({ event: "push", paths: ["modules/agenda/x.py"] })),
      pr("modules/agenda/x.py"),
    );
  });
  check("the merge queue checks the shots but captures none", () => {
    const queued = core(plan({
      event: "merge_group",
      paths: ["modules/agenda/x.py"],
    }));
    assert.equal(queued.check, true);
    assert.deepEqual(queued.shards, [{ shard: "pages", groups: "agenda" }]);
    assert.equal(
      plan({ event: "merge_group", paths: ["docs/a.md"] }).tier,
      "docs",
    );
  });
  check("an unknown event is refused", () =>
    assert.throws(() => plan({ event: "issue_comment", paths: [] })),
  );
  check("each page path belongs to the module that serves it", () => {
    assert.equal(groupOf("/admin/screen/zones/main"), "screen-studio");
    assert.equal(groupOf("/admin/people?q=x"), "admin");
    assert.equal(groupOf("/agenda/?earlier=1"), "agenda");
    assert.equal(groupOf("/notify/check-in?p=arrival"), "notify");
    assert.equal(groupOf("/theming/studio/"), "theming");
    assert.equal(groupOf("/screen/"), "screens");
    // The event's front door, at its base address, is notify's (#750); only the bare address.
    assert.equal(groupOf("/"), "notify");
    assert.equal(groupOf("/?x=1"), "notify");
    // Only the Screen studio's own pages: a page named like it stays admin's.
    assert.equal(groupOf("/admin/screenshots"), "admin");
    assert.throws(() => groupOf("/games/"), /no screenshot group/);
  });
  check(
    "every group sits in exactly one shard, and the map names only groups",
    () => {
      assert.deepEqual(
        SHARDS.flatMap((s) => s.groups).sort(),
        [...GROUPS].sort(),
      );
      for (const path of [
        "modules/admin/x",
        "modules/agenda/x",
        "modules/notify/x",
        "modules/screen/x",
        "modules/tenants/x",
      ])
        for (const g of needsOf(path))
          assert.ok(GROUPS.includes(g), `${path}: ${g}`);
    },
  );
  check("a file moved out of a shared path into one module runs full", () => {
    const dir = mkdtempSync(join(tmpdir(), "canccu-plan-"));
    const git = (...args) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
        {
          cwd: dir,
          stdio: "ignore",
        },
      );
    try {
      git("init", "-q");
      mkdirSync(join(dir, "packages/ui"), { recursive: true });
      mkdirSync(join(dir, "modules/admin"), { recursive: true });
      writeFileSync(join(dir, "packages/ui/x.ts"), "export const x = 1;\n");
      git("add", ".");
      git("commit", "-qm", "base");
      git("tag", "base");
      git("mv", "packages/ui/x.ts", "modules/admin/x.ts");
      git("commit", "-qm", "move");
      const paths = changedPaths("base", dir);
      assert.deepEqual(paths.sort(), [
        "modules/admin/x.ts",
        "packages/ui/x.ts",
      ]);
      assert.deepEqual(core(plan({ event: "pull_request", paths })), FULL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  check("the output is one KEY=value line each, the shards as JSON", () =>
    assert.equal(
      format(plan({ event: "pull_request", paths: ["modules/agenda/x.py"] })),
      'tier=module\napi=agenda\nsoak=false\ncheck=false\nrun=affected\ngroups=agenda\nselect=\nshards=[{"shard":"pages","groups":"agenda","select":""}]',
    ),
  );
  shotChecks({ check, plan, summary });
  if (failed) {
    console.log(`demo-stack-plan: ${failed} failed`);
    process.exit(1);
  }
  console.log("demo-stack-plan: self-test passed");
}
