/**
 * Notify's `announcements` topic, owned by moments (D20; contracts/notify.md, Topics and sources):
 * the registration is exactly the contract's JSON block, and it is sent at start until Notify
 * takes it, through passing refusals.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ServiceIdentity } from "@canccu/kit";
import { ANNOUNCEMENTS_TOPIC, registerTopic } from "../src/announce/topic.js";

const NOTIFY_MD = new URL("../../../contracts/notify.md", import.meta.url);

function contractBlock(): unknown {
  const md = readFileSync(NOTIFY_MD, "utf8");
  const from = md.indexOf("The `announcements` registration in full");
  const start = md.indexOf("```json", from) + "```json".length;
  return JSON.parse(md.slice(start, md.indexOf("```", start)));
}

describe("the announcements topic", () => {
  it("is the contract's registration, word for word", () => {
    expect(ANNOUNCEMENTS_TOPIC).toEqual(contractBlock());
  });

  it("is registered at start as moments, through passing refusals, and stops once taken", async () => {
    const calls: { url: string; method: string; body: unknown; caller: string | null }[] = [];
    const answers = [503, 401, 200];
    const service = new ServiceIdentity({ module: "moments", key: "k".repeat(32) });
    const fetchFake = (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body)),
        caller: headers.get("x-canccu-service") ?? headers.get("authorization"),
      });
      return Promise.resolve(new Response("{}", { status: answers.shift() ?? 200 }));
    };
    const ok = await registerTopic("http://notify:8080/", service, {
      fetch: fetchFake,
      sleep: () => Promise.resolve(),
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      url: "http://notify:8080/internal/notify/topic-types/announcements",
      method: "PUT",
      body: ANNOUNCEMENTS_TOPIC,
    });
    expect(calls[0]?.caller).not.toBeNull();
  });

  it("gives up on a refusal that will not pass by itself, such as another owner's key", async () => {
    let n = 0;
    const service = new ServiceIdentity({ module: "moments", key: "k".repeat(32) });
    const ok = await registerTopic("http://notify:8080", service, {
      fetch: () => {
        n += 1;
        return Promise.resolve(new Response("{}", { status: 409 }));
      },
      sleep: () => Promise.resolve(),
    });
    expect(ok).toBe(false);
    expect(n).toBe(1);
  });
});
