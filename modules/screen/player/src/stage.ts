/**
 * The stage behind a screen's boxes (contracts/theming.md, The two backgrounds; contracts/screen.md,
 * The stage): one `canccu-stage` element, the first child of `<body>`, with its layers, the look cycle at the bottom (#787 D10). The
 * server says what it shows; this keeps it current every tick, so a box's tint ends at its `until`
 * on the screen's own clock, also offline. What each layer looks like is stage.css's.
 */
import type { Level } from "./motion.js";
import { daypartAt, lookAt } from "./stage-look.js";

export interface StageView {
  phase?: unknown;
  kind?: unknown;
  tint?: {
    until?: unknown;
    art?: { url?: unknown; scrim?: unknown } | null;
  } | null;
  /** The current game's blurred art (#787 D10); absent from a server that predates it. */
  game?: { url?: unknown; scrim?: unknown } | null;
}

/** What the living stage reads besides the server's stage (#787 D10, D12): whose cycle, when, how loud. */
export interface StageLife {
  zone: string;
  timeZone: string;
  /** `display.hype`, or null from a Moments or a server that predates it. */
  hype: { level?: unknown; phase?: unknown } | null;
}

/** The theme's own picture and video, as theming answers them (`ScreenState.theme.backdrop`). */
export interface BackdropView {
  image_url?: unknown;
  video_url?: unknown;
  scrim?: unknown;
  [field: string]: unknown;
}

// The look first, under all (#787 D10): every look, particles too, draws behind the boxes.
const LAYERS = [
  "look",
  "backdrop",
  "glow",
  "daylight",
  "game",
  "art",
  "kind",
  "phase",
  "tint",
  "scrim",
] as const;
/** The looks drawn in the look layer; `glows` is the stage's own glow layer, as before #787. */
const LOOK_PARTS = ["gradient", "particles", "waves"] as const;
/** The Theme studio's posted scene chip (theming's plan issue-784 D21), as a hype. */
const POSTED_HYPE: Record<string, number> = { quiet: 0.1, building: 0.6, live: 1 };
const HYPE_PHASES = new Set(["quiet", "building", "live", "after"]);
/** A picture the theme serves: a revision's file, or the draft's under its preview key. */
const PICTURE_URL =
  /^\/theming\/(a|preview\/[A-Za-z0-9_-]{1,128})\/[0-9a-f]{64}\.(png|jpg|webp|svg)$/;

/** A video the theme serves (plan issue-784 D19), as PICTURE_URL. */
const VIDEO_URL = /^\/theming\/(a|preview\/[A-Za-z0-9_-]{1,128})\/[0-9a-f]{64}\.(mp4|webm)$/;

/**
 * The theme's video over its picture, or null. Only at lively and party: at calm (quiet hours
 * included) and at none, which the device's reduced motion makes the level, the picture shows
 * alone, as the poster it is.
 */
export function videoOf(backdrop: BackdropView | undefined, level: Level): string | null {
  const url = backdrop?.video_url;
  if (level !== "lively" && level !== "party") return null;
  if (typeof url !== "string" || !VIDEO_URL.test(url) || pictureOf(backdrop) === null) return null;
  return url;
}

/** The theme's own picture and its scrim (0.55–1), or null: it replaces the background's cycle. */
export function pictureOf(
  backdrop: BackdropView | undefined,
): { url: string; scrim: number } | null {
  const url = backdrop?.image_url;
  const scrim = backdrop?.scrim;
  if (typeof url !== "string" || !PICTURE_URL.test(url) || typeof scrim !== "number") return null;
  return { url, scrim: Math.min(1, Math.max(0.55, scrim)) };
}
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

function setImage(layer: HTMLElement, url: string): void {
  const image = `url("${url}")`;
  if (layer.style.backgroundImage !== image) layer.style.backgroundImage = image;
}

/**
 * The video in `layer`: started once and kept playing while its address stays, so a tick never
 * restarts it; taken out (and so stopped) when the level drops or the theme drops it.
 */
function setVideo(layer: HTMLElement, url: string | null, poster: string | undefined): void {
  const playing = layer.querySelector("video");
  if (playing !== null && playing.getAttribute("src") === url) return;
  playing?.remove();
  if (url === null) return;
  const video = layer.ownerDocument.createElement("video");
  video.className = "canccu-stage__video";
  // Muted before src: browsers only autoplay a muted video, and a screen has no one to click play.
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  if (poster !== undefined) video.setAttribute("poster", poster);
  video.setAttribute("src", url);
  layer.append(video);
}

/** The zone, its time zone and its hype, as the composed state says them. */
export function lifeOf(state: {
  zone?: { key?: unknown } | null;
  tenant?: { time_zone?: unknown };
  display?: { hype?: StageLife["hype"] };
}): StageLife {
  const zone = state.zone?.key;
  const timeZone = state.tenant?.time_zone;
  return {
    zone: typeof zone === "string" ? zone : "",
    timeZone: typeof timeZone === "string" ? timeZone : "UTC",
    hype: state.display?.hype ?? null,
  };
}

/** The hype the stage draws: the Studio's posted chip over the zone's, null when the theme says not to. */
function hypeOf(
  life: StageLife,
  backdrop: BackdropView | undefined,
  posted: string | undefined,
): { level: number; phase: string } | null {
  if (backdrop?.hype === false) return null;
  if (posted !== undefined && posted in POSTED_HYPE)
    return { level: POSTED_HYPE[posted] ?? 0, phase: posted };
  const { level, phase } = life.hype ?? {};
  if (typeof level !== "number" || typeof phase !== "string" || !HYPE_PHASES.has(phase))
    return null;
  return { level: Math.min(1, Math.max(0, level)), phase };
}

