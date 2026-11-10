/**
 * `/api/screen/schedules…` (contracts/screen.md, Schedule windows): weekly and agenda-bound
 * windows per zone with a revision (409 `version_conflict` on a stale one), audited; and
 * simulate, built from the same read and rule as the tick. Adapted from the legacy signage
 * `schedule-repo.ts` (one day per window there; ISO `days` here).
 */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import type { Settings } from "../health.js";
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
import { projectBreaks } from "../playback/break-projection.js";
import { NEXT_CHANGE_HORIZON_MS, simulate } from "../schedule/simulate.js";
import { breakInputFor, loadContent, noAssets, type AssetReader } from "../tick/content.js";
import { breakGapSeconds, loadZoneState } from "../tick/run.js";
import { EMPTY_ZONE } from "../tick/zone.js";
import { zoneExistsHere } from "../zones.js";
import { scheduleInput, type ScheduleInput } from "./input.js";
import { checkPlayable, type ContentDeps } from "./playlists.js";

/** The built-in layout a zone without its own shows (contracts/screen.md, Which layout). */
const DEFAULT_LAYOUT = "pulse";
const COLUMNS =
  "id, zone_key, playlist_id, priority, layout_id, days, start_minute, end_minute, agenda_item_id, revision, changed_by, changed_at";
const AUDITED = [
  "zone_key",
  "playlist_id",
  "priority",
  "layout_id",
  "days",
  "start_minute",
  "end_minute",
  "agenda_item_id",
] as const;

/** The contract's `Schedule`: a bound window carries no weekly fields at all (its `oneOf`). */
function scheduleView(r: Record<string, unknown>): Record<string, unknown> {
  const weekly =
    r.agenda_item_id === null
      ? { days: r.days, start_minute: r.start_minute, end_minute: r.end_minute }
      : {};
  return {
    id: r.id,
    zone_key: r.zone_key,
    playlist_id: r.playlist_id,
    priority: r.priority,
    layout_id: r.layout_id,
    ...weekly,
    agenda_item_id: r.agenda_item_id,
    revision: r.revision,
    changed_by: r.changed_by,
    changed_at: (r.changed_at as Date).toISOString(),
  };
}

async function checkRefs(c: SqlClient, window: ScheduleInput): Promise<void> {
  if (!(await zoneExistsHere(c, window.zone_key))) throw unknownZone();
  await checkPlayable(c, window.playlist_id, "scheduled");
}

function values(window: ScheduleInput) {
  return [
    window.zone_key,
    window.playlist_id,
    window.priority,
    window.layout_id,
    window.days,
    window.start_minute,
    window.end_minute,
    window.agenda_item_id,
  ];
}

export interface ScheduleDeps extends ContentDeps {
  settings: Settings;
  assets?: AssetReader;
}

type ById = { Params: { schedule_id: string } };

