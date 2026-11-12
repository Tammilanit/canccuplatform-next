/**
 * The Zones and zone editor pages (step 3 plan U6; mockup 08). The editor draws the zone's own
 * settings (`Zone.regions`) over the theme's grid: a map of the layout's regions, each with what
 * it shows in one line, and the chosen region's detail. The page script turns the form back into
 * a `Zone`, lists what changed, previews it in the real player and saves it with the revision read.
 */
import { attrs, emptyState, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { DEFAULT_DWELL_S } from "../compose/build.js";
import type { Layout, LayoutRegion } from "../compose/layouts.js";
import type { ZoneInput } from "../zone-input.js";
import type { SeenDevice } from "./help.js";
import { shownZone } from "./help.js";
import { counted, nameOf } from "./messages.js";
import { STUDIO, zoneFrame } from "./views.js";
import type { ViewContext } from "./views.js";

export type Zone = Omit<ZoneInput, "revision"> & { revision: number };
type Entry = Record<string, unknown>;

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
  label?: string,
): Html =>
  html`<select class="canccu-input" id="${id}" name="${name}" ${attrs({ "aria-label": label })}>
    ${options.map(([v, label]) => html`<option${attrs({ value: v, selected: v === value })}>${label}</option>`)}
  </select>`;

const labelled = (id: string, label: string, control: Slot, hint?: string): Html =>
  html`<div class="canccu-field">
    <label class="canccu-field__label" for="${id}">${label}</label
    >${control}${hint === undefined ? "" : html`<p class="canccu-field__hint">${hint}</p>`}
  </div>`;

const screensOf = (key: string, devices: readonly SeenDevice[]): number =>
  devices.filter((d) => shownZone(d, devices) === key).length;

