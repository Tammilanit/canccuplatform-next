// The Themes pack's data (#785, plan D2, D5, D6): the five new presets with their schemes and
// looks, beside the three existing ones as the theme studio's pack draws them. Every scheme is
// checked against the contrast rules of contracts/theming.md (Brand kit), so a failing proposal
// stops the build instead of reaching the PO.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRESETS as EXISTING, ROOT, contrastFailures } from "../theme-studio/data.mjs";

export { ROOT, contrastFailures };

const K = ["background", "surface", "border", "text", "text_muted", "primary", "primary_text", "accent", "status_ok", "status_degraded", "status_down"];
const c = (s) => Object.fromEntries(s.split(" ").map((hex, i) => [K[i], hex]));
const swap = (k, primary, accent) => ({ ...k, primary, accent });

const ARENA = c("#0a0e17 #131a2a #2c3a57 #f4f7ff #a9b6d3 #00e0ff #0a0e17 #ff3b5c #3ee39a #ffd23f #ff5a6e");
const CABINET = c("#0b0b1a #16163a #3a3a8a #ffffff #c4c4f0 #ffd400 #0b0b1a #ff3df0 #38f27a #ffd400 #ff4d4d");

/** The font pairs the new presets name (modules/theming/fonts/<id>/pair.json holds the faces). */
export function pair(id) {
  const p = JSON.parse(readFileSync(join(ROOT, "modules/theming/fonts", id, "pair.json"), "utf8"));
  return { id, name: p.name, heading: p.heading, body: p.body };
}

