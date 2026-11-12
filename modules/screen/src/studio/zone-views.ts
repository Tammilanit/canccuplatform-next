/**
 * The Zones, zone editor and Ticker pages (step 3 plan U6, U8, L13; mockups 08 and 13). The
 * editor draws the zone's own settings (`Zone.regions`); the grid is the theme's layout. The page
 * script turns the form back into a `Zone`, previews it in the real player and saves it with the
 * revision read.
 */
import { attrs, emptyState, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { Layout } from "../compose/layouts.js";
import type { TickerNow } from "../ticker/resolve.js";
import type { ZoneInput } from "../zone-input.js";
import type { SeenDevice } from "./help.js";
import { shownZone } from "./help.js";
import type { MessageKey } from "./messages.js";
import { STUDIO, clockTime, zoneFrame } from "./views.js";
import type { ViewContext } from "./views.js";

export type Zone = Omit<ZoneInput, "revision"> & { revision: number };

/** What Studio offers to add to a region; `embed` needs a theme embed, so it is kept, not offered. */
export const WIDGETS = [
  "playlist",
  "photo",
  "agenda_now",
  "countdown",
  "clock",
  "logo",
  "qr",
  "venue_info",
  "checkin_qr",
  "ticker",
] as const;

const select = (
  id: string,
  name: string,
  value: string,
  options: readonly [string, string][],
): Html =>
  html`<select class="canccu-input" id="${id}" name="${name}">
    ${options.map(([v, label]) => html`<option${attrs({ value: v, selected: v === value })}>${label}</option>`)}
  </select>`;

const labelled = (id: string, label: string, control: Slot): Html =>
  html`<div class="canccu-field">
    <label class="canccu-field__label" for="${id}">${label}</label>${control}
  </div>`;

export function zonesView(
  c: ViewContext,
  zones: readonly Zone[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const rows = zones.map((z) => {
    const screens = devices.filter((d) => shownZone(d, devices) === z.key).length;
    const layout =
      z.layout_id === null ? t("zones.theme_layout") : t("zones.layout", { layout: z.layout_id });
    return html`<li class="canccu-list__row">
      <a class="canccu-list__main" href="${STUDIO}zones/${encodeURIComponent(z.key)}"
        ><span class="canccu-list__title">${z.name}</span
        ><span class="canccu-list__meta">${z.key} · ${layout}</span></a
      ><span class="canccu-list__end canccu-small">${t("zones.screens", { count: screens })}</span>
    </li>`;
  });
  const list =
    zones.length === 0
      ? emptyState({ icon: "monitor", title: t("zones.empty_title"), text: t("zones.empty_text") })
      : html`<ul class="canccu-list">
          ${rows}
        </ul>`;
  const add = html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("zones.new")}</h2>
    <form class="canccu-form" data-new-zone>
      ${labelled("canccu-studio-zone-name", t("zones.new_name"), html`<input class="canccu-input" id="canccu-studio-zone-name" name="name" required maxlength="80" />`)}
      <div class="canccu-field">
        <label class="canccu-field__label" for="canccu-studio-zone-key">${t("zones.new_key")}</label
        ><input
          class="canccu-input"
          id="canccu-studio-zone-key"
          name="key"
          required
          pattern="[a-z0-9][a-z0-9_\\-]{1,31}"
          aria-describedby="canccu-studio-zone-key-hint"
        />
        <p class="canccu-field__hint" id="canccu-studio-zone-key-hint">
          ${t("zones.new_key_hint")}
        </p>
      </div>
      <button class="canccu-button canccu-button--primary" type="submit">${t("zones.add")}</button>
    </form>
  </section>`;
  return html`${list}${add}`;
}

function widgetRow(c: ViewContext, entry: Record<string, unknown>): Html {
  const { t } = c;
  const name = typeof entry.widget === "string" ? entry.widget : "";
  const small = (action: string, key: MessageKey) =>
    html`<button
      class="canccu-button canccu-button--ghost canccu-button--sm"
      type="button"
      data-widget-move="${action}"
    >
      ${t(key)}
    </button>`;
  return html`<li class="canccu-studio-widget" ${attrs({ "data-entry": JSON.stringify(entry) })}>
    <span class="canccu-studio-widget__name">${name}</span
    >${small("up", "zone.up")}${small("down", "zone.down")}${small("remove", "zone.remove")}
  </li>`;
}

function regionPart(
  c: ViewContext,
  id: string,
  settings: Record<string, unknown>,
  defaults: readonly Record<string, unknown>[],
): Html {
  const { t } = c;
  const own = Array.isArray(settings.widgets);
  const entries = (own ? (settings.widgets as Record<string, unknown>[]) : defaults).map((e) =>
    widgetRow(c, e),
  );
  const f = `canccu-studio-r-${id}`;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const names = (own ? (settings.widgets as Record<string, unknown>[]) : defaults)
    .map((e) => (typeof e.widget === "string" ? e.widget : ""))
    .join(", ");
  // Closed but the hero, so the page reads as the list of regions it is; one opens to edit.
  return html`<details
    class="canccu-card canccu-studio-region"
    data-region="${id}"
    ${attrs({ open: id === "hero" })}
  >
    <summary>
      <span class="canccu-card__title">${t("zone.region", { region: id })}</span
      ><span class="canccu-small canccu-muted">${names}</span>
    </summary>
    <div class="canccu-field canccu-field--check">
      <input
        class="canccu-check"
        type="checkbox"
        id="${f}-layout"
        name="layout_widgets"
        ${attrs({ checked: !own })}
      />
      <label class="canccu-field__label" for="${f}-layout">${t("zone.layout_widgets")}</label>
    </div>
    <p class="canccu-overline">${t("zone.widgets")}</p>
    <ol class="canccu-studio-widgets" data-widgets>
      ${entries}
    </ol>
    <div class="canccu-cluster">
      ${select(
        `${f}-add`,
        "add",
        "",
        WIDGETS.map((w) => [w, w]),
      )}<button
        class="canccu-button canccu-button--secondary canccu-button--sm"
        type="button"
        data-widget-add
      >
        ${t("zone.add_widget")}
      </button>
    </div>
    <div class="canccu-studio-row">
      ${labelled(
        `${f}-rotation`,
        t("zone.rotation"),
        select(`${f}-rotation`, "rotation", str(settings.rotation), [
          ["", t("zone.rotation.sequence")],
          ["shuffle", t("zone.rotation.shuffle")],
        ]),
      )}${labelled(`${f}-dwell`, t("zone.dwell"), html`<input class="canccu-input" type="number" min="5" max="3600" step="1" id="${f}-dwell" name="dwell_seconds" ${attrs({ value: typeof settings.dwell_seconds === "number" ? settings.dwell_seconds : undefined })} />`)}${labelled(
        `${f}-idle`,
        t("zone.idle"),
        select(`${f}-idle`, "idle", str(settings.idle), [
          ["", t("zone.idle.logo")],
          ["next", t("zone.idle.next")],
          ["blank", t("zone.idle.blank")],
          ["collapse", t("zone.idle.collapse")],
        ]),
      )}
    </div>
    <div class="canccu-field canccu-field--check">
      <input
        class="canccu-check"
        type="checkbox"
        id="${f}-skip"
        name="skip_empty"
        ${attrs({ checked: settings.skip_empty !== false })}
      />
      <label class="canccu-field__label" for="${f}-skip">${t("zone.skip_empty")}</label>
    </div>
  </details>`;
}

export function zoneEditorView(
  c: ViewContext,
  zone: Zone,
  layouts: readonly Layout[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const layout = layouts.find((l) => l.id === (zone.layout_id ?? "pulse")) ?? layouts[0];
  // The layout's regions first, in its order, then any the zone keeps for another layout.
  const ids = [
    ...(layout?.regions.map((r) => r.id) ?? []),
    ...Object.keys(zone.regions).filter((id) => !layout?.regions.some((r) => r.id === id)),
  ];
  const regions = ids.map((id) =>
    regionPart(
      c,
      id,
      zone.regions[id] ?? {},
      (layout?.regions.find((r) => r.id === id)?.widgets ?? []) as unknown as Record<
        string,
        unknown
      >[],
    ),
  );
  const layoutOptions: [string, string][] = [
    ["", t("zone.layout_default")],
    ...layouts.map((l): [string, string] => [l.id, l.name]),
    ...(zone.layout_id !== null && !layouts.some((l) => l.id === zone.layout_id)
      ? [[zone.layout_id, zone.layout_id] as [string, string]]
      : []),
  ];
  const inZone = devices.filter((d) => d.zone_key === zone.key);
  const f = "canccu-studio-zone";
  const settings = html`<section class="canccu-card">
    ${labelled(`${f}-name`, t("zone.name"), html`<input class="canccu-input" id="${f}-name" name="name" required maxlength="80" ${attrs({ value: zone.name })} />`)}
    <div class="canccu-studio-row">
      ${labelled(`${f}-layout`, t("zone.layout"), select(`${f}-layout`, "layout_id", zone.layout_id ?? "", layoutOptions))}${labelled(
        `${f}-header`,
        t("zone.header"),
        select(`${f}-header`, "header", zone.header ?? "", [
          ["", t("zone.header_default")],
          ["separate", t("zone.header.separate")],
          ["shared", t("zone.header.shared")],
        ]),
      )}${labelled(
        `${f}-hub`,
        t("zone.hub_qr"),
        select(`${f}-hub`, "hub_qr", zone.hub_qr, [
          ["always", t("zone.hub_qr.always")],
          ["rotate", t("zone.hub_qr.rotate")],
        ]),
      )}
    </div>
    <div class="canccu-studio-row">
      <div class="canccu-field canccu-field--check">
        <input
          class="canccu-check"
          type="checkbox"
          id="${f}-sound"
          name="sound_enabled"
          ${attrs({ checked: zone.sound.enabled })}
        />
        <label class="canccu-field__label" for="${f}-sound">${t("zone.sound_on")}</label>
      </div>
      ${labelled(`${f}-sound-device`, t("zone.sound_device"), select(`${f}-sound-device`, "sound_device", zone.sound.device_id ?? "", [["", t("zone.sound_auto")], ...inZone.map((d): [string, string] => [d.id, d.name])]))}
    </div>
  </section>`;
  const preview = html`<aside class="canccu-studio-preview"><p class="canccu-overline">${t("zone.preview_title")}</p><div class="canccu-studio-thumb canccu-studio-thumb--preview"><iframe${attrs({ src: zoneFrame(zone.key), title: t("zone.preview_title"), "data-preview": true })}></iframe></div><button class="canccu-button canccu-button--secondary canccu-button--block" type="button" data-zone-preview>${t("zone.preview")}</button><p class="canccu-small canccu-muted">${t("zone.preview_hint")}</p></aside>`;
  const bar = html`<div class="canccu-studio-savebar"><button class="canccu-button canccu-button--primary canccu-button--lg" type="submit">${t("zone.save")}</button><span class="canccu-small canccu-muted">${t("zone.undo_hint")}</span><button${attrs({ class: "canccu-button canccu-button--danger-ghost", type: "button", "data-call": "DELETE", "data-url": `/api/screen/zones/${encodeURIComponent(zone.key)}`, "data-confirm": t("zone.delete_confirm", { zone: zone.name }), "data-next": `${STUDIO}zones` })}>${t("zone.delete")}</button></div>`;
  const row = html`<template data-widget-row>${widgetRow(c, { widget: "" })}</template>`;
  return html`<form class="canccu-studio-editor" ${attrs({ "data-zone": JSON.stringify(zone) })}>
    <div class="canccu-studio-editor__form">${settings}${regions}</div>
    ${preview}${bar}${row}
  </form>`;
}

const SOURCES: Record<string, MessageKey> = {
  admin: "ticker.from.admin",
  bot: "ticker.from.bot",
  window: "ticker.from.window",
};

export function tickerView(c: ViewContext, now: TickerNow): Html {
  const { t } = c;
  const source = now.source === null ? undefined : SOURCES[now.source];
  const showing =
    now.text === null
      ? html`<p class="canccu-muted">${t("ticker.nothing")}</p>`
      : html`<p class="canccu-studio-ticker-line">${t("ticker.showing", { text: now.text })}</p>
          <p class="canccu-small canccu-muted">
            ${[source ? t(source) : "", now.until ? t("ticker.until", { time: clockTime(now.until, c.timeZone) }) : t("ticker.no_end")].filter(Boolean).join(" · ")}
          </p>`;
  const choice = (value: string, key: MessageKey, checked = false) =>
    html`<label class="canccu-studio-choice"
      ><input type="radio" name="for" value="${value}" ${attrs({ checked })} /> ${t(key)}</label
    >`;
  const clear =
    now.source === "admin" || now.source === "bot"
      ? html`<button${attrs({ class: "canccu-button canccu-button--danger-ghost", type: "button", "data-call": "DELETE", "data-url": "/api/screen/ticker", "data-done": t("ticker.clear_done") })}>${t("ticker.clear")}</button>`
      : "";
  const form = html`<form class="canccu-card canccu-form" data-ticker>
    <div class="canccu-field">
      <label class="canccu-field__label" for="canccu-studio-ticker-text">${t("ticker.text")}</label
      ><textarea
        class="canccu-input"
        id="canccu-studio-ticker-text"
        name="text"
        required
        maxlength="280"
        rows="2"
        aria-describedby="canccu-studio-ticker-count"
      ></textarea>
      <p class="canccu-field__hint" id="canccu-studio-ticker-count" aria-live="polite">
        ${t("ticker.chars", { count: 0 })}
      </p>
    </div>
    <fieldset class="canccu-studio-choices">
      <legend class="canccu-field__label">${t("ticker.for")}</legend>
      ${choice("15", "ticker.15m")}${choice("60", "ticker.1h", true)}${choice("240", "ticker.4h")}${choice("at", "ticker.at")}${choice("none", "ticker.forever")}<input
        class="canccu-input canccu-studio-at"
        type="time"
        name="at"
        aria-label="${t("ticker.at")}"
      />
    </fieldset>
    <div class="canccu-cluster">
      <button class="canccu-button canccu-button--primary canccu-button--lg" type="submit">
        ${t("ticker.set")}</button
      >${clear}
    </div>
  </form>`;
  return html`<section class="canccu-card" data-live="ticker-now">${showing}</section>
    ${form}`;
}