export function zonesView(
  c: ViewContext,
  zones: readonly Zone[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const rows = zones.map((z) => {
    const layout =
      z.layout_id === null ? t("zones.theme_layout") : t("zones.layout", { layout: z.layout_id });
    return html`<li class="canccu-list__row">
      <a class="canccu-list__main" href="${STUDIO}zones/${encodeURIComponent(z.key)}"
        ><span class="canccu-list__title">${z.name}</span
        ><span class="canccu-list__meta">${z.key} · ${layout}</span></a
      ><span class="canccu-list__end canccu-small"
        >${counted(t, "zones.screens", screensOf(z.key, devices))}</span
      >
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
      ${labelled("canccu-studio-zone-key", t("zones.new_key"), html`<input class="canccu-input" id="canccu-studio-zone-key" name="key" required pattern="[a-z0-9][a-z0-9_\\-]{1,31}" />`, t("zones.new_key_hint"))}
      <button class="canccu-button canccu-button--primary" type="submit">${t("zones.add")}</button>
    </form>
  </section>`;
  return html`${list}${add}`;
}

/** The seconds a widget shows: its own, else the region's, else the layout's default. */
const dwellOf = (entry: Entry, regionDwell: number): number =>
  typeof (entry.props as Entry | undefined)?.dwell_seconds === "number"
    ? ((entry.props as Entry).dwell_seconds as number)
    : regionDwell;

/** One widget: a drag handle, its name in words, its seconds, and move and remove buttons. */
function widgetRow(c: ViewContext, entry: Entry, regionDwell: number): Html {
  const { t } = c;
  const name = typeof entry.widget === "string" ? entry.widget : "";
  const own = typeof (entry.props as Entry | undefined)?.dwell_seconds === "number";
  const button = (action: string, iconName: string, label: string) =>
    html`<button
      class="canccu-button canccu-button--ghost canccu-button--sm canccu-studio-icon canccu-studio-icon--${action}"
      type="button"
      data-widget-move="${action}"
      aria-label="${label}"
      title="${label}"
    >
      <span class="canccu-i canccu-i--${iconName}" aria-hidden="true"></span>
    </button>`;
  return html`<li
    class="canccu-studio-widget"
    draggable="true"
    ${attrs({ "data-entry": JSON.stringify(entry), "data-own-dwell": own })}
  >
    <span class="canccu-studio-widget__handle" title="${t("zone.handle")}" aria-hidden="true"></span
    ><span class="canccu-studio-widget__name">${nameOf(t, "widget", name)}</span
    ><span class="canccu-studio-widget__meta canccu-small canccu-muted"
      >${t("zone.widget_dwell", { seconds: dwellOf(entry, regionDwell) })}</span
    >${button("up", "left", t("zone.up"))}${button("down", "right", t("zone.down"))}${button("remove", "close", t("zone.remove"))}
  </li>`;
}

interface RegionInfo {
  id: string;
  label: string;
  entries: Entry[];
  own: boolean;
  settings: Entry;
  /** The layout's seconds for the region, shown when the zone sets none. */
  layoutDwell: number;
  area: LayoutRegion["area"] | undefined;
}

function regionsOf(c: ViewContext, zone: Zone, layout: Layout | undefined): RegionInfo[] {
  // The layout's regions first, in its order, then any the zone keeps for another layout.
  const ids = [
    ...(layout?.regions.map((r) => r.id) ?? []),
    ...Object.keys(zone.regions).filter((id) => !layout?.regions.some((r) => r.id === id)),
  ];
  return ids.map((id) => {
    const source = layout?.regions.find((r) => r.id === id);
    const settings = (zone.regions[id] ?? {}) as Entry;
    const own = Array.isArray(settings.widgets);
    return {
      id,
      label: nameOf(c.t, "region", id),
      entries: own
        ? (settings.widgets as Entry[])
        : ((source?.widgets ?? []) as unknown as Entry[]),
      own,
      settings,
      layoutDwell: source?.rotate_seconds ?? DEFAULT_DWELL_S,
      area: source?.area,
    };
  });
}

const shows = (c: ViewContext, r: RegionInfo): string =>
  r.entries.length === 0
    ? c.t("zone.region_empty")
    : r.entries
        .map((e) => nameOf(c.t, "widget", typeof e.widget === "string" ? e.widget : ""))
        .join(" → ");

/** All regions at a glance on the layout's grid (placed by the page script; CSP has no inline style). */
function regionMap(
  c: ViewContext,
  regions: RegionInfo[],
  layout: Layout | undefined,
  picked: string | undefined,
): Html {
  const { t } = c;
  // A region the zone keeps for another layout has no place on this grid: it follows the map.
  const placed = [...regions].sort(
    (a, b) => Number(a.area === undefined) - Number(b.area === undefined),
  );
  const buttons = placed.map(
    (r) =>
      html`<button
        type="button"
        class="canccu-studio-map__region"
        ${attrs({ "data-pick": r.id, "aria-pressed": r.id === picked ? "true" : "false", "data-area": r.area ? `${r.area.row} / ${r.area.column} / span ${r.area.rows} / span ${r.area.columns}` : undefined })}
      >
        <span class="canccu-studio-map__name">${r.label}</span
        ><span class="canccu-studio-map__shows" data-shows>${shows(c, r)}</span>
      </button>`,
  );
  const portrait = layout?.aspect === "9:16";
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("zone.regions")}</h2>
    <p class="canccu-card__desc">${t("zone.regions_desc")}</p>
    <div
      class="canccu-studio-map${portrait ? " canccu-studio-map--portrait" : ""}"
      ${attrs({ "data-grid": layout ? `${layout.grid.columns} ${layout.grid.rows}` : undefined })}
    >
      ${buttons}
    </div>
  </section>`;
}

/** The chosen region's detail; the others wait hidden until picked on the map. */
function regionPart(c: ViewContext, r: RegionInfo, shown: boolean): Html {
  const { t } = c;
  const f = `canccu-studio-r-${r.id}`;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const dwell = typeof r.settings.dwell_seconds === "number" ? r.settings.dwell_seconds : undefined;
  const regionDwell = dwell ?? r.layoutDwell;
  return html`<section
    class="canccu-card canccu-studio-region"
    ${attrs({ "data-region": r.id, "data-label": r.label, "data-layout-dwell": r.layoutDwell, hidden: !shown })}
  >
    <h2 class="canccu-card__title">${t("zone.region", { region: r.label })}</h2>
    <div class="canccu-field canccu-field--check">
      <input
        class="canccu-check"
        type="checkbox"
        id="${f}-layout"
        name="layout_widgets"
        ${attrs({ checked: !r.own })}
      />
      <label class="canccu-field__label" for="${f}-layout">${t("zone.layout_widgets")}</label>
    </div>
    <p class="canccu-overline">${t("zone.widgets")}</p>
    <ol class="canccu-studio-widgets" data-widgets>
      ${r.entries.map((e) => widgetRow(c, e, regionDwell))}
    </ol>
    <div class="canccu-studio-add">
      ${select(
        `${f}-add`,
        "add",
        "",
        WIDGETS.map((w) => [w, nameOf(t, "widget", w)]),
        t("zone.add_widget"),
      )}<button
        class="canccu-button canccu-button--secondary canccu-button--sm"
        type="button"
        data-widget-add
      >
        <span class="canccu-i canccu-i--plus" aria-hidden="true"></span>${t("zone.add_widget")}
      </button>
    </div>
    <div class="canccu-studio-row">
      ${labelled(
        `${f}-rotation`,
        t("zone.rotation"),
        select(`${f}-rotation`, "rotation", str(r.settings.rotation), [
          ["", t("zone.rotation.sequence")],
          ["shuffle", t("zone.rotation.shuffle")],
        ]),
      )}${labelled(`${f}-dwell`, t("zone.dwell"), html`<input class="canccu-input" type="number" min="5" max="3600" step="1" id="${f}-dwell" name="dwell_seconds" ${attrs({ value: dwell, placeholder: String(r.layoutDwell) })} />`, t("zone.dwell_hint", { seconds: r.layoutDwell }))}${labelled(
        `${f}-idle`,
        t("zone.idle"),
        select(`${f}-idle`, "idle", str(r.settings.idle), [
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
        ${attrs({ checked: r.settings.skip_empty !== false })}
      />
      <label class="canccu-field__label" for="${f}-skip">${t("zone.skip_empty")}</label>
    </div>
  </section>`;
}

function settingsCard(
  c: ViewContext,
  zone: Zone,
  layouts: readonly Layout[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const f = "canccu-studio-zone";
  const layoutOptions: [string, string][] = [
    ["", t("zone.layout_default")],
    ...layouts.map((l): [string, string] => [l.id, l.name]),
    ...(zone.layout_id !== null && !layouts.some((l) => l.id === zone.layout_id)
      ? [[zone.layout_id, zone.layout_id] as [string, string]]
      : []),
  ];
  const inZone = devices.filter((d) => d.zone_key === zone.key);
  return html`<section class="canccu-card canccu-studio-settings">
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
    <div class="canccu-studio-row canccu-studio-row--end">
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
}

export function zoneEditorView(
  c: ViewContext,
  zone: Zone,
  layouts: readonly Layout[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const layout = layouts.find((l) => l.id === (zone.layout_id ?? "pulse")) ?? layouts[0];
  const regions = regionsOf(c, zone, layout);
  // The hero first, as the mockup opens it: what most of the screen shows.
  const first =
    regions.find((r) => r.id === "hero" && r.area !== undefined) ??
    regions.find((r) => r.area !== undefined) ??
    regions[0];
  const screens = screensOf(zone.key, devices);
  const save = screens === 0 ? t("zone.save_none") : counted(t, "zone.save_on", screens);
  const side = html`<aside class="canccu-studio-side">
    <section class="canccu-card">
      <h2 class="canccu-card__title">${t("zone.preview_title")}</h2>
      <div class="canccu-studio-thumb canccu-studio-thumb--preview"><iframe${attrs({ src: zoneFrame(zone.key), title: t("zone.preview_title"), "data-preview": true })}></iframe></div>
      <div class="canccu-studio-preview-row">
        <button class="canccu-button canccu-button--secondary" type="button" data-zone-preview>${t("zone.preview")}</button>
        <p class="canccu-small canccu-muted">${t("zone.preview_hint")}</p>
      </div>
    </section>
    <section class="canccu-card">
      <h2 class="canccu-card__title">${t("zone.changes")}</h2>
      <ul class="canccu-studio-changes canccu-small" data-changes>
        <li class="canccu-muted">${t("change.none")}</li>
      </ul>
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--secondary" type="button" data-discard disabled>${t("zone.discard")}</button
        ><button class="canccu-button canccu-button--primary" type="submit" data-save disabled>${save}</button>
      </div>
      <p class="canccu-small canccu-muted">${t("zone.undo_hint")}</p>
    </section>
  </aside>`;
  const remove = html`<div class="canccu-studio-remove"><button${attrs({ class: "canccu-button canccu-button--danger-ghost", type: "button", "data-call": "DELETE", "data-url": `/api/screen/zones/${encodeURIComponent(zone.key)}`, "data-confirm": t("zone.delete_confirm", { zone: zone.name }), "data-next": `${STUDIO}zones` })}>${t("zone.delete")}</button></div>`;
  const row = html`<template data-widget-row
    >${widgetRow(c, { widget: "" }, DEFAULT_DWELL_S)}</template
  >`;
  return html`<form class="canccu-studio-editor" ${attrs({ "data-zone": JSON.stringify(zone) })}>
    <div class="canccu-studio-editor__main">
      ${settingsCard(c, zone, layouts, devices)}${regionMap(c, regions, layout, first?.id)}${regions.map((r) => regionPart(c, r, r === first))}${remove}
    </div>
    ${side}${row}
  </form>`;
}
