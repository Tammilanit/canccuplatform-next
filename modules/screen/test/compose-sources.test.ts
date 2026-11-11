import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ServiceIdentity } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpSources } from "../src/compose/sources.js";

const KEY = "sources-test-service-key-0123456789";
const screen = new ServiceIdentity({ module: "screen", key: KEY });
// Each called module checks the header against its own name, as the kit does there.
const audience = (module: string) => new ServiceIdentity({ module, key: KEY });

describe("the sources' reads", () => {
  let server: Server;
  let base: string;
  const seen: { host: string | undefined; path: string | undefined; caller: string | null }[] = [];
  const warnings: unknown[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const header = request.headers["x-canccu-service"];
      const module = request.url?.startsWith("/internal/agenda/") ? "agenda" : "tenants";
      let caller: string | null;
      try {
        caller = audience(module).verify(typeof header === "string" ? header : null);
      } catch {
        caller = null;
      }
      seen.push({ host: request.headers.host, path: request.url, caller });
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.url?.startsWith("/api/agenda/now")) {
        json(403, { error: { code: "info_pages_closed", message: "no" } });
      } else if (request.url?.startsWith("/internal/agenda/now?tenant_id=closed")) {
        json(403, { error: { code: "service_forbidden", message: "no" } });
      } else if (request.url?.startsWith("/internal/agenda/now")) {
        json(200, { time: "t", agenda_version: 1, current: [], next: [{ id: "i1" }] });
      } else if (request.url?.startsWith("/internal/tenants/venue-info")) {
        json(200, { house_rules: "", wifi: [{ ssid: "guest" }], floor_plan: null });
      } else {
        json(200, { revision: 3, tokens_css_url: "/t.css", css_url: null, logo_url: null });
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const sources = () =>
    httpSources({ agenda: base, tenants: base, theming: base }, screen, {
      warn: (...args: unknown[]) => warnings.push(args),
    });

  it("reads the theme with the event's hostname, which theming resolves the event from", async () => {
    const theme = await sources().theme("demo.example");
    expect(theme?.revision).toBe(3);
    expect(seen.at(-1)).toMatchObject({ host: "demo.example", path: "/api/theming/current" });
  });

  it("reads now and next as a module, signed for the agenda, so no info-page mode refuses it", async () => {
    const now = await sources().agendaNow("alpha", "main hall");
    expect(now).toEqual({ current: [], next: [{ id: "i1" }] });
    expect(seen.at(-1)).toMatchObject({
      path: "/internal/agenda/now?tenant_id=alpha&zone=main%20hall",
      caller: "screen",
    });
  });

  it("reads the venue info as a module, signed for tenants", async () => {
    const venue = await sources().venueInfo("alpha");
    expect(venue?.wifi).toEqual([{ ssid: "guest" }]);
    expect(seen.at(-1)).toMatchObject({
      path: "/internal/tenants/venue-info?tenant_id=alpha",
      caller: "screen",
    });
  });

  it("answers null on a refusal and says so in the log", async () => {
    const before = warnings.length;
    expect(await sources().agendaNow("closed", "main")).toBeNull();
    expect(warnings.length).toBeGreaterThan(before);
  });

  it("answers null when the module is unreachable", async () => {
    const down = httpSources(
      { agenda: "http://127.0.0.1:1", tenants: base, theming: base },
      screen,
    );
    expect(await down.agendaNow("alpha", "main")).toBeNull();
  });
});
