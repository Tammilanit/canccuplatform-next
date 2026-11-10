/**
 * The kiosk's life: from the device's answers to a frame (docs/plans/issue-109.md, S8). No device
 * cookie (401 `device_unknown`) pairs; a device with a zone plays; 403 `venue_ip_refused`, 409
 * `device_moved` and an archived event each get their frame; anything else retries behind a
 * "connecting" frame. Every wait goes through one timer and every flow through one generation, so
 * a late answer of a flow the page has left never draws over the current one.
 */
import { call } from "./api.js";
import type { Answer, Fetch } from "./api.js";
import { clockText, frame, minutesLeft, setFoot } from "./frames.js";
import type { FrameKind, FrameText } from "./frames.js";
import { Live, STATE_PATH } from "./live.js";
import { isState } from "./state.js";
import type { ScreenState } from "./state.js";
import { backoffMs } from "./stream.js";

export { OFFLINE_AFTER_MS, POLL_MS } from "./live.js";
/** How often a refused, parked or moved screen asks again (mockup 05: "every 30 s"). */
export const RETRY_MS = 30_000;
/** How long the moved frame shows before the page goes to the new address. */
export const MOVE_MS = 3000;
const CODE_MAX_MS = 10 * 60_000;

export interface Nav {
  hash(): string;
  clearHash(): void;
  origin(): string;
  go(url: string): void;
  reload(): void;
}

export interface PlayerEnv {
  fetch: Fetch;
  nav: Nav;
  /** `<body>`: frames replace its content. */
  root: HTMLElement;
  bundle: string;
  /** Draws a zone's state; the player's rendering (#306) plugs in here. */
  draw?: (state: ScreenState) => HTMLElement;
  now?: () => number;
  random?: () => number;
}

/** Until the renderer lands: the event and zone, so a playing screen is never blank. */
function holding(state: ScreenState): HTMLElement {
  return frame("starting", {
    event: state.tenant.name,
    device: state.device.name,
    title: state.tenant.name,
    lines: [state.zone?.name ?? ""],
  });
}

export class Player {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private tick: (() => void) | null = null;
  private failures = 0;
  private eventName: string | null | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  readonly live: Live;

  constructor(private readonly env: PlayerEnv) {
    this.now = env.now ?? Date.now;
    this.random = env.random ?? Math.random;
    this.live = new Live({
      fetch: env.fetch,
      root: env.root,
      bundle: env.bundle,
      reload: () => {
        env.nav.reload();
      },
      now: this.now,
      random: this.random,
      show: (state) => {
        this.run(state);
      },
      settle: (answer) => {
        this.settle(answer);
      },
    });
  }

  get state(): ScreenState | null {
    return this.live.state;
  }

  async start(): Promise<void> {
    this.ticker ??= setInterval(() => this.tick?.(), 1000);
    const gen = this.next();
    const transfer = /^#transfer=([A-Za-z0-9_-]{16,64})$/.exec(this.env.nav.hash())?.[1];
    if (transfer !== undefined) this.env.nav.clearHash();
    let answer = await call(this.env.fetch, "GET", STATE_PATH);
    // A working cookie for this hostname wins over the code (contracts/screen.md, Moving).
    if (transfer !== undefined && answer.status !== 200 && gen === this.generation) {
      const redeemed = await call(this.env.fetch, "POST", "/api/screen/device/transfer", {
        code: transfer,
      });
      if (redeemed.status === 200) answer = await call(this.env.fetch, "GET", STATE_PATH);
    }
    if (gen === this.generation) this.settle(answer);
  }

  /** Leave whatever flow runs: its timers stop, its late answers are dropped. */
  private next(): number {
    clearTimeout(this.timer);
    this.tick = null;
    return ++this.generation;
  }

  private wait(ms: number, then: () => unknown): void {
    clearTimeout(this.timer);
    const gen = this.generation;
    this.timer = setTimeout(() => {
      if (gen === this.generation) void then();
    }, ms);
  }

  private show(text: FrameText & { kind: FrameKind }): HTMLElement {
    const node = frame(text.kind, text);
    this.mount(node);
    return node;
  }

  private mount(node: HTMLElement): void {
    const keep = [...this.env.root.children].filter((c) =>
      c.matches(".canccu-offline-mark, .canccu-identify"),
    );
    this.env.root.replaceChildren(node, ...keep);
  }

  settle(answer: Answer): void {
    if (answer.status === 200 && isState(answer.body)) {
      this.failures = 0;
      this.run(answer.body);
      return;
    }
    this.next();
    this.live.stop();
    if (answer.status === 401) void this.pair();
    else if (answer.status === 403) this.refused();
    else if (answer.status === 409 && answer.code === "device_moved") void this.moved();
    else if (answer.status === 409 && answer.code === "event_archived") this.archived();
    else this.unknown();
  }

  private run(state: ScreenState): void {
    if (!this.live.running) this.next();
    this.live.play(state);
    this.tick = null;
    const who = { event: state.tenant.name, device: state.device.name };
    if (state.tenant.status === "archived") {
      this.show({ kind: "archived", ...who, ...ARCHIVED });
    } else if (state.zone === null) {
      const node = this.show({
        kind: "unassigned",
        ...who,
        title: state.device.name,
        lines: [
          "Paired. Not assigned to a zone yet.",
          "An organiser assigns it in Screen studio → Devices.",
        ],
      });
      this.tick = () => {
        setFoot(node, clockText(this.live.heartbeat.serverNow(), state.tenant.time_zone));
      };
      this.tick();
    } else {
      this.mount((this.env.draw ?? holding)(state));
    }
  }

