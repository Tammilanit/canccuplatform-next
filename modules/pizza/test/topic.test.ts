/**
 * Notify's `food` topic, owned by pizza (contracts/notify.md, Topics and sources; step 5, D12): the
 * registration is exactly the contract's JSON block, and it is sent at start until Notify takes
 * it, through passing refusals.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ServiceIdentity } from "@canccu/kit";
import { FOOD_TOPIC, registerTopic } from "../src/topic.js";

const NOTIFY_MD = new URL("../../../contracts/notify.md", import.meta.url);

function contractBlock(): unknown {
  const md = readFileSync(NOTIFY_MD, "utf8");
  const from = md.indexOf("The `food` registration in full");
  const start = md.indexOf("```json", from) + "```json".length;
  return JSON.parse(md.slice(start, md.indexOf("```", start)));
}

const service = new ServiceIdentity({ module: "pizza", key: "k".repeat(32) });

describe("the food topic", () => {
  it("is the contract's registration, word for word", () => {
    expect(FOOD_TOPIC).toEqual(contractBlock());
  });

  it("tells the crew when the AI reader stops, one text for each reason (#789 item 11)", () => {
    const stopped = FOOD_TOPIC.triggers.filter((t) => t.event === "pizza.reader.stopped");
    const shape = (t: (typeof stopped)[number]) =>
      "recipients" in t ? [t.part, t.recipients, t.where, t.url] : [t.part];
    expect(stopped.map(shape)).toEqual([
      [
        "personal",
        { user_field: "data.user_ids" },
        [{ field: "data.reason", op: "eq", value: "key_rejected" }],
        "/pizza/integrations",
      ],
      [
        "personal",
        { user_field: "data.user_ids" },
        [{ field: "data.reason", op: "eq", value: "out_of_credit" }],
        "/pizza/integrations",
      ],
    ]);
  });

  it("is registered at start as pizza, through passing refusals, and stops once taken", async () => {
    const calls: { url: string; method: string; body: unknown; caller: string | null }[] = [];
    const answers = [503, 401, 200];
    const fetchFake = (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: JSON.parse(init?.body as string) as unknown,
        caller: headers.get("x-canccu-service") ?? headers.get("authorization"),
      });
      return Promise.resolve(new Response("{}", { status: answers.shift() ?? 200 }));
    };
    const ok = await registerTopic("http://notify:8080/", service, {
      fetch: fetchFake as typeof fetch,
      sleep: () => Promise.resolve(),
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      url: "http://notify:8080/internal/notify/topic-types/food",
      method: "PUT",
      body: FOOD_TOPIC,
    });
    expect(calls[0]?.caller).not.toBeNull();
  });

  it("gives up on a refusal that will not pass by itself", async () => {
    let n = 0;
    const ok = await registerTopic("http://notify:8080", service, {
      fetch: () => {
        n += 1;
        return Promise.resolve(new Response("{}", { status: 400 }));
      },
      sleep: () => Promise.resolve(),
    });
    expect(ok).toBe(false);
    expect(n).toBe(1);
  });
});
