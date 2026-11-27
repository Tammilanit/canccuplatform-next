/**
 * Which scene a zone is in (contracts/moments.md, Scenes; E7): the crew button wins until its
 * time ends, else the first scene of the list whose conditions hold, kept for its hold time
 * against any but a scene higher in the list. Also the heartbeat's rate (L10) and the band chart.
 * Pure: the clock and the facts come in.
 */
import { crewMinutes } from "./scenes.js";
import type { Condition, Mood, Scene } from "./scenes.js";

/** An agenda item as `GET /internal/agenda/items` answers it (contracts/agenda.md). */
export interface AgendaItem {
  id: string;
  title?: string | null;
  kind: string;
  zone?: string | null;
  visibility: string;
  status?: string;
  starts_at: string;
  ends_at: string | null;
}

export interface SceneFacts {
  now: number;
  timeZone: string;
  /** The event's whole agenda; each zone reads its own items and those of no zone. */
  items: readonly AgendaItem[];
  /** Arrival check-ins of the last 60 minutes. */
  checkinsLastHour: number;
  /** Members online as the bot last counted them; null while no count is known. */
  online: number | null;
  surging: boolean;
  crew: { scene: string; until: number; zones: string[] } | null;
}

export interface Picked {
  scene: Scene;
  crew: boolean;
  why: string;
}

const HOUR_MS = 3_600_000;

/** The items of a zone's day, as Screen reads its phase: public, scheduled, its own or no zone's. */
function zoneItems(items: readonly AgendaItem[], zone: string): AgendaItem[] {
  return items.filter(
    (i) =>
      i.visibility === "public" &&
      (i.status ?? "scheduled") === "scheduled" &&
      (i.zone == null || i.zone === zone),
  );
}

/** As step 3's phase: an item without an end counts an hour; quiet hours without one never run. */
function runs(i: AgendaItem, at: number): boolean {
  const start = Date.parse(i.starts_at);
  const end =
    i.ends_at !== null ? Date.parse(i.ends_at) : i.kind === "quiet_hours" ? null : start + HOUR_MS;
  return start <= at && end !== null && at < end;
}

