/**
 * Notify's `food` topic, owned by pizza (contracts/notify.md, Topics and sources; step 5, D12):
 * the event part tells everyone who opted in that an order opens, gets its last call and closes;
 * the personal part tells each person in an order that it is here or was cancelled, and the holder
 * and the crew what a stalled order needs (the scheduler's reminders, the nudge). Notify knows the
 * topic only from this registration, sent at every start by every container (idempotent).
 */
import type { Logger, ServiceIdentity } from "@canccu/kit";

/** Exactly the contract's JSON block (test/topic.test.ts holds the two together). */
export const FOOD_TOPIC = {
  key: "food",
  owner: "pizza",
  title: "Food",
  description: "Group food orders: when one opens and closes, and the news of your own",
  parts: {
    event: {
      scope: "event",
      channels: ["push", "discord_dm"],
      defaults: {
        push: false,
        discord_dm: false,
      },
    },
    personal: {
      scope: "user",
      channels: ["push", "discord_dm"],
      defaults: {
        push: true,
        discord_dm: false,
      },
    },
  },
  triggers: [
    {
      event: "pizza.order.opened",
      part: "event",
      audience: {
        value: "public",
      },
      title: "Pizza order open: {data.order.pizzeria.name}",
      body: "Order {data.order.seq} closes at {data.order.closes_at|time}",
      url: "/pizza/orders/{data.order.id}",
      expires_at: "data.order.closes_at",
    },
    {
      event: "pizza.order.closing",
      part: "event",
      audience: {
        value: "public",
      },
      title: "Order {data.order.seq} is closing at {data.closes_at|time}",
      body: "Last call: add your pizza now",
      url: "/pizza/orders/{data.order.id}/add",
      expires_at: "data.closes_at",
    },
    {
      event: "pizza.order.closed",
      part: "event",
      audience: {
        value: "public",
      },
      title: "Order {data.order.seq} closed",
      body: "{data.order.pizzeria.name}: {data.order.pizza_count} pizzas",
      url: "/pizza/orders/{data.order.id}",
      expires_after_minutes: 60,
    },
    {
      event: "pizza.order.arrived",
      part: "personal",
      recipients: {
        user_field: "data.user_ids",
      },
      where: [
        {
          field: "data.order.pickup",
          op: "exists",
        },
      ],
      title: "Pizza is here: order {data.order.seq}",
      body: "Collect at {data.order.pickup}",
      url: "/pizza/orders/{data.order.id}",
    },
    {
      event: "pizza.order.arrived",
      part: "personal",
      recipients: {
        user_field: "data.user_ids",
      },
      where: [
        {
          field: "data.order.pickup",
          op: "eq",
          value: null,
        },
      ],
      title: "Pizza is here: order {data.order.seq}",
      body: "{data.order.pizzeria.name}: come and get it",
      url: "/pizza/orders/{data.order.id}",
    },
    {
      event: "pizza.order.cancelled",
      part: "personal",
      recipients: {
        user_field: "data.user_ids",
      },
      title: "Order {data.order.seq} was cancelled",
      body: "{data.order.pizzeria.name}: your pizza was not ordered",
      url: "/pizza/orders/{data.order.id}",
    },
    {
      event: "pizza.reminder.triggered",
      part: "personal",
      recipients: {
        user_field: "data.user_id",
      },
      where: [
        {
          field: "data.kind",
          op: "eq",
          value: "open_past_target",
        },
      ],
      title: "Order {data.order.seq} is past its close time",
      body: "Close it and call it in, or move the time",
      url: "/pizza/hold/{data.order.id}",
    },
    {
      event: "pizza.reminder.triggered",
      part: "personal",
      recipients: {
        user_field: "data.user_id",
      },
      where: [
        {
          field: "data.kind",
          op: "eq",
          value: "closed_not_placed",
        },
      ],
      title: "Order {data.order.seq} is not called in yet",
      body: "Closed {data.minutes} min ago: call {data.order.pizzeria.name}",
      url: "/pizza/hold/{data.order.id}",
    },
    {
      event: "pizza.reminder.triggered",
      part: "personal",
      recipients: {
        user_field: "data.user_id",
      },
      where: [
        {
          field: "data.kind",
          op: "eq",
          value: "not_arrived",
        },
      ],
      title: "Has order {data.order.seq} arrived?",
      body: "Mark it here when it comes",
      url: "/pizza/hold/{data.order.id}",
    },
    {
      event: "pizza.reminder.triggered",
      part: "personal",
      recipients: {
        user_field: "data.user_id",
      },
      where: [
        {
          field: "data.kind",
          op: "eq",
          value: "released",
        },
      ],
      title: "Nobody holds order {data.order.seq}",
      body: "Take it over and call it in",
      url: "/pizza/hold/{data.order.id}",
    },
    {
      event: "pizza.reminder.triggered",
      part: "personal",
      recipients: {
        user_field: "data.user_id",
      },
      where: [
        {
          field: "data.kind",
          op: "eq",
          value: "not_collected",
        },
      ],
      title: "Your pizza is waiting",
      body: "Order {data.order.seq} is here: come and get it",
      url: "/pizza/orders/{data.order.id}",
    },
  ],
};

const FIRST_PAUSE_MS = 1000;
const MAX_PAUSE_MS = 60_000;
// Refusals that can pass by themselves: Notify not knowing pizza's key yet (401), a Notify older
// than the path (404), a timeout (408), a rate limit (429). Tried again at the longest pause.
const PASSING = new Set([401, 404, 408, 429]);

interface Options {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
}

/**
 * PUTs the registration until Notify takes it (true), or refuses it for good (false: the same
 * body would get the same answer; pizza serves on, and the log says why phones hear nothing).
 */
export async function registerTopic(
  notifyUrl: string,
  service: ServiceIdentity,
  o: Options = {},
): Promise<boolean> {
  const send = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${notifyUrl.replace(/\/+$/, "")}/internal/notify/topic-types/food`;
  let pause = FIRST_PAUSE_MS;
  for (;;) {
    const res = await send(url, {
      method: "PUT",
      headers: { "content-type": "application/json", ...service.headers("notify") },
      body: JSON.stringify(FOOD_TOPIC),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (res !== null && res.status < 400) {
      o.log?.info("food topic registered with notify");
      return true;
    }
    if (res !== null && res.status < 500 && !PASSING.has(res.status)) {
      o.log?.error(
        { status: res.status, body: (await res.text().catch(() => "")).slice(0, 500) },
        "notify refused the food topic",
      );
      return false;
    }
    pause = res !== null && PASSING.has(res.status) ? MAX_PAUSE_MS : pause;
    await sleep(pause);
    pause = Math.min(pause * 2, MAX_PAUSE_MS);
  }
}
