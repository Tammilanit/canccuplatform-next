/**
 * A zone editor's regions (zone-views.ts): each region's widgets and settings as the zone saves
 * them, and the chosen region's detail card.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { boxProblem } from "../compose/boxes.js";
import { DEFAULT_DWELL_S } from "../compose/build.js";
import { roleOf } from "../compose/layouts.js";
import type { Area, Layout } from "../compose/layouts.js";
import { boxPart } from "./layout-views.js";
import type { BoxInfo } from "./layout-views.js";
import { nameOf } from "./messages.js";
import type { ViewContext } from "./views.js";
import {
  labelled,
  photoWallPart,
  rotationPart,
  screenNamePart,
  select,
} from "./widget-settings.js";
import type { Zone } from "./zone-views.js";

type Entry = Record<string, unknown>;

/** What Studio offers to add to a region; `embed` needs a theme embed, so it is kept, not offered. */
export const WIDGETS = [
  "playlist",
  "photo",
  "agenda_timeline",
  "food_status",
  "leaderboard",
  "now_playing",
  "stats",
  "agenda_now",
  "countdown",
  "clock",
  "logo",
  "qr",
  "venue_info",
  "checkin_qr",
  "ticker",
  "today_numbers",
] as const;

/** A widget's own seconds, or undefined: the caller falls back to the region's. */
const ownDwell = (entry: Entry): number | undefined => {
  const seconds = (entry.props as Entry | undefined)?.dwell_seconds;
  return typeof seconds === "number" ? seconds : undefined;
};

/**
 * One widget: a drag handle, its name in words, its seconds, a switch that keeps it in its place
 * while it is off (#787 D3), and move and remove buttons.
 */
export function widgetRow(c: ViewContext, entry: Entry, regionDwell: number): Html {
  const { t } = c;
  const name = typeof entry.widget === "string" ? entry.widget : "";
  const own = ownDwell(entry) !== undefined;
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
  const on = entry.enabled !== false;
  return html`<li
    class="canccu-studio-widget${on ? "" : " canccu-studio-widget--off"}"
    draggable="true"
    ${attrs({ "data-entry": JSON.stringify(entry), "data-own-dwell": own })}
  >
    <span class="canccu-studio-widget__handle" title="${t("zone.handle")}" aria-hidden="true"></span
    ><span class="canccu-studio-widget__name">${nameOf(t, "widget", name)}</span
    ><span class="canccu-studio-widget__meta canccu-small canccu-muted"
      >${t("zone.widget_dwell", { seconds: ownDwell(entry) ?? regionDwell })}</span
    ><input
      class="canccu-switch"
      type="checkbox"
      data-widget-on
      ${attrs({ checked: on, "aria-label": t("zone.widget_on"), title: t("zone.widget_on") })}
    />${button("up", "left", t("zone.up"))}${button("down", "right", t("zone.down"))}${button("remove", "close", t("zone.remove"))}
  </li>`;
}

/** The hero's turn, 30–60 s (#787 D4): chips, not a typed number; the field keeps the choice. */
const HERO_DWELLS = [30, 45, 60];

function heroDwellPart(c: ViewContext, f: string, dwell: number | undefined, layoutDwell: number) {
  const { t } = c;
  const picked = dwell ?? layoutDwell;
  return html`<div class="canccu-field">
    <label class="canccu-field__label" for="${f}-dwell">${t("zone.hero_dwell")}</label>
    <input type="hidden" id="${f}-dwell" name="dwell_seconds" ${attrs({ value: dwell })} />
    <div class="canccu-chips" role="group" aria-label="${t("zone.hero_dwell")}">
      ${HERO_DWELLS.map(
        (s) =>
          html`<button
            class="canccu-chip"
            type="button"
            ${attrs({ "data-dwell-chip": s, "aria-pressed": String(s === picked) })}
          >
            ${t("zone.dwell_chip", { seconds: s })}
          </button>`,
      )}
    </div>
    <p class="canccu-field__hint">${t("zone.hero_dwell_hint", { seconds: layoutDwell })}</p>
  </div>`;
}

export interface RegionInfo extends BoxInfo {
  entries: Entry[];
  own: boolean;
  settings: Entry;
  /** The layout's seconds for the region, shown when the zone sets none. */
  layoutDwell: number;
}

/** The box's summary on the map: the items it plays, so a switched-off one is left out. */
const shows = (c: ViewContext, r: { entries: Entry[] }): string => {
  const on = r.entries.filter((e) => e.enabled !== false);
  return on.length === 0
    ? c.t("zone.region_empty")
    : on
        .map((e) => nameOf(c.t, "widget", typeof e.widget === "string" ? e.widget : ""))
        .join(" → ");
};

const FRAME = new Set(["header", "ticker", "backdrop"]);

export function regionsOf(c: ViewContext, zone: Zone, layout: Layout): RegionInfo[] {
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
export function regionPart(
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
  const hero = roleOf(r.id, r.settings.role) === "hero";
  return html`<section
    class="canccu-card canccu-studio-region"
    ${attrs({ "data-region": r.id, "data-label": r.label, "data-layout-dwell": r.layoutDwell, "data-rotation": hero ? "director" : "sequence", hidden: !shown })}
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
      ${rotationPart(c, f, r.settings, hero)}${hero ? heroDwellPart(c, f, dwell, r.layoutDwell) : labelled(`${f}-dwell`, t("zone.dwell"), html`<input class="canccu-input" type="number" min="5" max="3600" step="1" id="${f}-dwell" name="dwell_seconds" ${attrs({ value: dwell, placeholder: String(r.layoutDwell) })} />`, t("zone.dwell_hint", { seconds: r.layoutDwell }))}${labelled(
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