/** The game's art while the hype builds or is live, where the theme lets it and has no own picture. */
function gameOf(
  stage: StageView | undefined,
  backdrop: BackdropView | undefined,
  hype: { phase: string } | null,
): { url: string; scrim: number } | null {
  const url = stage?.game?.url;
  const scrim = stage?.game?.scrim;
  if (backdrop?.game_art === false || pictureOf(backdrop) !== null) return null;
  if (hype?.phase !== "building" && hype?.phase !== "live") return null;
  if (typeof url !== "string" || !ART_URL.test(url) || typeof scrim !== "number") return null;
  return { url, scrim: Math.min(1, Math.max(0.55, scrim)) };
}

/** The particles' count: more the louder the hype, none at none (their look is left out then). */
const particlesOf = (level: Level, hype: number): number =>
  level === "none" ? 0 : 8 + Math.round(hype * 16);

/** Adds or removes only the difference, so the dots already rising keep their place. */
function setParticles(layer: HTMLElement, count: number): void {
  while (layer.childElementCount > count) layer.lastElementChild?.remove();
  for (let i = layer.childElementCount; i < count; i++) {
    const dot = layer.ownerDocument.createElement("i");
    dot.style.setProperty("--canccu-particle", String(i));
    // Spread across the width without a pattern the eye picks up: 41 and 97 share no factor.
    dot.style.setProperty("--canccu-particle-x", `${String(((i * 41) % 97) + 1)}%`);
    layer.append(dot);
  }
}

export class StageLayer {
  private el: HTMLElement | null = null;
  /** The stage's first draw: a screen that just loaded shows its look at once, not over 40 s. */
  private fresh = true;

  constructor(private readonly body: HTMLElement) {}

  apply(
    stage: StageView | undefined,
    level: Level,
    now: number,
    backdrop?: BackdropView,
    life: StageLife = { zone: "", timeZone: "UTC", hype: null },
  ): void {
    const el = this.element();
    if (this.fresh) el.style.setProperty("--canccu-look-fade", "0s");
    else el.style.removeProperty("--canccu-look-fade");
    this.fresh = false;
    const { classes, art } = stageLook(stage, level, now);
    const picture = pictureOf(backdrop);
    const video = videoOf(backdrop, level);
    // At every level: the picture is the theme's ground, as the glows are, not a moment's tint.
    if (picture !== null) classes.push("canccu-stage--backdrop");
    if (video !== null) classes.push("canccu-stage--video");
    // An own picture holds still, with no cycle; a theming that predates the looks has the glows.
    const looks = Array.isArray(backdrop?.looks) ? (backdrop.looks as string[]) : ["glows"];
    const look = picture === null ? lookAt(life.zone, looks, now, level) : null;
    if (look !== null) classes.push(`canccu-stage--look-${look.look}`);
    const posted = this.body.dataset;
    if (backdrop?.daylight !== false) {
      const part = posted.canccuDaypart ?? daypartAt(now, life.timeZone);
      if (KEY.test(part)) classes.push(`canccu-stage--daylight-${part}`);
    }
    const hype = hypeOf(life, backdrop, posted.canccuScene);
    if (hype !== null) classes.push(`canccu-stage--hype-${hype.phase}`);
    const game = gameOf(stage, backdrop, hype);
    if (game !== null) classes.push("canccu-stage--game");
    const name = classes.join(" ");
    if (el.className !== name) el.className = name;
    const layerOf = (part: string): HTMLElement =>
      el.querySelector(`.canccu-stage__${part}`) as HTMLElement;
    // The art stays drawn while it fades out (stage.css), so it only changes, never clears.
    if (art !== null) setImage(layerOf("art"), art.url);
    if (game !== null) setImage(layerOf("game"), game.url);
    if (picture !== null) setImage(layerOf("backdrop"), picture.url);
    setVideo(layerOf("backdrop"), video, picture?.url);
    if (hype === null) el.style.removeProperty("--canccu-hype");
    else el.style.setProperty("--canccu-hype", String(hype.level));
    const particles = layerOf("particles");
    // The dots stay through the 40 s the look fades out, or the fade would show an empty layer.
    const dotsShown = look?.look === "particles" || look?.from === "particles";
    setParticles(particles, dotsShown ? particlesOf(level, hype?.level ?? 0.5) : 0);
    // One scrim over them all: the larger one keeps the text readable on each.
    const scrims = [art?.scrim, picture?.scrim, game?.scrim].filter((v) => v !== undefined);
    if (scrims.length > 0)
      el.style.setProperty("--canccu-stage-scrim", String(Math.max(...scrims)));
  }

  private element(): HTMLElement {
    if (this.el?.isConnected === true) return this.el;
    const el = this.body.ownerDocument.createElement("div");
    el.className = "canccu-stage";
    el.setAttribute("aria-hidden", "true");
    for (const layer of LAYERS) {
      const part = this.body.ownerDocument.createElement("div");
      part.className = `canccu-stage__${layer}`;
      if (layer === "look") {
        for (const name of LOOK_PARTS) {
          const look = this.body.ownerDocument.createElement("div");
          look.className = `canccu-stage__${name}`;
          part.append(look);
        }
      }
      el.append(part);
    }
    this.body.prepend(el);
    this.el = el;
    return el;
  }
}
