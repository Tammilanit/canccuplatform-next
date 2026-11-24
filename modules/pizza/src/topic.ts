/**
 * Notify's `food` topic, owned by pizza (contracts/notify.md, Topics and sources; step 5, D12):
 * the event part tells everyone who opted in that an order opens, gets its last call and closes;
 * the personal part tells each person in an order that it is called in, here or cancelled, that
 * someone else changed their pizza, and of their share (#703: ready, changed, marked paid, one
 * reminder), and the holder and the crew what a stalled order needs (the scheduler's reminders, the
 * nudge), and the crew that the AI reader stopped (#789 item 11). Notify knows the topic only from this registration, sent at every start by every
 * container (idempotent).
 */
import type { Logger, ServiceIdentity } from "@canccu/kit";

type Condition = { field: string; op: string; value?: unknown };

const eq = (field: string, value: unknown): Condition => ({ field, op: "eq", value });

/** A trigger of the personal part, in the contract's key order (the test compares them deeply). */
function personal(
  event: string,
  userField: string,
  where: Condition[],
  title: string,
  body: string,
  url: string,
) {
  return {
    event,
    part: "personal",
    recipients: { user_field: userField },
    ...(where.length > 0 ? { where } : {}),
    title,
    body,
    url,
  };
}

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
      defaults: { push: false, discord_dm: false },
    },
    personal: {
      scope: "user",
      channels: ["push", "discord_dm"],
      defaults: { push: true, discord_dm: false },
    },
  },
  triggers: [
    {
      event: "pizza.order.opened",
      part: "event",
      audience: { value: "public" },
      title: "Pizza order open: {data.order.pizzeria.name}",
      body: "Order {data.order.seq} closes at {data.order.closes_at|time}",
      url: "/pizza/orders/{data.order.id}",
      expires_at: "data.order.closes_at",
    },
    {
      event: "pizza.order.closing",
      part: "event",
      audience: { value: "public" },
      title: "Order {data.order.seq} is closing at {data.closes_at|time}",
      body: "Last call: add your pizza now",
      url: "/pizza/orders/{data.order.id}/add",
      expires_at: "data.closes_at",
    },
    {
      event: "pizza.order.closed",
      part: "event",
      audience: { value: "public" },
      title: "Order {data.order.seq} closed",
      body: "{data.order.pizzeria.name}: {data.order.pizza_count} pizzas",
      url: "/pizza/orders/{data.order.id}",
      expires_after_minutes: 60,
    },
    personal(
      "pizza.order.arrived",
      "data.user_ids",
      [{ field: "data.order.pickup", op: "exists" }],
      "Pizza is here: order {data.order.seq}",
      "Collect at {data.order.pickup}",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.order.arrived",
      "data.user_ids",
      [eq("data.order.pickup", null)],
      "Pizza is here: order {data.order.seq}",
      "{data.order.pizzeria.name}: come and get it",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.order.cancelled",
      "data.user_ids",
      [],
      "Order {data.order.seq} was cancelled",
      "{data.order.pizzeria.name}: your pizza was not ordered",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.order.placed",
      "data.user_ids",
      [{ field: "data.order.estimate_at", op: "exists" }],
      "Order {data.order.seq} is called in",
      "{data.order.pizzeria.name}: expected at {data.order.estimate_at|time}",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.order.placed",
      "data.user_ids",
      [eq("data.order.estimate_at", null)],
      "Order {data.order.seq} is called in",
      "{data.order.pizzeria.name}: you will hear when it is here",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.item.changed",
      "data.user_id",
      [],
      "Your pizza in order {data.order_seq} was changed",
      "The holder or the crew changed it: check it here",
      "/pizza/orders/{data.order_id}",
    ),
    personal(
      "pizza.item.removed",
      "data.user_id",
      [eq("data.by_owner", false)],
      "Your pizza was taken out of order {data.order_seq}",
      "The holder or the crew removed it",
      "/pizza/orders/{data.order_id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "open_past_target")],
      "Order {data.order.seq} is past its close time",
      "Close it and call it in, or move the time",
      "/pizza/hold/{data.order.id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "closed_not_placed")],
      "Order {data.order.seq} is not called in yet",
      "Closed {data.minutes} min ago: call {data.order.pizzeria.name}",
      "/pizza/hold/{data.order.id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "not_arrived")],
      "Has order {data.order.seq} arrived?",
      "Mark it here when it comes",
      "/pizza/hold/{data.order.id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "released")],
      "Nobody holds order {data.order.seq}",
      "Take it over and call it in",
      "/pizza/hold/{data.order.id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "not_collected")],
      "Your pizza is waiting",
      "Order {data.order.seq} is here: come and get it",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.share.ready",
      "data.user_ids",
      [eq("data.settle_to", "payer")],
      "Order {data.order.seq}: pay {data.payer.name} your share",
      "Your amount and how to pay are on your order",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.share.ready",
      "data.user_ids",
      [eq("data.settle_to", "organiser")],
      "Order {data.order.seq}: your share is ready",
      "Paid to the organiser after the event: your amount is on your order",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.share.changed",
      "data.user_ids",
      [eq("data.reason", "amount")],
      "Order {data.order.seq}: your share changed",
      "See your new amount on your order",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.share.changed",
      "data.user_ids",
      [eq("data.reason", "pay_to"), eq("data.settle_to", "payer")],
      "Order {data.order.seq}: pay {data.payer.name}",
      "How to pay changed: the details are on your order",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.share.changed",
      "data.user_ids",
      [eq("data.reason", "pay_to"), eq("data.settle_to", "organiser")],
      "Order {data.order.seq}: pay the organiser",
      "Your share is paid to the organiser after the event",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.share.paid",
      "data.user_id",
      [],
      "Order {data.order.seq}: marked paid",
      "{data.payer.name} has your payment marked",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "not_paid"), eq("data.role", "member")],
      "Order {data.order.seq}: not marked paid yet",
      "Your share and how to pay are on your order",
      "/pizza/orders/{data.order.id}",
    ),
    personal(
      "pizza.reminder.triggered",
      "data.user_id",
      [eq("data.kind", "not_paid"), eq("data.role", "payer")],
      "Order {data.order.seq}: {data.count} not marked paid",
      "See who still owes you",
      "/pizza/hold/{data.order.id}/money",
    ),
    personal(
      "pizza.reader.stopped",
      "data.user_ids",
      [eq("data.reason", "key_rejected")],
      "The AI reader stopped: its key was refused",
      "Receipts are typed by hand until an admin sets a new key",
      "/pizza/integrations",
    ),
    personal(
      "pizza.reader.stopped",
      "data.user_ids",
      [eq("data.reason", "out_of_credit")],
      "The AI reader stopped: out of credit",
      "Add credit or raise the limit in the provider's Console; receipts are typed meanwhile",
      "/pizza/integrations",
    ),
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
