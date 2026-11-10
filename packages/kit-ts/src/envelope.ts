/** The event envelope of contracts/events.md, and its check on read. */
import { isTenantId } from "./tenant.js";

export const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;

export class InvalidEnvelope extends Error {
  override name = "InvalidEnvelope";
}

export interface Event {
  id: string;
  type: string;
  version: number;
  time: string;
  source: string;
  /** Set on tenant events, absent on platform events. */
  tenant?: string;
  correlation_id?: string;
  data: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse and check an envelope; unknown fields are ignored. */
export function parseEnvelope(raw: string): Event {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InvalidEnvelope("not JSON");
  }
  if (!isObject(body)) throw new InvalidEnvelope("not an object");
  const required = ["id", "type", "version", "time", "source", "data"];
  const missing = required.filter((f) => !(f in body));
  if (missing.length > 0) throw new InvalidEnvelope(`missing field(s): ${missing.join(", ")}`);
  const { id, type, version, time, source, data, correlation_id, tenant } = body;
  const checks: Record<string, boolean> = {
    id: typeof id === "string" && id !== "",
    type: typeof type === "string" && EVENT_TYPE_RE.test(type),
    version: typeof version === "number" && Number.isInteger(version) && version >= 1,
    time: typeof time === "string",
    source: typeof source === "string",
    data: isObject(data),
    correlation_id: correlation_id === undefined || typeof correlation_id === "string",
    tenant: tenant === undefined || (typeof tenant === "string" && isTenantId(tenant)),
  };
  const bad = Object.keys(checks).filter((k) => !checks[k]);
  if (bad.length > 0) throw new InvalidEnvelope(`invalid field(s): ${bad.join(", ")}`);
  const event = {
    id,
    type,
    version,
    time,
    source,
    ...(typeof tenant === "string" ? { tenant } : {}),
    ...(typeof correlation_id === "string" ? { correlation_id } : {}),
    data,
  } as Event;
  if (event.type.split(".")[0] !== event.source) {
    throw new InvalidEnvelope("source does not match the type's module");
  }
  return event;
}
