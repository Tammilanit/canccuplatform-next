/**
 * The stage and the cards' backgrounds (contracts/screen.md, The stage, Card backgrounds): what the
 * zone's stage shows behind its boxes, the tint a box asks for, and each card's own art with the
 * veil that keeps its text readable. The rules are pure; only the art's read is not (art.ts).
 */
import type { ArtCache, ArtInfo } from "../stage/art.js";
import { scrimOf, veilOf } from "../stage/scrim.js";
import type { ThemeColors } from "../stage/scrim.js";
import type { RegionView } from "./build.js";
import type { MotionPhase } from "./motion.js";
import type { AgendaNow, View } from "./widgets.js";

/** A box's tint holds this long from its surge's `since`. */
export const TINT_MS = 60_000;

export interface Tint {
  region_id: string;
  widget: string;
  until: string;
  art: { url: string; scrim: number } | null;
}

export interface Stage {
  phase: MotionPhase;
  kind: string | null;
  tint: Tint | null;
}

/** A box that asks for a tint, before its art is read. */
export interface TintAsk {
  region_id: string;
  widget: string;
  until: number;
  cover_url: unknown;
}

type Views = Record<string, { regions: RegionView[] }>;

const objectOr = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A hot game's view and the region it is drawn in: its widgets, and a claim that shows one. */
function hotGames(views: Views): { region_id: string; view: Record<string, unknown> }[] {
  const out: { region_id: string; view: Record<string, unknown> }[] = [];
  for (const { regions } of Object.values(views)) {
    for (const r of regions) {
      const claim = r.claim;
      if (claim !== null && !claim.hidden && claim.template === "hot_game") {
        const content = objectOr(claim.content);
        if (content !== null) out.push({ region_id: r.id, view: content });
      }
      for (const w of r.widgets) {
        if (w.widget === "hot_game" && !w.view.empty) out.push({ region_id: r.id, view: w.view });
      }
    }
  }
  return out;
}

/**
 * The tint the zone's boxes ask for at `nowMs`: a hot game's surge holds it for 60 s from its
 * `since`, and the newest surge wins. Null when none holds.
 */
export function tintAsked(views: Views, nowMs: number): TintAsk | null {
  let best: TintAsk | null = null;
  let bestSince = Number.NEGATIVE_INFINITY;
  for (const { region_id, view } of hotGames(views)) {
    const since = typeof view.since === "string" ? Date.parse(view.since) : NaN;
    if (Number.isNaN(since) || since > nowMs || nowMs >= since + TINT_MS) continue;
    // Ties keep the first found: the landscape view's region, the same on every screen.
    if (since > bestSince) {
      bestSince = since;
      best = {
        region_id,
        widget: "hot_game",
        until: since + TINT_MS,
        cover_url: objectOr(view.game)?.cover_url ?? null,
      };
    }
  }
  return best;
}

/** The kind of the zone's current public item, the kind tint. */
export function kindOf(agenda: AgendaNow | null): string | null {
  return agenda?.current.find((i) => i.visibility === "public")?.kind ?? null;
}

/** The cover a card shows: a hot game's, and a countdown's game's. */
function coverOf(type: string, view: Record<string, unknown>): unknown {
  if (type !== "hot_game" && type !== "countdown") return null;
  return objectOr(view.game)?.cover_url ?? null;
}

/** Every distinct cover the zone's cards and its tint would show. */
function coversOf(views: Views, tint: TintAsk | null): string[] {
  const urls = new Set<string>();
  const add = (u: unknown): void => {
    if (typeof u === "string") urls.add(u);
  };
  if (tint !== null) add(tint.cover_url);
  for (const { regions } of Object.values(views)) {
    for (const r of regions) {
      for (const w of r.widgets) add(coverOf(w.widget, w.view));
      if (r.idle_view !== null) add(coverOf("countdown", r.idle_view.view));
      if (r.claim !== null) add(coverOf(r.claim.template, objectOr(r.claim.content) ?? {}));
    }
  }
  return [...urls];
}

type Art = ReadonlyMap<string, ArtInfo>;

function withCard<V extends Record<string, unknown>>(
  type: string,
  view: V,
  art: Art,
  colors: ThemeColors,
): V {
  const url = coverOf(type, view);
  const info = typeof url === "string" ? art.get(url) : undefined;
  if (typeof url !== "string" || info === undefined) return view;
  return { ...view, card_art: { url, veil: veilOf(colors, info.cover) } };
}

/** The views with each card's art (Card backgrounds): set only where its cover could be read. */
export function withCardArt(views: Views, art: Art, colors: ThemeColors): void {
  if (art.size === 0) return;
  for (const v of Object.values(views)) {
    v.regions = v.regions.map((r) => ({
      ...r,
      widgets: r.widgets.map((w) => ({ ...w, view: withCard(w.widget, w.view, art, colors) })),
      idle_view:
        r.idle_view === null
          ? null
          : { ...r.idle_view, view: withCard<View>("countdown", r.idle_view.view, art, colors) },
      claim:
        r.claim === null || objectOr(r.claim.content) === null
          ? r.claim
          : {
              ...r.claim,
              content: withCard(r.claim.template, objectOr(r.claim.content) ?? {}, art, colors),
            },
    }));
  }
}

export interface StageInput {
  views: Views;
  phase: MotionPhase;
  agenda: AgendaNow | null;
  nowMs: number;
  /** The event's `stage_art` setting: false keeps the tint's colours without its art. */
  stageArt: boolean;
  colors: ThemeColors;
  /** The event's hostname the covers are read on. */
  hostname: string;
  art: ArtCache | undefined;
}

/**
 * The zone's stage, and its views with their card art. The art of each cover is read once per
 * compose; a cover that cannot be read leaves its card plain and its tint without art.
 */
export async function stageOf(input: StageInput): Promise<{ stage: Stage; covers: string[] }> {
  const ask = tintAsked(input.views, input.nowMs);
  const art = new Map<string, ArtInfo>();
  if (input.art !== undefined) {
    const cache = input.art;
    await Promise.all(
      coversOf(input.views, ask).map(async (url) => {
        const info = await cache.of(input.hostname, url).catch(() => null);
        if (info !== null) art.set(url, info);
      }),
    );
  }
  withCardArt(input.views, art, input.colors);
  const tintArt =
    ask !== null && input.stageArt && typeof ask.cover_url === "string"
      ? art.get(ask.cover_url)
      : undefined;
  return {
    stage: {
      phase: input.phase,
      kind: kindOf(input.agenda),
      tint:
        ask === null
          ? null
          : {
              region_id: ask.region_id,
              widget: ask.widget,
              until: new Date(ask.until).toISOString(),
              art:
                tintArt === undefined
                  ? null
                  : {
                      url: `/api/screen/art/${tintArt.id}.webp`,
                      scrim: scrimOf(input.colors, tintArt.art),
                    },
            },
    },
    // The art ids drawn: a cover read only later changes what screens draw, so it moves the version.
    covers: [...art.entries()].map(([url, info]) => `${url}=${info.id}`).sort(),
  };
}
