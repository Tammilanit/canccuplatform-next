/**
 * Where an announcement shows (contracts/moments.md, Levels, placement and the full screen; #780):
 * the level sets the default placement, the organiser's pick wins, and the placement makes the
 * card's chain and Screen's two hints. Moments decides what a card asks for; Screen, knowing the
 * layout, decides where it lands.
 */
import { invalid } from "../content.js";

export type Level = "info" | "important" | "urgent";
export type Placement = "rail" | "hero" | "full";

export const LEVELS: readonly Level[] = ["info", "important", "urgent"];
export const PLACEMENTS: readonly Placement[] = ["rail", "hero", "full"];
export const ICONS = [
  "info",
  "wifi",
  "food",
  "trophy",
  "clock",
  "door",
  "search",
  "megaphone",
] as const;
export type Icon = (typeof ICONS)[number];

const DEFAULT: Record<Level, Placement> = { info: "rail", important: "hero", urgent: "full" };

/**
 * The PO's "about 40 %" of the screen, set at 35 % of the grid's cells so Portrait's hero (38 %)
 * takes an Important in place; only Dashboard's box needs to grow.
 */
export const HERO_MIN_SHARE = 0.35;

/**
 * The placement to keep. `full_screen` alone keeps what it meant before #780 (`false` is the rail
 * chain), so an old client's urgent card is not turned into a takeover; only a send naming neither
 * takes the level's default.
 */
export function placementOf(
  level: Level,
  placement: Placement | null,
  fullScreen: boolean | undefined,
): Placement {
  if (placement !== null) return placement;
  if (fullScreen !== undefined) return fullScreen ? "full" : "rail";
  return DEFAULT[level];
}

export interface Chain {
  regions: string[];
  hero_min_share: number | null;
  keep_ticker: boolean;
}

/** The card's chain and Screen's hints (contracts/moments.md, the placement table). */
export function chainOf(level: Level, placement: Placement): Chain {
  const regions =
    placement === "full"
      ? ["full", "hero", "rail", "ticker"]
      : placement === "hero"
        ? level === "info"
          ? ["hero", "rail", "ticker"]
          : ["hero", "full", "rail", "ticker"]
        : // An urgent card in the rail keeps the chain it had before #780, for stored rows too.
          level === "urgent"
          ? ["rail", "hero", "ticker"]
          : ["rail", "ticker"];
  return { regions, ...hintsOf(level, regions) };
}

function hintsOf(level: Level, regions: readonly string[]): Omit<Chain, "regions"> {
  return {
    hero_min_share: level !== "info" && regions[0] === "hero" ? HERO_MIN_SHARE : null,
    // The ticker keeps running under a full screen, except where the card carries an instruction.
    keep_ticker: level !== "urgent" && regions.includes("full"),
  };
}

const isLevel = (v: unknown): v is Level => LEVELS.includes(v as Level);

/**
 * The Override's hints for a moment's card, from its level and chain alone, so a rule's card (Pizza
 * is here) and a composed one get them alike; nothing for the emergency or another template.
 */
export function overrideHints(m: {
  template: string;
  content: Record<string, unknown>;
  regions: readonly string[];
}): Partial<Omit<Chain, "regions">> {
  if (m.template !== "announcement" || !isLevel(m.content.level)) return {};
  return hintsOf(m.content.level, m.regions);
}

/** One of `values`, or null when absent or null; anything else is 400, naming the field. */
export function oneOf<T extends string>(v: unknown, values: readonly T[], field: string): T | null {
  if (v === undefined || v === null) return null;
  if (!values.includes(v as T)) throw invalid(`\`${field}\` is one of ${values.join(", ")}.`);
  return v as T;
}
