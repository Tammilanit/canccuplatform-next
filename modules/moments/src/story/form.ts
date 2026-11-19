/**
 * The builder's form as a story (mockup 18, step 4 polish sheet 05): plain fields per trigger and
 * per step, so an organiser edits a story without code; the API checks the result. Fields the form
 * does not show (a widget's other view-model fields) are kept from the story as it was. A step's
 * fields keep the index it was drawn with; `order` (the strip as dragged) and `move` (a step's
 * Move button) only reorder them.
 */
import { DOMAIN_TYPES, EMPTY_CONDITIONS } from "./model.js";
import type { Conditions, Story, StoryStep, Trigger, UntilEvent } from "./model.js";

type Raw = Record<string, string | string[] | undefined>;

export const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const all = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => x.trim()).filter(Boolean);
/** Every value of a field, each split at commas: a list field, or one chip's field per entry. */
const csv = (v: string | string[] | undefined): string[] =>
  all(v)
    .flatMap((x) => x.split(","))
    .map((x) => x.trim())
    .filter(Boolean);
const num = (v: string | string[] | undefined): number | null => {
  const x = one(v).replace("−", "-");
  return x === "" ? null : Number(x);
};
const or = <T>(v: string, xs: readonly T[], d: T): T =>
  (xs as readonly string[]).includes(v) ? (v as T) : d;

/** The step templates the builder offers; `video` plays a Screen asset full screen. */
export const STEP_TEMPLATES = [
  "title_card",
  "sting",
  "countdown",
  "qr",
  "video",
  "match_called",
  "winner_card",
  "bracket",
  "photo",
  "agenda_now",
] as const;
export const ADD_TRIGGERS = ["item", "domain", "clock", "take", "scene", "milestone"] as const;

export function newTrigger(kind: string): Trigger {
  switch (kind) {
    case "item":
      return { kind: "item", kinds: ["tournament"], item_id: null, anchor: "start" };
    case "domain":
      return { kind: "domain", type: "tournament.match.called", final_only: false };
    case "clock":
      return {
        kind: "clock",
        mode: "daily",
        at: "12:00",
        every_minutes: null,
        from: null,
        until: null,
      };
    case "scene":
      return { kind: "scene", scene_key: "peak", change: "enters" };
    case "milestone":
      return { kind: "milestone", count: "online", at: null };
    default:
      return { kind: "take" };
  }
}

function triggerOf(f: Raw, i: number, before: Trigger): Trigger {
  const p = (k: string) => f[`t${String(i)}_${k}`];
  switch (before.kind) {
    case "item":
      return {
        kind: "item",
        kinds: csv(p("kinds")),
        item_id: one(p("item_id")) || null,
        anchor: one(p("anchor")) === "end" ? "end" : "start",
      };
    case "domain":
      return {
        kind: "domain",
        type: or(one(p("type")), Object.keys(DOMAIN_TYPES), before.type),
        final_only: one(p("final")) === "yes",
      };
    case "clock": {
      const mode = or(
        one(p("mode")),
        ["once", "daily", "event_start", "event_end", "every"] as const,
        before.mode,
      );
      return {
        kind: "clock",
        mode,
        at: one(p("at")) || null,
        every_minutes: num(p("every")),
        from: one(p("from")) || null,
        until: one(p("until")) || null,
      };
    }
    case "scene":
      return {
        kind: "scene",
        scene_key: one(p("scene")),
        change: one(p("change")) === "leaves" ? "leaves" : "enters",
      };
    case "milestone":
      return {
        kind: "milestone",
        count: or(one(p("count")), ["checkins", "online", "photos"] as const, before.count),
        at: num(p("value")),
      };
    case "take":
      return before;
  }
}

function contentOf(
  f: Raw,
  i: number,
  template: string,
  before: Record<string, unknown>,
): Record<string, unknown> {
  const p = (k: string) => one(f[`s${String(i)}_${k}`]);
  const qr =
    p("qr_path") === ""
      ? {}
      : { qr: { path: p("qr_path"), label: p("qr_label") || "Open the hub" } };
  switch (template) {
    case "title_card": {
      const rest = { ...before };
      delete rest.qr;
      return {
        ...rest,
        title: p("title"),
        subtitle: p("subtitle"),
        image_url: before.image_url ?? null,
        ...qr,
      };
    }
    case "sting":
      return { ...before, text: p("title"), image_url: before.image_url ?? null };
    case "countdown":
      return {
        ...before,
        label: p("title"),
        target_at: before.target_at ?? "",
        ends_text: p("subtitle"),
      };
    case "qr":
      return {
        qr: {
          path: p("qr_path") || "/notify/",
          label: p("qr_label") || p("title") || "Open the hub",
        },
      };
    case "video": {
      const seconds = num(f[`s${String(i)}_video_seconds`]);
      return { asset_id: p("asset"), ...(seconds === null ? {} : { duration_seconds: seconds }) };
    }
    default:
      return before;
  }
}

function stepOf(f: Raw, i: number, before: StoryStep | undefined): StoryStep {
  const p = (k: string) => one(f[`s${String(i)}_${k}`]);
  const template = or(p("template"), STEP_TEMPLATES, "title_card");
  const kept = before?.template === template ? before.content : {};
  return {
    template,
    content: contentOf(f, i, template, kept),
    duration_seconds: num(f[`s${String(i)}_seconds`]) ?? 20,
    transition: or(p("transition"), ["cut", "fade", "rise", "slide", "flash"] as const, "fade"),
    cue: p("cue") || null,
    on_the_dot: one(f.dot) === String(i),
    message: one(f.message) === String(i),
  };
}

