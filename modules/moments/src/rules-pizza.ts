/**
 * Food as hero moments (#787 D8, sheet 02; contracts/moments.md, Built-in rules): the `pizza`
 * rule's order open, last call, on the way and Pizza is here. Each takes the hero first, then the
 * food box, then the ticker (D7), and covers the food box, so no other box repeats it. One order
 * has one of them at a time: each new stage ends the one before.
 */
import type { Event, SqlClient } from "@canccu/kit";
import { chainOf } from "./announce/chain.js";
import type { Engine } from "./engine.js";
import type { RuleSettings } from "./rules.js";
import { lockRunningByKey } from "./store.js";

type Data = Record<string, unknown>;
const obj = (v: unknown): Data => (typeof v === "object" && v !== null ? (v as Data) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Pizza is here's on-air time: #775's hold of the hero. */
const PIZZA_HERE_TTL_SECONDS = 180;
/** How long on the way stays after its estimate, should the arrival come late. */
const PAST_ESTIMATE_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 7200;

/** The order's own words, as the food box tells it (Screen draws the box's view in their place). */
export function orderContent(o: Data): Data {
  return {
    state: str(o.state) ?? "",
    seq: o.seq ?? null,
    pizzeria_name: str(obj(o.pizzeria).name) ?? "",
    target_at: o.target_at ?? null,
    closes_at: o.closes_at ?? null,
    estimate_at: o.estimate_at ?? null,
    pizza_count: o.pizza_count ?? 0,
    people_count: o.people_count ?? 0,
    holder_name: str(obj(o.holder).name),
  };
}

/** Seconds from `now` to `at` and `after` more, at least `least`: a moment as long as its time. */
function ttlUntil(at: unknown, now: Date, least: number, after = 0): number {
  const ms = typeof at === "string" ? Date.parse(at) : NaN;
  if (Number.isNaN(ms)) return least;
  const s = Math.ceil((ms - now.getTime()) / 1000) + after;
  return Math.min(MAX_TTL_SECONDS, Math.max(least, s));
}

/** Each stage's moment: its key, its kicker and cue, and how long it lasts. */
const STAGES = {
  open: { key: "pizza-open", title: "Pizza order open", cue: "pizza.open" },
  last_call: { key: "pizza-last-call", title: "Last call", cue: "pizza.last_call" },
  // The key the rule's placed order always had, so a running one carries on.
  on_the_way: { key: "pizza", title: "On the way", cue: null },
} as const;
type Stage = keyof typeof STAGES;

/** What each event ends of the order's moments before it starts its own. */
const ENDS: Readonly<Record<string, readonly Stage[]>> = {
  "pizza.order.closing": ["open"],
  "pizza.order.closed": ["open", "last_call"],
  "pizza.order.placed": ["open", "last_call"],
  "pizza.order.arrived": ["open", "last_call", "on_the_way"],
  "pizza.order.cancelled": ["open", "last_call", "on_the_way"],
  "pizza.order.done": ["open", "last_call", "on_the_way"],
};

export async function pizzaMoments(
  c: SqlClient,
  engine: Engine,
  e: Event,
  now: Date,
  s: RuleSettings,
): Promise<void> {
  const o = obj(e.data.order);
  const id = str(o.id) ?? "";
  if (id === "" || !e.type.startsWith("pizza.order.")) return;
  for (const stage of ENDS[e.type] ?? []) {
    const m = await lockRunningByKey(c, `${STAGES[stage].key}:${id}`);
    if (m !== null) await engine.end(c, m, "source_ended", null, now);
  }
  await pizzaIsHere(c, engine, e, now, s);
  if (!s.enabled) return;
  const show = (stage: Stage, ttl: number, cue: string | null) =>
    engine.request(
      c,
      {
        class: s.class,
        template: s.template,
        content: { ...orderContent(o), title: STAGES[stage].title },
        origin: "rule",
        rule_id: "pizza",
        why: `rule: ${e.type}`,
        regions: s.regions,
        ttl_seconds: ttl,
        zones: s.zones,
        source: { module: e.source, event_id: e.id, ref: id },
        dedupe_key: `${STAGES[stage].key}:${id}`,
        binding: null,
        cue,
        happening: `${e.type}:${id}`,
      },
      now,
    );
  if (e.type === "pizza.order.opened")
    await show("open", ttlUntil(o.closes_at, now, s.ttl_seconds), STAGES.open.cue);
  else if (e.type === "pizza.order.closing")
    await show(
      "last_call",
      ttlUntil(e.data.closes_at ?? o.closes_at, now, 60),
      STAGES.last_call.cue,
    );
  else if (e.type === "pizza.order.placed")
    await show(
      "on_the_way",
      ttlUntil(o.estimate_at, now, s.ttl_seconds, PAST_ESTIMATE_SECONDS),
      s.cue,
    );
  else if (e.type === "pizza.order.changed") {
    // A new close or estimate, in place: only for the stage that runs, never a new one.
    const stage: Stage = str(o.state) === "open" ? "open" : "on_the_way";
    if ((await lockRunningByKey(c, `${STAGES[stage].key}:${id}`)) === null) return;
    const ttl =
      stage === "open"
        ? ttlUntil(o.closes_at, now, s.ttl_seconds)
        : ttlUntil(o.estimate_at, now, s.ttl_seconds, PAST_ESTIMATE_SECONDS);
    await show(stage, ttl, null);
  }
}

/**
 * Pizza is here (#777, contracts/moments.md, Built-in rules): the `pizza` rule's arrival is an
 * announcement that takes the hero, waits in the rail while the hero is held, and degrades to
 * the ticker; the food box keeps the order's state. It ends on the order's done or cancel.
 */
async function pizzaIsHere(
  c: SqlClient,
  engine: Engine,
  e: Event,
  now: Date,
  s: RuleSettings,
): Promise<void> {
  const o = obj(e.data.order);
  const id = str(o.id) ?? "";
  const key = `order-arrived:${id}`;
  if (e.type === "pizza.order.done" || e.type === "pizza.order.cancelled") {
    const m = await lockRunningByKey(c, key);
    if (m !== null) await engine.end(c, m, "source_ended", null, now);
    return;
  }
  if (e.type !== "pizza.order.arrived" || !s.enabled) return;
  const seq = typeof o.seq === "number" ? String(o.seq) : "ready";
  const pickup = `Collect at ${str(o.pickup) ?? "the pickup point"}`;
  const body = `Order ${seq} · ${pickup}`;
  const expires = new Date(now.getTime() + PIZZA_HERE_TTL_SECONDS * 1000);
  await engine.request(
    c,
    {
      class: "announcement",
      template: "announcement",
      content: {
        title: "Pizza is here",
        body,
        level: "important",
        placement: "hero",
        icon: "food",
        art: { kind: "food", url: null },
        starts_at: now.toISOString(),
        expires_at: expires.toISOString(),
        countdown_at: null,
        // The second beat of a full screen: where to go, apart from the order's number.
        second_line: pickup,
        // A path: Screen makes it whole on the event's hostname, which a rule does not know.
        qr: { url: `/pizza/orders/${id}`, label: "Your order" },
        updated: false,
        ticker_line: `Pizza is here · ${body}`,
      },
      origin: "rule",
      rule_id: "pizza",
      why: `rule: ${e.type}`,
      regions: chainOf("important", "hero").regions,
      ttl_seconds: PIZZA_HERE_TTL_SECONDS,
      zones: s.zones,
      source: { module: e.source, event_id: e.id, ref: id },
      dedupe_key: key,
      cue: s.cue,
      happening: `${e.type}:${id}`,
    },
    now,
  );
}
