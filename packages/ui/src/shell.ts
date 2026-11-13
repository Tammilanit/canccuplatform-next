/**
 * The organiser shell and its parts (docs/design/mockups.html, sheets 2, 3, 7 and 8): the event's
 * header, the Event menu, the error page family, empty states and notices. kit-py's
 * `canccu_kit.ui` writes the same markup for the Python modules; ui.css styles both.
 */
import { attrs, html, raw, type Html, type Slot } from "./html.js";
import { eventTokens, themeStyle, type ProfileLike } from "./theme.js";
import menu from "./menu.json" with { type: "json" };
import { dateRange, eventClock, stateBadge, type EventInfo } from "./event.js";

export { dateRange, dayLabel, eventClock, stateBadge, timeLabel, type EventInfo } from "./event.js";

/** Who is signed in: the kit's session. */
export interface Viewer {
  userName: string;
  rights: ReadonlySet<string>;
}

export interface MenuItem {
  id: string;
  label: string;
  href: string;
  icon: string;
  rights: readonly string[];
}

export interface Tab {
  href: string;
  label: string;
  current?: boolean;
}

const mayOpen = (item: { rights: readonly string[] }, viewer: Viewer): boolean =>
  item.rights.some((r) => viewer.rights.has(r));

/** The menu's groups with only the pages this person may open; empty groups are left out. */
export function menuFor(rights: ReadonlySet<string>): { label: string; items: MenuItem[] }[] {
  const viewer = { userName: "", rights };
  return menu.groups
    .map((g) => ({ label: g.label, items: g.items.filter((i) => mayOpen(i, viewer)) }))
    .filter((g) => g.items.length > 0);
}

/** An icon from ui.css; decorative, so screen readers skip it. */
export const icon = (name: string): Html =>
  html`<span class="canccu-i canccu-i--${name}" aria-hidden="true"></span>`;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

function signOutForm(label: string, cls: string): Html {
  return html`<form method="post" action="${menu.sign_out}"><button class="${cls}" type="submit">${icon("out")}${label}</button></form>`;
}

/**
 * The bottom bar's slots this person may open, in order; Quick add is `quick_add`. An archived
 * event changes nothing, so its bar has no Quick add (sheets 2 and 8).
 */
export function barFor(
  rights: ReadonlySet<string>,
  archived = false,
): { id: string; label: string }[] {
  const viewer = { userName: "", rights };
  const pages = new Map(menuFor(rights).flatMap((g) => g.items.map((i) => [i.id, i] as const)));
  return menu.bar.flatMap((slot) => {
    if (slot.id === "quick_add") {
      return mayOpen(menu.quick_add, viewer) && !archived
        ? [{ id: slot.id, label: menu.quick_add.label }]
        : [];
    }
    const page = pages.get(slot.id);
    return page ? [{ id: slot.id, label: slot.label ?? page.label }] : [];
  });
}

function menuNav(viewer: Viewer, current: string | undefined, event: EventInfo | undefined): Html {
  // On a phone the menu is More's sheet: what the bar already shows is left out of it.
  const inBar = new Set(barFor(viewer.rights, event?.status === "archived").map((b) => b.id));
  const groups = menuFor(viewer.rights).map(
    (g) =>
      html`<div class="${g.items.every((i) => inBar.has(i.id)) ? "canccu-menu__group canccu-menu__group--bar" : "canccu-menu__group"}"><p class="canccu-overline canccu-menu__label">${g.label}</p>${g.items.map(
        (i) =>
          html`<a${attrs({ class: inBar.has(i.id) ? "canccu-menu__item canccu-menu__item--bar" : "canccu-menu__item", href: i.href, "aria-current": i.id === current ? "page" : undefined })}>${icon(i.icon)}${i.label}</a>`,
      )}</div>`,
  );
  const about = [event ? dateRange(event) : "", event?.venue ?? ""].filter(Boolean).join(" · ");
  const sheet = html`<div class="canccu-menu__sheet"><p class="canccu-menu__title">More</p><button class="canccu-button canccu-button--ghost" type="button" popovertarget="canccu-menu" popovertargetaction="hide">${icon("close")}Close</button>${about ? html`<p class="canccu-menu__about">${about}</p>` : ""}</div>`;
  return html`<nav class="canccu-menu" id="canccu-menu" popover aria-label="Event">${sheet}${groups}<div class="canccu-menu__foot"><div class="canccu-user"><span class="canccu-avatar" aria-hidden="true">${initials(viewer.userName)}</span>${viewer.userName}</div>${signOutForm("Sign out", "canccu-button canccu-button--ghost")}</div></nav>`;
}

