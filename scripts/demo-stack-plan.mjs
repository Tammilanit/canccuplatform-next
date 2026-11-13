#!/usr/bin/env node
// The demo stack's first job (#461, docs/ci.md#tiers): which tier a run needs, from the event and
// the changed paths, and so which of the API tests, the soak and the screenshot shards run.
// Usage: node demo-stack-plan.mjs --event EVENT [--base REV]   KEY=value lines for $GITHUB_OUTPUT
//        node demo-stack-plan.mjs --self-test
// The changed paths are `git diff --name-only REV HEAD`, read only for a pull request or a merge
// queue entry; every other event (push to main, the nightly run, a manual run) is the full run.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { GROUPS, SHARDS, groupOf, needsOf } from "./demo-screenshots-groups.mjs";

const PATH_EVENTS = new Set(["pull_request", "merge_group"]);
const FULL_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);

const shardsFor = (wanted) =>
  SHARDS.map(({ shard, groups }) => ({ shard, groups: groups.filter((g) => wanted.has(g)) }))
    .filter(({ groups }) => groups.length > 0)
    .map(({ shard, groups }) => ({ shard, groups: groups.join(",") }));

/**
 * The run an event and its changed paths need. `api` is the module list scripts/demo-stack-test
 * takes (`all`, or the changed modules: its platform smoke runs whatever the list). The soak
 * guards the player's memory over a day, so it runs for screen and on the full run. `check`: the
 * merge queue runs the shots' checks without capturing every theme and size.
 */
export function plan({ event, paths }) {
  if (!PATH_EVENTS.has(event) && !FULL_EVENTS.has(event)) throw new Error(`unknown event ${event}`);
  const check = event === "merge_group";
  const needs = FULL_EVENTS.has(event) ? ["full"] : paths.map(needsOf);
  if (needs.includes("full"))
    return { tier: "full", api: "all", soak: true, check, shards: shardsFor(new Set(GROUPS)) };
  const code = paths.filter((_, i) => needs[i] !== "docs");
  if (code.length === 0) return { tier: "docs", api: "", soak: false, check, shards: [] };
  const modules = [...new Set(code.map((p) => p.split("/")[1]))].sort();
  return {
    tier: "module",
    api: modules.join(","),
    soak: modules.includes("screen"),
    check,
    shards: shardsFor(new Set(needs.filter(Array.isArray).flat())),
  };
}

export const format = ({ tier, api, soak, check, shards }) =>
  [`tier=${tier}`, `api=${api}`, `soak=${soak}`, `check=${check}`, `shards=${JSON.stringify(shards)}`].join(
    "\n",
  );

