import { describe, expect, it } from "vitest";
import {
  AdminAccessRestricted,
  CIDR_CACHE_MAX,
  DEFAULT_TAILSCALE_CIDRS,
  DeviceUnknown,
  InfoPagesClosed,
  VenueIpRefused,
  checkAdminAccess,
  checkInfoAccess,
  checkScreenAccess,
  deviceTokenMatches,
  hashDeviceToken,
  ipInCidrs,
  newDeviceToken,
  parsedCidrs,
  tailscaleCidrs,
  venueIpCheckActive,
} from "../src/index.js";
import { tenantContext } from "./helpers.js";

const VENUE_V4 = "192.0.2.10";
const VENUE_V6 = "2001:db8:1::42";
const ELSEWHERE = "198.51.100.7";
const NOW = new Date("2026-01-01T12:00:00Z");

describe("ipInCidrs", () => {
  const cidrs = ["192.0.2.0/24", "2001:db8:1::/48", "203.0.113.5"];

  it("matches IPv4, IPv6, IPv4-mapped IPv6 and single hosts", () => {
    expect(ipInCidrs(VENUE_V4, cidrs)).toBe(true);
    expect(ipInCidrs(`::ffff:${VENUE_V4}`, cidrs)).toBe(true);
    expect(ipInCidrs(VENUE_V6, cidrs)).toBe(true);
    expect(ipInCidrs("203.0.113.5", cidrs)).toBe(true);
    expect(ipInCidrs("203.0.113.6", cidrs)).toBe(false);
    expect(ipInCidrs(ELSEWHERE, cidrs)).toBe(false);
  });

  it("fails closed on a missing or malformed address and skips malformed prefixes", () => {
    expect(ipInCidrs(undefined, cidrs)).toBe(false);
    expect(ipInCidrs("not-an-ip", cidrs)).toBe(false);
    expect(ipInCidrs(VENUE_V4, ["garbage", "192.0.2.0/99"])).toBe(false);
    // An empty or odd prefix must never widen to /0.
    for (const odd of ["10.0.0.0/", "10.0.0.0/0x0", "10.0.0.0/ 8", "10.0.0.0/8.0", "2001:db8::/"]) {
      expect(ipInCidrs("8.8.8.8", [odd])).toBe(false);
      expect(ipInCidrs("2001:4860::8888", [odd])).toBe(false);
    }
    expect(ipInCidrs(VENUE_V4, [])).toBe(false);
  });
});

describe("parsed address lists", () => {
  it("parses one list once and gives the same object for the same addresses", () => {
    const list = ["192.0.2.0/24", "2001:db8:1::/48"];
    const first = parsedCidrs(list);
    expect(parsedCidrs([...list])).toBe(first);
    expect(parsedCidrs(["192.0.2.0/24"])).not.toBe(first);
    expect(parsedCidrs(["192.0.2.0/24", "2001:db8:1::/48"]).check("192.0.2.9", "ipv4")).toBe(true);
  });

  it("keys on the exact list, so lists that join alike stay apart", () => {
    expect(parsedCidrs(["192.0.2.1,198.51.100.7"])).not.toBe(
      parsedCidrs(["192.0.2.1", "198.51.100.7"]),
    );
    expect(ipInCidrs("198.51.100.7", ["192.0.2.1,198.51.100.7"])).toBe(false);
    expect(ipInCidrs("198.51.100.7", ["192.0.2.1", "198.51.100.7"])).toBe(true);
  });

  it("stays bounded and keeps answering right after it is cleared", () => {
    const first = parsedCidrs(["203.0.113.0/24"]);
    for (let i = 0; i <= CIDR_CACHE_MAX; i++) parsedCidrs([`10.${i >> 8}.${i & 255}.0/24`]);
    expect(parsedCidrs(["203.0.113.0/24"])).not.toBe(first);
    expect(ipInCidrs("203.0.113.5", ["203.0.113.0/24"])).toBe(true);
    expect(ipInCidrs("203.0.114.5", ["203.0.113.0/24"])).toBe(false);
  });
});

