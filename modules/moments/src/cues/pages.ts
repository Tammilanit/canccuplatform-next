/**
 * Studio → Cues, the sound desk (mockup 12; contracts/moments.md, Pages): the page and its forms,
 * each sent on to the cues API (cues/routes.ts) as the same person, so the page has the API's
 * rights, validation, idempotency and audit and nothing of its own.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { READ, SETTINGS, TAKE, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { PREFIX, page, pageNeeds, refusal, viaApi } from "../page-kit.js";
import { CATEGORIES } from "./catalog.js";
import { deskView as deskData } from "./routes.js";
import { loadCue, loadCues, readLog } from "./store.js";
import { cueForm } from "./cue-form.js";
import { deskView } from "./views.js";
import type { DeskZone, LibraryView } from "./views.js";

type Form = Record<string, string | string[] | undefined>;
type Q = { Querystring: Record<string, string | undefined>; Body: Form; Params: { name: string } };

const one = (v: Form[string]): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
/** A checkbox list arrives repeated (a list) or, from a plain field, comma-separated. */
const many = (v: Form[string]): string[] =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter((s) => s !== "");
const int = (v: Form[string]): number => (one(v) === "" ? NaN : Number(one(v)));
const on = (v: Form[string]): boolean => one(v) === "on";

function cueBody(f: Form): Record<string, unknown> {
  const window = many(f.catch_up_before_start).map(Number);
  return {
    category: one(f.category),
    enabled: on(f.enabled),
    level: int(f.level),
    cooldown_seconds: int(f.cooldown_seconds),
    catch_up_seconds: int(f.catch_up_seconds),
    catch_up_before_start: window.length === 2 ? window : null,
    once_per_source: on(f.once_per_source),
    sounds: many(f.sounds),
    voice_line: one(f.voice_line) === "" ? null : one(f.voice_line),
    effects: many(f.effects),
    hold_seconds: int(f.hold_seconds),
    revision: int(f.revision),
  };
}

export function cuePages(pages: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: pageNeeds(deps, READ) };
  const write = { preHandler: pageNeeds(deps, SETTINGS) };
  const take = { preHandler: pageNeeds(deps, TAKE) };
  const back = (reply: FastifyReply, key: "done" | "error", text: string, path = "cues") =>
    reply.redirect(`${PREFIX}${path}?${key}=${encodeURIComponent(text)}`, 303);
  const answer = async (
    reply: FastifyReply,
    run: Promise<{ status: number; body: Record<string, unknown> }>,
    done: string,
    path?: string,
  ) => {
    const a = await run;
    return a.status >= 400 ? back(reply, "error", refusal(a), path) : back(reply, "done", done);
  };
  const library = async (request: FastifyRequest): Promise<LibraryView[]> => {
    const a = await viaApi(pages, request, "GET", "/api/moments/sounds", {});
    return a.body.sounds as LibraryView[];
  };

  pages.get<Q>("/cues", read, async (request, reply) => {
    const has = (right: string) => request.session?.rights.has(right) === true;
    const now = deps.now();
    const data = await deps.db.tenant(async (c) => ({
      desk: await deskData(c, deps, now),
      cues: await loadCues(c),
      log: await readLog(c, { limit: 50 }),
    }));
    return page(request, reply, deps, {
      title: "Cues",
      tab: "cues",
      description:
        "What a screen does, and sounds like, when something happens. Decided on the server, once per zone.",
      body: deskView({
        settings: data.desk.settings as Parameters<typeof deskView>[0]["settings"],
        zones: data.desk.zones as DeskZone[],
        cues: data.cues,
        library: await library(request),
        log: data.log,
        timeZone: tenantOf(request).time_zone,
        now,
        canTake: has(TAKE),
        canWrite: has(SETTINGS) && tenantOf(request).status !== "archived",
        ...(request.query.done === undefined ? {} : { done: request.query.done }),
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
      }),
    });
  });

  pages.post<Q>("/cues/mute", take, (request, reply) =>
    answer(
      reply,
      viaApi(pages, request, "POST", "/api/moments/sound/mute", {
        minutes: int(request.body.minutes),
      }),
      int(request.body.minutes) === 0 ? "Sounds are back." : "Muted.",
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
    );
  });

  pages.get<Q>("/cues/new", write, async (request, reply) =>
    page(request, reply, deps, {
      title: "Add a cue",
      tab: "cues",
      body: cueForm({
        cue: null,
        library: await library(request),
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
        ...(request.query.name === undefined ? {} : { name: request.query.name }),
      }),
    }),
  );
  pages.post<Q>("/cues/new", write, (request, reply) => {
    const name = one(request.body.name);
    return answer(
      reply,
      viaApi(pages, request, "PUT", `/api/moments/cues/${encodeURIComponent(name)}`, {
        ...cueBody(request.body),
        revision: 0,
      }),
      `${name} added.`,
      "cues/new",
    );
  });

  pages.get<Q>("/cues/edit/:name", write, async (request, reply) => {
    const cue = await deps.db.tenant((c) => loadCue(c, request.params.name));
    if (cue === null) return back(reply, "error", "No such cue.");
    return page(request, reply, deps, {
      title: `Cue ${cue.name}`,
      tab: "cues",
      body: cueForm({
        cue,
        library: await library(request),
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
      }),
    });
  });
  pages.post<Q>("/cues/edit/:name", write, (request, reply) => {
    const name = request.params.name;
    return answer(
      reply,
      viaApi(
        pages,
        request,
        "PUT",
        `/api/moments/cues/${encodeURIComponent(name)}`,
        cueBody(request.body),
      ),
      `${name} saved.`,
      `cues/edit/${encodeURIComponent(name)}`,
    );
  });
  pages.post<Q>("/cues/edit/:name/delete", write, (request, reply) =>
    answer(
      reply,
      viaApi(
        pages,
        request,
        "DELETE",
        `/api/moments/cues/${encodeURIComponent(request.params.name)}`,
        {},
      ),
      `${request.params.name}: done.`,
    ),
  );

  pages.post<Q>("/cues/library", write, (request, reply) =>
    answer(
      reply,
      viaApi(pages, request, "POST", "/api/moments/sounds", {
        asset_id: one(request.body.asset_id),
      }),
      "Added to the library.",
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
    ),
  );
}
