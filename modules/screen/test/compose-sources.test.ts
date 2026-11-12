import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ServiceIdentity } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpSources } from "../src/compose/sources.js";
import { laterOf } from "../src/compose/widgets.js";
import type { AgendaItem } from "../src/compose/widgets.js";

const KEY = "sources-test-service-key-0123456789";
const screen = new ServiceIdentity({ module: "screen", key: KEY });
// Each called module checks the header against its own name, as the kit does there.
const audience = (module: string) => new ServiceIdentity({ module, key: KEY });

describe("the sources' reads", () => {
  let server: Server;
  let base: string;
  const seen: { host: string | undefined; path: string | undefined; caller: string | null }[] = [];
  const warnings: unknown[] = [];
  // The agenda's version and whether its whole read fails, as a test sets them.
  let agendaVersion = 1;
  let itemsFail = false;
  const allItems = [
    { id: "i1", title: "Semis", starts_at: "2026-03-14T19:30:00Z", visibility: "public", status: "scheduled" },
    { id: "i2", title: "Final", starts_at: "2026-03-14T21:15:00Z", visibility: "public", status: "scheduled", location: "Stage", zone: "main hall" },
  ]; // prettier-ignore

  beforeAll(async () => {
    server = createServer((request, response) => {
      const header = request.headers["x-canccu-service"];
      const module =
        /^\/internal\/(agenda|theming|notify)\//.exec(request.url ?? "")?.[1] ?? "tenants";
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
        json(200, {
          time: "t",
          agenda_version: agendaVersion,
          current: [],
          next: [{ id: "i1", starts_at: "2026-03-14T19:30:00Z" }],
        });
      } else if (request.url?.startsWith("/internal/agenda/items")) {
        if (itemsFail) json(500, { error: { code: "internal", message: "no" } });
        else json(200, { agenda_version: agendaVersion, items: allItems });
      } else if (request.url?.startsWith("/internal/tenants/venue-info")) {
        json(200, { house_rules: "", wifi: [{ ssid: "guest" }], floor_plan: null });
      } else if (request.url?.startsWith("/internal/notify/check-in/code")) {
        json(200, {
          purpose: "arrival",
          code: "abcdefghijklmnopqrstuv",
          url: "/notify/check-in?p=arrival&c=abcdefghijklmnopqrstuv",
          valid_until: "2026-01-01T12:01:00Z",
          rotates_at: "2026-01-01T12:00:30Z",
        });
      } else if (request.url?.startsWith("/internal/theming/current")) {
        json(200, { revision: 3, tokens_css_url: "/t.css", css_url: null, logo_url: null });
      } else {
        json(404, { error: { code: "not_found", message: "no" } });
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const sources = () =>
    httpSources({ agenda: base, tenants: base, theming: base, notify: base }, screen, {
      warn: (...args: unknown[]) => warnings.push(args),
    });

  it("reads the current theme as a module, signed for theming, so no info-page mode refuses it", async () => {
    const theme = await sources().theme("alpha");
    expect(theme?.revision).toBe(3);
    expect(seen.at(-1)).toMatchObject({
      path: "/internal/theming/current?tenant_id=alpha",
      caller: "screen",
    });
  });

  it("reads now and next as a module, signed for the agenda, so no info-page mode refuses it", async () => {
    const now = await sources().agendaNow("alpha", "main hall");
    expect(now?.current).toEqual([]);
    expect(now?.next).toEqual([{ id: "i1", starts_at: "2026-03-14T19:30:00Z" }]);
    expect(seen.at(-2)).toMatchObject({
      path: "/internal/agenda/now?tenant_id=alpha&zone=main%20hall",
      caller: "screen",
    });
  });

  it("takes `later` from the whole agenda, read as a module, signed for the agenda", async () => {
    const now = await sources().agendaNow("alpha", "main hall");
    expect(now?.later?.map((i) => [i.id, i.location])).toEqual([["i2", "Stage"]]);
    expect(seen.at(-1)).toMatchObject({
      path: "/internal/agenda/items?tenant_id=alpha",
      caller: "screen",
    });
  });

  it("reads the whole agenda again only when now and next's `agenda_version` moves", async () => {
    const one = sources();
    const reads = () => seen.filter((s) => s.path?.startsWith("/internal/agenda/items")).length;
    const before = reads();
    await Promise.all([one.agendaNow("alpha", "main hall"), one.agendaNow("alpha", "café")]);
    await one.agendaNow("alpha", "main hall");
    expect(reads()).toBe(before + 1);
    agendaVersion = 2;
    await one.agendaNow("alpha", "main hall");
    expect(reads()).toBe(before + 2);
    agendaVersion = 1;
  });

  it("shows now and next without `later` when the whole agenda fails, and reads it again next time", async () => {
    const one = sources();
    itemsFail = true;
    const now = await one.agendaNow("alpha", "main hall");
    expect(now?.next).toHaveLength(1);
    expect(now?.later).toEqual([]);
    itemsFail = false;
    expect((await one.agendaNow("alpha", "main hall"))?.later).toHaveLength(1);
  });

  it("reads the venue info as a module, signed for tenants", async () => {
    const venue = await sources().venueInfo("alpha");
    expect(venue?.wifi).toEqual([{ ssid: "guest" }]);
    expect(seen.at(-1)).toMatchObject({
      path: "/internal/tenants/venue-info?tenant_id=alpha",
      caller: "screen",
    });
  });

  it("reads the check-in code as a module, signed for notify", async () => {
    const code = await sources().checkinCode("alpha", "arrival");
    expect(code).toMatchObject({ purpose: "arrival", rotates_at: "2026-01-01T12:00:30Z" });
    expect(seen.at(-1)).toMatchObject({
      path: "/internal/notify/check-in/code?tenant_id=alpha&purpose=arrival",
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
      { agenda: "http://127.0.0.1:1", tenants: base, theming: base, notify: base },
      screen,
    );
    expect(await down.agendaNow("alpha", "main")).toBeNull();
  });
});

describe("the items after next", () => {
  const item = (id: string, starts: string, over: Partial<AgendaItem> = {}): AgendaItem => ({
    id,
    title: id,
    kind: "talk",
    starts_at: `2026-03-14T${starts}:00Z`,
    ends_at: null,
    delay_minutes: 0,
    location: null,
    visibility: "public",
    status: "scheduled",
    ...over,
  });
  const next = [item("next", "19:00")];

  it("keeps the zone's and the zone-less public, scheduled items after the next ones, in order", () => {
    const all = [
      item("late", "23:00"),
      item("crew", "20:00", { visibility: "crew" }),
      item("members", "20:05", { visibility: "attendees" }),
      item("cancelled", "20:10", { status: "cancelled" }),
      item("other-zone", "20:15", { zone: "café" }),
      item("before", "18:00"),
      item("next", "19:00"),
      item("ours", "21:00", { zone: "main" }),
      item("anywhere", "22:00"),
    ];
    expect(laterOf(all, next, "main").map((i) => i.id)).toEqual(["ours", "anywhere"]);
  });

  it("starts after the last of several next items, and is empty while nothing is next", () => {
    const all = [item("a", "19:00"), item("b", "19:30"), item("c", "20:00")];
    expect(laterOf(all, [item("a", "19:00"), item("b", "19:30")], "main").map((i) => i.id)).toEqual(
      ["c"],
    );
    expect(laterOf(all, [], "main")).toEqual([]);
  });
});
