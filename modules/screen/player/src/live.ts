/**
 * A screen that plays: its push stream, heartbeat, offline mark and commands. It keeps the state
 * current and hands every new one to the player to draw; an answer about the device (401, 403,
 * 409) goes back to the player, which leaves playing for that answer's frame.
 */
import { call, isDeviceAnswer } from "./api.js";
import type { Answer, Fetch } from "./api.js";
import { clockText, identifyCard, offlineMark } from "./frames.js";
import { Heartbeat } from "./heartbeat.js";
import { applyPatch, isState } from "./state.js";
import type { ScreenState } from "./state.js";
import { StreamClient } from "./stream.js";
import type { SseMessage } from "./sse.js";

export const STATE_PATH = "/api/screen/device/state";
/** Without a stream this long, the page marks itself offline (contracts/screen.md, Offline). */
export const OFFLINE_AFTER_MS = 10_000;
/** After three failed connects the state is polled this often while the stream keeps retrying. */
export const POLL_MS = 10_000;
const IDENTIFY_MS = 15_000;
const PATCHES = new Set(["widget", "region", "ticker", "theme"]);

export interface LiveHost {
  fetch: Fetch;
  /** `<body>`: it carries `canccu-is-offline`, the offline mark and the identify card. */
  root: HTMLElement;
  bundle: string;
  reload(): void;
  now: () => number;
  random: () => number;
  /** A new state to draw (whole, or after a push changed part of it). */
  show(state: ScreenState): void;
  /** A whole-state answer, or one about the device, for the player to act on. */
  settle(answer: Answer): void;
}

export class Live {
  state: ScreenState | null = null;
  running = false;
  readonly heartbeat: Heartbeat;
  private readonly stream: StreamClient;
  private streamOpen = false;
  private offlineTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private identify: HTMLElement | null = null;

  constructor(private readonly host: LiveHost) {
    this.stream = new StreamClient(
      host.fetch,
      {
        open: () => {
          this.streamOpen = true;
          this.online();
        },
        message: (m) => {
          this.onMessage(m);
        },
        lost: () => {
          this.streamOpen = false;
          this.armOffline();
        },
        failed: (count) => {
          this.armOffline();
          if (count >= 3) this.startPolling();
        },
        refused: (answer) => {
          host.settle(answer);
        },
      },
      host.random,
    );
    this.heartbeat = new Heartbeat(
      host.fetch,
      () => ({
        state_version: this.state?.state_version ?? 0,
        bundle_version: host.bundle,
        theme_revision: this.state?.theme.revision ?? 0,
        viewport: { width: window.innerWidth || 1, height: window.innerHeight || 1 },
      }),
      (answer) => {
        host.settle(answer);
      },
      host.now,
      host.random,
    );
  }

  /** Take a state: the first one starts the stream and the heartbeat. */
  play(state: ScreenState): void {
    this.state = state;
    this.setTheme(state.theme);
    if (this.running) return;
    this.running = true;
    this.streamOpen = false;
    this.armOffline();
    this.stream.start();
    this.heartbeat.start();
  }

  stop(): void {
    this.running = false;
    this.streamOpen = false;
    this.stream.stop();
    this.heartbeat.stop();
    this.online();
  }

  private onMessage(m: SseMessage): void {
    let data: unknown;
    try {
      data = JSON.parse(m.data);
    } catch {
      return;
    }
    if (m.event === "state") {
      if (isState(data)) this.host.show(data);
    } else if (m.event === "command") {
      this.command(data as { command?: string; expires_at?: string });
    } else if (PATCHES.has(m.event) && this.state !== null) {
      const next = applyPatch(this.state, m.event, data as Parameters<typeof applyPatch>[2]);
      if (next === null) void this.reread();
      else this.host.show(next);
    }
  }

  /**
   * Read the whole state again. Only a state or an answer about the device changes what the page
   * shows: a server error keeps the last state on screen, as an outage does.
   */
  private async reread(): Promise<void> {
    const answer = await call(this.host.fetch, "GET", STATE_PATH);
    if (!this.running) return;
    if (answer.status === 200 || isDeviceAnswer(answer.status)) this.host.settle(answer);
  }

  private command(data: { command?: string; expires_at?: string }): void {
    const expires = Date.parse(data.expires_at ?? "");
    if (!Number.isNaN(expires) && expires < this.heartbeat.serverNow()) return;
    if (data.command === "reload") this.host.reload();
    else if (data.command === "identify" && this.state !== null) this.showIdentify(this.state);
  }

  private showIdentify(state: ScreenState): void {
    this.identify?.remove();
    const card = identifyCard(state.device.name, state.zone?.name ?? null, this.host.bundle);
    const until = this.host.now() + IDENTIFY_MS;
    this.identify = card;
    this.host.root.append(card);
    const left = card.querySelector(".canccu-identify__left");
    const step = (): void => {
      const ms = until - this.host.now();
      if (ms <= 0 || this.identify !== card) {
        clearInterval(timer);
        card.remove();
        if (this.identify === card) this.identify = null;
        return;
      }
      if (left !== null) left.textContent = `identify · ${Math.ceil(ms / 1000)} s left`;
    };
    const timer = setInterval(step, 1000);
    step();
  }

  private armOffline(): void {
    if (this.offlineTimer !== undefined || this.streamOpen || !this.running) return;
    const since = this.heartbeat.serverNow();
    this.offlineTimer = setTimeout(() => {
      if (this.streamOpen || !this.running) return;
      const root = this.host.root;
      root.classList.add("canccu-is-offline");
      root.querySelector(".canccu-offline-mark")?.remove();
      root.append(offlineMark(clockText(since, this.state?.tenant.time_zone)));
    }, OFFLINE_AFTER_MS);
  }

  private online(): void {
    clearTimeout(this.offlineTimer);
    this.offlineTimer = undefined;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.host.root.classList.remove("canccu-is-offline");
    this.host.root.querySelector(".canccu-offline-mark")?.remove();
  }

  private startPolling(): void {
    if (this.pollTimer !== undefined) return;
    this.pollTimer = setInterval(() => {
      void this.reread();
    }, POLL_MS);
  }

  /** The theme's files come only from the state (L3): the player never calls theming. */
  private setTheme(theme: ScreenState["theme"]): void {
    const head = document.head;
    for (const [slot, href] of [
      ["tokens", theme.tokens_css_url],
      ["css", theme.css_url],
    ] as const) {
      const old = head.querySelector<HTMLLinkElement>(`link[data-theme="${slot}"]`);
      // Same-origin paths only: `//host/x.css` would be another host's file.
      if (href === null || !/^\/(?!\/)/.test(href)) {
        old?.remove();
        continue;
      }
      if (old?.getAttribute("href") === href) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.theme = slot;
      if (old) old.replaceWith(link);
      else head.append(link);
    }
  }
}
