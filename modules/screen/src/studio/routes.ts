/**
 * The Screen studio's pages under `/admin/screen/` (step 3 plan U5–U8, U11; contracts/screen.md:
 * the kiosk's pairing QR opens `/admin/screen/devices#pair=<code>`), in the organiser shell. The
 * pages only read; every change goes through the JSON API from static/studio.js, which checks the
 * right again and audits, so a page holds no right the API does not check itself.
 */
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import {
  KitError,
  MissingRight,
  NotSignedIn,
  checkAdminAccess,
  eventPageCsp,
  newNonce,
} from "@canccu/kit";
import type { Logger, PublicEvent, RightsChecker } from "@canccu/kit";
import { errorTitle, errorView, html, raw, shellPage } from "@canccu/ui";
import type { EventInfo, Slot } from "@canccu/ui";
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
import { CLIENT_KEYS, translator } from "./messages.js";
import type { MessageKey, Translate } from "./messages.js";
import { devicesActions, devicesView } from "./devices-view.js";
import { layoutsOf } from "./event-layouts.js";
import { frozenBanner, pinsView } from "./pins-view.js";
import { param, readContent } from "./content-data.js";
import { readPlaylists } from "./playlists-data.js";
import { contentPage } from "./playlists-view.js";
import { STATIC_TYPES, staticFile } from "./static-files.js";
import type { ContentDeps } from "./content-data.js";
import { WRITE } from "./schedule-editor.js";
import { schedulePage } from "./schedule-page.js";
import type { ScheduleQuery } from "./schedule-page.js";
import { tickerView } from "./ticker-view.js";
import { quickActions, runningNow } from "./live-quick.js";
import { STUDIO, liveActions, liveView, startUrlOf } from "./views.js";
import type { ViewContext } from "./views.js";
import { zoneEditorView, zonesView } from "./zone-views.js";

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

const SIGN_IN = "/admin/sign-in";
const READ = "screen.devices.read";
const ZONES = "screen.zones.write";
const TICKER = "screen.ticker.write";
const CONTENT = "screen.content.read";

/** The tabs, each shown only to holders of one of its rights (Live and Devices share one). */
const TABS: [path: string, label: MessageKey, rights: readonly string[]][] = [
  ["live", "tab.live", [READ]],
  ["devices", "tab.devices", [READ]],
  ["zones", "tab.zones", [ZONES]],
  ["schedule", "tab.schedule", [CONTENT]],
  ["content", "tab.content", [CONTENT]],
  ["ticker", "tab.ticker", [TICKER]],
  ["pins", "tab.pins", PIN_READ_RIGHTS],
];
const ANY_TAB = [...new Set(TABS.flatMap(([, , rights]) => rights))];
const holds = (rights: ReadonlySet<string>, any: readonly string[]) =>
  any.some((r) => rights.has(r));

/** Sign-in first (so a signed-out browser is sent to sign in), then the address rule, then a right. */
function pageNeeds(rights: RightsChecker, any: readonly string[]): preHandlerAsyncHookHandler {
  return async (request) => {
    const session = await rights.session(request.headers.cookie);
    request.session = session;
    checkAdminAccess(tenantOf(request), request.ip);
    if (!holds(session.rights, any)) {
      throw new MissingRight(`needs one of the rights ${any.join(", ")}`);
    }
  };
}

async function eventOf(request: FastifyRequest, deps: StudioDeps): Promise<EventInfo> {
  const ctx = tenantOf(request);
  const e = await deps.publicEvent?.(request.headers.host).catch(() => null);
  return {
    name: e?.name,
    status: ctx.status,
    timeZone: ctx.time_zone,
    startsAt: e?.starts_at,
    endsAt: e?.ends_at,
    venue: ctx.venue?.name,
  };
}

async function translate(deps: StudioDeps): Promise<Translate> {
  // An admin that cannot answer leaves the page in English rather than failing it.
  const language = await deps.adminSettings.ensure().then(
    () => deps.adminSettings.get("language", "en"),
    () => "en",
  );
  return translator(String(language));
}

/** The client's strings as a JSON block; `<` escaped so no text can close the element. */
function clientText(t: Translate): Slot {
  const text = Object.fromEntries(CLIENT_KEYS.map((k) => [k, t(k)]));
  return raw(
    `<script type="application/json" id="canccu-studio-text">${JSON.stringify(text).replace(/</g, "\\u003c")}</script>`,
  );
}

