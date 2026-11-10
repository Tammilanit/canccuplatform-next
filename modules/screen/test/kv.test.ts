/** `delIfEquals` on the in-memory Kv and, with `CANCCU_VALKEY_URL`, on its Lua against a real Valkey. */
import { Valkey } from "iovalkey";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryKv, ValkeyKv } from "../src/kv.js";
import type { Kv } from "../src/kv.js";

const VALKEY_URL = process.env.CANCCU_VALKEY_URL;
// The render-queue tests empty database 15; a key of its own here, never a flush.
const TEST_DB = 15;
const clients: Valkey[] = [];

afterAll(async () => {
  for (const client of clients) await client.quit();
});

function delIfEqualsCases(make: () => Kv): void {
  it("deletes the key only while it holds the value read", async () => {
    const kv = make();
    const key = `screen:test:del-if-equals:${String(Math.random())}`;
    await kv.set(key, "read", 60_000);
    await kv.set(key, "written since", 60_000);
    expect(await kv.delIfEquals(key, "read")).toBe(false);
    expect(await kv.get(key)).toBe("written since");
    expect(await kv.delIfEquals(key, "written since")).toBe(true);
    expect(await kv.get(key)).toBeNull();
    expect(await kv.delIfEquals(key, "written since")).toBe(false);
  });
}

describe("delIfEquals in memory", () => {
  delIfEqualsCases(() => new MemoryKv());
});

describe.skipIf(!VALKEY_URL)("delIfEquals on Valkey", () => {
  delIfEqualsCases(() => {
    const client = new Valkey(VALKEY_URL as string, { db: TEST_DB });
    clients.push(client);
    return new ValkeyKv(client);
  });
});
