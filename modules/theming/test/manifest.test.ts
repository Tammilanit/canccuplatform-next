/**
 * theme.yaml read as untrusted YAML, and the checks of how the manifest fits the package's files
 * (contracts/theming.md, The theme package; the rules of scripts/check-theme-refs).
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { checkManifest } from "../src/checks.js";
import { parseManifest, referenceProblems } from "../src/manifest.js";
import type { PackagePaths } from "../src/manifest.js";

const paths = (present: string[], failed: string[] = []): PackagePaths => ({
  present: new Set([...present, ...failed]),
  failed: new Set(failed),
});

const advanced = {
  schema_version: 1,
  name: "T",
  mode: "advanced",
  tokens: { fonts: { body: "Exo 2", mono: "ui-monospace" } },
  images: { logo: "images/logo.svg" },
  css: ["css/a.css"],
  fonts: [
    {
      family: "Exo 2",
      file: "fonts/exo.woff2",
      licence: "OFL-1.1",
      licence_file: "fonts/OFL.txt",
    },
  ],
  templates: { big: { widget: "clock", file: "templates/big.mustache" } },
  embeds: { drift: { entry: "embeds/drift/index.html", files: ["embeds/drift/drift.js"] } },
};
const ALL = [
  "images/logo.svg",
  "css/a.css",
  "fonts/exo.woff2",
  "fonts/OFL.txt",
  "templates/big.mustache",
  "embeds/drift/index.html",
  "embeds/drift/drift.js",
];

const codes = (m: Record<string, unknown>, p: PackagePaths): string[] =>
  referenceProblems(m, p).map((x) => `${x.code} ${x.path ?? ""}`);

describe("parseManifest", () => {
  it("reads every demo theme as the schema wants it", async () => {
    for (const theme of ["default", "terminal", "level-up"]) {
      const bytes = await readFile(
        new URL(`../../../events/demo/themes/${theme}/theme.yaml`, import.meta.url),
      );
      const parsed = parseManifest(bytes);
      if (!parsed.ok) throw new Error(parsed.why);
      expect(checkManifest(parsed.manifest).filter((p) => p.code === "schema")).toEqual([]);
    }
  });

  it("refuses aliases, so an alias bomb never expands", () => {
    const bomb =
      'a: &a ["x","x","x","x","x","x","x","x","x"]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b]\n';
    const parsed = parseManifest(Buffer.from(bomb));
    expect(parsed.ok).toBe(false);
  });

  it.each([
    ["no UTF-8", Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x3a, 0x20, 0xff])],
    ["no YAML", Buffer.from("name: [unclosed\n")],
    ["no mapping", Buffer.from("- a\n- b\n")],
    ["a key twice", Buffer.from("name: a\nname: b\n")],
    ["over 64 KB", Buffer.from(`name: "${"x".repeat(65 * 1024)}"\n`)],
  ])("refuses %s", (_what, bytes) => {
    expect(parseManifest(bytes).ok).toBe(false);
  });
});

describe("referenceProblems", () => {
  it("finds nothing wrong in a package with every file it names", () => {
    expect(codes(advanced, paths(ALL))).toEqual([]);
  });

  it("names each file the manifest names but the package lacks (file_missing)", () => {
    expect(codes(advanced, paths(["images/logo.svg", "css/a.css"]))).toEqual([
      "file_missing fonts/exo.woff2",
      "file_missing fonts/OFL.txt",
      "file_missing templates/big.mustache",
      "file_missing embeds/drift/index.html",
      "file_missing embeds/drift/drift.js",
    ]);
  });

  it("does not call a file missing that is there but failed its checks", () => {
    const failed = ["fonts/exo.woff2", "embeds/drift/drift.js"];
    expect(
      codes(
        advanced,
        paths(
          ALL.filter((p) => !failed.includes(p)),
          failed,
        ),
      ),
    ).toEqual([]);
  });

  it("knows a font token's family only from the package's fonts or the generic ones", () => {
    const m = { ...advanced, tokens: { fonts: { body: "Comic Sans", mono: "monospace" } } };
    expect(codes(m, paths(ALL))).toEqual(["reference_unknown theme.yaml#/tokens/fonts/body"]);
  });

  it("keeps an embed's files in its own folder", () => {
    const m = { ...advanced, embeds: { drift: { entry: "embeds/other/index.html" } } };
    expect(codes(m, paths([...ALL, "embeds/other/index.html"]))).toEqual([
      "reference_unknown theme.yaml#/embeds/drift",
    ]);
  });

  it("refuses advanced content in a package that declares simple (mode_mismatch)", () => {
    const m = { ...advanced, mode: "simple" };
    expect(codes(m, paths(ALL))).toEqual([
      "mode_mismatch theme.yaml#/css",
      "mode_mismatch theme.yaml#/fonts",
      "mode_mismatch theme.yaml#/templates",
      "mode_mismatch theme.yaml#/embeds",
      "mode_mismatch theme.yaml#/tokens/fonts",
    ]);
    const filesOnly = { schema_version: 1, name: "T", mode: "simple", tokens: {} };
    expect(codes(filesOnly, paths(["css/a.css", "images/logo.svg"]))).toEqual([
      "mode_mismatch css/a.css",
    ]);
  });

  it("checks a manifest that breaks the schema as far as it can, without throwing", () => {
    const broken = {
      fonts: [null, { file: 3 }],
      embeds: { x: "y" },
      tokens: { fonts: 5 },
      css: "a",
    };
    expect(() => referenceProblems(broken, paths([]))).not.toThrow();
  });
});
