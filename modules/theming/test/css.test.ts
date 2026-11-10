/**
 * A theme's CSS (contracts/theming.md, Advanced mode, CSS rules): checked with a CSS parser at
 * upload, every failure `css_forbidden`, and compiled into one file in `@layer canccu-theme`.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkCss, compileCss } from "../src/css.js";

const check = (css: string) => checkCss("css/theme.css", Buffer.from(css));

function refused(css: string): string {
  const result = check(css);
  if (result.ok) throw new Error(`accepted: ${css}`);
  expect(result.problem.code).toBe("css_forbidden");
  expect(result.problem.path).toBe("css/theme.css");
  return result.problem.message;
}

const demo = new URL("../../../events/demo/themes/", import.meta.url);

describe("checkCss", () => {
  it("accepts the demo themes' CSS on the stable classes, with no warnings", async () => {
    for (const path of [
      "level-up/css/base.css",
      "level-up/css/cards.css",
      "level-up/css/widgets.css",
      "terminal/css/theme.css",
    ]) {
      const result = checkCss(path, await readFile(new URL(path, demo)));
      expect(result, path).toMatchObject({ ok: true, refs: [], warnings: [] });
    }
  });

  it("answers the package files url() names, from inside and outside @font-face", () => {
    const result = check(`
      @font-face { font-family: "T"; src: url(fonts/t.woff2) format("woff2"); }
      .canccu-page { background: url("images/bg.png") no-repeat; }
      .t-x { --t-art: url('images/art.svg'); background-image: image-set(url(images/bg.png) 1x); }`);
    expect(result).toMatchObject({
      ok: true,
      refs: ["fonts/t.woff2", "images/bg.png", "images/art.svg"],
    });
  });

  it.each([
    ["@import", `@import "x.css";`, "@import"],
    ["@import with url()", `@import url(css/b.css);`, "@import"],
    ["@namespace", `@namespace svg url(http://www.w3.org/2000/svg);`, "@namespace"],
    ["@charset other than UTF-8", `@charset "iso-8859-1";`, "@charset"],
    [
      "an at-rule outside the allow-list",
      `@property --t-x { syntax: "*"; inherits: false; }`,
      "@property",
    ],
    ["an escaped @import", `@\\69mport "x.css";`, "@import"],
    ["data: in url()", `.t-a { background: url(data:image/png;base64,AAAA); }`, "data:"],
    [
      "an http url()",
      `.t-a { background: url(http://evil.test/x.png); }`,
      "http://evil.test/x.png",
    ],
    ["a protocol-relative url()", `.t-a { background: url(//evil.test/x.png); }`, "//evil.test"],
    ["an absolute path", `.t-a { background: url(/theming/a/x.png); }`, "/theming/a/x.png"],
    ["a path outside images/ and fonts/", `.t-a { background: url(css/b.css); }`, "css/b.css"],
    ["a .. path", `.t-a { background: url(images/../css/b.css); }`, "images/../css/b.css"],
    ["a query", `.t-a { background: url(images/a.png?x=1); }`, "images/a.png?x=1"],
    ["a font outside @font-face", `.t-a { background: url(fonts/t.woff2); }`, "fonts/t.woff2"],
    [
      "an image in @font-face",
      `@font-face { font-family: T; src: url(images/a.png); }`,
      "images/a.png",
    ],
    ["local() in @font-face", `@font-face { font-family: T; src: local(Arial); }`, "local()"],
    [
      "a string URL in image-set()",
      `.t-a { background: image-set("images/a.png" 1x); }`,
      "image-set()",
    ],
    ["a string URL in src()", `.t-a { background: src("images/a.png"); }`, "src()"],
    ["an escaped url()", `.t-a { background: \\75 rl("https://evil.test/x.png"); }`, "url()"],
    ["a custom property that does not parse", `.t-a { --t-x: {url(x)}; }`, "parse"],
    ["expression()", `.t-a { width: expression(alert(1)); }`, "expression()"],
    ["an escaped expression()", `.t-a { width: \\65xpression(alert(1)); }`, "expression()"],
    ["behavior", `.t-a { behavior: url(images/a.htc); }`, "behavior"],
    ["an escaped behavior", `.t-a { beh\\61vior: url(images/a.png); }`, "behavior"],
    ["-moz-binding", `.t-a { -moz-binding: url(images/a.xml#x); }`, "-moz-binding"],
    ["javascript: in url()", `.t-a { background: url(javascript:alert(1)); }`, "javascript:"],
    ["javascript: in a string", `.t-a::after { content: "javascript:alert(1)"; }`, "javascript:"],
    ["escaped javascript:", `.t-a::after { content: "\\6a avascript:x"; }`, "javascript:"],
    [
      "a custom property hiding a url",
      `.t-a { --t-x: url(https://evil.test/x.png); }`,
      "https://evil.test",
    ],
    ["CSS that does not parse", `.t-a { color: red; } } .t-b {`, "does not parse"],
  ])("refuses %s", (_name, css, named) => {
    expect(refused(css)).toContain(named);
  });

  it("names the line of each failure", () => {
    expect(refused(`.t-a { color: red; }\n\n@import "x.css";`)).toContain("line 3");
  });

  it("refuses what is no UTF-8 text, and a file over 256 KB", () => {
    expect(refused("\u0000.t-a{}")).toContain("UTF-8");
    expect(checkCss("css/a.css", Buffer.from([0xff, 0xfe, 0x00]))).toMatchObject({ ok: false });
    const big = checkCss("css/a.css", Buffer.from(`.t-a{}`.padEnd(256 * 1024 + 1, " ")));
    expect(big).toMatchObject({ ok: false, problem: { code: "file_too_large" } });
  });

  it("warns, never refuses, for classes neither stable nor t-", () => {
    const result = check(`
      .canccu-widget--agenda_now .canccu-widget__title, .canccu-layout--main, .t-own { color: red; }
      .canccu-is-active:not(.legacy-box) .other { color: blue; }
      .canccu-buttonx { color: green; }`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      severity: "warning",
      code: "class_unstable",
      path: "css/theme.css",
    });
    for (const name of ["legacy-box", "other", "canccu-buttonx"]) {
      expect(result.warnings[0]?.message).toContain(name);
    }
  });
});

describe("compileCss", () => {
  const served = (path: string): string | undefined =>
    ({ "images/bg.png": "/theming/a/aaaa.png", "fonts/t.woff2": "/theming/a/bbbb.woff2" })[path];

  it("puts every file, in order, into @layer canccu-theme with url() rewritten", () => {
    const css = compileCss(
      [
        {
          path: "css/a.css",
          bytes: Buffer.from(
            `@charset "UTF-8";\n/* note */ .t-a { background: url(images/bg.png); }`,
          ),
        },
        {
          path: "css/b.css",
          bytes: Buffer.from(
            `@font-face { font-family: T; src: url("fonts/t.woff2"); } .t-b { color: red; }`,
          ),
        },
      ],
      served,
    );
    expect(css.startsWith("@layer canccu-theme{")).toBe(true);
    expect(css.endsWith("}")).toBe(true);
    expect(css).toContain("url(/theming/a/aaaa.png)");
    expect(css).toContain("url(/theming/a/bbbb.woff2)");
    expect(css).not.toContain("images/bg.png");
    expect(css).not.toContain("@charset");
    expect(css).not.toContain("note");
    expect(css.indexOf(".t-a")).toBeLessThan(css.indexOf(".t-b"));
  });

  it("keeps a theme's own layers inside canccu-theme, and nothing escapes it", () => {
    const css = compileCss(
      [
        {
          path: "css/a.css",
          bytes: Buffer.from(`@layer canccu-base { .canccu-page { color: red !important; } }`),
        },
      ],
      served,
    );
    expect(css).toBe("@layer canccu-theme{@layer canccu-base{.canccu-page{color:red!important}}}");
  });

  it("refuses to compile CSS that fails its checks or names a file it cannot serve", () => {
    expect(() =>
      compileCss([{ path: "css/a.css", bytes: Buffer.from(`@import "x";`) }], served),
    ).toThrow(/css\/a.css/);
    expect(() =>
      compileCss(
        [{ path: "css/a.css", bytes: Buffer.from(`.t-a{background:url(images/no.png)}`) }],
        served,
      ),
    ).toThrow(/images\/no.png/);
  });
});
