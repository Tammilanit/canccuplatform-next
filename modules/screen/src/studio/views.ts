/**
 * The Live and Devices pages (step 3 plan U7, O4, E2, E3, E10; mockups 07 and 13). Server-drawn
 * from the same reads the API answers; static/studio.js only acts through the API. A part marked
 * `data-live` is redrawn from a fresh read of the page every few seconds, so health stays current
 * without reloading the live views.
 */
import { attrs, emptyState, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { problemsOf, shownZone, uplinkDown } from "./help.js";
import type { SeenDevice } from "./help.js";
import type { Translate } from "./messages.js";

export const STUDIO = "/admin/screen/";

export interface ZoneSummary {
  key: string;
  name: string;
  layout_id: string | null;
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

export function ago(t: Translate, iso: string | null, nowMs: number): string {
  if (iso === null) return t("device.never_seen");
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  const when =
    s < 5
      ? t("ago.now")
      : s < 60
        ? t("ago.s", { n: s })
        : s < 3600
          ? t("ago.min", { n: Math.floor(s / 60) })
          : t("ago.h", { n: Math.floor(s / 3600) });
  return t("device.seen", { ago: when });
}

export function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

const online = (devices: readonly SeenDevice[]): number =>
  devices.filter((d) => d.health?.online).length;

export function liveView(
  c: ViewContext,
  zones: readonly ZoneSummary[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const quick: Slot[] = [
    c.rights.has("screen.ticker.write")
      ? html`<a class="canccu-button canccu-button--secondary" href="${STUDIO}ticker"
          >${t("live.set_ticker")}</a
        >`
      : "",
    c.rights.has("screen.devices.pair")
      ? html`<a class="canccu-button canccu-button--secondary" href="${STUDIO}devices#pair="
          >${t("live.pair")}</a
        >`
      : "",
  ];
  const cards = zones.map((z) => {
    const here = devices.filter((d) => shownZone(d, devices) === z.key);
    const count =
      here.length === 0
        ? t("live.no_screens")
        : t("live.screens", { online: online(here), total: here.length });
    return html`<section class="canccu-card canccu-studio-zone">
      ${thumb(z.key, t("live.open", { zone: z.name }), zoneFrame(z.key))}
      <h2 class="canccu-card__title">${z.name}</h2>
      <p class="canccu-small canccu-muted" ${attrs({ "data-live": `zone-${z.key}` })}>${count}</p>
    </section>`;
  });
  const body =
    zones.length === 0
      ? emptyState({ icon: "monitor", title: t("live.empty_title"), text: t("live.empty_text") })
      : html`<div class="canccu-studio-grid">${cards}</div>`;
  const anyQuick = quick.some(Boolean);
  return html`${anyQuick ? html`<div class="canccu-cluster canccu-studio-quick" aria-label="${t("live.quick")}">${quick}</div>` : ""}${body}`;
}

function deviceLine(
  t: Translate,
  d: SeenDevice,
  zones: readonly ZoneSummary[],
  all: readonly SeenDevice[],
): string {
  const zoneName = (key: string) => zones.find((z) => z.key === key)?.name ?? key;
  if (d.zone_key !== null) return t("device.zone", { zone: zoneName(d.zone_key) });
  const m = d.mirror_of;
  if (m === null) return t("device.unassigned");
  if ("zone_key" in m) return t("device.mirrors_zone", { zone: zoneName(m.zone_key) });
  return t("device.mirrors_device", {
    device: all.find((o) => o.id === m.device_id)?.name ?? m.device_id,
  });
}

function healthPart(c: ViewContext, d: SeenDevice, uplink: boolean): Html {
  const { t } = c;
  const h = d.health;
  const state = h?.online
    ? html`<span class="canccu-badge canccu-badge--ok">${t("device.online")}</span>`
    : html`<span class="canccu-badge canccu-badge--down">${t("device.offline")}</span>`;
  const playing = (h as { now_playing?: { widget: string; region_id: string } | null } | undefined)
    ?.now_playing;
  const flags = (h?.flags ?? []).map(
    (f) =>
      html`<span class="canccu-badge canccu-badge--degraded"
        >${f === "clock_drift" ? t("device.flag.clock_drift") : t("device.flag.shared_token")}</span
      >`,
  );
  const lag = h?.state_lag ?? 0;
  const facts = [
    ago(t, h?.last_seen_at ?? null, c.nowMs),
    playing ? t("device.now", { widget: playing.widget, region: playing.region_id }) : "",
    lag > 0 ? t("device.behind", { count: lag }) : "",
  ].filter(Boolean);
  const problems = problemsOf(d, uplink);
  const help =
    problems.length === 0
      ? ""
      : html`<details class="canccu-studio-help" ${attrs({ open: !h?.online })}>
          <summary>${t("help.title")}</summary>
          ${problems.map(
            (p) =>
              html`<p>
                  ${t(p.title, { device: d.name, since: h?.last_seen_at ? clockTime(h.last_seen_at, c.timeZone) : "" })}
                </p>
                <ol>
                  ${p.steps.map((s) => html`<li>${t(s, { url: c.startUrl })}</li>`)}
                </ol>`,
          )}
        </details>`;
  return html`<div${attrs({ "data-live": `device-${d.id}` })}><p class="canccu-cluster">${state}${flags}</p><p class="canccu-small canccu-muted">${facts.join(" · ")}</p>${help}</div>`;
}

function deviceActions(
  c: ViewContext,
  d: SeenDevice,
  zones: readonly ZoneSummary[],
  all: readonly SeenDevice[],
): Slot {
  const { t } = c;
  if (!c.rights.has("screen.devices.write")) return "";
  const api = `/api/screen/devices/${encodeURIComponent(d.id)}`;
  const command = (name: "identify" | "reload", done: string) =>
    html`<button${attrs({ class: "canccu-button canccu-button--secondary canccu-button--sm", type: "button", "data-call": "POST", "data-url": `${api}/commands`, "data-body": JSON.stringify({ command: name }), "data-done": done, "data-stay": true })}>${t(name === "identify" ? "device.identify" : "device.reload")}</button>`;
  const current =
    d.zone_key !== null
      ? `zone:${d.zone_key}`
      : d.mirror_of && "device_id" in d.mirror_of
        ? `device:${d.mirror_of.device_id}`
        : d.mirror_of
          ? `mirror-zone:${d.mirror_of.zone_key}`
          : "";
  const opt = (value: string, label: string) =>
    html`<option${attrs({ value, selected: value === current })}>${label}</option>`;
  const shows = [
    opt("", t("device.shows_none")),
    ...zones.map((z) => opt(`zone:${z.key}`, t("device.shows_zone", { zone: z.name }))),
    ...all
      .filter((o) => o.id !== d.id && o.zone_key !== null)
      .map((o) => opt(`device:${o.id}`, t("device.shows_mirror", { device: o.name }))),
    ...(current.startsWith("mirror-zone:") ? [opt(current, deviceLine(t, d, zones, all))] : []),
  ];
  const id = `canccu-studio-${d.id}`;
  return html`<div class="canccu-cluster">${command("identify", t("device.identified"))}${command("reload", t("device.reloaded"))}</div><details class="canccu-studio-edit"><summary>${t("device.edit")}</summary><form class="canccu-form"${attrs({ "data-device": d.id, "data-done": t("device.saved") })}><div class="canccu-field"><label class="canccu-field__label" for="${id}-name">${t("device.name")}</label><input${attrs({ class: "canccu-input", id: `${id}-name`, name: "name", value: d.name, required: true, maxlength: 80 })}></div><div class="canccu-field"><label class="canccu-field__label" for="${id}-shows">${t("device.shows")}</label><select class="canccu-input" id="${id}-shows" name="shows">${shows}</select></div><div class="canccu-cluster"><button class="canccu-button canccu-button--primary" type="submit">${t("device.save")}</button><button${attrs({ class: "canccu-button canccu-button--danger-ghost", type: "button", "data-call": "POST", "data-url": `${api}/revoke`, "data-confirm": t("device.revoke_confirm", { device: d.name }) })}>${t("device.revoke")}</button></div></form></details>`;
}

function pairDialog(c: ViewContext, zones: readonly ZoneSummary[]): Slot {
  const { t } = c;
  if (!c.rights.has("screen.devices.pair")) return "";
  const zoneOptions = [
    html`<option value="">${t("pair.no_zone")}</option>`,
    ...zones.map((z) => html`<option value="${z.key}">${z.name}</option>`),
  ];
  return html`<dialog class="canccu-studio-dialog" id="canccu-studio-pair">
    <form class="canccu-form" data-pair method="dialog">
      <h2 class="canccu-card__title">${t("pair.title")}</h2>
      <div class="canccu-field">
        <label class="canccu-field__label" for="canccu-studio-pair-code">${t("pair.code")}</label
        ><input
          class="canccu-input canccu-studio-code"
          id="canccu-studio-pair-code"
          name="code"
          required
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="9"
          aria-describedby="canccu-studio-pair-code-hint"
        />
        <p class="canccu-field__hint" id="canccu-studio-pair-code-hint">${t("pair.code_hint")}</p>
      </div>
      <div class="canccu-field">
        <label class="canccu-field__label" for="canccu-studio-pair-name">${t("pair.name")}</label
        ><input
          class="canccu-input"
          id="canccu-studio-pair-name"
          name="name"
          required
          maxlength="80"
          aria-describedby="canccu-studio-pair-name-hint"
        />
        <p class="canccu-field__hint" id="canccu-studio-pair-name-hint">${t("pair.name_hint")}</p>
      </div>
      <div class="canccu-field">
        <label class="canccu-field__label" for="canccu-studio-pair-zone">${t("pair.zone")}</label
        ><select class="canccu-input" id="canccu-studio-pair-zone" name="zone_key">
          ${zoneOptions}
        </select>
      </div>
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--primary" type="submit">
          ${t("pair.submit")}</button
        ><button class="canccu-button canccu-button--ghost" type="button" data-close>
          ${t("pair.cancel")}
        </button>
      </div>
    </form>
  </dialog>`;
}

/** The page's actions at the right of its title. */
export function devicesActions(c: ViewContext): Slot {
  const { t } = c;
  if (!c.rights.has("screen.devices.pair")) return "";
  return html`<button
      class="canccu-button canccu-button--ghost"
      type="button"
      data-call="DELETE"
      data-url="/api/screen/pairing"
      ${attrs({ "data-confirm": t("devices.clear_codes_confirm"), "data-done": t("devices.cleared"), "data-stay": true })}
    >
      ${t("devices.clear_codes")}</button
    ><button class="canccu-button canccu-button--primary" type="button" data-open-pair>
      ${t("devices.pair")}
    </button>`;
}

export function devicesView(
  c: ViewContext,
  zones: readonly ZoneSummary[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const uplink = uplinkDown(devices);
  const on = online(devices);
  const summary = html`<div data-live="devices-summary">
    <p class="canccu-muted">
      ${t("devices.summary", { total: devices.length, online: on, offline: devices.length - on })}
    </p>
    ${uplink ? notice({ kind: "down", title: t("devices.uplink_title"), text: t("devices.uplink_text") }) : ""}
  </div>`;
  const cards = devices.map((d) => {
    const zone = shownZone(d, devices);
    return html`<article class="canccu-card canccu-studio-device" id="device-${d.id}">
      ${zone === null ? html`<div class="canccu-studio-thumb canccu-studio-thumb--none"></div>` : thumb(zone, t("device.preview", { device: d.name }))}
      <div class="canccu-studio-device__main">
        <h2 class="canccu-card__title">${d.name}</h2>
        <p class="canccu-small">${deviceLine(t, d, zones, devices)}</p>
        ${healthPart(c, d, uplink)}${deviceActions(c, d, zones, devices)}
      </div>
    </article>`;
  });
  const list =
    devices.length === 0
      ? emptyState({
          icon: "monitor",
          title: t("devices.empty_title"),
          text: t("devices.empty_text"),
        })
      : html`<div class="canccu-studio-devices">${cards}</div>`;
  return html`${summary}${list}${pairDialog(c, zones)}`;
}
