/** Colour tokens: profile key under `theme.colors` → default (`#rrggbb`). */
export const COLOR_TOKENS = {
  background: "#0f172a",
  surface: "#1e293b",
  border: "#334155",
  text: "#f8fafc",
  text_muted: "#94a3b8",
  primary: "#3b82f6",
  primary_text: "#ffffff",
  accent: "#f59e0b",
  status_ok: "#22c55e",
  status_degraded: "#eab308",
  status_down: "#ef4444",
} as const;

/** Font tokens: profile key under `theme.fonts` → default family. */
export const FONT_TOKENS = {
  body: "system-ui",
  heading: "system-ui",
  mono: "ui-monospace",
} as const;

/** Fallback stacks appended after a profile font, by token. */
export const FONT_STACKS: Record<FontToken, string> = {
  body: "system-ui, sans-serif",
  heading: "system-ui, sans-serif",
  mono: "ui-monospace, monospace",
};

/** Corner radius: a ui.css default only, not set from the profile. */
export const RADIUS = "0.5rem";

export type ColorToken = keyof typeof COLOR_TOKENS;
export type FontToken = keyof typeof FONT_TOKENS;

/** CSS custom property for a token: `text_muted` → `--canccu-color-text-muted`. */
export function cssVar(kind: "color" | "font", name: string): string {
  return `--canccu-${kind}-${name.replaceAll("_", "-")}`;
}
