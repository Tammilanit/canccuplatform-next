/**
 * The cues API's input, validated whole (the legacy's unvalidated PATCH was its known problem 11):
 * each function answers the value as stored, or why not in a sentence.
 */
import { CATEGORIES, EFFECTS, HOLD_MAX, HOLD_MIN } from "./catalog.js";
import type { Category, Cue, SoundSettings } from "./catalog.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (typeof b === "object" && b !== null ? (b as Body) : {});

export const int = (v: unknown, lo: number, hi: number): boolean =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** The settings as stored, or why not. */
export function settingsOf(b: Body): SoundSettings | string {
  if (typeof b.enabled !== "boolean") return "`enabled` is true or false.";
  if (!int(b.volume, 0, 100)) return "`volume` is 0 to 100.";
  if (!int(b.hourly_budget, 0, 1000)) return "`hourly_budget` is 0 to 1000.";
  if (!int(b.per_minute, 1, 60)) return "`per_minute` is 1 to 60.";
  if (!int(b.per_source_seconds, 0, 3600)) return "`per_source_seconds` is 0 to 3600.";
  const cats = bodyOf(b.categories);
  const keys = Object.keys(cats);
  if (keys.length !== CATEGORIES.length || !CATEGORIES.every((c) => keys.includes(c)))
    return "`categories` names the six categories, no more.";
  const categories = {} as SoundSettings["categories"];
  for (const c of CATEGORIES) {
    const v = bodyOf(cats[c]);
    if (typeof v.enabled !== "boolean" || !int(v.level, 0, 100))
      return `\`categories.${c}\` has \`enabled\` and a \`level\` of 0 to 100.`;
    categories[c] = { enabled: v.enabled, level: v.level as number };
  }
  return {
    enabled: b.enabled,
    volume: b.volume as number,
    muted_until: null,
    hourly_budget: b.hourly_budget as number,
    per_minute: b.per_minute as number,
    per_source_seconds: b.per_source_seconds as number,
    categories,
  };
}

/** The cue as stored, or why not; `sounds` must name sounds of the library. */
export function cueOf(name: string, b: Body, library: Set<string>, builtin: boolean): Cue | string {
  if (!(CATEGORIES as readonly unknown[]).includes(b.category))
    return "`category` is one of the six: events add cues, never categories.";
  if (typeof b.enabled !== "boolean") return "`enabled` is true or false.";
  if (!int(b.level, 0, 100)) return "`level` is 0 to 100.";
  if (!int(b.cooldown_seconds, 0, 86_400)) return "`cooldown_seconds` is 0 to 86400.";
  if (!int(b.catch_up_seconds, 0, 3600)) return "`catch_up_seconds` is 0 to 3600.";
  const w = b.catch_up_before_start;
  if (!(
    w === null ||
    w === undefined ||
    (Array.isArray(w) && w.length === 2 && int(w[0], 1, 1440) && int(w[1], 0, (w[0] as number) - 1))
  ))
    return "`catch_up_before_start` is null or [from, to] minutes before the start, from > to.";
  if (typeof b.once_per_source !== "boolean") return "`once_per_source` is true or false.";
  const sounds = b.sounds;
  if (!Array.isArray(sounds) || sounds.length > 20 || new Set(sounds).size !== sounds.length)
    return "`sounds` lists up to 20 sounds, each once.";
  if (!sounds.every((s) => typeof s === "string" && library.has(s)))
    return "`sounds` names sounds of the library.";
  const voice = b.voice_line ?? null;
  if (!(voice === null || (typeof voice === "string" && library.has(voice))))
    return "`voice_line` is null or a sound of the library.";
  const effects = b.effects;
  if (
    !Array.isArray(effects) ||
    !effects.every((e) => (EFFECTS as readonly unknown[]).includes(e)) ||
    new Set(effects).size !== effects.length
  )
    return `\`effects\` lists effects of ${EFFECTS.join(", ")}.`;
  if (!int(b.hold_seconds, HOLD_MIN, HOLD_MAX))
    return `\`hold_seconds\` is ${String(HOLD_MIN)} to ${String(HOLD_MAX)}.`;
  return {
    name,
    category: b.category as Category,
    enabled: b.enabled,
    level: b.level as number,
    cooldown_seconds: b.cooldown_seconds as number,
    catch_up_seconds: b.catch_up_seconds as number,
    catch_up_before_start: (w ?? null) as [number, number] | null,
    once_per_source: b.once_per_source,
    sounds: sounds as string[],
    voice_line: voice,
    effects: effects as Cue["effects"],
    hold_seconds: b.hold_seconds as number,
    builtin,
  };
}
