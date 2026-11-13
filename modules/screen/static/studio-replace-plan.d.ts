/** Types for studio-replace-plan.js, which the page loads as it is; only the tests read these. */

export interface Match {
  id: string;
  kind: string;
  used: boolean;
}

export interface PlanEntry {
  name: string;
  matches: Match[];
  eligible: Match[];
  conflict: boolean;
  canReplace: boolean;
  reason: "batch" | "kind" | null;
  otherKind: string | null;
  choice: "keep" | "replace";
  replaceId: string | null;
  needsPick: boolean;
  onlyOneUsed: boolean;
}

export function kindOfFile(name: string, type: string): string | null;

export function replacePlan(input: {
  files: { name: string; type: string }[];
  matches: Match[][];
  choice: "keep" | "replace";
  own?: Record<number, { choice: "keep" | "replace"; assetId?: string } | undefined>;
}): PlanEntry[];
