// The 100-screen load test (step 3 plan O1, #310): pairs 50 screens into the `main` zone of each of
// the CI stack's two events (deploy/compose.ci.yml), keeps all 100 push streams open, then changes
// each event's ticker in turn and times every screen's message. It fails unless every screen of
// the event gets every change, the p95 of all deliveries is under one second (the push channel's
// budget, O2), and no screen ever sees the other event's ticker. scripts/demo-stack-test runs it
// inside the screen container (client.mjs says why). Usage: node load.mjs [screens] [rounds]
import { DEMO_HOST, event, tickerIs } from "./client.mjs";
import { percentile } from "./measure.mjs";

const SCREENS = Number(process.argv[2] ?? 100);
const ROUNDS = Number(process.argv[3] ?? 10);
const TWO_HOST = process.env.CANCCU_DEMO_TWO_HOST ?? "demo-two.localhost";
const BUDGET_MS = 1000;
const DELIVERY_WAIT_MS = 5000;
// As in push-latency.mjs: a new event's stream is read from screen's next rescan on, so changes go
// untimed until three in a row reach every screen within the budget.
const WARM_UP_MS = 60_000;

const events = [DEMO_HOST, TWO_HOST].map((host) => ({ ...event(host), screens: [] }));
const run = `${process.pid}-${Date.now()}`;

/** Sets the event's ticker and answers each of its screens' delay, or null where it never came. */
async function change(ev, text, waitMs = DELIVERY_WAIT_MS) {
  const started = performance.now();
  await ev.setTicker(text);
  return Promise.all(
    ev.screens.map(({ sse }) =>
      sse.next(tickerIs(text), waitMs).then(
        (frame) => frame.at - started,
        () => null,
      ),
    ),
  );
}

const delays = [];
let missing = 0;
try {
  for (const [i, ev] of events.entries()) {
    // The first zone request of an event without zones makes its `main` (plan #107, D8).
    const zones = await ev.call("GET", "/api/screen/zones");
    if (zones.status !== 200) throw new Error(`${ev.host}: zones: HTTP ${zones.status}`);
    const share = Math.floor(SCREENS / events.length) + (i < SCREENS % events.length ? 1 : 0);
    // One at a time: an event holds at most 10 open pairing codes (contracts/screen.md, Pairing).
    for (let n = 0; n < share; n++) {
      const device = await ev.pair(`Load check ${n + 1}`, "main");
      const sse = ev.stream(device.cookie);
      ev.screens.push({ ...device, sse });
    }
    await Promise.all(
      ev.screens.map(({ sse }) => sse.opened.then(() => sse.next((f) => f.event === "state"))),
    );
  }
  console.log(`load: ${SCREENS} streams open over ${events.length} events`);

  const warmUntil = Date.now() + WARM_UP_MS;
  for (let n = 0, inRow = 0; inRow < 3; n++) {
    if (Date.now() > warmUntil) throw new Error("changes did not reach every screen in time");
    const rounds = await Promise.all(
      events.map((ev) => change(ev, `Load check ${run} warm-up ${n}`, 2000)),
    );
    const fast = rounds.flat().every((d) => d !== null && d < BUDGET_MS);
    inRow = fast ? inRow + 1 : 0;
  }

  for (let r = 0; r < ROUNDS; r++) {
    for (const ev of events) {
      const got = await change(ev, `Load check ${run} ${ev.host} ${r}`);
      missing += got.filter((d) => d === null).length;
      delays.push(...got.filter((d) => d !== null));
    }
  }
} finally {
  for (const ev of events) {
    for (const { sse } of ev.screens) sse.close();
    await ev.call("DELETE", "/api/screen/ticker").catch(() => undefined);
    for (const { id } of ev.screens) await ev.revoke(id);
  }
}

// Each timed text names its event's host, so a screen that shows another one's has crossed over.
const crossed = events.flatMap((ev) =>
  ev.screens.filter(({ sse }) =>
    sse.history.some((f) => {
      const text = f.data.ticker?.text ?? "";
      return (
        text.startsWith(`Load check ${run} `) &&
        !text.includes("warm-up") &&
        !text.includes(` ${ev.host} `)
      );
    }),
  ),
);
const p95 = percentile(delays, 0.95);
console.log(
  `load: ${delays.length} deliveries of ${ROUNDS * events.length} changes, p95 ${p95.toFixed(0)} ms, median ${percentile(delays, 0.5).toFixed(0)} ms, max ${Math.max(...delays).toFixed(0)} ms, missing ${missing}, crossed ${crossed.length}`,
);
const failures = [
  ...(missing > 0 ? [`${missing} deliveries never came`] : []),
  ...(crossed.length > 0 ? [`${crossed.length} screens saw another event's ticker`] : []),
  ...(p95 < BUDGET_MS ? [] : [`p95 ${p95.toFixed(0)} ms, budget ${BUDGET_MS} ms`]),
];
if (failures.length > 0) {
  console.error(`load failed: ${failures.join("; ")}`);
  process.exit(1);
}
