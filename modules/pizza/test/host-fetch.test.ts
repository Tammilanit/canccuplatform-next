/**
 * The Food settings page's way to admin, against a real HTTP server: the fake admin of the page
 * tests takes the call before any transport, which is how a dropped Host header reached CI.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminClient } from "@canccu/kit";
import { hostFetch } from "../src/host-fetch.js";

let server: Server;
let base: string;
let seen: { host: string | undefined; method: string | undefined; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      seen.push({ host: req.headers.host, method: req.method, body });
      if (req.url === "/slow") return; // never answers
      res.writeHead(req.url === "/missing" ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("hostFetch", () => {
  it("sends the event's Host, which Node's fetch would replace with admin's address", async () => {
    seen = [];
    await fetch(`${base}/a`, { headers: { host: "demo.test" } });
    await hostFetch(`${base}/a`, { headers: { host: "demo.test" } });
    expect(seen.map((s) => s.host)).toEqual([new URL(base).host, "demo.test"]);
  });

  it("carries the method, the body and admin's answer through the kit's admin client", async () => {
    seen = [];
    const admin = new AdminClient(base, { fetch: hostFetch });
    const ok = await admin.request("PUT", "/api/admin/settings/pizza", {
      headers: { host: "demo.test", cookie: "canccu_session=x" },
      json: { settings_version: 1 },
    });
    expect(ok).toEqual({ status: 200, body: { path: "/api/admin/settings/pizza" } });
    expect(seen[0]).toEqual({ host: "demo.test", method: "PUT", body: '{"settings_version":1}' });
    expect((await admin.request("GET", "/missing")).status).toBe(404);
  });

  it("gives up at the client's deadline, as admin being down", async () => {
    const admin = new AdminClient(base, { fetch: hostFetch, timeoutMs: 50 });
    await expect(admin.request("GET", "/slow")).rejects.toThrow(/admin unreachable/);
  });
});
