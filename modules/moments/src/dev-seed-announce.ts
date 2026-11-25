/**
 * The demo event's announcements on the dev server (#788): `node dist/dev-seed-cli.js` schedules,
 * for each day of the demo run of show (modules/agenda/src/canccu_agenda/dev_seed.py), one info
 * announcement 15 minutes before its tournament item and one urgent one 30 minutes before its
 * raffle, so the rail and the ticker get a card and a line each day, as a crew's would.
 *
 * At a time, with the texts filled now, rather than bound to the item: Moments' own copy of the
 * run of show follows the agenda's events, and an announcement whose item it does not know yet
 * would be withdrawn as removed (E15). Each item gets its one announcement once (the mark keeps
 * which), so one someone edited or withdrew is never made again; `force` (resetting the demo
 * event) withdraws the seed's that have not gone out and schedules them afresh.
 */
import { DEMO_TENANT, withTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { Db } from "./db.js";
import { Refused } from "./dev-seed.js";
import type { AgendaItem } from "./scene-eval.js";
import { draftRow } from "./announce/service.js";
import type { Draft } from "./announce/service.js";
import { insertAnnouncement, readAnnouncement, saveAnnouncement } from "./announce/store.js";
import type { Level } from "./announce/store.js";
import { readMark, writeMark } from "./story/store.js";

export { Refused };

export const UP_TO_DATE = "the demo announcements are scheduled; nothing changed";
export const NOTHING_AHEAD = "the run of show has no tournament or raffle ahead; no announcement";
export const scheduled = (n: number) => `scheduled ${n} demo announcement${n === 1 ? "" : "s"}`;

const MARK = "dev-seed-announcements";
const MIN = 60_000;
/** The composer's limit for a time ahead (contracts/moments.md, Sending). */
const MAX_AHEAD_MS = 14 * 24 * 60 * MIN;

/** Item id → the announcement the seed made for it. */
type Mark = Record<string, string>;

interface Planned {
  item_id: string;
  level: Level;
  title: string;
  body: string;
  at: Date;
}

const hhmm = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(at);

/** The day's two, for the agenda seed's tournament items and raffles still ahead. */
function plan(items: readonly AgendaItem[], timeZone: string, now: Date): Planned[] {
  const out: Planned[] = [];
  for (const i of items) {
    const title = (i as { title?: unknown }).title;
    if (typeof title !== "string" || i.visibility !== "public") continue;
    if ((i.status ?? "scheduled") !== "scheduled") continue;
    const starts = new Date(i.starts_at);
    const time = hhmm(starts, timeZone);
    if (title.startsWith("Tournament: "))
      out.push({
        item_id: i.id,
        level: "info",
        title: `${title} at ${time}`,
        body: "Teams to the stage desk to check in.",
        at: new Date(starts.getTime() - 15 * MIN),
      });
    else if (title === "Raffle")
      out.push({
        item_id: i.id,
        level: "urgent",
        title: `Raffle at ${time}`,
        body: "Keep your ticket at hand: winners must be in the hall.",
        at: new Date(starts.getTime() - 30 * MIN),
      });
  }
  const ahead = (p: Planned) =>
    p.at.getTime() > now.getTime() && p.at.getTime() - now.getTime() <= MAX_AHEAD_MS;
  return out.filter(ahead).sort((a, b) => a.at.getTime() - b.at.getTime());
}

function draftOf(p: Planned, o: { timeZone: string; eventName: string }): Draft {
  return {
    level: p.level,
    full_screen: false,
    title_text: p.title,
    body_text: p.body,
    variables: {},
    item_id: null,
    // Screens only: demo data never goes to Discord or a phone.
    channels: { screen: true, ticker: true, discord: false, push: false },
    zones: [],
    duration_seconds: 300,
    when: { mode: "at", at: p.at.toISOString() },
    event_name: o.eventName,
    time_zone: o.timeZone,
    template_key: null,
  };
}

/** The seed's own that have not gone out; they have no moments yet, so nothing else ends. */
async function withdrawScheduled(c: SqlClient, mark: Mark, now: Date): Promise<void> {
  for (const id of Object.values(mark)) {
    const a = await readAnnouncement(c, id);
    if (a === null || a.status !== "scheduled") continue;
    a.status = "withdrawn";
    a.ended_at = now;
    a.end_reason = "withdrawn";
    a.why = "The demo event was reset.";
    await saveAnnouncement(c, a);
  }
}

export async function seedDemoAnnouncements(
  d: { db: Db; now: () => Date },
  o: {
    version: string;
    items: readonly AgendaItem[] | null;
    timeZone: string;
    eventName: string;
    force: boolean;
  },
): Promise<string> {
  if (o.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${o.version}, not dev: nothing changed`);
  const now = d.now();
  const planned = plan(o.items ?? [], o.timeZone, now);
  return withTenant(DEMO_TENANT, () =>
    d.db.tenant(async (c) => {
      const before = (await readMark<Mark>(c, MARK)) ?? {};
      if (o.force) await withdrawScheduled(c, before, now);
      const mark: Mark = o.force ? {} : { ...before };
      let added = 0;
      for (const p of planned) {
        if (mark[p.item_id] !== undefined) continue;
        const a = draftRow(draftOf(p, o), null, now);
        a.fire_at = p.at;
        await insertAnnouncement(c, a);
        mark[p.item_id] = a.id;
        added++;
      }
      // Only the run of show's items: the agenda seed moves the demo days, which leaves old ids.
      const kept = Object.fromEntries(
        Object.entries(mark).filter(([item]) => (o.items ?? []).some((i) => i.id === item)),
      );
      if (JSON.stringify(kept) !== JSON.stringify(before)) await writeMark(c, MARK, kept);
      if (added > 0) return scheduled(added);
      return planned.length === 0 ? NOTHING_AHEAD : UP_TO_DATE;
    }),
  );
}
