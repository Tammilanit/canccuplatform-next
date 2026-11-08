/**
 * Module-to-module identity on internal paths (contracts/README.md, Conventions).
 *
 * Every module of a stack holds the same key (`CANCCU_SERVICE_KEY`), so a valid token proves "a
 * module of this stack", and names its caller only as far as the modules are honest: any module
 * could sign as another. What it does give: nothing on the network without the key gets in, and
 * the key itself never travels, only a short-lived HMAC bound to one audience.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigError } from "./config.js";
import { KitError } from "./errors.js";

export const SERVICE_HEADER = "x-canccu-service";
export const SERVICE_KEY_MIN_LENGTH = 32;
/** A token valid for longer than this is refused, so a leaked one cannot live for days. */
export const SERVICE_MAX_AHEAD_S = 300;

const VERSION = "v1";
const NAME_RE = /^[a-z][a-z0-9_]*$/;
// Canonical digits only: "05" and "5" must not be two spellings of one signed value.
const EXPIRES_RE = /^(0|[1-9][0-9]{0,11})$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

export class ServiceUnauthenticated extends KitError {
  static override defaultStatus = 401;
  static override defaultCode = "service_unauthenticated";
}

export class ServiceForbidden extends KitError {
  static override defaultStatus = 403;
  static override defaultCode = "service_forbidden";
}

function checkName(kind: string, name: string): string {
  if (!NAME_RE.test(name)) throw new RangeError(`invalid ${kind} ${JSON.stringify(name)}`);
  return name;
}

function checkKey(key: string): string {
  if (key.length < SERVICE_KEY_MIN_LENGTH) {
    throw new ConfigError(
      `CANCCU_SERVICE_KEY must be at least ${SERVICE_KEY_MIN_LENGTH} characters`,
    );
  }
  return key;
}

/** The stack's service key; throws ConfigError when missing, short, or a placeholder in a release. */
export function serviceKeyFromEnv(env: Record<string, string | undefined> = process.env): string {
  const key = env.CANCCU_SERVICE_KEY;
  if (!key) throw new ConfigError("missing environment variable(s): CANCCU_SERVICE_KEY");
  checkKey(key);
  // The Compose defaults carry `local-only`; a release must never run with a key from the repo.
  if (key.includes("local-only") && env.CANCCU_VERSION !== "dev") {
    throw new ConfigError("CANCCU_SERVICE_KEY is a local-only placeholder outside a dev version");
  }
  return key;
}

/** A module acting as itself holds only its own rights, never another module's or admin's. */
export function serviceHasRight(caller: string, right: string): boolean {
  return right.startsWith(`${caller}.`) && right.length > caller.length + 1;
}

export interface ServiceIdentityOptions {
  module: string;
  key: string;
  /** How long a signed header stays valid; keep it short, a request uses it at once. */
  ttlMs?: number;
  now?: () => number;
}

export class ServiceIdentity {
  readonly module: string;
  private readonly key: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: ServiceIdentityOptions) {
    this.module = checkName("module", options.module);
    this.key = checkKey(options.key);
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.key)
      .update(`canccu-service.${VERSION}.${payload}`, "utf8")
      .digest("base64url");
  }

  /** The header for one call to `audience`'s internal paths. */
  headers(audience: string): Record<string, string> {
    checkName("audience", audience);
    const expires = Math.floor((this.now() + this.ttlMs) / 1000);
    const payload = `${this.module}.${audience}.${expires}`;
    return { [SERVICE_HEADER]: `${VERSION}.${payload}.${this.sign(payload)}` };
  }

  /** The calling module; throws ServiceUnauthenticated with no hint of which check failed. */
  verify(value: string | null | undefined): string {
    const parts = (value ?? "").split(".");
    if (parts.length !== 5) throw new ServiceUnauthenticated();
    const [version = "", caller = "", audience = "", expires = "", sig = ""] = parts;
    const wellFormed =
      version === VERSION &&
      NAME_RE.test(caller) &&
      audience === this.module &&
      EXPIRES_RE.test(expires) &&
      SIG_RE.test(sig);
    if (!wellFormed) throw new ServiceUnauthenticated();
    const expected = Buffer.from(this.sign(`${caller}.${audience}.${expires}`), "utf8");
    if (!timingSafeEqual(expected, Buffer.from(sig, "utf8"))) throw new ServiceUnauthenticated();
    const nowS = this.now() / 1000;
    const at = Number(expires);
    if (at < nowS || at > nowS + SERVICE_MAX_AHEAD_S) throw new ServiceUnauthenticated();
    return caller;
  }

  /** verify(), then refuse a caller outside `allowed` (when given) with ServiceForbidden. */
  require(value: string | null | undefined, allowed?: Iterable<string>): string {
    const caller = this.verify(value);
    if (allowed !== undefined && ![...allowed].includes(caller)) {
      throw new ServiceForbidden(`module ${caller} may not call this`);
    }
    return caller;
  }
}
