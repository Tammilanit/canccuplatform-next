/** The shared error body: {"error": {"code", "message"}} (contracts/README.md). */

export interface ErrorBody {
  error: { code: string; message: string };
}

export class KitError extends Error {
  override name = "KitError";
  readonly status: number;
  readonly code: string;

  constructor(message?: string, options: { status?: number; code?: string } = {}) {
    const code = options.code ?? new.target.defaultCode;
    super(message ?? code.replaceAll("_", " "));
    this.status = options.status ?? new.target.defaultStatus;
    this.code = code;
  }

  static defaultStatus = 500;
  static defaultCode = "internal_error";

  toBody(): ErrorBody {
    return errorBody(this.code, this.message);
  }
}

export class NotSignedIn extends KitError {
  static override defaultStatus = 401;
  static override defaultCode = "not_signed_in";
}

export class MissingRight extends KitError {
  static override defaultStatus = 403;
  static override defaultCode = "missing_right";
}

export class VersionConflict extends KitError {
  static override defaultStatus = 409;
  static override defaultCode = "version_conflict";
}

export class AdminUnavailable extends KitError {
  static override defaultStatus = 503;
  static override defaultCode = "admin_unavailable";
}

/** Admin answered with an error the kit does not map to a specific class. */
export class AdminError extends KitError {}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

export function internalErrorBody(): ErrorBody {
  return errorBody("internal_error", "Something went wrong.");
}

/** [code, message] from an error body, or undefined if it is not one. */
export function parseErrorBody(body: unknown): [string, string] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? [code, message] : undefined;
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "not_signed_in",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  422: "invalid_request",
  429: "too_many_requests",
  503: "unavailable",
};

/** A default error code for a bare HTTP status. */
export function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "internal_error" : `http_${status}`);
}
