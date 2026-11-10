/**
 * Split regions (contracts/screen.md, Header and hub QR): a header region with `separate`, or a
 * region that lists the hub QR beside other widgets with `always`, is drawn as parts side by side,
 * each a region of its own in the composed state. A player draws a part as any region, so a
 * player older than these options needs no change.
 */
import type { Area, LayoutRegion, Role, WidgetEntry } from "./layouts.js";

export type HeaderMode = "separate" | "shared";
export type HubQrMode = "always" | "rotate";

export interface Part {
  id: string;
  area: Area;
  entries: WidgetEntry[];
  /** The hub QR's part has no role, so only the whole-screen `full` and `overlay` claims cover it. */
  hubQr: boolean;
}

// The theme schema's region id: a part id that fails it could not be named in a zone or a
// `canccu-region--<id>` class, so such a region is not split.
const REGION_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export const isHubQr = (entry: WidgetEntry): boolean =>
  entry.widget === "qr" && entry.props?.url === "/notify/";

/** The region's columns from left to right; when they do not divide evenly the leftmost get one more. */
function columnsOf(area: Area, parts: number): Area[] {
  const base = Math.floor(area.columns / parts);
  const extra = area.columns % parts;
  let column = area.column;
  return Array.from({ length: parts }, (_, i) => {
    const columns = base + (i < extra ? 1 : 0);
    const part = { ...area, column, columns };
    column += columns;
    return part;
  });
}

function groupsOf(
  entries: WidgetEntry[],
  role: Role | null,
  header: HeaderMode,
  hubQr: HubQrMode,
): WidgetEntry[][] | null {
  // A header region follows `header` alone, also when it lists the hub QR.
  if (role === "header") {
    return header === "separate" && entries.length >= 2 ? entries.map((e) => [e]) : null;
  }
  if (hubQr === "rotate") return null;
  const qr = entries.filter(isHubQr);
  const rest = entries.filter((e) => !isHubQr(e));
  return qr.length > 0 && rest.length > 0 ? [rest, qr] : null;
}

/** The region's parts, or the region whole when it is not split or cannot be. */
export function partsOf(
  source: LayoutRegion,
  entries: WidgetEntry[],
  role: Role | null,
  modes: { header: HeaderMode; hubQr: HubQrMode },
  layoutIds: ReadonlySet<string>,
): Part[] {
  const whole: Part[] = [{ id: source.id, area: source.area, entries, hubQr: false }];
  const groups = groupsOf(entries, role, modes.header, modes.hubQr);
  if (groups === null || source.area.columns < groups.length) return whole;
  const ids = groups.map((_, i) => (i === 0 ? source.id : `${source.id}-${i + 1}`));
  if (ids.slice(1).some((id) => !REGION_ID_RE.test(id) || layoutIds.has(id))) return whole;
  const areas = columnsOf(source.area, groups.length);
  return groups.map((group, i) => ({
    id: ids[i] as string,
    area: areas[i] as Area,
    entries: group,
    hubQr: group.every(isHubQr),
  }));
}
