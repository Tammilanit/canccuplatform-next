/** WCAG 2.2 contrast and the theming contract's contrast rules (contracts/theming.md, Brand kit). */

/** [foreground, background, minimum ratio], in the order the contract lists them. */
const RULES: readonly (readonly [string, string, number])[] = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["text_muted", "background", 4.5],
  ["text_muted", "surface", 4.5],
  ["primary_text", "primary", 4.5],
  ["primary_text", "status_down", 4.5],
  ["primary", "background", 3],
  ["accent", "background", 3],
  ["status_ok", "surface", 3],
  ["status_degraded", "surface", 3],
  ["status_down", "surface", 3],
];

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// The alpha of `#rrggbbaa` is ignored: what a translucent token sits on differs per page, so the
// rules judge its solid colour.
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The pairs that break the rules, as `"<token> on <token>"`; empty when every rule holds. */
export function contrastFailures(colors: Readonly<Record<string, string>>): string[] {
  const failures: string[] = [];
  for (const [fg, bg, min] of RULES) {
    const a = colors[fg];
    const b = colors[bg];
    if (a === undefined || b === undefined || contrastRatio(a, b) < min) {
      failures.push(`${fg} on ${bg}`);
    }
  }
  return failures;
}
