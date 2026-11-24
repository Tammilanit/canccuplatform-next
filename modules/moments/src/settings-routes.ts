/** Priorities, rules, history and privacy (contracts/moments.md). */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { Session, SqlClient } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import { CLASSES, checkOrder, rankOf } from "./arbiter.js";
import type { Class, Orders } from "./arbiter.js";
import { forgetUser } from "./consumer.js";
import { airOf, airView, checkAir, mergeAir } from "./air-settings.js";
import type { AirSettings } from "./air-settings.js";
import { invalid } from "./content.js";
import { filterOf, historyCsv, historyRows } from "./history.js";
import { READ, SETTINGS, actorOf, archivedError, tenantOf } from "./http.js";
import type { AppDeps } from "./http.js";
import { RULE_IDS, checkRule, loadRules } from "./rules.js";
import { loadOrders, lockSettings } from "./store.js";
import { reRank } from "./tick.js";

type Body = Record<string, unknown>;

const conflict = () =>
  new KitError("Someone saved meanwhile: read it again.", {
    status: 409,
    code: "version_conflict",
  });

export function prioritiesView(o: Orders & { revision: number; air: AirSettings }): Body {
  return {
    order: o.order,
    zones: Object.entries(o.zones).map(([zone_key, order]) => ({ zone_key, order })),
    ranks: Object.fromEntries(CLASSES.map((c) => [c, rankOf(o.order, c)])),
    airtime: airView(o.air),
    revision: o.revision,
  };
}

/** Saves both orders and ranks every running moment again at once (E8); audited. */
export async function savePriorities(
  c: SqlClient,
  deps: AppDeps,
  tenant: string,
  session: Session | null | undefined,
  body: Body,
): Promise<Body> {
  const order = body.order;
  const zones = body.zones;
  if (!Array.isArray(order) || checkOrder(order) !== null)
    throw invalid(checkOrder(Array.isArray(order) ? order : []) ?? "");
  if (!Array.isArray(zones)) throw invalid("`zones` lists the zones with an order of their own.");
  const own: Record<string, Class[]> = {};
  for (const z of zones as Body[]) {
    if (typeof z.zone_key !== "string" || !/^[a-z0-9_-]{2,32}$/.test(z.zone_key))
      throw invalid("A zone order names its `zone_key`.");
    const why = Array.isArray(z.order)
      ? checkOrder(z.order)
      : "A zone's `order` lists the classes.";
    if (why !== null) throw invalid(`${z.zone_key}: ${why}`);
    own[z.zone_key] = z.order as Class[];
  }
  if (body.airtime !== undefined) {
    const why = checkAir(body.airtime);
    if (why !== null) throw invalid(why);
  }
  await lockSettings(c, "priorities");
  const before = await loadOrders(c);
  if (body.revision !== before.revision) throw conflict();
  const revision = before.revision + 1;
  const stored = mergeAir(before.air, (body.airtime ?? {}) as Body);
  const air = airOf(stored);
  await c.query(
    `INSERT INTO moments_priorities (event_order, zone_orders, revision, airtime)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET event_order = EXCLUDED.event_order,
       zone_orders = EXCLUDED.zone_orders, revision = EXCLUDED.revision,
       airtime = EXCLUDED.airtime`,
    [order, own, revision, stored],
  );
  await reRank(c, deps.engine);
  await deps.audit({
    tenant_id: tenant,
    actor_user_id: actorOf(session).user_id,
    action: "moments.priorities.changed",
    target: { type: "priorities", id: tenant },
    changes: {
      order: { old: before.order, new: order },
      zones: { old: before.zones, new: own },
      airtime: { old: airView(before.air), new: airView(air) },
    },
  });
  return prioritiesView({ order: order as Class[], zones: own, revision, air });
}

