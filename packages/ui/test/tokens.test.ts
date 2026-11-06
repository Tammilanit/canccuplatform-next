import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { COLOR_TOKENS, FONT_STACKS, FONT_TOKENS, RADIUS, cssVar } from "../src/tokens.js";
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

describe("ui.css :root defaults", () => {
  it("declares exactly one variable per token, equal to the TS default, plus --canccu-radius", () => {
    const root = /:root\s*\{([^}]*)\}/.exec(pkgFile("ui.css"))?.[1] ?? "";
    const declared: Record<string, string> = {};
    for (const m of root.matchAll(/(--canccu-[a-z-]+)\s*:\s*([^;]+);/g)) {
      expect(declared).not.toHaveProperty(m[1] ?? "");
      declared[m[1] ?? ""] = (m[2] ?? "").trim();
    }
    const expected: Record<string, string> = { "--canccu-radius": RADIUS };
    for (const [name, value] of Object.entries(COLOR_TOKENS))
      expected[cssVar("color", name)] = value;
    for (const name of Object.keys(FONT_TOKENS) as (keyof typeof FONT_TOKENS)[]) {
      expected[cssVar("font", name)] = FONT_STACKS[name];
    }
    expect(declared).toEqual(expected);
  });
});
