import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { COLOR_TOKENS, FONT_STACKS, FONT_TOKENS, SIZE_TOKENS, cssVar } from "../src/tokens.js";
import { contrast } from "./contrast.js";
import { pkgFile, repoFile } from "./helpers.js";

const schema = JSON.parse(repoFile("contracts/profile.schema.json")) as {
  $defs: { key: { pattern: string } };
};

describe("tokens against the profile contract", () => {
  it("a profile using every default token validates against profile.schema.json", () => {
    const ajv = new Ajv2020({ strict: true });
    addFormats.default(ajv);
    const validate = ajv.compile(schema);
    const profile = {
      schema_version: 1,
      name: "Token check",
      modules: ["admin"],
      theme: { colors: { ...COLOR_TOKENS }, fonts: { ...FONT_TOKENS } },
    };
    expect(validate(profile), JSON.stringify(validate.errors)).toBe(true);
  });

  it("every token name matches $defs.key", () => {
    const key = new RegExp(schema.$defs.key.pattern);
    for (const name of [...Object.keys(COLOR_TOKENS), ...Object.keys(FONT_TOKENS)]) {
      expect(name).toMatch(key);
    }
  });

  it("the demo profile uses only known tokens", () => {
    const demo = parse(repoFile("events/demo/profile.yaml")) as {
      theme?: { colors?: object; fonts?: object };
    };
    for (const name of Object.keys(demo.theme?.colors ?? {})) {
      expect(Object.keys(COLOR_TOKENS)).toContain(name);
    }
    for (const name of Object.keys(demo.theme?.fonts ?? {})) {
      expect(Object.keys(FONT_TOKENS)).toContain(name);
    }
  });
});

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("contrast of the defaults", () => {
  it("primary_text reaches 4.5:1 on primary and status_down (contracts/theming.md)", () => {
    expect(COLOR_TOKENS.primary_text).toBe("#0f172a");
    expect(contrast(COLOR_TOKENS.primary_text, COLOR_TOKENS.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLOR_TOKENS.primary_text, COLOR_TOKENS.status_down)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe("size tokens against theme.schema.json", () => {
  const themeSchema = JSON.parse(repoFile("contracts/theme.schema.json")) as {
    $defs: { length: { pattern: string } };
  };
  it("defaults are the contract's and match $defs.length", () => {
    expect(SIZE_TOKENS).toEqual({
      radius: "0.5rem",
      border_width: "1px",
      gap: "1rem",
      safe_inset: "48px",
    });
    const length = new RegExp(themeSchema.$defs.length.pattern);
    for (const value of Object.values(SIZE_TOKENS)) expect(value).toMatch(length);
  });
});

describe("ui.css :root defaults", () => {
  it("declares exactly one variable per token, equal to the TS default, plus the size tokens", () => {
    const css = stripComments(pkgFile("ui.css"));
    expect(css).toMatch(/^\s*@layer canccu-base \{/);
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const declared: Record<string, string> = {};
    for (const m of root.matchAll(/(--canccu-[a-z-]+)\s*:\s*([^;]+);/g)) {
      expect(declared).not.toHaveProperty(m[1] ?? "");
      declared[m[1] ?? ""] = (m[2] ?? "").trim();
    }
    const expected: Record<string, string> = {};
    for (const [name, value] of Object.entries(SIZE_TOKENS)) {
      expected[`--canccu-${name.replaceAll("_", "-")}`] = value;
    }
    for (const [name, value] of Object.entries(COLOR_TOKENS))
      expected[cssVar("color", name)] = value;
    for (const name of Object.keys(FONT_TOKENS) as (keyof typeof FONT_TOKENS)[]) {
      expected[cssVar("font", name)] = FONT_STACKS[name];
    }
    // display follows the heading font until a theme sets it
    expected["--canccu-font-display"] = "var(--canccu-font-heading)";
    expect(declared).toEqual(expected);
  });
});

describe("ui.css classes", () => {
  it("styles the screen surface and the state classes inside the base layer", () => {
    const css = stripComments(pkgFile("ui.css"));
    // hub, info and admin need no base rule: they are hooks for themes, set by page()
    expect(css).toContain(".canccu-surface--screen");
    for (const cls of ["active", "empty", "stale", "offline"]) {
      expect(css).toContain(`.canccu-is-${cls}`);
    }
    expect(css.trimEnd().endsWith("}")).toBe(true);
    expect(css.match(/@layer/g)).toHaveLength(1);
  });
});
