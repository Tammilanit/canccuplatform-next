import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "@canccu/ui";
import { generateColors } from "../src/brand.js";
import { contrastFailures, contrastRatio } from "../src/contrast.js";

const HEX = /^#[0-9a-f]{6}$/;

/** A spread of brand colours: greys, every hue at several lightnesses, and the extremes. */
function sampleColors(): string[] {
  const out = ["#000000", "#ffffff", "#808080", "#0f172a", "#f8fafc", "#3b82f6", "#f59e0b"];
  for (let r = 0; r < 256; r += 51) {
    for (let g = 0; g < 256; g += 51) {
      for (let b = 0; b < 256; b += 85) {
        out.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
      }
    }
  }
  return out;
}

/**
 * Golden outputs (plan D5): a change here changes the screenshots of every simple theme, so it
 * must be a deliberate one. The rows cover each scheme with each choice of primary_text
 * (background, white, black), the shaded red each choice needs, and shading both ways.
 */
const GOLDEN: [string, string, "dark" | "light", string[], string[]][] = [
  [
    "#3b82f6",
    "#f59e0b",
    "dark",
    ["#3b82f6", "#0f172a", "#f59e0b", "#22c55e", "#eab308", "#ef4444"],
    [],
  ],
  [
    "#3b82f6",
    "#f59e0b",
    "light",
    ["#3b82f6", "#000000", "#ca8100", "#00ab4c", "#bb8e00", "#ef4444"],
    ["accent"],
  ],
  [
    "#e11d48",
    "#0ea5e9",
    "dark",
    ["#e11d48", "#ffffff", "#0ea5e9", "#22c55e", "#eab308", "#df3236"],
    [],
  ],
  [
    "#e11d48",
    "#0ea5e9",
    "light",
    ["#e11d48", "#ffffff", "#009ada", "#00ab4c", "#bb8e00", "#df3236"],
    ["accent"],
  ],
  [
    "#4b6bff",
    "#10b981",
    "dark",
    ["#4b6bff", "#000000", "#10b981", "#22c55e", "#eab308", "#ef4444"],
    [],
  ],
  [
    "#1d4ed8",
    "#b45309",
    "light",
    ["#1d4ed8", "#f8fafc", "#b45309", "#00ab4c", "#bb8e00", "#db2e33"],
    [],
  ],
  [
    "#1e1b4b",
    "#fde047",
    "dark",
    ["#5d5f95", "#ffffff", "#fde047", "#22c55e", "#eab308", "#df3236"],
    ["primary"],
  ],
  [
    "#fde047",
    "#1e1b4b",
    "light",
    ["#a79000", "#000000", "#1e1b4b", "#00ab4c", "#bb8e00", "#ef4444"],
    ["primary"],
  ],
  [
    "#000000",
    "#ffffff",
    "dark",
    ["#656565", "#ffffff", "#ffffff", "#22c55e", "#eab308", "#df3236"],
    ["primary"],
  ],
  [
    "#ffffff",
    "#000000",
    "light",
    ["#909090", "#000000", "#000000", "#00ab4c", "#bb8e00", "#ef4444"],
    ["primary"],
  ],
];

const PALETTES = {
  dark: ["#0f172a", "#1e293b", "#334155", "#f8fafc", "#94a3b8"],
  light: ["#f8fafc", "#ffffff", "#cbd5e1", "#0f172a", "#475569"],
};

