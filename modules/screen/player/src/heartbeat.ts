/**
 * The device heartbeat (contracts/screen.md, Heartbeat) and the clock offset it yields. Rotation,
 * countdowns and claim ends run on this device's clock corrected by the offset, so every screen of
 * a zone shows the same moment (docs/plans/issue-109.md, S6).
 */
import { call, isDeviceAnswer } from "./api.js";
import type { Answer, Fetch } from "./api.js";

export const HEARTBEAT_PATH = "/api/screen/device/heartbeat";
/** The default of the `heartbeat_seconds` setting; the state does not carry the setting. */
export const HEARTBEAT_MS = 15_000;

/** What the page reports about itself at each beat. */
export interface Report {
  state_version: number;
  bundle_version: string;
  theme_revision: number;
  viewport: { width: number; height: number };
}

/** Random once per page load, so admin can tell a reload from a copied cookie (`shared_token`). */
export function newInstanceId(random: () => number = Math.random): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return Array.from({ length: 22 }, () => chars[Math.floor(random() * 64)]).join("");
}

export class Heartbeat {
  /** The server's clock minus this device's, from the last answered beat. */
  offsetMs = 0;
  readonly instanceId: string;
  private rttMs: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** A beat still waiting for its answer; the next is skipped, so beats never pile up. */
  private open = false;

  constructor(
    private readonly fetchFn: Fetch,
    private readonly report: () => Report,
    /** An answer about the device (401, 403, 409); the beats stop. */
    private readonly refused: (answer: Answer) => void,
    private readonly now: () => number = Date.now,
    random: () => number = Math.random,
  ) {
    this.instanceId = newInstanceId(random);
  }

  /** This device's clock, corrected to the server's. */
  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  start(intervalMs = HEARTBEAT_MS): void {
    if (this.timer !== undefined) return;
    void this.beat();
    this.timer = setInterval(() => void this.beat(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async beat(): Promise<void> {
    if (this.open) return;
    this.open = true;
    try {
      await this.send();
    } finally {
      this.open = false;
    }
  }

  private async send(): Promise<void> {
    const sent = this.now();
    const body = {
      ...this.report(),
      audio_unlocked: false,
      client_time: new Date(sent).toISOString(),
      instance_id: this.instanceId,
      ...(this.rttMs === null ? {} : { rtt_ms: this.rttMs }),
      errors: [],
    };
    const answer = await call(this.fetchFn, "POST", HEARTBEAT_PATH, body);
    if (this.timer === undefined) return;
    const received = this.now();
    if (isDeviceAnswer(answer.status)) {
      this.stop();
      this.refused(answer);
      return;
    }
    const serverTime = (answer.body as { server_time?: unknown } | null)?.server_time;
    const serverMs = typeof serverTime === "string" ? Date.parse(serverTime) : NaN;
    if (answer.status !== 200 || Number.isNaN(serverMs)) return;
    const rtt = Math.max(0, received - sent);
    this.rttMs = Math.min(rtt, 600_000);
    // The server read its clock about halfway through the round trip.
    this.offsetMs = serverMs - (sent + rtt / 2);
  }
}
