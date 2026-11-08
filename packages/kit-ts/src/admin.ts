/** HTTP client for the admin API, shared by the settings client and the rights check. */
import { AdminError, AdminUnavailable, parseErrorBody } from "./errors.js";

export type Fetch = typeof fetch;

export interface AdminResponse {
  status: number;
  body: unknown;
}

export class AdminClient {
  private readonly fetchFn: Fetch;

  constructor(
    private readonly baseUrl: string,
    options: { fetch?: Fetch; timeoutMs?: number } = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  private readonly timeoutMs: number;

  async request(
    method: string,
    path: string,
    options: {
      sessionId?: string | undefined;
      json?: unknown;
      headers?: Record<string, string>;
      params?: Record<string, string>;
    } = {},
  ): Promise<AdminResponse> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.sessionId !== undefined) headers.cookie = `canccu_session=${options.sessionId}`;
    if (options.json !== undefined) headers["content-type"] = "application/json";
    const query = options.params ? `?${new URLSearchParams(options.params).toString()}` : "";
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, "")}${path}${query}`, {
        method,
        headers,
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new AdminUnavailable(`admin unreachable: ${err instanceof Error ? err.name : "error"}`);
    }
    const text = await response.text();
    let body: unknown = undefined;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    return { status: response.status, body };
  }

  static raiseForError(response: AdminResponse): void {
    if (response.status >= 200 && response.status < 300) return;
    if (response.status >= 500) throw new AdminUnavailable(`admin answered ${response.status}`);
    const [code, message] = parseErrorBody(response.body) ?? [
      `http_${response.status}`,
      "admin error",
    ];
    throw new AdminError(message, { status: response.status, code });
  }
}
