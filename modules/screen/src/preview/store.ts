/**
 * Previews on a screen as rows (contracts/screen.md, Zones and assignments: Preview on a screen):
 * one per device at most, in Postgres so any container serves and ends them. A preview emits no
 * bus event; its start and end are audited, and each tells the device's streams to draw again
 * through the fanout (announcePreview).
 *
 * `theme_preview_key` is kept in clear, unlike theming's own copy, which is hashed: Screen reads
 * the draft with it at every compose, and the draft's addresses that every previewing screen gets
 * carry it anyway. A hash here would protect nothing those addresses do not already show. The key
 * dies with the draft and after 12 hours at most, and never goes into a log (sources.ts).
 */
import { platformKey, requireTenant, tenantKey } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { ZoneRow } from "../compose/state.js";
import type { Kv } from "../kv.js";
import type { Fanout } from "../push/store.js";

/** The zone a preview draws instead of the saved one; `epoch` is the live zone's. */
export type PreviewZone = Omit<ZoneRow, "epoch">;

export interface PreviewRow {
  device_id: string;
  device_name: string;
  zone_key: string;
  zone: PreviewZone | null;
  at: Date | null;
  theme_preview_key: string | null;
  until: Date | null;
  ends_at: Date;
  started_by: string;
  started_at: Date;
}

/** A preview without `minutes` runs until it is ended, at most this long. */
export const LONGEST_MS = 12 * 60 * 60 * 1000;

/**
 * Every container hears which device's preview changed, and redraws the streams it holds of that
 * device and of the devices that mirror one. It carries a tenant id and a device id only.
 */
export const PREVIEW_CHANNEL = platformKey("screen", "device", "preview");
/**
 * How long a device's preview change forbids resuming its stream (contracts/screen.md, Resume): a
 * preview does not move the zone's `state_version`, so a version alone cannot tell a preview's
 * state from the live one. As long as the change log a resume reads (5 minutes).
 */
const NO_RESUME_MS = 5 * 60 * 1000;
const changedKey = (deviceId: string): string =>
  tenantKey("screen", "device", deviceId, "preview_changed");

const SELECT = `SELECT p.device_id, d.name AS device_name, p.zone_key, p.zone, p.at,
       p.theme_preview_key, p.until, p.ends_at, p.started_by, p.started_at
  FROM screen_previews p JOIN devices d ON d.id = p.device_id`;

/** The preview running on the device now, or null (none, or past its end). */
export async function runningPreview(
  c: SqlClient,
  deviceId: string,
  nowMs: number,
): Promise<PreviewRow | null> {
  const { rows } = await c.query(`${SELECT} WHERE p.device_id = $1 AND p.ends_at > $2`, [
    deviceId,
    new Date(nowMs),
  ]);
  return (rows[0] as PreviewRow | undefined) ?? null;
}

/** The running previews, soonest end first, the ones without an end last. */
export async function runningPreviews(c: SqlClient, nowMs: number): Promise<PreviewRow[]> {
  const { rows } = await c.query(
    `${SELECT} WHERE p.ends_at > $1 ORDER BY p.until NULLS LAST, p.ends_at, p.device_id`,
    [new Date(nowMs)],
  );
  return rows as unknown as PreviewRow[];
}

/** The contract's `Preview`. */
export function previewView(row: PreviewRow): Record<string, unknown> {
  return {
    device_id: row.device_id,
    device_name: row.device_name,
    zone_key: row.zone_key,
    until: row.until?.toISOString() ?? null,
    at: row.at?.toISOString() ?? null,
    theme: row.theme_preview_key !== null,
    started_by: row.started_by,
    started_at: row.started_at.toISOString(),
  };
}

export interface StartInput {
  deviceId: string;
  zoneKey: string;
  zone: PreviewZone | null;
  at: Date | null;
  themeKey: string | null;
  until: Date | null;
  endsAt: Date;
  actor: string;
}

