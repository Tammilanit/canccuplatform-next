/** Requests against the harness's app as a browser or kiosk sends them, and what they answer. */
import type { LightMyRequestResponse } from "fastify";
import type { Event } from "@canccu/kit";
import type { Harness } from "./helpers.js";

/** Inside the demo venue's range, so admin pages' address rule lets the calls in. */
export const VENUE_IP = "10.0.0.5";

export interface Call {
  host?: string;
  ip?: string;
  session?: string;
  cookies?: Record<string, string>;
  body?: unknown;
}

export function call(
  h: Harness,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  c: Call = {},
): Promise<LightMyRequestResponse> {
  const cookies = { ...(c.session ? { canccu_session: c.session } : {}), ...c.cookies };
  return h.app.inject({
    method,
    url,
    headers: {
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...(c.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(c.body === undefined ? {} : { payload: JSON.stringify(c.body) }),
  });
}

/** The value a response sets for a cookie, or undefined. */
export function setCookie(res: LightMyRequestResponse, name: string): string | undefined {
  const header = [res.headers["set-cookie"] ?? []].flat();
  const line = header.find((h) => h.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(";")[0];
}

/** The data of the bus events of `type` on `tenant`'s screen stream, oldest first. */
export function events(h: Harness, type: string, tenant = "alpha"): Record<string, unknown>[] {
  return (h.store.streams.get(`t:${tenant}:events:screen`) ?? [])
    .map(([, fields]) => JSON.parse(fields.event ?? "{}") as Event)
    .filter((e) => e.type === type)
    .map((e) => e.data);
}

export function code(res: LightMyRequestResponse): string {
  return res.json<{ error: { code: string } }>().error.code;
}