  private async pair(): Promise<void> {
    const gen = this.next();
    if (this.eventName === undefined) {
      const current = await call(this.env.fetch, "GET", "/api/tenants/current");
      if (gen !== this.generation) return;
      const name = (current.body as { name?: unknown } | null)?.name;
      // A draft event shows guests no name; the frame then says only "screen setup".
      if (current.status === 200) this.eventName = typeof name === "string" ? name : null;
    }
    const event = [this.eventName ?? null, "screen setup"].filter(Boolean).join(" · ");
    const answer = await call(this.env.fetch, "POST", "/api/screen/pairing");
    if (gen !== this.generation) return;
    const body = answer.body as { pairing_id?: string; code?: string; expires_at?: string } | null;
    if (answer.status === 201 && body?.pairing_id && body.code) {
      this.failures = 0;
      this.showCode(event, body.pairing_id, body.code, body.expires_at ?? "");
    } else if (answer.status === 403) this.refused();
    else if (answer.status === 409 && answer.code === "event_archived") this.archived();
    else if (answer.status === 409 && answer.code === "no_venue") {
      this.show({ kind: "unknown", event, ...NO_VENUE });
      this.wait(RETRY_MS, () => this.pair());
    } else if (answer.status === 429) {
      this.show({ kind: "unknown", event, ...TOO_MANY });
      this.wait(RETRY_MS, () => this.pair());
    } else this.unknown();
  }

  private showCode(event: string, id: string, code: string, expiresAt: string): void {
    // The device's clock may be off before its first heartbeat: never show more than a code lives.
    const left = Math.min(CODE_MAX_MS, Math.max(0, Date.parse(expiresAt) - this.now() || 0));
    const until = this.now() + left;
    const node = this.show({
      kind: "pairing",
      event,
      title: "Pair this screen",
      code,
      lines: ["Screen studio → Devices → Pair, and type the code."],
      qr: {
        url: `${this.env.nav.origin()}/admin/screen/devices#pair=${code}`,
        label: "Or scan with a signed-in phone",
      },
    });
    this.tick = () => {
      setFoot(
        node,
        `Code expires in ${minutesLeft(until - this.now())} · a reload keeps the same code`,
      );
    };
    this.tick();
    const poll = async (): Promise<void> => {
      const gen = this.generation;
      const answer = await call(this.env.fetch, "GET", `/api/screen/pairing/${id}`);
      if (gen !== this.generation) return;
      const status = (answer.body as { status?: string } | null)?.status;
      if (answer.status === 200 && status === "paired") {
        this.settle(await call(this.env.fetch, "GET", STATE_PATH));
      } else if ((answer.status === 200 && status === "expired") || answer.status === 404) {
        void this.pair();
      } else if (answer.status === 403) this.refused();
      else this.wait(2000, poll);
    };
    this.wait(2000, poll);
  }

  private refused(): void {
    this.next();
    this.show({ kind: "refused", event: this.state?.tenant.name ?? this.eventName, ...REFUSED });
    this.wait(RETRY_MS, () => this.start());
  }

  private archived(): void {
    this.next();
    this.show({ kind: "archived", event: this.eventName, ...ARCHIVED });
    this.wait(RETRY_MS, () => this.start());
  }

  private unknown(): void {
    this.next();
    this.failures += 1;
    const ms = backoffMs(this.failures, 2000, this.random);
    this.show({
      kind: "unknown",
      title: "Connecting…",
      lines: ["This screen is waiting for the event's server."],
      foot: `Trying again in ${Math.ceil(ms / 1000)} s`,
    });
    this.wait(ms, () => this.start());
  }

  private async moved(): Promise<void> {
    const gen = this.next();
    const answer = await call(this.env.fetch, "GET", "/api/screen/device/home");
    if (gen !== this.generation) return;
    const url = (answer.body as { url?: unknown } | null)?.url;
    if (answer.status === 200 && typeof url === "string" && /^https?:\/\//.test(url)) {
      this.show({ kind: "moved", ...MOVED, lines: ["to its next event. Taking you there…"] });
      this.wait(MOVE_MS, () => {
        this.env.nav.go(url);
      });
    } else if (answer.status === 200 && url === null) {
      this.show({ kind: "unassigned", ...PARKED });
      this.wait(RETRY_MS, () => this.start());
    } else if (answer.status === 401) {
      void this.pair();
    } else {
      this.show({
        kind: "moved",
        ...MOVED,
        lines: ["Moved, ask the crew to open its new address."],
      });
      this.wait(RETRY_MS, () => this.start());
    }
  }
}

const REFUSED = {
  title: "Not at the event's venue",
  lines: [
    "This screen only plays from the venue network.",
    "The screen is paired, but this network is not the venue.",
    "Crew: check the venue uplink, or ask an organiser about the audited emergency switch (48 h max).",
  ],
  foot: "Retrying every 30 s · no content is sent while refused",
};
const ARCHIVED = {
  title: "This event has ended",
  lines: ["This screen waits here until it is moved to its next event."],
  foot: "Crew: the platform admin moves screens between events",
};
const MOVED = {
  title: "This screen has moved",
  foot: "Crew: update the kiosk start URL when convenient",
};
const PARKED = {
  title: "Not assigned to an event",
  lines: ["This screen is paired, but no event holds it right now."],
  foot: "Crew: the platform admin moves screens between events",
};
const NO_VENUE = {
  title: "This event has no venue yet",
  lines: ["Screens pair only once the event has a venue. Ask an organiser to set it."],
  foot: "Retrying every 30 s",
};
const TOO_MANY = {
  title: "Too many open pairing codes",
  lines: ["Use an open code, or clear them in Screen studio → Devices."],
  foot: "Retrying every 30 s",
};
