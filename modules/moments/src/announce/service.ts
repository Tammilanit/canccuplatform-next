/**
 * Announcements on the engine (contracts/moments.md, Announcements; #115). An announcement shows
 * through up to two crew moments: its card (class `announcement`, the level's chain) and its ticker
 * line (a claim in the `ticker` role, D13). Every function runs in the caller's tenant transaction,
 * so the row, the moments and the events commit together; the tick sends what is due, follows the
 * run-of-show and ends what is over from the rows alone.
 */
import { randomUUID } from "node:crypto";
import type { SqlClient } from "@canccu/kit";
import type { Engine, MomentRequest } from "../engine.js";
import { lockMoment } from "../store.js";
import type { Actor, MomentRow } from "../store.js";
import { BODY_MAX, TITLE_MAX, cut, fill } from "./text.js";
import { actorOfRow, insertAnnouncement, runOfShow, saveAnnouncement } from "./store.js";
import type { AnnouncementRow, Channels, EndReason, Level, RunItem, When } from "./store.js";

/** How long the "Updated" chip shows after an edit (L13). */
export const UPDATED_SECONDS = 60;

/** The card's chain per level (L3); full screen puts `full` first (L2's note). */
export function chainOf(level: Level, fullScreen: boolean): string[] {
  const chain = level === "urgent" ? ["rail", "hero", "ticker"] : ["rail", "ticker"];
  return fullScreen ? ["full", ...chain] : chain;
}

const CUE: Record<Level, string> = { info: "announce.attention", urgent: "announce.urgent" };

/** What the composer sends, validated by the route. */
export interface Draft {
  level: Level;
  full_screen: boolean;
  title_text: string;
  body_text: string;
  variables: Record<string, string>;
  item_id: string | null;
  channels: Channels;
  zones: string[];
  duration_seconds: number;
  when: When;
  event_name: string;
  time_zone: string;
  template_key: string | null;
}

export interface Filled {
  title: string;
  body: string;
  /** The ticker line's text: the title and the body joined. */
  line: string;
}

/**
 * The texts filled from the item as it is now, cut to the limits: a scheduled one whose
 * `{item.starts_in}` grew still goes out. The composer checks the uncut length (`limits: false`).
 */
export function filled(
  a: Pick<AnnouncementRow, "title_text" | "body_text" | "variables" | "event_name" | "time_zone">,
  item: RunItem | null,
  now: Date,
  limits = true,
): Filled {
  const ctx = { item, eventName: a.event_name, timeZone: a.time_zone, now };
  const title = fill(a.title_text, ctx, a.variables).trim();
  const body = fill(a.body_text, ctx, a.variables).trim();
  return limits ? joined(cut(title, TITLE_MAX), cut(body, BODY_MAX)) : joined(title, body);
}

/** The ticker line is the title and the body joined. */
export const joined = (title: string, body: string): Filled => ({
  title,
  body,
  line: body === "" ? title : `${title} · ${body}`,
});

/** Composes one: sends it now, or keeps it scheduled for the tick. */
export async function compose(
  c: SqlClient,
  engine: Engine,
  d: Draft,
  actor: Actor,
  now: Date,
): Promise<AnnouncementRow> {
  const a: AnnouncementRow = {
    ...d,
    id: `an_${randomUUID()}`,
    status: "scheduled",
    title: null,
    body: null,
    fire_at: null,
    card_moment_id: null,
    line_moment_id: null,
    sent_at: null,
    expires_at: null,
    updated_until: null,
    ended_at: null,
    end_reason: null,
    why: null,
    actor_user_id: actor.user_id,
    actor_name: actor.name,
    created_at: now,
  };
  const items = await runOfShow(c);
  a.fire_at = fireAt(a, items, now);
  await insertAnnouncement(c, a);
  if (d.when.mode === "now") await send(c, engine, a, itemOf(a, items), now);
  return a;
}

export const itemOf = (a: AnnouncementRow, items: RunItem[] | null): RunItem | null =>
  a.item_id === null ? null : (items?.find((i) => i.id === a.item_id) ?? null);

/** When a scheduled one goes out, as now known: its time, or its item's start less the lead. */
export function fireAt(a: AnnouncementRow, items: RunItem[] | null, now: Date): Date | null {
  if (a.when.mode === "now") return now;
  if (a.when.mode === "at") return a.when.at === undefined ? now : new Date(a.when.at);
  const item = itemOf(a, items);
  if (item === null) return a.fire_at;
  return new Date(Date.parse(item.starts_at) - (a.when.minutes_before ?? 0) * 60_000);
}

