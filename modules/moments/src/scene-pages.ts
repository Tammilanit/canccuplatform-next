/**
 * The Scenes page's routes (contracts/moments.md, Scenes, Pages): every change goes on to the API
 * as the same person (viaApi), so it has the API's rights, checks, revision and audit.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { READ, SCENES_TAKE, SETTINGS, tenantOf } from "./http.js";
import type { AppDeps } from "./http.js";
import { PREFIX, page, pageNeeds, refusal, viaApi, zoneNames } from "./page-kit.js";
import { bandsOf } from "./scene-eval.js";
import { agendaItems, loadCrew, loadScenes, sceneZones } from "./scene-store.js";
import { PRESETS } from "./scenes.js";
import type { Condition, Scene, SceneMotion } from "./scenes.js";
import { scenesPageView } from "./scene-views.js";
import type { ZoneSceneView } from "./scene-views.js";
import { knownZones } from "./store.js";

type Raw = Record<string, string | string[] | undefined>;
const DAY_MS = 86_400_000;
/** The chart shows at most this many days of a long event. */
const MAX_DAYS = 7;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const all = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((s) => s.trim()).filter((s) => s !== "");
const num = (v: string | string[] | undefined): number | undefined =>
  one(v) === "" ? undefined : Number(one(v));

/** The scene the editor's form describes; the API checks it. */
export function sceneFromForm(f: Raw, before: Scene, zones: readonly string[]): Scene {
  const when: Condition[] = [];
  if (one(f.time_from) !== "" || one(f.time_to) !== "")
    when.push({ type: "time", from: one(f.time_from), to: one(f.time_to) });
  const kinds = one(f.agenda_kinds)
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "");
  const within = num(f.agenda_within);
  if (kinds.length > 0)
    when.push({
      type: "agenda",
      kinds,
      ...(within === undefined ? {} : { starts_within_minutes: within }),
    });
  const checkins = num(f.checkins_over);
  if (checkins !== undefined) when.push({ type: "checkins", over: checkins });
  const over = num(f.online_over);
  const under = num(f.online_under);
  if (over !== undefined || under !== undefined)
    when.push({
      type: "presence",
      ...(over === undefined ? {} : { over }),
      ...(under === undefined ? {} : { under }),
    });
  if (one(f.games) === "yes") when.push({ type: "games" });
  const crew = num(f.crew_minutes);
  if (crew !== undefined) when.push({ type: "crew", minutes: crew });
  const layouts: Record<string, string> = {};
  for (const z of zones) if (one(f[`layout_${z}`]) !== "") layouts[z] = one(f[`layout_${z}`]);
  const sound = one(f.sound);
  return {
    key: before.key,
    name: one(f.name),
    preset: before.preset,
    zones: all(f.zone),
    when,
    then: {
      motion: one(f.motion) === "" ? null : (one(f.motion) as SceneMotion),
      layouts,
      stage_mood:
        one(f.stage_mood) === "" ? null : (one(f.stage_mood) as Scene["then"]["stage_mood"]),
      palette:
        one(f.palette_on) === "yes"
          ? { primary: one(f.palette_primary), accent: one(f.palette_accent) }
          : null,
      sound: sound === "" ? null : sound === "on",
      quiet: one(f.quiet) === "yes",
      hero_off: all(f.hero_off),
    },
    hold_minutes: num(f.hold_minutes) ?? 0,
    blend_seconds: num(f.blend_seconds) ?? 0,
  };
}

/** A key no scene has: the preset's, then `-2`, `-3`… */
function freeKey(scenes: readonly Scene[], base: string): string {
  for (let n = 2; ; n++) {
    const key = `${base}-${n}`;
    if (!scenes.some((s) => s.key === key)) return key;
  }
}

/** The days the chart draws: the event's, at most a week, else today's 24 hours. */
function chartSpan(
  event: { starts_at?: string | null; ends_at?: string | null } | null,
  now: Date,
): { from: number; to: number } {
  const from = Date.parse(event?.starts_at ?? "");
  const to = Date.parse(event?.ends_at ?? "");
  if (!Number.isNaN(from) && !Number.isNaN(to) && to > from)
    return { from, to: Math.min(to, from + MAX_DAYS * DAY_MS) };
  const start = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return { from: start, to: start + DAY_MS };
}

