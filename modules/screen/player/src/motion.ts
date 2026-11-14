/**
 * The energy level and the motion vocabulary on a screen (contracts/screen.md, Motion and burn-in
 * drift; contracts/theming.md, Motion vocabulary): the level and pack as classes on `<body>`, a
 * number roll or split-flap where a value changed, a sweep (and at party a pop or tilt) on a box
 * whose content changed, and the countdown's spotlight in its last five minutes. The looks are CSS
 * (motion.css); this decides what plays when, so the one-spotlight and 10-second rules hold.
 */
import type { Motion } from "./display.js";

export type Level = "none" | "calm" | "lively" | "party";
const LEVELS: readonly Level[] = ["none", "calm", "lively", "party"];

export interface MotionStyle {
  speed: "slower" | "normal" | "faster";
  intensity: "subtle" | "normal" | "strong";
  spotlight: "glow_and_trace" | "glow" | "trace";
  pack: "standard" | "broadcast" | "arcade";
}
const STYLE: { [K in keyof MotionStyle]: readonly MotionStyle[K][] } = {
  speed: ["normal", "slower", "faster"],
  intensity: ["normal", "subtle", "strong"],
  spotlight: ["glow_and_trace", "glow", "trace"],
  pack: ["standard", "broadcast", "arcade"],
};

/** Each effect's length at `normal` speed (the contract's table); motion.css keeps the same. */
export const FX_MS = { roll: 700, flap: 600, sweep: 1100, pop: 450, tilt: 450, burst: 900 };
const SPEED = { slower: 1.4, normal: 1, faster: 0.75 } as const;
/** The countdown's spotlight holds from five minutes before its start until the start. */
export const SPOTLIGHT_LEAD_MS = 5 * 60_000;
/** A screen starts at most one spotlight every 10 seconds; another waits its turn. */
export const SPOTLIGHT_GAP_MS = 10_000;

/**
 * The level the screen draws: the device's reduced motion makes it `none`; a state from a server
 * that predates `motion_level` gives `moderate`, which stands for `lively`.
 */
export function levelOf(
  display: { motion_level?: unknown; motion?: unknown } | undefined,
  reducedMotion: boolean,
): Level {
  if (reducedMotion) return "none";
  const level = LEVELS.find((l) => l === display?.motion_level);
  if (level !== undefined) return level;
  const motion = display?.motion;
  return motion === "calm" || motion === "none" ? motion : "lively";
}

/** The region transitions and the ticker keep `display.motion`'s three ways (screen.css). */
export const transitionsOf = (level: Level): Motion =>
  level === "lively" || level === "party" ? "moderate" : level;

export function styleOf(given: unknown): MotionStyle {
  const g = (typeof given === "object" && given !== null ? given : {}) as Record<string, unknown>;
  const pick = <K extends keyof MotionStyle>(k: K): MotionStyle[K] =>
    STYLE[k].find((v) => v === g[k]) ?? STYLE[k][0] ?? ("normal" as MotionStyle[K]);
  return {
    speed: pick("speed"),
    intensity: pick("intensity"),
    spotlight: pick("spotlight"),
    pack: pick("pack"),
  };
}

const NUMBER = /^[+−-]?\d[\d\s.,]*%?$/;
const TIME = /^\d{1,2}[:.]\d{2}$/;
/** Widgets whose values move by themselves every second or minute: no effect for those. */
const LIVE = new Set(["clock", "ticker"]);

const isCountdown = (el: Element): boolean =>
  el.matches("time[data-canccu-countdown], .canccu-widget__bar, .canccu-widget__bar *");

/** The leaf elements of a box that carry its content, the running countdown left out. */
function leaves(box: Element): Element[] {
  return [...box.querySelectorAll("*")].filter(
    (el) => el.childElementCount === 0 && !isCountdown(el) && !el.closest(".canccu-fx-layer"),
  );
}

function typeOf(box: Element): string {
  const cls = [...box.classList].find((c) => c.startsWith("canccu-widget--"));
  return cls === undefined ? "" : cls.slice("canccu-widget--".length);
}

/** The running countdown's time in a box, if it starts within the lead. */
function countdownIn(box: Element, now: number): boolean {
  for (const el of box.querySelectorAll("time[data-canccu-countdown][datetime]")) {
    const left = Date.parse(el.getAttribute("datetime") ?? "") - now;
    if (left > 0 && left <= SPOTLIGHT_LEAD_MS) return true;
  }
  return false;
}

const SPOTLIGHT_PARTS = ["outline", "glow", "trace", "pop", "burst"] as const;

export class MotionLayer {
  private seen = new WeakMap<Element, string[]>();
  private lastSpotlight = Number.NEGATIVE_INFINITY;
  private pending: Element | null = null;
  private countdown: { box: Element; level: Level } | null = null;
  private partyTurn = 0;

  constructor(private readonly body: HTMLElement) {}

