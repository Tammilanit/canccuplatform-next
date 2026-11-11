/**
 * The photo carousel's API (contracts/screen.md, Photos; flag `screen.photos`): images stored as
 * the event's files, listed newest first, each `featured` until the player has featured it once.
 * Ported from the legacy `carousel/photos.ts` (adapted: one photo per request, rights instead of
 * a bearer token, its own table instead of assets on a designated playlist). The `photo` widget
 * that shows them is the player's (#109).
 */
import { rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { Bus, SqlClient, TenantContext } from "@canccu/kit";
import {
  actorOf,
  assertWritable,
  invalidRequest,
  needs,
  newId,
  notFound,
  tenantOf,
} from "./http.js";
import { preparePhoto, readMultipart } from "./assets/upload.js";
import { writeDroppingFiles, writeWithFile } from "./assets/write.js";
import type { AssetDeps, FileDeps } from "./assets/write.js";
import { featuredUntil, photoDwell } from "./compose/photos.js";
import { publishAll } from "./zones.js";
import type { Emit } from "./zones.js";

/** The text fields of `PhotoUpload` and their longest values. */
const FIELDS: Record<string, number> = {
  caption: 200,
  author_name: 80,
  author_user_id: 64,
  posted_at: 64,
  source_ref: 64,
};
/** The form's fields and one file; the app's limits are an asset upload's. */
const LIMITS = { fields: Object.keys(FIELDS).length, parts: Object.keys(FIELDS).length + 1 };

const PHOTO_SELECT = `SELECT id, file, caption, author_name, author_user_id, posted_at, featured,
  created_at FROM screen_photos`;

function photoView(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    url: `/api/screen/files/${row.file as string}`,
    caption: row.caption as string | null,
    author_name: row.author_name as string | null,
    author_user_id: row.author_user_id as string | null,
    posted_at: (row.posted_at as Date).toISOString(),
    featured: row.featured as boolean,
  };
}

function featureOn(ctx: TenantContext): void {
  if (ctx.flags["screen.photos"] !== true) {
    throw new KitError("The photo carousel is off for this event.", {
      status: 403,
      code: "feature_off",
    });
  }
}

const photoExists = (): KitError =>
  new KitError("This photo is already on the carousel.", { status: 409, code: "photo_exists" });

/** The form's text fields: unknown ones refused, empty ones left out. */
function photoField(fields: Record<string, string>, name: string, value: unknown): void {
  const max = FIELDS[name];
  if (max === undefined) throw invalidRequest(`\`${name}\` is not a photo field.`);
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw invalidRequest(`\`${name}\` may be at most ${max} characters.`);
  if (text !== "") fields[name] = text;
}

function postedAt(value: string | undefined): Date {
  const ms = value === undefined ? NaN : Date.parse(value);
  if (Number.isNaN(ms)) throw invalidRequest("`posted_at` must be a date and time.");
  return new Date(ms);
}

const isUniqueViolation = (err: unknown): boolean => (err as { code?: unknown }).code === "23505";

/**
 * Deletes the photos `where` picks in the current tenant with their unused files, and returns
 * `screen.photo.removed` for each, to publish.
 */
async function removePhotos(
  deps: FileDeps,
  where: { sql: string; params: unknown[] },
  actor: string | null,
): Promise<Emit[]> {
  const removed = await writeDroppingFiles(deps, async (c: SqlClient) => {
    const { rows } = await c.query(
      `DELETE FROM screen_photos WHERE ${where.sql} RETURNING id, file`,
      where.params,
    );
    return { result: rows, unused: rows.map((r) => r.file as string), freed: 0 };
  });
  return removed.map((r): Emit => [
    "screen.photo.removed",
    { photo_id: r.id, actor_user_id: actor },
  ]);
}

/**
 * For `tenants.user.deleted`, in the current tenant: the user's photos go, with their files
 * (contracts/tenants.md, Deleting a user). Returns how many went. Nothing calls it on the event
 * yet: the module has no way to list the events that hold a user's photos (RLS shows one tenant
 * at a time), which is the lead's to decide for every module.
 */
export async function deleteUserPhotos(
  deps: FileDeps & { bus: Bus },
  userId: string,
): Promise<number> {
  const emits = await removePhotos(deps, { sql: "author_user_id = $1", params: [userId] }, null);
  await publishAll(deps.bus, emits);
  return emits.length;
}

export function photoRoutes(app: FastifyInstance, deps: AssetDeps & { bus: Bus }): void {
  const read = { preHandler: needs(deps.rights, "screen.content.read") };
  const write = { preHandler: needs(deps.rights, "screen.photos.write") };

  app.get("/api/screen/photos", read, async (request) => {
    featureOn(tenantOf(request));
    const { rows } = await deps.db.tenant((c) =>
      c.query(`${PHOTO_SELECT} ORDER BY created_at DESC, id DESC`),
    );
    await deps.settings.ensure();
    // Featured once its feature on the screens is over: the `photo` widget's own rule.
    const until = featuredUntil(
      rows.map((r) => ({ id: r.id as string, created_at: (r.created_at as Date).getTime() })),
      photoDwell(deps.settings),
    );
    const now = deps.now();
    return {
      photos: rows.map((r) => ({
        ...photoView(r),
        featured: (until.get(r.id as string) ?? 0) > now,
      })),
    };
  });

  app.post("/api/screen/photos", write, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    featureOn(ctx);
    const fields: Record<string, string> = {};
    const file = await readMultipart(
      request,
      deps.filesRoot,
      (name, value) => {
        photoField(fields, name, value);
      },
      LIMITS,
    );
    let posted: Date;
    try {
      posted = postedAt(fields.posted_at);
    } catch (err) {
      await rm(file.temp.path, { force: true });
      throw err;
    }
    const prepared = await preparePhoto(deps.filesRoot, file.temp);
    const id = newId("ph");
    const actor = actorOf(request);
    const photo = await writeWithFile(deps, prepared, async (c, placeFile) => {
      // Checked before the file counts against the quota; the unique index settles a race.
      if (fields.source_ref !== undefined) {
        const { rows } = await c.query("SELECT 1 FROM screen_photos WHERE source_ref = $1", [
          fields.source_ref,
        ]);
        if (rows.length > 0) throw photoExists();
      }
      const name = await placeFile();
      try {
        await c.query(
          `INSERT INTO screen_photos
             (id, file, caption, author_name, author_user_id, posted_at, source_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            name,
            fields.caption ?? null,
            fields.author_name ?? null,
            fields.author_user_id ?? null,
            posted,
            fields.source_ref ?? null,
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw photoExists();
        throw err;
      }
      const { rows } = await c.query(`${PHOTO_SELECT} WHERE id = $1`, [id]);
      return { result: photoView(rows[0] as Record<string, unknown>), unused: [], freed: 0 };
    });
    await publishAll(deps.bus, [["screen.photo.added", { photo_id: id, actor_user_id: actor }]]);
    return reply.status(201).send(photo);
  });

  // Not behind the flag: photos taken down after the carousel is turned off still go.
  app.delete<{ Params: { photo_id: string } }>(
    "/api/screen/photos/:photo_id",
    write,
    async (request, reply) => {
      assertWritable(tenantOf(request));
      const emits = await removePhotos(
        deps,
        { sql: "id = $1", params: [request.params.photo_id] },
        actorOf(request),
      );
      if (emits.length === 0) throw notFound();
      await publishAll(deps.bus, emits);
      return reply.status(204).send();
    },
  );
}
