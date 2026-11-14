/** Types for studio-layout.js, which the page loads as it is; only the tests read these. */

export interface BoxEditor {
  apply(zone: Record<string, unknown>): void;
  changes(): string[];
  /** A warning line per gap (an `li`), with Fill the gap where a box can grow. */
  gapLines(): unknown[];
}

export function boxEditor(
  form: unknown,
  helpers: {
    say: (key: string, values?: Record<string, unknown>) => string;
    counted: (key: string, count: number, values?: Record<string, unknown>) => string;
    tell: (message: string) => void;
    changed: () => void;
  },
): BoxEditor;
