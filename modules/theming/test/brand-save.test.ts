/**
 * What one `PUT …/draft/brand` makes of the stored theme (recurring finding #843: five merged PRs
 * each lost or replaced a stored field in brand-routes.ts). `saveBrand` is the whole merge, so one
 * table pins it: a save that leaves a field out keeps it exactly as stored, and a save that names
 * it changes only it. A field added to the brand gets a row here.
 */
import { describe, expect, it } from "vitest";
import { saveBrand } from "../src/brand-save.js";
import { generateColors } from "../src/brand.js";
import type { Manifest } from "../src/checks.js";
import { minBoxOpacity } from "../src/contrast.js";
import type { BrandEdit } from "../src/schema.js";
import { fillTokens } from "../src/tokens.js";

/** A scheme's hand-tuned colours (presets.ts): not what generateColors makes of the brand. */
const TUNED = {
  background: "#1d1612",
  surface: "#2a201a",
  border: "#5a4636",
  text: "#fff4e8",
  text_muted: "#d8c2ac",
  primary: "#f0a35e",
  primary_text: "#1d1612",
  accent: "#8fc7a0",
  status_ok: "#86d6a0",
  status_degraded: "#f2c94c",
  status_down: "#ff7a6b",
};

const BACKDROP = {
  looks: ["hearth", "particles"],
  game_art: false,
  daylight: true,
  hype: false,
  image: "images/hall.png",
  video: "videos/backdrop-1.mp4",
};

const STORED: Manifest = {
  schema_version: 1,
  name: "Stored",
  mode: "simple",
  preset: { id: "cozy-lan", scheme: "fireside" },
  images: { logo: "images/logo.png", icon: "images/icon.png", hall: "images/hall.png" },
  tokens: { colors: TUNED, motion_style: { pack: "standard" } },
  brand: {
    primary: "#f0a35e",
    accent: "#8fc7a0",
    scheme: "dark",
    embed_color: "#123456",
    logo_plate: { kind: "light", shape: "circle", padding: "large" },
    font_pair: "fredoka-nunito",
    roundness: "pill",
    backdrop: BACKDROP,
    box_opacity: 0.85,
  },
};

/** What the Make it yours form sends when nothing changed: every choice as stored, no video. */
const SHOWN = Object.fromEntries(Object.entries(BACKDROP).filter(([k]) => k !== "video"));
const SAME = {
  draft_version: 3,
  logo: "images/logo.png",
  icon: "images/icon.png",
  primary: "#f0a35e",
  accent: "#8fc7a0",
  scheme: "dark",
  embed_color: "#123456",
  logo_plate: { kind: "light", shape: "circle", padding: "large" },
  font_pair: "fredoka-nunito",
  roundness: "pill",
  backdrop: SHOWN,
  box_opacity: 0.85,
} as BrandEdit;

const brandOf = (m: Manifest): Record<string, unknown> => m.brand as Record<string, unknown>;
const stored = (): Manifest => structuredClone(STORED);
const withBrand = (over: Record<string, unknown>): Manifest => {
  const m = stored();
  m.brand = { ...brandOf(m), ...over };
  return m;
};

/** Each stored field: the body that names it, and the theme that save must give. */
const NAMED: [string, Record<string, unknown>, () => Manifest][] = [
  [
    "logo_plate",
    { logo_plate: { kind: "dark", shape: "rounded", padding: "small" } },
    () => withBrand({ logo_plate: { kind: "dark", shape: "rounded", padding: "small" } }),
  ],
  ["font_pair", { font_pair: "saira" }, () => withBrand({ font_pair: "saira" })],
  ["roundness", { roundness: "square" }, () => withBrand({ roundness: "square" })],
  ["roundness pill (D12)", { roundness: "pill" }, () => withBrand({ roundness: "pill" })],
  [
    "backdrop looks (D12's hearth and sky)",
    { backdrop: { ...SHOWN, looks: ["sky", "waves"] } },
    () => withBrand({ backdrop: { ...BACKDROP, looks: ["sky", "waves"] } }),
  ],
  [
    // A new picture takes its video with it: the video is that picture's (brand-edit.ts).
    "backdrop image",
    { backdrop: { ...SHOWN, image: "images/other.png" } },
    () => withBrand({ backdrop: { ...SHOWN, image: "images/other.png" } }),
  ],
  [
    "backdrop video",
    { backdrop: { ...BACKDROP, video: "videos/backdrop-2.mp4" } },
    () => withBrand({ backdrop: { ...BACKDROP, video: "videos/backdrop-2.mp4" } }),
  ],
  ["box_opacity", { box_opacity: 0.95 }, () => withBrand({ box_opacity: 0.95 })],
  ["embed_color", { embed_color: "#abcdef" }, () => withBrand({ embed_color: "#abcdef" })],
  [
    // New colours may need more solid boxes: the box opacity rises to what they allow.
    "the colours (primary): the scheme's tuned set gives way to generated ones",
    { primary: "#c0392b" },
    () => {
      const { colors } = generateColors({ primary: "#c0392b", accent: "#8fc7a0", scheme: "dark" });
      const m = withBrand({
        primary: "#c0392b",
        box_opacity: Math.max(0.85, minBoxOpacity(colors)),
      });
      m.tokens = { ...(m.tokens as object), colors };
      return m;
    },
  ],
  [
    "the logo",
    { logo: "images/logo-2.png" },
    () => {
      const m = stored();
      m.images = { ...(m.images as object), logo: "images/logo-2.png" };
      return m;
    },
  ],
];

describe("saveBrand: one save over the stored theme", () => {
  it("keeps every stored field exactly when the body names nothing new", () => {
    const { manifest, raised } = saveBrand(stored(), SAME);
    expect(manifest).toEqual(STORED);
    expect(raised).toBe(false);
  });

  it("keeps every brand choice the body leaves out, the video and the tuned colours too", () => {
    const kit: BrandEdit = {
      draft_version: 3,
      logo: "images/logo.png",
      icon: "images/icon.png",
      primary: "#f0a35e",
      accent: "#8fc7a0",
      scheme: "dark",
    };
    const { manifest } = saveBrand(stored(), kit);
    // The kit form sends no Discord colour: its empty field stands for the primary (brand-edit.ts).
    const kept = Object.fromEntries(
      Object.entries(brandOf(STORED)).filter(([k]) => k !== "embed_color"),
    );
    expect(manifest).toEqual({ ...STORED, brand: kept });
  });

  it.each(NAMED)("changes only %s when the body names it", (_field, body, expected) => {
    expect(saveBrand(stored(), { ...SAME, ...body }).manifest).toEqual(expected());
  });

  it("raises the box opacity against the filled colours, not the stored partial ones", () => {
    const partial = { primary: "#f0a35e" };
    const m = stored();
    m.tokens = { colors: partial };
    const { manifest, raised } = saveBrand(m, { ...SAME, box_opacity: 0.5 });
    const min = minBoxOpacity(fillTokens({ colors: partial }).colors);
    expect(min).toBeGreaterThan(0.5);
    expect(min).toBeLessThan(1);
    expect(raised).toBe(true);
    expect(brandOf(manifest).box_opacity).toBe(min);
    expect(manifest.tokens).toEqual({ colors: partial });
  });

  it("leaves the stored theme it was given as it was", () => {
    const m = stored();
    saveBrand(m, { ...SAME, font_pair: "saira", box_opacity: 0.5 });
    expect(m).toEqual(STORED);
  });
});
