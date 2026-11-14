/**
 * `PUT` and `DELETE /api/screen/devices/{device_id}/preview` and `GET /api/screen/previews`
 * (contracts/screen.md, Zones and assignments: Preview on a screen). Starting checks the preview
 * by composing it once, so a layout or a draft key that does not exist is refused here, not drawn
 * as a blank screen.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import { BUILT_IN_LAYOUTS, themeLayouts } from "../compose/layouts.js";
import { composeZone } from "../compose/state.js";
import type { ComposeDeps } from "../compose/state.js";
import { eventDevice } from "../devices.js";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  notFound,
  tenantOf,
} from "../http.js";
import type { Audit } from "../audit.js";
import type { Fanout } from "../push/store.js";
import { checkBoxes, zoneFields, zoneInput } from "../zone-input.js";
import { previewTime } from "./look.js";
import {
  LONGEST_MS,
  announcePreview,
  endPreview,
  previewView,
  runningPreview,
  runningPreviews,
  startPreview,
} from "./store.js";
import type { PreviewZone } from "./store.js";

export interface PreviewDeps extends ComposeDeps {
  rights: RightsChecker;
  audit: Audit;
  fanout: Fanout;
}

type ById = { Params: { device_id: string } };

const KEY = /^[A-Za-z0-9_-]{32,64}$/;
const FIELDS = new Set(["minutes", "zone", "at", "theme_preview_key"]);

interface Input {
  minutes: number | null;
  zone: PreviewZone | null;
  at: number | null;
  themeKey: string | null;
}

function input(value: Record<string, unknown>, nowMs: number): Input {
  const unknown = Object.keys(value).find((k) => !FIELDS.has(k));
  if (unknown !== undefined) throw invalidRequest(`Unknown field \`${unknown}\`.`);
  const minutes = value.minutes;
  if (!(
    minutes === null ||
    (typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 60)
  )) {
    throw invalidRequest("`minutes` must be 1 to 60, or null until it is ended.");
  }
  const key = value.theme_preview_key ?? null;
  if (key !== null && (typeof key !== "string" || !KEY.test(key))) {
    throw invalidRequest("`theme_preview_key` must be a key theming made.");
  }
  const zone: PreviewZone | null = value.zone == null ? null : zoneFields(zoneInput(value.zone));
  return { minutes, zone, at: previewTime(value.at, nowMs), themeKey: key };
}

const hostOf = (request: FastifyRequest): string => request.headers.host ?? "";

const unknownLayout = (): KitError =>
  new KitError("No built-in or theme layout has this id.", { status: 400, code: "unknown_layout" });

export function previewRoutes(app: FastifyInstance, deps: PreviewDeps): void {
  const write = needs(deps.rights, "screen.zones.write");
  const now = (): number => (deps.now ?? Date.now)();

  app.put<ById>(
    "/api/screen/devices/:device_id/preview",
    { preHandler: write },
    async (request) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const nowMs = now();
      const given = input(body(request), nowMs);
      const device = await deps.db.tenant((c) => eventDevice(c, request.params.device_id));
      const zoneKey = device.zone_key ?? null;
      // A mirror shows exactly what its target shows, so only a device with a zone of its own
      // previews; a mirror of it shows the preview with it.
      if (zoneKey === null) throw notFound();
      if (given.zone !== null) {
        if (given.zone.key !== zoneKey) {
          throw invalidRequest("The zone's `key` must be the device's zone.");
        }
        await checkBoxes(deps.sources, ctx.tenant_id, given.zone);
      }
      const composed = await composeZone(
        deps,
        ctx,
        hostOf(request),
        zoneKey,
        given.zone === null ? undefined : { ...given.zone, epoch: "preview" },
        false,
        { at: given.at, themeKey: given.themeKey },
      );
      if (composed === null) throw notFound();
      if (composed.draft === "gone") {
        throw invalidRequest("Theming does not know this `theme_preview_key`.");
      }
      const layout = given.zone?.layout_id ?? null;
      const known = [...BUILT_IN_LAYOUTS, ...themeLayouts(composed.theme.layouts)];
      if (layout !== null && !known.some((l) => l.id === layout)) throw unknownLayout();
      const until = given.minutes === null ? null : new Date(nowMs + given.minutes * 60_000);
      const actor = actorOf(request) ?? "";
      const row = await deps.db.tenant(async (c) => {
        await startPreview(c, {
          deviceId: device.id,
          zoneKey,
          zone: given.zone,
          at: given.at === null ? null : new Date(given.at),
          themeKey: given.themeKey,
          until,
          endsAt: until ?? new Date(nowMs + LONGEST_MS),
          actor,
        });
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor,
          action: "screen.preview.started",
          target: { type: "device", id: device.id },
          changes: {
            zone_key: { from: null, to: zoneKey },
            until: { from: null, to: until?.toISOString() ?? null },
            at: { from: null, to: given.at === null ? null : new Date(given.at).toISOString() },
            theme: { from: null, to: given.themeKey !== null },
            zone_changed: { from: null, to: given.zone !== null },
          },
        });
        return runningPreview(c, device.id, nowMs);
      });
      await announcePreview(deps, device.id);
      if (row === null) throw notFound();
      return previewView(row);
    },
  );

  app.delete<ById>(
    "/api/screen/devices/:device_id/preview",
    { preHandler: write },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const ended = await deps.db.tenant(async (c) => {
        const device = await eventDevice(c, request.params.device_id);
        return endPreview(c, device.id, deps.audit, actorOf(request));
      });
      if (!ended) throw notFound();
      await announcePreview(deps, request.params.device_id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/screen/previews",
    { preHandler: needs(deps.rights, "screen.devices.read") },
    async () => ({
      previews: (await deps.db.tenant((c) => runningPreviews(c, now()))).map(previewView),
    }),
  );
}