const clocks = new Map<string, Intl.DateTimeFormat>();
function localParts(at: number, timeZone: string): { date: string; minutes: number } {
  let f = clocks.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    clocks.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const minutesOf = (clock: string): number =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

function holds(c: Condition, f: SceneFacts, items: readonly AgendaItem[]): boolean {
  switch (c.type) {
    case "time": {
      const t = localParts(f.now, f.timeZone).minutes;
      const from = minutesOf(c.from);
      const to = minutesOf(c.to);
      return from < to ? from <= t && t < to : t >= from || t < to;
    }
    case "agenda": {
      const ofKind = items.filter((i) => c.kinds.includes(i.kind));
      if (c.starts_within_minutes === undefined) return ofKind.some((i) => runs(i, f.now));
      const lead = c.starts_within_minutes * 60_000;
      return ofKind.some((i) => {
        const start = Date.parse(i.starts_at);
        return start > f.now && start - f.now <= lead;
      });
    }
    case "checkins":
      return f.checkinsLastHour > c.over;
    case "presence":
      return (
        f.online !== null &&
        (c.over === undefined || f.online > c.over) &&
        (c.under === undefined || f.online < c.under)
      );
    case "games":
      return f.surging;
    case "crew":
      // A press is the crew's, decided before the list (pickScene).
      return false;
  }
}

/** The condition that holds, or `always` for a scene without conditions; null when none does. */
function matchOf(s: Scene, f: SceneFacts, items: readonly AgendaItem[]): string | null {
  if (s.when.length === 0) return "always";
  const c = s.when.find((x) => holds(x, f, items));
  return c === undefined ? null : conditionText(c);
}

const appliesTo = (s: Scene, zone: string): boolean =>
  s.zones.length === 0 || s.zones.includes(zone);

/** Why a zone shows the scene the crew pressed; stored, so the next pass knows it was a press. */
export const CREW_WHY = "the crew pressed it";

/** The scene of `zone` now, or null while none holds (Screen then follows the day's phase). */
export function pickScene(
  list: readonly Scene[],
  f: SceneFacts,
  zone: string,
  current: { key: string; since: number; crew?: boolean } | null,
): Picked | null {
  const scenes = list.filter((s) => appliesTo(s, zone));
  const crew = f.crew;
  if (
    crew !== null &&
    f.now < crew.until &&
    (crew.zones.length === 0 || crew.zones.includes(zone))
  ) {
    const pressed = scenes.find((s) => s.key === crew.scene && crewMinutes(s) !== null);
    if (pressed !== undefined) return { scene: pressed, crew: true, why: CREW_WHY };
  }
  const items = zoneItems(f.items, zone);
  let first: Picked | null = null;
  for (const s of scenes) {
    const why = matchOf(s, f, items);
    if (why !== null) {
      first = { scene: s, crew: false, why };
      break;
    }
  }
  // A press holds until its time ends or it is pressed again (E7), never its hold time on top.
  if (current !== null && current.crew !== true && current.key !== first?.scene.key) {
    const at = scenes.findIndex((s) => s.key === current.key);
    const held = scenes[at];
    const higher = first !== null && scenes.indexOf(first.scene) < at;
    if (held !== undefined && !higher && f.now < current.since + held.hold_minutes * 60_000) {
      return { scene: held, crew: false, why: `held for at least ${held.hold_minutes} min` };
    }
  }
  return first;
}

/** A condition in words, for the history of a change and the Scenes page. */
export function conditionText(c: Condition): string {
  switch (c.type) {
    case "time":
      return `every day ${c.from}–${c.to}`;
    case "agenda": {
      const kinds = c.kinds.join(" or ").replace(/_/g, " ");
      return c.starts_within_minutes === undefined
        ? `${kinds} on the run of show`
        : `${kinds} within ${c.starts_within_minutes} min`;
    }
    case "checkins":
      return `over ${c.over} check-ins an hour`;
    case "presence":
      return [
        c.over === undefined ? null : `over ${c.over} online`,
        c.under === undefined ? null : `under ${c.under} online`,
      ]
        .filter((x) => x !== null)
        .join(" and ");
    case "games":
      return "a game is surging";
    case "crew":
      return `the crew button, for ${c.minutes} min`;
  }
}

const BEAT_OF: Record<Mood, number> = {
  quiet_hours: 4,
  wind_down: 6,
  build_up: 8,
  doors: 10,
  peak: 12,
};

/**
 * The visual heartbeat's rate in beats a minute (L10): the mood's own, one more for every five
 * check-ins of the last hour and every 60 people online (presence once the bot counts it).
 */
export function heartbeatOf(mood: Mood | null, f: SceneFacts): number {
  const busy = Math.floor(f.checkinsLastHour / 5) + Math.floor((f.online ?? 0) / 60);
  return Math.min(30, Math.max(4, BEAT_OF[mood ?? "build_up"] + busy));
}

const STEP_MS = 5 * 60_000;

export interface DayBands {
  date: string;
  bands: { from: string; to: string; scene: string }[];
}

const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * What the time and agenda conditions alone will do on each day from `from` to `to` (the band
 * chart, sheet 12): people, games, check-ins, the crew and holds are left out, as nobody knows them
 * ahead. Sampled every 5 minutes.
 */
export function bandsOf(
  list: readonly Scene[],
  o: { timeZone: string; items: readonly AgendaItem[]; zone: string; from: number; to: number },
): DayBands[] {
  const days: DayBands[] = [];
  let open: { date: string; from: number; scene: string | null } | null = null;
  const close = (date: string, to: number): void => {
    if (open === null || open.scene === null) return;
    let day = days.find((d) => d.date === date);
    if (day === undefined) {
      day = { date, bands: [] };
      days.push(day);
    }
    day.bands.push({ from: clock(open.from), to: clock(to), scene: open.scene });
  };
  for (let at = o.from; at < o.to; at += STEP_MS) {
    const f: SceneFacts = {
      now: at,
      timeZone: o.timeZone,
      items: o.items,
      checkinsLastHour: 0,
      online: null,
      surging: false,
      crew: null,
    };
    const key = pickScene(list, f, o.zone, null)?.scene.key ?? null;
    const { date, minutes } = localParts(at, o.timeZone);
    if (open !== null && open.date !== date) {
      close(open.date, 24 * 60);
      open = { date, from: minutes, scene: key };
    } else if (open === null || open.scene !== key) {
      if (open !== null) close(open.date, minutes);
      open = { date, from: minutes, scene: key };
    }
  }
  if (open !== null) {
    const end = localParts(o.to, o.timeZone);
    close(open.date, end.date === open.date ? end.minutes : 24 * 60);
  }
  return days;
}
