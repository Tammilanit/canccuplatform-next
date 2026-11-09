import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "@canccu/ui";
import { contrastFailures, contrastRatio } from "../src/contrast.js";
import { adminTokens, fillTokens, fontValue, platformTokens, tokensCss } from "../src/tokens.js";

describe("contrast", () => {
  it("measures the WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("passes the platform defaults (contracts/theming.md, Tenancy)", () => {
    expect(contrastFailures(platformTokens().colors)).toEqual([]);
  });

  it("names each failing pair", () => {
    const colors = { ...COLOR_TOKENS, text_muted: "#1e293b", status_ok: "#1e293b" };
    expect(contrastFailures(colors)).toEqual([
      "text_muted on background",
      "text_muted on surface",
      "status_ok on surface",
    ]);
  });

  it("ignores the alpha of an 8-digit colour", () => {
    expect(contrastRatio("#00000080", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe("tokens", () => {
  it("fills missing tokens with the platform defaults and drops unknown or unsafe ones", () => {
    const t = fillTokens({
      colors: { primary: "#112233", nope: "#000000", text: "red;}" },
      fonts: { body: "Inter" },
      sizes: { radius: "2px", gap: "1rem; color: red" },
    });
    expect(t.colors.primary).toBe("#112233");
    expect(t.colors.text).toBe(COLOR_TOKENS.text);
    expect(t.colors).not.toHaveProperty("nope");
    expect(t.fonts.body).toBe("Inter");
    expect(t.sizes.radius).toBe("2px");
    expect(t.sizes.gap).toBe("1rem");
  });

  it("quotes a family unless it is generic, then appends the fallback once", () => {
    expect(fontValue("body", "Inter")).toBe('"Inter", system-ui, sans-serif');
    expect(fontValue("body", "system-ui")).toBe("system-ui, sans-serif");
    expect(fontValue("mono", "ui-monospace")).toBe("ui-monospace, monospace");
    expect(fontValue("heading", "serif")).toBe("serif, system-ui, sans-serif");
  });

  it("writes one :root block with every custom property", () => {
    const css = tokensCss(platformTokens());
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css).toContain("  --canccu-color-text-muted: #94a3b8;\n");
    expect(css).toContain("  --canccu-font-display: system-ui, sans-serif;\n");
    expect(css).toContain("  --canccu-safe-inset: 48px;\n");
    expect(css.match(/--canccu-/g)).toHaveLength(11 + 4 + 4);
  });

  it("is stable: the same tokens give the same CSS", () => {
    const a = tokensCss(fillTokens({ colors: { accent: "#123456" } }));
    const b = tokensCss(fillTokens({ colors: { accent: "#123456" } }));
    expect(a).toBe(b);
  });

  it("gives admin pages the platform colours when the theme fails the contrast rules", () => {
    const failing = fillTokens({ colors: { text: "#0f172a" }, fonts: { body: "Inter" } });
    const admin = adminTokens(failing);
    expect(admin.colors).toEqual(platformTokens().colors);
    expect(admin.fonts.body).toBe("Inter");

    const passing = fillTokens({ colors: { accent: "#fbbf24" } });
    expect(adminTokens(passing)).toEqual(passing);
  });
});