function tabbar(viewer: Viewer, current: string | undefined, archived: boolean): Html {
  const pages = new Map(menu.groups.flatMap((g) => g.items.map((i) => [i.id, i] as const)));
  const narrow = new Map(menu.bar.map((b) => [b.id, "narrow" in b ? b.narrow : undefined]));
  const slots = barFor(viewer.rights, archived).map((b) => {
    const short = narrow.get(b.id);
    const label = short
      ? html`<span class="canccu-tabbar__wide">${b.label}</span><span class="canccu-tabbar__narrow">${short}</span>`
      : b.label;
    if (b.id === "quick_add") {
      return html`<a class="canccu-tabbar__item canccu-tabbar__add" href="${menu.quick_add.href}">${icon(menu.quick_add.icon)}${label}</a>`;
    }
    const page = pages.get(b.id);
    return html`<a${attrs({ class: "canccu-tabbar__item", href: page?.href ?? "", "aria-current": b.id === current ? "page" : undefined })}>${icon(page?.icon ?? "")}${label}</a>`;
  });
  return html`<nav class="canccu-tabbar" aria-label="Shortcuts">${slots}<button class="canccu-tabbar__item" type="button" popovertarget="canccu-menu">${icon("more")}More</button></nav>`;
}

/**
 * Theming's one address for the event's logo, or its initials without one (contracts/theming.md,
 * Reading the current theme), so a page shows it without reading the theme.
 */
export const LOGO_URL = "/theming/logo";

function header(event: EventInfo | undefined, logoUrl: string | undefined, now: Date): Html {
  const src = logoUrl ?? (event === undefined ? undefined : LOGO_URL);
  const logo =
    src === undefined ? "" : html`<img${attrs({ class: "canccu-header__logo", src, alt: "" })}>`;
  const dates = event === undefined ? "" : dateRange(event);
  const end = event === undefined ? "" : eventClock(event, now);
  return html`<header class="canccu-header">${logo}<span class="canccu-header__title">${event?.name ?? "Event"}</span>${dates ? html`<span class="canccu-header__sep"></span><span class="canccu-header__meta">${dates}</span>` : ""}${event === undefined ? "" : stateBadge(event, now)}<span class="canccu-header__end">${end}</span></header>`;
}