export function scenePages(pages: FastifyInstance, deps: AppDeps): void {
  const back = (reply: FastifyReply, path: string, key: "done" | "error", text: string) =>
    reply.redirect(
      `${PREFIX}${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`,
      303,
    );
  const has = (r: FastifyRequest, right: string) => r.session?.rights.has(right) === true;
  const raw = (r: FastifyRequest) => (r.body ?? {}) as Raw;
  /** Saves the list a change makes of the stored one, at the form's revision. */
  const putList = async (r: FastifyRequest, change: (s: Scene[]) => Scene[] | string) => {
    const f = raw(r);
    const { scenes } = await deps.db.tenant((c) => loadScenes(c));
    const next = change([...scenes]);
    if (typeof next === "string") return { status: 400, body: { error: { message: next } } };
    return viaApi(pages, r, "PUT", "/api/moments/scenes", {
      scenes: next,
      revision: num(f.revision),
    });
  };
  const write = { preHandler: pageNeeds(deps, SETTINGS) };

  pages.get<{ Querystring: Record<string, string | undefined> }>(
    "/scenes",
    { preHandler: pageNeeds(deps, READ) },
    async (request, reply) => {
      const ctx = tenantOf(request);
      const q = request.query;
      const now = deps.now();
      const state = await deps.db.tenant(async (c) => ({
        list: await loadScenes(c),
        zones: await knownZones(c),
        now: (await sceneZones(c)) as unknown as ZoneSceneView[],
        crew: await loadCrew(c),
        items: await agendaItems(c),
      }));
      const chartZone =
        q.zone !== undefined && state.zones.includes(q.zone) ? q.zone : (state.zones[0] ?? "");
      const event = await deps.tenants
        .event(request.headers.host, request.headers.cookie)
        .catch(() => null);
      const days = bandsOf(state.list.scenes, {
        timeZone: ctx.time_zone,
        items: state.items,
        zone: chartZone,
        ...chartSpan(event, now),
      });
      const crew = state.crew !== null && state.crew.until > now ? state.crew : null;
      const writable = has(request, SETTINGS) && ctx.status !== "archived";
      return page(request, reply, deps, {
        title: "Scenes",
        tab: "scenes",
        description:
          "Scenes run the venue by themselves. The first scene in the list whose conditions hold is on.",
        body: scenesPageView({
          scenes: state.list.scenes,
          revision: state.list.revision,
          zones: state.zones,
          now: state.now,
          crew: crew === null ? null : { ...crew, until: crew.until.toISOString() },
          days,
          chartZone,
          edit: writable ? (state.list.scenes.find((s) => s.key === q.edit) ?? null) : null,
          canWrite: writable,
          canTake: has(request, SCENES_TAKE) && ctx.status !== "archived",
          timeZone: ctx.time_zone,
          zoneName: await zoneNames(deps, request),
          done: q.done,
          error: q.error,
        }),
      });
    },
  );

  pages.post("/scenes/add", write, async (request, reply) => {
    const preset = PRESETS.find((p) => p.key === one(raw(request).preset));
    if (preset === undefined) return back(reply, "scenes", "error", "No such preset.");
    let key = "";
    const a = await putList(request, (scenes) => {
      key = freeKey(scenes, preset.key);
      // Just above its preset, so it wins over it; at the top when the event deleted the preset.
      const at = Math.max(
        0,
        scenes.findIndex((s) => s.key === preset.key),
      );
      scenes.splice(at, 0, { ...preset, key, name: `${preset.name} (copy)` });
      return scenes;
    });
    return a.status >= 400
      ? back(reply, "scenes", "error", refusal(a))
      : reply.redirect(`${PREFIX}scenes?edit=${key}`, 303);
  });

  pages.post("/scenes/save", write, async (request, reply) => {
    const f = raw(request);
    const zones = await deps.db.tenant((c) => knownZones(c));
    const a = await putList(request, (scenes) => {
      const at = scenes.findIndex((s) => s.key === one(f.key));
      const before = scenes[at];
      if (before === undefined) return "That scene is gone: open it again.";
      scenes[at] = sceneFromForm(f, before, zones);
      return scenes;
    });
    return a.status >= 400
      ? back(reply, `scenes?edit=${encodeURIComponent(one(f.key))}`, "error", refusal(a))
      : back(reply, "scenes", "done", "Scene saved: every zone follows it at once.");
  });

  pages.post("/scenes/move", write, async (request, reply) => {
    const f = raw(request);
    const a = await putList(request, (scenes) => {
      const at = scenes.findIndex((s) => s.key === one(f.key));
      const to = at + (num(f.by) === -1 ? -1 : 1);
      if (at < 0 || to < 0 || to >= scenes.length) return "It cannot move that way.";
      const [s] = scenes.splice(at, 1);
      scenes.splice(to, 0, s as Scene);
      return scenes;
    });
    return a.status >= 400
      ? back(reply, "scenes", "error", refusal(a))
      : back(reply, "scenes", "done", "Order saved.");
  });

  pages.post("/scenes/delete", write, async (request, reply) => {
    const key = one(raw(request).key);
    const a = await putList(request, (scenes) => scenes.filter((s) => s.key !== key));
    return a.status >= 400
      ? back(reply, "scenes", "error", refusal(a))
      : back(reply, "scenes", "done", "Scene deleted.");
  });

  pages.post("/scenes/reset", write, async (request, reply) => {
    const a = await viaApi(pages, request, "POST", "/api/moments/scenes/reset", {
      revision: num(raw(request).revision),
    });
    return a.status >= 400
      ? back(reply, "scenes", "error", refusal(a))
      : back(reply, "scenes", "done", "The presets are back.");
  });

  pages.post<{ Params: { scene_key: string } }>(
    "/scenes/:scene_key/take",
    { preHandler: pageNeeds(deps, SCENES_TAKE) },
    async (request, reply) => {
      const from = one(raw(request).from) === "scenes" ? "scenes" : "on-air";
      const a = await viaApi(
        pages,
        request,
        "POST",
        `/api/moments/scenes/${encodeURIComponent(request.params.scene_key)}/take`,
        {},
      );
      if (a.status >= 400) return back(reply, from, "error", refusal(a));
      const crew = a.body.crew as { scene_key: string } | null;
      return back(
        reply,
        from,
        "done",
        crew === null ? "Back to the autopilot." : "On, on every zone.",
      );
    },
  );
}
