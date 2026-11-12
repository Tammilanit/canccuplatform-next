/**
 * What the Studio's pages share, and the Live page (step 3 plan U7). Server-drawn from the same
 * reads the API answers; static/studio.js only acts through the API. A part marked `data-live` is
 * redrawn from a fresh read of the page every few seconds, so health stays current without
 * reloading the live views.
 */
import { attrs, emptyState, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { shownZone } from "./help.js";
import type { SeenDevice } from "./help.js";
import { counted } from "./messages.js";
import type { Translate } from "./messages.js";

export const STUDIO = "/admin/screen/";

export interface ZoneSummary {
  key: string;
  name: string;
  layout_id: string | null;
  /** Which screen of the zone plays its sound (contracts/screen.md, Zones). */
  sound?: { enabled: boolean; device_id: string | null };
}

/** What every page view reads besides its data. */
export interface ViewContext {
  t: Translate;
  rights: ReadonlySet<string>;
  nowMs: number;
  timeZone: string;
  /** The kiosk's start address, for the offline steps. */
  startUrl: string;
}

export const zoneFrame = (key: string): string => `/screen/zones/${encodeURIComponent(key)}`;

/** A live view of a zone, loaded by the page script only while it is on screen (20 streams cap). */
export function thumb(key: string, title: string, href?: string): Html {
  const frame = html`<iframe${attrs({ "data-src": zoneFrame(key), title, tabindex: -1 })}></iframe>`;
  return href === undefined
    ? html`<div class="canccu-studio-thumb">${frame}</div>`
    : html`<a${attrs({ class: "canccu-studio-thumb", href, target: "_blank", "aria-label": title })}>${frame}</a>`;
}

/** "3 s ago", "2 min ago": how long since `iso`. */
export function since(t: Translate, iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 5) return t("ago.now");
  if (s < 60) return t("ago.s", { n: s });
  if (s < 3600) return t("ago.min", { n: Math.floor(s / 60) });
  return t("ago.h", { n: Math.floor(s / 3600) });
}

export function ago(t: Translate, iso: string | null, nowMs: number): string {
  return iso === null ? t("device.never_seen") : t("device.seen", { ago: since(t, iso, nowMs) });
}

export function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export const online = (devices: readonly SeenDevice[]): number =>
  devices.filter((d) => d.health?.online).length;

/**
 * Live's actions at the right of its title, each with the look it has on its own tab: pairing is
 * Devices' main action there, so it is primary here too; the ticker opens its tab.
 */
export function liveActions(c: ViewContext): Slot {
  const { t } = c;
  return html`${c.rights.has("screen.ticker.write") ? html`<a class="canccu-button canccu-button--secondary" href="${STUDIO}ticker">${t("live.set_ticker")}</a>` : ""}${c.rights.has("screen.devices.pair") ? html`<a class="canccu-button canccu-button--primary" href="${STUDIO}devices#pair=">${t("live.pair")}</a>` : ""}`;
}

export function liveView(
  c: ViewContext,
  zones: readonly ZoneSummary[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const cards = zones.map((z) => {
    const here = devices.filter((d) => shownZone(d, devices) === z.key);
    const count =
      here.length === 0
        ? t("live.no_screens")
        : counted(t, "live.screens", here.length, { online: online(here), total: here.length });
    return html`<section class="canccu-card canccu-studio-zone">
      ${thumb(z.key, t("live.open", { zone: z.name }), zoneFrame(z.key))}
      <h2 class="canccu-card__title">${z.name}</h2>
      <p class="canccu-small canccu-muted" ${attrs({ "data-live": `zone-${z.key}` })}>${count}</p>
    </section>`;
  });
  return zones.length === 0
    ? emptyState({ icon: "monitor", title: t("live.empty_title"), text: t("live.empty_text") })
    : html`<div class="canccu-studio-grid">${cards}</div>`;
}
