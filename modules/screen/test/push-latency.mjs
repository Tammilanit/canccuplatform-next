// The push channel's latency on the demo stack (contracts/screen.md, Latency; #304): pairs a
// screen into the demo event's `main` zone, opens its stream, then times 20 ticker changes from
// the start of the PUT to the `ticker` message on the stream, and fails unless the p95 is under
// one second. scripts/demo-stack-test runs it inside the screen container, with the CI session
// stub's cookie: the venue IP check opens a device stream only to the demo venue's addresses,
// which there are the loopback, while the host's requests reach Caddy from Docker's gateway.
import { request } from "node:http";

const BASE = { host: "127.0.0.1", port: 8080 };
const SESSION = `canccu_session=${process.env.DEMO_SESSION ?? "demo-ci"}`;
const ROUNDS = 20;
const BUDGET_MS = 1000;
const WAIT_MS = 5000;
// On a fresh stack the event's screen stream appears with this test's own pairing, after screen's
// bus subscription scanned for streams at its start; it finds the new stream at its next rescan
// (5 s), and until then only the zone refresh (10 s) brings changes. Untimed changes first, until
// three in a row come within the budget (the refresh cannot do that), so the timed ones measure
// the path as it runs once screen reads the stream.
const WARM_UP_MS = 45_000;

function call(method, path, { cookie = SESSION, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        ...BASE,
        method,
        path,
        headers: {
          // IP mode serves the demo event on an IP literal.
          host: "127.0.0.1",
          cookie,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        timeout: WAIT_MS,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          const cookies = [res.headers["set-cookie"] ?? []].flat();
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null, cookies });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.on("error", reject);
    req.end(payload);
  });
}

function expect(res, status, what) {
  if (res.status !== status) {
    throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

const cookieOf = (res, name) => res.cookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0];

/** The stream's frames as they arrive; `next(test)` waits for the first one that passes. */
function stream(cookie) {
  const frames = [];
  let wake = () => {};
  const req = request({
    ...BASE,
    path: "/api/screen/device/stream",
    headers: { host: "127.0.0.1", cookie },
  });
  const opened = new Promise((resolve, reject) => {
    req.on("response", (res) => {
      if (res.statusCode !== 200) reject(new Error(`stream: HTTP ${res.statusCode}`));
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const field = (n) =>
            block
              .split("\n")
              .find((l) => l.startsWith(`${n}: `))
              ?.slice(n.length + 2);
          if (field("event")) {
            frames.push({ event: field("event"), data: JSON.parse(field("data") ?? "{}") });
            wake();
          }
        }
      });
      resolve();
    });
    req.on("error", reject);
  });
  req.end();
  return {
    opened,
    close: () => req.destroy(),
    async next(test, waitMs = WAIT_MS) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const i = frames.findIndex(test);
        if (i >= 0) return frames.splice(0, i + 1).at(-1);
        if (Date.now() > deadline) throw new Error("no matching message on the stream");
        await new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, 100);
        });
      }
    },
  };
}

const pairing = expect(await call("POST", "/api/screen/pairing", { cookie: "" }), 201, "pairing");
const paired = expect(
  await call("POST", "/api/screen/devices", {
    body: { code: pairing.body.code, name: "Push latency check", zone_key: "main" },
  }),
  201,
  "approving the pairing",
);
const claimed = expect(
  await call("GET", `/api/screen/pairing/${pairing.body.pairing_id}`, {
    cookie: cookieOf(pairing, "canccu_pairing") ?? "",
  }),
  200,
  "claiming the device cookie",
);
const device = cookieOf(claimed, "canccu_device");
if (!device) throw new Error("the claim set no device cookie");

const sse = stream(device);
const times = [];
try {
  await sse.opened;
  await sse.next((f) => f.event === "state");
  const run = `${process.pid}-${Date.now()}`;
  const change = async (text, waitMs) => {
    expect(await call("PUT", "/api/screen/ticker", { body: { text, until: null } }), 200, "ticker");
    await sse.next(
      (f) => (f.event === "ticker" || f.event === "state") && f.data.ticker?.text === text,
      waitMs,
    );
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
  await call("DELETE", "/api/screen/ticker").catch(() => undefined);
  await call("POST", `/api/screen/devices/${paired.body.id}/revoke`).catch(() => undefined);
}

times.sort((a, b) => a - b);
const p95 = times[Math.ceil(0.95 * times.length) - 1];
const median = times[Math.floor(times.length / 2)];
console.log(
  `push latency: p95 ${p95.toFixed(0)} ms, median ${median.toFixed(0)} ms, max ${times.at(-1).toFixed(0)} ms over ${times.length} changes`,
);
if (!(p95 < BUDGET_MS)) {
  console.error(`push latency over budget: p95 ${p95.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
  process.exit(1);
}
