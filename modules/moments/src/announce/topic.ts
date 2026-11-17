/**
 * Notify's `announcements` topic, owned by moments (D20; contracts/notify.md, Topics and sources;
 * Registering). Without it Notify knows no topic for `moments.announcement.sent`, and "Push to
 * phones" reaches nobody. Sent at every start by every container: the call is idempotent.
 */
import type { Logger, ServiceIdentity } from "@canccu/kit";

/** Exactly the contract's JSON block (test/topic.test.ts holds the two together). */
export const ANNOUNCEMENTS_TOPIC = {
  key: "announcements",
  owner: "moments",
  title: "Announcements",
  description: "What the organisers announce to everyone at the event",
  parts: {
    event: {
      scope: "event",
      channels: ["push", "discord_dm"],
      defaults: { push: true, discord_dm: false },
    },
  },
  triggers: [
    {
      event: "moments.announcement.sent",
      part: "event",
      audience: { value: "public" },
      where: [{ field: "data.channels.push", op: "eq", value: true }],
      urgent: { field: "data.urgent" },
      title: "{data.title}",
      body: "{data.body}",
      url: "/notify/",
      expires_at: "data.expires_at",
    },
  ],
};

const FIRST_PAUSE_MS = 1000;
const MAX_PAUSE_MS = 60_000;
// Refusals that can pass by themselves: Notify not knowing moments' key yet (401), a Notify older
// than the path (404), a timeout (408), a rate limit (429). Tried again at the longest pause.
const PASSING = new Set([401, 404, 408, 429]);

interface Options {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
}

/**
 * PUTs the registration until Notify takes it (true), or refuses it for good (false: the same
 * body would get the same answer; Moments serves on, and the log says why phones hear nothing).
 */
export async function registerTopic(
  notifyUrl: string,
  service: ServiceIdentity,
  o: Options = {},
): Promise<boolean> {
  const send = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${notifyUrl.replace(/\/+$/, "")}/internal/notify/topic-types/announcements`;
  let pause = FIRST_PAUSE_MS;
  for (;;) {
    const res = await send(url, {
      method: "PUT",
      headers: { "content-type": "application/json", ...service.headers("notify") },
      body: JSON.stringify(ANNOUNCEMENTS_TOPIC),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (res !== null && res.status < 400) {
      o.log?.info("announcements topic registered with notify");
      return true;
    }
    if (res !== null && res.status < 500 && !PASSING.has(res.status)) {
      o.log?.error(
        { status: res.status, body: (await res.text().catch(() => "")).slice(0, 500) },
        "notify refused the announcements topic",
      );
      return false;
    }
    pause = res !== null && PASSING.has(res.status) ? MAX_PAUSE_MS : pause;
    await sleep(pause);
    pause = Math.min(pause * 2, MAX_PAUSE_MS);
  }
}
