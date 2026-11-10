/** Revision 0 reads the event profile's theme from admin (contracts/theming.md; contracts/admin.md, For theming). */
import { describe, expect, it } from "vitest";
import { ServiceIdentity } from "@canccu/kit";
import { adminProfile } from "../src/profile.js";

const KEY = "k".repeat(32);
const service = new ServiceIdentity({ module: "theming", key: KEY });
const admin = new ServiceIdentity({ module: "admin", key: KEY });

function fakeAdmin(answers: Record<string, Response | (() => Response)>) {
  const calls: string[] = [];
  const fetchFn = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(url instanceof Request ? url.url : url);
    // The signed header is for admin's internal paths, from theming.
    const header = (init?.headers as Record<string, string>)["x-canccu-service"];
    if (header === undefined || admin.verify(header) !== "theming") throw new Error("unsigned");
    calls.push(`${u.pathname}?${u.searchParams.toString()}`);
    const answer = answers[u.searchParams.get("tenant_id") ?? ""];
    if (answer === undefined) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(typeof answer === "function" ? answer() : answer.clone());
  };
  return { calls, fetchFn };
}

describe("adminProfile", () => {
  it("answers the profile's theme, read once until the profile is loaded again", async () => {
    const { calls, fetchFn } = fakeAdmin({
      demo: Response.json({ theme: { colors: { primary: "#14b8a6" } }, logo_main: null }),
    });
    const profile = adminProfile("http://admin:8080/", service, { fetch: fetchFn });
    expect(await profile.read("demo")).toEqual({ colors: { primary: "#14b8a6" } });
    expect(await profile.read("demo")).toEqual({ colors: { primary: "#14b8a6" } });
    expect(calls).toEqual(["/internal/admin/profile/theme?tenant_id=demo"]);
    profile.handleEvent({ type: "admin.profile.loaded", tenant: "demo" });
    profile.handleEvent({ type: "admin.settings.changed", tenant: "demo" });
    await profile.read("demo");
    expect(calls).toHaveLength(2);
  });

  it("answers undefined for a profile without a theme or an unknown event", async () => {
    const { fetchFn } = fakeAdmin({ empty: Response.json({ theme: {}, logo_main: null }) });
    const profile = adminProfile("http://admin:8080", service, { fetch: fetchFn });
    expect(await profile.read("empty")).toBeUndefined();
    expect(await profile.read("unknown")).toBeUndefined();
  });

  it("falls back to the platform defaults while admin is down, asking again after a pause", async () => {
    let now = 0;
    let up = false;
    const { calls, fetchFn } = fakeAdmin({
      demo: () =>
        up
          ? Response.json({ theme: { colors: { primary: "#14b8a6" } }, logo_main: null })
          : new Response("{}", { status: 502 }),
    });
    const profile = adminProfile("http://admin:8080", service, { fetch: fetchFn, now: () => now });
    expect(await profile.read("demo")).toBeUndefined();
    up = true;
    expect(await profile.read("demo")).toBeUndefined();
    expect(calls).toHaveLength(1);
    now += 11_000;
    expect(await profile.read("demo")).toEqual({ colors: { primary: "#14b8a6" } });
    expect(calls).toHaveLength(2);
  });

  it("keeps serving the last answer while admin is down", async () => {
    let now = 0;
    let up = true;
    const { calls, fetchFn } = fakeAdmin({
      demo: () =>
        up
          ? Response.json({ theme: { colors: { primary: "#14b8a6" } }, logo_main: null })
          : new Response("{}", { status: 502 }),
    });
    const profile = adminProfile("http://admin:8080", service, { fetch: fetchFn, now: () => now });
    await profile.read("demo");
    up = false;
    now += 61_000;
    expect(await profile.read("demo")).toEqual({ colors: { primary: "#14b8a6" } });
    expect(await profile.read("demo")).toEqual({ colors: { primary: "#14b8a6" } });
    expect(calls).toHaveLength(2);
  });

  it("asks again after a while, in case a profile event was missed", async () => {
    let now = 0;
    const { calls, fetchFn } = fakeAdmin({ demo: Response.json({ theme: {}, logo_main: null }) });
    const profile = adminProfile("http://admin:8080", service, { fetch: fetchFn, now: () => now });
    await profile.read("demo");
    now += 59_000;
    await profile.read("demo");
    now += 2_000;
    await profile.read("demo");
    expect(calls).toHaveLength(2);
  });
});
