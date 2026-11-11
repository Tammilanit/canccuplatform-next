/**
 * The player's own pages for every device state (docs/plans/issue-109.md, S8; mockup 05 of the
 * step 3 brief): never a blank screen, and each one says what the venue crew can do. Built with
 * createElement and textContent only, so no server text is ever parsed as markup. The platform's
 * mark appears on these pages and nowhere else on a screen (brief, L6).
 */
import { qrSvg } from "./qr.js";

export const PLATFORM_MARK = "Canccu";

export type FrameKind =
  "pairing" | "unassigned" | "refused" | "archived" | "moved" | "unknown" | "starting";

export interface FrameText {
  /** The event's name, when the page knows it. */
  event?: string | null | undefined;
  /** The device's name, when the server has told it. */
  device?: string | null | undefined;
  title: string;
  lines?: string[];
  /** The pairing code, shown large. */
  code?: string;
  /** The URL a phone opens by scanning, drawn as a QR next to the text. */
  qr?: { url: string; label: string };
  foot?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `K7Q4 9WXP`: two groups of four read better across a room. */
export function spacedCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

export function frame(kind: FrameKind, text: FrameText): HTMLElement {
  const root = el("main", `canccu-frame canccu-frame--${kind}`);
  root.dataset.frame = kind;
  const head = el("header", "canccu-frame__head");
  head.append(el("span", "canccu-frame__mark", PLATFORM_MARK));
  const where = [text.event, text.device].filter((s): s is string => !!s).join(" · ");
  if (where !== "") head.append(el("span", "canccu-frame__where", where));
  root.append(head);
  const body = el("section", "canccu-frame__body");
  body.append(el("h1", "canccu-frame__title", text.title));
  if (text.code !== undefined) body.append(el("p", "canccu-frame__code", spacedCode(text.code)));
  for (const line of text.lines ?? []) body.append(el("p", "canccu-frame__line", line));
  root.append(body);
  if (text.qr !== undefined) {
    const side = el("aside", "canccu-frame__qr");
    side.append(qrSvg(text.qr.url), el("p", "canccu-frame__line", text.qr.label));
    root.append(side);
  }
  const foot = el("footer", "canccu-frame__foot", text.foot ?? "");
  root.append(foot);
  return root;
}

/** Change a shown frame's footer in place (a countdown), without drawing the frame again. */
export function setFoot(root: HTMLElement, text: string): void {
  const foot = root.querySelector(".canccu-frame__foot");
  if (foot !== null) foot.textContent = text;
}

/** `HH:MM` in the event's time zone (the device's when unknown or invalid). */
export function clockText(ms: number, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(ms);
  }
}

/** `9:41`: what is left of a pairing code. */
export function minutesLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The small "offline since" mark; the page keeps drawing what it has under it. */
export function offlineMark(sinceText: string): HTMLElement {
  const mark = el("div", "canccu-offline-mark", `offline since ${sinceText}`);
  mark.setAttribute("role", "status");
  return mark;
}

/** The `identify` command: which screen is this? */
export function identifyCard(device: string, zone: string | null, bundle: string): HTMLElement {
  const card = el("div", "canccu-identify");
  card.append(
    el("p", "canccu-identify__name", device),
    el("p", "canccu-identify__zone", `zone: ${zone ?? "none"} · v${bundle}`),
    el("p", "canccu-identify__left", ""),
  );
  return card;
}
