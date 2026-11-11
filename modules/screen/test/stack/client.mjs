// What the stack tests (push latency, load, soak) share: plain HTTP calls to screen, pairing a
// screen, and reading its push stream. They run where a device stream may open: in the screen
// container, or a browser in its network namespace, since the venue IP check lets a device in
// only from the demo venue's addresses (the loopback there), while the host's requests reach Caddy
// from Docker's gateway. So they call screen itself, not Caddy, and name the event in `Host`.
import { request } from "node:http";

export const SCREEN = { host: "127.0.0.1", port: 8080 };
export const SESSION = `canccu_session=${process.env.DEMO_SESSION ?? "demo-ci"}`;
/** The demo event's hostname on the CI stack (deploy/compose.ci.yml); an IP literal in IP mode. */
export const DEMO_HOST = process.env.CANCCU_DEMO_HOST ?? "demo.localhost";
const WAIT_MS = 5000;

/** One event's calls: every request names `host`, which is how screen finds the event. */
export function event(host) {
  function call(method, path, { cookie = SESSION, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          ...SCREEN,
          method,
          path,
          headers: {
            host,
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
            let parsed = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              parsed = text;
            }
            resolve({ status: res.statusCode, body: parsed, cookies });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)));
      req.on("error", reject);
      req.end(payload);
    });
  }

  /** Pairs a new screen into `zone` and answers its id and device cookie (contracts/screen.md, Pairing). */
  async function pair(name, zone) {
    const pairing = expect(
      await call("POST", "/api/screen/pairing", { cookie: "" }),
      201,
      "pairing",
    );
    const paired = expect(
      await call("POST", "/api/screen/devices", {
        body: { code: pairing.body.code, name, zone_key: zone },
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
    const cookie = cookieOf(claimed, "canccu_device");
    if (!cookie) throw new Error("the claim set no device cookie");
    return { id: paired.body.id, cookie };
  }

  const revoke = (id) => call("POST", `/api/screen/devices/${id}/revoke`).catch(() => undefined);
  const setTicker = async (text) =>
    expect(await call("PUT", "/api/screen/ticker", { body: { text, until: null } }), 200, "ticker");

  return { host, call, pair, revoke, setTicker, stream: (cookie) => stream(host, cookie) };
}

export function expect(res, status, what) {
  if (res.status !== status) {
    throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

const cookieOf = (res, name) => res.cookies.find((c) => c.startsWith(`${name}=`))?.split(";")[0];

/**
 * The stream's frames as they arrive; `next(test)` waits for the first one that passes and drops
 * those before it, while `history` keeps every frame.
 */
function stream(host, cookie) {
  const frames = [];
  const history = [];
  let wake = () => {};
  const req = request({ ...SCREEN, path: "/api/screen/device/stream", headers: { host, cookie } });
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
            const frame = {
              event: field("event"),
              data: JSON.parse(field("data") ?? "{}"),
              at: performance.now(),
            };
            frames.push(frame);
            history.push(frame);
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
    history,
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

/** Whether a stream frame carries the ticker `text` (a `ticker` message, or a whole `state`). */
export const tickerIs = (text) => (f) =>
  (f.event === "ticker" || f.event === "state") && f.data.ticker?.text === text;
