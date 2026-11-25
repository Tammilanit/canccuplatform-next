/**
 * Reading a menu's photos (mockup 11 D; #789 items 1, 2 and 15): the notice of the outside service,
 * then the photos the way the receipt page takes them, a phone's camera or a PC's image picker
 * (H2), up to six pages read as one menu, with what the read costs shown before it. With a script
 * (static/menu-photos.js) the pages show as thumbnails to reorder and remove, "Add another page"
 * opens the camera again, and the estimate follows the pages chosen; without one each field
 * takes several photos.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { MAX_PAGES, PAGE_COST_MICRO_USD, PROVIDER, timeoutFor } from "../reader.js";
import { formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { outsideNotice } from "./money-views.js";
import { flash } from "./order-view.js";
import { readErrorView } from "./read-errors.js";
import type { ReadFailure } from "./read-errors.js";

const PHOTO_TYPES = "image/jpeg,image/png,image/webp";
/** About how long the reader takes per page, for the progress's words (not a timer). */
export const MENU_SECONDS_PER_PAGE = 10;

/** What reading `pages` pages costs, about: "$0.0015" a page. */
export const estimate = (pages: number): string =>
  `$${((pages * PAGE_COST_MICRO_USD) / 1_000_000).toFixed(4)}`;

/**
 * What static/progress.js says while a menu is sent and read, and how long the page waits for
 * each count of pages: the reader's own limit and 10 s more (D4).
 */
export function menuProgressAttrs(c: PageCtx): Record<string, string> {
  return {
    "data-progress": "",
    "data-sending": c.t("menuread.sending"),
    "data-reading": c.t("menuread.reading", { s: "{s}" }),
    "data-reading-pages": c.t("menuread.reading_pages", { n: "{n}", s: "{s}" }),
    "data-checking": c.t("progress.checking"),
    "data-lost": c.t("menuread.lost"),
    "data-retry-label": c.t("menuread.try_again"),
    "data-timeout": String(timeoutFor(1) + 10_000),
    "data-timeouts": Array.from({ length: MAX_PAGES }, (_, i) => timeoutFor(i + 1) + 10_000).join(
      ",",
    ),
  };
}

export function pickView(
  c: PageCtx,
  o: { action: string; type: string; error?: string | undefined; failure: ReadFailure | null },
): Html {
  // A menu's photos are not kept: the form below is the way to try again.
  return html`${flash(o.error)}
    ${
      o.failure === null
        ? ""
        : readErrorView(c, o.failure, { type: o.type, typeLabel: c.t("readerr.type_menu") })
    }
    ${outsideNotice(c, c.t("read.outside_text", { provider: PROVIDER.name }))}
    <form${attrs({
      method: "post",
      action: o.action,
      enctype: "multipart/form-data",
      class: "pizza-part pizza-form pizza-menu-photos",
      "data-shrink": "",
      "data-pages": "",
      "data-max-pages": String(MAX_PAGES),
      ...menuProgressAttrs(c),
    })}>
      ${formKey()}
      <div class="pizza-only-touch pizza-form">
        <label class="pizza-camera">
          <span class="pizza-camera__frame" aria-hidden="true"></span>
          <span class="pizza-camera__text">${c.t("menuread.take")}</span>
          <input
            class="pizza-camera__input"
            type="file"
            name="photo"
            accept="${PHOTO_TYPES}"
            capture="environment"
            data-page-input
        /></label>
        <label class="pizza-saved"
          >${c.t("menuread.saved")}<input
            class="pizza-camera__input"
            type="file"
            name="photo"
            accept="${PHOTO_TYPES}"
            multiple
            data-page-input
        /></label>
      </div>
      <label class="pizza-only-pointer pizza-drop">
        <span class="pizza-drop__title">${c.t("menuread.attach")}</span>
        <span class="pizza-muted">${c.t("menuread.attach_hint", { n: MAX_PAGES })}</span>
        <input
          class="pizza-drop__input"
          type="file"
          name="photo"
          accept="${PHOTO_TYPES}"
          multiple
          data-page-input
        />
      </label>
      <ol
        class="pizza-thumbs"
        data-thumbs
        hidden
        aria-label="${c.t("menuread.pages")}"
        data-page-label="${c.t("menuread.page_n", { n: "{n}" })}"
        data-up="${c.t("menuread.up")}"
        data-down="${c.t("menuread.down")}"
        data-remove="${c.t("menuread.remove")}"
      ></ol>
      <button
        class="canccu-button canccu-button--secondary pizza-only-touch"
        type="button"
        data-add-page
        hidden
      >
        ${c.t("menuread.add_page")}
      </button>
      <p
        class="pizza-muted"
        data-estimate="${c.t("menuread.estimate", { cost: "{cost}", n: "{n}" })}"
        data-estimate-one="${c.t("menuread.estimate_one", { cost: "{cost}" })}"
        data-page-cost="${PAGE_COST_MICRO_USD}"
        role="status"
      >
        ${c.t("menuread.estimate_one", { cost: estimate(1) })}
      </p>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t("read.go")}
      </button>
    </form>`;
}
