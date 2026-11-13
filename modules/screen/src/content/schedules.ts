/**
 * `/api/screen/schedules…` (contracts/screen.md, Schedule windows): weekly and agenda-bound
 * windows per zone with a revision (409 `version_conflict` on a stale one), audited; and
 * simulate and the calendar, built from the same read and rule as the tick. Adapted from the legacy signage
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
import type { BreakInterval } from "../playback/break-projection.js";
import type { BreakInput } from "../playback/breaks.js";
import { NEXT_CHANGE_HORIZON_MS, simulate } from "../schedule/simulate.js";
import type { Simulation } from "../schedule/simulate.js";
import { readAssets } from "../assets/reader.js";
import { breakInputFor, loadContent } from "../tick/content.js";
import type { EventContent } from "../tick/content.js";
import { breakGapSeconds, loadZoneState } from "../tick/run.js";
import { EMPTY_ZONE } from "../tick/zone.js";
import type { ZoneState } from "../tick/zone.js";
import { zoneExistsHere } from "../zones.js";
import { calendarRange, readCalendar } from "./calendar.js";
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

/** The windows as `GET /api/screen/schedules` answers them; the window editor reads the same (#267). */
export async function listSchedules(
  c: SqlClient,
  zone?: string,
): Promise<Record<string, unknown>[]> {
  const { rows } =
    zone === undefined
      ? await c.query(`SELECT ${COLUMNS} FROM screen_schedules ORDER BY zone_key, id`)
      : await c.query(`SELECT ${COLUMNS} FROM screen_schedules WHERE zone_key = $1 ORDER BY id`, [
          zone,
        ]);
  return rows.map(scheduleView);
}

export interface ScheduleDeps extends ContentDeps {
  settings: Settings;
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
    async (request) => ({
      schedules: await db.tenant((c) => listSchedules(c, request.query.zone)),
    }),
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

  app.get<{ Querystring: { zone?: string; from?: string; to?: string } }>(
    "/api/screen/schedules/calendar",
    { preHandler: read },
    async (request) => {
      const { zone, from, to } = request.query;
      const range = calendarRange(from, to);
      return db.tenant((c) =>
        readCalendar(c, {
          ...range,
          zone,
          timeZone: tenantOf(request).time_zone,
          revealCrew: request.session?.rights.has("agenda.crew.read") ?? false,
        }),
      );
    },
  );

  app.get<{ Querystring: { zone?: string; at?: string } }>(
    "/api/screen/schedules/simulate",
    { preHandler: read },
    async (request) => {
      const { zone, at } = request.query;
      const atMs = typeof at === "string" ? Date.parse(at) : NaN;
      if (Number.isNaN(atMs)) throw invalidRequest("`at` must be a time (RFC 3339).");
      return simulateZone(deps, tenantOf(request).time_zone, zone, atMs, now());
    },
  );
}

/**
 * "What would play at…" for one zone: the simulate route's answer, which the Studio's schedule
 * page gives too (#267), so the page and the API answer from one read and one rule.
 */
export async function simulateZone(
  deps: Pick<ScheduleDeps, "db" | "settings">,
  timeZone: string,
  zone: string | undefined,
  atMs: number,
  nowMs: number,
): Promise<Simulation> {
  return (await simulateRead(deps, timeZone, zone, atMs, nowMs)).simulation;
}

/** The answer with the read it came from, so the page can say what each region shows then. */
export interface SimulateRead {
  simulation: Simulation;
  content: EventContent;
  state: ZoneState;
  breaks: readonly BreakInterval[];
  breakInput: BreakInput;
}

export async function simulateRead(
  deps: Pick<ScheduleDeps, "db" | "settings">,
  timeZone: string,
  zone: string | undefined,
  atMs: number,
  nowMs: number,
): Promise<SimulateRead> {
  await deps.settings.ensure();
  const gap = breakGapSeconds(deps.settings);
  const [content, state] = await deps.db.tenant(
    async (c) =>
      [
        await loadContent(c, readAssets, nowMs),
        zone === undefined ? EMPTY_ZONE : await loadZoneState(c, zone),
      ] as const,
  );
  const here = content.zones.find((z) => z.key === zone);
  if (zone === undefined || here === undefined) throw unknownZone();
  const breakInput = breakInputFor(content, here.key, timeZone, gap);
  // Breaks follow the zone's stored state forward from now; the past has no projection, and
  // `projectBreaks` stops after its step bound (about two weeks of steps, less with frequent
  // breaks), so `in_break` beyond it is false. Simulate answers the schedule and its breaks:
  // a push plays only from now to its `until`, so it is no part of "what would play at…".
  const breaks =
    atMs < nowMs
      ? []
      : projectBreaks(
          state.breaks,
          breakInput,
          new Date(nowMs),
          new Date(atMs + NEXT_CHANGE_HORIZON_MS),
        );
  const simulation = simulate(
    {
      windows: content.windows,
      timeZone,
      agendaItems: content.agendaItems,
      playlistPriorities: content.playlistPriorities,
      zoneKey: here.key,
      zoneLayoutId: here.layoutId ?? DEFAULT_LAYOUT,
      breaks,
    },
    new Date(atMs),
  );
  return { simulation, content, state, breaks, breakInput };
}
