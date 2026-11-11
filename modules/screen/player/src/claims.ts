/**
 * What a claimed region shows (contracts/screen.md, Moments drive it: claims): the claim's
 * template with its content, or its steps in turn from `starts_at`, until its `expires_at` or
 * `ends_at`, whichever is first. All of it runs on the server's clock from the state alone, so
 * every screen of a zone agrees and a claim ends on time also offline.
 */
import type { View } from "./widget.js";

export interface ClaimState {
  override_id: string;
  hidden: boolean;
  role: string;
  rank: number;
  template: string;
  content: View;
  steps: { template: string; content: View; duration_ms: number }[] | null;
  sound: unknown;
  on_end: string;
  starts_at: string;
  ends_at: string | null;
  expires_at: string | null;
}

/** What the region draws now: `key` changes with the claim and the step, so each fades in. */
export interface ClaimShown {
  key: string;
  type: string;
  view: View;
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

/** The claim's template and content at `nowMs`, or null once it has ended. */
export function claimShown(c: ClaimState, nowMs: number): ClaimShown | null {
  const end = claimEnd(c);
  if (end !== null && nowMs >= end) return null;
  const key = `claim:${c.override_id}`;
  const steps = Array.isArray(c.steps) ? c.steps : [];
  if (steps.length === 0) return { key, type: typeOf(c.template), view: c.content };
  // A device whose clock runs a little ahead of the start shows the first step.
  const elapsed = Math.max(0, nowMs - Date.parse(c.starts_at));
  let at = 0;
  let index = steps.length - 1;
  for (const [i, step] of steps.entries()) {
    at += step.duration_ms;
    if (elapsed < at) {
      index = i;
      break;
    }
  }
  const step = steps[index] as (typeof steps)[number];
  return { key: `${key}:${String(index)}`, type: typeOf(step.template), view: step.content };
}
