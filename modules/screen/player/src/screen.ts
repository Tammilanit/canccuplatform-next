/**
 * Draws a zone's composed state (plan #109, D2 and S5–S7, S11): the layout's grid letterboxed to
 * its aspect, each region in its cells, its claim or else the widget its rotation shows now or its
 * idle choice, and the screen's motion and burn-in drift. The DOM is kept between states, so a push changes only
 * what it changed and a fade in progress is never cut short by an unrelated update.
 */
import { animateAnnouncements } from "./announce-motion.js";
import { claimEnd, claimOf, claimShown } from "./claims.js";
import { applyCue } from "./cues.js";
import type { ClaimState } from "./claims.js";
import { driftAt, FADE_MS } from "./display.js";
import type { Motion } from "./display.js";
import { legacyMotion, motionStyleOf } from "@canccu/ui";
import { MotionLayer, levelOf } from "./motion.js";
import { SceneLayer } from "./scene.js";
import { StageLayer } from "./stage.js";
import type { BackdropView } from "./stage.js";
import { idleOf } from "./idle.js";
import type { Shown } from "./idle.js";
import { Choreographer, paced } from "./pacing.js";
import { lowerThirdAt, syncLowerThird } from "./lower-third.js";
import { syncMarks } from "./rotation-marks.js";
import { shownAt } from "./rotation.js";
import { fitTickers, speedOf } from "./ticker.js";
import { fitAnnouncements } from "./fit.js";
import type { Layout, Region, ScreenState } from "./state.js";
import { whenReady } from "./media.js";
import { heldShown, joinedShown, turnIndexOf, turnShown } from "./turns.js";
import type { Choice } from "./turns.js";
import { drawWidget, fillCountdowns, liveView } from "./widget.js";

export interface ScreenHost {
  /** This device's clock corrected to the server's. */
  serverNow(): number;
  reducedMotion(): boolean;
  /** The page marked itself offline (`canccu-is-offline`): server-kept widgets dim. */
  offline?(): boolean;
}

/** How long a widget may wait for its images, video or page before it fades in anyway. */
export const READY_MS = 2000;

interface Drawn {
  el: HTMLElement;
  shown: Shown | null;
  json: string;
  slot: HTMLElement | null;
  state: Region;
  /** The claim the region showed last, to see it end. */
  claim: ClaimState | null;
  /** After a claim with `on_end: next`: the widget shown instead of the rotation's, until when. */
  next: { index: number | null; until: number } | null;
  /** The hero's rotation marks while it rotates (mockup 02): a bar and a dot per widget. */
  marks: HTMLElement | null;
}

const grid = (n: number): string => `repeat(${String(n)}, minmax(0, 1fr))`;

/** `16:9` → 16/9; anything else the built-in shape. */
function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w !== undefined && h !== undefined && w > 0 && h > 0 ? w / h : 16 / 9;
}

const layoutKey = (l: Layout): string =>
  JSON.stringify([l.id, l.aspect, l.grid.columns, l.grid.rows]);

/** What `shownAt` reads of a region, not the widgets' data, which every push may renew. */
const rotationKey = (r: Region): string =>
  JSON.stringify([r.rotation, r.order, r.widgets.map((w) => w.dwell_seconds)]);

/**
 * A storyboard's step hands over to the next by leaving first, then the next fades in: crossfaded,
 * two steps' text lay over each other ("Midnight!" through "Night 2 at …", S2, #625). A claim's
 * step key is `claim:<id>:<n>` (claims.ts).
 */
const isStep = (key: string | undefined): boolean =>
  key?.startsWith("claim:") === true && key.split(":").length === 3;
const outFirst = (from: string | undefined, to: string | undefined): boolean =>
  (isStep(from) && to?.startsWith("claim:") === true) ||
  (isStep(to) && from?.startsWith("claim:") === true);

export class Screen {
  root: HTMLElement = document.createElement("main");
  private layoutKey = "";
  private regions = new Map<string, Drawn>();
  private state: ScreenState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The level, pack and effects live on `<body>` (contracts/theming.md, Classes). */
  private readonly motion = new MotionLayer(document.body);
  private readonly stage = new StageLayer(document.body);
  private readonly scene = new SceneLayer(document.body);
  private readonly pace = new Choreographer();

