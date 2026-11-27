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

// A template cannot compute, so a place on the line travels as classes, ten minutes a column
// (src/compose/timeline.ts); the look sets the grid (timeline.css, timeline-cols.css).
const at = (col: string, cols: string): TreeNode[] => [
  t(" canccu-widget__col-"),
  f(col),
  t(" canccu-widget__cols-"),
  f(cols),
  t(" canccu-widget__lane-"),
  f("row"),
  t(" canccu-widget__span--"),
  f("kind"),
];

// An item is two parts in its lane: its box, as long as it runs, and its label from its start,
// which runs on past a short box into the room the server gave it.
const BOX = el("i", null, [], { class: [t("canccu-widget__block"), ...at("col", "cols")] });
const SPAN = el(
  "div",
  null,
  [
    el("strong", "name", [f("name")]),
    el("span", "range", [f("range_text")]),
    sec("place", el("span", "where", [f("place")])),
  ],
  {
    class: [
      t("canccu-widget__span canccu-widget__span--"),
      f("align"),
      ...at("label_col", "label_cols"),
    ],
  },
);

const MARK = el(
  "p",
  null,
  [el("span", "mark-label", [f("label")]), el("span", "mark-time", [f("at_text")])],
  {
    class: [
      t("canccu-widget__mark canccu-widget__mark--"),
      f("align"),
      t(" canccu-widget__col-"),
      f("col"),
    ],
  },
);

export const LIVING_TEMPLATES: Readonly<Record<string, readonly TreeNode[]>> = {
  agenda_timeline: [
    el("p", "kicker", [f("title")]),
    sec("subtitle", el("p", "subtitle", [f("subtitle")])),
    el(
      "div",
      null,
      [
        el("div", "lanes", [sec("items", BOX, SPAN)]),
        el("div", "marks", [sec("marks", MARK)]),
        el("div", "axis", [sec("ticks", el("span", "tick", [f("text")]))]),
        // The now line is a bar over the whole line (widget.ts, fillCountdowns): its progress is
        // how far the clock is along it, also offline.
        el("time", null, [el("span", "now-pill", [t("now")])], {
          datetime: [f("to")],
          class: [
            t("canccu-widget__now canccu-widget__bar canccu-widget__bar--"),
            f("span_seconds"),
            t("s"),
          ],
        }),
      ],
      { class: [t("canccu-widget__track canccu-widget__track--h"), f("hours")] },
    ),
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
