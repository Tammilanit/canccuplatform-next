/**
 * The idle rotation's hero items (#787 D1, sheet 01) in the player's default templates
 * (templates.ts): the coming hours and the food box, which in the hero adds its order's QR and a
 * live countdown (the look shows those two only there, food.css).
 */
import type { TreeNode } from "./tree.js";
import { el, f, img, not, sec, t } from "./tree-build.js";

/** The QR handoff any widget may carry (contracts/screen.md, QR handoff). */
const QR: TreeNode = sec(
  "qr",
  el("figure", "qr", [img("image_url", "code"), el("figcaption", "caption", [f("label")])]),
);

// A template cannot compute, so an item's place on the line travels as classes, ten minutes a
// column (src/compose/timeline.ts); the look sets the grid (timeline.css).
const SPAN = el(
  "div",
  null,
  [
    // The bar's own box, empty: a tall bar then counts as drawn in the hero's fill check.
    el("i", "fill", []),
    el("strong", "name", [f("name")]),
    el("span", "starts", [f("starts_text")]),
    sec("place", el("span", "where", [f("place")])),
  ],
  {
    class: [
      t("canccu-widget__span canccu-widget__span--col-"),
      f("col"),
      t(" canccu-widget__span--cols-"),
      f("cols"),
      t(" canccu-widget__span--row-"),
      f("row"),
      t(" canccu-widget__span--"),
      f("kind"),
    ],
  },
);

const MARK = el(
  "p",
  null,
  [el("span", "mark-label", [f("label")]), el("span", "mark-time", [f("at_text")])],
  {
    class: [t("canccu-widget__mark canccu-widget__mark--col-"), f("col")],
  },
);

export const LIVING_TEMPLATES: Readonly<Record<string, readonly TreeNode[]>> = {
  agenda_timeline: [
    el("p", "kicker", [f("title")]),
    el("div", "track", [
      el("p", "hours", [el("span", "from", [f("from_text")]), el("span", "to", [f("to_text")])]),
      sec("items", SPAN),
      sec("marks", MARK),
      // The now line is a bar over the line's three hours (widget.ts, fillCountdowns): its
      // progress is how far the clock is along them, also offline.
      el("time", null, [], {
        datetime: [f("to")],
        class: [t("canccu-widget__now canccu-widget__bar canccu-widget__bar--10800s")],
      }),
    ]),
  ],
  // The lead, then a row per order (D2), in the server's words; never the API's state (#771).
  food_status: [
    sec("title", el("p", "kicker", [f("title")])),
    sec(
      "big_text",
      el("p", "lead", [
        sec("big_label", el("span", "label", [f("big_label")])),
        el("strong", "big", [f("big_text")]),
      ]),
    ),
    sec("countdown_at", el("time", "countdown", [], { datetime: [f("countdown_at")] })),
    sec(
      "orders",
      el("p", "row", [
        el("strong", "name", [f("pizzeria_name")]),
        el("span", "meta", [f("status_text")]),
      ]),
    ),
    not("orders", el("p", "title", [f("pizzeria_name")])),
    sec(
      "join",
      el("figure", "join", [img("image_url", "code"), el("figcaption", "caption", [f("label")])]),
    ),
    QR,
  ],
};
