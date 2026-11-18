/** The announcements' rows and the run-of-show items they read (contracts/moments.md, Announcements). */
import type { SqlClient } from "@canccu/kit";
import type { Actor } from "../store.js";

export type Level = "info" | "urgent";
export type Status = "scheduled" | "live" | "ended" | "withdrawn";
export type EndReason =
  "expired" | "withdrawn" | "item_cancelled" | "item_removed" | "ended_on_air";

export interface Channels {
  screen: boolean;
  ticker: boolean;
  discord: boolean;
  push: boolean;
}

export interface When {
  mode: "now" | "at" | "item";
  at?: string;
  minutes_before?: number;
}

export interface AnnouncementRow {
  id: string;
  status: Status;
  level: Level;
  full_screen: boolean;
  title_text: string;
  body_text: string;
  variables: Record<string, string>;
  item_id: string | null;
  title: string | null;
  body: string | null;
  channels: Channels;
  zones: string[];
  duration_seconds: number;
  when: When;
  fire_at: Date | null;
  event_name: string;
  time_zone: string;
  template_key: string | null;
  card_moment_id: string | null;
  line_moment_id: string | null;
  sent_at: Date | null;
  expires_at: Date | null;
  updated_until: Date | null;
  ended_at: Date | null;
  end_reason: EndReason | null;
  why: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: Date;
}

const COLUMNS = `id, status, level, full_screen, title_text, body_text, variables, item_id, title, body,
  channels, zones, duration_seconds, "when", fire_at, event_name, time_zone, template_key,
  card_moment_id, line_moment_id, sent_at, expires_at, updated_until, ended_at, end_reason, why,
  actor_user_id, actor_name, created_at`;

const rowOf = (r: Record<string, unknown>): AnnouncementRow => r as unknown as AnnouncementRow;

export async function insertAnnouncement(c: SqlClient, a: AnnouncementRow): Promise<void> {
  await c.query(
    `INSERT INTO moments_announcements (${COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
       $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)`,
    values(a),
  );
}

export async function saveAnnouncement(c: SqlClient, a: AnnouncementRow): Promise<void> {
  await c.query(
    `UPDATE moments_announcements SET status = $2, level = $3, full_screen = $4, title_text = $5,
       body_text = $6, variables = $7, item_id = $8, title = $9, body = $10, channels = $11,
       zones = $12, duration_seconds = $13, "when" = $14, fire_at = $15, event_name = $16,
       time_zone = $17, template_key = $18, card_moment_id = $19, line_moment_id = $20,
       sent_at = $21, expires_at = $22, updated_until = $23, ended_at = $24, end_reason = $25,
       why = $26, actor_user_id = $27, actor_name = $28, created_at = $29
     WHERE id = $1`,
    values(a),
  );
}

function values(a: AnnouncementRow): unknown[] {
  return [
    a.id,
    a.status,
    a.level,
    a.full_screen,
    a.title_text,
    a.body_text,
    JSON.stringify(a.variables),
    a.item_id,
    a.title,
    a.body,
    JSON.stringify(a.channels),
    a.zones,
    a.duration_seconds,
    JSON.stringify(a.when),
    a.fire_at,
    a.event_name,
    a.time_zone,
    a.template_key,
    a.card_moment_id,
    a.line_moment_id,
    a.sent_at,
    a.expires_at,
    a.updated_until,
    a.ended_at,
    a.end_reason,
    a.why,
    a.actor_user_id,
    a.actor_name,
    a.created_at,
  ];
}

export async function lockAnnouncement(c: SqlClient, id: string): Promise<AnnouncementRow | null> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments_announcements WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] === undefined ? null : rowOf(rows[0]);
}

/** Unlocked, for pages: a render must never wait on, or hold up, the tick or a crew action. */
export async function readAnnouncement(c: SqlClient, id: string): Promise<AnnouncementRow | null> {
  const { rows } = await c.query(`SELECT ${COLUMNS} FROM moments_announcements WHERE id = $1`, [
    id,
  ]);
  return rows[0] === undefined ? null : rowOf(rows[0]);
}

/** The open ones (scheduled or live), locked; another container's are skipped, as the tick's. */
export async function openAnnouncements(
  c: SqlClient,
  status: "scheduled" | "live",
): Promise<AnnouncementRow[]> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM moments_announcements WHERE status = $1
     ORDER BY created_at, id FOR UPDATE SKIP LOCKED`,
    [status],
  );
  return rows.map(rowOf);
}

/** Live and scheduled first (soonest first), then the last 20 that ended. */
export async function listAnnouncements(c: SqlClient): Promise<AnnouncementRow[]> {
  const open = await c.query(
    `SELECT ${COLUMNS} FROM moments_announcements WHERE status IN ('live', 'scheduled')
     ORDER BY status, coalesce(sent_at, fire_at, created_at), id`,
    [],
  );
  const closed = await c.query(
    `SELECT ${COLUMNS} FROM moments_announcements WHERE status IN ('ended', 'withdrawn')
     ORDER BY ended_at DESC, id LIMIT 20`,
    [],
  );
  return [...open.rows, ...closed.rows].map(rowOf);
}

export const actorOfRow = (a: AnnouncementRow): Actor | null =>
  a.actor_user_id === null ? null : { user_id: a.actor_user_id, name: a.actor_name ?? "" };

export interface RunItem {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  status?: string;
  kind?: string;
  visibility?: string;
}

/** The right that lets a caller read `crew` items (contracts/agenda.md, Who sees what). */
export const CREW_READ = "agenda.crew.read";

/**
 * Whether the caller may see the item. An announcement goes out as public, so the composer must
 * not be a way around the agenda's visibility: `public` for all, the rest only for crew readers
 * (the session carries no event membership, so `attendees` items stay with the crew too).
 */
export const canSee = (item: RunItem, rights: ReadonlySet<string>): boolean =>
  item.visibility === "public" || rights.has(CREW_READ);

/**
 * The run-of-show as Moments keeps it (scenes read the same row), or null while it has never been
 * read: then no item can be told missing, so nothing is withdrawn for it.
 */
export async function runOfShow(c: SqlClient): Promise<RunItem[] | null> {
  const { rows } = await c.query(
    `SELECT data FROM moments_sources WHERE kind = 'agenda' AND ref = ''`,
    [],
  );
  const items = (rows[0]?.data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return null;
  return items.filter(
    (i): i is RunItem =>
      typeof i === "object" &&
      i !== null &&
      typeof (i as RunItem).id === "string" &&
      typeof (i as RunItem).title === "string" &&
      typeof (i as RunItem).starts_at === "string",
  );
}
