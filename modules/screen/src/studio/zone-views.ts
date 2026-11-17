/**
 * The Zones and zone editor pages (step 3 plan U6; mockup 08). The editor draws the zone's own
 * settings (`Zone.regions`) over the theme's grid: a map of the layout's regions, each with what
 * it shows in one line, and the chosen region's detail. The page script turns the form back into
 * a `Zone`, lists what changed, previews it in the real player and saves it with the revision read.
 */
import { attrs, emptyState, html, notice } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { DEFAULT_DWELL_S } from "../compose/build.js";
import { roleOf } from "../compose/layouts.js";
import type { Layout } from "../compose/layouts.js";
import type { ZoneInput } from "../zone-input.js";
import type { SeenDevice } from "./help.js";
import { shownZone } from "./help.js";
import { boxesCard, heroCard, layoutGallery, zoneTabs } from "./layout-views.js";
import { counted } from "./messages.js";
import { regionPart, regionsOf, widgetRow } from "./region-views.js";
import { STUDIO, zoneFrame } from "./views.js";
import { labelled, select } from "./widget-settings.js";
import type { ViewContext } from "./views.js";
import {
  previewDialog,
  previewNotice,
  previewOnScreenButton,
  previewTimeField,
} from "./preview-view.js";

export type Zone = Omit<ZoneInput, "revision"> & { revision: number };

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
 * sizes and hidden boxes), and the page saves the pick with the rest. It clears them too for a
 * layout gone missing, whose region ids may name other boxes of the Pulse drawn instead.
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
  // A layout neither the theme nor the built-ins have draws the Pulse, as its screens do; the
  // routes always pass the built-ins, so the Pulse is there.
  const found = layouts.find((l) => l.id === (layoutId ?? "pulse"));
  const layout = found ?? layouts.find((l) => l.id === "pulse");
  if (layout === undefined) throw new Error("zoneEditorView needs the built-in layouts");
  const draft: Zone =
    layoutId !== zone.layout_id || found === undefined
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
    // What the previews compose instead of a missing layout, which their routes refuse.
    "data-layout-drawn": found ? undefined : layout.id,
    "data-layout-names": JSON.stringify({ "": names.pulse ?? "pulse", ...names }),
    "data-region-names": JSON.stringify(Object.fromEntries(regions.map((r) => [r.id, r.label]))),
  };
  const missing = found
    ? ""
    : notice({
        kind: "warn",
        title: t("zone.layout_missing", { layout: String(layoutId) }),
        text: t("zone.layout_missing_text", { layout: layout.name }),
      });
  return html`${zoneTabs(c, zones, zone.key)}${previewNotice(c)}${missing}
    <form class="canccu-studio-editor" ${attrs(form)}>
      <div class="canccu-studio-editor__main">
        ${layoutGallery(c, layouts, layout.id, draft.regions)}${boxesCard(c, regions, layout, first?.id)}${regions.map((r) => regionPart(c, r, layout, r === first, r.id === header ? zone.screen_name : null))}${layout.id === "dashboard" ? heroCard(c, regions, layout, zone) : ""}${settingsCard(c, zone, devices)}${remove}
      </div>
      ${side}${row}
    </form>
    ${previewDialog(c, zone.key, devices)}`;
}
