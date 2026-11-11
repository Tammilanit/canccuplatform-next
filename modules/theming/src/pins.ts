/**
 * The event's pins as theming keeps them (contracts/screen.md, Pins; contracts/theming.md, Kept;
 * plan D12): the theme revision screens are pinned to and the one a timed pin restores, from
 * `screen.pin.changed`, so retention never prunes either. The freeze itself is screen's (#190);
 * theming honours it by keeping and serving what it pins.
 */
import type { Bus, Event, TenantSubscription } from "@canccu/kit";
import { isObject } from "./checks.js";
import { lockHistory } from "./publish.js";
import { pruneQuietly } from "./retention.js";
import type { StoredDeps } from "./stored.js";

interface Pin {
  theme: number | null;
  restores: number | null;
}

/** A revision number, null for none, undefined for a value no revision can be. */
function revision(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : undefined;
}

function parsePin(data: Record<string, unknown>): Pin | undefined {
  const theme = revision(data.theme_revision);
  const restores =
    data.restores === null || data.restores === undefined
      ? null
      : isObject(data.restores)
        ? revision(data.restores.theme_revision)
        : undefined;
  return theme === undefined || restores === undefined ? undefined : { theme, restores };
}

/** Handles one event of the screen module's stream, in its tenant (the bus sets it). */
export function pinHandler(deps: StoredDeps): (event: Event) => Promise<void> {
  return async (event: Event) => {
    if (event.type !== "screen.pin.changed") return;
    const pin = parsePin(event.data);
    if (pin === undefined || Number.isNaN(Date.parse(event.time))) {
      deps.log.warn({ event_id: event.id }, "a malformed screen.pin.changed was ignored");
      return;
    }
    const changed = await deps.db.tenant(async (c) => {
      // Under the history lock, so a prune sees the pins before or after this change, never a
      // revision it is about to keep half-pinned.
      await lockHistory(c);
      // Only a later event replaces the row: at start the stream is read again from its start
      // (listenPins), and its older events must not undo what a newer one set. "Later" is the
      // producer's clock, since the kit hands a handler no stream entry id: it holds while screen
      // emits a tenant's pins from one writer, and the event id breaks a tie within a millisecond.
      const { rows } = await c.query(
        `INSERT INTO theming_pins (theme_revision, restores_revision, event_time, event_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id) DO UPDATE
           SET theme_revision = EXCLUDED.theme_revision,
               restores_revision = EXCLUDED.restores_revision,
               event_time = EXCLUDED.event_time, event_id = EXCLUDED.event_id, updated_at = now()
         WHERE theming_pins.event_time IS NULL
            OR (theming_pins.event_time, theming_pins.event_id)
               < (EXCLUDED.event_time, EXCLUDED.event_id)
         RETURNING 1`,
        [pin.theme, pin.restores, event.time, event.id],
      );
      return rows.length > 0;
    });
    // A pin let go may leave revisions past the newest 20 that nothing keeps any more. Only a
    // change prunes, so the re-read at start costs no prune per old event. While it catches up,
    // the row moves forward through pins that held after it was written; a prune at one of them
    // keeps what the prune of that time kept, so it never drops a revision a later pin names.
    if (changed) await pruneQuietly(deps);
  };
}

/**
 * Follows `screen.pin.changed` in every event's screen stream, each read from its start: the
 * kit's bus has no consumer groups, so this re-read is how theming learns the pins changed while
 * it was down. The screen's own pin path takes only a session, so there is no other to read.
 */
export function listenPins(
  bus: Bus,
  deps: StoredDeps,
  options: { blockMs?: number } = {},
): TenantSubscription {
  return bus.subscribeTenants(["screen"], pinHandler(deps), { ...options, fromId: "0" });
}