function document(title: string, o: DocumentOptions, body: Slot): Html {
  const style = raw(themeStyle(o.profile, o.nonce));
  const full = o.event?.name ? `${title} · ${o.event.name}` : title;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${full}</title>
<link${attrs({ rel: "stylesheet", href: o.cssHref ?? "/ui/ui.css" })}>
${style}${eventTokens(o.surface ?? "admin")}
${o.head ?? ""}</head>
<body class="canccu-page canccu-surface canccu-surface--${o.surface ?? "admin"}">
${body}
</body>
</html>
`;
}

/** Tabs a phone shows; the rest sit behind a count (sheet 2: no sideways scroll). */
const PHONE_TABS = 3;

/**
 * A section's sub-pages. On a phone three show, the current one among them, and the rest open
 * from "N more" (a popover, no script); a desktop shows them all in their order.
 */
function tabsNav(title: string, tabs: readonly Tab[]): Html {
  const here = tabs.findIndex((t) => t.current);
  const shown = new Set(tabs.slice(0, PHONE_TABS).map((_, i) => i));
  if (tabs.length > PHONE_TABS && here >= PHONE_TABS) {
    shown.delete(PHONE_TABS - 1);
    shown.add(here);
  }
  const link = (t: Tab, cls?: string) =>
    html`<a${attrs({ class: cls, href: t.href, "aria-current": t.current ? "page" : undefined })}>${t.label}</a>`;
  const rest = tabs.filter((_, i) => !shown.has(i));
  const more = rest.length
    ? html`<button class="canccu-tabs__more" type="button" popovertarget="canccu-tabs-more">${rest.length} more</button><div class="canccu-tabs__menu" id="canccu-tabs-more" popover>${rest.map((t) => link(t))}</div>`
    : "";
  return html`<nav class="canccu-tabs" aria-label="${title}">${tabs.map((t, i) => link(t, shown.has(i) ? undefined : "canccu-tabs__extra"))}${more}</nav>`;
}

export interface DocumentOptions {
  event?: EventInfo | undefined;
  /** Where the module serves ui.css. */
  cssHref?: string;
  /** More of the head: the module's own stylesheet. */
  head?: Slot;
  profile?: ProfileLike;
  nonce?: string;
  surface?: "admin" | "hub";
  logoUrl?: string;
  /** The clock the state badge reads; tests pin it. */
  now?: Date;
}

export interface ShellOptions extends DocumentOptions {
  title: string;
  body: Slot;
  /** The menu id of this page, marked as the current one. */
  current?: string;
  /** Without one (a refusal before sign-in) the page has no menu. */
  session?: Viewer | undefined;
  description?: Slot;
  crumb?: { href: string; label: string };
  /** Actions at the right of the title. */
  actions?: Slot;
  /** The page's own sub-pages. */
  tabs?: readonly Tab[];
  /** `narrow` (40rem) for forms; workspaces keep the 64rem default. */
  width?: "narrow" | "wide";
  /** An error page has no title row of its own: its view is the title. */
  plain?: boolean;
}

/** Registers admin's service worker, which shows the offline page when a signed-in phone loses
 * its connection (#440); only a session's pages need it, as only they have a shell to keep. */
const OFFLINE_SCRIPT = raw('<script src="/admin/static/shell.js" defer></script>');

/** An organiser page in the shell. */
export function shellPage(o: ShellOptions): Html {
  const now = o.now ?? new Date();
  const archived =
    o.event?.status === "archived"
      ? html`<div class="canccu-banner" role="status">${icon("archive")}<span><b>Archived.</b> ${o.event.name ?? "The event"} has ended. Read only.</span></div>`
      : "";
  const crumb = o.crumb
    ? html`<a class="canccu-crumb" href="${o.crumb.href}">${icon("left")}${o.crumb.label}</a>`
    : "";
  const desc = o.description ? html`<p class="canccu-pagehead__desc">${o.description}</p>` : "";
  const head = o.plain
    ? ""
    : html`<div class="canccu-pagehead"><div>${crumb}<h1 class="canccu-pagehead__title">${o.title}</h1>${desc}</div>${o.actions ? html`<div class="canccu-cluster">${o.actions}</div>` : ""}</div>`;
  const tabs = o.tabs?.length ? tabsNav(o.title, o.tabs) : "";
  const main = html`<div class="canccu-content"><main class="canccu-main${o.width === "narrow" ? " canccu-main--narrow" : ""}">${head}${tabs}${o.body}</main></div>`;
  // An error page is nowhere in the menu, so nothing in it is marked (sheet 8).
  const here = o.plain ? undefined : o.current;
  const shell = o.session
    ? html`<div class="canccu-shell">${header(o.event, o.logoUrl, now)}${archived}${menuNav(o.session, here, o.event)}${main}${tabbar(o.session, here, o.event?.status === "archived")}</div>${OFFLINE_SCRIPT}`
    : html`<div class="canccu-shell canccu-shell--bare">${header(o.event, o.logoUrl, now)}${archived}${main}</div>`;
  return document(o.title, o, shell);
}

export interface FrontOptions extends DocumentOptions {
  title: string;
  /** The card's content: a title, a sentence, one button. */
  card: Slot;
  /** Centred, as the check-in steps are. */
  centred?: boolean;
  /** Where the Privacy tag leads: the safety element of pages that take the event's look, which
   * must be the page's last child (README, the safety elements). */
  privacy?: string;
}

/** A front door (sign-in, check-in): the event's poster beside or above one card. */
export function frontPage(o: FrontOptions): Html {
  const e = o.event;
  const name = e?.name ?? "";
  const long = name.length > 28 ? " canccu-poster__name--long" : "";
  const dates = e === undefined ? "" : dateRange(e);
  const meta =
    e === undefined
      ? ""
      : html`<p class="canccu-poster__meta">${dates}${stateBadge(e, o.now ?? new Date())}</p>`;
  const venue = e?.venue ? html`<p class="canccu-poster__venue">${icon("pin")}${e.venue}</p>` : "";
  const logo =
    e === undefined
      ? ""
      : html`<img${attrs({ class: "canccu-poster__logo", src: o.logoUrl ?? LOGO_URL, alt: "" })}>`;
  const poster = html`<div class="canccu-poster">${logo}<div class="canccu-poster__name${long}">${name}</div>${meta}${venue}</div>`;
  const card = html`<div class="canccu-front__card${o.centred ? " canccu-front__card--center" : ""}">${o.card}</div>`;
  if (!o.privacy)
    return document(o.title, o, html`<div class="canccu-front">${poster}${card}</div>`);
  // The page keeps a free row at its foot, so the tag never covers the card.
  return document(
    o.title,
    o,
    html`<div class="canccu-front canccu-front--privacy">${poster}${card}</div><a class="canccu-privacy-link" href="${o.privacy}">Privacy</a>`,
  );
}

export interface PageError {
  status: number;
  code: string;
  /** The module's own words; shown only for a refused change, never for a refusal of access. */
  message: string;
}

export interface ErrorContext {
  session?: Viewer | undefined;
  /** What the page is, in words: "the Theme studio". */
  page?: string;
  event?: string | undefined;
  /** The address to try again (the page's own). */
  retry?: string;
  back?: { href: string; label: string };
}

type Kind = "no_access" | "not_found" | "not_at_venue" | "archived" | "failed" | "refused";

function kindOf(err: PageError): Kind {
  if (err.status >= 500) return "failed";
  if (err.code === "missing_right") return "no_access";
  if (err.code === "admin_access_restricted") return "not_at_venue";
  if (err.code === "event_archived") return "archived";
  if (err.status === 404) return "not_found";
  return "refused";
}

const TITLES: Record<Kind, string> = {
  no_access: "No access",
  not_found: "Not found",
  not_at_venue: "Not at the venue",
  archived: "Event archived",
  failed: "Something went wrong",
  refused: "Couldn't do that",
};

/** The title of an error page by its case. */
export const errorTitle = (err: PageError): string => TITLES[kindOf(err)];

/**
 * An error page's view: a title by case, one sentence in plain words, the next step and a way on.
 * Right ids, paths and addresses stay in the server log (UX audit B3).
 */
export function errorView(err: PageError, c: ErrorContext): Html {
  const kind = kindOf(err);
  const home = c.session ? menuFor(c.session.rights)[0]?.items[0] : undefined;
  const health = c.session
    ? menuFor(c.session.rights)
        .flatMap((g) => g.items)
        .find((i) => i.id === "health")
    : undefined;
  const link = (href: string, label: string, variant: string, ico = ""): Html =>
    html`<a class="canccu-button canccu-button--${variant}" href="${href}">${ico ? icon(ico) : ""}${label}</a>`;
  const retry = c.retry ? link(c.retry, "Try again", "primary", "refresh") : "";
  const event = c.event ?? "this event";
  const views: Record<Kind, [string, Slot, Slot, Slot]> = {
    no_access: [
      "lock",
      `Your role in ${event} doesn't include ${c.page ?? "this page"}.`,
      "If you need it, ask an event owner to add it to your role.",
      [
        home ? link(home.href, `Go to ${home.label}`, "primary") : "",
        signOutForm("Sign in as someone else", "canccu-button canccu-button--ghost"),
      ],
    ],
    not_found: [
      "compass",
      "There's nothing at this address. It may have been removed, or the link is cut short.",
      "",
      home ? link(home.href, `Open ${home.label}`, "primary") : "",
    ],
    not_at_venue: [
      "pin",
      "Organiser pages open only on the venue's network or through the crew's VPN.",
      "Join the venue Wi-Fi and try again. No VPN, or not sure what that is? Ask an organiser: they can let you in.",
      retry,
    ],
    archived: [
      "archive",
      `${c.event ?? "The event"} has ended. Everything can still be read; nothing can be changed.`,
      "",
      c.back ? link(c.back.href, c.back.label, "secondary") : "",
    ],
    failed: [
      "alert",
      "The page didn't load. It's on our side, not yours.",
      health
        ? "Try again in a moment. If it stays, Health shows which part is down."
        : "Try again in a moment. If it stays, tell an organiser.",
      [retry, health ? link(health.href, "Open Health", "secondary") : ""],
    ],
    refused: ["alert", err.message, "", c.back ? link(c.back.href, c.back.label, "secondary") : ""],
  };
  const [ico, text, next, actions] = views[kind];
  return html`<div class="canccu-error"><span class="canccu-error__icon">${icon(ico)}</span><h1 class="canccu-error__title">${TITLES[kind]}</h1><p class="canccu-error__text">${text}</p>${next ? html`<p class="canccu-error__next">${next}</p>` : ""}<div class="canccu-cluster">${actions}</div></div>`;
}

