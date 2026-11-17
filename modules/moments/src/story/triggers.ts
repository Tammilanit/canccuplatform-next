/**
 * The six trigger kinds (the storyboards plan, Triggers as decided; SD2): `item` and `clock`
 * are looked at on every tick, so a run starts when its first round's time comes (its offset and
 * the on-the-dot lead before T) and, after a restart, while a round of it is still due; `scene`
 * and `milestone` compare what the tick saw last; `domain` comes with its event, which may also
 * end a run (`until_event`); `take` is a person's (routes). A take of a story with an item
 * trigger asks for the item, so its rounds still count from the item's time (SU3).
 */
import type { Event } from "@canccu/kit";
import type { Engine } from "../engine.js";
import { runOfShow } from "../announce/store.js";
import type { RunItem } from "../announce/store.js";
import type { Actor } from "../store.js";
import { domainFacts, domainSource, itemFacts } from "./fill.js";
import { fireStory } from "./fire.js";
import type { Fired, Occurrence } from "./fire.js";
import { roundCount } from "./model.js";
import type { Story, Trigger } from "./model.js";
import type { Ctx } from "./round.js";
import { compiledOf, planEnd, tickRuns } from "./runner.js";
import { clockTimes, patienceMs, roundAt } from "./schedule.js";
import { ensureStories, liveRuns, readMark, runSince, writeMark } from "./store.js";

type Item = RunItem & { ends_at?: string | null; zone?: string | null };

/** From the first round's time to the last one's patience (or the end event's), a run may start. */
function fireWindow(s: Story, t: number, lead: number): [number, number] {
  const from = roundAt(s, t, 0, lead) ?? t;
  const n = roundCount(s);
  const last = n === null ? from : (roundAt(s, t, n - 1, lead) ?? from);
  const u = s.end.until_event?.kind;
  const until = Math.max(last, u === "item_starts" || u === "item_ends" ? t : from);
  return [from, until + patienceMs(s)];
}

const energyOf = (engine: Engine) => async (zone: string) =>
  (await engine.sound?.energy(zone)) ?? null;

async function fireOnce(ctx: Ctx, s: Story, o: Occurrence): Promise<void> {
  if ((await runSince(ctx.c, s.key, o.source, new Date(0))) !== null) return;
  await fireStory(ctx, s, o, energyOf(ctx.engine));
}

async function itemTriggers(
  ctx: Ctx,
  s: Story,
  t: Extract<Trigger, { kind: "item" }>,
  items: Item[],
): Promise<void> {
  const lead = compiledOf(s, ctx).lead_ms;
  const at = ctx.now.getTime();
  for (const item of items) {
    if ((item.visibility ?? "public") !== "public" || (item.status ?? "scheduled") !== "scheduled")
      continue;
    if (t.item_id !== null ? item.id !== t.item_id : !t.kinds.includes(item.kind ?? "")) continue;
    const when = t.anchor === "end" ? item.ends_at : item.starts_at;
    if (when == null) continue;
    const T = Date.parse(when);
    const [from, until] = fireWindow(s, T, lead);
    if (at < from || at > until) continue;
    await fireOnce(ctx, s, {
      kind: "item",
      source: `item:${item.id}`,
      t: T,
      item_id: item.id,
      zone: item.zone ?? null,
      facts: itemFacts(item, ctx.event.time_zone),
      why: `item: ${item.title} (${t.anchor})`,
    });
  }
}

async function clockTriggers(
  ctx: Ctx,
  s: Story,
  t: Extract<Trigger, { kind: "clock" }>,
): Promise<void> {
  const lead = compiledOf(s, ctx).lead_ms;
  const at = ctx.now.getTime();
  const first = roundAt(s, 0, 0, lead) ?? 0;
  const times = clockTimes(
    t,
    { starts_at: ctx.event.starts_at, ends_at: ctx.event.ends_at, timeZone: ctx.event.time_zone },
    at,
    Math.max(0, -first),
  );
  for (const T of times) {
    const [from, until] = fireWindow(s, T, lead);
    if (at < from || at > until) continue;
    const iso = new Date(T).toISOString();
    await fireOnce(ctx, s, {
      kind: "clock",
      source: `clock:${iso}`,
      t: T,
      item_id: null,
      zone: null,
      facts: {},
      why: `clock: ${t.mode} ${t.at ?? ""}`.trim(),
    });
  }
}

