/**
 * Draws a zone's composed state (plan #109, D2 and S5–S7, S11): the layout's grid letterboxed to
 * its aspect, each region in its cells, its claim or else the widget its rotation shows now or its
 * idle choice, and the screen's motion and burn-in drift. The DOM is kept between states, so a push changes only
 * what it changed and a fade in progress is never cut short by an unrelated update.
 */
import { claimEnd, claimOf, claimShown } from "./claims.js";
import type { ClaimState } from "./claims.js";
import { driftAt, effectiveMotion, FADE_MS } from "./display.js";
import type { Motion } from "./display.js";
import { shownAt } from "./rotation.js";
import type { Layout, Region, ScreenState } from "./state.js";
import { drawWidget, fillCountdowns, liveView } from "./widget.js";
import type { View } from "./widget.js";

export interface ScreenHost {
  /** This device's clock corrected to the server's. */
  serverNow(): number;
  reducedMotion(): boolean;
}

/** How long a widget may wait for its images before it fades in anyway. */
export const READY_MS = 2000;

/** What a region shows: `key` names the thing, so a new key fades and the same key updates. */
interface Shown {
  key: string;
  type: string;
  template: string | null;
  view: View;
}

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
}

const grid = (n: number): string => `repeat(${String(n)}, minmax(0, 1fr))`;

/** `16:9` → 16/9; anything else the built-in shape. */
function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w !== undefined && h !== undefined && w > 0 && h > 0 ? w / h : 16 / 9;
}

const layoutKey = (l: Layout): string =>
  JSON.stringify([l.id, l.aspect, l.grid.columns, l.grid.rows]);

export class Screen {
  root: HTMLElement = document.createElement("main");
  private layoutKey = "";
  private regions = new Map<string, Drawn>();
  private state: ScreenState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

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
      drawn = { el, shown: null, json: "", slot: null, state: r, claim: null, next: null };
      this.regions.set(r.id, drawn);
      this.root.append(el);
    }
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
    const motion = effectiveMotion(state.display?.motion, this.host.reducedMotion());
    this.root.dataset.motion = motion;
    // A takeover hides every region but itself and the overlay (screen.css), until it ends here.
    const full = claimOf(state.regions.find((r) => r.role === "full")?.claim);
    const takeover = full !== null && !full.hidden && claimShown(full, now) !== null;
    if (takeover) this.root.dataset.takeover = "";
    else delete this.root.dataset.takeover;
    for (const drawn of this.regions.values())
      this.show(drawn, this.choose(drawn, state, now, takeover), motion);
    fillCountdowns(this.root, now);
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
  private choose(
    drawn: Drawn,
    state: ScreenState,
    now: number,
    takeover: boolean,
  ): Shown | "collapse" | null {
    const r = drawn.state;
    const zone = state.zone?.key ?? "";
    const claim = claimOf(r.claim);
    const shown = claim === null ? null : claimShown(claim, now);
    if (claim !== null && shown !== null) {
      if (!claim.hidden || !takeover) {
        drawn.claim = claim;
        drawn.next = null;
        return { ...shown, template: null };
      }
    } else if (drawn.claim !== null) {
      // The claim ended here, or a state dropped it: `next` skips the rest of the widget the
      // rotation would show at its end (contracts/screen.md, `on_end`).
      if (drawn.claim.on_end === "next") {
        const at = Math.min(claimEnd(drawn.claim) ?? now, now);
        const { until } = shownAt(r, zone, at);
        drawn.next = { index: shownAt(r, zone, until).index, until };
      }
    }
    if (claim?.override_id !== drawn.claim?.override_id || shown === null) drawn.claim = null;
    if (drawn.next !== null && now >= drawn.next.until) drawn.next = null;
    const { index } = drawn.next ?? shownAt(r, zone, now);
    const w = index === null ? undefined : r.widgets[index];
    if (w !== undefined) {
      const view = liveView(w.widget, w.view, now, state.tenant.time_zone);
      // A ticker's new text is a new thing to show, so it fades in (the calm fading line, L13).
      const text = w.widget === "ticker" ? JSON.stringify(view.text) : "";
      return {
        key: `${String(index)}:${text}`,
        type: w.widget,
        template: w.template ?? null,
        view,
      };
    }
    if (r.idle === "blank") return null;
    if (r.idle === "collapse") return "collapse";
    if (r.idle === "next" && r.idle_view !== null) {
      return { key: "idle:next", type: "countdown", template: null, view: r.idle_view.view };
    }
    // `logo`, and any idle value this player does not know (contracts/screen.md, The Pulse options).
    const view = { url: state.theme.logo_url, name: state.tenant.name, qr: null, empty: false };
    return { key: "idle:logo", type: "logo", template: null, view: { ...view, stale: false } };
  }

  private show(drawn: Drawn, shown: Shown | "collapse" | null, motion: Motion): void {
    drawn.el.hidden = shown === "collapse";
    const next = shown === "collapse" ? null : shown;
    const templates = this.state?.theme.templates;
    const json =
      next === null ? "" : JSON.stringify([next.type, next.template, next.view, templates]);
    if (next?.key === drawn.shown?.key && json === drawn.json) return;
    const sameThing = next !== null && next.key === drawn.shown?.key && drawn.slot !== null;
    drawn.shown = next;
    drawn.json = json;
    if (sameThing) {
      // New data for what is already shown: redraw it in place, with no fade.
      const fresh = drawWidget(next.type, next.template, next.view, templates);
      drawn.slot?.replaceChildren(...fresh.childNodes);
      // Keep a fade that is still waiting for its images (`canccu-slot--in`), or it pops in.
      if (drawn.slot !== null) {
        const fading = drawn.slot.classList.contains("canccu-slot--in");
        drawn.slot.className = `${fresh.className} canccu-is-active`;
        if (fading) drawn.slot.classList.add("canccu-slot--in");
      }
      return;
    }
    const incoming =
      next === null ? null : drawWidget(next.type, next.template, next.view, templates);
    incoming?.classList.add("canccu-is-active");
    drawn.slot = incoming;
    this.enter(drawn, incoming, motion);
  }

  /**
   * Two slots, load then fade (plan S7, ported from the legacy scene transition): the incoming
   * widget waits, unseen, for its images, then fades in over the outgoing one, which leaves once
   * the fade is done. Without motion they swap at once.
   */
  private enter(drawn: Drawn, incoming: HTMLElement | null, motion: Motion): void {
    const region = drawn.el;
    if (motion === "none" || incoming === null) {
      region.replaceChildren(...(incoming === null ? [] : [incoming]));
      return;
    }
    incoming.classList.add("canccu-slot--in");
    region.append(incoming);
    // `decode` settles once the image can be drawn, or fails; either way the wait is over.
    const images = [...incoming.querySelectorAll("img")].map((img) =>
      img.decode().catch(() => undefined),
    );
    const ready = Promise.race([
      Promise.all(images),
      new Promise((resolve) => setTimeout(resolve, READY_MS)),
    ]);
    void ready.then(() => {
      // A later change took the region meanwhile: it fades from what is on screen, not this.
      if (drawn.slot !== incoming) return;
      incoming.getBoundingClientRect(); // Lay out the invisible start, so the fade runs from it.
      incoming.classList.remove("canccu-slot--in");
      for (const old of [...region.children]) {
        if (old === incoming || !(old instanceof HTMLElement)) continue;
        old.classList.remove("canccu-is-active");
        old.classList.add("canccu-slot--out");
        setTimeout(() => {
          old.remove();
        }, FADE_MS[motion]);
      }
    });
  }
}