describe("brand-kit generation", () => {
  it.each(GOLDEN)("generates %s, %s, %s as pinned", (primary, accent, scheme, want, adjusted) => {
    const out = generateColors({ primary, accent, scheme });
    const [p, pt, a, ok, degraded, down] = want as [string, string, string, string, string, string];
    const [bg, surface, border, text, muted] = PALETTES[scheme] as [
      string,
      string,
      string,
      string,
      string,
    ];
    expect(out.colors).toEqual({
      background: bg,
      surface,
      border,
      text,
      text_muted: muted,
      primary: p,
      primary_text: pt,
      accent: a,
      status_ok: ok,
      status_degraded: degraded,
      status_down: down,
    });
    expect(Object.keys(out.colors)).toEqual(Object.keys(COLOR_TOKENS));
    expect(out.adjusted).toEqual(adjusted);
  });

  it("reproduces the platform defaults from the default brand", () => {
    const { colors, adjusted } = generateColors({
      primary: COLOR_TOKENS.primary,
      accent: COLOR_TOKENS.accent,
      scheme: "dark",
    });
    expect(colors).toEqual(COLOR_TOKENS);
    expect(adjusted).toEqual([]);
  });

  it("never produces a pair that breaks the contrast rules", () => {
    const colors = sampleColors();
    for (const scheme of ["dark", "light"] as const) {
      for (const [i, primary] of colors.entries()) {
        const accent = colors[(i * 7 + 3) % colors.length] as string;
        const out = generateColors({ primary, accent, scheme });
        expect(contrastFailures(out.colors), `${primary} ${accent} ${scheme}`).toEqual([]);
        for (const value of Object.values(out.colors)) expect(value).toMatch(HEX);
      }
    }
  });

  it("keeps a given colour that passes, and names the ones it shaded", () => {
    const dark = generateColors({ primary: "#22d3ee", accent: "#1e1b4b", scheme: "dark" });
    expect(dark.colors.primary).toBe("#22d3ee");
    expect(dark.colors.accent).not.toBe("#1e1b4b");
    expect(contrastRatio(dark.colors.accent, dark.colors.background)).toBeGreaterThanOrEqual(3);
    expect(dark.adjusted).toEqual(["accent"]);

    const light = generateColors({ primary: "#fde047", accent: "#1d4ed8", scheme: "light" });
    expect(light.adjusted).toEqual(["primary"]);
    expect(light.colors.accent).toBe("#1d4ed8");
  });

  it("moves a shaded colour in lightness only, away from the background", () => {
    const out = generateColors({ primary: "#1e1b4b", accent: "#f59e0b", scheme: "dark" });
    // Lighter than the given indigo, still blue-violet rather than grey.
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(out.colors.primary.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(r + g + b).toBeGreaterThan(0x1e + 0x1b + 0x4b);
  });

  it("chooses the scheme's palette for the neutral tokens", () => {
    const light = generateColors({ primary: "#1d4ed8", accent: "#b45309", scheme: "light" });
    expect(light.colors.background).not.toBe(COLOR_TOKENS.background);
    expect(contrastRatio(light.colors.text, light.colors.background)).toBeGreaterThan(10);
    // The light palette's background is light: white text would not be readable on it.
    expect(contrastRatio("#ffffff", light.colors.background)).toBeLessThan(1.2);
  });

  it("drops the alpha of a given colour and writes lower case", () => {
    const out = generateColors({ primary: "#22D3EE80", accent: "#F59E0B", scheme: "dark" });
    expect(out.colors.primary).toBe("#22d3ee");
    expect(out.colors.accent).toBe("#f59e0b");
    expect(out.adjusted).toEqual([]);
  });

  it("picks primary_text from background, white and black, in that order", () => {
    // Dark primary on a light page: the background (near white) reads on it.
    const light = generateColors({ primary: "#1d4ed8", accent: "#b45309", scheme: "light" });
    expect(light.colors.primary_text).toBe(light.colors.background);
    // A light primary on a dark page: the dark background reads on it.
    const dark = generateColors({ primary: "#fde047", accent: "#f59e0b", scheme: "dark" });
    expect(dark.colors.primary_text).toBe(dark.colors.background);
  });

  it("prefers a primary_text that reads on both fills over shading the red", () => {
    // White reads on this grey but not on the platform red; black reads on both, so it wins and
    // status_down stays the platform's.
    const out = generateColors({ primary: "#767676", accent: "#f59e0b", scheme: "dark" });
    expect(out.colors.primary_text).toBe("#000000");
    expect(out.colors.status_down).toBe(COLOR_TOKENS.status_down);
  });

  it("is deterministic", () => {
    const input = { primary: "#7c3aed", accent: "#10b981", scheme: "light" } as const;
    expect(generateColors(input)).toEqual(generateColors({ ...input }));
  });
});
