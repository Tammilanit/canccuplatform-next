/**
 * The presets' paths (contracts/theming.md, Presets; plan issue-784 D10, D11):
 * `GET /api/theming/presets` lists them with their schemes, and `PUT /api/theming/draft/preset`
 * applies one to the draft. Reset to the preset is the same call with the draft's own `preset`.
 */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import { stringify } from "yaml";
import type { Audit } from "./audit.js";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import type { DraftDeps } from "./draft-routes.js";
import { draftBody, loadDraft } from "./drafts.js";
import type { FileStore } from "./files.js";
import { WRITE, assertWritable, invalidRequest, needs, notFound } from "./http.js";
import { replaceDraft } from "./package-routes.js";
import { PRESETS, presetFiles, presetManifest, schemeColors } from "./presets.js";
import type { Kept } from "./presets.js";

interface Apply {
  preset: string;
  scheme: string;
  draft_version?: number;
}

function applyError(body: unknown): string | undefined {
  if (!isObject(body)) return "The body must be a JSON object.";
  if (typeof body.preset !== "string") return "preset is required.";
  if (typeof body.scheme !== "string") return "scheme is required.";
  const v = body.draft_version;
  if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 0)) {
    return "draft_version must be a whole number.";
  }
  const extra = Object.keys(body).find((k) => !["preset", "scheme", "draft_version"].includes(k));
  return extra === undefined ? undefined : `${extra} is not a field of this body.`;
}

/**
 * The event's own (D11), with the bytes of its logo and icon to carry over: the draft's, or with
 * no draft the published theme's, since publish removes the draft and the gallery is where the
 * Studio lands.
 */
async function keptOf(
  c: SqlClient,
  files: FileStore,
): Promise<{ kept: Kept; pictures: Map<string, Buffer> }> {
  const kept: Kept = { images: {}, brand: {} };
  const pictures = new Map<string, Buffer>();
  const source = await ownSource(c);
  if (source === undefined) return { kept, pictures };
  const m = source.manifest;
  const brand = isObject(m.brand) ? m.brand : {};
  if (isObject(brand.logo_plate)) kept.brand.logo_plate = brand.logo_plate as never;
  if (typeof brand.embed_color === "string") kept.brand.embed_color = brand.embed_color;
  const images = isObject(m.images) ? m.images : {};
  for (const role of ["logo", "icon"] as const) {
    const path = images[role];
    if (typeof path !== "string") continue;
    const { rows } = await c.query(
      `SELECT file FROM theming_package_files WHERE owner = $1 AND path = $2 AND file IS NOT NULL`,
      [source.owner, path],
    );
    const file = (rows[0] as { file: string } | undefined)?.file;
    const bytes = file === undefined ? undefined : await files.read(file);
    if (bytes === undefined) continue;
    kept.images[role] = path;
    pictures.set(path, bytes);
  }
  return { kept, pictures };
}

/** Whose logo and brand the event has now: the draft, else the current revision, else none. */
async function ownSource(c: SqlClient): Promise<{ owner: string; manifest: Manifest } | undefined> {
  const draft = await loadDraft(c);
  if (draft !== undefined) return { owner: "draft", manifest: draft.manifest };
  const { rows } = await c.query(
    `SELECT revision, manifest FROM theming_revisions ORDER BY revision DESC LIMIT 1`,
  );
  const row = rows[0] as { revision: number; manifest: Manifest } | undefined;
  return row && { owner: `r:${row.revision}`, manifest: row.manifest };
}

export function presetRoutes(app: FastifyInstance, deps: DraftDeps & { audit: Audit }): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  app.get("/api/theming/presets", writer, () => ({
    presets: [...PRESETS.values()].map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.description === undefined ? {} : { description: p.description }),
      embeds: p.embeds,
      schemes: p.schemes.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        brand: s.brand,
        colors: schemeColors(s),
      })),
    })),
  }));

  app.put("/api/theming/draft/preset", writer, async (request) => {
    assertWritable(request);
    const why = applyError(request.body);
    if (why !== undefined) throw invalidRequest(why);
    const input = request.body as Apply;
    const preset = PRESETS.get(input.preset);
    const scheme = preset?.schemes.find((s) => s.id === input.scheme);
    if (preset === undefined || scheme === undefined) throw notFound();
    // Read without a lock: the write checks `draft_version`, so a logo changed meanwhile is a 409.
    const { kept, pictures } = await deps.db.tenant((c) => keptOf(c, deps.files));
    const files = await presetFiles(preset);
    const own = isObject(preset.manifest.images) ? preset.manifest.images : {};
    for (const role of ["logo", "icon"] as const) {
      // The preset's own picture goes when the event's takes its role, so it is not stored unused.
      const theirs = own[role];
      if (kept.images[role] !== undefined && typeof theirs === "string") files.delete(theirs);
    }
    for (const [path, bytes] of pictures) files.set(path, bytes);
    const manifest = presetManifest(preset, scheme, kept);
    files.set("theme.yaml", Buffer.from(stringify(manifest, { aliasDuplicateObjects: false })));
    return draftBody(await replaceDraft(deps, request, files, input.draft_version));
  });
}
