/**
 * The virtual screen, `/screen/zones/<zone_key>` (contracts/screen.md, A zone for a session):
 * a zone drawn by the real player for a signed-in person, as a mirror of the zone, live over the
 * zone's own stream, with no heartbeat, so it never shows in device health. Studio's live view
 * and CI's screenshots load it (`?orientation=portrait` for a portrait screen); Studio's preview
 * frames it and posts it the state `POST …/preview` answered.
 */
import { call } from "./api.js";
import type { Answer, Fetch } from "./api.js";
import { frame } from "./frames.js";
import type { FrameText } from "./frames.js";
import { Live } from "./live.js";
import { Screen } from "./screen.js";
import { isState } from "./state.js";
import type { ScreenState } from "./state.js";
import { backoffMs } from "./stream.js";

/** What a framing Studio page posts to draw a preview instead of the live zone. */
export const PREVIEW_MESSAGE = "canccu-screen-preview";

export interface VirtualEnv {
  fetch: Fetch;
  root: HTMLElement;
  bundle: string;
  zone: string;
  portrait: boolean;
  reload(): void;
  reducedMotion: () => boolean;
  now?: () => number;
  random?: () => number;
}

const ANSWERS: Record<number, FrameText> = {
  401: {
    title: "Sign in to see this zone",
    lines: ["Sign in to the event's admin in this browser, then reload this page."],
  },
  403: {
    title: "No access to this zone",
    lines: ["Seeing a zone's screens needs the right to read the event's screens."],
  },
  404: { title: "No such zone", lines: ["This event has no zone with this key."] },
};

export class VirtualScreen {
  readonly live: Live;
  private readonly screen: Screen;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private previewing = false;
  private readonly now: () => number;
  private readonly statePath: string;

  constructor(private readonly env: VirtualEnv) {
    this.now = env.now ?? Date.now;
    const query = env.portrait ? "?orientation=portrait" : "";
    const base = `/api/screen/zones/${encodeURIComponent(env.zone)}`;
    this.statePath = `${base}/state${query}`;
    this.live = new Live({
      fetch: env.fetch,
      root: env.root,
      bundle: env.bundle,
      paths: { state: this.statePath, stream: `${base}/stream${query}`, heartbeat: false },
      // A deleted zone answers 404 from then on: say so, rather than retry with its old content.
      refuses: new Set([404]),
      reload: () => {
        env.reload();
      },
      now: this.now,
      random: env.random ?? Math.random,
      show: (state) => {
        this.draw(state);
      },
      settle: (answer) => {
        this.settle(answer);
      },
    });
    this.screen = new Screen({
      serverNow: () => this.live.heartbeat.serverNow(),
      offline: () => this.live.offline,
      reducedMotion: env.reducedMotion,
    });
  }

  async start(): Promise<void> {
    if (this.env.root.firstElementChild === null) {
      this.show({ title: "Connecting…", lines: ["Reading the zone's screens."] });
    }
    this.settle(await call(this.env.fetch, "GET", this.statePath));
  }

  /** A state posted by the framing page (same origin only): drawn as is, the live zone let go. */
  preview(event: MessageEvent, parent: unknown, origin: string): void {
    const data = event.data as { type?: unknown; state?: unknown } | null;
    if (event.source !== parent || event.origin !== origin) return;
    if (data?.type !== PREVIEW_MESSAGE || !isState(data.state)) return;
    this.previewing = true;
    clearTimeout(this.timer);
    this.live.stop();
    const stateMs = Date.parse(data.state.time);
    if (!Number.isNaN(stateMs)) this.live.heartbeat.offsetMs = stateMs - this.now();
    this.live.setTheme(data.state.theme);
    this.mount(this.screen.draw(data.state));
    this.screen.start();
  }

  private settle(answer: Answer): void {
    if (this.previewing) return;
    if (answer.status === 200 && isState(answer.body)) {
      this.failures = 0;
      this.live.play(answer.body);
      this.draw(answer.body);
      return;
    }
    this.live.stop();
    this.screen.stop();
    const known = ANSWERS[answer.status];
    if (known !== undefined) {
      this.show(known);
      return;
    }
    this.failures += 1;
    const ms = backoffMs(this.failures, 2000, this.env.random ?? Math.random);
    this.show({
      title: "Connecting…",
      lines: ["The event's server does not answer yet."],
      foot: `Trying again in ${Math.ceil(ms / 1000)} s`,
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.start(), ms);
  }

  private draw(state: ScreenState): void {
    if (this.previewing) return;
    this.mount(this.screen.draw(state));
    this.screen.start();
  }

  private show(text: FrameText): void {
    this.mount(frame("unknown", { ...text, event: null }));
  }

  /** As the kiosk's: the screen keeps its layout between states, and the offline mark stays. */
  private mount(node: HTMLElement): void {
    if (this.env.root.firstElementChild === node) return;
    const keep = [...this.env.root.children].filter((c) => c.matches(".canccu-offline-mark"));
    this.env.root.replaceChildren(node, ...keep);
  }
}
