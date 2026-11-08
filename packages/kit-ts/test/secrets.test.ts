import { describe, expect, it } from "vitest";
import { ConfigError, KitError, SecretBox, SecretUndecryptable } from "../src/index.js";

const KEY1 = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const KEY2 = Buffer.alloc(32, 7);
const ENV_KEY1 = "1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
/** Sealed by kit-py (cryptography 50.0.2) with nonce 0x00..0x0b: both kits open the same token. */
const VECTOR = "cs1.1.AAECAwQFBgcICQoL.NGe1aaCRuvBOCbJM3bcA0e2-pmuEbQ";

describe("SecretBox", () => {
  it("opens the cross-kit test vector", () => {
    const box = SecretBox.fromEnv({ CANCCU_SECRETS_KEY: ENV_KEY1 });
    expect(box.openText(VECTOR, "test:aad")).toBe("secret");
    expect(box.open(VECTOR, "test:aad")).toEqual(Buffer.from("secret"));
  });

  it("seals with the current key and a fresh nonce, and opens what it sealed", () => {
    const box = new SecretBox(new Map([[1, KEY1]]), 1);
    const a = box.seal("secret", "bot:token:demo:1");
    const b = box.seal(Buffer.from("secret"), "bot:token:demo:1");
    expect(a).toMatch(/^cs1\.1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(box.openText(a, "bot:token:demo:1")).toBe("secret");
    expect(box.openText(b, "bot:token:demo:1")).toBe("secret");
  });

  it("refuses a value copied to another row (other aad)", () => {
    const box = new SecretBox(new Map([[1, KEY1]]), 1);
    expect(() => box.open(VECTOR, "test:other")).toThrow(SecretUndecryptable);
  });

  it("refuses tampered, malformed and unknown-version tokens, never as a KitError", () => {
    const box = new SecretBox(new Map([[1, KEY1]]), 1);
    const [prefix, version, nonce, body = ""] = VECTOR.split(".");
    const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
    for (const bad of [
      [prefix, version, nonce, flipped].join("."),
      [prefix, "2", nonce, body].join("."),
      ["cs2", version, nonce, body].join("."),
      [prefix, version, "AAEC", body].join("."),
      [prefix, version, nonce, "AAEC"].join("."),
      [prefix, "01", nonce, body].join("."),
      `${VECTOR}.x`,
      "",
      "garbage",
    ]) {
      let err: unknown;
      try {
        box.open(bad, "test:aad");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SecretUndecryptable);
      expect(err).not.toBeInstanceOf(KitError);
    }
  });

  it("refuses text that is not UTF-8 in openText", () => {
    const box = new SecretBox(new Map([[1, KEY1]]), 1);
    const token = box.seal(Buffer.from([0xff, 0xfe]), "a");
    expect(box.open(token, "a")).toEqual(Buffer.from([0xff, 0xfe]));
    expect(() => box.openText(token, "a")).toThrow(SecretUndecryptable);
  });

  it("rotates a value sealed with a retired key to the current one", () => {
    const box = SecretBox.fromEnv({
      CANCCU_SECRETS_KEY: `2:${KEY2.toString("base64")}`,
      CANCCU_SECRETS_KEYS_RETIRED: ` ${ENV_KEY1} `,
    });
    expect(box.keyVersion(VECTOR)).toBe(1);
    expect(box.needsRotation(VECTOR)).toBe(true);
    const rotated = box.rotate(VECTOR, "test:aad");
    expect(box.keyVersion(rotated)).toBe(2);
    expect(box.needsRotation(rotated)).toBe(false);
    expect(box.openText(rotated, "test:aad")).toBe("secret");
    expect(() => box.rotate(VECTOR, "test:other")).toThrow(SecretUndecryptable);
    expect(() => box.keyVersion("nope")).toThrow(SecretUndecryptable);
  });

  it("refuses a missing, malformed, short or duplicate key in the environment", () => {
    const k2 = `2:${KEY2.toString("base64url")}`;
    for (const env of [
      {},
      { CANCCU_SECRETS_KEY: KEY1.toString("base64") },
      { CANCCU_SECRETS_KEY: `0:${KEY1.toString("base64")}` },
      { CANCCU_SECRETS_KEY: `x:${KEY1.toString("base64")}` },
      { CANCCU_SECRETS_KEY: `1:${Buffer.alloc(31).toString("base64")}` },
      { CANCCU_SECRETS_KEY: `1:${Buffer.alloc(33).toString("base64")}` },
      { CANCCU_SECRETS_KEY: "1:not*base64!" },
      { CANCCU_SECRETS_KEY: ENV_KEY1, CANCCU_SECRETS_KEYS_RETIRED: `${k2},${k2}` },
      { CANCCU_SECRETS_KEY: ENV_KEY1, CANCCU_SECRETS_KEYS_RETIRED: `1:${KEY2.toString("base64")}` },
      { CANCCU_SECRETS_KEY: ENV_KEY1, CANCCU_SECRETS_KEYS_RETIRED: "2:short" },
    ]) {
      expect(() => SecretBox.fromEnv(env)).toThrow(ConfigError);
    }
  });

  it("refuses a box whose current version has no key", () => {
    expect(() => new SecretBox(new Map([[1, KEY1]]), 2)).toThrow(ConfigError);
    expect(() => new SecretBox(new Map([[1, Buffer.alloc(16)]]), 1)).toThrow(ConfigError);
  });
});
