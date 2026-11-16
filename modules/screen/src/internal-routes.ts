/**
 * What Moments asks Screen (contracts/screen.md, For Moments): a zone's energy and its sound
 * screen for the sound gates (D16, E12, E13), and an asset its library links (D23). Module calls
 * by the service name, so they name the event in `tenant_id` and need the kit's service identity
 * (app.ts installs it for `/internal/screen/`); no Caddy route reaches them.
 */
import type { FastifyInstance } from "fastify";
import { withTenant } from "@canccu/kit";
import type { TenantResolver } from "@canccu/kit";
import { viewAsset } from "./assets/store.js";
import { composeZone } from "./compose/state.js";
import type { ComposeDeps, ZoneComposed } from "./compose/state.js";
import { healthOf } from "./health.js";
import { notFound } from "./http.js";

type Query = { Querystring: { tenant_id?: string } };

/**
 * The sound gates' energy: the zone's scene's quiet mode, or quiet hours while it has none (a
 * scene takes the day's phase's place, D5); else its level, which the scene already set. None
 * moves as calm.
 */
export function energyOf(z: Pick<ZoneComposed, "phase" | "display" | "scene">): string {
  if (z.scene === null ? z.phase === "quiet_hours" : z.scene.quiet) return "quiet";
  const level = z.display.motion_level;
  return level === "party" || level === "lively" ? level : "calm";
}

export function internalRoutes(
  app: FastifyInstance,
  deps: ComposeDeps & { tenants: TenantResolver },
): void {
  const event = async (tenant: string | undefined) => {
    const ctx = tenant === undefined || tenant === "" ? null : await deps.tenants.byId(tenant);
    if (ctx === null) throw notFound();
    return ctx;
  };
  const now = () => (deps.now ?? Date.now)();

  app.get<Query & { Params: { zone_key: string } }>(
    "/internal/screen/zones/:zone_key/sound",
    async (request) => {
      const ctx = await event(request.query.tenant_id);
      return withTenant(ctx.tenant_id, async () => {
        const host = ctx.primary_hostname ?? "localhost";
        const z = await composeZone(deps, ctx, host, request.params.zone_key, undefined, false);
        if (z === null) throw notFound();
        // A scene's sound switch wins over the zone's while it names one (null keeps the zone's).
        const id = (z.scene?.sound ?? z.zone.sound.enabled) ? z.zone.sound.device_id : null;
        if (id === null) return { energy: energyOf(z), device: null };
        const { rows } = await deps.db.tenant((c) =>
          c.query(`SELECT name FROM devices WHERE id = $1`, [id]),
        );
        const health = (await healthOf(deps.kv, [id], now())).get(id) ?? {};
        return {
          energy: energyOf(z),
          device: {
            id,
            name: (rows[0]?.name as string | undefined) ?? id,
            online: health.online === true,
            audio_unlocked:
              typeof health.audio_unlocked === "boolean" ? health.audio_unlocked : null,
          },
        };
      });
    },
  );

  app.get<Query & { Params: { asset_id: string } }>(
    "/internal/screen/assets/:asset_id",
    async (request) => {
      const ctx = await event(request.query.tenant_id);
      return withTenant(ctx.tenant_id, () =>
        deps.db.tenant((c) => viewAsset(c, request.params.asset_id, now())),
      );
    },
  );
}
