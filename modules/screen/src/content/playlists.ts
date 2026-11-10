/**
 * `/api/screen/playlists…` (contracts/screen.md, Playlists): the whole playlist, items and
 * break settings, as one document with a revision; every write audited in its transaction.
 * Adapted from the legacy signage `playlist-repo.ts`, whose per-field form posts (priority,
 * reorder, ADVT settings) become one `PUT`.
 */
import type { FastifyInstance } from "fastify";
import type { Bus, RightsChecker, SqlClient } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Db } from "../db.js";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  newId,
  notFound,
  tenantOf,
  unknownZone,
  versionConflict,
} from "../http.js";
import { canonical, publishAll, zoneExistsHere, type Emit } from "../zones.js";
import { checkItemAssets } from "./asset-rules.js";
import { endPushes } from "./push.js";
import { playlistInput, type BreakInputSettings, type PlaylistInput } from "./input.js";

export interface ContentDeps {
  db: Db;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  now?: () => number;
}

export interface PlaylistView {
  id: string;
  name: string;
  type: PlaylistInput["type"];
  priority: number;
  slideshow_image_seconds: number | null;
  break: BreakInputSettings | null;
  items: {
    id: string;
    asset_id: string;
    duration_seconds: number | null;
    slide_start: number | null;
    slide_end: number | null;
    slide_seconds: number | null;
  }[];
  revision: number;
}

const COLUMNS = "id, name, type, priority, slideshow_image_seconds, break, revision";
const AUDITED = ["name", "type", "priority", "slideshow_image_seconds", "break"] as const;

/** The event's playlists (or the one `id`), with their items in play order. */
export async function loadPlaylists(c: SqlClient, id?: string): Promise<PlaylistView[]> {
  const filter = id === undefined ? "" : "WHERE id = $1";
  const params = id === undefined ? [] : [id];
  const lists = await c.query(
    `SELECT ${COLUMNS} FROM screen_playlists ${filter} ORDER BY name, id`,
    params,
  );
  const items = await c.query(
    `SELECT playlist_id, id, asset_id, duration_seconds, slide_start, slide_end, slide_seconds
     FROM screen_playlist_items ${id === undefined ? "" : "WHERE playlist_id = $1"} ORDER BY position`,
    params,
  );
  const byPlaylist = new Map<string, PlaylistView["items"]>();
  for (const r of items.rows) {
    const list = byPlaylist.get(r.playlist_id as string) ?? [];
    list.push({
      id: r.id as string,
      asset_id: r.asset_id as string,
      // numeric comes back from pg as a string.
      duration_seconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
      slide_start: r.slide_start as number | null,
      slide_end: r.slide_end as number | null,
      slide_seconds: r.slide_seconds as number | null,
    });
    byPlaylist.set(r.playlist_id as string, list);
  }
  return lists.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as PlaylistView["type"],
    priority: r.priority as number,
    slideshow_image_seconds: r.slideshow_image_seconds as number | null,
    break: r.break as BreakInputSettings | null,
    items: byPlaylist.get(r.id as string) ?? [],
    revision: r.revision as number,
  }));
}

/** A playlist a window or a push may name: one of this event's, and not a break playlist. */
export async function checkPlayable(c: SqlClient, id: string, verb: string): Promise<void> {
  const { rows } = await c.query("SELECT type FROM screen_playlists WHERE id = $1 FOR KEY SHARE", [
    id,
  ]);
  if (rows[0] === undefined) throw invalidRequest("This event has no such playlist.");
  if (rows[0].type === "break") {
    throw invalidRequest(`A break playlist cannot be ${verb}: it interrupts on its own timing.`);
  }
}

async function checkBreakZones(c: SqlClient, playlist: PlaylistInput): Promise<void> {
  for (const key of playlist.break?.zones ?? []) {
    if (!(await zoneExistsHere(c, key))) throw unknownZone();
  }
}

async function writeItems(
  c: SqlClient,
  playlistId: string,
  playlist: PlaylistInput,
  keep: Set<string>,
) {
  await c.query("DELETE FROM screen_playlist_items WHERE playlist_id = $1", [playlistId]);
  const items = playlist.items;
  await c.query(
    `INSERT INTO screen_playlist_items
       (playlist_id, id, position, asset_id, duration_seconds, slide_start, slide_end, slide_seconds)
     SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[], $5::numeric[], $6::int[], $7::int[], $8::int[])`,
    [
      playlistId,
      items.map((i) => (i.id !== null && keep.has(i.id) ? i.id : newId("pi"))),
      items.map((_, position) => position),
      items.map((i) => i.asset_id),
      items.map((i) => i.duration_seconds),
      items.map((i) => i.slide_start),
      items.map((i) => i.slide_end),
      items.map((i) => i.slide_seconds),
    ],
  );
}

type ById = { Params: { playlist_id: string } };

