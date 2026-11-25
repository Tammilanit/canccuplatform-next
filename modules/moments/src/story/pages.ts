/**
 * The Storyboards pages' routes (contracts/moments.md, Storyboards, Pages): the list, the
 * builder, and the crew's fire, test-fire, Stop loop and Skip to finale. Every change goes on to
 * the API as the same person (viaApi), so it has the API's rights, checks, revision and audit.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Html } from "@canccu/ui";
import { READ, SETTINGS, TAKE, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { PREFIX, page, pageNeeds, refusal, viaApi, zoneNames } from "../page-kit.js";
import { knownZones } from "../store.js";
import { loadCues } from "../cues/store.js";
import { canSee, runOfShow } from "../announce/store.js";
import { describeStory } from "./describe.js";
import { SAMPLE, itemFacts, fillText } from "./fill.js";
import type { FillContext } from "./fill.js";
import { one, stepAfter, storyFromForm } from "./form.js";
import type { Story } from "./model.js";
import { EMPTY_CONDITIONS } from "./model.js";
import { videoMs } from "./runner.js";
import { DEFAULT_SETTINGS, ensureStories } from "./store.js";
import type { StorySettings } from "./store.js";
import { duplicated, toggled } from "./picker.js";
import type { PickerItem } from "./picker.js";
import { pickerView } from "./picker-view.js";
import { builderHead, builderView } from "./builder.js";
import { fireResult, untilEventAt } from "./fire-words.js";
import { crewStories, fireChoices, takesWords } from "./views.js";
import type { ItemChoice, RunView } from "./views.js";

type Raw = Record<string, string | string[] | undefined>;
type Q = { Querystring: { edit?: string; step?: string; done?: string; error?: string } };

async function state(deps: AppDeps, request: FastifyRequest) {
  const a = await viaApi(request.server, request, "GET", "/api/moments/storyboards", {});
  const agenda = (await deps.db.tenant((c) => runOfShow(c))) ?? [];
  const rights = request.session?.rights ?? new Set<string>();
  // Fire lists only what the person may see, as the API takes only that (story/routes.ts).
  const items = agenda.filter(
    (i) => (i.status ?? "scheduled") === "scheduled" && canSee(i, rights),
  );
  return {
    stories: (a.body.stories ?? []) as Story[],
    revision: Number(a.body.revision ?? 0),
    settings: (a.body.settings ?? DEFAULT_SETTINGS) as StorySettings,
    timeZone: tenantOf(request).time_zone,
    runs: (a.body.runs ?? []) as RunView[],
    items: items.map((i): ItemChoice => ({
      id: i.id,
      title: i.title,
      kind: i.kind ?? "",
      starts_at: i.starts_at,
      ends_at: i.ends_at ?? null,
    })),
    now: deps.now().getTime(),
    agenda: agenda as PickerItem[],
  };
}

/** On air's and the phone's storyboards card (SU2). */
export async function storyCard(deps: AppDeps, request: FastifyRequest): Promise<Html> {
  const s = await state(deps, request);
  const canTake =
    request.session?.rights.has(TAKE) === true && tenantOf(request).status !== "archived";
  return crewStories({ ...s, canTake, back: "on-air" });
}

