/** Studio → Moments (contracts/moments.md, Pages): On air, Spotlight, Priorities, History. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_ORDER, checkOrder, desiredOverrides, isClass } from "./arbiter.js";
import type { Class } from "./arbiter.js";
import { announcePages } from "./announce/pages.js";
import { cuePages } from "./cues/pages.js";
import { filterOf, historyRows } from "./history.js";
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { ANNOUNCE, EMERGENCY, READ, SCENES_TAKE, SETTINGS, TAKE, tenantOf } from "./http.js";
import { scenePages } from "./scene-pages.js";
import { storyCard, storyPages } from "./story/pages.js";
import { loadCrew, loadScenes, sceneZones } from "./scene-store.js";
import { crewButtons, onAirScenes } from "./scene-views.js";
import type { ZoneSceneView } from "./scene-views.js";
import type { AppDeps } from "./http.js";
import { PREFIX, page, pageErrors, pageNeeds, refusal, staticRoutes, viaApi } from "./page-kit.js";
import { loadRules } from "./rules.js";
import { loadCues } from "./cues/store.js";
import { knownZones, loadOrders, runningMoments, splitZones, titleOf } from "./store.js";
import { historyView, prioritiesView } from "./settings-views.js";
import { confirmEmergency, onAirView, spotlightView } from "./views.js";
import type { MomentView } from "./views.js";

type Form = Record<string, string | undefined>;
/** History rows per page. */
const PAGE = 50;
type Q = { Querystring: Form; Body: Form };
const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
/** A form's ticked boxes of one name: none, one or many. */
const ticked = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String).filter((s) => s !== "");
/** Where the hub QR of a crew spotlight points (contracts/notify.md: the hub is under /notify/). */
const HUB = { path: "/notify/", label: "Scan for the hub" };

async function onAir(deps: AppDeps): Promise<{ moments: MomentView[]; zones: string[] }> {
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
    return { moments, zones: await knownZones(c) };
  });
}

/** On air's scene card: each zone's scene, and the crew buttons for those who may press them. */
async function sceneCard(deps: AppDeps, request: FastifyRequest): Promise<Html> {
  const ctx = tenantOf(request);
  const now = deps.now();
  const s = await deps.db.tenant(async (c) => ({
    scenes: (await loadScenes(c)).scenes,
    zones: (await sceneZones(c)) as unknown as ZoneSceneView[],
    crew: await loadCrew(c),
  }));
  const crew = s.crew !== null && s.crew.until > now ? s.crew : null;
  const canTake = request.session?.rights.has(SCENES_TAKE) === true && ctx.status !== "archived";
  return html`${onAirScenes(s.zones, s.scenes, ctx.time_zone)}
    ${canTake ? crewButtons(s.scenes, crew === null ? null : { ...crew, until: crew.until.toISOString() }, "on-air") : ""}
    <a class="canccu-small" href="${PREFIX}scenes">All scenes</a>`;
}