/** Each zone's scene as the tick last saw it: a change fires `enters` and `leaves`. */
async function sceneTriggers(ctx: Ctx, stories: Story[]): Promise<void> {
  const { rows } = await ctx.c.query(
    `SELECT zone_key, scene_key, sent FROM moments_scene_zones`,
    [],
  );
  const now = Object.fromEntries(
    rows.map((r) => [r.zone_key as string, (r.scene_key as string | null) ?? ""]),
  );
  const before = await readMark<Record<string, string>>(ctx.c, "scenes");
  if (JSON.stringify(before) !== JSON.stringify(now)) await writeMark(ctx.c, "scenes", now);
  if (before === null) return;
  for (const r of rows) {
    const zone = r.zone_key as string;
    const from = before[zone] ?? "";
    const to = now[zone] ?? "";
    if (from === to) continue;
    const sceneName = (r.sent as { scene?: { name?: unknown } | null }).scene?.name;
    const name = typeof sceneName === "string" ? sceneName : to;
    for (const s of stories)
      for (const t of s.triggers) {
        if (t.kind !== "scene") continue;
        const hit = t.change === "enters" ? t.scene_key === to : t.scene_key === from;
        if (!hit) continue;
        await fireStory(
          ctx,
          s,
          {
            kind: "scene",
            source: `scene:${zone}:${ctx.now.toISOString()}`,
            t: ctx.now.getTime(),
            item_id: null,
            zone,
            facts: { "scene.name": name },
            why: `scene ${t.scene_key} ${t.change} on ${zone}`,
          },
          energyOf(ctx.engine),
        );
      }
  }
}

async function countOf(ctx: Ctx, count: string): Promise<number | null> {
  if (count === "online") {
    const { rows } = await ctx.c.query(
      `SELECT data FROM moments_sources WHERE kind = 'presence' AND ref = ''`,
      [],
    );
    const online = (rows[0]?.data as { online?: unknown } | undefined)?.online;
    return typeof online === "number" ? online : null;
  }
  return readMark<number>(ctx.c, `count:${count}`);
}

async function milestoneTriggers(
  ctx: Ctx,
  s: Story,
  t: Extract<Trigger, { kind: "milestone" }>,
  i: number,
): Promise<void> {
  const value = await countOf(ctx, t.count);
  if (value === null) return;
  const key = `ms:${s.key}:${String(i)}`;
  const seen = await readMark<{ last: number; peak: number }>(ctx.c, key);
  await writeMark(ctx.c, key, { last: value, peak: Math.max(value, seen?.peak ?? value) });
  if (seen === null) return;
  const crossed = t.at === null ? value > seen.peak : seen.last < t.at && value >= t.at;
  if (!crossed) return;
  await fireStory(
    ctx,
    s,
    {
      kind: "milestone",
      source: `milestone:${t.count}:${String(value)}`,
      t: ctx.now.getTime(),
      item_id: null,
      zone: null,
      facts: { "milestone.value": String(value) },
      why: `milestone: ${t.count} ${String(value)}`,
    },
    energyOf(ctx.engine),
  );
}

