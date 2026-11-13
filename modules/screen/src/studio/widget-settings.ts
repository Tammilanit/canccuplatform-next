/**
 * Settings Studio shows with the selected box's (sheet 16): the zone's screen name with its header
 * box, and the photo wall's props with a box that shows photos (contracts/screen.md, Header and
 * hub QR, `screen_name`; Photos). The field helpers are shared with zone-views.ts.
 */
import { attrs, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { WALL_DEFAULTS, wallSettings } from "../compose/photos.js";
import type { Props } from "../compose/layouts.js";
import type { ViewContext } from "./views.js";

export const WIDGET_SETTINGS_EN = {
  "screen_name.label": "Screen name",
  "screen_name.hint": "Names this zone in the header, so people can tell the screens apart.",
  "screen_name.auto": "Automatic (hidden with one screen)",
  "screen_name.always": "Always",
  "screen_name.never": "Never",
  "photo_wall.title": "Photo wall",
  "photo_wall.seconds": "Seconds per photo",
  "photo_wall.seconds_hint": "5 to 60 seconds.",
  "photo_wall.order": "Order",
  "photo_wall.order.newest": "Newest first",
  "photo_wall.order.oldest": "Oldest first",
  "photo_wall.order.shuffle": "Shuffle",
  "photo_wall.pop_new": "New photo pops in large",
} as const;

export const select = (
  id: string,
  name: string,
  value: string,
  options: readonly [string, string][],
  label?: string,
): Html =>
  html`<select class="canccu-input" id="${id}" name="${name}" ${attrs({ "aria-label": label })}>
    ${options.map(([v, label]) => html`<option${attrs({ value: v, selected: v === value })}>${label}</option>`)}
  </select>`;

export const labelled = (id: string, label: string, control: Slot, hint?: string): Html =>
  html`<div class="canccu-field">
    <label class="canccu-field__label" for="${id}">${label}</label
    >${control}${hint === undefined ? "" : html`<p class="canccu-field__hint">${hint}</p>`}
  </div>`;

/** The zone's `screen_name`, drawn with its header box. */
export function screenNamePart(c: ViewContext, value: string): Html {
  const { t } = c;
  const id = "canccu-studio-screen-name";
  return labelled(
    id,
    t("screen_name.label"),
    select(id, "screen_name", value, [
      ["auto", t("screen_name.auto")],
      ["always", t("screen_name.always")],
      ["never", t("screen_name.never")],
    ]),
    t("screen_name.hint"),
  );
}

/**
 * The photo wall's props for one box, from its first `photo` entry; studio-zone.js writes them to
 * every `photo` entry of the box and shows the part only while the box lists a photo.
 */
export function photoWallPart(
  c: ViewContext,
  regionId: string,
  entries: readonly Record<string, unknown>[],
): Html {
  const { t } = c;
  const photo = entries.find((e) => e.widget === "photo");
  const props = (photo?.props ?? {}) as Props;
  const s = wallSettings(props);
  const f = `canccu-studio-r-${regionId}-wall`;
  const seconds = typeof props.photo_seconds === "number" ? s.seconds : undefined;
  return html`<fieldset
    class="canccu-studio-wall"
    data-photo-wall
    ${attrs({ hidden: photo === undefined })}
  >
    <legend class="canccu-overline">${t("photo_wall.title")}</legend>
    <div class="canccu-studio-row">
      ${labelled(`${f}-seconds`, t("photo_wall.seconds"), html`<input class="canccu-input" type="number" min="5" max="60" step="1" id="${f}-seconds" name="photo_seconds" ${attrs({ value: seconds, placeholder: String(WALL_DEFAULTS.seconds) })} />`, t("photo_wall.seconds_hint"))}${labelled(
        `${f}-order`,
        t("photo_wall.order"),
        select(`${f}-order`, "photo_order", s.order, [
          ["newest", t("photo_wall.order.newest")],
          ["oldest", t("photo_wall.order.oldest")],
          ["shuffle", t("photo_wall.order.shuffle")],
        ]),
      )}
    </div>
    <div class="canccu-field canccu-field--check">
      <input
        class="canccu-check"
        type="checkbox"
        id="${f}-pop"
        name="pop_new"
        ${attrs({ checked: s.popNew })}
      />
      <label class="canccu-field__label" for="${f}-pop">${t("photo_wall.pop_new")}</label>
    </div>
  </fieldset>`;
}