export function pageRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.register((pages, _opts, done) => {
    pageErrors(pages, deps);
    staticRoutes(pages);
    cuePages(pages, deps);
    scenePages(pages, deps);
    announcePages(pages, deps);
    storyPages(pages, deps);
    const read = { preHandler: pageNeeds(deps, READ) };
    const has = (r: FastifyRequest, right: string) => r.session?.rights.has(right) === true;
    const back = (reply: FastifyReply, path: string, key: "done" | "error", text: string) =>
      reply.redirect(
        `${PREFIX}${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`,
        303,
      );

    // U9: On air while the event is live, Priorities before it.
    pages.get("/", read, (request, reply) =>
      reply.redirect(
        `${PREFIX}${tenantOf(request).status === "live" ? "on-air" : "priorities"}`,
        303,
      ),
    );

    pages.get<Q>("/on-air", read, async (request, reply) => {
      const state = await onAir(deps);
      return page(request, reply, deps, {
        title: "Moments",
        tab: "on-air",
        description: "What every zone shows now, what waits, and why. Live.",
        body: onAirView({
          ...state,
          now: deps.now(),
          canTake: has(request, TAKE),
          canAnnounce: has(request, ANNOUNCE),
          canEmergency: has(request, EMERGENCY),
          archived: tenantOf(request).status === "archived",
          scenes: await sceneCard(deps, request),
          stories: await storyCard(deps, request),
          done: request.query.done,
          error: request.query.error,
        }),
      });
    });

    pages.post<Q>(
      "/on-air/:action",
      { preHandler: pageNeeds(deps, TAKE) },
      async (request, reply) => {
        const action = (request.params as { action: string }).action;
        if (action !== "end" && action !== "extend")
          return back(reply, "on-air", "error", "No such action.");
        const f = request.body;
        const id = encodeURIComponent(f.moment_id ?? "");
        const zone = f.zone_key === undefined || f.zone_key === "" ? {} : { zone_key: f.zone_key };
        const a = await viaApi(
          pages,
          request,
          "POST",
          `/api/moments/moments/${id}/${action}`,
          action === "end" ? zone : { seconds: 300 },
        );
        if (a.status >= 400) return back(reply, "on-air", "error", refusal(a));
        return back(
          reply,
          "on-air",
          "done",
          action === "end" ? "Ended on that zone." : "Extended by 5 minutes.",
        );
      },
    );

    pages.post<Q>(
      "/emergency",
      { preHandler: pageNeeds(deps, EMERGENCY) },
      async (request, reply) => {
        // The hold is the script's (moments.js); without it, one more deliberate step asks first.
        if (request.body.held !== "yes") {
          return page(request, reply, deps, {
            title: "Start the emergency?",
            body: confirmEmergency(request.body.idempotency_key ?? ""),
          });
        }
        const a = await viaApi(pages, request, "POST", "/api/moments/emergency", {});
        return a.status >= 400
          ? back(reply, "on-air", "error", refusal(a))
          : back(reply, "on-air", "done", "Emergency on every zone.");
      },
    );
    pages.post<Q>(
      "/emergency/end",
      { preHandler: pageNeeds(deps, EMERGENCY) },
      async (request, reply) => {
        const a = await viaApi(pages, request, "POST", "/api/moments/emergency/end", {
          all_clear: request.body.all_clear === "true",
        });
        return a.status >= 400
          ? back(reply, "on-air", "error", refusal(a))
          : back(reply, "on-air", "done", "Emergency ended.");
      },
    );

    pages.get<Q>("/spotlight", { preHandler: pageNeeds(deps, TAKE) }, async (request, reply) => {
      const data = await deps.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT ref, data->'game'->>'name' AS name FROM moments_sources WHERE kind = 'session' ORDER BY ref`,
          [],
        );
        return {
          zones: await knownZones(c),
          images: await deps.screen.images(tenantOf(request).tenant_id),
          sessions: rows.map((r) => ({
            id: r.ref as string,
            name: `${(r.name as string | null) ?? "Session"} (${r.ref as string})`,
          })),
        };
      });
      return page(request, reply, deps, {
        title: "Crew spotlight",
        body: spotlightView({ ...data, error: request.query.error }),
        description: "In the hero of the zones you pick, for as long as you choose.",
      });
    });
    pages.post<Q>("/spotlight", { preHandler: pageNeeds(deps, TAKE) }, async (request, reply) => {
      const f = request.body;
      const zones = ticked((request.body as unknown as Record<string, unknown>).zone);
      const show = f.show ?? "message";
      // The crew picks a photo by its asset; the screens load its file (contracts/screen.md).
      let photo = "";
      if (show === "photo") {
        const images = await deps.screen.images(tenantOf(request).tenant_id);
        photo = images.find((i) => i.id === f.photo_asset)?.url ?? "";
        if (photo === "")
          return back(reply, "spotlight", "error", "Pick one of the photos, then start it.");
      }
      const a = await viaApi(pages, request, "POST", "/api/moments/spotlight", {
        show,
        zones,
        duration_seconds: Number(f.duration_seconds ?? 300),
        ...(show === "message"
          ? { title: f.title ?? "", ...(f.body ? { body: f.body } : {}) }
          : {}),
        ...(show === "bracket" ? { session_id: f.session_id ?? "" } : {}),
        ...(show === "photo" ? { photo_url: photo } : {}),
        ...(f.hub_qr === "yes" ? { qr: HUB } : {}),
      });
      return a.status >= 400
        ? back(reply, "on-air", "error", refusal(a))
        : back(reply, "on-air", "done", "Spotlight on air.");
    });

    // The picker's thumbnails: Screen serves a file only to `screen.content.read`, which the
    // crew may not hold, so Moments passes on the event's images, and only those, to `moments.take`.
    pages.get<{ Params: { asset_id: string } }>(
      "/spotlight/images/:asset_id",
      { preHandler: pageNeeds(deps, TAKE) },
      async (request, reply) => {
        const got = await deps.screen
          .image(tenantOf(request).tenant_id, request.params.asset_id)
          .catch(() => null);
        if (got === null) return reply.status(404).type("text/plain").send("No such image.");
        return reply
          .header("content-type", got.type)
          .header("cache-control", "private, max-age=3600")
          .header("x-content-type-options", "nosniff")
          .send(got.body);
      },
    );
    pages.get<Q>("/priorities", read, async (request, reply) => {
      const scope = request.query.scope ?? "";
      const state = await deps.db.tenant(async (c) => ({
        orders: await loadOrders(c),
        zones: await knownZones(c),
        rules: await loadRules(c),
        cues: (await loadCues(c)).map((q) => q.name),
        running: await Promise.all(
          (await runningMoments(c)).map(async (m) => ({ m, split: await splitZones(c, m.id) })),
        ),
      }));
      const saved =
        scope === "" ? state.orders.order : (state.orders.zones[scope] ?? state.orders.order);
      const asked = list(request.query.order).filter(isClass);
      const draft = asked.length > 0 && checkOrder(asked) === null;
      const order: readonly Class[] = draft ? asked : saved;
      const orders =
        scope === ""
          ? { ...state.orders, order }
          : { ...state.orders, zones: { ...state.orders.zones, [scope]: order } };
      const zone = scope !== "" ? scope : state.zones[0];
      const ranks: Record<string, number> = {};
      if (zone !== undefined) {
        // A zone split off keeps its own override (`<id>.<zone>`) whatever the draft ranks it.
        for (const { m, split } of state.running)
          for (const w of desiredOverrides(m, orders, state.zones, split)) ranks[w.id] = w.rank;
      }
      return page(request, reply, deps, {
        title: "Moments",
        tab: "priorities",
        description:
          "A default order ships; change it for the event, or for a zone that needs its own.",
        body: prioritiesView({
          scope,
          order,
          draft,
          zones: state.zones,
          own: Object.keys(state.orders.zones),
          revision: state.orders.revision,
          preview: zone === undefined ? null : { zone, ranks, auto: request.query.preview === "1" },
          rules: state.rules,
          cues: state.cues,
          canWrite: has(request, SETTINGS) && tenantOf(request).status !== "archived",
          done: request.query.done,
          error: request.query.error,
        }),
      });
    });
    pages.post<Q>(
      "/priorities",
      { preHandler: pageNeeds(deps, SETTINGS) },
      async (request, reply) => {
        const f = request.body;
        const scope = f.scope ?? "";
        const orders = await deps.db.tenant((c) => loadOrders(c));
        const order = f.do === "reset" ? [...DEFAULT_ORDER] : list(f.order);
        const zones = Object.entries(orders.zones).filter(([z]) => z !== scope);
        if (scope !== "" && f.do !== "follow") zones.push([scope, order.filter(isClass)]);
        const a = await viaApi(pages, request, "PUT", "/api/moments/priorities", {
          order: scope === "" ? order : orders.order,
          zones: zones.map(([zone_key, o]) => ({ zone_key, order: o })),
          revision: Number(f.revision),
        });
        const here = `priorities?scope=${encodeURIComponent(scope)}`;
        return a.status >= 400
          ? back(reply, here, "error", refusal(a))
          : back(reply, here, "done", "Order saved: live at once.");
      },
    );
    pages.post<Q>(
      "/rules/:rule_id",
      { preHandler: pageNeeds(deps, SETTINGS) },
      async (request, reply) => {
        const f = request.body;
        const all = request.body as unknown as Record<string, unknown>;
        const id = (request.params as { rule_id: string }).rule_id;
        const a = await viaApi(
          pages,
          request,
          "PUT",
          `/api/moments/rules/${encodeURIComponent(id)}`,
          {
            enabled: f.enabled === "true",
            template: f.template,
            class: f.class,
            regions: ticked(all.regions),
            ttl_seconds: Number(f.ttl_seconds),
            zones: ticked(all.zones),
            cue: f.cue === undefined || f.cue === "" ? null : f.cue,
            revision: Number(f.revision),
          },
        );
        return a.status >= 400
          ? back(reply, "priorities", "error", refusal(a))
          : back(reply, "priorities", "done", "Rule saved.");
      },
    );

    pages.get<Q>("/history", read, async (request, reply) => {
      const filter = filterOf(request.query);
      const before = request.query.before === undefined ? undefined : Number(request.query.before);
      const out = await deps.db.tenant(async (c) => ({
        rows: await historyRows(c, filter, PAGE + 1, Number.isInteger(before) ? before : undefined),
        zones: await knownZones(c),
      }));
      const more = out.rows.length > PAGE ? (out.rows[PAGE - 1]?.seq ?? null) : null;
      return page(request, reply, deps, {
        title: "Moments",
        tab: "history",
        description: "What played where, why, what it displaced, and how it ended.",
        body: historyView({
          rows: out.rows.slice(0, PAGE),
          zones: out.zones,
          filter,
          timeZone: tenantOf(request).time_zone,
          more,
        }),
      });
    });
    done();
  });
}
