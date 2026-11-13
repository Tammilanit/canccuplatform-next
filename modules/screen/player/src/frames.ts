/**
 * The player's own pages for every device state (docs/plans/issue-109.md, S8; mockup 05 of the
 * step 3 brief, redrawn as one family with the Pulse on sheet 9 of docs/design, #385): never a
 * blank screen, each with the Pulse's header and saying what the venue crew can do. Built with
 * createElement and textContent only, so no server text is ever parsed as markup. The platform's
 * mark appears on these pages and nowhere else on a screen (brief, L6): where the event is unknown.
 */

export const PLATFORM_MARK = "Canccu";

export type FrameKind = "pairing" | "unassigned" | "refused" | "archived" | "moved" | "unknown";

export interface FrameText {
  /** The event's name, when the page knows it. */
  event?: string | null | undefined;
  /** The theme's logo, once a state has brought one. */
  logo?: string | null | undefined;
  /** Where in the event: the device's name, or what the screen is doing. */
  where?: string | null | undefined;
  kicker?: string;
  title: string;
  /** The first is the frame's lead line; the rest are help for the crew, smaller. */
  lines?: string[];
  foot?: string;
}

/** An element with its class and text: never markup, so no server text is parsed. */
export function el<K extends keyof HTMLElementTagNameMap>(
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

/** The Pulse's header (mockup 02): logo, event and where on the left, date and clock on the right. */
export function frameHead(text: Pick<FrameText, "event" | "logo" | "where">): HTMLElement {
  const head = el("header", "canccu-frame__head");
  if (text.logo) {
    const logo = el("img", "canccu-frame__logo");
    logo.src = text.logo;
    logo.alt = "";
    head.append(logo);
  }
  head.append(el("span", "canccu-frame__event", text.event || PLATFORM_MARK));
  if (text.where) head.append(el("span", "canccu-frame__where", text.where));
  head.append(el("span", "canccu-frame__date"), el("span", "canccu-frame__clock"));
  return head;
}

export function frame(kind: FrameKind, text: FrameText): HTMLElement {
  const root = el("main", `canccu-frame canccu-frame--${kind}`);
  root.dataset.frame = kind;
  const body = el("section", "canccu-frame__body");
  const top = el("div", "canccu-frame__top");
  if (text.kicker !== undefined) top.append(el("p", "canccu-frame__kicker", text.kicker));
  // Drawn by the look per frame kind (player.css); it holds no text.
  const icon = el("span", "canccu-frame__icon");
  icon.setAttribute("aria-hidden", "true");
  top.append(icon, el("h1", "canccu-frame__title", text.title));
  body.append(top);
  // The pairing code is packages/ui's safety element, centred on the page itself (safetyCode):
  // the frame leaves it the middle of its column.
  if (kind === "pairing") body.append(el("div", "canccu-frame__code-space"));
  const bottom = el("div", "canccu-frame__bottom");
  const [lead, ...help] = text.lines ?? [];
  if (lead !== undefined) bottom.append(el("p", "canccu-frame__lead", lead));
  for (const line of help) bottom.append(el("p", "canccu-frame__line", line));
  body.append(bottom);
  root.append(frameHead(text), body, el("footer", "canccu-frame__foot", text.foot ?? ""));
  return root;
}

/** The pairing code as packages/ui's safety class draws it: no theme can hide, move or restyle it. */
export function safetyCode(code: string): HTMLElement {
  return el("p", "canccu-pairing-code", spacedCode(code));
}

/**
 * packages/ui's safety elements hold only as children of the page after all its other children
 * (packages/ui/src/safety.ts): put them back at the end after anything else was added.
 */
export function keepSafetyLast(root: HTMLElement): void {
  for (const node of root.querySelectorAll(
    ":scope > .canccu-pairing-code, :scope > .canccu-offline-marker, :scope > .canccu-preview-mark",
  )) {
    root.append(node);
  }
}

/** The date and clock of a frame's header, in the event's time zone (the device's when unknown). */
export function setClock(root: ParentNode, ms: number, timeZone?: string): void {
  const date = root.querySelector(".canccu-frame__date");
  const clock = root.querySelector(".canccu-frame__clock");
  if (date !== null) date.textContent = dateText(ms, timeZone);
  if (clock !== null) clock.textContent = clockText(ms, timeZone);
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

/** `Sat 14 Mar`, as the Pulse's clock widget writes it. */
export function dateText(ms: number, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
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

/**
 * The "offline since" marker, packages/ui's safety element: the page keeps drawing what it has
 * under it, and no theme can hide it.
 */
export function offlineMark(sinceText: string): HTMLElement {
  const mark = el("div", "canccu-offline-marker", `offline since ${sinceText}`);
  mark.setAttribute("role", "status");
  return mark;
}

/** The `identify` command: which screen is this? (sheet 9: a panel over the dimmed Pulse) */
export function identifyCard(device: string, zone: string | null, bundle: string): HTMLElement {
  const card = el("div", "canccu-identify");
  card.append(
    el("p", "canccu-identify__kicker", "Identify"),
    el("p", "canccu-identify__name", device),
    el("p", "canccu-identify__zone", `${zone ?? "No zone"} · version ${bundle}`),
    el("p", "canccu-identify__left", ""),
  );
  return card;
}
