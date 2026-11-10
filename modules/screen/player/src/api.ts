/**
 * The player's one way to call the screen API. Every answer's body is read or cancelled: a kiosk
 * runs one page for days, and an unread body holds its connection and buffers until the page
 * closes (the legacy screen client's drained-bodies fix).
 */

/** What the player needs of an answer: its status, the contract's error code and the JSON body. */
export interface Answer {
  /** 0 when the request never got an answer (no network, DNS, a refused connection). */
  status: number;
  code: string | null;
  body: unknown;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const NO_ANSWER: Answer = { status: 0, code: null, body: null };

/** Drop a body the caller will not read, so its connection goes back to the pool. */
export function drain(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

export async function readAnswer(response: Response): Promise<Answer> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    drain(response);
    return { status: response.status, code: null, body: null };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A truncated or malformed body is still an answer with its status.
  }
  const error = response.ok ? undefined : (body as { error?: { code?: unknown } } | null)?.error;
  const code = typeof error?.code === "string" ? error.code : null;
  return { status: response.status, code, body };
}

export async function call(
  fetchFn: Fetch,
  method: "GET" | "POST",
  path: string,
  json?: unknown,
): Promise<Answer> {
  const init: RequestInit = { method, credentials: "same-origin", cache: "no-store" };
  if (json !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(json);
  }
  let response: Response;
  try {
    response = await fetchFn(path, init);
  } catch {
    return NO_ANSWER;
  }
  return readAnswer(response);
}