export async function send(
  c: SqlClient,
  engine: Engine,
  a: AnnouncementRow,
  item: RunItem | null,
  now: Date,
): Promise<void> {
  const text = filled(a, item, now);
  const actor = actorOfRow(a);
  const expires = new Date(now.getTime() + a.duration_seconds * 1000);
  const base = {
    class: "announcement",
    origin: "crew",
    why: `${a.actor_name ?? "The crew"} · announcement`,
    zones: a.zones,
    ttl_seconds: a.duration_seconds,
    source: { module: "moments", event_id: null, ref: a.id },
    actor,
  } satisfies Partial<MomentRequest>;
  if (a.channels.ticker) {
    const r = await engine.request(
      c,
      { ...base, template: "ticker", regions: ["ticker"], content: lineContent(a, text, expires) },
      now,
    );
    if (r.status !== "refused") a.line_moment_id = r.moment.id;
  }
  if (a.channels.screen) {
    // A millisecond after its line: on a tie in the ticker role Screen places the later start
    // first, so where the card itself degrades to the ticker it wins the role and draws both (L4).
    const r = await engine.request(
      c,
      {
        ...base,
        template: "announcement",
        regions: chainOf(a.level, a.full_screen),
        content: cardContent(a, text, now),
        cue: CUE[a.level],
        ...(item === null ? {} : { source_starts_at: new Date(item.starts_at) }),
      },
      new Date(now.getTime() + 1),
    );
    if (r.status !== "refused") a.card_moment_id = r.moment.id;
  }
  a.status = "live";
  a.title = text.title;
  a.body = text.body;
  a.sent_at = now;
  a.fire_at = now;
  a.expires_at = expires;
  await saveAnnouncement(c, a);
  await emit(c, engine, "moments.announcement.sent", eventData(a));
}

function cardContent(a: AnnouncementRow, text: Filled, startsAt: Date): Record<string, unknown> {
  return {
    title: text.title,
    body: text.body,
    level: a.level,
    starts_at: startsAt.toISOString(),
    updated: false,
    ticker_line: a.channels.ticker ? text.line : null,
  };
}

function lineContent(a: AnnouncementRow, text: Filled, until: Date): Record<string, unknown> {
  return {
    text: text.line,
    until: until.toISOString(),
    source: "moments",
    urgent: a.level === "urgent",
    updated: false,
  };
}

/** `.sent` and `.changed` carry the same fields (contracts/events.md). */
function eventData(a: AnnouncementRow): Record<string, unknown> {
  return {
    id: a.id,
    level: a.level,
    urgent: a.level === "urgent",
    full_screen: a.full_screen,
    title: a.title,
    body: a.body,
    channels: a.channels,
    zones: a.zones,
    visibility: "public",
    item_id: a.item_id,
    sent_at: a.sent_at?.toISOString() ?? null,
    expires_at: a.expires_at?.toISOString() ?? null,
    actor_user_id: a.actor_user_id,
  };
}

async function emit(
  c: SqlClient,
  engine: Engine,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  await engine.outbox.add(c, type, data, { version: 1 });
}

/** The running moments of a live one, locked. */
export async function momentsOf(c: SqlClient, a: AnnouncementRow): Promise<MomentRow[]> {
  const out: MomentRow[] = [];
  for (const id of [a.line_moment_id, a.card_moment_id]) {
    if (id === null) continue;
    const m = await lockMoment(c, id);
    if (m !== null && m.ended_at === null) out.push(m);
  }
  return out;
}

/** Sets `updated` on its moments' content, and anything else `patch` names; no cue ever plays. */
export async function patchMoments(
  c: SqlClient,
  engine: Engine,
  a: AnnouncementRow,
  text: Filled,
  updated: boolean,
  now: Date,
): Promise<void> {
  for (const m of await momentsOf(c, a)) {
    const next =
      m.template === "ticker"
        ? { ...m.content, text: text.line, updated }
        : {
            ...m.content,
            title: text.title,
            body: text.body,
            ticker_line: a.channels.ticker ? text.line : null,
            updated,
          };
    await engine.setContent(c, m, next, now);
  }
}

/**
 * New texts. A live one changes in place on every channel and zone, with the "Updated" chip and no
 * new sound (L13, E16); a scheduled one only keeps them for when it goes out.
 */
export async function editAnnouncement(
  c: SqlClient,
  engine: Engine,
  a: AnnouncementRow,
  e: { title_text: string; body_text: string; variables: Record<string, string> },
  actor: Actor,
  now: Date,
): Promise<void> {
  a.title_text = e.title_text;
  a.body_text = e.body_text;
  a.variables = e.variables;
  if (a.status !== "live") {
    await saveAnnouncement(c, a);
    return;
  }
  const text = filled(a, itemOf(a, await runOfShow(c)), now);
  const changed = [
    ...(text.title === a.title ? [] : ["title"]),
    ...(text.body === a.body ? [] : ["body"]),
  ];
  a.title = text.title;
  a.body = text.body;
  a.updated_until = new Date(now.getTime() + UPDATED_SECONDS * 1000);
  await patchMoments(c, engine, a, text, true, now);
  await saveAnnouncement(c, a);
  await emit(c, engine, "moments.announcement.changed", {
    ...eventData(a),
    changed,
    actor_user_id: actor.user_id,
  });
}

/** Ends it everywhere at once, silently; a scheduled one never goes out. */
export async function withdrawAnnouncement(
  c: SqlClient,
  engine: Engine,
  a: AnnouncementRow,
  w: { reason: EndReason; why: string; actor: Actor | null },
  now: Date,
): Promise<void> {
  const wasLive = a.status === "live";
  for (const m of await momentsOf(c, a)) await engine.end(c, m, "cleared", w.actor, now);
  a.status = "withdrawn";
  a.ended_at = now;
  a.end_reason = w.reason;
  a.why = w.why;
  a.updated_until = null;
  await saveAnnouncement(c, a);
  if (wasLive) {
    await emit(c, engine, "moments.announcement.withdrawn", {
      id: a.id,
      reason: w.reason,
      why: w.why,
      actor_user_id: w.actor?.user_id ?? null,
    });
  }
}
