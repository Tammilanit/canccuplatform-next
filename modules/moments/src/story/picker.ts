/**
 * The preset picker's words and changes (mockup 21; the storyboards plan, The preset catalogue
 * (final), SD8, WD2): each story's trigger, rounds and sound in a few words, its status against
 * the run of show and the clock, the rule it replaces, turning one on or off and duplicate to
 * edit. Pure: the page reads the stories, the run of show and the event, then saves through the API.
 */
import type { Story, Trigger } from "./model.js";
import { PROVISIONAL, isVideo } from "./model.js";
import { FOLLOWS, RULE_OF_PRESET, presetOf } from "./presets.js";
import { localParts } from "./schedule.js";
import type { EventFacts } from "./store.js";
import { capital, eventWords } from "./words.js";

export interface PickerItem {
  id: string;
  title: string;
  kind?: string;
  starts_at: string;
  ends_at?: string | null;
  status?: string;
  visibility?: string;
}
export interface PickerCtx {
  items: PickerItem[];
  now: number;
  event: EventFacts;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const minus = (n: number) => (n < 0 ? `−${String(-n)}` : n > 0 ? `+${String(n)}` : "0");

export function triggerShort(t: Trigger): string {
  switch (t.kind) {
    case "item": {
      const what =
        t.item_id !== null
          ? `item ${t.item_id}`
          : t.kinds.length === 0
            ? "one item (pick it)"
            : `item ${t.kinds.join(", ")}`;
      return `${what} · ${t.anchor}`;
    }
    case "domain":
      return t.final_only ? `${t.type} (a final)` : t.type;
    case "clock":
      if (t.mode === "every")
        return `clock every ${String(t.every_minutes)} min ${t.from ?? ""}–${t.until ?? ""}`;
      if (t.mode === "once") return `clock once ${t.at ?? "(set a time)"}`;
      if (t.mode === "daily") return `clock daily ${t.at ?? ""}`;
      return t.mode === "event_end" ? "the event's end" : "the event's start";
    case "take":
      return "by hand";
    case "scene":
      return `scene ${t.scene_key} ${t.change}`;
    case "milestone":
      return `milestone ${t.count}, ${t.at === null ? "new peak" : String(t.at)}`;
  }
}

const UNTIL: Record<string, string> = {
  item_starts: "until it starts",
  item_ends: "until it ends",
  next_item_starts: "until the next item",
};

export function roundsShort(s: Story): string {
  const r = s.rounds;
  const parts = [
    r.mode === "offsets"
      ? r.offsets_minutes.length === 1 && r.offsets_minutes[0] === 0
        ? "1 round"
        : r.offsets_minutes.map(minus).join(", ")
      : `every ${String(r.every_minutes)} min`,
  ];
  if (r.mode === "every" && s.end.rounds !== null) parts.push(`${String(s.end.rounds)} rounds`);
  const u = s.end.until_event;
  if (u !== null) parts.push(u.kind === "domain" ? `until ${u.type}` : (UNTIL[u.kind] ?? ""));
  if (s.end.until_clock !== null) parts.push(`until ${s.end.until_clock}`);
  if (s.finale !== null) parts.push("finale");
  return parts.join(" · ");
}

export function soundShort(s: Story): string {
  const round = s.round.steps.some((x) => x.cue !== null);
  const finale = (s.finale ?? []).some((x) => x.cue !== null);
  if (!round) return finale ? "finale" : s.round.steps.some(isVideo) ? "the video's own" : "none";
  return `${s.sound.replace(/_/g, " ")} round${finale ? " · finale" : ""}`;
}

const dayTime = (ms: number, timeZone: string): string =>
  `${new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(new Date(ms))} ${localParts(ms, timeZone).hhmm}`;

function itemStatus(t: Extract<Trigger, { kind: "item" }>, ctx: PickerCtx): string {
  if (t.item_id === null && t.kinds.length === 0) return "Pick an item";
  const next = ctx.items
    .filter(
      (i) =>
        (i.visibility ?? "public") === "public" &&
        (i.status ?? "scheduled") === "scheduled" &&
        (t.item_id !== null ? i.id === t.item_id : t.kinds.includes(i.kind ?? "")),
    )
    .map((i) => ({ i, at: Date.parse((t.anchor === "end" ? i.ends_at : i.starts_at) ?? "") }))
    .filter((x) => !Number.isNaN(x.at) && x.at >= ctx.now)
    .sort((a, b) => a.at - b.at)[0];
  return next === undefined
    ? "Waits for a matching item in the run of show"
    : `Next: ${dayTime(next.at, ctx.event.time_zone)}, ${next.i.title}`;
}

function clockStatus(t: Extract<Trigger, { kind: "clock" }>, ctx: PickerCtx): string | null {
  const at = (iso: string | null) => (iso === null ? NaN : Date.parse(iso));
  if (t.mode === "once") {
    if (t.at === null) return "Set its time";
    const ms = at(t.at);
    return ms >= ctx.now ? `Next: ${dayTime(ms, ctx.event.time_zone)}` : "Its time has passed";
  }
  if (t.mode === "event_start" || t.mode === "event_end") {
    const ms = at(t.mode === "event_end" ? ctx.event.ends_at : ctx.event.starts_at);
    return Number.isNaN(ms) ? null : `Next: ${dayTime(ms, ctx.event.time_zone)}`;
  }
  return t.mode === "daily" ? `Every day at ${t.at ?? ""}` : null;
}

function triggerStatus(t: Trigger, ctx: PickerCtx): string | null {
  if (t.kind === "item") return itemStatus(t, ctx);
  if (t.kind === "clock") return clockStatus(t, ctx);
  if (t.kind === "domain" && PROVISIONAL[t.type] !== undefined)
    return `Waits for “${capital(eventWords(t.type))}”, which ${PROVISIONAL[t.type]?.replace(/, step (\d+)$/, " sends from step $1") ?? "a later module sends"}`;
  return null;
}

/** What the picker says of a story now: its triggers' next time or why it idles, and its rule. */
export function statusOf(s: Story, ctx: PickerCtx): string[] {
  const out = s.triggers.map((t) => triggerStatus(t, ctx)).filter((x) => x !== null);
  if (s.conditions.quiet === "skip") out.push("Not in a quiet scene");
  const o = s.preset === null ? undefined : RULE_OF_PRESET[s.preset];
  if (o !== undefined) {
    const rule = `the built-in rule ${o.rule.replaceAll("_", " ")}`;
    if (o.on !== undefined)
      out.push(`${s.enabled ? "Takes" : "Would take"} the arrived order from ${rule}`);
    else out.push(`${s.enabled ? "Replaces" : "Would replace"} ${rule}`);
  }
  return [...new Set(out)];
}

/**
 * The list with one story turned on or off: a preset the event has not copied yet is copied, on;
 * a preset that follows it (Champion replay) goes the same way, and is copied only to turn it on.
 */
export function toggled(list: Story[], key: string): Story[] {
  const before = list.find((s) => s.key === key);
  const on = before === undefined ? true : !before.enabled;
  let out = [...list];
  const follower = FOLLOWS[key];
  for (const k of follower === undefined ? [key] : [key, follower]) {
    if (out.some((s) => s.key === k))
      out = out.map((s) => (s.key === k ? { ...s, enabled: on } : s));
    else {
      const p = presetOf(k);
      if (p !== undefined && on) out.push({ ...copy(p), enabled: on });
    }
  }
  return out;
}

/** A copy to edit: the event's own story (no preset, so it replaces no rule), off, under a new key. */
export function duplicated(list: Story[], key: string): { list: Story[]; key: string } {
  const from = list.find((s) => s.key === key) ?? presetOf(key);
  if (from === undefined) return { list, key };
  const base = `${key.slice(0, 30)}_copy`;
  let fresh = base;
  for (let n = 2; list.some((s) => s.key === fresh); n += 1) fresh = `${base}_${String(n)}`;
  const story: Story = {
    ...copy(from),
    key: fresh,
    name: `${from.name} (copy)`.slice(0, 60),
    preset: null,
    enabled: false,
  };
  return { list: [...list, story], key: fresh };
}
