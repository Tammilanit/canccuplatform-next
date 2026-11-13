/**
 * The widgets' view-models (contracts/screen.md, Widgets): the only data a template can read.
 * Types whose source is not on main yet answer `empty` (plan S13) and are filled by their slice.
 */
import qrcode from "qrcode-generator";
import type { Props } from "./layouts.js";
import type { PlaylistView } from "./playing.js";

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
  /**
   * Read only for a zone that shows the widget, so another zone's version never moves with them
   * (src/compose/state.ts). Absent: not read; `null`: nothing to show, or (`checkin`) the read failed.
   */
  playlist?: PlaylistView | null;
  photo?: Record<string, unknown> | null;
  checkin?: CheckinCode | null;
  /** The theme's embeds (contracts/theming.md, Embeds). */
  embeds?: { name: string; frame_url: string }[];
}

/** Notify's rotating code (contracts/notify.md, Check-in by the rotating QR). */
export interface CheckinCode {
  purpose: string;
  code: string;
  url: string;
  valid_until: string;
  rotates_at: string;
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
  /** Only in the module read of all items (`GET /internal/agenda/items`). */
  status?: string;
  zone?: string | null;
  /** The planned end, before any delay (contracts/agenda.md); a moved end differs from it. */
  planned_ends_at?: string | null;
}
export interface AgendaNow {
  current: AgendaItem[];
  next: AgendaItem[];
  /** The items after next (`agenda_now`'s `later`, laterOf); absent: none. */
  later?: AgendaItem[];
}

const LATER_MAX = 2;

/**
 * The `public`, `scheduled` items of the zone or of no zone that start after the next ones, at most
 * two, in order of start (contracts/screen.md, `agenda_now`): what follows the item a hero counts
 * down to. None while nothing is next.
 */
export function laterOf(all: AgendaItem[], next: AgendaItem[], zoneKey: string): AgendaItem[] {
  const after = Math.max(...next.map((i) => Date.parse(i.starts_at)));
  if (!Number.isFinite(after)) return [];
  return all
    .filter(
      (i) =>
        i.visibility === "public" &&
        i.status === "scheduled" &&
        (i.zone == null || i.zone === zoneKey) &&
        Date.parse(i.starts_at) > after,
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, LATER_MAX);
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

/** The agenda's screen read already leaves non-public items out; the filter keeps a screen public if one slips in. */
const publicOnly = (items: AgendaItem[]): AgendaItem[] =>
  items.filter((i) => i.visibility === "public");

const rows = (items: AgendaItem[], state: "now" | "next", facts: ZoneFacts) =>
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

function agendaRows(facts: ZoneFacts): Record<string, unknown>[] {
  return facts.agenda === null
    ? []
    : [...rows(facts.agenda.current, "now", facts), ...rows(facts.agenda.next, "next", facts)];
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

/** The code's URL is the path alone while the event has no primary hostname: made whole here. */
function checkinFields(code: CheckinCode, facts: ZoneFacts): Record<string, unknown> {
  const url = code.url.startsWith("/") ? facts.origin + code.url : code.url;
  return {
    url,
    label: "Check in",
    image_url: qrImage(url),
    purpose: code.purpose,
    rotates_at: code.rotates_at,
    valid_until: code.valid_until,
  };
}

/** A type's fields, or null when it has nothing to show. */
function fields(
  type: string,
  props: Props,
  facts: ZoneFacts,
  embed: string | null,
): Record<string, unknown> | null {
  switch (type) {
    case "clock":
      return {
        iso: facts.now.toISOString(),
        time: clockText(facts.now, facts.timeZone, "time"),
        date: clockText(facts.now, facts.timeZone, "date"),
      };
    case "agenda_now": {
      const items = agendaRows(facts);
      const later = rows(facts.agenda?.later ?? [], "next", facts);
      return items.length === 0 ? null : { title: "Now and next", items, later };
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
    case "playlist":
      return facts.playlist == null ? null : { ...facts.playlist };
    case "photo":
      return facts.photo ?? null;
    case "checkin_qr":
      return facts.checkin == null ? null : checkinFields(facts.checkin, facts);
    case "embed": {
      const found = facts.embeds?.find((e) => e.name === embed);
      return found === undefined ? null : { frame_url: found.frame_url, logo_url: facts.logoUrl };
    }
    default:
      // The feeds of later steps and the claim-only templates: no source on main yet.
      return null;
  }
}

/** Sources whose read failed: their widgets are empty and marked stale, never an error. */
function isStale(type: string, facts: ZoneFacts): boolean {
  if (type === "agenda_now" || type === "countdown") return facts.agenda === null;
  if (type === "venue_info") return facts.venue === null;
  if (type === "checkin_qr") return facts.checkin === null;
  return false;
}

export function viewOf(
  type: string,
  props: Props,
  facts: ZoneFacts,
  embed: string | null = null,
): View {
  const found = fields(type, props, facts, embed);
  return {
    ...(found ?? {}),
    qr: found === null ? null : qrFor(type, props, facts),
    stale: isStale(type, facts),
    empty: found === null,
  };
}
