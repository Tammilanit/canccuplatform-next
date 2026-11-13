/**
 * The kiosk's life: from the device's answers to a frame (docs/plans/issue-109.md, S8). No device
 * cookie (401 `device_unknown`) pairs; a device with a zone plays; 403 `venue_ip_refused`, 409
 * `device_moved` and an archived event each get their frame; anything else retries behind a
 * "connecting" frame. Every wait goes through one timer and every flow through one generation, so
 * a late answer of a flow the page has left never draws over the current one.
 */
import { call, isDeviceAnswer } from "./api.js";
import type { Answer, Fetch } from "./api.js";
import { frame, keepSafetyLast, minutesLeft, safetyCode, setClock, setFoot } from "./frames.js";
import { previewMark } from "./preview-mark.js";
import {
  archived,
  CONNECTING,
  MOVED,
  MOVED_HELP,
  NO_VENUE,
  PARKED,
  REFUSED,
  SETUP,
  TOO_MANY,
  UNREACHABLE,
} from "./frame-words.js";
import type { FrameKind, FrameText } from "./frames.js";
import { Live, STATE_PATH } from "./live.js";
import type { Saved } from "./offline.js";
import { Screen } from "./screen.js";
import { isState } from "./state.js";
import type { ScreenState } from "./state.js";
import { backoffMs } from "./stream.js";

export { OFFLINE_AFTER_MS, POLL_MS } from "./live.js";
/** How often a refused, parked or moved screen asks again (mockup 05: "every 30 s"). */
export const RETRY_MS = 30_000;
/** How long the moved frame shows before the page goes to the new address. */
export const MOVE_MS = 3000;
const CODE_MAX_MS = 10 * 60_000;
/** The contract's code and the kit's older name for it (contracts/screen.md, Devices). */
const VENUE_CODES = new Set(["venue_ip_refused", "venue_ip_mismatch"]);

