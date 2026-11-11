// The player's soak (step 3 plan O3, #310): one paired screen plays the demo event's `main` zone in
// Chromium for `--hours` of its own clock while the ticker changes, and the page's memory is
// measured after a forced GC every hour of that clock. It fails when the heap grows past the
// budget, DOM nodes or listeners pile up (measure.mjs), the page throws, or the last change is not
// on the screen at the end. scripts/screen-soak runs it in the Playwright image inside the screen
// container's network namespace (client.mjs says why).
// - Accelerated (`--minutes M`, CI): a fake clock jumps one minute at a time, so 24 hours of
//   rotation, countdowns, heartbeats and stream reconnects (each jump outlasts the 45 s silence a
//   stream allows) run in M minutes. The heartbeat's `server_time` is answered as the page's own
//   clock, or the clock offset would pull the page back to real time.
// - Real (no `--minutes`, the test VM's 24-hour run before the step's exit): the clock is the
//   real one and nothing is answered for the server.
// Usage: node soak.mjs [--hours 24] [--minutes M] [--heap-budget-mib 8] [--out DIR]
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { DEMO_HOST, SCREEN, event } from "./client.mjs";
import { report, soakVerdict } from "./measure.mjs";

const { values: opts } = parseArgs({
  options: {
    hours: { type: "string", default: "24" },
    minutes: { type: "string" },
    "heap-budget-mib": { type: "string", default: "8" },
    out: { type: "string", default: "soak-report" },
  },
});
const HOURS = Number(opts.hours);
const accelerated = opts.minutes !== undefined;
const HOUR_MS = 3_600_000;
const STEP_MS = 60_000;
// Real time between ticker changes: often enough that every fake hour sees several.
const PUSH_EVERY_MS = accelerated ? 5_000 : 5 * 60_000;
const budget = { heapGrowth: Number(opts["heap-budget-mib"]) * 1024 * 1024 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const demo = event(DEMO_HOST);
const device = await demo.pair(`Soak check ${accelerated ? "accelerated" : "real"}`, "main");
// Every name the page asks for is this namespace's loopback, where screen listens.
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * 127.0.0.1"] });
const errors = [];
const samples = [];
let streams = 0;
let lastText = "";
let shown = false;
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const [name, value] = device.cookie.split("=");
  await context.addCookies([{ name, value, domain: DEMO_HOST, path: "/", httpOnly: true }]);
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("crash", () => errors.push("the page crashed"));
  page.on("request", (r) => {
    if (r.url().includes("/api/screen/device/stream")) streams++;
  });
  if (accelerated) {
    await page.clock.install();
    await page.route("**/api/screen/device/heartbeat", async (route) => {
      const response = await route.fetch();
      if (response.status() !== 200) return route.fulfill({ response });
      const sent = JSON.parse(route.request().postData() ?? "{}").client_time;
      return route.fulfill({ response, json: { ...(await response.json()), server_time: sent } });
    });
  }
  await page.goto(`http://${DEMO_HOST}:${SCREEN.port}/screen/`);
  await page.waitForSelector(".canccu-layout", { timeout: 30_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const sample = async (hour) => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const metric = (n) => metrics.find((m) => m.name === n)?.value ?? 0;
    const s = {
      hour,
      heap: usedSize,
      nodes: metric("Nodes"),
      listeners: metric("JSEventListeners"),
    };
    samples.push(s);
    console.log(
      `soak: hour ${hour}, heap ${(usedSize / 1048576).toFixed(1)} MiB, ${s.nodes} nodes, ${s.listeners} listeners, ${streams} stream connects`,
    );
  };

  let pushes = 0;
  let pushedAt = 0;
  const push = async () => {
    if (Date.now() - pushedAt < PUSH_EVERY_MS) return;
    pushedAt = Date.now();
    lastText = `Soak check ${process.pid} ${++pushes}`;
    await demo.setTicker(lastText);
  };
  await sample(0);
  const steps = HOURS * (HOUR_MS / STEP_MS);
  const pauseMs = accelerated ? (Number(opts.minutes) * 60_000) / steps : STEP_MS;
  for (let step = 1; step <= steps; step++) {
    if (accelerated) await page.clock.fastForward(STEP_MS);
    await sleep(pauseMs);
    await push();
    if ((step * STEP_MS) % HOUR_MS === 0) await sample((step * STEP_MS) / HOUR_MS);
  }
  // The last change, after a day of reconnects, still reaches the screen.
  shown = await page
    .waitForFunction(
      (text) => document.querySelector(".canccu-region--ticker")?.textContent?.includes(text),
      lastText,
      { timeout: 30_000 },
    )
    .then(
      () => true,
      () => false,
    );
} finally {
  await browser.close().catch(() => undefined);
  await demo.call("DELETE", "/api/screen/ticker").catch(() => undefined);
  await demo.revoke(device.id);
}

const verdict = soakVerdict(samples, budget);
if (errors.length > 0)
  verdict.reasons.push(`the page threw ${errors.length} times: ${errors.slice(0, 3).join(" | ")}`);
if (!shown) verdict.reasons.push(`the last ticker change (${lastText}) was not on the screen`);
verdict.ok = verdict.reasons.length === 0;
mkdirSync(opts.out, { recursive: true });
writeFileSync(`${opts.out}/samples.json`, `${JSON.stringify(samples, null, 2)}\n`);
writeFileSync(
  `${opts.out}/soak-report.md`,
  report(
    {
      title: `Player soak, ${accelerated ? `accelerated (${HOURS} h in ${opts.minutes} min)` : `real (${HOURS} h)`}`,
      lines: [
        `event host: ${DEMO_HOST}, zone main, 1920×1080`,
        `finished: ${new Date().toISOString()}`,
        `heap budget: ${opts["heap-budget-mib"]} MiB of growth after the first hour`,
        `stream connects: ${streams}`,
      ],
    },
    samples,
    verdict,
  ),
);
console.log(
  `soak: ${verdict.ok ? "pass" : `FAIL: ${verdict.reasons.join("; ")}`} (report in ${opts.out}/soak-report.md)`,
);
process.exit(verdict.ok ? 0 : 1);
