// The self-test of the screenshot scripts' shots (scripts/demo-stack-plan.mjs --self-test, which
// runs it after demo-stack-plan-test.mjs): each shard takes its groups' shots, and the screens take
// the shots a run chose (#835, docs/ci.md#tiers): a package's affected views at 1920×1080 in one
// theme, the nightly run every theme in two shards, the book portrait and 4K too.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { GROUPS, SHARDS, needsOf } from "./demo-screenshots-groups.mjs";
import { bookOnly } from "./demo-screenshots-shot.mjs";

const BIG = /3840|2160x|x1920|-4k|portrait/;

export function shotChecks({ check, plan, summary, forGroups, groupsAt }) {
  const shots = (script, ...args) =>
    execFileSync(
      "node",
      [new URL(script, import.meta.url).pathname, "--dry-run", ...args],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .split("\n")
      .filter((l) => /^ {2}\S+\.png /.test(l))
      .map((l) => l.trim().split(/\s+/)[0]);
  for (const script of [
    "demo-screenshots.mjs",
    "demo-screenshots-front.mjs",
    "demo-screenshots-dev-seed.mjs",
  ]) {
    check(
      `the shards of ${script} take every shot of the full run, each once`,
      () => {
        const all = shots(script);
        const sharded = SHARDS.flatMap(({ groups }) =>
          shots(script, "--groups", groups.join(",")),
        );
        assert.ok(all.length > 0);
        assert.deepEqual([...sharded].sort(), [...all].sort());
      },
    );
    check(`${script} refuses a group it does not know`, () =>
      assert.throws(
        () => shots(script, "--groups", "agenda,nope"),
        /unknown group nope/,
      ),
    );
  }
  check(
    "only the dev-seed shard runs the dev seed's pass, and a seed change runs it",
    () => {
      assert.ok(
        shots("demo-screenshots-dev-seed.mjs", "--groups", "dev-seed").length >
          0,
      );
      assert.deepEqual(
        shots("demo-screenshots-dev-seed.mjs", "--groups", "agenda,pizza"),
        [],
      );
      assert.deepEqual(
        shots("demo-screenshots.mjs", "--groups", "dev-seed"),
        [],
      );
      assert.deepEqual(needsOf("modules/pizza/src/dev-seed.ts"), [
        "pizza",
        "dev-seed",
      ]);
      assert.deepEqual(needsOf("modules/pizza/src/menus.ts"), ["pizza"]);
    },
  );
  // The weekly run takes every group on one stack: its first pass changes the demo event, which
  // the seeds refuse as made by hand, so the run of show stayed empty there (#751).
  const seeds = (...args) =>
    execFileSync(
      new URL("demo-screenshots", import.meta.url).pathname,
      ["--dry-run", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .split("\n")
      .filter((l) => /^ {2}(admin|agenda|pizza|moments) /.test(l))
      .map((l) => l.trim());
  check(
    "the dev seeds reset the demo event only after a pass on the same stack changed it",
    () => {
      const alone = seeds("--groups", "dev-seed");
      assert.equal(alone.length, 4, alone.join("\n"));
      assert.ok(alone.every((l) => !l.endsWith("--force")), alone.join("\n"));
      const after = seeds();
      assert.equal(after.length, 4, after.join("\n"));
      assert.ok(after.every((l) => l.endsWith("--force")), after.join("\n"));
      assert.deepEqual(seeds("--groups", "agenda"), []);
    },
  );
  check("one group takes only its own shots", () => {
    const agenda = shots("demo-screenshots.mjs", "--groups", "agenda");
    assert.ok(
      agenda.includes("agenda-wide.png") &&
        agenda.includes("error-not-found.png"),
    );
    assert.ok(
      !agenda.some((n) => /^(settings|studio|screen-|theming-)/.test(n)),
      agenda.join(" "),
    );
  });
  const pr = (...paths) => plan({ event: "pull_request", paths });
  /** The shots a shard of `out` would take: its groups and its choice, from the dry run. */
  const taken = (shard) =>
    shots("demo-screenshots.mjs", "--groups", shard.groups, ...shard.select.split(" ").filter(Boolean));
  const screensOf = (out) => out.shards.filter((s) => s.shard.startsWith("screens"));
  const listed = (out) => screensOf(out).flatMap(taken).map((n) => n.replace(/\.png$/, ""));

  check("a widget's change runs only that widget's shots, at 1920×1080 in one theme", () => {
    const out = pr("modules/screen/player/src/claims.css");
    assert.deepEqual(out.shards.map((s) => s.shard), ["screens"]);
    assert.match(out.select, /^--themes default --shots /);
    const names = listed(out);
    assert.ok(names.length > 0);
    for (const n of names) assert.match(n, /^theming-default-screen-claim-[a-z-]+-1920x1080$/);
    assert.deepEqual(names, /--shots (\S+)/.exec(out.select)[1].split(","));
  });
  check("a theme's own files run every view in that theme only; the theming module one theme", () => {
    const terminal = pr("events/demo/themes/terminal/css/base.css");
    assert.equal(terminal.select, "--themes terminal");
    const names = listed(terminal);
    assert.ok(names.includes("theming-terminal-screen-dashboard-1920x1080"), names.join(" "));
    assert.ok(names.every((n) => n.startsWith("theming-terminal-screen-")), names.join(" "));
    assert.equal(pr("modules/theming/src/css.ts").select, "--themes default");
  });
  check("a theme's files beside a widget's keep the default theme for the widget's views", () => {
    const out = pr("events/demo/themes/terminal/css/base.css", "modules/screen/player/src/claims.css");
    assert.match(out.select, /--themes (default,terminal|terminal,default)/);
    assert.ok(listed(out).some((n) => /^theming-default-screen-claim-/.test(n)));
  });
  check("a select never ends with an option that has no value", () => {
    const outs = [
      pr("modules/screen/src/entrance.ts"),
      pr("modules/screen/src/entrance.ts", "modules/agenda/src/index.ts"),
    ];
    for (const out of outs)
      for (const s of out.shards) assert.doesNotMatch(s.select, /--(shots|themes|part)\s*$/, s.select);
  });
  check("frame strips run only for motion or transitions", () => {
    const plain = listed(pr("modules/screen/player/src/player.ts"));
    assert.ok(plain.length > 20);
    assert.ok(!plain.some((n) => /-f\d+$|stage-surge/.test(n)), plain.join(" "));
    const motion = pr("modules/screen/player/src/motion.css");
    assert.match(motion.select, /--strips/);
    assert.ok(listed(motion).some((n) => /motion-.*-f4$/.test(n)));
    for (const path of ["modules/screen/player/src/stage.css", "modules/screen/player/src/director.ts"])
      assert.match(pr(path).select, /--strips/, path);
  });
  check("portrait and 4K never run on a PR or the merge queue", () => {
    for (const event of ["pull_request", "merge_group"]) {
      const out = plan({ event, paths: ["packages/ui/ui.css"] });
      assert.doesNotMatch(out.select, /--book/);
      const names = out.shards
        .filter((s) => /screens|pages/.test(s.shard))
        .flatMap(taken);
      assert.ok(names.length > 100, event);
      assert.deepEqual(names.filter((n) => BIG.test(n)), [], event);
    }
  });
  check("views drawn only in portrait leave the screens out of a package's run", () => {
    const out = pr("modules/screen/player/src/entrance.css");
    assert.deepEqual(out.shards, []);
    assert.match(out.why.join("\n"), /portrait or at 4K/);
  });
  check("nightly: every theme at 1920×1080 with the strips, the screens in two even shards", () => {
    const out = plan({ event: "schedule", paths: [] });
    assert.equal(out.run, "full");
    const parts = screensOf(out);
    assert.deepEqual(parts.map((s) => s.select), ["--strips --part 1/2", "--strips --part 2/2"]);
    const [a, b] = parts.map(taken);
    const all = shots("demo-screenshots.mjs", "--groups", "screens", "--strips");
    assert.deepEqual([...a, ...b], all, "in order, each once");
    assert.ok(Math.min(a.length, b.length) > all.length * 0.4, `${a.length} and ${b.length}`);
    for (const theme of ["terminal", "level-up", "default"])
      assert.ok(all.includes(`theming-${theme}-screen-pulse-1920x1080.png`), theme);
    assert.ok(all.some((n) => /-f\d+\.png$/.test(n)));
    assert.deepEqual(all.filter((n) => BIG.test(n)), []);
  });
  check("the book, by hand only: every theme, portrait, one 4K shot per layout, the pages' 4K", () => {
    const out = plan({ event: "workflow_dispatch", paths: [], book: true });
    assert.equal(out.run, "book");
    const names = screensOf(out).flatMap(taken);
    assert.ok(names.includes("theming-terminal-screen-pulse-1080x1920.png"));
    const big = new Set(
      names.filter((n) => /3840|2160x/.test(n)).map((n) => n.replace(/^theming-default-screen-|-\d+x\d+\.png$/g, "")),
    );
    assert.deepEqual([...big].sort(), ["ambient", "dashboard", "hero", "identify", "offline", "pulse", "split", "test-pattern"]);
    assert.ok(taken(out.shards.find((s) => s.shard === "pages")).includes("moments-screen-spotlight-4k.png"));
    assert.throws(() => plan({ event: "schedule", paths: [], book: true }), /manual/);
  });
  check("a window only the book takes: a screen at 4K or in portrait, never a phone", () => {
    assert.equal(bookOnly({ width: 390, height: 844 }), false);
    assert.equal(bookOnly({ width: 1920, height: 1080 }), false);
    assert.equal(bookOnly({ width: 3840, height: 2160 }), true);
    assert.equal(bookOnly({ width: 1080, height: 1920 }), true);
  });
  // The weekly run's base side runs the newest step tag's scripts, which refuse a group added
  // since (#838): it takes the groups the tag knows and names the rest as new.
  check("a step tag's run takes only the groups its scripts know, and names the new ones", () => {
    const out = pr("modules/bot/src/bind.ts", "modules/agenda/x.py");
    assert.equal(out.groups, "agenda,bot");
    const old = GROUPS.filter((g) => g !== "bot");
    const base = forGroups(out, old, "step-5");
    assert.equal(base.groups, "agenda");
    assert.deepEqual(base.shards, [{ shard: "pages", groups: "agenda", select: "" }]);
    assert.match(summary("pull_request", base), /- new since step-5: bot\b/);
    const none = forGroups(pr("modules/bot/src/bind.ts"), old, "step-5");
    assert.equal(none.groups, "");
    assert.deepEqual(none.shards, []);
    assert.deepEqual(forGroups(out, GROUPS, "step-6"), out);
  });
  check("a revision's groups are the ones its own scripts list", () =>
    assert.deepEqual(groupsAt("HEAD"), GROUPS),
  );
  check("the summary says what runs and why", () => {
    const text = summary("pull_request", pr("modules/screen/player/src/claims.css", "modules/agenda/x.py"));
    assert.match(text, /affected run \(pull_request\)/);
    assert.match(text, /claims\.css: the views named "claims"/);
    assert.match(text, /modules\/agenda\/x\.py: agenda/);
    assert.match(text, /default; 1920×1080 \(no portrait, no 4K\); without the frame strips; \d+ shots: theming-default-screen-claim-rail-1920x1080/);
  });
}
