/**
 * The screen's copy of the run-of-show (plan #108, D7): each item's current times and status,
 * kept from the `agenda.item.*` events, so a delay moves the windows bound to its item. Every
 * event carries the whole item as crew sees it, so a crew item keeps its windows too. Main reads
 * the agenda streams from their start at every boot, so events may come twice or out of turn:
 * `agenda_version` (or, on started and ended, which carry none, the item's `revision`) decides,
 * and a removed item stays removed. A replay of the event that wrote a row applies again, so a row
 * kept before titles and visibility were (migration 010) fills at the next start.
 */
import type { Event, SqlClient } from "@canccu/kit";
import type { Db } from "../db.js";
import type { AgendaTimes } from "../schedule/winner.js";

const VERSIONED = new Set([
  "agenda.item.added",
  "agenda.item.changed",
  "agenda.item.delayed",
  "agenda.item.cancelled",
]);
const UNVERSIONED = new Set(["agenda.item.started", "agenda.item.ended"]);

interface Item {
  id: string;
  title: string | null;
  visibility: string | null;
  startsAt: string;
  endsAt: string | null;
  status: "scheduled" | "cancelled";
  revision: number;
}

function time(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function itemOf(value: unknown): Item | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const startsAt = time(v.starts_at);
  const endsAt = v.ends_at === null ? null : time(v.ends_at);
  if (
    typeof v.id !== "string" ||
    startsAt === null ||
    (endsAt === null && v.ends_at !== null) ||
    (v.status !== "scheduled" && v.status !== "cancelled") ||
    !Number.isInteger(v.revision)
  ) {
    return null;
  }
  return {
    id: v.id,
    title: typeof v.title === "string" ? v.title : null,
    visibility: typeof v.visibility === "string" ? v.visibility : null,
    startsAt,
    endsAt,
    status: v.status,
    revision: v.revision as number,
  };
}

const UPSERT = `INSERT INTO screen_agenda_items
    (id, starts_at, ends_at, status, revision, agenda_version, title, visibility)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (tenant_id, id) DO UPDATE SET starts_at = EXCLUDED.starts_at,
    title = EXCLUDED.title, visibility = EXCLUDED.visibility,
    ends_at = EXCLUDED.ends_at, status = EXCLUDED.status, revision = EXCLUDED.revision,
    agenda_version = COALESCE(EXCLUDED.agenda_version, screen_agenda_items.agenda_version),
    removed = false`;

/** Apply one event of the agenda's tenant stream; run inside the event's tenant. */
export async function applyAgendaEvent(db: Db, event: Event): Promise<void> {
  const version = event.data.agenda_version;
  if (event.type === "agenda.item.removed") {
    const id = event.data.item_id;
    if (typeof id !== "string" || !Number.isInteger(version)) return;
    await db.tenant((c) =>
      c.query(
        `INSERT INTO screen_agenda_items (id, status, removed, revision, agenda_version)
         VALUES ($1, 'scheduled', true, 0, $2)
         ON CONFLICT (tenant_id, id) DO UPDATE SET removed = true, agenda_version = $2
         WHERE screen_agenda_items.agenda_version IS NULL OR screen_agenda_items.agenda_version < $2`,
        [id, version],
      ),
    );
    return;
  }
  const versioned = VERSIONED.has(event.type);
  if (!versioned && !UNVERSIONED.has(event.type)) return;
  const item = itemOf(event.data.item);
  if (item === null || (versioned && !Number.isInteger(version))) return;
  const guard = versioned
    ? "WHERE screen_agenda_items.agenda_version IS NULL OR screen_agenda_items.agenda_version <= EXCLUDED.agenda_version"
    : "WHERE NOT screen_agenda_items.removed AND screen_agenda_items.revision < EXCLUDED.revision";
  await db.tenant((c) =>
    c.query(`${UPSERT} ${guard}`, [
      item.id,
      item.startsAt,
      item.endsAt,
      item.status,
      item.revision,
      versioned ? version : null,
      item.title,
      item.visibility,
    ]),
  );
}

/** The items the scheduler's bound windows follow, by id. */
export async function loadAgendaItems(c: SqlClient): Promise<Map<string, AgendaTimes>> {
  const { rows } = await c.query(
    "SELECT id, starts_at, ends_at, status FROM screen_agenda_items WHERE NOT removed",
  );
  return new Map(
    rows.map((r) => [
      r.id as string,
      {
        id: r.id as string,
        startsAt: r.starts_at as Date,
        endsAt: (r.ends_at as Date | null) ?? null,
        status: r.status as AgendaTimes["status"],
      },
    ]),
  );
}

/** What the schedule calendar shows of a bound window's item: its title, and whether only crew may see it (also when its visibility is unknown). */
export interface AgendaLabel {
  title: string | null;
  crew: boolean;
}

export async function loadAgendaLabels(c: SqlClient): Promise<Map<string, AgendaLabel>> {
  const { rows } = await c.query(
    "SELECT id, title, visibility FROM screen_agenda_items WHERE NOT removed",
  );
  return new Map(
    rows.map((r) => [
      r.id as string,
      // Fails closed: a row kept before migration 010 whose last event the replay could not
      // re-apply (a trimmed stream, or an `agenda.items.cloned` copy) has no visibility yet.
      {
        title: (r.title as string | null) ?? null,
        crew: r.visibility !== "public" && r.visibility !== "attendees",
      },
    ]),
  );
}
