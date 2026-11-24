/** On air's reads (#638): the running moments with their placements, and the scene card. */
import type { FastifyRequest } from "fastify";
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { desiredOverrides } from "./arbiter.js";
import { SCENES_TAKE, tenantOf } from "./http.js";
import type { AppDeps } from "./http.js";
import { PREFIX } from "./page-kit.js";
import type { ZoneName } from "./page-kit.js";
import { loadCrew, loadScenes, sceneZones } from "./scene-store.js";
import { crewButtons, onAirScenes } from "./scene-views.js";
import type { ZoneSceneView } from "./scene-views.js";
import { knownZones, loadOrders, runningMoments, titleOf } from "./store.js";
import type { MomentView } from "./views.js";
import { zoneQueues } from "./queue-data.js";
import type { ZoneQueue } from "./queue-data.js";

export async function onAir(
  deps: AppDeps,
): Promise<{ moments: MomentView[]; zones: string[]; queues: ZoneQueue[] }> {
  return deps.db.tenant(async (c) => {
    const running = await runningMoments(c);
    const orders = await loadOrders(c);
    const { rows } = await c.query(
      `SELECT moment_id, zone_key, state, role FROM moment_placements WHERE moment_id = ANY($1::text[])`,
      [running.map((m) => m.id)],
    );
    const moments = running
      .map((m) => ({
        id: m.id,
        class: m.class,
        rank: desiredOverrides(m, orders, [], [])[0]?.rank ?? 0,
        template: m.template,
        title: titleOf(m),
        origin: m.origin,
        who:
          m.origin === "rule"
            ? `rule ${m.rule_id ?? ""}`
            : m.origin === "module"
              ? m.source.module
              : (m.actor_name ?? "the crew"),
        zones: m.zones,
        left: m.left_zones,
        expires_at: m.expires_at?.toISOString() ?? null,
        starts_at: m.starts_at.toISOString(),
        patience_seconds: m.patience_seconds,
        placements: rows
          .filter((p) => p.moment_id === m.id)
          .map((p) => ({
            zone_key: p.zone_key as string,
            state: p.state as string,
            role: p.role as string | null,
          })),
      }))
      .sort((a, b) => b.rank - a.rank);
    // Screen's order, by key as the Studio lists them (amendment 3): a zone never moves on the page.
    const zones = (await knownZones(c)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { moments, zones, queues: await zoneQueues(c, deps.now()) };
  });
}

/** On air's scene card: each zone's scene, and the crew buttons for those who may press them. */
export async function sceneCard(
  deps: AppDeps,
  request: FastifyRequest,
  zoneName: ZoneName,
): Promise<Html> {
  const ctx = tenantOf(request);
  const now = deps.now();
  const s = await deps.db.tenant(async (c) => ({
    scenes: (await loadScenes(c)).scenes,
    zones: (await sceneZones(c)) as unknown as ZoneSceneView[],
    crew: await loadCrew(c),
  }));
  const crew = s.crew !== null && s.crew.until > now ? s.crew : null;
  const canTake = request.session?.rights.has(SCENES_TAKE) === true && ctx.status !== "archived";
  return html`${onAirScenes(s.zones, s.scenes, ctx.time_zone, zoneName)}
    ${canTake ? crewButtons(s.scenes, crew === null ? null : { ...crew, until: crew.until.toISOString() }, "on-air") : ""}
    <a class="canccu-small" href="${PREFIX}scenes">All scenes</a>`;
}
