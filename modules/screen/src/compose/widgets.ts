/**
 * The widgets' view-models (contracts/screen.md, Widgets): the only data a template can read.
 * Types whose source is not on main yet answer `empty` (plan S13) and are filled by their slice.
 */
import qrcode from "qrcode-generator";
import type { Props } from "./layouts.js";

export type View = Record<string, unknown> & { qr: Qr | null; stale: boolean; empty: boolean };
export interface Qr {
  url: string;
  label: string;
  image_url: string;
}

/** What the server read from the other modules for one zone; `null` where a read failed. */
export interface ZoneFacts {
  now: Date;
  timeZone: string;
  /** `https://<primary hostname>`, or the request's own origin in IP mode. */
  origin: string;
  eventName: string;
  logoUrl: string | null;
  agenda: AgendaNow | null;
  venue: VenueInfo | null;
  ticker: { text: string | null; until: string | null; source: string | null };
}

export interface AgendaItem {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  delay_minutes: number;
  location: string | null;
  visibility: string;
}
export interface AgendaNow {
  current: AgendaItem[];
  next: AgendaItem[];
}
export interface VenueInfo {
  wifi: { ssid: string; password: string | null; note: string | null; visibility: string }[];
  floor_plan: unknown;
}

// The natural target of each type that has one (contracts/screen.md, Widgets): the hub's pages.
const NATURAL_QR: Record<string, { path: string; label: string }> = {
  agenda_now: { path: "/notify/", label: "Schedule" },
  venue_info: { path: "/notify/", label: "Venue info" },
  now_playing: { path: "/notify/", label: "Now playing" },
};

export function qrImage(url: string): string {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const svg = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function qrFor(type: string, props: Props, facts: ZoneFacts): Qr | null {
  const setting = props.qr ?? "none";
  let target: { path: string; label: string } | undefined;
  if (setting === "auto") target = NATURAL_QR[type];
  else if (typeof setting === "string" && setting.startsWith("/") && !setting.startsWith("//")) {
    target = { path: setting, label: typeof props.qr_label === "string" ? props.qr_label : "" };
  }
  if (target === undefined) return null;
  const url = facts.origin + target.path;
  return { url, label: target.label, image_url: qrImage(url) };
}

function clockText(at: Date, timeZone: string, part: "time" | "date"): string {
  const options: Intl.DateTimeFormatOptions =
    part === "time"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }
      : { weekday: "short", day: "numeric", month: "short", timeZone };
  return new Intl.DateTimeFormat("en-GB", options).format(at);
}

const textOf = (iso: string | null, facts: ZoneFacts): string | null =>
  iso === null ? null : clockText(new Date(iso), facts.timeZone, "time");

/** Guest reads already leave crew items out; the filter keeps a screen public if one slips in. */
const publicOnly = (items: AgendaItem[]): AgendaItem[] =>
  items.filter((i) => i.visibility === "public");

function agendaRows(facts: ZoneFacts): Record<string, unknown>[] {
  const rows = (items: AgendaItem[], state: "now" | "next") =>
    publicOnly(items).map((i) => ({
      id: i.id,
      name: i.title,
      state: i.delay_minutes > 0 ? "delayed" : state,
      starts_text: textOf(i.starts_at, facts),
      ends_text: textOf(i.ends_at, facts),
      starts_at: i.starts_at,
      ends_at: i.ends_at,
      delay_minutes: i.delay_minutes,
      location: i.location,
      kind: i.kind,
    }));
  return facts.agenda === null
    ? []
    : [...rows(facts.agenda.current, "now"), ...rows(facts.agenda.next, "next")];
}

/** The `countdown` view-model of `props.item_id`, else of the zone's next public item. */
export function countdownFields(facts: ZoneFacts, itemId?: string): Record<string, unknown> | null {
  if (facts.agenda === null) return null;
  const all = publicOnly([...facts.agenda.current, ...facts.agenda.next]);
  const item =
    itemId === undefined
      ? publicOnly(facts.agenda.next)[0]
      : all.find((i) => i.id === itemId && Date.parse(i.starts_at) > facts.now.getTime());
  if (item === undefined) return null;
  return { label: item.title, target_at: item.starts_at, ends_text: textOf(item.ends_at, facts) };
}

/** A type's fields, or null when it has nothing to show. */
function fields(type: string, props: Props, facts: ZoneFacts): Record<string, unknown> | null {
  switch (type) {
    case "clock":
      return {
        iso: facts.now.toISOString(),
        time: clockText(facts.now, facts.timeZone, "time"),
        date: clockText(facts.now, facts.timeZone, "date"),
      };
    case "agenda_now": {
      const items = agendaRows(facts);
      return items.length === 0 ? null : { title: "Now and next", items };
    }
    case "countdown":
      return countdownFields(facts, typeof props.item_id === "string" ? props.item_id : undefined);
    case "venue_info": {
      if (facts.venue === null) return null;
      const wifi = facts.venue.wifi
        .filter((n) => n.visibility === "public")
        .map((n) => ({ ssid: n.ssid, password: n.password, note: n.note }));
      const hasFloorPlan = facts.venue.floor_plan !== null;
      return wifi.length === 0 && !hasFloorPlan ? null : { wifi, has_floor_plan: hasFloorPlan };
    }
    case "qr": {
      const path = props.url;
      if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
      const url = facts.origin + path;
      return {
        url,
        label: typeof props.label === "string" ? props.label : "",
        image_url: qrImage(url),
      };
    }
    case "logo":
      return facts.logoUrl === null ? null : { url: facts.logoUrl, name: facts.eventName };
    case "ticker":
      return facts.ticker.text === null ? null : { ...facts.ticker };
    default:
      // playlist, photo, checkin_qr, embed (#308), the feeds of later steps and the claim-only
      // templates: no source on main yet.
      return null;
  }
}

/** Sources whose read failed: their widgets are empty and marked stale, never an error. */
function isStale(type: string, facts: ZoneFacts): boolean {
  if (type === "agenda_now" || type === "countdown") return facts.agenda === null;
  if (type === "venue_info") return facts.venue === null;
  return false;
}

export function viewOf(type: string, props: Props, facts: ZoneFacts): View {
  const found = fields(type, props, facts);
  return {
    ...(found ?? {}),
    qr: found === null ? null : qrFor(type, props, facts),
    stale: isStale(type, facts),
    empty: found === null,
  };
}
