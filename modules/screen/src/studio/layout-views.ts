/**
 * Screen studio → Zones and layouts (#405; v8 sheet 10, the lower frames): the zone tabs, the
 * layout gallery, the layout's boxes drawn to scale with the chosen box's size and Hide, and for
 * Dashboard the hero role. Places are set by static/studio-layout.js from `data-area` (the CSP
 * allows no inline style); its geometry is static/studio-boxes.js.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { Area, Layout } from "../compose/layouts.js";
import { hasStatisticsBoxes } from "../compose/waiting.js";
import { STUDIO } from "./views.js";
import type { ViewContext } from "./views.js";

/** A region of the zone as a box on the layout's grid; no `layoutArea`: kept for another layout. */
export interface BoxInfo {
  id: string;
  label: string;
  shows: string;
  /** Where it is drawn: the zone's own area, else the layout's. */
  area: Area | undefined;
  layoutArea: Area | undefined;
  layer: number;
  hidden: boolean;
  /** A header, ticker or backdrop: never the hero's box, and never grown into a hidden box. */
  frame: boolean;
}

const gridArea = (a: Area): string => `${a.row} / ${a.column} / span ${a.rows} / span ${a.columns}`;
const gridOf = (layout: Layout): string => `${layout.grid.columns} ${layout.grid.rows}`;

export function zoneTabs(
  c: ViewContext,
  zones: readonly { key: string; name: string }[],
  current: string,
): Html {
  return html`<nav class="canccu-studio-zonetabs" aria-label="${c.t("zone.tabs")}">
    ${zones.map(
      (z) =>
        html`<a
          ${attrs({ href: `${STUDIO}zones/${encodeURIComponent(z.key)}`, "aria-current": z.key === current ? "page" : undefined })}
          >${z.name}</a
        >`,
    )}
  </nav>`;
}

/** A layout's boxes in miniature, at its own shape. */
const thumb = (layout: Layout): Html =>
  html`<span
    class="canccu-studio-lay${layout.aspect === "9:16" ? " canccu-studio-lay--portrait" : ""}"
    data-grid="${gridOf(layout)}"
    aria-hidden="true"
    >${layout.regions.map((r) => html`<i data-area="${gridArea(r.area)}"></i>`)}</span
  >`;

/**
 * Thumbnails of the built-ins and the theme's layouts; picking one redraws the editor with it. A
 * layout with statistics boxes says they come with the bot's data, and, once picked, where their
 * space goes until then (contracts/screen.md, Boxes waiting for their source).
 */
export function layoutGallery(c: ViewContext, layouts: readonly Layout[], current: string): Html {
  const { t } = c;
  const picked = layouts.find((l) => l.id === current);
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("layout.title")}</h2>
    <p class="canccu-card__desc">${t("layout.desc")}</p>
    <div class="canccu-studio-laypick">
      ${layouts.map(
        (l) =>
          html`<a
            class="canccu-studio-laypick__item"
            ${attrs({ href: `?layout=${encodeURIComponent(l.id)}`, "data-layout-pick": l.id, "aria-current": l.id === current ? "true" : undefined, "aria-label": t("layout.pick", { layout: l.name }) })}
            >${thumb(l)}<span class="canccu-studio-laypick__name">${l.name}</span>${
              hasStatisticsBoxes(l)
                ? html`<span class="canccu-studio-laypick__note">${t("layout.statistics")}</span>`
                : ""
            }</a
          >`,
      )}
    </div>
    ${
      picked !== undefined && hasStatisticsBoxes(picked)
        ? html`<p class="canccu-field__hint" data-statistics-note>
            ${t("layout.statistics_waiting", { layout: picked.name })}
          </p>`
        : ""
    }
  </section>`;
}

const HANDLES = ["left", "right", "top", "bottom"] as const;

function box(c: ViewContext, b: BoxInfo, picked: string | undefined): Html {
  const data =
    b.area === undefined
      ? {}
      : {
          "data-area": gridArea(b.area),
          "data-box": JSON.stringify({
            area: b.area,
            layoutArea: b.layoutArea,
            layer: b.layer,
            frame: b.frame,
            hidden: b.hidden,
          }),
        };
  return html`<button
    type="button"
    class="canccu-studio-map__region"
    ${attrs({ "data-pick": b.id, "aria-pressed": b.id === picked ? "true" : "false", hidden: b.hidden, ...data })}
  >
    <span class="canccu-studio-map__name">${b.label}</span
    ><span class="canccu-studio-map__shows" data-shows>${b.shows}</span>${
      b.area === undefined
        ? ""
        : HANDLES.map(
            (edge) =>
              html`<span
                class="canccu-studio-handle canccu-studio-handle--${edge}"
                data-edge="${edge}"
                title="${c.t("boxes.handle", { box: b.label })}"
                aria-hidden="true"
              ></span>`,
          )
    }
  </button>`;
}

/** The layout's boxes to scale; a region the zone keeps for another layout follows the grid. */
export function boxesCard(
  c: ViewContext,
  boxes: readonly BoxInfo[],
  layout: Layout,
  picked: string | undefined,
): Html {
  const { t } = c;
  // A region the zone keeps for another layout has no place on this grid: it follows it.
  const placed = boxes.filter((b) => b.area !== undefined);
  const kept = boxes.filter((b) => b.area === undefined);
  const portrait = layout.aspect === "9:16";
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("boxes.title")}</h2>
    <p class="canccu-card__desc canccu-studio-desk">${t("boxes.desc")}</p>
    <p class="canccu-card__desc canccu-studio-phone">${t("boxes.desc_phone")}</p>
    <div
      class="canccu-studio-map canccu-studio-boxes${portrait ? " canccu-studio-map--portrait" : ""}"
      data-grid="${gridOf(layout)}"
      data-boxes
    >
      ${placed.map((b) => box(c, b, picked))}
    </div>
    ${
      kept.length === 0
        ? ""
        : html`<div class="canccu-studio-hidden">
            <p class="canccu-overline">${t("boxes.kept")}</p>
            ${kept.map((b) => box(c, b, picked))}
          </div>`
    }
    <div
      class="canccu-studio-hidden"
      data-hidden-boxes
      ${attrs({ hidden: !boxes.some((b) => b.hidden) })}
    >
      <p class="canccu-overline">${t("boxes.hidden")}</p>
      ${boxes
        .filter((b) => b.area !== undefined)
        .map(
          (b) =>
            html`<button
              class="canccu-button canccu-button--secondary canccu-button--sm"
              type="button"
              ${attrs({ "data-show-box": b.id, hidden: !b.hidden })}
            >
              ${t("boxes.show", { box: b.label })}
            </button>`,
        )}
    </div>
    <button
      class="canccu-button canccu-button--danger-ghost canccu-button--sm"
      type="button"
      data-boxes-reset
    >
      ${t("boxes.reset")}
    </button>
  </section>`;
}

