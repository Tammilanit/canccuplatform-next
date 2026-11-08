import { describe, expect, it } from "vitest";
import { OriginRefused, checkOrigin, eventPageCsp, newNonce } from "../src/index.js";

const NONCE = "AAECAwQFBgcICQoLDA0ODw==";

describe("newNonce", () => {
  it("gives 16 random bytes in standard base64, different every time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});

describe("eventPageCsp", () => {
  // contracts/theming.md, The CSP of event pages, word for word.
  const contract = (frame: string, ancestors: string) =>
    "default-src 'none'; script-src 'self'; style-src 'self' 'nonce-" +
    NONCE +
    "'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; " +
    "manifest-src 'self'; worker-src 'self'; frame-src " +
    frame +
    "; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors " +
    ancestors;
  const sandbox = "https://demo.example.org/theming/sandbox/";

  it("is the contract's policy for surface pages", () => {
    expect(eventPageCsp(NONCE, "demo.example.org")).toBe(contract(sandbox, "'self'"));
    expect(eventPageCsp(NONCE, "demo.example.org", { page: "surface" })).toBe(
      contract(sandbox, "'self'"),
    );
  });

  it("widens frame-src for admin pages and forbids framing admin and sign-in pages", () => {
    expect(eventPageCsp(NONCE, "demo.example.org", { page: "admin" })).toBe(
      contract(`'self' ${sandbox}`, "'none'"),
    );
    expect(eventPageCsp(NONCE, "demo.example.org", { page: "sign_in" })).toBe(
      contract(sandbox, "'none'"),
    );
  });

  it("takes a separate sandbox origin when that hardening is set", () => {
    expect(
      eventPageCsp(NONCE, "demo.example.org", { sandbox: "https://demo.sandbox.example.net" }),
    ).toBe(contract("https://demo.sandbox.example.net", "'self'"));
  });

  it("accepts a base64url nonce and an IPv4 host", () => {
    expect(eventPageCsp("abcdefghijklmnop_-", "192.0.2.1")).toContain(
      "frame-src https://192.0.2.1/theming/sandbox/;",
    );
  });

  it("refuses values that could inject a directive", () => {
    for (const nonce of ["short", "AAECAwQFBgcICQoL'; script-src *", "AAECAwQFBgcICQoL==="]) {
      expect(() => eventPageCsp(nonce, "demo.example.org")).toThrow(RangeError);
    }
    for (const host of ["Demo.example.org", "demo.example.org; x", "a b", "", "-a.example.org"]) {
      expect(() => eventPageCsp(NONCE, host)).toThrow(RangeError);
    }
    for (const sb of ["https://x y", "https://x;", "https://x,", "'self'", '"x"', ""]) {
      expect(() => eventPageCsp(NONCE, "demo.example.org", { sandbox: sb })).toThrow(RangeError);
    }
  });
});

describe("checkOrigin", () => {
  const refused = (...args: Parameters<typeof checkOrigin>): unknown => {
    try {
      checkOrigin(...args);
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it("refuses Origin: null on /api/ for any method", () => {
    for (const method of ["GET", "POST", "OPTIONS"]) {
      const err = refused(method, "/api/pizza/menu", "null", "demo.example.org");
      expect(err).toBeInstanceOf(OriginRefused);
      expect((err as OriginRefused).toBody().error.code).toBe("origin_refused");
      expect((err as OriginRefused).status).toBe(403);
    }
    expect(refused("GET", "/pizza/", "null", "demo.example.org")).toBeUndefined();
  });

  it("refuses a state-changing request from another origin", () => {
    for (const origin of ["https://evil.example.net", "https://demo.example.org:8443", "null"]) {
      expect(refused("POST", "/pizza/order", origin, "demo.example.org")).toBeInstanceOf(
        OriginRefused,
      );
    }
    expect(refused("DELETE", "/x", "https://a.example.org", undefined)).toBeInstanceOf(
      OriginRefused,
    );
    expect(refused("PUT", "/x", "not a url", "demo.example.org")).toBeInstanceOf(OriginRefused);
  });

  it("accepts the same origin, normalised", () => {
    expect(refused("POST", "/x", "https://Demo.example.org", "demo.example.org.")).toBeUndefined();
    expect(
      refused("post", "/x", "https://demo.example.org", "demo.example.org:443"),
    ).toBeUndefined();
    expect(refused("POST", "/x", "http://192.0.2.1", "192.0.2.1:80")).toBeUndefined();
    expect(refused("POST", "/x", "http://192.0.2.1:8080", "192.0.2.1:8080")).toBeUndefined();
    expect(refused("POST", "/x", "http://[2001:db8::1]", "[2001:db8::1]")).toBeUndefined();
  });

  it("refuses a cross-site fetch without Origin, and lets non-browser callers through", () => {
    expect(refused("POST", "/x", undefined, "demo.example.org", "cross-site")).toBeInstanceOf(
      OriginRefused,
    );
    expect(refused("POST", "/x", undefined, "demo.example.org", "same-origin")).toBeUndefined();
    expect(refused("POST", "/x", undefined, "demo.example.org")).toBeUndefined();
  });

  it("lets safe methods through from any origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(refused(method, "/x", "https://evil.example.net", "demo.example.org")).toBeUndefined();
    }
  });
});