/** An empty state: what is missing, why it matters, the one next step. */
export function emptyState(o: { icon: string; title: string; text: Slot; action?: Slot }): Html {
  return html`<div class="canccu-empty"><span class="canccu-empty__icon">${icon(o.icon)}</span><p class="canccu-empty__title">${o.title}</p><p class="canccu-empty__text">${o.text}</p>${o.action ? html`<div class="canccu-cluster">${o.action}</div>` : ""}</div>`;
}

const NOTICE_ICONS = { info: "info", ok: "check-circle", warn: "warn", down: "alert" } as const;

/** A notice: a status colour, an icon, a title and a sentence. */
export function notice(o: {
  kind: keyof typeof NOTICE_ICONS;
  title: string;
  text?: Slot;
  actions?: Slot;
}): Html {
  const role = o.kind === "down" ? "alert" : "status";
  const cls = o.kind === "info" ? "canccu-notice" : `canccu-notice canccu-notice--${o.kind}`;
  return html`<div class="${cls}" role="${role}">${icon(NOTICE_ICONS[o.kind])}<div class="canccu-notice__body"><p class="canccu-notice__title">${o.title}</p>${o.text ? html`<p>${o.text}</p>` : ""}${o.actions ? html`<div class="canccu-notice__actions">${o.actions}</div>` : ""}</div></div>`;
}
