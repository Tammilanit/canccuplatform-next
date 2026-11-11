// The push channel's latency on the demo stack (contracts/screen.md, Latency; #304): pairs a
// screen into the demo event's `main` zone, opens its stream, then times 20 ticker changes from
// the start of the PUT to the `ticker` message on the stream, and fails unless the p95 is under
// one second. scripts/demo-stack-test runs it inside the screen container (client.mjs says why).
import { DEMO_HOST, event, tickerIs } from "./client.mjs";
import { percentile } from "./measure.mjs";

const ROUNDS = 20;
const BUDGET_MS = 1000;
// On a fresh stack the event's screen stream appears with this test's own pairing, after screen's
// bus subscription scanned for streams at its start; it finds the new stream at its next rescan
// (5 s), and until then only the zone refresh (10 s) brings changes. Untimed changes first, until
// three in a row come within the budget (the refresh cannot do that), so the timed ones measure
// the path as it runs once screen reads the stream.
const WARM_UP_MS = 45_000;

const demo = event(DEMO_HOST);
const screen = await demo.pair("Push latency check", "main");
const sse = demo.stream(screen.cookie);
const times = [];
try {
  await sse.opened;
  await sse.next((f) => f.event === "state");
  const run = `${process.pid}-${Date.now()}`;
  const change = async (text, waitMs) => {
    await demo.setTicker(text);
    await sse.next(tickerIs(text), waitMs);
  };
  const warmUntil = Date.now() + WARM_UP_MS;
  for (let n = 0, inRow = 0; inRow < 3; n++) {
    if (Date.now() > warmUntil) throw new Error("changes did not come through the push channel");
    const started = performance.now();
    const came = await change(`Push latency check ${run} warm-up ${n}`, 2000).then(
      () => performance.now() - started < BUDGET_MS,
      () => false,
    );
    inRow = came ? inRow + 1 : 0;
  }
  for (let i = 0; i < ROUNDS; i++) {
    const started = performance.now();
    await change(`Push latency check ${run} ${i}`);
    times.push(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
} finally {
  sse.close();
  await demo.call("DELETE", "/api/screen/ticker").catch(() => undefined);
  await demo.revoke(screen.id);
}

const p95 = percentile(times, 0.95);
console.log(
  `push latency: p95 ${p95.toFixed(0)} ms, median ${percentile(times, 0.5).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms over ${times.length} changes`,
);
if (!(p95 < BUDGET_MS)) {
  console.error(`push latency over budget: p95 ${p95.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
  process.exit(1);
}
