import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpSources } from "../src/compose/sources.js";

describe("the sources' reads", () => {
  let server: Server;
  let base: string;
  const seen: { host: string | undefined; path: string | undefined }[] = [];
  const warnings: unknown[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      seen.push({ host: request.headers.host, path: request.url });
      if (request.url?.startsWith("/api/agenda/now")) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end('{"error":{"code":"info_pages_closed","message":"no"}}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ revision: 3, tokens_css_url: "/t.css", css_url: null, logo_url: null }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const sources = () =>
    httpSources(
      { agenda: base, tenants: base, theming: base },
      { warn: (...args: unknown[]) => warnings.push(args) },
    );

  it("reads with the event's hostname, which the other module resolves the event from", async () => {
    const theme = await sources().theme("demo.example");
    expect(theme?.revision).toBe(3);
    expect(seen.at(-1)).toEqual({ host: "demo.example", path: "/api/theming/current" });
  });

  it("answers null on a refusal and says so in the log", async () => {
    expect(await sources().agendaNow("demo.example", "main")).toBeNull();
    expect(seen.at(-1)?.path).toBe("/api/agenda/now?zone=main");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("answers null when the module is unreachable", async () => {
    const down = httpSources({ agenda: "http://127.0.0.1:1", tenants: base, theming: base });
    expect(await down.agendaNow("demo.example", "main")).toBeNull();
  });
});
