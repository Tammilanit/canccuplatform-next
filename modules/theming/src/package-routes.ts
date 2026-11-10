/**
 * The whole package (contracts/theming.md, The theme package; Reuse: series and export):
 * `PUT /api/theming/draft/package` replaces the draft's content with a zip's, through the one draft
 * write path; `GET /api/theming/revisions/{revision}/package` writes a revision back as such a zip.
 */
import { isDeepStrictEqual } from "node:util";
import { deflateRawSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { KitError, requireTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { stringify } from "yaml";
import yazl from "yazl";
import type { Audit } from "./audit.js";
import type { Manifest } from "./checks.js";
import type { DraftDeps } from "./draft-routes.js";
import { draftBody, editDraft, newDraftKey, removeDraftPaths } from "./drafts.js";
import { embedHoldings, putEmbed } from "./embeds.js";
import { fileName } from "./files.js";
import {
  WRITE,
  actorOf,
  assertWritable,
  needs,
  notFound,
  positiveInt,
  rawBody,
  versionConflict,
} from "./http.js";
import { checkPackage } from "./package.js";
import type { CheckedPackage } from "./package.js";
import { draftFileNames, setDraftPath } from "./package-files.js";
import { writingFiles } from "./stored.js";
import type { Place, Reserve, Unused } from "./stored.js";
import { MAX_UNPACKED, readPackage } from "./zip.js";

const EMBEDS = "theming.embeds.write";
/** 20 MB unpacked, plus room for the headers of 300 stored files; no body is read past it. */
const BODY_LIMIT = MAX_UNPACKED + 1024 * 1024;
/** The export never compresses a file further than an upload takes back (zip.ts, 100:1). */
const EXPORT_RATIO = 50;
/** A fixed time for every entry, so one revision always exports the same bytes. */
const EPOCH = new Date(Date.UTC(1980, 0, 1));

const refused = (why: string): KitError =>
  new KitError(why, { status: 400, code: "package_refused" });
const tooLarge = (): KitError =>
  new KitError("A package zip is at most 20 MB.", { status: 413, code: "too_large" });

/** An owner's embeds as `publish.ts` compares them: the manifest's part and every stored file. */
interface Embeds {
  manifest: unknown;
  files: string[];
}

async function draftEmbeds(c: SqlClient): Promise<Embeds> {
  const { rows } = await c.query(`SELECT manifest -> 'embeds' AS embeds FROM theming_drafts`);
  return {
    manifest: (rows[0] as { embeds: unknown } | undefined)?.embeds ?? undefined,
    files: await embedHoldings(c, "draft"),
  };
}

function packageEmbeds(pkg: CheckedPackage): Embeds {
  const files: string[] = [];
  for (const [name, embed] of pkg.embeds) {
    for (const [path, f] of embed.files) {
      files.push(`${name}/${path.slice(`embeds/${name}/`.length)}=${fileName(f.bytes, f.ext)}`);
    }
  }
  return { manifest: pkg.manifest.embeds, files: files.sort() };
}

const embedNames = (e: Embeds): string[] => Object.keys(e.manifest ?? {}).sort();

/**
 * Replaces the draft's content with the package's; answers the files the draft held before. The
 * draft's embed rows go only after the theme files are placed, and their files are not reserved
 * again: bytes the event already counts stay counted once (stored.ts), and those the package drops
 * are given back with the rest of `unused`.
 */
async function storePackage(
  c: SqlClient,
  deps: DraftDeps,
  pkg: CheckedPackage,
  place: Place,
  reserve: Reserve,
): Promise<Unused[]> {
  const before = await draftFileNames(c);
  const counted = new Set(before.flatMap((u) => (typeof u === "string" ? [] : [u.name])));
  await removeDraftPaths(c);
  for (const [path, entry] of pkg.paths) {
    await setDraftPath(
      c,
      path,
      "problem" in entry
        ? entry
        : {
            file: await place(entry.bytes, entry.ext),
            bytes: entry.bytes.length,
            refs: entry.refs ?? [],
            warnings: entry.warnings ?? [],
          },
    );
  }
  await c.query(`DELETE FROM theming_embed_files WHERE owner = 'draft'`);
  for (const [name, embed] of pkg.embeds) {
    for (const f of embed.files.values()) {
      if (!counted.has(fileName(f.bytes, f.ext))) await reserve(f.bytes, f.ext);
    }
    const bytes = new Map([...embed.files].map(([path, f]) => [path, f.bytes]));
    await putEmbed(c, deps.files, "draft", name, embed.entry, bytes);
  }
  return before;
}

/** A draft for an upload to fill: at version 0, so the upload's change makes it 1. */
async function startDraft(c: SqlClient, actor: string): Promise<void> {
  const { rows } = await c.query(
    `INSERT INTO theming_drafts (draft_key, draft_version, manifest, updated_by)
     VALUES ($1, 0, '{}', $2) ON CONFLICT DO NOTHING RETURNING 1`,
    [newDraftKey(), actor],
  );
  // A draft exists: the client did not know it, so it must read it first.
  if (rows.length === 0) throw versionConflict("draft");
}

async function exportZip(manifest: Manifest, files: [string, Buffer][]): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const add = (path: string, bytes: Buffer): void => {
    const compress = deflateRawSync(bytes).length * EXPORT_RATIO >= bytes.length;
    zip.addBuffer(bytes, path, { mtime: EPOCH, mode: 0o100644, compress });
  };
  add("theme.yaml", Buffer.from(stringify(manifest, { aliasDuplicateObjects: false })));
  for (const [path, bytes] of files) add(path, bytes);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function packageRoutes(app: FastifyInstance, deps: DraftDeps & { audit: Audit }): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  void app.register((scope, _opts, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", rawBody(BODY_LIMIT, tooLarge));

    scope.put<{ Querystring: { draft_version?: string } }>(
      "/api/theming/draft/package",
      writer,
      async (request) => {
        assertWritable(request);
        const version = positiveInt(request.query.draft_version, "draft_version");
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        // Every check before any lock, as for one file (file-routes.ts).
        const read = await readPackage(body);
        if (!read.ok) throw refused(read.why);
        const checked = await checkPackage(read.files);
        if (!checked.ok) throw refused(checked.why);
        const pkg = checked.pkg;
        const after = packageEmbeds(pkg);
        const differs = (before: Embeds): boolean =>
          !isDeepStrictEqual(before.manifest, after.manifest) ||
          !isDeepStrictEqual(before.files, after.files);
        // Read without locks, so admin is asked before any are taken (as publish does).
        const embedsAllowed = await deps.db.tenant(async (c) => differs(await draftEmbeds(c)));
        if (embedsAllowed) await deps.rights.check(request.headers.cookie, EMBEDS);
        const actor = actorOf(request);
        const row = await writingFiles(deps, async (c, place, reserve) => {
          if (version === undefined) await startDraft(c, actor);
          let unused: Unused[] = [];
          let before: Embeds = { manifest: undefined, files: [] };
          const draft = await editDraft(c, version ?? 0, actor, async () => {
            before = await draftEmbeds(c);
            // The embeds changed between the right check and the lock.
            if (differs(before) && !embedsAllowed) throw versionConflict("draft");
            unused = await storePackage(c, deps, pkg, place, reserve);
            return pkg.manifest;
          });
          if (differs(before)) {
            // Every embed change is audited (contracts/theming.md, Audit); before the commit, so
            // none happens unrecorded.
            await deps.audit({
              tenant_id: requireTenant(),
              actor_user_id: actor,
              action: "theming.draft.embeds_changed",
              target: { type: "theme_draft", id: "draft" },
              changes: { embeds: { old: embedNames(before), new: embedNames(after) } },
            });
          }
          return { result: draft, unused };
        });
        return draftBody(row);
      },
    );
    done();
  });

  app.get<{ Params: { revision: string } }>(
    "/api/theming/revisions/:revision/package",
    writer,
    async (request, reply) => {
      const revision = positiveInt(request.params.revision, "revision") ?? 0;
      const held = await deps.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT manifest FROM theming_revisions WHERE revision = $1`,
          [revision],
        );
        const row = rows[0] as { manifest: Manifest } | undefined;
        if (row === undefined) throw notFound();
        const files = await c.query(
          `SELECT path, file FROM theming_package_files WHERE owner = $1 AND file IS NOT NULL
           UNION ALL SELECT 'embeds/' || embed || '/' || path, file FROM theming_embed_files
            WHERE owner = $1
           ORDER BY 1`,
          [`r:${revision}`],
        );
        return { manifest: row.manifest, files: files.rows as { path: string; file: string }[] };
      });
      const files: [string, Buffer][] = [];
      for (const f of held.files) {
        const bytes = await deps.files.read(f.file);
        // A revision's files stay until no kept revision holds them: one gone is a broken volume.
        if (bytes === undefined) throw new Error(`revision ${revision}: ${f.file} is missing`);
        files.push([f.path, bytes]);
      }
      return reply
        .header("content-type", "application/zip")
        .header("content-disposition", `attachment; filename="theme-${revision}.zip"`)
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .send(await exportZip(held.manifest, files));
    },
  );
}