/** The chosen box's Size and Hide, inside its region detail. */
export function boxPart(c: ViewContext, b: BoxInfo, layout: Layout): Html {
  const { t } = c;
  const grid = { columns: layout.grid.columns, rows: layout.grid.rows };
  const id = `canccu-studio-r-${b.id}-hide`;
  const size = (how: string) =>
    html`<button
      class="canccu-button canccu-button--secondary canccu-button--sm"
      type="button"
      data-size="${how}"
    >
      ${t(`box.${how}` as "box.wider")}
    </button>`;
  return html`<div class="canccu-field">
      <span class="canccu-field__label">${t("box.size")}</span>
      <div class="canccu-cluster">
        ${size("narrower")}${size("wider")}${size("shorter")}${size("taller")}
      </div>
      <p class="canccu-field__hint canccu-studio-desk">${t("box.size_hint", grid)}</p>
      <p class="canccu-field__hint canccu-studio-phone">${t("box.size_hint_phone", grid)}</p>
    </div>
    <div class="canccu-field canccu-field--check">
      <input
        class="canccu-check"
        type="checkbox"
        id="${id}"
        data-box-hide
        ${attrs({ checked: b.hidden })}
      />
      <label class="canccu-field__label" for="${id}">${t("box.hide")}</label>
      <p class="canccu-field__hint">${t("box.hide_hint")}</p>
    </div>`;
}

/** Dashboard's hero role (`hero_region`) and "Grow for a showcase" (sheet 10, last frame). */
export function heroCard(
  c: ViewContext,
  boxes: readonly BoxInfo[],
  layout: Layout,
  zone: { name: string; hero_region: string | null; grow_for_showcase: boolean },
): Html {
  const { t } = c;
  const holder = zone.hero_region ?? "hero";
  const offered = boxes.filter((b) => b.area !== undefined && !b.frame);
  const f = "canccu-studio-grow";
  return html`<section class="canccu-card" data-hero-card>
    <p class="canccu-overline">${t("hero.overline", { layout: layout.name, zone: zone.name })}</p>
    <h2 class="canccu-card__title">${t("hero.title")}</h2>
    <div class="canccu-studio-map canccu-studio-hero" data-grid="${gridOf(layout)}">
      ${offered.map(
        (b) =>
          html`<button
            type="button"
            class="canccu-studio-map__region"
            ${attrs({ "data-hero": b.id, "data-area": gridArea(b.area as Area), "aria-pressed": b.id === holder ? "true" : "false", hidden: b.hidden })}
          >
            <span class="canccu-studio-map__name">${b.label}</span
            ><span class="canccu-studio-map__shows" data-hero-role>${t("hero.role")}</span>
          </button>`,
      )}
    </div>
    <p class="canccu-field__hint">${t("hero.hint")}</p>
    <div class="canccu-field canccu-field--check">
      <input
        class="canccu-check"
        type="checkbox"
        id="${f}"
        name="grow_for_showcase"
        ${attrs({ checked: zone.grow_for_showcase })}
      />
      <label class="canccu-field__label" for="${f}">${t("hero.grow")}</label>
      <p class="canccu-field__hint">${t("hero.grow_hint")}</p>
    </div>
  </section>`;
}
