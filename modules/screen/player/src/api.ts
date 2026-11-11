/**
 * The player's one way to call the screen API. Every answer's body is read or cancelled: a kiosk
 * runs one page for days, and an unread body holds its connection and buffers until the page
 * closes (the legacy screen client's drained-bodies fix).
 */

/** What the player needs of an answer: its status, the contract's error code and the JSON body. */
export interface Answer {
  /** 0 when the request never got an answer (no network, DNS, a refused connection, a timeout). */
  status: number;
  code: string | null;
  body: unknown;
  /** The server's clock from the `Date` header, NaN without one. */
  serverMs?: number;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const NO_ANSWER: Answer = { status: 0, code: null, body: null };

/**
 * How long a call may take, body included. A request can hang with no answer (a stalled upstream:
 * Caddy's proxy has no response timeout; a half-open connection after the uplink drops), and each
 * flow schedules its next step only after its call returns, so an unbounded call stops the flow.
 */
export const CALL_TIMEOUT_MS = 10_000;

/** 401, 403 and 409 are about the device (unknown, refused, moved or archived), not the network. */
export function isDeviceAnswer(status: number): boolean {
  return status === 401 || status === 403 || status === 409;
}

/** Rejects once `signal` aborts. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => {
      reject(new Error("aborted"));
    });
  });
}

/**
 * The fetch, or a rejection once `signal` aborts. A real fetch rejects on abort by itself; the race
 * keeps the bound even for a fetch that ignores the signal.
 */
export function fetchUntil(
  fetchFn: Fetch,
  path: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<Response> {
  const { signal } = init;
  const aborted = untilAborted(signal);
  const response = fetchFn(path, init);
  // A response that arrives after the abort is dropped, not left holding its connection.
  void response.then(
    (r) => {
      if (signal.aborted) drain(r);
    },
    () => undefined,
  );
  return Promise.race([response, aborted]);
}

/** Drop a body the caller will not read, so its connection goes back to the pool. */
export function drain(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

export async function readAnswer(response: Response): Promise<Answer> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    drain(response);
    return { status: response.status, code: null, body: null, serverMs: NaN };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A truncated or malformed body is still an answer with its status.
  }
  const error = response.ok ? undefined : (body as { error?: { code?: unknown } } | null)?.error;
  const code = typeof error?.code === "string" ? error.code : null;
  return {
    status: response.status,
    code,
    body,
    serverMs: Date.parse(response.headers.get("date") ?? ""),
  };
}

export async function call(
  fetchFn: Fetch,
  method: "GET" | "POST",
  path: string,
  json?: unknown,
): Promise<Answer> {
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, CALL_TIMEOUT_MS);
  const init: RequestInit & { signal: AbortSignal } = {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: abort.signal,
  };
  if (json !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(json);
  }
  try {
    const response = await fetchUntil(fetchFn, path, init);
    const answer = await Promise.race([readAnswer(response), untilAborted(abort.signal)]);
    // A body cut short by the timeout parses as nothing: no answer, not an empty one.
    return abort.signal.aborted ? NO_ANSWER : answer;
  } catch {
    return NO_ANSWER;
  } finally {
    clearTimeout(timer);
  }
}
