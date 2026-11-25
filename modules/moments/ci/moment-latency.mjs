// Moments to the screens on the demo stack (step 4 plan O2): pairs a screen into the demo event's
// `main` zone, then times 20 crew spotlights from the start of the POST to Moments until the claim
// is on the screen's stream, and 20 domain events (a pizza order placed, the `pizza` rule's claim)
// from their XADD on pizza's stream until the claim is there, and fails unless each p95 is under
// one second. The events take the bus path the spotlights skip: Moments read them 5 to 14 s late
// while its three subscriptions shared one blocking connection (#803). scripts/demo-stack-test
// copies it beside Screen's stack client and runs it in the screen container, where a device
// stream may open (modules/screen/test/stack/client.mjs says why); Moments is `moments:8080` there.
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { xadd } from "./bus.mjs";
import { DEMO_HOST, SESSION, event } from "./client.mjs";
import { percentile } from "./measure.mjs";

const TENANT = "demo";
const ROUNDS = 20;
const BUDGET_MS = 1000;
// A fresh stack's screen finds the event's moments stream at its next rescan: untimed moments
// first, until three in a row come within the budget, as the push latency check does.
const WARM_UP_MS = 45_000;

function moments(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: "moments",
        port: 8080,
        method,
        path,
        timeout: 5000,
        headers: {
          host: DEMO_HOST,
          cookie: SESSION,
          "idempotency-key": randomBytes(12).toString("base64url"),
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.on("error", reject);
    req.end(payload);
  });
}

/** Whether a frame places the claim: a `region` message, or a whole `state`. */
const claimed = (id) => (f) =>
  (f.event === "region" && f.data.region?.claim?.override_id === id) ||
  (f.event === "state" && f.data.regions?.some((r) => r.claim?.override_id === id));

/** Whether a frame places the `pizza` rule's claim for the order of pizzeria `name`. */
const ordered = (name) => (f) =>
  (f.event === "region" ? [f.data.region] : f.event === "state" ? (f.data.regions ?? []) : []).some(
    (r) => r?.claim?.template === "pizza_placed" && r.claim.content?.pizzeria_name === name,
  );

const demo = event(DEMO_HOST);
const screen = await demo.pair("Moment latency check", "main");
const sse = demo.stream(screen.cookie);
const times = [];
const eventTimes = [];
const run = `${process.pid}-${Date.now()}`;
const showEvent = async (n, waitMs) => {
  const name = `Moment latency check ${run} ${n}`;
  const order = {
    id: `po_latency_${run}_${n}`,
    seq: 1,
    state: "placed",
    pizzeria: { id: "pz_latency", name },
    target_at: new Date().toISOString(),
    holder: null,
    pickup: "Stack table",
    pizza_count: 1,
    people_count: 1,
  };
  const started = performance.now();
  await xadd(TENANT, "pizza", "pizza.order.placed", { order, user_ids: [], people: [] });
  try {
    await sse.next(ordered(name), waitMs);
    return performance.now() - started;
  } finally {
    await xadd(TENANT, "pizza", "pizza.order.cancelled", {
      order: { ...order, state: "cancelled" },
      reason: "check",
      actor_user_id: null,
    });
  }
};
const show = async (n, waitMs) => {
  const started = performance.now();
  const r = await moments("POST", "/api/moments/spotlight", {
    show: "message",
    title: `Moment latency check ${run} ${n}`,
    zones: ["main"],
    duration_seconds: 60,
  });
  if (r.status !== 201) throw new Error(`spotlight: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  try {
    await sse.next(claimed(`${r.body.id}.main`), waitMs);
    return performance.now() - started;
  } finally {
    await moments("POST", `/api/moments/moments/${r.body.id}/end`, {});
  }
};
try {
  await sse.opened;
  await sse.next((f) => f.event === "state");
  const warmUntil = Date.now() + WARM_UP_MS;
  for (let n = 0, inRow = 0; inRow < 3; n++) {
    if (Date.now() > warmUntil) throw new Error("moments did not come through to the screen");
    const ms = await show(`warm-up ${n}`, 2000).catch(() => Infinity);
    inRow = ms < BUDGET_MS ? inRow + 1 : 0;
  }
  for (let i = 0; i < ROUNDS; i++) {
    times.push(await show(i));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // Moments reads every stream of an event it knows, pizza's too before its first entry: no
  // warm-up. A miss fails the p95 rather than the run, so the line still shows the others.
  for (let i = 0; i < ROUNDS; i++) {
    eventTimes.push(await showEvent(i, 5000).catch(() => Infinity));
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
} finally {
  sse.close();
  await demo.revoke(screen.id);
}

const p95 = percentile(times, 0.95);
const eventP95 = percentile(eventTimes, 0.95);
const line = (t) =>
  `p95 ${percentile(t, 0.95).toFixed(0)} ms, median ${percentile(t, 0.5).toFixed(0)} ms, max ${Math.max(...t).toFixed(0)} ms`;
console.log(`moment latency: spotlights ${line(times)} over ${times.length} moments`);
console.log(`moment latency: domain events ${line(eventTimes)} over ${eventTimes.length} events`);
if (!(p95 < BUDGET_MS && eventP95 < BUDGET_MS)) {
  console.error(
    `moment latency over budget: p95 ${p95.toFixed(0)} ms (spotlights), ${eventP95.toFixed(0)} ms (domain events), budget ${BUDGET_MS} ms`,
  );
  process.exit(1);
}
