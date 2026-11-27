/**
 * What `PUT …/draft/brand` makes of the stored brand and a body (issue #823): every field the
 * contract defines has a rule, and a save never drops a field its body leaves out unless the rule
 * says so. Three reviews found the same loss for a newly added field (#809, #814, #821).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BACKDROP_LEFT_OUT, BRAND_LEFT_OUT, nextBrand } from "../src/brand-edit.js";
import type { Backdrop, Brand } from "../src/brand.js";
import type { BrandEdit } from "../src/schema.js";

const contract = (file: string): string =>
  readFileSync(new URL(`../../../contracts/${file}`, import.meta.url), "utf8");

interface Properties {
  properties: Record<string, unknown>;
}
const schema = JSON.parse(contract("theme.schema.json")) as {
  $defs: { brand: Properties; backdrop: Properties };
};
const openapi = parse(contract("theming.openapi.yaml")) as {
  components: { schemas: { BrandInput: { properties: Record<string, unknown> } } };
};

const keys = (o: object): string[] => Object.keys(o).sort();

/** `o` without the fields `gone`. */
const without = <T extends object>(o: T, ...gone: string[]): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !gone.includes(k))) as Partial<T>;

/** Every field set, so a field added to the brand without a value here does not compile. */
const STORED_BACKDROP: Required<Backdrop> = {
  looks: ["waves"],
  game_art: false,
  daylight: false,
  hype: false,
  image: "images/hall.png",
  video: "videos/backdrop-1.mp4",
};
const STORED: Required<Brand> = {
  primary: "#1e1b4b",
  accent: "#f59e0b",
  scheme: "dark",
  embed_color: "#123456",
  logo_plate: { kind: "light", shape: "circle", padding: "large" },
  font_pair: "space-inter",
  roundness: "round",
  backdrop: STORED_BACKDROP,
};

/** The Theme studio's kit form: the colours, and nothing else of the brand. */
const COLOURS: BrandEdit = {
  draft_version: 1,
  primary: "#0f766e",
  accent: "#e11d48",
  scheme: "light",
};

/** The Make it yours form: the whole backdrop but its video, which Advanced owns. */
const yours = (backdrop: Backdrop): BrandEdit => ({
  ...COLOURS,
  logo_plate: STORED.logo_plate,
  font_pair: STORED.font_pair,
  roundness: STORED.roundness,
  backdrop,
});

describe("nextBrand: the brand a save stores", () => {
  it("has a rule for every brand and backdrop field of theme.schema.json", () => {
    expect(keys(BRAND_LEFT_OUT)).toEqual(keys(schema.$defs.brand.properties));
    expect(keys(BACKDROP_LEFT_OUT)).toEqual(keys(schema.$defs.backdrop.properties));
  });

  it("takes from the body only the brand fields BrandInput names", () => {
    const input = keys(openapi.components.schemas.BrandInput.properties).filter(
      (k) => !["draft_version", "logo", "icon"].includes(k),
    );
    expect(input).toEqual(keys(BRAND_LEFT_OUT));
  });

  it("drops a left-out field only where the contract says so: the embed colour", () => {
    // contracts/theming.md, Brand kit: "a body that leaves a choice out keeps the stored one".
    const dropped = Object.entries(BRAND_LEFT_OUT).filter(([, rule]) => rule === "drop");
    expect(dropped.map(([field]) => field)).toEqual(["embed_color"]);
    const kept = Object.entries(BACKDROP_LEFT_OUT).filter(([, rule]) => rule !== "drop");
    expect(kept.map(([field]) => field)).toEqual(["video"]);
  });

  it("keeps every field a body leaves out, but what its rule drops", () => {
    const next: Record<string, unknown> = { ...nextBrand(STORED, COLOURS) };
    for (const [field, rule] of Object.entries(BRAND_LEFT_OUT)) {
      if (rule === "body") expect(next[field], field).toBe(COLOURS[field as keyof BrandEdit]);
      else if (rule === "keep") expect(next[field], field).toEqual(STORED[field as keyof Brand]);
      else expect(next, field).not.toHaveProperty(field);
    }
  });

  it("takes every field the body names over the stored one", () => {
    const body: BrandEdit = {
      ...COLOURS,
      embed_color: "#abcdef",
      logo_plate: { kind: "dark", shape: "rounded", padding: "small" },
      font_pair: "bebas-source",
      roundness: "square",
      backdrop: { looks: ["glows"] },
    };
    expect(nextBrand(STORED, body)).toEqual(without(body, "draft_version"));
  });

  it("takes a field away that the body sends as null", () => {
    expect(nextBrand(STORED, { ...COLOURS, font_pair: null })).not.toHaveProperty("font_pair");
  });

  it("takes away a stored field the schema does not allow, so the draft can publish", () => {
    const stored = { ...STORED, later: { kept: true } };
    expect(nextBrand(stored, COLOURS)).not.toHaveProperty("later");
  });

  it("starts the brand from the body when none is stored", () => {
    expect(nextBrand(undefined, COLOURS)).toEqual(without(COLOURS, "draft_version"));
  });

  describe("a backdrop the body names", () => {
    const shown = without(STORED_BACKDROP, "video");

    it("replaces the stored one, but what its rule keeps", () => {
      const next = nextBrand(STORED, yours({ ...shown, looks: ["glows"], hype: true }));
      expect(next.backdrop).toEqual({ ...STORED_BACKDROP, looks: ["glows"], hype: true });
    });

    it("keeps the video over the same picture", () => {
      expect(nextBrand(STORED, yours(shown)).backdrop).toEqual(STORED_BACKDROP);
    });

    it("drops the video with a new picture or without one", () => {
      const other = nextBrand(STORED, yours({ ...shown, image: "images/other.png" }));
      expect(other.backdrop).not.toHaveProperty("video");
      const cycle = without(shown, "image");
      expect(nextBrand(STORED, yours(cycle)).backdrop).toEqual(cycle);
    });

    it("takes a video the body names", () => {
      const named = { ...shown, video: "videos/backdrop-2.mp4" };
      expect(nextBrand(STORED, yours(named)).backdrop).toEqual(named);
    });
  });
});
