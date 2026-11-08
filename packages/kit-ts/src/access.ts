/**
 * Who may see what on a tenant's hostname (contracts/tenants.md, Access; 0013 items 11 and 33).
 * The kit implements these rules once; modules call them and never compare addresses themselves.
 * `clientIp` is the address the edge Caddy forwards: Caddy is the only trusted proxy.
 */
import { BlockList, isIP } from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { KitError } from "./errors.js";

/** contracts/tenants.openapi.yaml, TenantContext: what the kit needs to serve a request. */
export interface TenantContext {
  tenant_id: string;
  status: "draft" | "live" | "archived";
  primary_hostname: string | null;
  time_zone: string;
  info_page_mode: "public" | "venue_only" | "sign_in";
  membership: "open" | "closed";
  admin_access: "restricted" | "internet";
  venue: { id: string; name: string; addresses: string[] } | null;
  venue_ip_check: { enabled: boolean; disabled_until: string | null; reason: string | null };
  flags_version: number;
  flags: Record<string, boolean>;
}

export const DEFAULT_TAILSCALE_CIDRS: readonly string[] = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"];

export class DeviceTokenInvalid extends KitError {
  static override defaultStatus = 401;
  static override defaultCode = "device_token_invalid";
}

export class VenueIpMismatch extends KitError {
  static override defaultStatus = 403;
  static override defaultCode = "venue_ip_mismatch";
}

export class InfoPagesClosed extends KitError {
  static override defaultStatus = 403;
  static override defaultCode = "info_pages_closed";
}

export class AdminAccessRestricted extends KitError {
  static override defaultStatus = 403;
  static override defaultCode = "admin_access_restricted";
}

/** Distinct address lists held parsed; venues change rarely, so this is plenty. */
export const CIDR_CACHE_MAX = 1024;
const parsed = new Map<string, BlockList>();

/**
 * The parsed form of an address list, built once per distinct list (a venue revision, a
 * `CANCCU_TAILSCALE_CIDRS` value) instead of on every request. Shared: never add to it.
 */
export function parsedCidrs(cidrs: readonly string[]): BlockList {
  // JSON keeps ["a,b"] and ["a", "b"] apart, which a plain join would not.
  const key = JSON.stringify(cidrs);
  let list = parsed.get(key);
  if (list === undefined) {
    // Clearing at the bound is simpler than LRU and costs only a re-parse of the lists in use.
    if (parsed.size >= CIDR_CACHE_MAX) parsed.clear();
    list = blockList(cidrs);
    parsed.set(key, list);
  }
  return list;
}

function blockList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address = "", bits] = cidr.trim().split("/");
    const family = isIP(address);
    if (family === 0) continue;
    const type = family === 4 ? "ipv4" : "ipv6";
    const max = family === 4 ? 32 : 128;
    // Number("") is 0, a /0 that matches every address: accept plain digits in range only.
    if (bits !== undefined && !(/^\d{1,3}$/.test(bits) && Number(bits) <= max)) continue;
    const prefix = bits === undefined ? max : Number(bits);
    // A malformed prefix is skipped, so it can only narrow access, never widen it.
    try {
      list.addSubnet(address, prefix, type);
    } catch {
      continue;
    }
  }
  return list;
}

/** Whether `ip` lies in any prefix; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) counts as IPv4. */
export function ipInCidrs(ip: string | undefined, cidrs: readonly string[]): boolean {
  if (ip === undefined) return false;
  const family = isIP(ip);
  if (family === 0) return false;
  return parsedCidrs(cidrs).check(ip, family === 4 ? "ipv4" : "ipv6");
}

function fromVenue(ctx: TenantContext, clientIp: string | undefined): boolean {
  return ctx.venue !== null && ipInCidrs(clientIp, ctx.venue.addresses);
}

/**
 * Whether the venue IP check applies now. The emergency switch turns it off only until
 * `disabled_until`; a switch without an end, or with one that does not parse, keeps the check
 * on, so a bad row fails closed.
 */
export function venueIpCheckActive(ctx: TenantContext, now: Date = new Date()): boolean {
  const check = ctx.venue_ip_check;
  if (check.enabled || check.disabled_until === null) return true;
  const until = Date.parse(check.disabled_until);
  // An unparseable end is NaN, and every comparison with NaN is false: test for it explicitly.
  return Number.isNaN(until) || now.getTime() >= until;
}

/** A screen needs its device token and, unless the switch is off, its event's venue address. */
export function checkScreenAccess(
  ctx: TenantContext,
  request: { deviceTokenValid: boolean; clientIp: string | undefined; now?: Date },
): void {
  if (!request.deviceTokenValid) throw new DeviceTokenInvalid();
  if (venueIpCheckActive(ctx, request.now) && !fromVenue(ctx, request.clientIp)) {
    throw new VenueIpMismatch("this screen is not at its event's venue");
  }
}

/** A new device token: shown to the device once, stored only as its hash (0013 item 34). */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deviceTokenMatches(token: string, storedHash: string): boolean {
  const given = Buffer.from(hashDeviceToken(token), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/**
 * Info pages (read-only, public-facing). The mode is visibility, never authorization: passing
 * this grants no write and no personal read. Members, event admins and a superadmin in a support
 * window are all `member` here.
 */
export function checkInfoAccess(
  ctx: TenantContext,
  request: { clientIp: string | undefined; viewer: "guest" | "member" },
): void {
  if (request.viewer === "member") return;
  const open =
    ctx.status !== "draft" &&
    (ctx.info_page_mode === "public" ||
      (ctx.info_page_mode === "venue_only" && fromVenue(ctx, request.clientIp)));
  if (!open) throw new InfoPagesClosed("this event's info pages are not open to you");
}

/** `CANCCU_TAILSCALE_CIDRS` (comma-separated), or the Tailscale defaults. */
export function tailscaleCidrs(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.CANCCU_TAILSCALE_CIDRS?.trim();
  if (!raw) return [...DEFAULT_TAILSCALE_CIDRS];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/**
 * Admin pages and every request that needs a right. This only narrows: sign-in and rights are
 * checked as well, always.
 */
export function checkAdminAccess(
  ctx: TenantContext,
  clientIp: string | undefined,
  tailscale: readonly string[] = tailscaleCidrs(),
): void {
  if (ctx.admin_access === "internet") return;
  if (fromVenue(ctx, clientIp) || ipInCidrs(clientIp, tailscale)) return;
  throw new AdminAccessRestricted("admin is reachable only from the venue or Tailscale");
}