export function scheduleRoutes(app: FastifyInstance, deps: ScheduleDeps): void {
  const { db, audit } = deps;
  const now = deps.now ?? Date.now;
  const read = needs(deps.rights, "screen.content.read");
  const write = needs(deps.rights, "screen.content.write");

  app.get<{ Querystring: { zone?: string } }>(
    "/api/screen/schedules",
    { preHandler: read },
    async (request) => {
      const zone = request.query.zone;
      const rows = await db.tenant(async (c) =>
        zone === undefined
          ? (await c.query(`SELECT ${COLUMNS} FROM screen_schedules ORDER BY zone_key, id`)).rows
          : (
              await c.query(
                `SELECT ${COLUMNS} FROM screen_schedules WHERE zone_key = $1 ORDER BY id`,
                [zone],
              )
            ).rows,
      );
      return { schedules: rows.map(scheduleView) };
    },
  );

  app.post("/api/screen/schedules", { preHandler: write }, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const window = scheduleInput(body(request));
    const actor = actorOf(request);
    const id = newId("sc");
    const row = await db.tenant(async (c) => {
      await checkRefs(c, window);
      const { rows } = await c.query(
        `INSERT INTO screen_schedules (id, zone_key, playlist_id, priority, layout_id, days, start_minute,
           end_minute, agenda_item_id, changed_by, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
        [id, ...values(window), actor, new Date(now())],
      );
      await audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.schedule.created",
        target: { type: "schedule", id },
      });
      return rows[0] ?? {};
    });
    return reply.status(201).send(scheduleView(row));
  });

  app.put<ById>("/api/screen/schedules/:schedule_id", { preHandler: write }, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const window = scheduleInput(body(request));
    if (window.revision === undefined)
      throw invalidRequest("`revision` is required: send the revision you read.");
    const id = request.params.schedule_id;
    const actor = actorOf(request);
    const row = await db.tenant(async (c) => {
      const locked = await c.query(
        `SELECT ${COLUMNS} FROM screen_schedules WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const before = locked.rows[0];
      if (before === undefined) throw notFound();
      if (before.revision !== window.revision) throw versionConflict("window");
      await checkRefs(c, window);
      const { rows } = await c.query(
        `UPDATE screen_schedules SET zone_key = $2, playlist_id = $3, priority = $4, layout_id = $5, days = $6,
           start_minute = $7, end_minute = $8, agenda_item_id = $9, revision = revision + 1,
           changed_by = $10, changed_at = $11
         WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, ...values(window), actor, new Date(now())],
      );
      const after = rows[0] ?? {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of AUDITED) {
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
          changes[field] = { from: before[field], to: after[field] };
        }
      }
      await audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.schedule.changed",
        target: { type: "schedule", id },
        changes,
      });
      return after;
    });
    return scheduleView(row);
  });

  app.delete<ById & { Querystring: { revision?: string } }>(
    "/api/screen/schedules/:schedule_id",
    { preHandler: write },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const raw = request.query.revision;
      if (raw !== undefined && !/^[1-9][0-9]{0,9}$/.test(raw))
        throw invalidRequest("`revision` must be the revision read.");
      const id = request.params.schedule_id;
      await db.tenant(async (c) => {
        const locked = await c.query(
          "SELECT revision FROM screen_schedules WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (locked.rows[0] === undefined) throw notFound();
        if (raw !== undefined && locked.rows[0].revision !== Number(raw))
          throw versionConflict("window");
        await c.query("DELETE FROM screen_schedules WHERE id = $1", [id]);
        await audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actorOf(request),
          action: "screen.schedule.deleted",
          target: { type: "schedule", id },
        });
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { zone?: string; at?: string } }>(
    "/api/screen/schedules/simulate",
    { preHandler: read },
    async (request) => {
      const ctx = tenantOf(request);
      const { zone, at } = request.query;
      const atMs = typeof at === "string" ? Date.parse(at) : NaN;
      if (Number.isNaN(atMs)) throw invalidRequest("`at` must be a time (RFC 3339).");
      const nowMs = now();
      await deps.settings.ensure();
      const gap = breakGapSeconds(deps.settings);
      const [content, state] = await db.tenant(
        async (c) =>
          [
            await loadContent(c, deps.assets ?? noAssets, nowMs),
            zone === undefined ? EMPTY_ZONE : await loadZoneState(c, zone),
          ] as const,
      );
      const here = content.zones.find((z) => z.key === zone);
      if (zone === undefined || here === undefined) throw unknownZone();
      const breakInput = breakInputFor(content, here.key, ctx.time_zone, gap);
      // Breaks follow the zone's stored state forward from now; the past has no projection.
      const breaks =
        atMs < nowMs
          ? []
          : projectBreaks(
              state.breaks,
              breakInput,
              new Date(nowMs),
              new Date(atMs + NEXT_CHANGE_HORIZON_MS),
            );
      return simulate(
        {
          windows: content.windows,
          timeZone: ctx.time_zone,
          agendaItems: content.agendaItems,
          playlistPriorities: content.playlistPriorities,
          zoneKey: here.key,
          zoneLayoutId: here.layoutId ?? DEFAULT_LAYOUT,
          breaks,
        },
        new Date(atMs),
      );
    },
  );
}