/** A 403 for the venue check; any other 403 is not something the venue frame can explain. */
function venueRefused(answer: Answer): boolean {
  return answer.status === 403 && answer.code !== null && VENUE_CODES.has(answer.code);
}

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
  /** Whether the browser asks for reduced motion; the default reads `prefers-reduced-motion`. */
  reducedMotion?: () => boolean;
  now?: () => number;
  random?: () => number;
  /** The last state kept for a boot without the server (offline.ts); none on the virtual screen. */
  offline?: {
    load(): Promise<Saved | null>;
    save(state: ScreenState): void;
    clear(): void;
    seen(): void;
  };
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Player {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private tick: (() => void) | null = null;
  private failures = 0;
  /** Whether any frame has been drawn: the loader's `<body>` starts empty. */
  private drawn = false;
  private eventName: string | null | undefined;
  /** The event's time zone, once the page has heard it; the frames' clocks show its time. */
  private timeZone: string | undefined;
  /** The theme's logo of the last state, for the frames' header. */
  private logo: string | null = null;
  private readonly now: () => number;
  private readonly random: () => number;
  readonly live: Live;
  private readonly screen: Screen;

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
      // Live has played it already (take): only draw it, else every push plays twice.
      show: (state) => {
        this.draw(state);
      },
      settle: (answer) => {
        this.settle(answer);
      },
      seen: () => {
        env.offline?.seen();
      },
    });
    this.screen = new Screen({
      serverNow: () => this.live.heartbeat.serverNow(),
      offline: () => this.live.offline,
      reducedMotion: env.reducedMotion ?? prefersReducedMotion,
    });
  }

  get state(): ScreenState | null {
    return this.live.state;
  }

  async start(): Promise<void> {
    this.ticker ??= setInterval(() => {
      this.tick?.();
      this.clock();
    }, 1000);
    const gen = this.next();
    const transfer = /^#transfer=([A-Za-z0-9_-]{16,64})$/.exec(this.env.nav.hash())?.[1];
    if (transfer !== undefined) this.env.nav.clearHash();
    // Never a blank page while the first read is out, however long it takes to fail.
    if (!this.drawn) this.show({ kind: "unknown", ...CONNECTING });
    let answer = await call(this.env.fetch, "GET", STATE_PATH);
    // A working cookie for this hostname wins over the code (contracts/screen.md, Moving).
    if (transfer !== undefined && answer.status !== 200 && gen === this.generation) {
      const redeemed = await call(this.env.fetch, "POST", "/api/screen/device/transfer", {
        code: transfer,
      });
      if (redeemed.status === 200) answer = await call(this.env.fetch, "GET", STATE_PATH);
    }
    if (gen !== this.generation) return;
    // No server to ask (or none that answers): what this screen showed last, never "connecting".
    // An answer about the device still wins, so a revoked screen never plays its old state.
    if (answer.status !== 200 && !isDeviceAnswer(answer.status) && !this.live.running) {
      const saved = await this.env.offline?.load();
      if (gen !== this.generation) return;
      if (saved) {
        this.run(saved.state, saved.seenAt);
        return;
      }
    }
    this.settle(answer);
  }

  /** Leave whatever flow runs: its timers stop, its late answers are dropped. */
  private next(): number {
    clearTimeout(this.timer);
    this.screen.stop();
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

  private show(text: FrameText & { kind: FrameKind }, code?: string): HTMLElement {
    const node = frame(text.kind, { logo: this.logo, ...text });
    // A frame (pairing, refused, moved…) is never a preview's.
    previewMark(this.env.root, null);
    this.mount(node, code === undefined ? [] : [safetyCode(code)]);
    this.clock();
    return node;
  }

  /** The shown frame's date and clock, on the server's time once a heartbeat has set it. */
  private clock(): void {
    setClock(this.env.root, this.live.heartbeat.serverNow(), this.timeZone);
  }

  private mount(node: HTMLElement, safety: HTMLElement[] = []): void {
    this.drawn = true;
    // The screen keeps its layout between states: moving it out and back in would restart its
    // fades and, later, its videos.
    if (this.env.root.firstElementChild === node) return;
    const keep = [...this.env.root.children].filter((c) =>
      c.matches(".canccu-offline-marker, .canccu-preview-mark, .canccu-identify"),
    );
    this.env.root.replaceChildren(node, ...keep, ...safety);
    keepSafetyLast(this.env.root);
  }

  settle(answer: Answer): void {
    if (answer.status === 200 && isState(answer.body)) {
      this.failures = 0;
      this.run(answer.body);
      return;
    }
    this.next();
    this.live.stop();
    // Only while the server is reachable do these answers win over the kept state (start()).
    if (isDeviceAnswer(answer.status)) this.env.offline?.clear();
    if (answer.status === 401) void this.pair();
    else if (venueRefused(answer)) this.refused();
    else if (answer.status === 409 && answer.code === "device_moved") void this.moved();
    else if (answer.status === 409 && answer.code === "event_archived") this.archived();
    else this.unknown();
  }

  /** `offlineSince`: a state from the offline store, which is kept already. */
  private run(state: ScreenState, offlineSince?: number): void {
    if (!this.live.running) this.next();
    this.live.play(state, offlineSince);
    this.draw(state, offlineSince);
  }

  /** A state the live flow has taken already (a pushed one), or that `run` just played. */
  private draw(state: ScreenState, offlineSince?: number): void {
    // A preview is never kept: a reboot without the server must show the live zone, not a draft.
    if (offlineSince === undefined && !state.preview) this.env.offline?.save(state);
    this.tick = null;
    this.eventName = state.tenant.name;
    this.timeZone = state.tenant.time_zone;
    this.logo = state.theme.logo_url;
    const who = { event: state.tenant.name, where: state.device.name };
    if (state.tenant.status === "archived" || state.zone === null) this.screen.stop();
    if (state.tenant.status === "archived") {
      this.show({ kind: "archived", ...who, ...archived(state.tenant.name) });
    } else if (state.zone === null) {
      // The device's name is the frame's title (sheet 9), so the header does not say it again.
      this.show({
        kind: "unassigned",
        ...who,
        where: null,
        title: state.device.name,
        lines: [
          "Paired. Waiting for a zone.",
          "An organiser assigns it to a zone. It starts by itself.",
        ],
      });
    } else {
      this.mount(this.screen.draw(state));
      this.screen.start();
    }
    previewMark(this.env.root, state.zone === null ? null : state);
    keepSafetyLast(this.env.root);
  }

  private async pair(): Promise<void> {
    const gen = this.next();
    if (this.eventName === undefined) {
      const current = await call(this.env.fetch, "GET", "/api/tenants/current");
      if (gen !== this.generation) return;
      const { name, time_zone: zone } = (current.body ?? {}) as {
        name?: unknown;
        time_zone?: unknown;
      };
      // A draft event shows guests no name; the frame then shows the platform's mark instead.
      if (current.status === 200) this.eventName = typeof name === "string" ? name : null;
      if (typeof zone === "string") this.timeZone = zone;
    }
    const event = this.eventName ?? null;
    const answer = await call(this.env.fetch, "POST", "/api/screen/pairing");
    if (gen !== this.generation) return;
    const body = answer.body as { pairing_id?: string; code?: string; expires_at?: string } | null;
    if (answer.status === 201 && body?.pairing_id && body.code) {
      this.failures = 0;
      this.showCode(event, body.pairing_id, body.code, body.expires_at ?? "", answer.serverMs);
    } else if (venueRefused(answer)) this.refused();
    else if (answer.status === 409 && answer.code === "event_archived") this.archived();
    else if (answer.status === 409 && answer.code === "no_venue") {
      this.show({ kind: "unknown", event, where: SETUP, ...NO_VENUE });
      this.wait(RETRY_MS, () => this.pair());
    } else if (answer.status === 429) {
      this.show({ kind: "unknown", event, where: SETUP, ...TOO_MANY });
      this.wait(RETRY_MS, () => this.pair());
    } else this.unknown();
  }

  private showCode(
    event: string | null,
    id: string,
    code: string,
    expiresAt: string,
    serverMs = NaN,
  ): void {
    // A kiosk's clock may be off before NTP syncs, and no heartbeat runs while pairing: the time
    // left is counted on the server's clock (its `Date` header), and never more than a code lives.
    const serverNow = Number.isNaN(serverMs) ? this.now() : serverMs;
    const left = Math.min(CODE_MAX_MS, Math.max(0, Date.parse(expiresAt) - serverNow || 0));
    const until = this.now() + left;
    // No QR and no Studio path until Screen studio's Devices page exists (#190): the frame must
    // not send anyone to a page that answers 404 (UX audit, D3).
    const node = this.show(
      {
        kind: "pairing",
        event,
        where: SETUP,
        kicker: "New screen",
        title: "Pair this screen",
        lines: ["Ask an organiser to pair it with this code."],
      },
      code,
    );
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
        const state = await call(this.env.fetch, "GET", STATE_PATH);
        if (gen === this.generation) this.settle(state);
      } else if ((answer.status === 200 && status === "expired") || answer.status === 404) {
        void this.pair();
      } else if (venueRefused(answer)) this.refused();
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
    this.show({ kind: "archived", event: this.eventName, ...archived(this.eventName) });
    this.wait(RETRY_MS, () => this.start());
  }

  private unknown(): void {
    this.next();
    this.failures += 1;
    const ms = backoffMs(this.failures, 2000, this.random);
    this.show({
      kind: "unknown",
      event: this.eventName,
      ...UNREACHABLE,
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
      this.show({
        kind: "moved",
        ...MOVED,
        lines: ["to its next event. Taking you there…", MOVED_HELP],
      });
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
        lines: ["to its next event.", "Crew: open its new address on the kiosk."],
      });
      this.wait(RETRY_MS, () => this.start());
    }
  }
}
