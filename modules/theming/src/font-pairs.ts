/**
 * The platform's font pairs (plan issue-784 D6): a heading and a body family, each freely licensed
 * (SIL OFL) and held in the image under `fonts/<pair>/` with its licence, so a simple theme gets a
 * real typeface without holding a font of its own. A theme names a pair by id (`brand.font_pair`);
 * the files are platform files, served by theming itself, never package files.
 */
import { readFileSync, readdirSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { notFound } from "./http.js";

export interface Face {
  weight: number;
  file: string;
}

export interface FamilyFaces {
  family: string;
  faces: Face[];
}

export interface FontPair {
  id: string;
  name: string;
  heading: FamilyFaces;
  body: FamilyFaces;
}

export const FONTS_DIR = new URL("../fonts/", import.meta.url);
export const FONTS_PATH = "/theming/fonts/";
const PAIR_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/**
 * A pair's file never changes under its name: a newer cut of a font gets a new file name, so the
 * addresses may be cached for good, as the content-addressed `/theming/a/` ones are.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

function loadPairs(): ReadonlyMap<string, FontPair> {
  const pairs = new Map<string, FontPair>();
  const dirs = readdirSync(FONTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const { name: id } of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!PAIR_ID.test(id)) throw new Error(`font pair folder ${id} is not a pair id`);
    const pair = JSON.parse(readFileSync(new URL(`${id}/pair.json`, FONTS_DIR), "utf8")) as Omit<
      FontPair,
      "id"
    >;
    pairs.set(id, { id, ...pair });
  }
  return pairs;
}

export const FONT_PAIRS = loadPairs();

/** The token families a pair sets: the display font is the heading's, as its default is. */
export function pairFonts(pair: FontPair): { heading: string; display: string; body: string } {
  return { heading: pair.heading.family, display: pair.heading.family, body: pair.body.family };
}

const fileUrl = (pair: FontPair, face: Face): string => `${FONTS_PATH}${pair.id}/${face.file}`;

/** The `@font-face` rules of a pair's faces, for the token CSS (contracts/theming.md, Brand kit). */
export function pairFontFaces(pair: FontPair): string[] {
  return [pair.heading, pair.body].flatMap((f) =>
    f.faces.map(
      (face) =>
        `@font-face { font-family: "${f.family}"; font-weight: ${face.weight}; font-display: swap; src: url("${fileUrl(pair, face)}") format("woff2"); }`,
    ),
  );
}

const listed = (pair: FontPair, f: FamilyFaces) => ({
  family: f.family,
  faces: f.faces.map((face) => ({ weight: face.weight, url: fileUrl(pair, face) })),
});

/** The files a pair lists, by name: only those are served, never its licence or pair.json. */
const servable = new Map(
  [...FONT_PAIRS.values()].map((pair) => [
    pair.id,
    new Set([...pair.heading.faces, ...pair.body.faces].map((face) => face.file)),
  ]),
);

export function fontPairRoutes(app: FastifyInstance): void {
  // Platform data, the same for every event: public like the pages whose token CSS links it.
  app.get("/api/theming/font-pairs", async (_request, reply) => {
    void reply.header("cache-control", "no-cache");
    return {
      pairs: [...FONT_PAIRS.values()].map((pair) => ({
        id: pair.id,
        name: pair.name,
        heading: listed(pair, pair.heading),
        body: listed(pair, pair.body),
      })),
    };
  });

  app.get<{ Params: { pair: string; file: string } }>(
    `${FONTS_PATH}:pair/:file`,
    async (request, reply) => {
      const { pair, file } = request.params;
      if (servable.get(pair)?.has(file) !== true) throw notFound();
      // Headers as routes.ts's sendFile gives the served theme files.
      return reply
        .header("content-type", "font/woff2")
        .header("x-content-type-options", "nosniff")
        .header("cross-origin-resource-policy", "same-origin")
        .header("cache-control", IMMUTABLE)
        .send(readFileSync(new URL(`${pair}/${file}`, FONTS_DIR)));
    },
  );
}
