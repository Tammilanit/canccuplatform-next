/**
 * The Zones and zone editor pages (step 3 plan U6; mockup 08). The editor draws the zone's own
 * settings (`Zone.regions`) over the theme's grid: a map of the layout's regions, each with what
 * it shows in one line, and the chosen region's detail. The page script turns the form back into
 * a `Zone`, lists what changed, previews it in the real player and saves it with the revision read.
 */
import { attrs, emptyState, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { boxProblem } from "../compose/boxes.js";
import { DEFAULT_DWELL_S } from "../compose/build.js";
import { roleOf } from "../compose/layouts.js";
import type { Area, Layout } from "../compose/layouts.js";
import type { ZoneInput } from "../zone-input.js";
import type { SeenDevice } from "./help.js";
import { shownZone } from "./help.js";
import { boxPart, boxesCard, heroCard, layoutGallery, zoneTabs } from "./layout-views.js";
import type { BoxInfo } from "./layout-views.js";
import { counted, nameOf } from "./messages.js";
import { STUDIO, zoneFrame } from "./views.js";
import { labelled, photoWallPart, screenNamePart, select } from "./widget-settings.js";
import type { ViewContext } from "./views.js";
import {
  previewDialog,
  previewNotice,
  previewOnScreenButton,
  previewTimeField,
} from "./preview-view.js";

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

const screensOf = (key: string, devices: readonly SeenDevice[]): number =>
  devices.filter((d) => shownZone(d, devices) === key).length;

const ZONES_WRITE = "screen.zones.write";

export function zonesView(
  c: ViewContext,
  zones: readonly Zone[],
  devices: readonly SeenDevice[],
): Html {
  const { t } = c;
  const rows = zones.map((z) => {
    const layout =
      z.layout_id === null ? t("zones.theme_layout") : t("zones.layout", { layout: z.layout_id });
    // Only the name is the link; the key, layout and screens are its muted second line.
    const meta = [z.key, layout, counted(t, "zones.screens", screensOf(z.key, devices))];
    return html`<li class="canccu-list__row">
      <div class="canccu-list__main">
        <p class="canccu-list__title">
          <a href="${STUDIO}zones/${encodeURIComponent(z.key)}">${z.name}</a>
        </p>
        <p class="canccu-list__meta">${meta.join(" · ")}</p>
      </div>
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
  return html`${list}${c.rights.has(ZONES_WRITE) ? add : ""}`;
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

interface RegionInfo extends BoxInfo {
  entries: Entry[];
  own: boolean;
  settings: Entry;
  /** The layout's seconds for the region, shown when the zone sets none. */
  layoutDwell: number;
}

const shows = (c: ViewContext, r: { entries: Entry[] }): string =>
  r.entries.length === 0
    ? c.t("zone.region_empty")
    : r.entries
        .map((e) => nameOf(c.t, "widget", typeof e.widget === "string" ? e.widget : ""))
        .join(" → ");

const FRAME = new Set(["header", "ticker", "backdrop"]);

function regionsOf(c: ViewContext, zone: Zone, layout: Layout): RegionInfo[] {
  // The layout's regions first, in its order, then any the zone keeps for another layout.
  const ids = [
    ...layout.regions.map((r) => r.id),
    ...Object.keys(zone.regions).filter((id) => !layout.regions.some((r) => r.id === id)),
  ];
  // As the screens draw it: saved areas that stopped fitting give way to the layout's.
  const fit = boxProblem(layout, zone.regions) === null;
  return ids.map((id) => {
    const source = layout.regions.find((r) => r.id === id);
    const settings = (zone.regions[id] ?? {}) as Entry;
    const own = Array.isArray(settings.widgets);
    const entries = own
      ? (settings.widgets as Entry[])
      : ((source?.widgets ?? []) as unknown as Entry[]);
    const area =
      fit && source ? ((settings.area as Area | null | undefined) ?? undefined) : undefined;
    const r = {
      id,
      label: nameOf(c.t, "region", id),
      entries,
      own,
      settings,
      layoutDwell: source?.rotate_seconds ?? DEFAULT_DWELL_S,
      area: area ?? source?.area,
      layoutArea: source?.area,
      layer: source?.layer ?? 0,
      hidden: source !== undefined && settings.hidden === true,
      frame: FRAME.has(roleOf(id, settings.role) ?? ""),
      shows: "",
    };
    return { ...r, shows: shows(c, r) };
  });
}

/**
 * The chosen region's detail; the others wait hidden until picked on the map. `screenName` is the
 * zone's setting, drawn only with its (first) header box.
 */
function regionPart(
  c: ViewContext,
  r: RegionInfo,
  layout: Layout,
  shown: boolean,
  screenName: string | null,
): Html {
  const { t } = c;
  const f = `canccu-studio-r-${r.id}`;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const dwell = typeof r.settings.dwell_seconds === "number" ? r.settings.dwell_seconds : undefined;
  const regionDwell = dwell ?? r.layoutDwell;
  return html`<section
    class="canccu-card canccu-studio-region"
    ${attrs({ "data-region": r.id, "data-label": r.label, "data-layout-dwell": r.layoutDwell, hidden: !shown })}
  >
    <p class="canccu-overline">${t("box.selected")}</p>
    <h2 class="canccu-card__title">${t("zone.region", { region: r.label })}</h2>
    ${r.layoutArea === undefined ? "" : boxPart(c, r, layout)}
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
    ${screenName === null ? "" : screenNamePart(c, screenName)}
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
    ${photoWallPart(c, r.id, r.entries)}
  </section>`;
}

function settingsCard(c: ViewContext, zone: Zone, devices: readonly SeenDevice[]): Html {
  const { t } = c;
  const f = "canccu-studio-zone";
  const inZone = devices.filter((d) => d.zone_key === zone.key);
  return html`<section class="canccu-card canccu-studio-settings">
    ${labelled(`${f}-name`, t("zone.name"), html`<input class="canccu-input" id="${f}-name" name="name" required maxlength="80" ${attrs({ value: zone.name })} />`)}
    <div class="canccu-studio-row">
      ${labelled(
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

/**
 * The editor for `zone` as saved, drawn with `layoutId` when the crew picked another layout in
 * the gallery: Studio then clears the boxes' sizes and hidden boxes (contracts/screen.md, Box
 * sizes and hidden boxes), and the page saves the pick with the rest.
 */
export function zoneEditorView(
  c: ViewContext,
  zone: Zone,
  layouts: readonly Layout[],
  devices: readonly SeenDevice[],
  zones: readonly Zone[],
  layoutId: string | null = zone.layout_id,
): Html {
  const { t } = c;
  if (!c.rights.has(ZONES_WRITE)) {
    // Read only (an archived event): what the zone shows, without the editor.
    return html`${zoneTabs(c, zones, zone.key)}
      <section class="canccu-card">
        <h2 class="canccu-card__title">${t("zone.preview_title")}</h2>
        <div class="canccu-studio-thumb canccu-studio-thumb--preview"><iframe${attrs({ src: zoneFrame(zone.key), title: t("zone.preview_title") })}></iframe></div>
      </section>`;
  }
  const picked = layoutId !== zone.layout_id;
  const draft: Zone = picked
    ? {
        ...zone,
        layout_id: layoutId,
        regions: Object.fromEntries(
          Object.entries(zone.regions).flatMap(([id, settings]) => {
            const rest = Object.entries(settings).filter(([k]) => k !== "area" && k !== "hidden");
            return rest.length === 0 ? [] : [[id, Object.fromEntries(rest)]];
          }),
        ),
      }
    : zone;
  // A layout neither the theme nor the built-ins have draws the Pulse, as its screens do; the
  // routes always pass the built-ins, so the Pulse is there.
  const layout =
    layouts.find((l) => l.id === (layoutId ?? "pulse")) ?? layouts.find((l) => l.id === "pulse");
  if (layout === undefined) throw new Error("zoneEditorView needs the built-in layouts");
  const regions = regionsOf(c, draft, layout);
  // The hero first, as the mockup opens it: what most of the screen shows.
  const first =
    regions.find((r) => r.id === "hero" && r.area !== undefined && !r.hidden) ??
    regions.find((r) => r.area !== undefined && !r.hidden) ??
    regions[0];
  const header = regions.find((r) => roleOf(r.id, r.settings.role) === "header")?.id;
  const screens = screensOf(zone.key, devices);
  const save = screens === 0 ? t("zone.save_none") : counted(t, "zone.save_on", screens);
  const side = html`<aside class="canccu-studio-side">
    <section class="canccu-card">
      <h2 class="canccu-card__title">${t("zone.preview_title")}</h2>
      <div class="canccu-studio-thumb canccu-studio-thumb--preview"><iframe${attrs({ src: zoneFrame(zone.key), title: t("zone.preview_title"), "data-preview": true })}></iframe></div>
      ${previewTimeField(c)}
      <div class="canccu-studio-preview-row">
        <button class="canccu-button canccu-button--secondary" type="button" data-zone-preview>${t("zone.preview")}</button>
        ${previewOnScreenButton(c)}
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
  const names = Object.fromEntries(layouts.map((l) => [l.id, l.name]));
  const form = {
    "data-zone": JSON.stringify(zone),
    "data-layout": layoutId ?? "",
    "data-layout-names": JSON.stringify({ "": names.pulse ?? "pulse", ...names }),
    "data-region-names": JSON.stringify(Object.fromEntries(regions.map((r) => [r.id, r.label]))),
  };
  return html`${zoneTabs(c, zones, zone.key)}${previewNotice(c)}
    <form class="canccu-studio-editor" ${attrs(form)}>
      <div class="canccu-studio-editor__main">
        ${layoutGallery(c, layouts, layout.id)}${boxesCard(c, regions, layout, first?.id)}${regions.map((r) => regionPart(c, r, layout, r === first, r.id === header ? zone.screen_name : null))}${layout.id === "dashboard" ? heroCard(c, regions, layout, zone) : ""}${settingsCard(c, zone, devices)}${remove}
      </div>
      ${side}${row}
    </form>
    ${previewDialog(c, zone.key, devices)}`;
}
