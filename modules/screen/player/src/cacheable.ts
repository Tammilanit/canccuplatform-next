/**
 * Which files a screen keeps for offline use (contracts/screen.md, Offline; plan #109, S9): only
 * files under immutable addresses, whose bytes never change while the address stays, so a cached
 * copy is never stale. The page and the service worker share these rules.
 */
const IMMUTABLE = [
  // The player bundle, one folder per version (src/player.ts).
  /^\/screen\/b\/[^/]+\/[^/]+$/,
  // Theme revision files, named by their content's hash (contracts/theming.md, Where files are served).
  /^\/theming\/a\/[^/]+$/,
  // A published revision's embeds; a draft's (`/theming/sandbox/draft/…`) change, so never.
  /^\/theming\/sandbox\/[0-9]+\/[^?#]+$/,
  // The event's content-addressed files, and a version's rendered slides (contracts/screen.md).
  /^\/api\/screen\/files\/[^/]+$/,
  /^\/api\/screen\/renders\/[^/]+\/[^/]+\/[^/]+$/,
];

export function isImmutable(path: string): boolean {
  return IMMUTABLE.some((re) => re.test(path));
}

/** A same-origin path from a path or a URL of `origin`; null for anything else. */
function pathOf(value: string, origin: string): string | null {
  if (value.startsWith("/") && !value.startsWith("//")) return value.split(/[?#]/)[0] ?? null;
  if (value.startsWith(`${origin}/`)) return pathOf(value.slice(origin.length), origin);
  return null;
}

/**
 * Every cacheable file a state names, wherever in it (theme, view-models, `prefetch`), so widgets
 * added later are covered without a list of their fields here.
 */
export function namedFiles(state: unknown, origin: string): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 12) return;
    if (typeof value === "string") {
      const path = pathOf(value, origin);
      if (path !== null && isImmutable(path)) found.add(path);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
    } else if (typeof value === "object" && value !== null) {
      for (const v of Object.values(value)) walk(v, depth + 1);
    }
  };
  walk(state, 0);
  return [...found];
}

/**
 * The cacheable files a style sheet names (fonts, images): the page fetches a font only when text
 * uses it, so a screen that went offline first would miss the rest.
 */
export function cssFiles(css: string): string[] {
  const found = new Set<string>();
  for (const m of css.matchAll(/url\(\s*(["']?)(\/[^"')\s]+)\1\s*\)/g)) {
    const path = m[2]?.split(/[?#]/)[0];
    if (path !== undefined && !path.startsWith("//") && isImmutable(path)) found.add(path);
  }
  return [...found];
}
