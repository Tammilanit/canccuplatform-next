/**
 * The cue editor's routes (#626; contracts/moments.md, Pages): add, edit, turn on or off from the
 * list's row, try on a zone, and reset or remove; each sent on to the cues API as the same person.
 * The form's slider posts a stop of Not again for and the stepper minutes; the API takes seconds.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { SETTINGS, TAKE } from "../http.js";
import type { AppDeps } from "../http.js";
import { PREFIX, page, pageNeeds, refusal, viaApi, zoneNames } from "../page-kit.js";
import { cueEditor, editorTitle } from "./cue-form.js";
import type { Form, Q } from "./form-fields.js";
import { int, many, on, one } from "./form-fields.js";
import { loadCue, loadSettings } from "./store.js";
import type { CueView } from "./store.js";
import type { LibraryView } from "./views.js";

function cueBody(f: Form): Record<string, unknown> {
  const window = many(f.catch_up_before_start).map(Number);
  const stops = many(f.cooldown_stops).map(Number);
  const minutes = one(f.catch_up_minutes);
  return {
    category: one(f.category),
    enabled: on(f.enabled),
    level: int(f.level),
    // A step past the stops is no number, so the API refuses it in its own words.
    cooldown_seconds: stops[int(f.cooldown_step)] ?? NaN,
    catch_up_seconds: minutes === "" ? NaN : Math.round(Number(minutes) * 60),
    catch_up_before_start: window.length === 2 ? window : null,
    once_per_source: on(f.once_per_source),
    sounds: many(f.sounds),
    voice_line: one(f.voice_line) === "" ? null : one(f.voice_line),
    effects: many(f.effects),
    hold_seconds: int(f.hold_seconds),
    revision: int(f.revision),
  };
}

/** The cue as the API takes it back: everything it read, with the state and revision the page posted. */
const turned = (c: CueView, enabled: boolean, revision: number): Record<string, unknown> => ({
  category: c.category,
  enabled,
  level: c.level,
  cooldown_seconds: c.cooldown_seconds,
  catch_up_seconds: c.catch_up_seconds,
  catch_up_before_start: c.catch_up_before_start,
  once_per_source: c.once_per_source,
  sounds: c.sounds,
  voice_line: c.voice_line,
  effects: c.effects,
  hold_seconds: c.hold_seconds,
  revision,
});

export function editorPages(pages: FastifyInstance, deps: AppDeps): void {
  const write = { preHandler: pageNeeds(deps, SETTINGS) };
  const take = { preHandler: pageNeeds(deps, TAKE) };
  const back = (reply: FastifyReply, path: string, key: "done" | "error", text: string) =>
    reply.redirect(`${PREFIX}${path}?${key}=${encodeURIComponent(text)}`, 303);
  const answer = async (
    reply: FastifyReply,
    run: Promise<{ status: number; body: Record<string, unknown> }>,
    done: string,
    path: string,
  ) => {
    const a = await run;
    return a.status >= 400
      ? back(reply, path, "error", refusal(a))
      : back(reply, "cues", "done", done);
  };
  const editor = async (
    request: Parameters<typeof viaApi>[1],
    reply: FastifyReply,
    cue: CueView | null,
    o: { name?: string; error?: string },
  ) => {
    const sounds = await viaApi(pages, request, "GET", "/api/moments/sounds", {});
    const zoneName = await zoneNames(deps, request);
    const { settings, zones } = await deps.db.tenant(async (c) => ({
      settings: await loadSettings(c),
      zones: (await c.query(`SELECT zone_key FROM moments_zones ORDER BY zone_key`, [])).rows.map(
        (r) => ({ key: r.zone_key as string, name: zoneName(r.zone_key as string) }),
      ),
    }));
    return page(request, reply, deps, {
      title: editorTitle(cue?.name ?? null),
      tab: "cues",
      description:
        "A cue: the sound it plays, on which zones and how loud. Test it before it goes live.",
      body: cueEditor({
        cue,
        library: sounds.body.sounds as LibraryView[],
        settings,
        zones,
        canTake: request.session?.rights.has(TAKE) === true,
        ...o,
      }),
    });
  };
  const errorOf = (q: Q["Querystring"]) => (q.error === undefined ? {} : { error: q.error });

  pages.get<Q>("/cues/new", write, (request, reply) =>
    editor(request, reply, null, {
      ...errorOf(request.query),
      ...(request.query.name === undefined ? {} : { name: request.query.name }),
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
    if (cue === null) return back(reply, "cues", "error", "No such cue.");
    return editor(request, reply, cue, errorOf(request.query));
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
      `${editorTitle(name)} saved.`,
      `cues/edit/${encodeURIComponent(name)}`,
    );
  });

  pages.post<Q>("/cues/edit/:name/toggle", write, async (request, reply) => {
    const name = request.params.name;
    const cue = await deps.db.tenant((c) => loadCue(c, name));
    if (cue === null) return back(reply, "cues", "error", "No such cue.");
    const turn = one(request.body.turn);
    const want = turn === "" ? on(request.body.enabled) : turn === "on";
    return answer(
      reply,
      viaApi(
        pages,
        request,
        "PUT",
        `/api/moments/cues/${encodeURIComponent(name)}`,
        // The state the person asked for and the revision their page showed, so a stale row or a
        // repeated submit is a version_conflict, not a flip the other way. "turn" is the no-script button.
        turned(cue, want, int(request.body.revision)),
      ),
      `${editorTitle(name)} is ${want ? "on" : "off"}.`,
      "cues",
    );
  });

  // Try it on a zone: the form's first sound as a sound check there; nothing of the cue is saved.
  pages.post<Q>("/cues/edit/:name/try", take, async (request, reply) => {
    const path = `cues/edit/${encodeURIComponent(request.params.name)}`;
    const zone = one(request.body.try_zone);
    const sound = many(request.body.sounds)[0];
    if (zone === "" || zone === "here")
      return back(reply, path, "error", "Here plays in this browser: it needs the page's script.");
    if (sound === undefined) return back(reply, path, "error", "Choose a sound to try.");
    const a = await viaApi(pages, request, "POST", "/api/moments/sound/check", {
      zones: [zone],
      sound_id: sound,
    });
    return a.status >= 400
      ? back(reply, path, "error", refusal(a))
      : back(reply, path, "done", `Sent to ${(await zoneNames(deps, request))(zone)}.`);
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
      `${editorTitle(request.params.name)}: done.`,
      "cues",
    ),
  );
}