/** The indices `order` lists, when it lists each step once; else the steps as they were. */
function orderOf(v: string, n: number): number[] {
  const xs = v === "" ? [] : v.split(",").map(Number);
  const whole = xs.length === n && [...xs].sort((a, b) => a - b).every((x, i) => x === i);
  return whole ? xs : Array.from({ length: n }, (_, i) => i);
}

/** `move` is `<position>:<by>`, a position in the order after `order`; by is −1 or 1. */
function moveOf(v: string): { at: number; by: number } | null {
  const m = /^(\d+):(-?1)$/.exec(v);
  return m === null ? null : { at: Number(m[1]), by: Number(m[2]) };
}

function arranged<T>(xs: T[], f: Raw): T[] {
  const out = orderOf(one(f.order), xs.length).map((i) => xs[i] as T);
  const m = moveOf(one(f.move));
  const to = m === null ? -1 : m.at + m.by;
  if (m !== null && m.at < out.length && to >= 0 && to < out.length)
    [out[m.at], out[to]] = [out[to] as T, out[m.at] as T];
  return out;
}

/** The step the builder opens after a save: an added one, a moved one, or the one it had open. */
export function stepAfter(f: Raw, saved: Story): number {
  const last = Math.max(0, saved.round.steps.length - 1);
  if (one(f.add_step) === "yes") return last;
  const m = moveOf(one(f.move));
  const at = m === null ? Number(one(f.step)) : m.at + m.by;
  return Number.isInteger(at) ? Math.max(0, Math.min(at, last)) : 0;
}

function untilOf(v: string): UntilEvent | null {
  if (v === "item_starts" || v === "item_ends" || v === "next_item_starts") return { kind: v };
  if (v.startsWith("domain:")) return { kind: "domain", type: v.slice(7) };
  return null;
}

/** The story the form describes; `add_trigger`, `add_step` and the remove boxes change its shape. */
export function storyFromForm(f: Raw, before: Story): Story {
  const triggers = before.triggers
    .map((t, i) => ({ t: triggerOf(f, i, t), drop: one(f[`t${String(i)}_remove`]) === "yes" }))
    .filter((x) => !x.drop)
    .map((x) => x.t);
  if (one(f.add_trigger) !== "") triggers.push(newTrigger(one(f.add_trigger)));
  const read = before.round.steps.map((s, i) => ({
    s: stepOf(f, i, s),
    drop: one(f[`s${String(i)}_remove`]) === "yes",
  }));
  const steps = arranged(read, f)
    .filter((x) => !x.drop)
    .map((x) => x.s);
  if (one(f.add_step) === "yes")
    steps.push({
      template: "title_card",
      content: { title: "", subtitle: "", image_url: null },
      duration_seconds: 20,
      transition: "rise",
      cue: null,
      on_the_dot: false,
      message: false,
    });
  const times = num(f.repeat_times);
  const from = num(f.repeat_from);
  const to = num(f.repeat_to);
  const conditions: Conditions = {
    ...EMPTY_CONDITIONS,
    zones: all(f.zone),
    item_zone: one(f.item_zone) === "yes",
    scenes: csv(f.scenes),
    not_scenes: csv(f.not_scenes),
    energy_min: (one(f.energy_min) || null) as Conditions["energy_min"],
    energy_max: (one(f.energy_max) || null) as Conditions["energy_max"],
    window:
      one(f.window_from) === "" ? null : { from: one(f.window_from), until: one(f.window_until) },
    days: csv(f.days),
    once: (one(f.once) || null) as Conditions["once"],
    cooldown_minutes: num(f.cooldown) ?? 0,
    quiet: one(f.quiet) === "skip" ? "skip" : "calm",
  };
  const finaleTitle = one(f.finale_title);
  const firstFinale = before.finale?.[0];
  const finale: StoryStep[] | null =
    finaleTitle === ""
      ? null
      : [
          {
            template: firstFinale?.template ?? "title_card",
            content: {
              ...(firstFinale?.content ?? { subtitle: "", image_url: null }),
              title: finaleTitle,
            },
            duration_seconds: num(f.finale_seconds) ?? 8,
            transition: firstFinale?.transition ?? "flash",
            cue: one(f.finale_cue) || null,
            on_the_dot: false,
            message: false,
          },
          ...(before.finale?.slice(1) ?? []),
        ];
  return {
    ...before,
    name: one(f.name),
    enabled: one(f.enabled) === "yes",
    full_screen: one(f.full_screen) === "yes",
    run_mode: or(one(f.run_mode), ["per_source", "restart", "ignore"] as const, "per_source"),
    sound: or(one(f.sound), ["first", "every", "last", "first_and_last"] as const, "first"),
    triggers,
    conditions,
    round: {
      steps,
      repeat:
        times === null || from === null || to === null
          ? null
          : { from: from - 1, to: to - 1, times },
      hold_seconds: num(f.hold_seconds),
    },
    rounds:
      one(f.rounds_mode) === "every"
        ? { mode: "every", every_minutes: num(f.every) ?? 10, from_minutes: num(f.every_from) ?? 0 }
        : {
            mode: "offsets",
            offsets_minutes: csv(f.offsets).map((x) => Number(x.replace("−", "-"))),
          },
    end: {
      rounds: num(f.end_rounds),
      for_minutes: num(f.end_for),
      until_clock: one(f.end_clock) || null,
      until_event: untilOf(one(f.end_event)),
      crew: one(f.end_crew) === "yes",
    },
    finale,
  };
}