  constructor(private readonly host: ScreenHost) {}

  /** Draw a state; the same layout keeps its elements, another starts over. */
  draw(state: ScreenState): HTMLElement {
    this.state = state;
    const layout = state.layout ?? { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } };
    if (layoutKey(layout) !== this.layoutKey) {
      this.layoutKey = layoutKey(layout);
      this.regions.clear();
      this.root = document.createElement("main");
      this.root.className = `canccu-layout canccu-layout--${layout.id}`;
      this.root.style.setProperty("--canccu-layout-ratio", String(ratioOf(layout.aspect)));
      // canccu-grid: fixed screen — from the theme's layout (contracts/theme.schema.json)
      this.root.style.setProperty("grid-template-columns", grid(layout.grid.columns));
      this.root.style.setProperty("grid-template-rows", grid(layout.grid.rows));
    }
    const appearance = (state.ticker as { appearance?: unknown } | null)?.appearance;
    if (typeof appearance === "string") this.root.dataset.ticker = appearance;
    else delete this.root.dataset.ticker;
    const ids = new Set(state.regions.map((r) => r.id));
    for (const [id, drawn] of this.regions) {
      if (!ids.has(id)) {
        drawn.el.remove();
        this.regions.delete(id);
      }
    }
    for (const r of state.regions) this.place(r);
    this.tick();
    return this.root;
  }

  /** Run the screen's clock: every whole second of server time, so rotations change on time. */
  start(): void {
    if (this.timer !== undefined) return;
    const next = (): void => {
      this.timer = setTimeout(
        () => {
          // A tick that throws (a malformed theme tree) must not stop the screen's clock for good.
          try {
            this.tick();
          } finally {
            next();
          }
        },
        1000 - (((this.host.serverNow() % 1000) + 1000) % 1000),
      );
    };
    next();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private place(r: Region): void {
    let drawn = this.regions.get(r.id);
    if (drawn === undefined) {
      const el = document.createElement("section");
      el.className = `canccu-region canccu-region--${r.id}`;
      drawn = {
        el,
        shown: null,
        json: "",
        slot: null,
        state: r,
        claim: null,
        next: null,
        marks: null,
      };
      this.regions.set(r.id, drawn);
      this.root.append(el);
    }
    // A skip worked out on the old rotation means nothing on a new one.
    if (rotationKey(r) !== rotationKey(drawn.state)) drawn.next = null;
    drawn.state = r;
    const { el } = drawn;
    if (r.role === null) delete el.dataset.role;
    else el.dataset.role = r.role;
    const a = r.area;
    el.style.setProperty(
      "grid-area",
      `${String(a.row)} / ${String(a.column)} / span ${String(a.rows)} / span ${String(a.columns)}`,
    );
    el.style.setProperty("z-index", String(r.layer));
  }

  /** Bring every region, the clock, the countdowns, motion and drift up to the server's now. */
  tick(): void {
    const state = this.state;
    if (state === null) return;
    const now = this.host.serverNow();
    const level = levelOf(state.display, this.host.reducedMotion());
    const motion = legacyMotion(level);
    this.root.dataset.motion = motion;
    // A takeover hides every region but itself and the overlay (screen.css), until it ends here.
    const full = claimOf(state.regions.find((r) => r.role === "full")?.claim);
    const takeover = full !== null && !full.hidden && claimShown(full, now) !== null;
    if (takeover) this.root.dataset.takeover = full.keep_ticker === true ? "ticker" : "";
    else delete this.root.dataset.takeover;
    const drawns = [...this.regions.values()];
    const regions = drawns.map((d) => d.state);
    const chosen = drawns.map((drawn) => this.choose(drawn, state, now, takeover));
    // What each box would show were its change let through, for the choreographer to pace.
    const wanted = joinedShown(regions, chosen, state, now);
    const released = this.pace.release(
      drawns.flatMap((d, i) => (paced(d.shown, wanted[i]) ? [d.state.id] : [])),
      now,
    );
    // A change the choreographer holds back keeps the box on its turn, with that turn's fresh
    // view; the hero and the rail are then joined on what the boxes show, so an item the hero
    // shows is never on the rail as well, nor off both.
    const held = drawns.map((d, i) =>
      d.shown !== null && paced(d.shown, wanted[i]) && released !== d.state.id
        ? heldShown(d.state, d.shown, state, now)
        : undefined,
    );
    const shown = held.every((h) => h === undefined)
      ? wanted
      : joinedShown(
          regions,
          chosen.map((c, i) => (held[i] === undefined ? c : (held[i] ?? null))),
          state,
          now,
        );
    for (const [i, drawn] of drawns.entries()) {
      const next = shown[i] ?? null;
      this.show(drawn, next, motion);
      // A step's own cue picture wins over the claim's, from the step's start (#114).
      applyCue(drawn.el, (typeof next === "object" ? next?.cue : undefined) ?? drawn.claim, now);
      const zone = state.zone?.key ?? "";
      const turn = turnIndexOf(next);
      drawn.marks = syncMarks(drawn.marks, drawn.el, drawn.state, turn, zone, now);
      if (drawn.state.role === "hero")
        syncLowerThird(drawn.el, takeover ? null : lowerThirdAt(drawn.state, state, now, turn));
    }
    fillCountdowns(this.root, now);
    this.motion.apply(this.root, level, motionStyleOf(state.display?.motion_style), now);
    this.stage.apply(
      state.display?.stage,
      level,
      now,
      state.theme.backdrop as BackdropView | undefined,
    );
    this.scene.apply(state.display?.scene);
    fitTickers(this.root, motion, now, speedOf(state.ticker));
    fitAnnouncements(this.root);
    animateAnnouncements(this.root, now, level);
    if (state.display?.drift === true) {
      const { x, y } = driftAt(now);
      this.root.style.setProperty("--canccu-drift-x", String(x));
      this.root.style.setProperty("--canccu-drift-y", String(y));
    } else {
      this.root.style.removeProperty("--canccu-drift-x");
      this.root.style.removeProperty("--canccu-drift-y");
    }
  }

  /**
   * The region's claim, else the rotation's widget now, else the region's idle choice; null draws
   * nothing. A `hidden` claim waits while the takeover above it runs, and shows once it ends.
   */
  private choose(drawn: Drawn, state: ScreenState, now: number, takeover: boolean): Choice {
    const r = drawn.state;
    const zone = state.zone?.key ?? "";
    const claim = claimOf(r.claim);
    const shown = claim === null ? null : claimShown(claim, now);
    if (claim !== null && shown !== null) {
      if (!claim.hidden || !takeover) {
        drawn.claim = claim;
        drawn.next = null;
        const view = liveView(shown.type, shown.view, now, state.tenant.time_zone);
        return { ...shown, view, template: null, dims: false };
      }
    } else if (drawn.claim !== null) {
      // The claim ended here, or a state dropped it: `next` skips the rest of the widget the
      // rotation would show at its end (contracts/screen.md, `on_end`).
      if (drawn.claim.on_end === "next") {
        const at = Math.min(claimEnd(drawn.claim) ?? now, now);
        // With nothing rotating there is nothing to skip; an endless `next` would hold the idle
        // choice even after widgets arrive.
        const { index: cur, until } = shownAt(r, zone, at);
        if (cur !== null && Number.isFinite(until))
          drawn.next = { index: shownAt(r, zone, until).index, until };
      }
    }
    if (claim?.override_id !== drawn.claim?.override_id || shown === null) drawn.claim = null;
    if (drawn.next !== null && now >= drawn.next.until) drawn.next = null;
    const { index } = drawn.next ?? shownAt(r, zone, now);
    return (index === null ? undefined : turnShown(r, index, state, now)) ?? idleOf(r, state);
  }

  private show(drawn: Drawn, shown: Choice, motion: Motion): void {
    this.redraw(drawn, shown, motion);
    const s = drawn.shown;
    const offline = this.host.offline?.() ?? false;
    drawn.slot?.classList.toggle(
      "canccu-is-stale",
      s !== null && (s.view.stale === true || (offline && s.dims)),
    );
  }

  /** Draws what the region shows now: a new thing fades in, new data for the same redraws it. */
  private redraw(drawn: Drawn, shown: Choice, motion: Motion): void {
    drawn.el.hidden = shown === "collapse";
    const next = shown === "collapse" ? null : shown;
    const templates = this.state?.theme.templates;
    const media = {
      sound: (this.state?.sound as { enabled?: unknown } | undefined)?.enabled === true,
      nowMs: this.host.serverNow(),
      reducedMotion: this.host.reducedMotion(),
    };
    // The media options belong in the comparison: when the zone's sound moves to another device,
    // a playing video or YouTube frame must be redrawn muted here (only one device sounds).
    const json =
      next === null
        ? ""
        : JSON.stringify([
            next.type,
            next.template,
            next.view,
            templates,
            media.sound,
            media.reducedMotion,
          ]);
    if (next?.key === drawn.shown?.key && json === drawn.json) return;
    const prior = drawn.shown?.key;
    const sameThing = next !== null && next.key === drawn.shown?.key && drawn.slot !== null;
    drawn.shown = next;
    drawn.json = json;
    if (sameThing) {
      // New data for what is already shown: redraw it in place, with no fade.
      const fresh = this.widgetOf(next, templates, media);
      drawn.slot?.replaceChildren(...fresh.childNodes);
      // Keep a fade that is still waiting for its images (`canccu-slot--in`), or it pops in.
      if (drawn.slot !== null) {
        const fading = drawn.slot.classList.contains("canccu-slot--in");
        drawn.slot.className = `${fresh.className} canccu-is-active`;
        if (fading) drawn.slot.classList.add("canccu-slot--in");
      }
      return;
    }
    const before = drawn.slot === null ? undefined : prior;
    const incoming = next === null ? null : this.widgetOf(next, templates, media);
    incoming?.classList.add("canccu-is-active");
    drawn.slot = incoming;
    this.enter(drawn, incoming, motion, outFirst(before, next?.key));
  }

  /** A widget as drawn; one a claim brings is marked, so the look can frame it (mockup 04). */
  private widgetOf(
    shown: Shown,
    templates: unknown,
    media: Parameters<typeof drawWidget>[4],
  ): HTMLElement {
    const el = drawWidget(shown.type, shown.template, shown.view, templates, {
      ...(media ?? { sound: false, nowMs: Date.now() }),
      claimId: shown.key.startsWith("claim:") ? shown.key.slice(6).split(":")[0] : undefined,
      zone: this.state?.zone?.key ?? "",
    });
    if (shown.key.startsWith("claim:")) el.classList.add("canccu-is-claim");
    if (shown.transition !== undefined) el.classList.add(`canccu-step--${shown.transition}`);
    return el;
  }

  /**
   * Two slots, load then fade (plan S7, ported from the legacy scene transition): the incoming
   * widget waits, unseen, for its images, then fades in over the outgoing one, which leaves once
   * the fade is done; at `none` too, by opacity alone (#787 D5). Only an emptied box swaps at once.
   */
  private enter(drawn: Drawn, incoming: HTMLElement | null, motion: Motion, cut = false): void {
    const region = drawn.el;
    if (incoming === null) {
      region.replaceChildren();
      if (drawn.marks !== null) region.append(drawn.marks);
      return;
    }
    incoming.classList.add("canccu-slot--in");
    region.append(incoming);
    // Images, a video's first frame, a frame's page: each settles once it can be drawn or fails.
    const media = [...incoming.querySelectorAll("img, video, iframe")].map(whenReady);
    const ready = Promise.race([
      Promise.all(media),
      new Promise((resolve) => setTimeout(resolve, READY_MS)),
    ]);
    void ready.then(() => {
      // A later change took the region meanwhile: it fades from what is on screen, not this.
      if (drawn.slot !== incoming) return;
      incoming.getBoundingClientRect(); // Lay out the invisible start, so the fade runs from it.
      incoming.classList.remove("canccu-slot--in");
      for (const old of [...region.children]) {
        // Only widgets leave: the marks and the slideshow's band (lower-third.ts) are the box's.
        if (old === incoming || !(old instanceof HTMLElement)) continue;
        if (!old.classList.contains("canccu-widget")) continue;
        if (cut) {
          old.remove();
          continue;
        }
        old.classList.remove("canccu-is-active");
        old.classList.add("canccu-slot--out");
        setTimeout(() => {
          old.remove();
        }, FADE_MS[motion]);
      }
    });
  }
}
