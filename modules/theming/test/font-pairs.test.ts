/**
 * The platform's font pairs (plan issue-784 D6): each one freely licensed and whole in the image,
 * served from theming itself, listed for the Studio, and drawn by the token CSS of a theme that
 * names one.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FONTS_DIR, FONT_PAIRS, pairFonts, pairFontFaces } from "../src/font-pairs.js";
import { draftFiles } from "./drafting.js";
import { demoFiles, putPackage } from "./packaging.js";
import { packageZip } from "./zips.js";
import { DATABASE_URL, get, send } from "./helpers.js";

describe("the font pairs in the image", () => {
  const folders = readdirSync(FONTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  it("holds the 14 pairs the PO kept, each one listed", () => {
    expect(folders.map((d) => d.name).sort()).toEqual([...FONT_PAIRS.keys()].sort());
    expect(FONT_PAIRS.size).toBe(14);
  });

  it("gives every pair a pair.json, the SIL Open Font License, and real WOFF2 files", () => {
    for (const { name } of folders) {
      const dir = new URL(`${name}/`, FONTS_DIR);
      const licence = readFileSync(new URL("LICENSE.txt", dir), "utf8");
      expect(licence, name).toContain("SIL OPEN FONT LICENSE");
      const pair = FONT_PAIRS.get(name);
      expect(pair?.name, name).toMatch(/\S/);
      for (const role of ["heading", "body"] as const) {
        const faces = pair?.[role].faces ?? [];
        expect(faces.length, `${name} ${role}`).toBeGreaterThan(0);
        // Each family's own licence text is in the pair's licence file.
        expect(licence, `${name} ${role}`).toContain(pair?.[role].family);
        for (const face of faces) {
          const bytes = readFileSync(new URL(face.file, dir));
          expect(bytes.subarray(0, 4).toString("latin1"), face.file).toBe("wOF2");
        }
      }
    }
  });

  it("gives the token CSS the pair's families and its @font-face rules", () => {
    const pair = FONT_PAIRS.get("space-inter");
    if (pair === undefined) throw new Error("no space-inter");
    expect(pairFonts(pair)).toEqual({
      heading: "Space Grotesk",
      display: "Space Grotesk",
      body: "Inter",
    });
    const faces = pairFontFaces(pair);
    expect(faces).toHaveLength(3);
    expect(faces[0]).toBe(
      '@font-face { font-family: "Space Grotesk"; font-weight: 700; font-display: swap; src: url("/theming/fonts/space-inter/space-grotesk-700.woff2") format("woff2"); }',
    );
  });
});

interface Draft {
  draft_version: number;
  problems: { severity: string; code: string; path?: string }[];
}

describe.skipIf(!DATABASE_URL)("the font pairs over HTTP", () => {
  const t = draftFiles();

  it("serves a pair's file as WOFF2, immutable and not sniffable", async () => {
    const res = await get(t.h, "/theming/fonts/space-inter/inter-400.woff2");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("font/woff2");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.rawPayload.subarray(0, 4).toString("latin1")).toBe("wOF2");
  });

  it("serves no file a pair does not list: not its licence, another folder's, or another pair's", async () => {
    for (const path of [
      "/theming/fonts/space-inter/LICENSE.txt",
      "/theming/fonts/space-inter/pair.json",
      "/theming/fonts/space-inter/barlow-400.woff2",
      "/theming/fonts/no-such-pair/inter-400.woff2",
    ]) {
      expect((await get(t.h, path)).statusCode, path).toBe(404);
    }
    // An encoded `..` never reaches the route: the router refuses the path itself.
    const climb = await get(t.h, "/theming/fonts/space-inter/..%2Fbarlow%2Fbarlow-400.woff2");
    expect([400, 404]).toContain(climb.statusCode);
  });

  it("lists the pairs for the Studio with the address of each face", async () => {
    const res = await get(t.h, "/api/theming/font-pairs", { session: "admin" });
    expect(res.statusCode).toBe(200);
    const { pairs } = res.json<{
      pairs: {
        id: string;
        name: string;
        heading: { family: string; faces: { weight: number; url: string }[] };
      }[];
    }>();
    expect(pairs).toHaveLength(14);
    const space = pairs.find((p) => p.id === "space-inter");
    expect(space?.heading).toEqual({
      family: "Space Grotesk",
      faces: [{ weight: 700, url: "/theming/fonts/space-inter/space-grotesk-700.woff2" }],
    });
  });

  it("warns about a pair this platform does not hold, uses the system font and still publishes", async () => {
    // As an import from a newer platform would bring it.
    const files = await demoFiles("default");
    const yaml = (files["theme.yaml"] ?? Buffer.alloc(0)).toString("utf8");
    files["theme.yaml"] = Buffer.from(
      yaml.replace(/\nbrand:\n/, "\nbrand:\n  font_pair: newer-pair\n"),
    );
    const up = await putPackage(t.h, packageZip(files));
    expect(up.statusCode).toBe(200);
    const draft = up.json<Draft>();
    expect(draft.problems).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "reference_unknown",
        path: "theme.yaml#/brand/font_pair",
      }),
    );
    const res = await send(t.h, "POST", "/api/theming/draft/publish", {
      draft_version: draft.draft_version,
    });
    expect(res.statusCode).toBe(201);
    const current = (await get(t.h, "/api/theming/current")).json<{
      tokens: { fonts: Record<string, string> };
    }>();
    expect(current.tokens.fonts.heading).toBe("system-ui");
  });
});
