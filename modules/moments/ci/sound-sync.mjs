// The screens of a zone start a sound together (step 4 plan, #113 Sync; D14): pairs two screens
// into the demo event's `main` zone and makes the first its sound screen, then sends 20 sound
// checks to Moments. Each screen starts a sound at `play_at` on the server's clock, or at once if
// its state comes later; the check fails unless every round's two starts are within 200 ms and
// only the sound screen has sound enabled. scripts/demo-stack-test copies it beside Screen's stack
// client and runs it in the screen container, as it does moment-latency.mjs.
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { DEMO_HOST, SESSION, event, expect } from "./client.mjs";

const ROUNDS = 20;
const BUDGET_MS = 200;
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

/** A whole state carrying a sound other than `seen`. */
const newSound = (seen) => (f) =>
  f.event === "state" && f.data.sound?.play != null && f.data.sound.play.id !== seen;

const demo = event(DEMO_HOST);
const zone = expect(await demo.call("GET", "/api/screen/zones/main"), 200, "reading the zone").body;
const a = await demo.pair("Sound sync A", "main");
const b = await demo.pair("Sound sync B", "main");
const streams = [demo.stream(a.cookie), demo.stream(b.cookie)];
const spreads = [];
let enabled = [];
try {
  const saved = expect(
    await demo.call("PUT", "/api/screen/zones/main", {
      body: { ...zone, sound: { enabled: true, device_id: a.id } },
    }),
    200,
    "making screen A the zone's sound screen",
  ).body;
  zone.revision = saved.revision;
  for (const s of streams) {
    await s.opened;
    await s.next((f) => f.event === "state");
  }
  let seen = null;
  const round = async (waitMs) => {
    const r = await moments("POST", "/api/moments/sound/check", { zones: ["main"] });
    if (r.status !== 200)
      throw new Error(`sound check: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    // Both screens' states, each stamped when it came: a screen starts at play_at, or then.
    const got = await Promise.all(
      streams.map((s) => s.next(newSound(seen), waitMs).then((f) => ({ f, at: Date.now() }))),
    );
    const play = got[0].f.data.sound.play;
    if (got[1].f.data.sound.play.id !== play.id)
      throw new Error("the screens got different sounds");
    seen = play.id;
    enabled = got.map((g) => g.f.data.sound.enabled);
    const starts = got.map((g) => Math.max(g.at, Date.parse(play.play_at)));
    return Math.abs(starts[0] - starts[1]);
  };
  // A fresh stack's screen finds the moments stream at its next rescan, as for the latency check.
  const warmUntil = Date.now() + WARM_UP_MS;
  for (let ok = 0; ok < 2;) {
    if (Date.now() > warmUntil)
      throw new Error("Moments' sounds did not come through to the screens");
    ok = (await round(3000).catch(() => Infinity)) < BUDGET_MS ? ok + 1 : 0;
  }
  for (let i = 0; i < ROUNDS; i++) spreads.push(await round(5000));
} finally {
  for (const s of streams) s.close();
  await demo.call("PUT", "/api/screen/zones/main", { body: zone });
  await demo.revoke(a.id);
  await demo.revoke(b.id);
}

const worst = Math.max(...spreads);
console.log(
  `sound sync: the two screens of a zone start within ${worst.toFixed(0)} ms of each other at worst over ${spreads.length} sounds; sound enabled ${JSON.stringify(enabled)}`,
);
if (!(worst < BUDGET_MS)) {
  console.error(`sound sync over budget: ${worst.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
  process.exit(1);
}
if (enabled[0] !== true || enabled[1] !== false) {
  console.error(`only the zone's sound screen may play: enabled ${JSON.stringify(enabled)}`);
  process.exit(1);
}
