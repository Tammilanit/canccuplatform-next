import { AdminClient } from "../src/index.js";

export interface Recorded {
  method: string;
  path: string;
  cookie: string | null;
  body: unknown;
}

export type Answer = (req: Recorded) => Response | Promise<Response>;

/** A fake admin API: answers through `answer` and records every request. */
export class FakeAdmin {
  requests: Recorded[] = [];
  answer: Answer = () => jsonResponse(404, { error: { code: "not_found", message: "no" } });

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(init?.headers);
    const rec: Recorded = {
      method: init?.method ?? "GET",
      path: url.pathname,
      cookie: headers.get("cookie"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    this.requests.push(rec);
    return this.answer(rec);
  };

  client(): AdminClient {
    return new AdminClient("http://admin", { fetch: this.fetch });
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function sessionBody(rights: string[], expiresAt = "2999-01-01T00:00:00Z"): unknown {
  return { user: { id: "u1", name: "Demo User" }, rights, expires_at: expiresAt };
}
