/**
 * Secrets at rest (bot tokens, provider keys): AES-256-GCM under a versioned stack key. The token
 * format is shared with kit-py, so either kit opens what the other sealed.
 *
 * `aad` binds a value to its row, e.g. `bot:token:<tenant>:<application id>`: a value copied to
 * another row, or another tenant, does not open there.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ConfigError } from "./config.js";

const PREFIX = "cs1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_RE = /^[1-9][0-9]{0,8}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const B64_ANY_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * A sealed value that does not open: a bug or a wrong key, never something to show a person, so
 * it is deliberately not a KitError (the adapters answer it as 500 internal_error).
 */
export class SecretUndecryptable extends Error {
  override name = "SecretUndecryptable";
  constructor(message = "the sealed value does not open") {
    super(message);
  }
}

function parseKey(entry: string, variable: string): [number, Buffer] {
  const colon = entry.indexOf(":");
  const version = entry.slice(0, colon).trim();
  const encoded = entry.slice(colon + 1).trim();
  if (colon < 0 || !VERSION_RE.test(version) || !B64_ANY_RE.test(encoded)) {
    throw new ConfigError(`${variable} must be <version>:<base64 of ${KEY_BYTES} bytes>`);
  }
  // Node's base64 decoder reads both alphabets; the regex above keeps it from skipping junk.
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new ConfigError(`${variable}: key ${version} is not ${KEY_BYTES} bytes`);
  }
  return [Number(version), key];
}

interface Parsed {
  version: number;
  nonce: Buffer;
  sealed: Buffer;
}

function parseToken(token: string): Parsed {
  const parts = token.split(".");
  const [prefix, version = "", nonce = "", sealed = ""] = parts;
  if (
    parts.length !== 4 ||
    prefix !== PREFIX ||
    !VERSION_RE.test(version) ||
    !B64URL_RE.test(nonce) ||
    !B64URL_RE.test(sealed)
  ) {
    throw new SecretUndecryptable();
  }
  const parsed = {
    version: Number(version),
    nonce: Buffer.from(nonce, "base64url"),
    sealed: Buffer.from(sealed, "base64url"),
  };
  if (parsed.nonce.length !== NONCE_BYTES || parsed.sealed.length < TAG_BYTES) {
    throw new SecretUndecryptable();
  }
  return parsed;
}

export class SecretBox {
  private readonly keys: ReadonlyMap<number, Buffer>;

  constructor(
    keys: ReadonlyMap<number, Uint8Array>,
    readonly current: number,
  ) {
    const copied = new Map<number, Buffer>();
    for (const [version, key] of keys) {
      if (key.length !== KEY_BYTES)
        throw new ConfigError(`key ${version} is not ${KEY_BYTES} bytes`);
      copied.set(version, Buffer.from(key));
    }
    if (!copied.has(current)) throw new ConfigError(`no key for the current version ${current}`);
    this.keys = copied;
  }

  /** `CANCCU_SECRETS_KEY` (the current key) and `CANCCU_SECRETS_KEYS_RETIRED` (still opened). */
  static fromEnv(env: Record<string, string | undefined> = process.env): SecretBox {
    const raw = env.CANCCU_SECRETS_KEY?.trim();
    if (!raw) throw new ConfigError("missing environment variable(s): CANCCU_SECRETS_KEY");
    const [current, currentKey] = parseKey(raw, "CANCCU_SECRETS_KEY");
    const keys = new Map([[current, currentKey]]);
    for (const entry of (env.CANCCU_SECRETS_KEYS_RETIRED ?? "").split(",")) {
      if (entry.trim() === "") continue;
      const [version, key] = parseKey(entry, "CANCCU_SECRETS_KEYS_RETIRED");
      // Two keys under one version would open some values and not others: refuse to guess.
      if (keys.has(version)) throw new ConfigError(`secrets key version ${version} given twice`);
      keys.set(version, key);
    }
    return new SecretBox(keys, current);
  }

  seal(plaintext: string | Uint8Array, aad: string): string {
    const key = this.keys.get(this.current);
    if (key === undefined) throw new ConfigError(`no key for the current version ${this.current}`);
    // A random 96-bit nonce per value: GCM is broken by a repeated nonce under one key.
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
    const sealed = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
    return `${PREFIX}.${this.current}.${nonce.toString("base64url")}.${sealed.toString("base64url")}`;
  }

  open(token: string, aad: string): Buffer {
    const { version, nonce, sealed } = parseToken(token);
    const key = this.keys.get(version);
    if (key === undefined) throw new SecretUndecryptable();
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
      return Buffer.concat([decipher.update(sealed.subarray(0, -TAG_BYTES)), decipher.final()]);
    } catch {
      throw new SecretUndecryptable();
    }
  }

  openText(token: string, aad: string): string {
    const data = this.open(token, aad);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new SecretUndecryptable("the sealed value is not UTF-8 text");
    }
  }

  keyVersion(token: string): number {
    return parseToken(token).version;
  }

  needsRotation(token: string): boolean {
    return this.keyVersion(token) !== this.current;
  }

  /** Re-seal under the current key; a value that does not open is never re-sealed. */
  rotate(token: string, aad: string): string {
    return this.seal(this.open(token, aad), aad);
  }
}
