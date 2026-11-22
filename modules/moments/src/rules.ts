/**
 * The built-in rules (contracts/moments.md, Built-in rules; D7, D8): each turns catalog events
 * into a moment through the same arbiter as everyone's request. They are written against the
 * catalog's outlines (contracts/events.md) and fire once the emitters appear; a later step may
 * redefine its own. Settings per event override the defaults below field by field.
 */
import type { Event, SqlClient } from "@canccu/kit";
import { isClass } from "./arbiter.js";
import type { Class } from "./arbiter.js";
import type { Engine } from "./engine.js";
import { askForRule, dropRetry } from "./rule-retries.js";
import { leaderboardView } from "./sources.js";
import { lockRunningByKey } from "./store.js";
import type { Binding } from "./store.js";
import { loadStories } from "./story/store.js";
import { rulesOff } from "./story/presets.js";

export interface RuleSettings {
  enabled: boolean;
  template: string;
  class: Class;
  regions: string[];
  ttl_seconds: number;
  zones: string[];
  /** The cue its moment's start plays (contracts/moments.md, Cues and sound), or null. */
  cue: string | null;
}

type Data = Record<string, unknown>;
const obj = (v: unknown): Data => (typeof v === "object" && v !== null ? (v as Data) : {});
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const names = (people: unknown): string[] =>
  list(people)
    .map((p) => str(p.name))
    .filter((n): n is string => n !== null);

interface RuleDef {
  id: string;
  on: string[];
  /** Events that end the moment early with `source_ended` (E5). */
  ends: string[];
  templates: string[];
  defaults: RuleSettings;
  applies?: (d: Data) => boolean;
  ref: (d: Data) => string;
  content: (d: Data, e: Event) => Data;
  binding?: Binding;
}

const RULE = (
  d: Omit<RuleDef, "defaults"> & { defaults: Omit<RuleSettings, "enabled" | "zones"> },
): RuleDef => ({ ...d, defaults: { enabled: true, zones: [], ...d.defaults } });

export const RULES: readonly RuleDef[] = [
  RULE({
    id: "match_called",
    on: ["tournament.match.called"],
    ends: ["tournament.match.started"],
    templates: ["match_called"],
    defaults: {
      template: "match_called",
      class: "tournament",
      regions: ["hero", "rail"],
      ttl_seconds: 300,
      cue: "tournament.start",
    },
    ref: (d) => str(obj(d.match).id) ?? "",
    content: (d) => ({
      label: str(obj(d.match).label) ?? "",
      game_name: str(obj(obj(d.session).game).name) ?? "",
      teams: list(obj(d.match).teams).map((t) => ({
        name: str(t.name) ?? names(t.people).join(" & "),
        names: names(t.people),
      })),
      voice_channels: [],
    }),
  }),
  RULE({
    id: "standings",
    on: ["tournament.leaderboard.changed"],
    ends: [],
    templates: ["leaderboard"],
    defaults: {
      template: "leaderboard",
      class: "tournament",
      regions: ["hero", "rail"],
      ttl_seconds: 120,
      cue: null,
    },
    ref: () => "",
    content: (d) => leaderboardView(d.top),
    binding: { source: "leaderboard" },
  }),
  RULE({
    id: "finals_result",
    on: ["tournament.match.finished"],
    ends: [],
    templates: ["winner_card"],
    defaults: {
      template: "winner_card",
      class: "finals",
      regions: ["hero"],
      ttl_seconds: 120,
      cue: "tournament.post",
    },
    applies: (d) => obj(d.session).is_final === true,
    ref: (d) => str(obj(d.match).id) ?? "",
    content: (d) => {
      const first = list(d.results).sort((a, b) => Number(a.rank) - Number(b.rank))[0] ?? {};
      return {
        title: `${str(obj(obj(d.session).game).name) ?? "The final"}: champion`,
        names: names(first.people),
        points: typeof first.points === "number" ? first.points : null,
        image_url: null,
      };
    },
  }),
  RULE({
    id: "pizza",
    on: ["pizza.order.placed", "pizza.order.arrived"],
    ends: ["pizza.order.cancelled"],
    templates: ["pizza_placed"],
    defaults: {
      template: "pizza_placed",
      class: "announcement",
      // The food box's own place (#771): Screen draws the claim in the box's words, so the hall
      // reads the order's state in one box; a layout without a venue rail has it on the ticker.
      regions: ["venue_rail", "ticker"],
      ttl_seconds: 300,
      cue: "pizza.placed",
    },
    ref: (d) => str(obj(d.order).id) ?? "",
    content: (d) => {
      const o = obj(d.order);
      return {
        state: str(o.state) ?? "",
        seq: o.seq ?? null,
        pizzeria_name: str(obj(o.pizzeria).name) ?? "",
        target_at: o.target_at ?? null,
        pizza_count: o.pizza_count ?? 0,
        people_count: o.people_count ?? 0,
        holder_name: str(obj(o.holder).name),
      };
    },
  }),
  RULE({
    id: "hot_game",
    on: ["games.surge.started"],
    ends: ["games.surge.ended"],
    templates: ["hot_game"],
    defaults: {
      template: "hot_game",
      class: "hot_game",
      regions: ["hero", "rail"],
      ttl_seconds: 120,
      cue: "chrome.hot",
    },
    ref: (d) => str(obj(d.game).id) ?? "",
    content: (d, e) => {
      const g = obj(d.game);
      return {
        game: { id: str(g.id), name: str(g.name) ?? "", cover_url: str(g.cover_url) },
        players: d.players ?? 0,
        since: e.time,
      };
    },
  }),
];

