/**
 * The storyboards API (contracts/moments/storyboards.openapi.yaml): the event's stories and
 * settings, reset a preset, fire (and test-fire) a story, stop a loop and skip to its finale.
 * `moments.settings.write` edits, `moments.take` fires, stops and skips (SU1).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import { invalid } from "../content.js";
import { READ, SETTINGS, TAKE, actorOf, archivedError, crewAction, failure, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { lockSettings } from "../store.js";
import { runOfShow } from "../announce/store.js";
import { checkStories } from "./check.js";
import { freeVariablesOf, isVideo } from "./model.js";
import type { Story } from "./model.js";
import { PRESETS, RULE_OF_PRESET } from "./presets.js";
import { endRound } from "./round.js";
import type { Ctx } from "./round.js";
import { endRun, planEnd } from "./runner.js";
import { ensureStories, lockRun, noteEvent, recentRuns, saveRun, writeStories } from "./store.js";
import type { EventFacts, RunRow, StoryDoc, StorySettings } from "./store.js";
import { FACTORS } from "./timing.js";
import { takeStory } from "./triggers.js";

type Body = Record<string, unknown>;
const ZONE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const VAR = /^[a-z][a-z0-9_]{0,31}$/;

export function runView(r: RunRow, stories: Story[]): Body {
  const s = stories.find((x) => x.key === r.story_key);
  return {
    id: r.id,
    story_key: r.story_key,
    name: s?.name ?? r.story_key,
    source: r.source,
    status: r.status,
    test: r.test,
    zones: r.zones,
    t: r.t.toISOString(),
    round: r.round === null ? null : { number: r.round.index + 1, finale: r.round.finale, until: new Date(r.round.until_ms).toISOString() },
    rounds_played: r.rounds_played,
    has_finale: s?.finale != null,
    started_at: r.started_at.toISOString(),
    ended_at: r.ended_at?.toISOString() ?? null,
    end_reason: r.end_reason,
  };
}

export async function storiesView(c: SqlClient, now: Date): Promise<Body> {
  const doc = await ensureStories(c);
  return {
    stories: doc.stories.map((s) => ({
      ...s,
      free_variables: freeVariablesOf(s),
      rule_off: s.enabled && s.preset !== null ? (RULE_OF_PRESET[s.preset] ?? null) : null,
    })),
    settings: doc.settings,
    revision: doc.revision,
    presets: PRESETS.map((p) => p.key),
    runs: (await recentRuns(c, now)).map((r) => runView(r, doc.stories)),
  };
}

function settingsOf(v: unknown, before: StorySettings): StorySettings {
  if (v === undefined) return before;
  const s = { ...before, ...(v as Partial<StorySettings>) };
  const int = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
  if (!(FACTORS as readonly number[]).includes(s.factor)) throw invalid("The busy venue factor is 1, 1.5 or 2.");
  if (!int(s.min_card_seconds, 6, 60)) throw invalid("The minimum card time is 6 to 60 s.");
  if (!int(s.airtime_percent, 20, 80)) throw invalid("The airtime cap is 20 to 80 %.");
  if (!int(s.handover_seconds, 0, 120)) throw invalid("The hand-over is 0 to 120 s.");
  return { factor: s.factor, min_card_seconds: s.min_card_seconds, airtime_percent: s.airtime_percent, handover_seconds: s.handover_seconds };
}

/** A video step names a Screen `video` or `youtube` asset that plays: its file, kind and length are kept. */
async function withVideos(deps: AppDeps, tenant: string, stories: Story[]): Promise<Story[]> {
  const out: Story[] = [];
  for (const s of stories) {
    const steps = [];
    for (const step of s.round.steps) {
      if (!isVideo(step)) {
        steps.push(step);
        continue;
      }
      const id = String(step.content.asset_id);
      const a = (await deps.screen.asset(tenant, id).catch(() => null)) as (Body & { kind?: string; url?: string; duration_seconds?: number | null; health?: string; title?: string }) | null;
      if (a === null || (a.kind !== "video" && a.kind !== "youtube")) throw invalid(`${s.name}: the video step needs a video or YouTube asset of the event.`);
      if (a.kind === "youtube" && a.health === "error")
        throw invalid(`${s.name}: YouTube does not play this video here (private, or removed): make it public or unlisted, or upload the file.`);
      if (typeof a.duration_seconds !== "number" || a.duration_seconds <= 0) throw invalid(`${s.name}: the video's length is not known yet.`);
      steps.push({ ...step, content: { asset_id: id, kind: a.kind, url: a.url ?? "", title: a.title ?? "", duration_ms: Math.round(a.duration_seconds * 1000) } });
    }
    out.push({ ...s, round: { ...s.round, steps } });
  }
  return out;
}

