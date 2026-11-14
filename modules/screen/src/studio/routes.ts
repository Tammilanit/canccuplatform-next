/**
 * The Screen studio's pages under `/admin/screen/` (step 3 plan U5–U8, U11; contracts/screen.md:
 * the kiosk's pairing QR opens `/admin/screen/devices#pair=<code>`), in the organiser shell. The
 * pages only read; every change goes through the JSON API from static/studio.js, which checks the
 * right again and audits, so a page holds no right the API does not check itself.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError, MissingRight, NotSignedIn } from "@canccu/kit";
import type { Logger, PublicEvent, RightsChecker } from "@canccu/kit";
import { errorTitle, errorView, html } from "@canccu/ui";
import type { Sources } from "../compose/sources.js";
import type { Db } from "../db.js";
import { listDevices } from "../devices.js";
import type { Settings } from "../health.js";
import { notFound, tenantOf } from "../http.js";
import type { Kv } from "../kv.js";
import type { BundleStore } from "../pins/bundles.js";
import { PIN_READ_RIGHTS, inEffect } from "../pins/routes.js";
import { readPin } from "../pins/store.js";
import type { ZoneStore } from "../push/store.js";
import { tickerNow } from "../ticker/store.js";
import { readZones } from "../zones.js";
import type { Bus } from "@canccu/kit";
import { shownZone } from "./help.js";
import type { SeenDevice } from "./help.js";
import { devicesActions, devicesView } from "./devices-view.js";
import { layoutsOf } from "./event-layouts.js";
import { pinsView } from "./pins-view.js";
import { param, readContent } from "./content-data.js";
import { readPlaylists } from "./playlists-data.js";
import { contentPage } from "./playlists-view.js";
import { STATIC_TYPES, staticFile } from "./static-files.js";
import type { ContentDeps } from "./content-data.js";
import { WRITE } from "./schedule-editor.js";
import { schedulePage } from "./schedule-page.js";
import type { ScheduleQuery } from "./schedule-page.js";
import { tickerView } from "./ticker-view.js";
import { motionCard } from "./motion-view.js";
import { heldSettings, readMotion } from "../motion-routes.js";
import { quickActions, runningNow } from "./live-quick.js";
import { STUDIO, liveActions, liveView, startUrlOf } from "./views.js";
import type { ViewContext } from "./views.js";
import { zoneEditorView, zonesView } from "./zone-views.js";
import {
  ANY_TAB,
  CHANGE_RIGHTS,
  CONTENT,
  READ,
  SIGN_IN,
  TABS,
  TICKER,
  ZONES,
  archived,
  eventOf,
  holds,
  pageNeeds,
  studioPage,
  translate,
} from "./page.js";
import type { PageOptions } from "./page.js";

export interface StudioDeps extends Omit<ContentDeps, "now"> {
  db: Db;
  bus: Bus;
  kv: Kv;
  zones: ZoneStore;
  rights: RightsChecker;
  /** Admin's own settings, which hold the event's `language` (contracts/admin.md, #394). */
  adminSettings: Settings;
  sources: Sources;
  bundles: BundleStore;
  /** The module's own settings: simulate's break gap, for "what plays at…". */
  settings: Settings;
  log?: Logger | undefined;
  /** Names the event in the shell's header; without it the header shows what the tenant says. */
  publicEvent?: ((host: string | undefined) => Promise<PublicEvent | null>) | undefined;
  now?: () => number;
}