export const RULE_IDS = RULES.map((r) => r.id);

export interface RuleView extends RuleSettings {
  rule_id: string;
  on: string[];
  templates: string[];
  revision: number;
}

export async function loadRules(c: SqlClient): Promise<RuleView[]> {
  const { rows } = await c.query(`SELECT rule_id, settings, revision FROM moments_rules`, []);
  const saved = new Map(rows.map((r) => [r.rule_id as string, r]));
  return RULES.map((r) => {
    const row = saved.get(r.id);
    return {
      rule_id: r.id,
      on: r.on,
      templates: r.templates,
      ...r.defaults,
      ...((row?.settings as Partial<RuleSettings> | undefined) ?? {}),
      revision: (row?.revision as number | undefined) ?? 0,
    };
  });
}

/** Why the settings are refused, or null. */
export function checkRule(id: string, s: Data): string | null {
  const def = RULES.find((r) => r.id === id);
  if (def === undefined) return "No such rule.";
  const zoneKey = /^[a-z0-9_-]{2,32}$/;
  const roles = ["full", "hero", "rail", "venue_rail", "ticker", "overlay"];
  if (typeof s.enabled !== "boolean") return "`enabled` is true or false.";
  if (typeof s.template !== "string" || !def.templates.includes(s.template)) {
    return `\`template\` is one of ${def.templates.join(", ")}.`;
  }
  if (!isClass(s.class) || s.class === "emergency")
    return "`class` names a class other than the emergency.";
  if (
    !Array.isArray(s.regions) ||
    s.regions.length === 0 ||
    !s.regions.every((r) => roles.includes(r as string))
  ) {
    return "`regions` lists region roles.";
  }
  if (
    !Number.isInteger(s.ttl_seconds) ||
    (s.ttl_seconds as number) < 1 ||
    (s.ttl_seconds as number) > 7200
  ) {
    return "`ttl_seconds` is 1 to 7200.";
  }
  if (!Array.isArray(s.zones) || !s.zones.every((z) => typeof z === "string" && zoneKey.test(z))) {
    return "`zones` lists zone keys.";
  }
  if (!(s.cue === null || (typeof s.cue === "string" && s.cue.length <= 64)))
    return "`cue` is a cue name or null.";
  return null;
}

/** Runs every rule an event fires or ends; a refused request asks again 30 s later (rule-retries.ts). */
export async function applyRules(c: SqlClient, engine: Engine, e: Event, now: Date): Promise<void> {
  const rules = await loadRules(c);
  // A preset on for the event shows the same happening: its rule is off (SD6, WD2).
  const shownByPreset = rulesOff((await loadStories(c)).stories, e.type);
  for (const def of RULES) {
    const s = rules.find((r) => r.rule_id === def.id);
    if (s === undefined) continue;
    // A preset that takes this event over also ends the rule's older moment of the same source
    // (the placed order, when Pizza orders ready shows it arrived), so the source has one voice.
    const takenOver = shownByPreset.has(def.id) && def.on.includes(e.type);
    if (def.ends.includes(e.type) || takenOver) {
      const m = await lockRunningByKey(c, `${def.id}:${def.ref(e.data)}`);
      if (m !== null) await engine.end(c, m, "source_ended", null, now);
      await dropRetry(c, `${def.id}:${def.ref(e.data)}`);
    }
    if (!s.enabled || takenOver || !def.on.includes(e.type)) continue;
    if (def.applies?.(e.data) === false) continue;
    const ref = def.ref(e.data);
    await askForRule(
      c,
      engine,
      {
        class: s.class,
        template: s.template,
        content: def.content(e.data, e),
        origin: "rule",
        rule_id: def.id,
        why: `rule: ${e.type}`,
        regions: s.regions,
        ttl_seconds: s.ttl_seconds,
        zones: s.zones,
        source: { module: e.source, event_id: e.id, ref: ref === "" ? null : ref },
        dedupe_key: `${def.id}:${ref}`,
        binding: def.binding ?? null,
        cue: s.cue,
        happening: ref === "" ? null : `${e.type}:${ref}`,
      },
      now,
    );
  }
}
