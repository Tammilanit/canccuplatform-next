/** Storyboards on the engine: a story list, the run of show, placements and the tick, on the test's clock. */
import type { Event, SqlClient } from "@canccu/kit";
import { applyClaims } from "../src/placements.js";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { tickTenant } from "../src/tick.js";
import { EMPTY_CONDITIONS } from "../src/story/model.js";
import type { Story, StoryStep } from "../src/story/model.js";
import { PRESETS } from "../src/story/presets.js";
import { DEFAULT_SETTINGS, noteEvent, writeStories } from "../src/story/store.js";
import type { StorySettings } from "../src/story/store.js";
import { claims } from "./helpers.js";
import type { World } from "./helpers.js";

export const TABLES = `moments, moment_overrides, moment_placements, moments_zones, moments_history,
  moments_outbox, moments_sources, moments_sound_zones, moments_sound_log, moments_sound_sources,
  moments_tenants, moments_stories, moments_story_runs, moments_story_marks, moments_scene_zones,
  moments_rules`;

export const step = (o: Partial<StoryStep> = {}): StoryStep => ({
  template: "title_card",
  content: { title: "Hello", subtitle: "", image_url: null },
  duration_seconds: 20,
  transition: "fade",
  cue: null,
  on_the_dot: false,
  message: false,
  ...o,
});

export const story = (o: Partial<Story> = {}): Story => ({
  key: "test",
  name: "Test story",
  preset: null,
  enabled: true,
  triggers: [{ kind: "take" }],
  conditions: { ...EMPTY_CONDITIONS },
  run_mode: "per_source",
  full_screen: false,
  round: { steps: [step({ message: true })], repeat: null, hold_seconds: null },
  rounds: { mode: "offsets", offsets_minutes: [0] },
  end: { rounds: 1, for_minutes: null, until_clock: null, until_event: null, crew: true },
  finale: null,
  sound: "first",
  ...o,
});

export const preset = (key: string, o: Partial<Story> = {}): Story => ({
  ...(JSON.parse(JSON.stringify(PRESETS.find((p) => p.key === key))) as Story),
  ...o,
});

export const ITEM = {
  id: "it_final",
  title: "Demo Game Cup final",
  kind: "tournament",
  visibility: "public",
  status: "scheduled",
  location: "Stage",
  starts_at: "2026-01-01T19:00:00Z",
  ends_at: "2026-01-01T20:00:00Z",
};

export function kit(w: World, tenant = "demo") {
  const tx = <T>(fn: (c: SqlClient) => Promise<T>) => w.tx(tenant, fn);
  return {
    tx,
    async setup(stories: Story[], settings: Partial<StorySettings> = {}, zones = ["main"]) {
      await tx(async (c) => {
        for (const z of zones) await addZone(c, z);
        await writeStories(c, stories, { ...DEFAULT_SETTINGS, ...settings }, 1);
        await noteEvent(c, {
          name: "Demo Event",
          hostname: "demo.example.test",
          time_zone: "UTC",
          starts_at: "2026-01-01T12:00:00Z",
          ends_at: "2026-01-03T12:00:00Z",
        });
      });
    },
    agenda: (items: Record<string, unknown>[], version = 1) =>
      tx((c) => storeAgenda(c, { agenda_version: version, items: items as never })),
    tick: (at: Date) => tx((c) => tickTenant(c, w.engine, at)),
    /** Ticks every second from `from` to `to` (seconds after T0). */
    async run(from: number, to: number, every = 1) {
      for (let s = from; s <= to; s += every) await tx((c) => tickTenant(c, w.engine, w.at(s)));
    },
    place: (zone: string, ids: [string, string][], at: Date, unplaced: string[] = [], hidden: string[] = []) =>
      tx((c) => applyClaims(c, claims(zone, ids, unplaced, hidden), at)),
    history: () =>
      tx(async (c) => {
        const { rows } = await c.query(
          `SELECT action, outcome, title, zone_key FROM moments_history WHERE action IN ('round_started', 'round_skipped', 'loop_ended', 'not_fired') ORDER BY seq`,
          [],
        );
        return rows as { action: string; outcome: string; title: string; zone_key: string | null }[];
      }),
    soundLog: () =>
      tx(async (c) => {
        const { rows } = await c.query(
          `SELECT zone_key, cue, outcome, reason FROM moments_sound_log ORDER BY at, cue`,
          [],
        );
        return rows as { zone_key: string; cue: string; outcome: string; reason: string }[];
      }),
    runs: () =>
      tx(async (c) => {
        const { rows } = await c.query(
          `SELECT id, story_key, status, end_reason, next_round, rounds_played, t, round FROM moments_story_runs ORDER BY started_at`,
          [],
        );
        return rows as { id: string; story_key: string; status: string; end_reason: string | null; next_round: number; rounds_played: number; t: Date; round: unknown }[];
      }),
    started: () =>
      w.events(tenant)
        .filter((e: Event) => e.type === "moments.override.started")
        .map((e: Event) => e.data.override as Record<string, unknown>),
  };
}

export const rounds = (h: { action: string; outcome: string }[]) =>
  h.filter((r) => r.action !== "not_fired").map((r) => `${r.action} ${r.outcome}`);
