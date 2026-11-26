/**
 * My presets (contracts/theming.md, Presets; plan issue-784 D18): the draft saved under a name, so
 * the look is reused later, in this event or, through clone, in the next one of its series.
 * `POST /api/theming/presets` saves, `DELETE /api/theming/presets/{id}` deletes, the list and
 * applying are the presets' own paths (preset-routes.ts). A saved preset keeps its files as a
 * revision does, by owner `p:<id>` (migrations/010), so they count against the quota and go only
 * when nothing refers to them.
 */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import { KitError } from "@canccu/kit";
import { isObject } from "./checks.js";
import type { Manifest } from "./checks.js";
import type { DraftDeps } from "./draft-routes.js";
import { copyOwned, loadDraft } from "./drafts.js";
import {
  WRITE,
  actorOf,
  assertWritable,
  invalidRequest,
  needs,
  noDraft,
  notFound,
} from "./http.js";
import { writingFiles } from "./stored.js";
import type { Unused } from "./stored.js";
import { fillTokens } from "./tokens.js";
import type { Colors } from "./brand.js";

/** How a saved preset is named among the presets: the platform's ids hold no colon. */
export const MINE = "event:";
/** Enough for a series' looks; a bound, so a script cannot grow the table without end. */
export const MAX_MINE = 24;
const NAME_MAX = 60;

export interface MyPreset {
  id: string;
  name: string;
  created_at: string;
  embeds: boolean;
  colors: Colors;
}

/** The row number behind `event:<n>`, or undefined for any other id. */
export function mineNumber(id: string): number | undefined {
  const m = /^event:([1-9][0-9]{0,8})$/.exec(id);
  return m === null ? undefined : Number(m[1]);
}

const owner = (n: number): string => `p:${n}`;

// A type, not an interface: query rows cast to it, as they do to the inline row types.
type Row = {
  id: number;
  name: string;
  manifest: Manifest;
  created_at: Date;
};

const toPreset = (r: Row): MyPreset => ({
  id: `${MINE}${r.id}`,
  name: r.name,
  created_at: r.created_at.toISOString(),
  embeds: isObject(r.manifest.embeds) && Object.keys(r.manifest.embeds).length > 0,
  colors: fillTokens(isObject(r.manifest.tokens) ? r.manifest.tokens : {}).colors as Colors,
});

/** The event's saved presets, newest first. */
export async function listMine(c: SqlClient): Promise<MyPreset[]> {
  const { rows } = await c.query(
    `SELECT id, name, manifest, created_at FROM theming_presets ORDER BY id DESC`,
  );
  return (rows as Row[]).map(toPreset);
}

/** A saved preset's manifest and its files by package path, as a package upload reads a zip. */
export async function mineFiles(
  c: SqlClient,
  read: (file: string) => Promise<Buffer | undefined>,
  n: number,
): Promise<{ name: string; manifest: Manifest; files: Map<string, Buffer> } | undefined> {
  const { rows } = await c.query(`SELECT name, manifest FROM theming_presets WHERE id = $1`, [n]);
  const row = rows[0] as { name: string; manifest: Manifest } | undefined;
  if (row === undefined) return undefined;
  const held = await c.query(
    `SELECT path, file FROM theming_package_files WHERE owner = $1 AND file IS NOT NULL
     UNION ALL SELECT 'embeds/' || embed || '/' || path, file FROM theming_embed_files
      WHERE owner = $1`,
    [owner(n)],
  );
  const files = new Map<string, Buffer>();
  for (const f of held.rows as { path: string; file: string }[]) {
    const bytes = await read(f.file);
    // A held file stays until nothing refers to it: one gone is a broken volume.
    if (bytes === undefined) throw new Error(`${owner(n)}: ${f.file} is missing`);
    files.set(f.path, bytes);
  }
  return { name: row.name, manifest: row.manifest, files };
}

function nameOf(body: unknown): string {
  const name = isObject(body) && typeof body.name === "string" ? body.name.trim() : "";
  const extra = isObject(body) ? Object.keys(body).find((k) => k !== "name") : undefined;
  // eslint-disable-next-line no-control-regex
  if (name.length === 0 || name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    throw invalidRequest(`name is the preset's name in words, 1 to ${NAME_MAX} characters.`);
  }
  if (extra !== undefined) throw invalidRequest(`${extra} is not a field of this body.`);
  return name;
}

const tooMany = (): KitError =>
  new KitError(`An event keeps at most ${MAX_MINE} presets. Delete one first.`, {
    status: 409,
    code: "preset_limit",
  });

export function myPresetRoutes(app: FastifyInstance, deps: DraftDeps): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };

  app.post("/api/theming/presets", writer, async (request, reply) => {
    assertWritable(request);
    const name = nameOf(request.body);
    const saved = await deps.db.tenant(async (c) => {
      // The draft's lock: its files cannot go while their references are copied, and two saves
      // count the presets one after the other.
      const draft = await loadDraft(c, true);
      if (draft === undefined) throw noDraft();
      const { rows: count } = await c.query(`SELECT count(*)::int AS n FROM theming_presets`);
      if ((count[0] as { n: number }).n >= MAX_MINE) throw tooMany();
      const { rows } = await c.query(
        `INSERT INTO theming_presets (name, manifest, created_by) VALUES ($1, $2, $3)
         RETURNING id, name, manifest, created_at`,
        [name, draft.manifest, actorOf(request)],
      );
      const row = rows[0] as Row;
      await copyOwned(c, "draft", owner(row.id));
      return toPreset(row);
    });
    return reply.status(201).send(saved);
  });

  app.delete<{ Params: { id: string } }>(
    "/api/theming/presets/:id",
    writer,
    async (request, reply) => {
      assertWritable(request);
      const n = mineNumber(request.params.id);
      if (n === undefined) throw notFound();
      await writingFiles(deps, async (c) => {
        const gone = await c.query(`DELETE FROM theming_presets WHERE id = $1 RETURNING id`, [n]);
        if (gone.rows.length === 0) throw notFound();
        const refs = await c.query(
          `DELETE FROM theming_file_refs WHERE owner = $1 RETURNING file`,
          [owner(n)],
        );
        // An embed's files have no refs: their rows are all that keep them (stored.ts, `Unused`).
        const embeds = await c.query(
          `DELETE FROM theming_embed_files WHERE owner = $1 RETURNING file, bytes`,
          [owner(n)],
        );
        await c.query(`DELETE FROM theming_package_files WHERE owner = $1`, [owner(n)]);
        const unused: Unused[] = [
          ...(refs.rows as { file: string }[]).map((r) => r.file),
          ...(embeds.rows as { file: string; bytes: string }[]).map((r) => ({
            name: r.file,
            bytes: Number(r.bytes),
          })),
        ];
        return { result: undefined, unused };
      });
      return reply.status(204).send();
    },
  );
}
