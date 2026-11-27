/**
 * Issue #823: a save of one brand field through any route that writes `brand` leaves every other
 * brand field as it was (unless the contract says the route moves it). The field list is the
 * contract's, so a field added to theme.schema.json is held by every route here without an edit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "@canccu/ui";
import { PRESETS, presetManifest } from "../src/presets.js";
import { draftFiles, png } from "./drafting.js";
import { DATABASE_URL, send } from "./helpers.js";
import { mp4 } from "./videos.js";

type Brand = Record<string, unknown>;
interface Draft {
  draft_version: number;
  manifest: { brand?: Brand; tokens: Record<string, unknown> };
}

const FIELDS = Object.keys(
  (
    JSON.parse(
      readFileSync(new URL("../../../contracts/theme.schema.json", import.meta.url), "utf8"),
    ) as { $defs: { brand: { properties: Record<string, unknown> } } }
  ).$defs.brand.properties,
).sort();

const STORED_BODY = {
  primary: "#1e1b4b",
  accent: "#f59e0b",
  scheme: "dark",
  logo: "images/logo.png",
  embed_color: "#123456",
  logo_plate: { kind: "light", shape: "circle", padding: "large" },
  font_pair: "space-inter",
  roundness: "round",
  backdrop: {
    looks: ["waves"],
    game_art: false,
    daylight: false,
    hype: false,
    image: "images/hall.png",
  },
};

describe.skipIf(!DATABASE_URL)("a save of one brand field, through every route", () => {
  const t = draftFiles();

  /** A draft whose brand has every field the contract names, the backdrop's video included. */
  async function stored(): Promise<{ version: number; brand: Brand }> {
    const fresh = await t.fresh();
    let v = fresh.draft_version;
    for (const [path, bytes] of [
      ["images/logo.png", await png("#ff0000", 64)],
      ["images/hall.png", await png("#223344", 32)],
      ["images/other.png", await png("#334455", 32)],
      ["videos/loop.mp4", mp4()],
    ] as const) {
      const res = await t.put(path, v, bytes);
      expect(res.statusCode).toBe(200);
      v = res.json<Draft>().draft_version;
    }
    const brand = await send(t.h, "PUT", "/api/theming/draft/brand", {
      ...STORED_BODY,
      draft_version: v,
    });
    expect(brand.statusCode).toBe(200);
    const parts = await send(t.h, "PATCH", "/api/theming/draft/parts", {
      draft_version: brand.json<{ draft: Draft }>().draft.draft_version,
      backdrop_video: "videos/loop.mp4",
    });
    expect(parts.statusCode).toBe(200);
    const draft = parts.json<Draft>();
    expect(Object.keys(draft.manifest.brand ?? {}).sort()).toEqual(FIELDS);
    return { version: draft.draft_version, brand: draft.manifest.brand as Brand };
  }

  const brandOf = (res: { statusCode: number; json: () => unknown }): Brand => {
    expect(res.statusCode).toBe(200);
    const body = res.json() as Draft | { draft: Draft };
    return ("draft" in body ? body.draft : body).manifest.brand ?? {};
  };

  /** Every field of `before` but `changed` stays, and `changed` is `expected`. */
  function expectOnly(after: Brand, before: Brand, changed: string, expected: unknown): void {
    for (const f of FIELDS) {
      if (f === changed) {
        if (expected === undefined) expect(after).not.toHaveProperty(f);
        else expect(after[f]).toEqual(expected);
      } else expect(after[f], f).toEqual(before[f]);
    }
  }

  it("the kit form's body", async () => {
    const { version, brand } = await stored();
    const kit = {
      draft_version: version,
      primary: "#0f766e",
      accent: STORED_BODY.accent,
      scheme: "dark",
      embed_color: "#123456",
    };
    const after = brandOf(await send(t.h, "PUT", "/api/theming/draft/brand", kit));
    expectOnly(after, brand, "primary", "#0f766e");
  });

  it("the Make it yours body, which never names the video", async () => {
    const { version, brand } = await stored();
    const res = await send(t.h, "PUT", "/api/theming/draft/brand", {
      ...STORED_BODY,
      roundness: "soft",
      draft_version: version,
    });
    expectOnly(brandOf(res), brand, "roundness", "soft");
  });

  it("Advanced's colour edit leaves the brand whole", async () => {
    const { version, brand } = await stored();
    const res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version,
      tokens: { colors: { [Object.keys(COLOR_TOKENS)[0] ?? "primary"]: "#ff00ff" } },
    });
    expect(brandOf(res)).toEqual(brand);
  });

  it("Advanced's radius edit takes only the roundness it replaces", async () => {
    const { version, brand } = await stored();
    const res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version,
      tokens: { sizes: { radius: "2px" } },
    });
    expectOnly(brandOf(res), brand, "roundness", undefined);
  });

  it("Advanced's backdrop parts change only the backdrop's part", async () => {
    const { version, brand } = await stored();
    const image = await send(t.h, "PATCH", "/api/theming/draft/parts", {
      draft_version: version,
      backdrop_image: "images/other.png",
    });
    const after = brandOf(image);
    expectOnly(after, brand, "backdrop", {
      ...(brand.backdrop as Brand),
      image: "images/other.png",
    });
    const video = await send(t.h, "PATCH", "/api/theming/draft/parts", {
      draft_version: image.json<Draft>().draft_version,
      backdrop_video: null,
    });
    const rest = Object.fromEntries(
      Object.entries(after.backdrop as Brand).filter(([k]) => k !== "video"),
    );
    expectOnly(brandOf(video), after, "backdrop", rest);
  });

  it("applying a preset keeps the event's plate and Discord colour, and takes the scheme's", async () => {
    const { version, brand } = await stored();
    const scheme = PRESETS.get("default")?.schemes[0];
    const res = await send(t.h, "PUT", "/api/theming/draft/preset", {
      preset: "default",
      scheme: scheme?.id,
      draft_version: version,
    });
    const after = brandOf(res);
    for (const f of ["logo_plate", "embed_color"]) expect(after[f], f).toEqual(brand[f]);
    for (const [f, v] of Object.entries(scheme?.brand ?? {})) expect(after[f], f).toEqual(v);
  });

  it("a preset's own brand fields outlast the scheme's colours", () => {
    const preset = PRESETS.get("default");
    const scheme = preset?.schemes[0];
    if (preset === undefined || scheme === undefined) throw new Error("no default preset");
    const own = { font_pair: "space-inter", roundness: "round", backdrop: { hype: false } };
    const made = presetManifest(
      { ...preset, manifest: { ...preset.manifest, brand: { ...scheme.brand, ...own } } },
      scheme,
      { images: {}, brand: {} },
    );
    expect(made.brand).toMatchObject(own);
  });
});
