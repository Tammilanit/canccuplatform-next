/**
 * The grid guard (amendment 3, docs/design/grids/README.md#the-guard): its cases, and one run over
 * the repo's tracked files, so a new fixed-count collection grid fails `lint-types-test (ui)`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGrids, guardedFiles, KINDS } from "./grid-rule.js";

const MODULE_CSS = "modules/demo/static/demo.css";
const MODULE_TS = "modules/demo/src/view.ts";
const UI_CSS = "packages/ui/ui.css";

const lines = (path: string, text: string) => checkGrids(path, text).map((f) => f.line);

describe("the grid guard in CSS", () => {
  it("fails a plain fixed repeat(3, …)", () => {
    const found = checkGrids(
      MODULE_CSS,
      ".a {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n}\n",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: MODULE_CSS, line: 3 });
    expect(found[0]?.text).toBe("grid-template-columns: repeat(3, 1fr)");
    expect(found[0]?.message).toContain("a collection takes `.canccu-grid`");
  });

  it("fails auto-fit and auto-fill in a module: its own collection grid is what the rule replaces", () => {
    expect(
      lines(MODULE_CSS, ".a { grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }"),
    ).toEqual([1]);
    expect(
      lines(MODULE_CSS, ".a { grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); }"),
    ).toEqual([1]);
  });

  it.each(KINDS)(
    "passes the kind %s with a reason, on the same line and on the line above",
    (kind) => {
      const same = `.a {\n  grid-template-columns: 1fr 1fr; /* canccu-grid: fixed ${kind} — two equal halves here */\n}\n`;
      const above = `.a {\n  /* canccu-grid: fixed ${kind} - two equal halves here */\n  grid-template-columns: 1fr 1fr;\n}\n`;
      expect(checkGrids(MODULE_CSS, same)).toEqual([]);
      expect(checkGrids(MODULE_CSS, above)).toEqual([]);
    },
  );

  it("fails an unknown kind", () => {
    const text =
      ".a {\n  /* canccu-grid: fixed gallery — the photos in a row */\n  grid-template-columns: 1fr 1fr;\n}\n";
    const found = checkGrids(MODULE_CSS, text);
    expect(found.map((f) => f.line)).toEqual([2]);
    expect(found[0]?.message).toContain("unknown kind");
  });

  it("fails a marker without a reason, or with fewer than three words", () => {
    expect(
      lines(
        MODULE_CSS,
        ".a {\n  /* canccu-grid: fixed form */\n  grid-template-columns: 1fr 1fr;\n}\n",
      ),
    ).toEqual([2]);
    expect(
      lines(
        MODULE_CSS,
        ".a {\n  /* canccu-grid: fixed form — two halves */\n  grid-template-columns: 1fr 1fr;\n}\n",
      ),
    ).toEqual([2]);
  });

  it("fails a marker two lines above, and the marker that is on no declaration", () => {
    const text =
      ".a {\n  /* canccu-grid: fixed form — label and field pairs */\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n}\n";
    const found = checkGrids(MODULE_CSS, text);
    expect(found.map((f) => f.line).sort()).toEqual([2, 4]);
    expect(found.find((f) => f.line === 2)?.message).toContain("on no declaration");
  });

  it("reads the grid-template shorthand's column list after its slash", () => {
    const shell =
      '.a {\n  grid-template: "head head" auto "menu main" 1fr / 16rem minmax(0, 1fr);\n}\n';
    expect(checkGrids(MODULE_CSS, shell)[0]?.text).toBe("grid-template: / 16rem minmax(0, 1fr)");
    expect(lines(MODULE_CSS, '.a {\n  grid-template: "a" auto "b" 1fr;\n}\n')).toEqual([]);
    const marked = `.a {\n  /* canccu-grid: fixed shell — menu beside the content */\n${shell.slice(5)}`;
    expect(checkGrids(MODULE_CSS, marked)).toEqual([]);
  });

  it("reads a declaration that prettier wraps over several lines", () => {
    const text =
      ".a {\n  grid-template-columns:\n    minmax(0, 0.8fr) repeat(2, minmax(0, 1.2fr))\n    repeat(2, minmax(0, 1.3fr));\n}\n";
    expect(lines(MODULE_CSS, text)).toEqual([2]);
  });

  it("ignores a declaration inside a comment", () => {
    expect(
      lines(MODULE_CSS, "/* grid-template-columns: repeat(3, 1fr); */\n.a { color: red; }\n"),
    ).toEqual([]);
  });

  it("fails a module that sets --canccu-grid-min: the three sizes are ui.css's", () => {
    const found = checkGrids(MODULE_CSS, ".a {\n  --canccu-grid-min: 12rem;\n}\n");
    expect(found.map((f) => f.line)).toEqual([2]);
    expect(found[0]?.message).toContain("three sizes");
  });

  it("passes ui.css's own .canccu-grid rule and its modifiers, and only there", () => {
    const rule = [
      ".canccu-grid,",
      ".canccu-stats {",
      "  --canccu-grid-min: 18rem;",
      "  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--canccu-grid-min)), 1fr));",
      "}",
      ".canccu-grid--small { --canccu-grid-min: 10rem; }",
      "",
    ].join("\n");
    expect(checkGrids(UI_CSS, `@layer canccu {\n${rule}}\n`)).toEqual([]);
    expect(lines(MODULE_CSS, rule)).toEqual([3, 4, 6]);
    expect(lines(UI_CSS, ".canccu-other { grid-template-columns: 1fr 1fr; }")).toEqual([1]);
  });
});

describe("the grid guard in TypeScript and JavaScript", () => {
  it("fails gridTemplateColumns and setProperty without a marker", () => {
    const text = [
      "el.style.gridTemplateColumns = `repeat(${n}, 1fr)`;",
      'el.style.setProperty("grid-template-columns", cols);',
      'el.style.setProperty("grid-template-rows", rows);',
      "",
    ].join("\n");
    expect(lines(MODULE_TS, text)).toEqual([1, 2]);
  });

  it("passes them with a // marker on the line or above", () => {
    const text = [
      "// canccu-grid: fixed screen — the layout's own columns",
      "el.style.gridTemplateColumns = `repeat(${n}, 1fr)`;",
      'el.style.setProperty("grid-template-columns", cols); // canccu-grid: fixed screen — from the theme layout',
      "",
    ].join("\n");
    expect(checkGrids(MODULE_TS, text)).toEqual([]);
  });

  it("fails a setProperty of --canccu-grid-min", () => {
    expect(lines(MODULE_TS, 'el.style.setProperty("--canccu-grid-min", "9rem");')).toEqual([1]);
  });
});

describe("the files the guard reads", () => {
  it("takes CSS under modules/ and packages/ui/, and source scripts under modules/ and packages/", () => {
    expect(
      guardedFiles([
        "modules/moments/static/on-air.css",
        "packages/ui/ui.css",
        "packages/kit-ts/x.css",
        "docs/design/x.css",
        "modules/screen/player/src/screen.ts",
        "modules/screen/static/studio-layout.js",
        "packages/kit-ts/src/a.mjs",
        "modules/moments/test/x.ts",
        "modules/moments/src/x.test.ts",
        "packages/ui/src/index.d.ts",
        "modules/a/node_modules/b/c.js",
        "scripts/demo.mjs",
      ]),
    ).toEqual([
      "modules/moments/static/on-air.css",
      "packages/ui/ui.css",
      "modules/screen/player/src/screen.ts",
      "modules/screen/static/studio-layout.js",
      "packages/kit-ts/src/a.mjs",
    ]);
  });
});

describe("the repo", () => {
  it("has no unmarked column list: collections use .canccu-grid, fixed layouts carry the marker", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const tracked = execFileSync("git", ["ls-files", "modules", "packages"], {
      cwd: root,
      encoding: "utf8",
    });
    const files = guardedFiles(tracked.split("\n").filter((f) => f !== ""));
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((f) => checkGrids(f, readFileSync(join(root, f), "utf8")));
    expect(found.map((f) => `${f.file}:${String(f.line)} ${f.text} — ${f.message}`)).toEqual([]);
  });
});