/** The tick's turn: copy the presets on first use, fire what is due, then run the live runs. */
export async function tickStories(ctx: Omit<Ctx, "settings" | "event">): Promise<void> {
  const doc = await ensureStories(ctx.c);
  const full: Ctx = { ...ctx, settings: doc.settings, event: doc.event };
  const on = doc.stories.filter((s) => s.enabled);
  const items = ((await runOfShow(ctx.c)) ?? []) as Item[];
  for (const s of on) {
    for (const [i, t] of s.triggers.entries()) {
      if (t.kind === "item") await itemTriggers(full, s, t, items);
      else if (t.kind === "clock") await clockTriggers(full, s, t);
      else if (t.kind === "milestone") await milestoneTriggers(full, s, t, i);
    }
  }
  if (on.some((s) => s.triggers.some((t) => t.kind === "scene"))) await sceneTriggers(full, on);
  await tickRuns(ctx.c, ctx.engine, ctx.now);
}

/** A domain event: the stories it starts, and the runs whose `until_event` it is. */
export async function storyEvent(ctx: Omit<Ctx, "settings" | "event">, e: Event): Promise<void> {
  if (e.type === "notify.checkin.recorded" && e.data.purpose === "arrival")
    await bump(ctx, "checkins");
  if (e.type === "screen.photo.added") await bump(ctx, "photos");
  const doc = await ensureStories(ctx.c);
  const full: Ctx = { ...ctx, settings: doc.settings, event: doc.event };
  const source = domainSource(e.type, e.data);
  for (const run of await liveRuns(ctx.c)) {
    const s = doc.stories.find((x) => x.key === run.story_key);
    const u = s?.end.until_event;
    if (
      s !== undefined &&
      u?.kind === "domain" &&
      u.type === e.type &&
      source !== null &&
      run.source === source
    )
      await planEnd(full, run, s, e.type);
  }
  if (source === null) return;
  for (const s of doc.stories.filter((x) => x.enabled)) {
    const t = s.triggers.find((x) => x.kind === "domain" && x.type === e.type);
    if (t?.kind !== "domain") continue;
    if (t.final_only && (e.data.session as { is_final?: unknown } | undefined)?.is_final !== true)
      continue;
    const facts = {
      ...domainFacts(e.type, e.data, full.event.time_zone),
      "@happening": `${e.type}:${source.slice(source.indexOf(":") + 1)}`,
    };
    await fireStory(
      full,
      s,
      {
        kind: "domain",
        source,
        t: full.now.getTime(),
        item_id: null,
        zone: null,
        facts,
        why: `event: ${e.type}`,
      },
      energyOf(ctx.engine),
    );
  }
}

async function bump(ctx: Omit<Ctx, "settings" | "event">, count: string): Promise<void> {
  const n = (await readMark<number>(ctx.c, `count:${count}`)) ?? 0;
  await writeMark(ctx.c, `count:${count}`, n + 1);
}

/** A person fires a story (`moments.take`): with its item when it has an item trigger (SU3). */
export async function takeStory(
  ctx: Ctx,
  s: Story,
  o: {
    item: Item | null;
    variables: Record<string, string>;
    actor: Actor;
    test: { zone: string; sound: boolean } | null;
  },
): Promise<Fired> {
  const it = s.triggers.find((t) => t.kind === "item");
  const anchor = it?.kind === "item" ? it.anchor : "start";
  const at =
    o.item === null
      ? null
      : anchor === "end" && o.item.ends_at != null
        ? o.item.ends_at
        : o.item.starts_at;
  const facts = {
    ...(o.item === null ? {} : itemFacts(o.item, ctx.event.time_zone)),
    ...o.variables,
  };
  const source = o.item === null ? `take:${ctx.now.toISOString()}` : `item:${o.item.id}`;
  return fireStory(
    ctx,
    s,
    {
      kind: "take",
      source,
      t: at === null ? ctx.now.getTime() : Date.parse(at),
      item_id: o.item?.id ?? null,
      zone: o.item?.zone ?? null,
      facts,
      why: `${o.actor.name} · ${o.test === null ? "fired" : "test-fire"} ${s.name}`,
      actor: o.actor,
      test: o.test,
    },
    energyOf(ctx.engine),
  );
}
