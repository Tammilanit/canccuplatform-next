/** The layouts an event offers: the zone editor's and the window editor's choices. */
import { BUILT_IN_LAYOUTS, themeLayouts } from "../compose/layouts.js";
import type { Layout } from "../compose/layouts.js";
import type { Sources } from "../compose/sources.js";

/** The built-in layouts, each replaced by a theme layout of the same id, then the theme's own. */
export async function layoutsOf(sources: Sources, tenantId: string): Promise<Layout[]> {
  const theme = await sources.theme(tenantId).catch(() => null);
  const own = themeLayouts(theme?.layouts);
  return [
    ...BUILT_IN_LAYOUTS.map((b) => own.find((l) => l.id === b.id) ?? b),
    ...own.filter((l) => !BUILT_IN_LAYOUTS.some((b) => b.id === l.id)),
  ];
}
