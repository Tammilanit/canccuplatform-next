/**
 * The smallest push messages that take a zone's screens from one composed state to the next
 * (contracts/screen.md, the push channel; plan #109, S2). Pure, so every container that builds
 * the same two states sends the same messages.
 */
import { isDeepStrictEqual } from "node:util";
import type { RegionView, WidgetView } from "../compose/build.js";
import type { Message, Orientation, ZoneRecord } from "./store.js";

/** What the screen runs itself, on the server clock: the clock's text, cycles and shuffles. */
function stableWidget(w: WidgetView): WidgetView {
  if (w.widget !== "clock") return w;
  return { ...w, view: { ...w.view, iso: null, time: null, date: null } };
}

function stableRegion(r: RegionView): RegionView {
  return {
    ...r,
    cycle_started_at: "",
    order: r.rotation === "shuffle" ? [] : r.order,
    widgets: r.widgets.map(stableWidget),
  };
}

const sameShell = (a: RegionView, b: RegionView): boolean => {
  const { widgets: wa, ...sa } = stableRegion(a);
  const { widgets: wb, ...sb } = stableRegion(b);
  return (
    isDeepStrictEqual(sa, sb) &&
    wa.length === wb.length &&
    wa.every((w, i) => isDeepStrictEqual({ ...w, view: null }, { ...wb[i], view: null }))
  );
};

/**
 * The messages for one orientation, or null when only a whole `state` will do: no state before,
 * a new zone epoch, name, event name or sound device (these are in the device's own part), or
 * another layout or set of regions. An orientation the change left as it was gets a `ticker`
 * message anyway, so its screens learn the new `state_version` and show no lag.
 */
export function diffZone(
  before: ZoneRecord | null,
  after: ZoneRecord,
  orientation: Orientation,
  version: number,
): Message[] | null {
  if (
    before === null ||
    !isDeepStrictEqual(before.zone, after.zone) ||
    before.eventName !== after.eventName ||
    !isDeepStrictEqual(before.sound, after.sound)
  ) {
    return null;
  }
  const was = before.views[orientation];
  const now = after.views[orientation];
  if (
    !isDeepStrictEqual(was.layout, now.layout) ||
    was.regions.length !== now.regions.length ||
    was.regions.some((r, i) => r.id !== now.regions[i]?.id)
  ) {
    return null;
  }
  const messages: Message[] = [];
  if (!isDeepStrictEqual(before.theme, after.theme)) {
    messages.push({ event: "theme", data: { state_version: version, theme: after.theme } });
  }
  const ticker: Message = {
    event: "ticker",
    data: { state_version: version, ticker: after.ticker },
  };
  if (!isDeepStrictEqual(before.ticker, after.ticker)) messages.push(ticker);
  now.regions.forEach((region, i) => {
    const old = was.regions[i] as RegionView;
    if (isDeepStrictEqual(stableRegion(old), stableRegion(region))) return;
    if (!sameShell(old, region)) {
      messages.push({ event: "region", data: { state_version: version, region } });
      return;
    }
    region.widgets.forEach((w, index) => {
      const o = old.widgets[index] as WidgetView;
      if (isDeepStrictEqual(stableWidget(o), stableWidget(w))) return;
      messages.push({
        event: "widget",
        data: { state_version: version, region_id: region.id, index, view: w.view },
      });
    });
  });
  return messages.length === 0 ? [ticker] : messages;
}