export function playlistRoutes(app: FastifyInstance, deps: ContentDeps): void {
  const { db, audit } = deps;
  const now = deps.now ?? Date.now;
  const read = needs(deps.rights, "screen.content.read");
  const write = needs(deps.rights, "screen.content.write");

  app.get("/api/screen/playlists", { preHandler: read }, async () => ({
    playlists: await db.tenant((c) => loadPlaylists(c)),
  }));

  app.get<ById>("/api/screen/playlists/:playlist_id", { preHandler: read }, async (request) => {
    const [one] = await db.tenant((c) => loadPlaylists(c, request.params.playlist_id));
    if (one === undefined) throw notFound();
    return one;
  });

  app.post("/api/screen/playlists", { preHandler: write }, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const playlist = playlistInput(body(request));
    const actor = actorOf(request);
    const id = newId("pl");
    const made = await db.tenant(async (c) => {
      await checkBreakZones(c, playlist);
      await checkItemAssets(c, playlist);
      await c.query(
        `INSERT INTO screen_playlists (id, name, type, priority, slideshow_image_seconds, break, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          playlist.name,
          playlist.type,
          playlist.priority,
          playlist.slideshow_image_seconds,
          playlist.break,
          actor,
          new Date(now()),
        ],
      );
      await writeItems(c, id, playlist, new Set());
      await audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.playlist.created",
        target: { type: "playlist", id },
      });
      return (await loadPlaylists(c, id))[0];
    });
    return reply.status(201).send(made);
  });

  app.put<ById>("/api/screen/playlists/:playlist_id", { preHandler: write }, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const playlist = playlistInput(body(request));
    if (playlist.revision === undefined) {
      throw invalidRequest("`revision` is required: send the revision you read.");
    }
    const id = request.params.playlist_id;
    const actor = actorOf(request);
    return db.tenant(async (c) => {
      const locked = await c.query(
        "SELECT revision FROM screen_playlists WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (locked.rows[0] === undefined) throw notFound();
      if (locked.rows[0].revision !== playlist.revision) throw versionConflict("playlist");
      const [before] = await loadPlaylists(c, id);
      if (playlist.type === "break") {
        const windows = await c.query(
          "SELECT 1 FROM screen_schedules WHERE playlist_id = $1 LIMIT 1",
          [id],
        );
        if (windows.rows.length > 0) {
          throw invalidRequest(
            "Schedule windows play this playlist; delete them before making it a break playlist.",
          );
        }
        // Pushes never name a break playlist (checkPlayable), so an open one keeps this type.
        const pushes = await c.query(
          "SELECT 1 FROM screen_pushes WHERE playlist_id = $1 AND ended_at IS NULL AND until > $2 LIMIT 1",
          [id, new Date(now())],
        );
        if (pushes.rows.length > 0) {
          throw invalidRequest(
            "This playlist is pushed to screens now; clear the push before making it a break playlist.",
          );
        }
      }
      await checkBreakZones(c, playlist);
      await checkItemAssets(c, playlist);
      await c.query(
        `UPDATE screen_playlists SET name = $2, type = $3, priority = $4, slideshow_image_seconds = $5,
           break = $6, revision = revision + 1, changed_by = $7, changed_at = $8 WHERE id = $1`,
        [
          id,
          playlist.name,
          playlist.type,
          playlist.priority,
          playlist.slideshow_image_seconds,
          playlist.break,
          actor,
          new Date(now()),
        ],
      );
      await writeItems(c, id, playlist, new Set(before?.items.map((i) => i.id)));
      const [after] = await loadPlaylists(c, id);
      if (before === undefined || after === undefined) throw notFound();
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of AUDITED) {
        if (canonical(before[field]) !== canonical(after[field])) {
          changes[field] = { from: before[field], to: after[field] };
        }
      }
      // Kept and new item ids differ on every save; the audit tells content changes only.
      const withoutIds = (v: PlaylistView) =>
        canonical(
          v.items.map((i) => [
            i.asset_id,
            i.duration_seconds,
            i.slide_start,
            i.slide_end,
            i.slide_seconds,
          ]),
        );
      if (withoutIds(before) !== withoutIds(after)) {
        changes.items = { from: before.items.length, to: after.items.length };
      }
      await audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.playlist.changed",
        target: { type: "playlist", id },
        changes,
      });
      return after;
    });
  });

  app.delete<ById>(
    "/api/screen/playlists/:playlist_id",
    { preHandler: write },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const id = request.params.playlist_id;
      const actor = actorOf(request);
      const at = now();
      const emits: Emit[] = await db.tenant(async (c) => {
        const locked = await c.query("SELECT 1 FROM screen_playlists WHERE id = $1 FOR UPDATE", [
          id,
        ]);
        if (locked.rows.length === 0) throw notFound();
        // Its pushes end with it rather than pointing at nothing until they expire.
        const where = { sql: "playlist_id = $3 AND until > $4", params: [id, new Date(at)] };
        const cleared = await endPushes(c, audit, ctx.tenant_id, where, "cleared", actor, at);
        const windows = await c.query("SELECT id FROM screen_schedules WHERE playlist_id = $1", [
          id,
        ]);
        // Its items and windows go with it (ON DELETE CASCADE); each window's delete is audited
        // as if deleted alone, since the audit list names schedule-window deletes.
        await c.query("DELETE FROM screen_playlists WHERE id = $1", [id]);
        for (const { id: windowId } of windows.rows as { id: string }[]) {
          await audit({
            tenant_id: ctx.tenant_id,
            actor_user_id: actor,
            action: "screen.schedule.deleted",
            target: { type: "schedule", id: windowId },
          });
        }
        await audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor,
          action: "screen.playlist.deleted",
          target: { type: "playlist", id },
        });
        return cleared;
      });
      await publishAll(deps.bus, emits);
      return reply.status(204).send();
    },
  );
}
