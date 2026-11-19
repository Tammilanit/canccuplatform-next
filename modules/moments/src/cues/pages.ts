/**
 * Studio → Cues, the sound desk (#626; contracts/moments.md, Pages): its four sub-pages and the
 * master strip's and Limits' forms, each sent on to the cues API (cues/routes.ts) as the same
 * person, so the page has the API's rights, validation, idempotency and audit and nothing of its
 * own. The cue editor's routes are editor-pages.ts.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { READ, SETTINGS, TAKE, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { page, pageNeeds, refusal, viaApi, zoneNames } from "../page-kit.js";
import { CATEGORIES } from "./catalog.js";
import { editorPages } from "./editor-pages.js";
import { int, on, one } from "./form-fields.js";
import type { Form, Q } from "./form-fields.js";
import { FILTERS } from "./log-view.js";
import { deskView as deskData } from "./routes.js";
import { SOUND_CHECK } from "./service.js";
import { loadCues, readLog } from "./store.js";
import type { LogRow } from "./store.js";
import { SUBS, deskPage, subPath } from "./views.js";
import type { DeskZone, LibraryView, Sub } from "./views.js";

/** The sub-page a form came from, so its answer lands there; anything else is Cues. */
const backOf = (f: Form): Sub => SUBS.find((s) => s === one(f.back)) ?? "cues";

/** The lines of the newest sound check: one per zone, all written at the same instant. */
function lastCheck(rows: LogRow[]): LogRow[] {
  const checks = rows.filter((r) => r.cue === SOUND_CHECK);
  const at = checks[0]?.at.getTime();
  return checks.filter((r) => r.at.getTime() === at).reverse();
}

export function cuePages(pages: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: pageNeeds(deps, READ) };
  const write = { preHandler: pageNeeds(deps, SETTINGS) };
  const take = { preHandler: pageNeeds(deps, TAKE) };
  const answer = async (
    reply: FastifyReply,
    run: Promise<{ status: number; body: Record<string, unknown> }>,
    done: string,
    sub: Sub,
    extra = "",
  ) => {
    const a = await run;
    const [key, text] = a.status >= 400 ? ["error", refusal(a)] : ["done", done];
    return reply.redirect(`${subPath(sub)}?${extra}${key}=${encodeURIComponent(text)}`, 303);
  };

  const desk = async (request: FastifyRequest<Q>, reply: FastifyReply, sub: Sub) => {
    const has = (right: string) => request.session?.rights.has(right) === true;
    const q = request.query;
    const now = deps.now();
    const outcome = FILTERS.find((f) => f === q.outcome);
    const zone = q.zone === undefined || q.zone === "" ? undefined : q.zone;
    const search = q.q === undefined || q.q.trim() === "" ? undefined : q.q.trim();
    const data = await deps.db.tenant(async (c) => ({
      desk: await deskData(c, deps, now),
      cues: await loadCues(c),
      log:
        sub === "log"
          ? await readLog(c, {
              limit: 100,
              ...(zone === undefined ? {} : { zone }),
              ...(outcome === undefined ? {} : { outcome }),
              ...(search === undefined ? {} : { search }),
            })
          : [],
      check: q.checked === "1" ? lastCheck(await readLog(c, { limit: 50 })) : null,
    }));
    const library = await viaApi(pages, request, "GET", "/api/moments/sounds", {});
    const zoneName = await zoneNames(deps, request);
    return page(request, reply, deps, {
      title: "Cues",
      tab: "cues",
      description: "What a screen does, and sounds like, when something happens.",
      body: deskPage({
        sub,
        settings: data.desk.settings as Parameters<typeof deskPage>[0]["settings"],
        zones: (data.desk.zones as Omit<DeskZone, "name">[]).map((z) => ({
          ...z,
          name: zoneName(z.zone_key),
        })),
        cues: data.cues,
        library: library.body.sounds as LibraryView[],
        log: data.log,
        check: data.check,
        query: {
          ...(q.category === undefined ? {} : { category: q.category }),
          ...(q.q === undefined ? {} : { q: q.q }),
          ...(outcome === undefined ? {} : { outcome }),
          ...(zone === undefined ? {} : { zone }),
        },
        timeZone: tenantOf(request).time_zone,
        now,
        canTake: has(TAKE),
        canWrite: has(SETTINGS) && tenantOf(request).status !== "archived",
        ...(q.done === undefined ? {} : { done: q.done }),
        ...(q.error === undefined ? {} : { error: q.error }),
      }),
    });
  };
  for (const sub of SUBS)
    pages.get<Q>(sub === "cues" ? "/cues" : `/cues/${sub}`, read, (request, reply) =>
      desk(request, reply, sub),
    );

  pages.post<Q>("/cues/mute", take, (request, reply) =>
    answer(
      reply,
      viaApi(pages, request, "POST", "/api/moments/sound/mute", {
        minutes: int(request.body.minutes),
      }),
      int(request.body.minutes) === 0 ? "Sounds are back." : "Muted.",
      backOf(request.body),
    ),
  );

  pages.post<Q>("/cues/check", take, (request, reply) => {
    const zone = one(request.body.zone_key);
    return answer(
      reply,
      viaApi(pages, request, "POST", "/api/moments/sound/check", {
        zones: zone === "" ? [] : [zone],
      }),
      "Sound check sent.",
      backOf(request.body),
      "checked=1&",
    );
  });

  // The master strip changes the switch and the volume; the rest goes back as it is, and the
  // form's revision makes a stale strip a conflict, as a stale Limits form is.
  pages.post<Q>("/cues/master", write, async (request, reply) => {
    const now = await viaApi(pages, request, "GET", "/api/moments/sound", {});
    const s = now.body.settings as Record<string, unknown>;
    return answer(
      reply,
      viaApi(pages, request, "PUT", "/api/moments/sound/settings", {
        enabled: on(request.body.enabled),
        volume: int(request.body.volume),
        hourly_budget: s.hourly_budget,
        per_minute: s.per_minute,
        per_source_seconds: s.per_source_seconds,
        categories: s.categories,
        revision: int(request.body.revision),
      }),
      "Saved.",
      backOf(request.body),
    );
  });

  pages.post<Q>("/cues/settings", write, (request, reply) => {
    const f = request.body;
    const categories = Object.fromEntries(
      CATEGORIES.map((c) => [c, { enabled: on(f[`${c}.enabled`]), level: int(f[`${c}.level`]) }]),
    );
    return answer(
      reply,
      viaApi(pages, request, "PUT", "/api/moments/sound/settings", {
        enabled: on(f.enabled),
        volume: int(f.volume),
        hourly_budget: int(f.hourly_budget),
        per_minute: int(f.per_minute),
        per_source_seconds: int(f.per_source_seconds),
        categories,
        revision: int(f.revision),
      }),
      "Saved.",
      "limits",
    );
  });

  pages.post<Q>("/cues/library", write, (request, reply) =>
    answer(
      reply,
      viaApi(pages, request, "POST", "/api/moments/sounds", {
        asset_id: one(request.body.asset_id),
      }),
      "Added to the library.",
      "library",
    ),
  );
  pages.post<Q & { Params: { id: string } }>("/cues/library/:id/remove", write, (request, reply) =>
    answer(
      reply,
      viaApi(
        pages,
        request,
        "DELETE",
        `/api/moments/sounds/${encodeURIComponent((request.params as { id: string }).id)}`,
        {},
      ),
      "Removed from the library.",
      "library",
    ),
  );

  editorPages(pages, deps);
}
