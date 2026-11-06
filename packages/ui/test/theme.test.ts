import { describe, expect, it } from "vitest";
import { logoPath, resolveTheme, themeCss } from "../src/theme.js";
import { COLOR_TOKENS, FONT_TOKENS } from "../src/tokens.js";

describe("resolveTheme / themeCss", () => {
  it("no theme gives the defaults and no override block", () => {
    expect(resolveTheme()).toEqual({ colors: COLOR_TOKENS, fonts: FONT_TOKENS });
    expect(resolveTheme({})).toEqual({ colors: COLOR_TOKENS, fonts: FONT_TOKENS });
    expect(themeCss({})).toBe("");
  });

  it("a partial theme overrides only those tokens", () => {
    const profile = { theme: { colors: { primary: "#ff0000aa" }, fonts: { body: "Inter" } } };
    const theme = resolveTheme(profile);
    expect(theme.colors.primary).toBe("#ff0000aa");
    expect(theme.colors.background).toBe(COLOR_TOKENS.background);
    expect(theme.fonts.body).toBe("Inter");
    expect(theme.fonts.mono).toBe(FONT_TOKENS.mono);
    expect(themeCss(profile)).toBe(
      ':root {\n  --canccu-color-primary: #ff0000aa;\n  --canccu-font-body: "Inter", system-ui, sans-serif;\n}',
    );
  });

  it("ignores unknown keys", () => {
    const profile = { theme: { colors: { sparkle: "#123456" }, fonts: { fancy: "Inter" } } };
    expect(resolveTheme(profile)).toEqual({ colors: COLOR_TOKENS, fonts: FONT_TOKENS });
    expect(themeCss(profile)).toBe("");
  });

  it("falls back to the default for bad values and never emits them", () => {
    const badColors = ["red", "#12345", "#123456; } body { display: none", "#123456</style>", 42];
    const badFonts = ["", "Inter; color: red", "Inter}", "Inter</style><script>", 'Inter"', 42];
    for (const value of badColors) {
      const profile = { theme: { colors: { primary: value, text_muted: value } } };
      expect(resolveTheme(profile).colors).toEqual(COLOR_TOKENS);
      expect(themeCss(profile)).toBe("");
    }
    for (const value of badFonts) {
      const profile = { theme: { fonts: { body: value } } };
      expect(resolveTheme(profile).fonts).toEqual(FONT_TOKENS);
      expect(themeCss(profile)).toBe("");
    }
  });

  it("does not treat inherited object keys as tokens", () => {
    const profile = { theme: { colors: JSON.parse('{"__proto__": "#123456"}') as object } };
    expect(themeCss(profile as never)).toBe("");
  });
});

describe("logoPath", () => {
  it("returns logos.main when set", () => {
    expect(logoPath({ logos: { main: "assets/logo.svg" } })).toBe("assets/logo.svg");
  });
  it("returns undefined when missing", () => {
    expect(logoPath()).toBeUndefined();
    expect(logoPath({ logos: {} })).toBeUndefined();
    expect(logoPath({ logos: { main: 3 } })).toBeUndefined();
  });
});