/**
 * Starts the device's preview, replacing a running one. The zone is checked again in the insert
 * itself: the route read it in another transaction, and a reassignment committed in between
 * would leave a row for the old zone. False when the device no longer shows `zoneKey`.
 */
export async function startPreview(c: SqlClient, input: StartInput): Promise<boolean> {
  const { rows } = await c.query(
    `INSERT INTO screen_previews (device_id, zone_key, zone, at, theme_preview_key, until, ends_at,
                                  started_by, started_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, now()
       FROM screen_assignments WHERE device_id = $1 AND zone_key = $2
     ON CONFLICT (tenant_id, device_id) DO UPDATE
       SET zone_key = $2, zone = $3, at = $4, theme_preview_key = $5, until = $6, ends_at = $7,
           started_by = $8, started_at = now()
     RETURNING device_id`,
    [
      input.deviceId,
      input.zoneKey,
      input.zone === null ? null : JSON.stringify(input.zone),
      input.at,
      input.themeKey,
      input.until,
      input.endsAt,
      input.actor,
    ],
  );
  return rows.length === 1;
}

/**
 * Ends the device's preview, audited (`actor` null: the module, for what ends by itself or with
 * the device's assignment). False when none ran.
 */
export async function endPreview(
  c: SqlClient,
  deviceId: string,
  audit: Audit,
  actor: string | null,
): Promise<boolean> {
  const { rows } = await c.query(
    `DELETE FROM screen_previews WHERE device_id = $1 RETURNING zone_key`,
    [deviceId],
  );
  const row = rows[0] as { zone_key: string } | undefined;
  if (row === undefined) return false;
  await audit({
    tenant_id: requireTenant(),
    actor_user_id: actor,
    action: "screen.preview.ended",
    target: { type: "device", id: deviceId },
    changes: { zone_key: { from: row.zone_key, to: null } },
  });
  return true;
}

/** The previews past their end, removed and audited with the module as actor; their devices. */
export async function endExpired(c: SqlClient, audit: Audit, nowMs: number): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT device_id FROM screen_previews WHERE ends_at <= $1 FOR UPDATE SKIP LOCKED`,
    [new Date(nowMs)],
  );
  const ended: string[] = [];
  for (const { device_id } of rows as { device_id: string }[]) {
    if (await endPreview(c, device_id, audit, null)) ended.push(device_id);
  }
  return ended;
}

/** The draft key no longer resolves: the preview keeps running without the draft. */
export async function dropDraft(c: SqlClient, deviceId: string, key: string): Promise<void> {
  await c.query(
    `UPDATE screen_previews SET theme_preview_key = NULL
      WHERE device_id = $1 AND theme_preview_key = $2`,
    [deviceId, key],
  );
}

export interface AnnounceDeps {
  kv: Kv;
  fanout: Fanout;
  log?: { warn(obj: object, msg: string): void } | undefined;
}

/**
 * After the commit of a start, a replacement or an end: the device and its mirrors draw a whole
 * `state`, now in every container, and a reconnect within the change log's reach never resumes.
 * Best effort: a lost notice is caught up at the stream's next ping, which reads the row again.
 */
export async function announcePreview(deps: AnnounceDeps, deviceId: string): Promise<void> {
  const tenant = requireTenant();
  await deps.kv.set(changedKey(deviceId), "1", NO_RESUME_MS).catch((err: unknown) => {
    // Without the flag a reconnect within the change log's reach may resume onto the other state
    // until the stream's next ping places it again: rare, but worth seeing when it happens.
    deps.log?.warn({ err, device_id: deviceId }, "the preview's no-resume flag was not stored");
  });
  await deps.fanout
    .publish(PREVIEW_CHANNEL, JSON.stringify({ tenant, device_id: deviceId }))
    .catch(() => undefined);
}

/** Whether a preview started, ended or was replaced on the device within the change log's reach. */
export async function previewChanged(kv: Kv, deviceId: string): Promise<boolean> {
  return (await kv.get(changedKey(deviceId))) !== null;
}