export function studioRoutes(app: FastifyInstance, deps: StudioDeps): void {
  const now = deps.now ?? Date.now;
  void app.register((studio, _opts, done) => {
    // Pages answer pages: a browser without a session goes to sign in, a refusal is said in words.
    studio.setErrorHandler(async (err: FastifyError, request, reply) => {
      if (err instanceof NotSignedIn) {
        return reply.redirect(`${SIGN_IN}?next=${encodeURIComponent(request.url)}`, 303);
      }
      const session = request.session;
      if (err instanceof MissingRight && session?.rights.size === 0 && !session.superadmin) {
        return reply.redirect(SIGN_IN, 303); // admin's "No role yet" says what to do (sheet 3)
      }
      // Right ids and the module's words for a refused page go to the log, not the page (B3).
      const known = err instanceof KitError;
      if (known) deps.log?.info({ code: err.code, msg: err.message }, "a Studio page was refused");
      else deps.log?.error({ err }, "a Studio page failed");
      const pageErr = known
        ? { status: err.status, code: err.code, message: err.message }
        : { status: 500, code: "internal", message: "" };
      const t = await translate(deps);
      const event = await eventOf(request, deps).catch(() => undefined);
      return studioPage(request, reply, deps, t, {
        title: errorTitle(pageErr),
        body: errorView(pageErr, {
          session: request.session ?? undefined,
          page: t("studio.page"),
          event: event?.name,
          retry: request.url,
          back: { href: STUDIO, label: t("studio.back") },
        }),
        status: pageErr.status,
        plain: true,
      });
    });

    const context = async (request: FastifyRequest): Promise<ViewContext> => ({
      t: await translate(deps),
      rights: new Set(
        [...(request.session?.rights ?? [])].filter(
          (r) => !archived(request) || !CHANGE_RIGHTS.has(r),
        ),
      ),
      nowMs: now(),
      timeZone: tenantOf(request).time_zone,
      // The tenant's own address, never the request's Host (contracts/tenants.md, 0013 item 10):
      // an organiser on an alias would otherwise send kiosks to a hostname that may be retired.
      startUrl: startUrlOf(tenantOf(request).primary_hostname),
    });
    const devices = async () => (await listDevices(deps)) as unknown as SeenDevice[];
    const page = (request: FastifyRequest, reply: FastifyReply, c: ViewContext, o: PageOptions) =>
      studioPage(request, reply, deps, c.t, { ...o, title: o.title || c.t("studio.title") });

    // Home (U5): Live while the event runs, Zones before it, or the first tab this person has.
    studio.get(STUDIO, { preHandler: pageNeeds(deps.rights, ANY_TAB) }, async (request, reply) => {
      const rights = request.session?.rights ?? new Set<string>();
      const order = tenantOf(request).status === "live" ? TABS : [TABS[2], ...TABS];
      const first = order.find((tab) => tab !== undefined && holds(rights, tab[2]));
      return reply.redirect(`${STUDIO}${first?.[0] ?? "live"}`, 303);
    });

    studio.get(
      `${STUDIO}live`,
      { preHandler: pageNeeds(deps.rights, [READ]) },
      async (request, reply) => {
        const c = await context(request);
        const ctx = tenantOf(request);
        // A run of show that cannot be read (null) leaves Delay pointing at the run of show itself.
        const [zones, all, items] = await Promise.all([
          readZones(deps, ctx),
          devices(),
          c.rights.has("agenda.items.write") ? deps.sources.agendaItems(ctx.tenant_id) : null,
        ]);
        return page(request, reply, c, {
          title: "",
          tab: "live",
          description: c.t("live.desc"),
          actions: liveActions(c),
          body: html`${liveView(c, zones, all)}${quickActions(c, runningNow(items, c.nowMs))}`,
        });
      },
    );

    studio.get(
      `${STUDIO}devices`,
      { preHandler: pageNeeds(deps.rights, [READ]) },
      async (request, reply) => {
        const c = await context(request);
        const [zones, all] = [await readZones(deps, tenantOf(request)), await devices()];
        // What each card shows now comes from its zone's composed state, as its screens draw it.
        const keys = [...new Set(all.flatMap((d) => shownZone(d, all) ?? []))];
        const states = new Map(
          await Promise.all(keys.map(async (k) => [k, await deps.zones.read(k)] as const)),
        );
        return page(request, reply, c, {
          title: "",
          tab: "devices",
          description: c.t("devices.desc"),
          actions: devicesActions(c),
          body: devicesView(c, zones, all, states),
        });
      },
    );

    studio.get(
      `${STUDIO}zones`,
      { preHandler: pageNeeds(deps.rights, [ZONES]) },
      async (request, reply) => {
        const c = await context(request);
        const ctx = tenantOf(request);
        const [zones, all] = [await readZones(deps, ctx), await devices()];
        // Admin down with nothing held fails only the card's values: it draws the defaults, and a
        // save from it meets admin's version check.
        const held = await heldSettings(deps.settings).catch((err: unknown) => {
          request.log.warn({ err }, "reading the screen settings for the Motion card failed");
          return { settings_version: 0, values: {} };
        });
        const motion = await readMotion(deps, ctx.tenant_id, held);
        return page(request, reply, c, {
          title: "",
          tab: "zones",
          description: c.t("zones.desc"),
          body: html`${zonesView(c, zones, all)}${motionCard(c, motion)}`,
          own: "studio-motion",
        });
      },
    );

    studio.get<{ Params: { zone_key: string }; Querystring: { layout?: string } }>(
      `${STUDIO}zones/:zone_key`,
      { preHandler: pageNeeds(deps.rights, [ZONES]) },
      async (request, reply) => {
        const c = await context(request);
        const ctx = tenantOf(request);
        const zones = await readZones(deps, ctx);
        const zone = zones.find((z) => z.key === request.params.zone_key);
        if (zone === undefined) throw notFound();
        const [layouts, all] = [await layoutsOf(deps.sources, ctx.tenant_id), await devices()];
        // The gallery's pick, drawn unsaved; the zone's own (`null`: `pulse`) or an unknown id is none.
        const asked = layouts.find((l) => l.id === request.query.layout)?.id;
        const layoutId =
          asked === (zone.layout_id ?? "pulse") ? zone.layout_id : (asked ?? zone.layout_id);
        return page(request, reply, c, {
          title: zone.name,
          crumb: { href: `${STUDIO}zones`, label: c.t("zone.back") },
          body: zoneEditorView(c, zone, layouts, all, zones, layoutId),
          own: "studio-zone",
          module: true,
        });
      },
    );

    studio.get<{ Querystring: ScheduleQuery }>(
      `${STUDIO}schedule`,
      { preHandler: pageNeeds(deps.rights, [CONTENT]) },
      async (request, reply) => {
        const c = await context(request);
        const ctx = tenantOf(request);
        const [zones, all] = [await readZones(deps, ctx), await devices()];
        const event = await eventOf(request, deps);
        const query = request.query;
        const view = await schedulePage(deps, ctx.tenant_id, c, event, zones, all, query);
        const o = { title: "", tab: "schedule", description: c.t("schedule.desc") };
        const own = { own: "studio-schedule", module: true, script: c.rights.has(WRITE) };
        return page(request, reply, c, { ...o, ...own, ...view });
      },
    );

    studio.get(
      `${STUDIO}content`,
      { preHandler: pageNeeds(deps.rights, [CONTENT]) },
      async (request, reply) => {
        const c = await context(request);
        const ctx = tenantOf(request);
        const data = await readContent({ ...deps, now }, ctx, c.rights, request.query);
        const lists = await readPlaylists(deps.db, c.nowMs, param(request.query, "playlist"));
        const body = contentPage(c, data, lists, await readZones(deps, ctx));
        const o = { title: "", tab: "content", description: c.t("content.desc"), body };
        return page(request, reply, c, { ...o, own: "studio-content", module: true });
      },
    );

    studio.get(
      `${STUDIO}ticker`,
      { preHandler: pageNeeds(deps.rights, [TICKER]) },
      async (request, reply) => {
        const c = await context(request);
        const ticker = await deps.db.tenant((db) => tickerNow(db, c.timeZone, c.nowMs));
        return page(request, reply, c, {
          title: "",
          tab: "ticker",
          description: c.t("ticker.desc"),
          body: tickerView(c, ticker),
        });
      },
    );

    studio.get(
      `${STUDIO}pins`,
      { preHandler: pageNeeds(deps.rights, PIN_READ_RIGHTS) },
      async (request, reply) => {
        const c = await context(request);
        const ctx = tenantOf(request);
        const pin = await deps.db.tenant(readPin);
        const event = await deps.publicEvent?.(request.headers.host).catch(() => null);
        return page(request, reply, c, {
          title: "",
          tab: "pins",
          description: c.t("pins.desc"),
          body: pinsView(c, pin, await inEffect(deps, ctx.tenant_id, pin), event?.ends_at),
        });
      },
    );

    // Static and public, as ui.css is on every module's pages: nothing in them is the event's.
    studio.get<{ Params: { name: string } }>(`${STUDIO}static/:name`, async (request, reply) => {
      // Own keys only: `constructor` and the like must be a 404, not a read of a missing file.
      const name = request.params.name;
      const type = Object.hasOwn(STATIC_TYPES, name) ? STATIC_TYPES[name] : undefined;
      if (type === undefined) throw notFound();
      return reply
        .type(type)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-cache")
        .send(await staticFile(name));
    });
    done();
  });
}