  /** Once per tick, after the regions are drawn and the countdowns filled. */
  apply(root: ParentNode, level: Level, style: MotionStyle, now: number): void {
    this.mark(level, style);
    // A box still waiting to fade in is not shown yet: its spotlight starts when it is.
    const boxes = [
      ...root.querySelectorAll(
        ".canccu-region > .canccu-widget.canccu-is-active:not(.canccu-slot--in)",
      ),
    ];
    for (const box of boxes) this.changes(box, level, style);
    this.spotlightCountdown(boxes, level, style, now);
    this.sweep(level, style, now);
  }

  private mark(level: Level, style: MotionStyle): void {
    const want = [`canccu-motion--${level}`, `canccu-motion-pack--${style.pack}`];
    for (const cls of [...this.body.classList]) {
      if (cls.startsWith("canccu-motion") && !want.includes(cls)) this.body.classList.remove(cls);
    }
    this.body.classList.add(...want);
  }

  /** A box drawn again with new data: rolls and flaps on the changed values, a sweep queued. */
  private changes(box: Element, level: Level, style: MotionStyle): void {
    const now = leaves(box);
    const texts = now.map((el) => el.textContent.trim());
    const before = this.seen.get(box);
    this.seen.set(box, texts);
    if (before === undefined || level === "none" || LIVE.has(typeOf(box))) return;
    if (before.join("\u0000") === texts.join("\u0000")) return;
    if (before.length === texts.length) {
      for (const [i, text] of texts.entries()) {
        if (text === before[i]) continue;
        const kind = TIME.test(text) ? "flap" : NUMBER.test(text) ? "roll" : null;
        const el = now[i];
        if (kind !== null && el !== undefined) this.play(el, [kind], FX_MS[kind], style);
      }
    }
    if (level === "lively" || level === "party") this.pending = box;
  }

  /** The queued sweep, once no spotlight holds and the last one started 10 seconds ago. */
  private sweep(level: Level, style: MotionStyle, now: number): void {
    const box = this.pending;
    if (box === null) return;
    if (!box.isConnected || (level !== "lively" && level !== "party")) {
      this.pending = null;
      return;
    }
    if (this.countdown !== null || now - this.lastSpotlight < SPOTLIGHT_GAP_MS) return;
    this.pending = null;
    this.lastSpotlight = now;
    this.layer(box, "sweep", FX_MS.sweep, style);
    if (level === "party") {
      // A small move of the whole box after the sweep, pop and tilt in turn.
      const move = this.partyTurn++ % 2 === 0 ? "pop" : "tilt";
      this.play(box, [move], FX_MS.sweep + FX_MS[move], style);
    }
  }

  private spotlightCountdown(
    boxes: Element[],
    level: Level,
    style: MotionStyle,
    now: number,
  ): void {
    const held = this.countdown;
    const box = boxes.find((b) => countdownIn(b, now)) ?? null;
    if (held !== null && held.box !== box) {
      held.box.classList.remove("canccu-spotlight", ...SPOTLIGHT_PARTS.map(part));
      this.countdown = null;
    }
    if (box === null) return;
    if (this.countdown === null) {
      if (now - this.lastSpotlight < SPOTLIGHT_GAP_MS) return;
      this.lastSpotlight = now;
    } else if (this.countdown.level === level && box.classList.contains("canccu-spotlight")) {
      // An in-place redraw (screen.ts) resets the box's classes: then the parts go on again.
      return;
    }
    const parts = spotlightParts(level, style);
    box.classList.remove(...SPOTLIGHT_PARTS.map(part));
    box.classList.add("canccu-spotlight", ...parts.map(part));
    // The ring burst at the 5-minute mark is a layer of its own, gone once played.
    if (parts.includes("burst") && this.countdown === null) {
      this.layer(box, "burst", FX_MS.burst, style);
    }
    this.countdown = { box, level };
  }

  private play(el: Element, kinds: string[], ms: number, style: MotionStyle): void {
    const classes = ["canccu-fx", ...kinds.map((k) => `canccu-fx--${k}`)];
    el.classList.remove(...classes);
    el.classList.add(...classes);
    setTimeout(() => {
      el.classList.remove(...classes);
    }, ms * SPEED[style.speed]);
  }

  private layer(box: Element, kind: string, ms: number, style: MotionStyle): void {
    const span = box.ownerDocument.createElement("span");
    span.className = `canccu-fx-layer canccu-fx-layer--${kind}`;
    span.setAttribute("aria-hidden", "true");
    box.append(span);
    setTimeout(() => {
      span.remove();
    }, ms * SPEED[style.speed]);
  }
}

const part = (p: string): string => `canccu-spotlight--${p}`;

/** What the countdown's spotlight draws at a level: a steady outline at none and calm. */
export function spotlightParts(level: Level, style: MotionStyle): string[] {
  if (level === "none" || level === "calm") return ["outline"];
  const shown =
    style.spotlight === "glow_and_trace" ? ["glow", "trace"] : [style.spotlight as string];
  return level === "party" ? [...shown, "pop", "burst"] : shown;
}
