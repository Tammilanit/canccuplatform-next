/**
 * What a preview changes in a zone's composition (contracts/screen.md, Preview time and Preview on
 * a screen): the run of show at its time, and the event's draft for the theme.
 */
import type { Sources, ThemeNow } from "../compose/sources.js";
import { laterOf, railAt } from "../compose/widgets.js";
import type { AgendaNow } from "../compose/widgets.js";
import { invalidRequest } from "../http.js";

/** A preview's time and theme. */
export interface PreviewLook {
  /** Epoch ms: the schedule windows, the run of show, countdowns and quiet hours follow it. */
  at?: number | null;
  /** Theming's key to the draft. */
  themeKey?: string | null;
}

/** The draft behind a preview key: drawn, `gone` (the key no longer resolves), or not read. */
export type DraftUse = "drawn" | "gone" | "unread" | "none";

/**
 * The run of show at a preview time, from the whole agenda as `agenda_now` would answer then.
 * Null when the agenda could not be read, as a failed now read is.
 */
export async function agendaAt(
  sources: Sources,
  tenantId: string,
  zoneKey: string,
  atMs: number,
): Promise<AgendaNow | null> {
  const items = await sources.agendaItems(tenantId);
  if (items === null) return null;
  const rail = railAt(items, zoneKey, atMs);
  const next = rail.next === null ? [] : [rail.next];
  return { current: rail.now, next, later: laterOf(items, next, zoneKey) };
}

/**
 * The theme a preview draws: the draft's addresses and templates with the revision in effect, so
 * the heartbeat and device health still name what the zone's screens draw.
 */
export async function lookFor(
  sources: Sources,
  tenantId: string,
  live: ThemeNow | null,
  key: string | null | undefined,
): Promise<{ theme: ThemeNow | null; draft: DraftUse }> {
  if (key === undefined || key === null) return { theme: live, draft: "none" };
  const draft = await sources.themePreview(tenantId, key);
  if (draft === "gone") return { theme: live, draft: "gone" };
  if (draft === null) return { theme: live, draft: "unread" };
  return { theme: { ...draft, revision: live?.revision ?? 0 }, draft: "drawn" };
}

/** How far ahead a preview time may be. */
const AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
/** A time a minute old still counts as now: the Studio's field was filled a moment ago. */
const SLACK_MS = 60_000;

/** The preview time (`at`), from now to 14 days ahead, or null for now; else 400. */
export function previewTime(value: unknown, nowMs: number): number | null {
  if (value === undefined || value === null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms) || ms < nowMs - SLACK_MS || ms > nowMs + AHEAD_MS) {
    throw invalidRequest("`at` must be a time from now to 14 days ahead.");
  }
  return Math.max(ms, nowMs);
}