export function storyPages(pages: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: pageNeeds(deps, READ) };
  const write = { preHandler: pageNeeds(deps, SETTINGS) };
  const take = { preHandler: pageNeeds(deps, TAKE) };
  const has = (r: FastifyRequest, right: string) => r.session?.rights.has(right) === true;
  const raw = (r: FastifyRequest) => (r.body ?? {}) as Raw;
  const back = (reply: FastifyReply, path: string, key: "done" | "error", text: string) =>
    reply.redirect(
      `${PREFIX}${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`,
      303,
    );
  const after = (
    reply: FastifyReply,
    path: string,
    a: { status: number; body: Record<string, unknown> },
    done: string,
  ) => (a.status >= 400 ? back(reply, path, "error", refusal(a)) : back(reply, path, "done", done));
  /** Saves the list a change makes of the stored one, at the form's revision. */
  const putList = async (r: FastifyRequest, change: (s: Story[]) => Story[]) => {
    const doc = await deps.db.tenant((c) => ensureStories(c));
    return viaApi(pages, r, "PUT", "/api/moments/storyboards", {
      stories: change([...doc.stories]),
      revision: Number(one(raw(r).revision)),
    });
  };

  pages.get<Q>("/storyboards", read, async (request, reply) => {
    const s = await state(deps, request);
    const key = request.query.edit;
    const story = key === undefined ? undefined : s.stories.find((x) => x.key === key);
    const doc = await deps.db.tenant((c) => ensureStories(c));
    if (story === undefined)
      return page(request, reply, deps, {
        title: "Storyboards",
        tab: "storyboards",
        wide: true,
        description:
          "Sequences for the peaks, as data: triggers, rounds, a finale, a cue per step.",
        body: pickerView({
          ...s,
          ctx: { items: s.agenda, now: deps.now().getTime(), event: doc.event },
          canWrite: has(request, SETTINGS),
          canTake: has(request, TAKE),
          done: request.query.done,
          error: request.query.error,
        }),
      });
    const zones = await deps.db.tenant((c) => knownZones(c));
    const cues = (await deps.db.tenant((c) => loadCues(c))).map((c) => c.name);
    // The sample the builder fills placeholders with: the story's next item and the event, and
    // a test-fire's sample text for the rest, so the preview shows what a test-fire shows.
    const next = fireChoices(story, s.items, s.now)[0];
    const item = next === undefined ? undefined : s.agenda.find((i) => i.id === next.id);
    const fill: FillContext = {
      facts: item === undefined ? {} : itemFacts(item, doc.event.time_zone),
      sample: SAMPLE,
      now: s.now,
      t: item === undefined ? s.now : Date.parse(item.starts_at),
      timeZone: doc.event.time_zone,
      eventName: doc.event.name,
      eventStartsAt: doc.event.starts_at,
      eventEndsAt: doc.event.ends_at,
      hostname: doc.event.hostname,
    };
    const zoneName = await zoneNames(deps, request);
    const head = builderHead({
      story,
      zones,
      zoneName,
      canWrite: has(request, SETTINGS),
      canTake: has(request, TAKE),
    });
    return page(request, reply, deps, {
      title: story.name,
      tab: "storyboards",
      wide: true,
      crumb: { href: `${PREFIX}storyboards`, label: "Storyboards" },
      description: head.description,
      actions: head.actions,
      body: builderView({
        story,
        d: describeStory(story, doc.settings, (c) => videoMs({ content: c })),
        settings: doc.settings,
        zones,
        zoneName,
        cues,
        revision: s.revision,
        canWrite: has(request, SETTINGS),
        canTake: has(request, TAKE),
        step: Number(request.query.step ?? 0) || 0,
        sample: (text) => fillText(text, fill),
        done: request.query.done,
        error: request.query.error,
      }),
    });
  });

  pages.post<{ Params: { key: string } }>(
    "/storyboards/:key/save",
    write,
    async (request, reply) => {
      let step = 0;
      const a = await putList(request, (list) =>
        list.map((s) => {
          if (s.key !== request.params.key) return s;
          const saved = storyFromForm(raw(request), s);
          step = stepAfter(raw(request), saved);
          return saved;
        }),
      );
      const path = `storyboards?edit=${request.params.key}&step=${String(step)}`;
      return after(reply, path, a, "Saved.");
    },
  );

  pages.post<{ Params: { key: string } }>(
    "/storyboards/:key/toggle",
    write,
    async (request, reply) => {
      const a = await putList(request, (list) => toggled(list, request.params.key));
      return after(reply, "storyboards", a, "Saved.");
    },
  );

  pages.post<{ Params: { key: string } }>(
    "/storyboards/:key/duplicate",
    write,
    async (request, reply) => {
      let key = request.params.key;
      const a = await putList(request, (list) => {
        const d = duplicated(list, request.params.key);
        key = d.key;
        return d.list;
      });
      return a.status >= 400
        ? back(reply, "storyboards", "error", refusal(a))
        : reply.redirect(`${PREFIX}storyboards?edit=${key}`, 303);
    },
  );

  pages.post("/storyboards/reset", write, async (request, reply) => {
    const a = await viaApi(pages, request, "POST", "/api/moments/storyboards/reset", {
      revision: Number(one(raw(request).revision)),
    });
    return after(reply, "storyboards", a, "Every preset is back to the platform's.");
  });

  pages.post("/storyboards/new", write, async (request, reply) => {
    const doc = await deps.db.tenant((c) => ensureStories(c));
    let n = 1;
    while (doc.stories.some((s) => s.key === `story_${String(n)}`)) n += 1;
    const key = `story_${String(n)}`;
    const fresh: Story = {
      key,
      name: `New story ${String(n)}`,
      preset: null,
      enabled: false,
      triggers: [{ kind: "take" }],
      conditions: { ...EMPTY_CONDITIONS },
      run_mode: "per_source",
      full_screen: false,
      round: {
        steps: [
          {
            template: "title_card",
            content: { title: "{event.name}", subtitle: "", image_url: null },
            duration_seconds: 20,
            transition: "rise",
            cue: null,
            on_the_dot: false,
            message: true,
          },
        ],
        repeat: null,
        hold_seconds: null,
      },
      rounds: { mode: "offsets", offsets_minutes: [0] },
      end: { rounds: 1, for_minutes: null, until_clock: null, until_event: null, crew: true },
      finale: null,
      sound: "first",
    };
    const a = await putList(request, (list) => [...list, fresh]);
    return a.status >= 400
      ? back(reply, "storyboards", "error", refusal(a))
      : reply.redirect(`${PREFIX}storyboards?edit=${key}`, 303);
  });

  pages.post<{ Params: { key: string } }>(
    "/storyboards/:key/reset",
    write,
    async (request, reply) => {
      const a = await viaApi(pages, request, "POST", "/api/moments/storyboards/reset", {
        key: request.params.key,
        revision: Number(one(raw(request).revision)),
      });
      return after(reply, "storyboards", a, "Back to the platform's preset.");
    },
  );

  pages.post<{ Params: { key: string } }>(
    "/storyboards/:key/fire",
    take,
    async (request, reply) => {
      const f = raw(request);
      const to = one(f.back) === "storyboards" ? "storyboards" : "on-air";
      // Only this story's inputs (story/views.ts): another story's value never fills its texts.
      const own = `var-${request.params.key}-`;
      const variables = Object.fromEntries(
        Object.entries(f)
          .filter(([k]) => k.startsWith(own))
          .map(([k, v]) => [k.slice(own.length), one(v)]),
      );
      const s = await state(deps, request);
      const story = s.stories.find((x) => x.key === request.params.key);
      // One picker serves every story on On air (#638): a story fired on no item ignores it, and
      // one that takes only some kinds says which, rather than run on an item it does not take.
      const onItem = story?.triggers.some((t) => t.kind === "item") === true;
      const item = onItem ? one(f.item_id) : "";
      if (
        story !== undefined &&
        item !== "" &&
        !fireChoices(story, s.items, s.now).some((i) => i.id === item)
      ) {
        const title = s.items.find((i) => i.id === item)?.title ?? "this item";
        return back(
          reply,
          to,
          "error",
          `${story.name} does not take ${title}: pick ${takesWords(story)}.`,
        );
      }
      const a = await viaApi(
        pages,
        request,
        "POST",
        `/api/moments/storyboards/${request.params.key}/take`,
        { variables, ...(item === "" ? {} : { item_id: item }) },
      );
      if (a.status >= 400 || story === undefined) return after(reply, to, a, "Fired.");
      // The take's own time (the run's start), not this page's earlier read: a round due at the
      // fire is on now, not "starts at" a minute already gone.
      const firedAt = Date.parse(String(a.body.started_at));
      const t = Date.parse(String(a.body.t));
      const done = fireResult({
        story,
        t,
        anchored: item !== "",
        settings: s.settings,
        startedAt: firedAt,
        untilAt: untilEventAt(
          story,
          s.agenda.find((i) => i.id === item),
          s.agenda,
          t,
        ),
        now: firedAt,
        timeZone: s.timeZone,
      });
      return back(reply, to, "done", done);
    },
  );

  pages.post<{ Params: { key: string } }>(
    "/storyboards/:key/test",
    take,
    async (request, reply) => {
      const f = raw(request);
      const a = await viaApi(
        pages,
        request,
        "POST",
        `/api/moments/storyboards/${request.params.key}/take`,
        { test: { zone: one(f.zone), sound: one(f.sound) === "yes" } },
      );
      return after(
        reply,
        `storyboards?edit=${request.params.key}`,
        a,
        `One test round on ${(await zoneNames(deps, request))(one(f.zone))}.`,
      );
    },
  );

  for (const [path, done] of [
    ["stop", "Loop stopped."],
    ["finale", "Skipped to the finale."],
  ] as const)
    pages.post<{ Params: { id: string } }>(
      `/storyboards/runs/:id/${path}`,
      take,
      async (request, reply) => {
        const a = await viaApi(
          pages,
          request,
          "POST",
          `/api/moments/storyboards/runs/${request.params.id}/${path}`,
          {},
        );
        return after(
          reply,
          one(raw(request).back) === "storyboards" ? "storyboards" : "on-air",
          a,
          done,
        );
      },
    );
}
