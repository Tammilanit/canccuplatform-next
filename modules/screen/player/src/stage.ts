/**
 * The stage behind a screen's boxes (contracts/theming.md, The two backgrounds; contracts/screen.md,
 * The stage): one `canccu-stage` element, the first child of `<body>`, with its six layers. The
 * server says what it shows; this keeps it current every tick, so a box's tint ends at its `until`
 * on the screen's own clock, also offline. What each layer looks like is stage.css's.
 */
import type { Level } from "./motion.js";

export interface StageView {
  phase?: unknown;
  kind?: unknown;
  tint?: {
    until?: unknown;
    art?: { url?: unknown; scrim?: unknown } | null;
  } | null;
}

const LAYERS = ["art", "glow", "kind", "phase", "tint", "scrim"] as const;
/** What may follow `--kind-` and `--phase-` in a class: an agenda key is lowercase already. */
const KEY = /^[a-z][a-z0-9_-]{0,63}$/;
/** The server's art path, or a picture handed in as data (the demo shots). */
const ART_URL =
  /^(\/api\/screen\/art\/[a-f0-9]{64}\.webp|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)$/;

/** The classes the stage wears at `now` and the art it shows, or null. */
export function stageLook(
  stage: StageView | undefined,
  level: Level,
  now: number,
): { classes: string[]; art: { url: string; scrim: number } | null } {
  const classes = ["canccu-stage"];
  const kind = stage?.kind;
  if (typeof kind === "string" && KEY.test(kind)) classes.push(`canccu-stage--kind-${kind}`);
  const phase = stage?.phase;
  if (typeof phase === "string" && KEY.test(phase)) classes.push(`canccu-stage--phase-${phase}`);
  const tint = stage?.tint;
  const until = typeof tint?.until === "string" ? Date.parse(tint.until) : NaN;
  // Tints show only at lively and party; at none and calm only the glows (amendment 1).
  const tinted = (level === "lively" || level === "party") && now < until;
  if (!tinted) return { classes, art: null };
  classes.push("canccu-stage--tinted");
  const url = tint?.art?.url;
  const scrim = tint?.art?.scrim;
  if (typeof url !== "string" || !ART_URL.test(url) || typeof scrim !== "number") {
    return { classes, art: null };
  }
  classes.push("canccu-stage--art");
  return { classes, art: { url, scrim: Math.min(1, Math.max(0.55, scrim)) } };
}

/**
 * Puts `node` right after the stage (or first, before the stage exists) with the elements `keep`
 * matches after it. False when it is there already: mounting it again would restart its fades
 * and, later, its videos.
 */
export function mountBehindStage(
  root: HTMLElement,
  node: HTMLElement,
  keep: string,
  after: HTMLElement[] = [],
): boolean {
  const stage = [...root.children].filter((c) => c.matches(".canccu-stage"));
  if ((stage[0]?.nextElementSibling ?? root.firstElementChild) === node) return false;
  const kept = [...root.children].filter((c) => c.matches(keep));
  root.replaceChildren(...stage, node, ...kept, ...after);
  return true;
}

export class StageLayer {
  private el: HTMLElement | null = null;

  constructor(private readonly body: HTMLElement) {}

  apply(stage: StageView | undefined, level: Level, now: number): void {
    const el = this.element();
    const { classes, art } = stageLook(stage, level, now);
    const name = classes.join(" ");
    if (el.className !== name) el.className = name;
    const layer = el.firstElementChild as HTMLElement;
    // The art stays drawn while it fades out (stage.css), so it only changes, never clears.
    if (art !== null) {
      const image = `url("${art.url}")`;
      if (layer.style.backgroundImage !== image) layer.style.backgroundImage = image;
      el.style.setProperty("--canccu-stage-scrim", String(art.scrim));
    }
  }

  private element(): HTMLElement {
    if (this.el?.isConnected === true) return this.el;
    const el = this.body.ownerDocument.createElement("div");
    el.className = "canccu-stage";
    el.setAttribute("aria-hidden", "true");
    for (const layer of LAYERS) {
      const part = this.body.ownerDocument.createElement("div");
      part.className = `canccu-stage__${layer}`;
      el.append(part);
    }
    this.body.prepend(el);
    this.el = el;
    return el;
  }
}