/** The five new presets (plan D5 and D6); `css` names the pack's draft of the package CSS (D9). */
export const NEW_PRESETS = [
  {
    id: "esports", name: "Esports", feel: "Bold, angular, high contrast: broadcast style",
    mode: "advanced", pair: "saira", roundness: "square", looks: ["gradient", "glows"], pack: "broadcast", css: "esports.css",
    templates: ["Scoreboard (the leaderboard)", "Lower third (the ticker)"],
    schemes: [
      { id: "arena", name: "Arena", kind: "dark", colors: ARENA },
      { id: "red-side", name: "Red side", kind: "accent", colors: swap(ARENA, "#ff3b5c", "#00e0ff") },
      { id: "gold", name: "Gold", kind: "accent", colors: c("#0b0c10 #17181f #3a3b48 #f7f5ee #b9b6a8 #ffc400 #0b0c10 #5cc8ff #3ee39a #ffd23f #ff5a6e") },
      { id: "studio", name: "Studio", kind: "light", colors: c("#eef1f6 #ffffff #c3cad8 #0d1220 #465068 #0050c8 #ffffff #c8102e #157a46 #8a6100 #c62828") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000 #0d0d0d #ffffff #ffffff #e6e6e6 #00e5ff #000000 #ffd400 #3ee39a #ffd400 #ff6b6b") },
    ],
  },
  {
    id: "synthwave", name: "Synthwave", feel: "Pink and purple neon, a grid to the horizon: the 80s",
    mode: "advanced", pair: "audiowide-titillium", roundness: "soft", looks: ["glows", "gradient"], pack: "standard", css: "synthwave.css",
    templates: [],
    schemes: [
      { id: "sunset", name: "Sunset grid", kind: "dark", colors: c("#120724 #1f0d3a #4a2a7a #fbefff #c9b3e6 #ff4fd8 #120724 #22e4ff #4cf2a7 #ffd166 #ff5c8a") },
      { id: "miami", name: "Night drive", kind: "accent", colors: c("#081226 #0f1f3d #2b4a7a #eef6ff #a9c1e0 #22e4ff #081226 #ff4fd8 #4cf2a7 #ffd166 #ff5c8a") },
      { id: "outrun", name: "Afterglow", kind: "accent", colors: c("#170612 #2a0b22 #5c2550 #fff0f6 #e0b0c8 #ff7a3c #170612 #ff4fd8 #4cf2a7 #ffd166 #ff6b8b") },
      { id: "vapor", name: "Vapor", kind: "light", colors: c("#fbf2ff #ffffff #dcc2f0 #2a0e45 #5e3f80 #b0189a #ffffff #0077a8 #137a4a #8a6100 #c2185b") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000 #0e0618 #ff9ff0 #ffffff #f0e0ff #ff6fe0 #000000 #3ff0ff #4cf2a7 #ffd166 #ff7a9c") },
    ],
  },
  {
    id: "arcade", name: "Arcade", feel: "Pixel type, CRT glow, chunky colours",
    mode: "advanced", pair: "pixelify-plex", roundness: "square", looks: ["particles", "glows"], pack: "arcade", css: "arcade.css",
    templates: ["High-score table (the leaderboard)", "Big digits (the clock)"],
    schemes: [
      { id: "cabinet", name: "Cabinet", kind: "dark", colors: CABINET },
      { id: "player-two", name: "Player two", kind: "accent", colors: swap(CABINET, "#3df0ff", "#ff9a1f") },
      { id: "green-screen", name: "Green screen", kind: "accent", colors: c("#060c06 #0d1a0d #2f5a2f #e8ffe8 #9fd49f #7dff6a #060c06 #ffd400 #7dff6a #ffd400 #ff5c5c") },
      { id: "handheld", name: "Handheld", kind: "light", colors: c("#e8f0d0 #f6fae8 #a8b880 #1f2a10 #4a5a2a #3b5c00 #ffffff #8a1f5c #2e6a10 #7a5a00 #b3261e") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000 #000000 #ffffff #ffffff #ffffff #ffff00 #000000 #00ffff #00ff66 #ffff00 #ff5555") },
    ],
  },
  {
    id: "cozy-lan", name: "Cozy LAN", feel: "Warm, soft, rounded: small or family events",
    mode: "simple", pair: "fredoka-nunito", roundness: "round", looks: ["particles", "glows"], pack: "standard", css: null,
    templates: [],
    schemes: [
      { id: "fireside", name: "Fireside", kind: "dark", colors: c("#1d1612 #2a201a #5a4636 #fff4e8 #d8c2ac #f0a35e #1d1612 #8fc7a0 #86d6a0 #f2c94c #ff7a6b") },
      { id: "meadow", name: "Meadow", kind: "accent", colors: c("#121a15 #1c2720 #3e5646 #f0f8f0 #b8ccbc #8fd19e #121a15 #f0a35e #86d6a0 #f2c94c #ff7a6b") },
      { id: "linen", name: "Linen", kind: "light", colors: c("#faf4ec #fffdf9 #e3d4c0 #3a2a1e #6b5444 #a24f12 #ffffff #2f6b4a #2f6b4a #7a5600 #b3261e") },
      { id: "blossom", name: "Blossom", kind: "light", colors: c("#fbf1f2 #fffafa #ecc9cf #3b2228 #6e4a52 #b03a5b #ffffff #2f6b6b #2f6b4a #7a5600 #b3261e") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#000000 #14100c #ffd9b0 #ffffff #f3e6d8 #ffb36b #000000 #9fe0b4 #86d6a0 #f2c94c #ff8a7a") },
    ],
  },
  {
    id: "daylight", name: "Daylight", feel: "Light and calm: daytime or bright venues",
    mode: "simple", pair: "space-inter", roundness: "soft", looks: ["gradient", "waves"], pack: "standard", css: null,
    templates: [],
    schemes: [
      { id: "morning", name: "Morning", kind: "light", colors: c("#f6f8fb #ffffff #cfd6e2 #111827 #4b5563 #0b63ce #ffffff #b4235a #1a7f4b #8a6100 #c2283d") },
      { id: "sand", name: "Sand", kind: "light", colors: c("#faf6ef #ffffff #e2d6c2 #1f1a12 #5a4e3c #9a4a00 #ffffff #00707a #1a7f4b #8a6100 #c2283d") },
      { id: "mint", name: "Mint", kind: "light", colors: c("#f2faf6 #ffffff #c4ded1 #0f1f18 #435a50 #00745a #ffffff #6a3fc8 #1a7f4b #8a6100 #c2283d") },
      { id: "dusk", name: "Dusk", kind: "dark", colors: c("#141821 #1d2330 #3a4458 #f3f5fa #b0b8c8 #6fb0ff #141821 #ff8fb1 #4ee39a #ffd25e #ff6b6b") },
      { id: "contrast", name: "High contrast", kind: "contrast", colors: c("#ffffff #ffffff #000000 #000000 #1a1a1a #0040a0 #ffffff #a0003a #006b2e #6b4a00 #a00018") },
    ],
  },
];

const existing = (id) => {
  const p = EXISTING.find((x) => x.id === id);
  return { ...p, existing: true, roundness: null, looks: null, pack: id === "terminal" ? "broadcast" : "standard" };
};

/** All eight presets in the gallery's order (plan D2): from neutral to bold. */
export const GALLERY = ["default", "daylight", "cozy-lan", "esports", "level-up", "synthwave", "arcade", "terminal"].map(
  (id) => NEW_PRESETS.find((p) => p.id === id) ?? existing(id),
);

/** The presets' rules the build enforces: 3–5 schemes, one dark and one light, contrast in each. */
export function schemeProblems(presets = NEW_PRESETS) {
  const bad = [];
  for (const p of presets) {
    const kinds = p.schemes.map((s) => s.kind);
    if (p.schemes.length < 3 || p.schemes.length > 5) bad.push(`${p.id}: ${p.schemes.length} schemes`);
    if (!kinds.includes("dark") || !kinds.includes("light")) bad.push(`${p.id}: needs a dark and a light scheme`);
    for (const s of p.schemes) for (const f of contrastFailures(s.colors)) bad.push(`${p.id}/${s.id}: ${f}`);
  }
  return bad;
}

export function checkSchemes() {
  const bad = schemeProblems();
  if (bad.length) throw new Error(`schemes fail the preset rules:\n${bad.join("\n")}`);
  return NEW_PRESETS.reduce((n, p) => n + p.schemes.length, 0);
}
