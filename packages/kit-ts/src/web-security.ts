/**
 * Event-page security (contracts/theming.md, "The CSP of event pages" and "The sandbox"): the CSP
 * every HTML page on an event's hostname carries, and the origin check the adapters run on every
 * request.
 */
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { KitError } from "./errors.js";

export class OriginRefused extends KitError {
  static override defaultStatus = 403;
  static override defaultCode = "origin_refused";
}

export type EventPage = "surface" | "admin" | "sign_in";

// The policy is built by string concatenation: every value must be unable to end a directive.
const NONCE_RE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SANDBOX_BAD_RE = /[\s;,'"]/;

/** A per-response nonce for the page's own `<style>` block: 16 random bytes, standard base64. */
export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/** The contract's policy for one event page, directives joined with "; ". */
export function eventPageCsp(
  nonce: string,
  hostname: string,
  options: { page?: EventPage; sandbox?: string } = {},
): string {
  if (!NONCE_RE.test(nonce)) throw new RangeError("invalid CSP nonce");
  let host: string;
  if (HOSTNAME_RE.test(hostname)) host = hostname;
  else if (isIP(hostname) === 6 && hostname === hostname.toLowerCase()) host = `[${hostname}]`;
  else throw new RangeError(`invalid hostname ${JSON.stringify(hostname)}`);
  const sandbox = options.sandbox ?? `https://${host}/theming/sandbox/`;
  if (sandbox === "" || SANDBOX_BAD_RE.test(sandbox)) {
    throw new RangeError(`invalid sandbox source ${JSON.stringify(sandbox)}`);
  }
  const page = options.page ?? "surface";
  // Admin pages frame surface pages for the virtual-screen preview; admin and sign-in pages are
  // never framed themselves (contracts/theming.md).
  const frame = page === "admin" ? `'self' ${sandbox}` : sandbox;
  const ancestors = page === "surface" ? "'self'" : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    `frame-src ${frame}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${ancestors}`,
  ].join("; ");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

/** `host[:port]` of a Host header, lowercase, trailing dot dropped, the scheme's default port too. */
function hostOfHeader(header: string, defaultPort: string | undefined): string {
  const h = header.trim().toLowerCase();
  let name = h;
  let port = "";
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    name = h.slice(0, end + 1);
    port = h.slice(end + 1).replace(/^:/, "");
  } else if (h.split(":").length === 2) {
    [name = "", port = ""] = h.split(":");
  }
  name = name.replace(/\.$/, "");
  return port === "" || port === defaultPort ? name : `${name}:${port}`;
}

/** `host[:port]` of an Origin, normalised like the Host header; undefined when it is no URL. */
function hostOfOrigin(
  origin: string,
): { host: string; defaultPort: string | undefined } | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.hostname === "") return undefined;
  const name = url.hostname.replace(/\.$/, "");
  return {
    host: url.port === "" ? name : `${name}:${url.port}`,
    defaultPort: DEFAULT_PORTS[url.protocol],
  };
}

/**
 * Refuse (403 `origin_refused`) what a browser sends from somewhere it must not reach: `Origin:
 * null` (a sandboxed embed) to the API, and state-changing requests from another origin. A request
 * without Origin or cross-site fetch metadata passes: modules and curl send neither, and CSRF
 * needs a browser, which sends at least one of them.
 */
export function checkOrigin(
  method: string,
  path: string,
  origin: string | null | undefined,
  host: string | null | undefined,
  secFetchSite?: string | null,
): void {
  if (origin === "null" && path.startsWith("/api/")) {
    throw new OriginRefused("requests from a sandboxed document are refused");
  }
  if (SAFE_METHODS.has(method.toUpperCase())) return;
  if (origin !== null && origin !== undefined && origin !== "") {
    const parsed = origin === "null" ? undefined : hostOfOrigin(origin);
    if (parsed === undefined || !host || hostOfHeader(host, parsed.defaultPort) !== parsed.host) {
      throw new OriginRefused("requests from another origin are refused");
    }
    return;
  }
  if (secFetchSite?.toLowerCase() === "cross-site") {
    throw new OriginRefused("cross-site requests are refused");
  }
}
