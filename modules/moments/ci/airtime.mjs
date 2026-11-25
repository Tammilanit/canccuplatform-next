// Airtime that is seen (#777) on the demo stack: a final's winner card holds the main zone's hero;
// Pizza is here arrives and shows in the rail at once, takes the hero only after the card's floor
// (set to 60 s, the range's least, to keep CI short) and the 10 s gap, and when the order is done
// the card comes back with the on-air time it had left. The domain events go straight onto the
// tournament's and pizza's streams in Valkey, as those modules send them (bus.mjs); the Champion
// preset, which would show the final instead of the rule, is off meanwhile. scripts/demo-stack-test
// runs it beside Screen's stack client in the screen container.
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { xadd } from "./bus.mjs";
import { DEMO_HOST, SESSION, event } from "./client.mjs";

const TENANT = "demo";
const FLOOR_S = 60;
const GAP_S = 10;
const CARD_TTL_S = 120;

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
    req.on("error", reject);
    req.end(payload);
  });
}

const person = (id, name) => ({ user_id: id, discord_user_id: null, name });
const run = randomBytes(4).toString("hex");
const now = () => new Date().toISOString();
const session = {
  id: `ts_${run}`,
  tournament_id: "tn_air",
  game: { id: "g_air", name: "Airtime Cup" },
  starts_at: now(),
  registration_closes_at: now(),
  ends_at: null,
  status: "running",
  is_final: true,
  checkin_enabled: false,
  matches: [],
  voice_plan: "solo",
  registered_count: 2,
  checked_in_count: 0,
  revision: 1,
};
const order = (state) => ({
  id: `po_${run}`,
  seq: 77,
  state,
  pizzeria: { id: "pz_air", name: "Airtime Pizzeria" },
  target_at: now(),
  holder: person("u_air", "Airtime Holder"),
  pickup: "Stack table",
  pizza_count: 2,
  people_count: 2,
});

const regionsOf = (f) =>
  f.event === "state" ? (f.data.regions ?? []) : f.event === "region" ? [f.data.region] : [];
const claimIn = (f, role) => regionsOf(f).find((r) => r?.role === role)?.claim ?? null;
const heroIs = (template) => (f) => claimIn(f, "hero")?.template === template;
const railSays = (text) => (f) => JSON.stringify(claimIn(f, "rail")?.content ?? {}).includes(text);

const before = await moments("GET", "/api/moments/priorities");
const stories = await moments("GET", "/api/moments/storyboards");
const put = (b) => moments("PUT", "/api/moments/priorities", b);
const champion = (on, revision) =>
  moments("PUT", "/api/moments/storyboards", {
    stories: stories.body.stories.map((s) =>
      s.preset === "champion" ? { ...s, enabled: on && s.enabled } : s,
    ),
    settings: stories.body.settings,
    revision,
  });
const demo = event(DEMO_HOST);
const screen = await demo.pair("Airtime check", "main");
const sse = demo.stream(screen.cookie);
let saved = before.body.revision;
let storyRev = stories.body.revision;
try {
  const p = await put({
    order: before.body.order,
    zones: before.body.zones,
    revision: saved,
    airtime: { min_on_air_seconds: FLOOR_S, gap_seconds: GAP_S },
  });
  if (p.status !== 200) throw new Error(`priorities: HTTP ${p.status} ${JSON.stringify(p.body)}`);
  saved = p.body.revision;
  const off = await champion(false, storyRev);
  if (off.status !== 200) throw new Error(`Champion off: HTTP ${off.status}`);
  storyRev = off.body.revision;
  await sse.opened;
  await xadd(TENANT, "tournament", "tournament.match.finished", {
    session,
    match: { id: `tm_${run}`, session_id: session.id, label: "Final", teams: [] },
    results: [{ rank: 1, people: [person("u_air", "Airtime Champion")], points: 9 }],
    actor_user_id: null,
  });
  await sse.next(heroIs("winner_card"), 30_000);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 5000));
  await xadd(TENANT, "pizza", "pizza.order.arrived", {
    order: order("arrived"),
    user_ids: [],
    people: [],
  });
  await sse.next(railSays("Pizza is here"), 10_000);
  const inRail = (Date.now() - t0) / 1000;
  await sse.next(heroIs("announcement"), (FLOOR_S + GAP_S + 20) * 1000);
  const held = (Date.now() - t0) / 1000;
  if (held < FLOOR_S - 2) throw new Error(`the card held the hero only ${held} s`);
  await xadd(TENANT, "pizza", "pizza.order.done", {
    order: order("done"),
    reason: "handed_out",
    actor_user_id: null,
  });
  const back = await sse.next(heroIs("winner_card"), (GAP_S + 20) * 1000);
  const left = (Date.parse(claimIn(back, "hero")?.expires_at ?? "") - Date.now()) / 1000;
  if (!(Math.abs(left - (CARD_TTL_S - FLOOR_S)) <= 8))
    throw new Error(`the card came back with ${left} s left`);
  console.log(
    `airtime: card held ${held.toFixed(0)} s, pizza in rail after ${inRail.toFixed(0)} s, card back with ${left.toFixed(0)} s left`,
  );
} finally {
  sse.close?.();
  await champion(true, storyRev);
  await put({
    order: before.body.order,
    zones: before.body.zones,
    revision: saved,
    airtime: before.body.airtime,
  });
}