/** Preloads (PV1): every uploaded video of a story on for the event, on that story's zones. */
async function sendPrefetch(deps: AppDeps, c: SqlClient, stories: Story[]): Promise<void> {
  const files = stories
    .filter((s) => s.enabled)
    .flatMap((s) => s.round.steps.filter((x) => isVideo(x) && x.content.kind === "video").map((x) => ({ url: String(x.content.url), zones: s.conditions.zones })));
  await deps.outbox.add(c, "moments.prefetch.changed", { files }, { version: 1 });
}

/** What the tick needs of the event, read with the request that saves or reads the stories. */
export async function eventFactsOf(deps: AppDeps, request: FastifyRequest): Promise<EventFacts | null> {
  const ctx = tenantOf(request);
  const e = await deps.tenants.event(request.headers.host, request.headers.cookie).catch(() => null);
  if (e === null) return null;
  return { name: e.name, hostname: ctx.primary_hostname, time_zone: ctx.time_zone, starts_at: e.starts_at ?? null, ends_at: e.ends_at ?? null };
}

export function storyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: requireRight(deps.rights, READ) };
  const write = { preHandler: requireRight(deps.rights, SETTINGS) };
  const take = { preHandler: requireRight(deps.rights, TAKE) };

  const save = async (request: FastifyRequest, next: (doc: StoryDoc) => Promise<{ stories: Story[]; settings: StorySettings }>, revision: unknown, action: string) => {
    const ctx = tenantOf(request);
    if (ctx.status === "archived") throw archivedError();
    const actor = actorOf(request.session);
    const facts = await eventFactsOf(deps, request);
    const out = await deps.db.tenant(async (c) => {
      await lockSettings(c, "stories");
      const before = await ensureStories(c);
      if (revision !== before.revision) throw new KitError("Someone saved meanwhile: read it again.", { status: 409, code: "version_conflict" });
      const after = await next(before);
      const why = checkStories(after.stories, after.settings);
      if (why !== null) throw invalid(why);
      const stories = await withVideos(deps, ctx.tenant_id, after.stories);
      await writeStories(c, stories, after.settings, before.revision + 1);
      if (facts !== null) await noteEvent(c, facts);
      await sendPrefetch(deps, c, stories);
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor.user_id,
        action,
        target: { type: "storyboards", id: ctx.tenant_id },
        changes: { stories: { old: before.stories, new: stories }, settings: { old: before.settings, new: after.settings } },
      });
      return storiesView(c, deps.now());
    });
    await deps.outbox.flush();
    return out;
  };

  app.get("/api/moments/storyboards", read, async (request) => {
    const facts = await eventFactsOf(deps, request);
    return deps.db.tenant(async (c) => {
      if (facts !== null) await noteEvent(c, facts);
      return storiesView(c, deps.now());
    });
  });

  app.put("/api/moments/storyboards", write, (request) => {
    const body = (request.body ?? {}) as Body;
    if (!Array.isArray(body.stories)) throw invalid("`stories` is the event's list.");
    return save(request, async (doc) => ({ stories: body.stories as Story[], settings: settingsOf(body.settings, doc.settings) }), body.revision, "moments.storyboards.changed");
  });

  // Reset to default (SD8): one preset back to this platform version's, or every preset.
  app.post("/api/moments/storyboards/reset", write, (request) => {
    const body = (request.body ?? {}) as Body;
    const key = body.key ?? null;
    if (key !== null && !PRESETS.some((p) => p.key === key)) throw invalid("`key` names a preset.");
    return save(
      request,
      async (doc) => {
        const reset = PRESETS.filter((p) => key === null || p.key === key);
        const kept = doc.stories.filter((s) => !reset.some((p) => p.key === s.key));
        return { stories: [...reset.map((p) => JSON.parse(JSON.stringify(p)) as Story), ...kept], settings: doc.settings };
      },
      body.revision,
      "moments.storyboards.reset",
    );
  });

  app.post<{ Params: { key: string } }>("/api/moments/storyboards/:key/take", take, (request, reply) =>
    crewAction(deps, request, reply, async (c, actor, now) => {
      const body = (request.body ?? {}) as Body;
      const doc = await ensureStories(c);
      const story = doc.stories.find((s) => s.key === request.params.key);
      if (story === undefined) return failure(404, "not_found", "No such story.");
      const test = body.test as { zone?: unknown; sound?: unknown } | undefined;
      if (test !== undefined && (typeof test.zone !== "string" || !ZONE.test(test.zone))) throw invalid("A test-fire names one zone.");
      if (test === undefined && !story.triggers.some((t) => t.kind === "take")) return failure(400, "invalid_request", "This story is not fired by hand.");
      if (test === undefined && !story.enabled) return failure(409, "not_running", "This story is off for the event.");
      const vars = (body.variables ?? {}) as Body;
      const variables: Record<string, string> = {};
      for (const name of freeVariablesOf(story)) {
        const v = vars[name];
        if (v !== undefined && (typeof v !== "string" || v.length > 120)) throw invalid(`{${name}} is a text of at most 120 characters.`);
        if (typeof v === "string" && VAR.test(name)) variables[name] = v.trim();
      }
      const needsItem = story.triggers.some((t) => t.kind === "item");
      const items = (await runOfShow(c)) ?? [];
      const item = typeof body.item_id === "string" ? (items.find((i) => i.id === body.item_id) ?? null) : null;
      if (typeof body.item_id === "string" && item === null) return failure(400, "invalid_request", "No such run-of-show item.");
      if (needsItem && item === null && test === undefined) return failure(400, "invalid_request", "Choose the item this story is about.");
      const ctx: Ctx = { c, engine: deps.engine, now, settings: doc.settings, event: doc.event };
      const fired = await takeStory(ctx, story, { item: item as never, variables, actor, test: test === undefined ? null : { zone: test.zone as string, sound: test.sound === true } });
      await deps.audit({
        tenant_id: tenantOf(request).tenant_id,
        actor_user_id: actor.user_id,
        action: test === undefined ? "moments.storyboard.fired" : "moments.storyboard.tested",
        target: { type: "storyboard", id: story.key },
        changes: { item_id: { old: null, new: item?.id ?? null }, variables: { old: null, new: variables } },
      });
      if ("not" in fired) return failure(409, "not_fired", `Not fired: ${fired.not}.`);
      return { status: 201, body: runView(fired.run, doc.stories) };
    }),
  );

  const onRun = (path: string, action: string, act: (ctx: Ctx, run: RunRow, story: Story) => Promise<void>) =>
    app.post<{ Params: { id: string } }>(`/api/moments/storyboards/runs/:id/${path}`, take, (request, reply) =>
      crewAction(deps, request, reply, async (c, actor, now) => {
        const doc = await ensureStories(c);
        const run = await lockRun(c, request.params.id);
        if (run === null) return failure(404, "not_found", "No such run.");
        if (run.status !== "live") return failure(409, "not_running", "This loop has ended.");
        const story = doc.stories.find((s) => s.key === run.story_key) ?? ({ name: run.story_key, finale: null } as unknown as Story);
        run.actor_user_id = actor.user_id;
        run.actor_name = actor.name;
        await act({ c, engine: deps.engine, now, settings: doc.settings, event: doc.event }, run, story);
        await deps.audit({ tenant_id: tenantOf(request).tenant_id, actor_user_id: actor.user_id, action, target: { type: "storyboard_run", id: run.id }, changes: {} });
        return { status: 200, body: runView(run, doc.stories) };
      }),
    );
  // Stop loop: the live round ends now, and no finale plays (fix 3).
  onRun("stop", "moments.storyboard.stopped", (ctx, run, story) => endRun(ctx, run, story, `stopped by ${run.actor_name ?? "the crew"}`, "stopped"));
  // Skip to finale: the finale at once, or the end without one.
  onRun("finale", "moments.storyboard.skipped", async (ctx, run, story) => {
    if (run.round !== null) await endRound(ctx, run, "cleared");
    await planEnd(ctx, run, story, `skipped to the finale by ${run.actor_name ?? "the crew"}`);
    if (run.status === "live") await saveRun(ctx.c, run);
  });
}