interface PageOptions {
  title: string;
  tab?: string;
  body: Slot;
  actions?: Slot;
  description?: string;
  crumb?: { href: string; label: string };
  status?: number;
  plain?: boolean;
  /** A page's own stylesheet and script, if it has one (`<name>.css`, `<name>.js`, using studio.js's helpers). */
  own?: string;
  /** The page's own script is a module, which may import its neighbours in static/. */
  module?: boolean;
  /** Whether the page's own script loads: by default when it has one; the schedule's is writers'. */
  script?: boolean;
  /** Rules made of numbers only (the schedule's block places), under the page's nonce. */
  style?: string;
}

async function studioPage(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: StudioDeps,
  t: Translate,
  o: PageOptions,
): Promise<FastifyReply> {
  const nonce = newNonce();
  const rights = request.session?.rights ?? new Set<string>();
  // While frozen, every page says so to whoever may read the pin (an error page reads nothing).
  const banner =
    o.plain || !holds(rights, PIN_READ_RIGHTS)
      ? ""
      : await frozenBanner(deps, tenantOf(request), t);
  const doc = shellPage({
    title: o.title,
    nonce,
    surface: "admin",
    cssHref: `${STUDIO}static/ui.css`,
    head: html`<link
        rel="stylesheet"
        href="${STUDIO}static/studio.css"
      />${o.own === undefined ? "" : html`<link rel="stylesheet" href="${STUDIO}static/${o.own}.css" />`}${
        o.style === undefined
          ? ""
          : html`<style nonce="${nonce}">
              ${raw(o.style)}
            </style>`
      }`,
    event: await eventOf(request, deps),
    session: request.session ?? undefined,
    current: "screen",
    plain: o.plain ?? false,
    ...(o.description === undefined ? {} : { description: o.description }),
    ...(o.crumb === undefined ? {} : { crumb: o.crumb }),
    ...(o.actions === undefined ? {} : { actions: o.actions }),
    width: "wide",
    ...(o.tab === undefined
      ? {}
      : {
          tabs: TABS.filter(([, , any]) => holds(rights, any)).map(([path, label]) => ({
            href: STUDIO + path,
            label: t(label),
            current: path === o.tab,
          })),
        }),
    body: html`${banner}
      <p class="canccu-studio-notice" role="status" hidden></p>
      ${o.body}${clientText(t)}
      <script src="${STUDIO}static/studio.js" defer></script>
      ${
        o.own === undefined || !(o.script ?? Object.hasOwn(STATIC_TYPES, `${o.own}.js`))
          ? ""
          : o.module === true
            ? html`<script type="module" src="${STUDIO}static/${o.own}.js"></script>`
            : html`<script src="${STUDIO}static/${o.own}.js" defer></script>`
      }`,
  });
  // Admin pages frame surface pages (the virtual screen) and are never framed themselves.
  return reply
    .type("text/html; charset=utf-8")
    .header("content-security-policy", eventPageCsp(nonce, request.hostname, { page: "admin" }))
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .status(o.status ?? 200)
    .send(doc.toString());
}

export function studioRoutes(app: FastifyInstance, deps: StudioDeps): void {
  const now = deps.now ?? Date.now;
  void app.register((studio, _opts, done) => {
    // Pages answer pages: a browser without a session goes to sign in, a refusal is said in words.
    studio.setErrorHandler(async (err: FastifyError, request, reply) => {
      if (err instanceof NotSignedIn) {
        return reply.redirect(`${SIGN_IN}?next=${encodeURIComponent(request.url)}`, 303);
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
      rights: request.session?.rights ?? new Set(),
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
        const [zones, all] = [await readZones(deps, tenantOf(request)), await devices()];
        // A run of show that cannot be read leaves Delay pointing at the run of show itself.
        const items = c.rights.has("agenda.items.write")
          ? await deps.sources.agendaItems(tenantOf(request).tenant_id).catch(() => null)
          : null;
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
        const [zones, all] = [await readZones(deps, tenantOf(request)), await devices()];
        return page(request, reply, c, {
          title: "",
          tab: "zones",
          description: c.t("zones.desc"),
          body: zonesView(c, zones, all),
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
