/**
 * What a claimed region shows (contracts/screen.md, Moments drive it: claims): the claim's
 * template with its content, or its steps in turn from `starts_at`, until its `expires_at` or
 * `ends_at`, whichever is first. All of it runs on the server's clock from the state alone, so
 * every screen of a zone agrees and a claim ends on time also offline.
 */
import type { View } from "./widget.js";
import { skipped } from "./story-video.js";

export interface ClaimState {
  override_id: string;
  hidden: boolean;
  role: string;
  rank: number;
  template: string;
  content: View;
  steps:
    | {
        template: string;
        content: View;
        duration_ms: number;
        /** Additive (#114): how the step enters, and its cue's picture from the step's start. */
        transition?: string;
        effect?: unknown;
      }[]
    | null;
  sound: unknown;
  on_end: string;
  starts_at: string;
  ends_at: string | null;
  expires_at: string | null;
  /** A takeover that leaves the ticker drawn (#780); absent otherwise. */
  keep_ticker?: true;
  /** Moments' cue picture (cues.ts); absent from a claim without one. */
  effect?: unknown;
  /** A full-screen announcement's nearby content (#780): a widget's `{ widget, view }`. */
  aside?: unknown;
}

/** What the region draws now: `key` changes with the claim and the step, so each fades in. */
export interface ClaimShown {
  key: string;
  type: string;
  view: View;
  /** The step's transition, when it names one. */
  transition?: string;
  /** The step's cue picture and its start, drawn as a claim's (cues.ts). */
  cue?: { starts_at: string; effect: unknown };
}

const isClaim = (v: unknown): v is ClaimState => {
  const c = v as Partial<ClaimState> | null;
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.override_id === "string" &&
    typeof c.template === "string" &&
    typeof c.starts_at === "string"
  );
};

/** The region's claim, or null for none or one this player cannot read. */
export const claimOf = (v: unknown): ClaimState | null => (isClaim(v) ? v : null);

/** When the claim ends by itself, or null. */
export function claimEnd(c: ClaimState): number | null {
  const ends = [c.expires_at, c.ends_at].flatMap((t) =>
    typeof t === "string" && !Number.isNaN(Date.parse(t)) ? [Date.parse(t)] : [],
  );
  return ends.length === 0 ? null : Math.min(...ends);
}

// `pizza_placed` is a template of Moments' set that draws as the `food_status` widget.
const typeOf = (template: string): string =>
  template === "pizza_placed" ? "food_status" : template;

/**
 * A countdown step's own line is its `ends_text` (the builder's subtitle, Starting soon's "Stage ·
 * in 5 minutes"); the countdown template draws the line under the counter as its `description`
 * (hero.css), which the Pulse's countdown keeps for the item's own words (#625, S1).
 */
function stepView(template: string, content: View): View {
  const line = typeof content.ends_text === "string" ? content.ends_text.trim() : "";
  if (template !== "countdown" || line === "" || typeof content.description === "string")
    return content;
  return { ...content, description: line };
}

/** The claim's template and content at `nowMs`, or null once it has ended. */
export function claimShown(c: ClaimState, nowMs: number): ClaimShown | null {
  const end = claimEnd(c);
  if (end !== null && nowMs >= end) return null;
  // A video this screen cannot play is skipped: the region shows its rotation.
  if (c.template === "video" && skipped(c.override_id)) return null;
  const key = `claim:${c.override_id}`;
  const steps = Array.isArray(c.steps) ? c.steps : [];
  // The nearby content rides in the view: the template draws it beside the card (widget.ts).
  const view = c.aside != null ? { ...c.content, aside: c.aside } : c.content;
  if (steps.length === 0) return { key, type: typeOf(c.template), view };
  // A device whose clock runs a little ahead of the start shows the first step.
  const elapsed = Math.max(0, nowMs - Date.parse(c.starts_at));
  let at = 0;
  let index = steps.length - 1;
  let from = 0;
  for (const [i, step] of steps.entries()) {
    at += step.duration_ms;
    if (elapsed < at) {
      index = i;
      break;
    }
    from = at;
  }
  if (index === steps.length - 1) from = at - (steps[index]?.duration_ms ?? 0);
  const step = steps[index] as (typeof steps)[number];
  const startsAt = new Date(Date.parse(c.starts_at) + from).toISOString();
  return {
    key: `${key}:${String(index)}`,
    type: typeOf(step.template),
    view: stepView(step.template, step.content),
    ...(typeof step.transition === "string" ? { transition: step.transition } : {}),
    ...(step.effect != null ? { cue: { starts_at: startsAt, effect: step.effect } } : {}),
  };
}
