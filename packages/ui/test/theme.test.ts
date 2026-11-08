import { describe, expect, it } from "vitest";
import { logoPath, resolveTheme, themeCss, themeStyle } from "../src/theme.js";
import { COLOR_TOKENS, FONT_TOKENS, SIZE_TOKENS } from "../src/tokens.js";

describe("resolveTheme / themeCss", () => {
  it("no theme gives the defaults and no override block", () => {
    expect(resolveTheme()).toEqual({
      colors: COLOR_TOKENS,
      fonts: FONT_TOKENS,
      sizes: SIZE_TOKENS,
    });
    expect(resolveTheme({})).toEqual({
      colors: COLOR_TOKENS,
      fonts: FONT_TOKENS,
      sizes: SIZE_TOKENS,
    });
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
    expect(resolveTheme(profile)).toEqual({
      colors: COLOR_TOKENS,
      fonts: FONT_TOKENS,
      sizes: SIZE_TOKENS,
    });
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

describe("sizes and display font", () => {
  it("sets sizes and the display font", () => {
    const profile = {
      theme: { sizes: { radius: "0", safe_inset: "2.5rem" }, fonts: { display: "Anton" } },
    };
    expect(resolveTheme(profile).sizes).toEqual({
      ...SIZE_TOKENS,
      radius: "0",
      safe_inset: "2.5rem",
    });
    expect(themeCss(profile)).toBe(
      ':root {\n  --canccu-font-display: "Anton", system-ui, sans-serif;\n  --canccu-radius: 0;\n  --canccu-safe-inset: 2.5rem;\n}',
    );
  });

  it("drops bad or unknown sizes", () => {
    const bad = ["1", "10vh", "1rem; x: y", "-1px", "1000px", "1.2345rem", "", 4, "1px}"];
    for (const value of bad) {
      const profile = { theme: { sizes: { gap: value, sparkle: "1px" } } };
      expect(resolveTheme(profile).sizes).toEqual(SIZE_TOKENS);
      expect(themeCss(profile)).toBe("");
    }
  });
});

describe("themeStyle (nonce)", () => {
  const profile = { theme: { colors: { primary: "#ff0000" } } };
  const nonce = "abcdEFGH0123+/==-_xyz";

  it("wraps the css in a style element carrying the nonce", () => {
    expect(themeStyle(profile, nonce)).toBe(
      `<style nonce="${nonce}">\n${themeCss(profile)}\n</style>\n`,
    );
  });
  it("without a nonce the style element has no attribute; no overrides give nothing", () => {
    expect(themeStyle(profile)).toBe(`<style>\n${themeCss(profile)}\n</style>\n`);
    expect(themeStyle({}, nonce)).toBe("");
  });
  it("refuses a nonce that is not base64 characters", () => {
    for (const bad of ['a"b', "short", "x".repeat(16) + '" onload="x', "x".repeat(16) + "<", ""]) {
      expect(() => themeStyle(profile, bad)).toThrow(/nonce/);
    }
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
