/**
 * `POST /api/screen/device/heartbeat` (contracts/screen.md, Devices): the device reports what it
 * shows every `heartbeat_seconds`, and gets the server time back for its clock offset.
 */
import type { FastifyInstance } from "fastify";
import type { Bus, Logger } from "@canccu/kit";
import type { Db } from "./db.js";
import { requireDevice } from "./device-access.js";
import { recordHeartbeat } from "./health.js";
import type { Beat, NowPlaying, Settings, Viewport } from "./health.js";
import { body, invalidRequest } from "./http.js";
import type { Kv } from "./kv.js";

const INSTANCE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
/**
 * The contract leaves these strings unbounded; health keeps them per device, so a bound keeps a
 * broken or hostile page from parking large values in Valkey. Region and widget ids are short.
 */
const MAX_ID = 200;

type Fields = Record<string, unknown>;

const isObject = (v: unknown): v is Fields =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID;

function fail(field: string): never {
  throw invalidRequest(`\`${field}\` is missing or malformed.`);
}

function nowPlaying(v: unknown): NowPlaying | null {
  if (v === undefined) return null;
  if (!isObject(v) || !isId(v.region_id) || !isId(v.widget)) fail("now_playing");
  const optional = (x: unknown): string | null => {
    if (x === undefined || x === null) return null;
    return isId(x) ? x : fail("now_playing");
  };
  return {
    region_id: v.region_id,
    widget: v.widget,
    item_id: optional(v.item_id),
    claim_id: optional(v.claim_id),
  };
}

function viewport(v: unknown): Viewport | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v) || !isInt(v.width, 1) || !isInt(v.height, 1)) fail("viewport");
  return { width: v.width, height: v.height };
}

function clientTime(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  // An RFC 3339 time: Date.parse alone would also take "2026" or a local time without offset.
  const rfc3339 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;
  const ms = typeof v === "string" && rfc3339.test(v) ? Date.parse(v) : NaN;
  return Number.isNaN(ms) ? fail("client_time") : ms;
}

/** The contract's `Heartbeat`; unknown fields are ignored, so newer kiosks can add some. */
export function heartbeatInput(value: Fields): Beat & { errors: Fields[] } {
  const { state_version, bundle_version, theme_revision, audio_unlocked, rtt_ms, instance_id } =
    value;
  if (!isInt(state_version, 0)) fail("state_version");
  if (typeof bundle_version !== "string" || bundle_version.length > MAX_ID) fail("bundle_version");
  if (!isInt(theme_revision, Number.MIN_SAFE_INTEGER)) fail("theme_revision");
  if (audio_unlocked !== undefined && typeof audio_unlocked !== "boolean") fail("audio_unlocked");
  if (rtt_ms !== undefined && !isInt(rtt_ms, 0, 600_000)) fail("rtt_ms");
  if (
    instance_id !== undefined &&
    !(typeof instance_id === "string" && INSTANCE_ID_RE.test(instance_id))
  )
    fail("instance_id");
  const sounded = value.claims_sounded;
  if (
    sounded !== undefined &&
    !(Array.isArray(sounded) && sounded.length <= 50 && sounded.every((c) => typeof c === "string"))
  )
    fail("claims_sounded");
  const errors = value.errors ?? [];
  if (
    !Array.isArray(errors) ||
    errors.length > 20 ||
    !errors.every(
      (e) =>
        isObject(e) &&
        typeof e.code === "string" &&
        (e.item_id === undefined || typeof e.item_id === "string") &&
        (e.detail === undefined || (typeof e.detail === "string" && e.detail.length <= 500)),
    )
  )
    fail("errors");
  const time = clientTime(value.client_time);
  const view = viewport(value.viewport);
  return {
    state_version,
    bundle_version,
    theme_revision,
    now_playing: nowPlaying(value.now_playing),
    ...(audio_unlocked === undefined ? {} : { audio_unlocked }),
    ...(view === undefined ? {} : { viewport: view }),
    ...(time === undefined ? {} : { client_time: time }),
    ...(rtt_ms === undefined ? {} : { rtt_ms }),
    ...(instance_id === undefined ? {} : { instance_id }),
    errors: errors as Fields[],
  };
}

export interface HeartbeatDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  settings: Settings;
  log?: Logger;
  now?: () => number;
}

export function heartbeatRoutes(app: FastifyInstance, deps: HeartbeatDeps): void {
  const now = deps.now ?? Date.now;
  app.post(
    "/api/screen/device/heartbeat",
    { preHandler: requireDevice(deps.db, { now: () => new Date(now()) }) },
    async (request) => {
      const receivedMs = now();
      const { errors, ...beat } = heartbeatInput(body(request));
      // The device is set by requireDevice; a heartbeat never reaches here without one.
      const id = request.device?.id ?? "";
      try {
        await deps.settings.ensure();
      } catch (err) {
        // Admin down must not take every screen offline: the defaults hold until it answers.
        deps.log?.warn({ err }, "screen settings unavailable, using the defaults");
      }
      await recordHeartbeat({ ...deps, now }, id, beat, receivedMs);
      // What legacy's ready-log and playback-error endpoints collected (contracts/screen.md).
      if (errors.length > 0) deps.log?.info({ device_id: id, errors }, "device reported errors");
      return { server_time: new Date(receivedMs).toISOString() };
    },
  );
}