/** Saves one rule's settings; audited with the old and new values. */
export async function saveRule(
  c: SqlClient,
  deps: AppDeps,
  tenant: string,
  session: Session | null | undefined,
  id: string,
  body: Body,
): Promise<Body> {
  if (!RULE_IDS.includes(id))
    throw new KitError("No such rule.", { status: 404, code: "not_found" });
  const settings = {
    enabled: body.enabled,
    template: body.template,
    class: body.class,
    regions: body.regions,
    ttl_seconds: body.ttl_seconds,
    zones: body.zones,
    cue: body.cue ?? null,
  };
  const why = checkRule(id, settings);
  if (why !== null) throw invalid(why);
  await c.query(`SELECT 1 FROM moments_rules WHERE rule_id = $1 FOR UPDATE`, [id]);
  const before = (await loadRules(c)).find((r) => r.rule_id === id);
  if (before === undefined || body.revision !== before.revision) throw conflict();
  await c.query(
    `INSERT INTO moments_rules (rule_id, settings, revision) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, rule_id) DO UPDATE SET settings = EXCLUDED.settings,
       revision = EXCLUDED.revision`,
    [id, settings, before.revision + 1],
  );
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const [k, v] of Object.entries(settings)) {
    const old = (before as unknown as Body)[k];
    if (JSON.stringify(old) !== JSON.stringify(v)) changes[k] = { old, new: v };
  }
  await deps.audit({
    tenant_id: tenant,
    actor_user_id: actorOf(session).user_id,
    action: "moments.rule.changed",
    target: { type: "rule", id },
    changes,
  });
  return (await loadRules(c)).find((r) => r.rule_id === id) as unknown as Body;
}

export function settingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: requireRight(deps.rights, READ) };
  const write = { preHandler: requireRight(deps.rights, SETTINGS) };
  const writable = (status: string) => {
    if (status === "archived") throw archivedError();
  };

  app.get("/api/moments/priorities", read, () =>
    deps.db.tenant(async (c) => prioritiesView(await loadOrders(c))),
  );
  app.put("/api/moments/priorities", write, async (request) => {
    const ctx = tenantOf(request);
    writable(ctx.status);
    const out = await deps.db.tenant((c) =>
      savePriorities(c, deps, ctx.tenant_id, request.session, (request.body ?? {}) as Body),
    );
    await deps.outbox.flush();
    return out;
  });

  app.get("/api/moments/rules", read, () =>
    deps.db.tenant(async (c) => ({ rules: await loadRules(c) })),
  );
  app.put<{ Params: { rule_id: string } }>(
    "/api/moments/rules/:rule_id",
    write,
    async (request) => {
      const ctx = tenantOf(request);
      writable(ctx.status);
      return deps.db.tenant((c) =>
        saveRule(
          c,
          deps,
          ctx.tenant_id,
          request.session,
          request.params.rule_id,
          (request.body ?? {}) as Body,
        ),
      );
    },
  );

  app.get<{ Querystring: Record<string, string> }>("/api/moments/history", read, (request) => {
    const q = request.query;
    const filter = filterOf(q);
    const limit = q.limit === undefined ? 100 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw invalid("`limit` is 1 to 500.");
    const before = q.before === undefined ? undefined : Number(q.before);
    if (before !== undefined && !Number.isInteger(before))
      throw invalid("`before` is a row's `seq`.");
    return deps.db.tenant(async (c) => ({ rows: await historyRows(c, filter, limit, before) }));
  });
  app.get<{ Querystring: Record<string, string> }>(
    "/api/moments/history.csv",
    read,
    async (request, reply) => {
      const filter = filterOf(request.query);
      const rows = await deps.db.tenant((c) => historyRows(c, filter, 10_000));
      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="moments-history.csv"')
        .send(historyCsv(rows));
    },
  );

  // Privacy (contracts/README.md): any session, the caller only, in every status of the event.
  const me = async (cookie: string | undefined) => {
    const s = await deps.rights.session(cookie);
    return actorOf(s);
  };
  app.get("/api/moments/me/export", async (request) => {
    const actor = await me(request.headers.cookie);
    return deps.db.tenant(async (c) => ({
      history: await historyRows(c, { actor: actor.user_id }, 10_000),
    }));
  });
  app.delete("/api/moments/me", async (request, reply) => {
    const actor = await me(request.headers.cookie);
    await deps.db.tenant((c) => forgetUser(c, actor.user_id));
    return reply.status(204).send();
  });
}
