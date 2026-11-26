// The pack's data (#784): the three presets of events/demo/themes/ with the schemes this pack
// proposes, the 14 font pairs the PO chooses from (Q4), and the contrast rules of
// contracts/theming.md (Brand kit), so a proposed scheme that fails them stops the build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The colours a preset's theme.yaml holds: the first scheme of each preset is exactly these. */
function packageColors(theme) {
  const yaml = readFileSync(join(ROOT, "events/demo/themes", theme, "theme.yaml"), "utf8");
  const block = yaml.match(/\n  colors:\n((?: {4}\w+: "#[0-9a-f]{6}"\n)+)/i);
  if (!block) throw new Error(`no tokens.colors in ${theme}/theme.yaml`);
  return Object.fromEntries([...block[1].matchAll(/(\w+): "(#[0-9a-f]{6})"/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const c = (background, surface, border, text, text_muted, primary, primary_text, accent, status_ok, status_degraded, status_down) => ({
  background, surface, border, text, text_muted, primary, primary_text, accent, status_ok, status_degraded, status_down,
});

export const PRESETS = [
  {
    id: "default",
    name: "Default",
    feel: "Clean and dark: fits any event",
    fonts: { heading: "system-ui", body: "system-ui" },
    radius: 8,
    schemes: [
      { id: "night", name: "Night", kind: "dark", colors: packageColors("default") },
      { id: "daylight", name: "Daylight", kind: "light", colors: c("#f5f6fb", "#ffffff", "#c9cee0", "#141629", "#4a5070", "#00799f", "#ffffff", "#7b4fd8", "#1a7f4b", "#8a6100", "#c2283d") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000", "#111111", "#ffffff", "#ffffff", "#e0e0e0", "#33e1ff", "#000000", "#ffd60a", "#3ee39a", "#ffd60a", "#ff6b7d") },
      { id: "ember", name: "Ember", kind: "accent", colors: { ...packageColors("default"), primary: "#ff9b54", accent: "#ffd166" } },
    ],
  },
  {
    id: "terminal",
    name: "Terminal",
    feel: "Retro screens: square, sharp, glowing",
    fonts: { heading: "Barlow Semi Condensed", body: "Barlow Semi Condensed" },
    radius: 0,
    schemes: [
      { id: "cyan", name: "Cyan", kind: "dark", colors: packageColors("terminal") },
      { id: "phosphor", name: "Phosphor", kind: "accent", colors: c("#121212", "#1b1b1b", "#39ff6a", "#d8f5dc", "#9cc4a4", "#39ff6a", "#121212", "#e8c040", "#39ff6a", "#e8c040", "#ff5a5a") },
      { id: "amber", name: "Amber", kind: "accent", colors: c("#121212", "#1b1b1b", "#ffb000", "#f0e0c0", "#c8b08a", "#ffb000", "#121212", "#00d8d8", "#4ee36a", "#ffb000", "#ff5a5a") },
      { id: "paper", name: "Paper", kind: "light", colors: c("#f4f4ef", "#ffffff", "#1f6f6f", "#141414", "#4a4a4a", "#006b6b", "#ffffff", "#8a5a00", "#1d7a32", "#8a5a00", "#b3261e") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000", "#0a0a0a", "#00ffff", "#ffffff", "#e6e6e6", "#00ffff", "#000000", "#ffff00", "#00ff00", "#ffff00", "#ff6060") },
    ],
  },
  {
    id: "level-up",
    name: "Level up",
    feel: "Warm neon: energetic and rounded",
    fonts: { heading: "Chakra Petch", body: "Exo 2" },
    radius: 14,
    schemes: [
      { id: "sunset", name: "Sunset", kind: "dark", colors: packageColors("level-up") },
      { id: "berry", name: "Neon berry", kind: "accent", colors: { ...packageColors("level-up"), primary: "#ff6fae", accent: "#ffb347" } },
      { id: "daylight", name: "Daylight", kind: "light", colors: c("#fff7f0", "#ffffff", "#e3c3ad", "#2a140b", "#6a4636", "#b84a00", "#ffffff", "#c2185b", "#1d7a4a", "#8a6100", "#c62828") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000", "#120a06", "#ffb070", "#ffffff", "#ffe0cc", "#ffa14d", "#000000", "#ff7fbf", "#4ee39a", "#ffd94a", "#ff6b6b") },
    ],
  },
];

/** Q4: the 14 pairs (heading / body), each SIL OFL on Google Fonts; Part 1 ships the kept ones. */
export const FONT_PAIRS = [
  ["chakra-exo", "Chakra Petch", 700, "Exo 2", 500, "Game night"],
  ["barlow", "Barlow Semi Condensed", 600, "Barlow", 400, "Broadcast"],
  ["space-inter", "Space Grotesk", 700, "Inter", 400, "Modern"],
  ["oswald-source", "Oswald", 600, "Source Sans 3", 400, "Poster"],
  ["rajdhani-nunito", "Rajdhani", 700, "Nunito Sans", 400, "Tech"],
  ["orbitron-exo", "Orbitron", 700, "Exo 2", 400, "Sci-fi"],
  ["pixelify-plex", "Pixelify Sans", 600, "IBM Plex Sans", 400, "Pixel"],
  ["bebas-roboto", "Bebas Neue", 400, "Roboto", 400, "Arena"],
  ["fredoka-nunito", "Fredoka", 600, "Nunito", 400, "Cozy"],
  ["saira", "Saira Condensed", 700, "Saira", 400, "Esports"],
  ["russo-roboto", "Russo One", 400, "Roboto Condensed", 400, "Bold"],
  ["audiowide-titillium", "Audiowide", 400, "Titillium Web", 400, "Synth"],
  ["josefin-lato", "Josefin Sans", 700, "Lato", 400, "Elegant"],
  ["plex-mono", "IBM Plex Mono", 600, "IBM Plex Sans", 400, "Terminal"],
].map(([id, heading, hw, body, bw, mood]) => ({ id, heading, hw, body, bw, mood }));

/** The plate colours of plan D4. */
export const PLATES = { light: "#f7f7f8", dark: "#121317" };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The pairs contracts/theming.md (Brand kit) requires, as "fg on bg ≥ min" failures. */
export function contrastFailures(k) {
  const rules = [
    ["text", "background", 4.5], ["text", "surface", 4.5], ["text_muted", "background", 4.5], ["text_muted", "surface", 4.5],
    ["primary_text", "primary", 4.5], ["primary_text", "status_down", 4.5], ["primary", "background", 3], ["accent", "background", 3],
    ["status_ok", "surface", 3], ["status_degraded", "surface", 3], ["status_down", "surface", 3],
  ];
  return rules.filter(([f, b, min]) => contrast(k[f], k[b]) < min).map(([f, b, min]) => `${f} on ${b} ${contrast(k[f], k[b]).toFixed(2)} < ${min}`);
}

export function checkSchemes() {
  const bad = PRESETS.flatMap((p) => p.schemes.flatMap((s) => contrastFailures(s.colors).map((f) => `${p.id}/${s.id}: ${f}`)));
  if (bad.length) throw new Error(`schemes fail the contrast rules:\n${bad.join("\n")}`);
}
