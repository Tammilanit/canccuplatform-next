/**
 * Push content (contracts/screen.md, Push content): a playlist or an asset played in the zones'
 * `playlist` widgets now, above every schedule window, until `until` or a clear. The tick plays
 * the newest active push of each zone (`tick/run.ts`) and ends the expired ones here.
 */
import type { FastifyInstance } from "fastify";
import type { SqlClient } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { ContentDeps } from "./playlists.js";
import { checkPlayable } from "./playlists.js";
import {
  actorOf,
  assertWritable,
  body,
  needs,
  newId,
  notFound,
  tenantOf,
  unknownZone,
} from "../http.js";
import { publishAll, zoneExistsHere, type Emit } from "../zones.js";
import { checkPushAsset } from "./asset-rules.js";
import { pushInput } from "./input.js";

export interface ActivePush {
  id: string;
  zones: string[];
  playlistId: string | null;
  assetId: string | null;
}

/** The pushes playing at `nowMs`, newest first. */
export async function activePushes(c: SqlClient, nowMs: number): Promise<ActivePush[]> {
  const { rows } = await c.query(
    `SELECT id, zones, playlist_id, asset_id FROM screen_pushes
     WHERE ended_at IS NULL AND until > $1 ORDER BY created_at DESC, id DESC`,
    [new Date(nowMs)],
  );
  return rows.map((r) => ({
    id: r.id as string,
    zones: r.zones as string[],
    playlistId: r.playlist_id as string | null,
    assetId: r.asset_id as string | null,
  }));
}

/**
 * End the open pushes `where` picks, audited and with `screen.content.cleared` to publish after
 * commit. `expired` is the module's own act, so it has no actor.
 */
export async function endPushes(
  c: SqlClient,
  audit: Audit,
  tenantId: string,
  where: { sql: string; params: unknown[] },
  reason: "cleared" | "expired",
  actor: string | null,
  nowMs: number,
): Promise<Emit[]> {
  const at = new Date(nowMs);
  const { rows } = await c.query(
    `UPDATE screen_pushes SET ended_at = $1, end_reason = $2
     WHERE ended_at IS NULL AND ${where.sql} RETURNING id`,
    [at, reason, ...where.params],
  );
  const emits: Emit[] = [];
  for (const { id } of rows as { id: string }[]) {
    await audit({
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "screen.content.cleared",
      target: { type: "push", id },
      changes: { reason: { from: null, to: reason } },
    });
    emits.push(["screen.content.cleared", { push_id: id, reason, actor_user_id: actor }]);
  }
  return emits;
}

/** The tick's part: pushes whose `until` has passed end as `expired`. */
export function expirePushes(c: SqlClient, audit: Audit, tenantId: string, nowMs: number) {
  const where = { sql: "until <= $3", params: [new Date(nowMs)] };
  return endPushes(c, audit, tenantId, where, "expired", null, nowMs);
}

export function pushRoutes(app: FastifyInstance, deps: ContentDeps): void {
  const { db, bus, audit } = deps;
  const now = deps.now ?? Date.now;
  const write = needs(deps.rights, "screen.push.write");

  app.post("/api/screen/push", { preHandler: write }, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const push = pushInput(body(request), now());
    const actor = actorOf(request);
    const id = newId("pu");
    // The contract's `Push`: exactly one of `playlist_id` and `asset_id` is present.
    const view = {
      id,
      zones: push.zones,
      ...(push.playlist_id === null
        ? { asset_id: push.asset_id }
        : { playlist_id: push.playlist_id }),
      until: push.until.toISOString(),
    };
    await db.tenant(async (c) => {
      for (const key of push.zones) if (!(await zoneExistsHere(c, key))) throw unknownZone();
      if (push.playlist_id !== null) await checkPlayable(c, push.playlist_id, "pushed");
      if (push.asset_id !== null) await checkPushAsset(c, push.asset_id);
      await c.query(
        `INSERT INTO screen_pushes (id, zones, playlist_id, asset_id, until, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, push.zones, push.playlist_id, push.asset_id, push.until, actor, new Date(now())],
      );
      await audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.content.pushed",
        target: { type: "push", id },
        changes: { until: { from: null, to: view.until } },
      });
    });
    const { id: pushId, ...data } = view;
    await publishAll(bus, [
      ["screen.content.pushed", { push_id: pushId, ...data, actor_user_id: actor }],
    ]);
    return reply.status(201).send(view);
  });

  app.delete<{ Params: { push_id: string } }>(
    "/api/screen/push/:push_id",
    { preHandler: write },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const at = now();
      const where = {
        sql: "id = $3 AND until > $4",
        params: [request.params.push_id, new Date(at)],
      };
      const emits = await db.tenant((c) =>
        endPushes(c, audit, ctx.tenant_id, where, "cleared", actorOf(request), at),
      );
      if (emits.length === 0) throw notFound();
      await publishAll(bus, emits);
      return reply.status(204).send();
    },
  );
}