const selftest = () => {
  let failed = 0;
  const check = (name, run) => {
    try {
      run();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}\n     ${String(err.message).split("\n").join("\n     ")}`);
    }
  };
  const pr = (...paths) => plan({ event: "pull_request", paths });
  const FULL = {
    tier: "full",
    api: "all",
    soak: true,
    check: false,
    shards: SHARDS.map(({ shard, groups }) => ({ shard, groups: groups.join(",") })),
  };

  check("docs, contracts, ADRs and any .md need no stack", () =>
    assert.deepEqual(
      pr("docs/ci.md", "contracts/screen.md", "docs/decisions/0030-x.md", "modules/agenda/README.md", "AGENTS.md"),
      { tier: "docs", api: "", soak: false, check: false, shards: [] },
    ));
  check("an agenda change runs agenda's API tests and only the run of show's shots", () =>
    assert.deepEqual(pr("modules/agenda/src/canccu_agenda/app.py", "docs/ci.md"), {
      tier: "module",
      api: "agenda",
      soak: false,
      check: false,
      shards: [{ shard: "pages", groups: "agenda" }],
    }));
  check("admin and notify share the pages shard", () =>
    assert.deepEqual(pr("modules/notify/x.py", "modules/admin/y.ts").shards, [
      { shard: "pages", groups: "admin,notify" },
    ]));
  check("a screen change runs screen's tests, the soak, the screens and the Screen studio", () =>
    assert.deepEqual(pr("modules/screen/src/zones.ts"), {
      tier: "module",
      api: "screen",
      soak: true,
      check: false,
      shards: [
        { shard: "screens", groups: "screens" },
        { shard: "studio", groups: "screen-studio" },
      ],
    }));
  check("a module without pages gets its API tests and the platform smoke, no shots", () =>
    assert.deepEqual(pr("modules/hello/src/main.ts"), {
      tier: "module",
      api: "hello",
      soak: false,
      check: false,
      shards: [],
    }));
  check("tenants is shot through admin's front door; screen-render through the screens", () => {
    assert.deepEqual(pr("modules/tenants/a.py").shards, [{ shard: "pages", groups: "admin" }]);
    assert.deepEqual(pr("modules/screen-render/a.ts").shards, [{ shard: "screens", groups: "screens" }]);
  });
  for (const path of [
    "packages/ui/ui.css",
    "packages/kit-ts/src/index.ts",
    "packages/kit-py/canccu_kit/x.py",
    "modules/theming/src/x.ts",
    "modules/screen/player/player.js",
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
      assert.deepEqual(pr(path, "modules/agenda/x.py"), FULL));
  check("a path the map does not know is the full run, never a skipped one", () =>
    assert.deepEqual(pr("setup/install.sh"), FULL));
  for (const event of ["push", "schedule", "workflow_dispatch"])
    check(`${event} is the full run whatever changed`, () =>
      assert.deepEqual(plan({ event, paths: ["docs/ci.md"] }), FULL));
  check("the merge queue checks the shots but captures none", () => {
    const queued = plan({ event: "merge_group", paths: ["modules/agenda/x.py"] });
    assert.equal(queued.check, true);
    assert.deepEqual(queued.shards, [{ shard: "pages", groups: "agenda" }]);
    assert.equal(plan({ event: "merge_group", paths: ["docs/a.md"] }).tier, "docs");
  });
  check("an unknown event is refused", () => assert.throws(() => plan({ event: "issue_comment", paths: [] })));
  check("each page path belongs to the module that serves it", () => {
    assert.equal(groupOf("/admin/screen/zones/main"), "screen-studio");
    assert.equal(groupOf("/admin/people?q=x"), "admin");
    assert.equal(groupOf("/agenda/?earlier=1"), "agenda");
    assert.equal(groupOf("/notify/check-in?p=arrival"), "notify");
    assert.equal(groupOf("/theming/studio/"), "theming");
    assert.equal(groupOf("/screen/"), "screens");
    assert.throws(() => groupOf("/games/"), /no screenshot group/);
  });
  check("every group sits in exactly one shard, and the map names only groups", () => {
    assert.deepEqual(SHARDS.flatMap((s) => s.groups).sort(), [...GROUPS].sort());
    for (const path of ["modules/admin/x", "modules/agenda/x", "modules/notify/x", "modules/screen/x", "modules/tenants/x"])
      for (const g of needsOf(path)) assert.ok(GROUPS.includes(g), `${path}: ${g}`);
  });
  const shots = (script, ...args) =>
    execFileSync("node", [new URL(script, import.meta.url).pathname, "--dry-run", ...args], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => /^ {2}\S+\.png /.test(l))
      .map((l) => l.trim().split(/\s+/)[0]);
  for (const script of ["demo-screenshots.mjs", "demo-screenshots-front.mjs"]) {
    check(`the shards of ${script} take every shot of the full run, each once`, () => {
      const all = shots(script);
      const sharded = SHARDS.flatMap(({ groups }) => shots(script, "--groups", groups.join(",")));
      assert.ok(all.length > 0);
      assert.deepEqual([...sharded].sort(), [...all].sort());
    });
    check(`${script} refuses a group it does not know`, () =>
      assert.throws(() => shots(script, "--groups", "agenda,nope"), /unknown group nope/));
  }
  check("one group takes only its own shots", () => {
    const agenda = shots("demo-screenshots.mjs", "--groups", "agenda");
    assert.ok(agenda.includes("agenda-wide.png") && agenda.includes("error-not-found.png"));
    assert.ok(!agenda.some((n) => /^(settings|studio|screen-|theming-)/.test(n)), agenda.join(" "));
  });
  check("the merge queue's check skips the 4K screens and keeps every theme", () => {
    const checked = shots("demo-screenshots.mjs", "--check", "--groups", "screens");
    assert.ok(!checked.some((n) => /3840|2160x/.test(n)));
    for (const theme of ["terminal", "level-up", "default"])
      assert.ok(checked.includes(`theming-${theme}-screen-pulse-1920x1080.png`), theme);
  });
  check("the output is one KEY=value line each, the shards as JSON", () =>
    assert.equal(
      format(pr("modules/agenda/x.py")),
      'tier=module\napi=agenda\nsoak=false\ncheck=false\nshards=[{"shard":"pages","groups":"agenda"}]',
    ));
  if (failed) {
    console.log(`demo-stack-plan: ${failed} failed`);
    process.exit(1);
  }
  console.log("demo-stack-plan: self-test passed");
};

const { values: opts } = parseArgs({
  options: {
    "self-test": { type: "boolean", default: false },
    event: { type: "string" },
    base: { type: "string" },
  },
});
if (opts["self-test"]) {
  selftest();
} else {
  if (!opts.event) {
    console.error("usage: demo-stack-plan.mjs --event EVENT [--base REV] | --self-test");
    process.exit(2);
  }
  let paths = [];
  if (PATH_EVENTS.has(opts.event)) {
    if (!opts.base) {
      console.error(`demo-stack-plan: --base is needed for ${opts.event}`);
      process.exit(2);
    }
    paths = execFileSync("git", ["diff", "--name-only", opts.base, "HEAD"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  }
  const out = plan({ event: opts.event, paths });
  console.error(`demo-stack-plan: ${opts.event}, ${paths.length} changed paths, tier ${out.tier}`);
  console.log(format(out));
}