describe("screens: venue IP plus device token", () => {
  const ctx = tenantContext();

  it("serves a valid token from the venue", () => {
    expect(() => {
      checkScreenAccess(ctx, { deviceTokenValid: true, clientIp: VENUE_V4, now: NOW });
    }).not.toThrow();
    expect(() => {
      checkScreenAccess(ctx, { deviceTokenValid: true, clientIp: VENUE_V6, now: NOW });
    }).not.toThrow();
  });

  it("never serves on the venue IP alone", () => {
    expect(() => {
      checkScreenAccess(ctx, { deviceTokenValid: false, clientIp: VENUE_V4, now: NOW });
    }).toThrow(DeviceUnknown);
  });

  it("refuses a valid token from outside the venue, and any screen of an event with no venue", () => {
    expect(() => {
      checkScreenAccess(ctx, { deviceTokenValid: true, clientIp: ELSEWHERE, now: NOW });
    }).toThrow(VenueIpRefused);
    const noVenue = tenantContext({ venue: null });
    expect(() => {
      checkScreenAccess(noVenue, { deviceTokenValid: true, clientIp: VENUE_V4, now: NOW });
    }).toThrow(VenueIpRefused);
  });

  it("lets the token alone serve while the emergency switch is off, until it expires", () => {
    const off = tenantContext({
      venue_ip_check: {
        enabled: false,
        disabled_until: "2026-01-01T18:00:00Z",
        reason: "new uplink",
      },
    });
    expect(venueIpCheckActive(off, NOW)).toBe(false);
    expect(() => {
      checkScreenAccess(off, { deviceTokenValid: true, clientIp: ELSEWHERE, now: NOW });
    }).not.toThrow();
    expect(() => {
      checkScreenAccess(off, { deviceTokenValid: false, clientIp: ELSEWHERE, now: NOW });
    }).toThrow(DeviceUnknown);
    const later = new Date("2026-01-01T18:00:00Z");
    expect(venueIpCheckActive(off, later)).toBe(true);
    expect(() => {
      checkScreenAccess(off, { deviceTokenValid: true, clientIp: ELSEWHERE, now: later });
    }).toThrow(VenueIpRefused);
  });

  it("keeps the check on when the switch is off without an end", () => {
    const badDate = tenantContext({
      venue_ip_check: { enabled: false, disabled_until: "not a date", reason: "x" },
    });
    expect(venueIpCheckActive(badDate, NOW)).toBe(true);
    const noUntil = tenantContext({
      venue_ip_check: { enabled: false, disabled_until: null, reason: "x" },
    });
    expect(venueIpCheckActive(noUntil, NOW)).toBe(true);
  });
});

describe("device tokens", () => {
  it("stores only a hash and compares in constant time", () => {
    const token = newDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = hashDeviceToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(deviceTokenMatches(token, hash)).toBe(true);
    expect(deviceTokenMatches(newDeviceToken(), hash)).toBe(false);
    expect(deviceTokenMatches(token, "short")).toBe(false);
  });
});

describe("info-page mode", () => {
  const guest = (clientIp: string) => ({ clientIp, viewer: "guest" as const });
  const member = { clientIp: ELSEWHERE, viewer: "member" as const };

  it("public lets guests in", () => {
    expect(() => {
      checkInfoAccess(tenantContext(), guest(ELSEWHERE));
    }).not.toThrow();
  });

  it("venue_only lets guests in from the venue only; no venue lets no guest in", () => {
    const ctx = tenantContext({ info_page_mode: "venue_only" });
    expect(() => {
      checkInfoAccess(ctx, guest(VENUE_V4));
    }).not.toThrow();
    expect(() => {
      checkInfoAccess(ctx, guest(ELSEWHERE));
    }).toThrow(InfoPagesClosed);
    const noVenue = tenantContext({ info_page_mode: "venue_only", venue: null });
    expect(() => {
      checkInfoAccess(noVenue, guest(VENUE_V4));
    }).toThrow(InfoPagesClosed);
  });

  it("sign_in lets no guest in", () => {
    expect(() => {
      checkInfoAccess(tenantContext({ info_page_mode: "sign_in" }), guest(VENUE_V4));
    }).toThrow(InfoPagesClosed);
  });

  it("a draft event lets no guest in, whatever the mode", () => {
    expect(() => {
      checkInfoAccess(tenantContext({ status: "draft" }), guest(VENUE_V4));
    }).toThrow(InfoPagesClosed);
  });

  it("members always may", () => {
    for (const info_page_mode of ["public", "venue_only", "sign_in"] as const) {
      for (const status of ["draft", "live", "archived"] as const) {
        expect(() => {
          checkInfoAccess(tenantContext({ info_page_mode, status }), member);
        }).not.toThrow();
      }
    }
  });

  it("answers 403 info_pages_closed", () => {
    expect(new InfoPagesClosed().toBody().error.code).toBe("info_pages_closed");
    expect(new InfoPagesClosed().status).toBe(403);
  });
});

describe("admin access", () => {
  it("restricted: only from the venue or Tailscale", () => {
    const ctx = tenantContext();
    expect(() => {
      checkAdminAccess(ctx, VENUE_V4);
    }).not.toThrow();
    expect(() => {
      checkAdminAccess(ctx, "100.101.102.103");
    }).not.toThrow();
    expect(() => {
      checkAdminAccess(ctx, "fd7a:115c:a1e0::5");
    }).not.toThrow();
    expect(() => {
      checkAdminAccess(ctx, ELSEWHERE);
    }).toThrow(AdminAccessRestricted);
    expect(() => {
      checkAdminAccess(tenantContext({ venue: null }), VENUE_V4);
    }).toThrow(AdminAccessRestricted);
  });

  it("internet: from anywhere", () => {
    expect(() => {
      checkAdminAccess(tenantContext({ admin_access: "internet" }), ELSEWHERE);
    }).not.toThrow();
  });

  it("reads the Tailscale prefixes from CANCCU_TAILSCALE_CIDRS", () => {
    expect(tailscaleCidrs({})).toEqual(DEFAULT_TAILSCALE_CIDRS);
    expect(tailscaleCidrs({ CANCCU_TAILSCALE_CIDRS: " 10.0.0.0/8 , fd00::/8 " })).toEqual([
      "10.0.0.0/8",
      "fd00::/8",
    ]);
    expect(() => {
      checkAdminAccess(tenantContext(), "10.1.2.3", ["10.0.0.0/8"]);
    }).not.toThrow();
  });
});
