/**
 * The announcement card (contracts/screen.md, Announcements by level, #780): one block on one left
 * edge in every role, its level's label and icon, the source's art, and the living details a full
 * screen keeps ticking. A template can test a field but not a value, so `announceView` turns the
 * level into the fields the template tests (`level_label`, `urgent`, `instruction`).
 */
import type { TreeNode } from "./tree.js";
import { THEME_BAND, el, f, img, not, sec, t, title } from "./tree-build.js";

type View = Record<string, unknown>;

/** An image on the event's hostname, or a picture handed in as data (the demo shots). */
export const CARD_URL = /^(\/(?!\/)[\x21-\x7e]*|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)$/;

/** The words a person reads for each level: never the level's code (the plan's constraints). */
const LABELS: Readonly<Record<string, string>> = {
  info: "Info",
  important: "Important",
  urgent: "Urgent",
  emergency: "Emergency",
};
const ICONS = new Set(["info", "wifi", "food", "trophy", "clock", "door", "search", "megaphone"]);
const ART_KINDS = new Set(["food", "game"]);

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * The view the template draws. Urgent and the emergency wear the warning sign whatever icon was
 * picked and carry no decoration (no art, no second beat): the PO's "no decoration" row. Their
 * instruction is the ticker line, else the body, as the ticker would have carried it.
 */
export function announceView(view: View): View {
  const level = typeof view.level === "string" && view.level in LABELS ? view.level : "info";
  const alarm = level === "urgent" || level === "emergency";
  const art = view.art as { kind?: unknown; url?: unknown } | null | undefined;
  const kind = !alarm && typeof art?.kind === "string" && ART_KINDS.has(art.kind) ? art.kind : null;
  const url =
    kind !== null && typeof art?.url === "string" && CARD_URL.test(art.url) ? art.url : null;
  const icon = typeof view.icon === "string" && ICONS.has(view.icon) ? view.icon : "info";
  return {
    ...view,
    level,
    level_label: LABELS[level],
    icon: alarm ? "alert" : icon,
    ...(level === "urgent" ? { urgent: true } : {}),
    instruction: alarm ? (text(view.ticker_line) ?? text(view.body)) : null,
    // Which text the band carries: one taken from the body is not said twice (announce.css).
    band_from: !alarm ? null : text(view.ticker_line) !== null ? "line" : "body",
    second_line: alarm ? null : text(view.second_line),
    art_kind: kind,
    art_url: url,
  };
}

const ICON: TreeNode = el("span", null, [], {
  class: [t("canccu-widget__icon canccu-widget__icon--"), f("icon")],
  "aria-hidden": [t("true")],
});

/** The label: from the crew says so and never who (L15); `urgent` keeps its own span (R6). */
const LABEL: TreeNode = el(
  "p",
  null,
  [
    ICON,
    sec("from_crew", el("span", "label-text", [t("From the crew")])),
    not(
      "from_crew",
      sec("urgent", el("span", "urgent", [t("Urgent")])),
      not("urgent", el("span", "label-text", [f("level_label")])),
    ),
  ],
  { class: [t("canccu-widget__kicker canccu-widget__kicker--"), f("level")] },
);

/**
 * The living details (D7): "Posted …" and the time left start as words the device then keeps
 * current (announce-motion.ts), so `fillCountdowns` leaves them alone; the countdown's empty
 * `<time>` is the one it counts.
 */
const DETAILS: TreeNode = el("p", "details", [
  el("time", "posted", [t("Posted just now")], { datetime: [f("starts_at")] }),
  sec(
    "expires_at",
    el("span", "timebar", [el("time", "left", [t("Ending")], { datetime: [f("expires_at")] })]),
  ),
  sec(
    "countdown_at",
    el("span", "countdown", [
      t("Starts in "),
      el("time", "countdown-time", [], { datetime: [f("countdown_at")] }),
    ]),
  ),
]);

/** The source's art (D8): its own picture when it has one, else the look's for its kind. */
const ART: TreeNode = sec(
  "art_kind",
  el("div", null, [sec("art_url", img("art_url", "art-img"))], {
    class: [t("canccu-widget__ann-art canccu-widget__ann-art--"), f("art_kind")],
    "aria-hidden": [t("true")],
  }),
);

export const ANNOUNCEMENT: TreeNode[] = [
  THEME_BAND,
  ART,
  el(
    "div",
    null,
    [
      LABEL,
      // An edit's chip (L13); the ticker line shows only in the ticker role (L4, claims.css).
      sec("updated", el("p", "updated", [t("Updated")])),
      title("title"),
      el("p", "body", [f("body")]),
      sec("second_line", el("p", "second", [f("second_line")])),
      DETAILS,
      sec("ticker_line", el("p", "ticker-line", [f("ticker_line")])),
    ],
    {
      class: [
        t("canccu-widget__level canccu-widget__level--"),
        f("level"),
        sec("band_from", t(" canccu-widget__band-from--"), f("band_from")),
      ],
    },
  ),
  // In the ticker's place at urgent and the emergency (D6), outside the block so it spans the box.
  sec("instruction", el("p", "instruction", [f("instruction")])),
];

/** The claim's QR to the details, drawn in the nearby content's column (widget.ts, `drawAside`). */
export const ASIDE_QR: TreeNode[] = [
  sec(
    "qr",
    el("figure", "qr", [img("image_url", "code"), el("figcaption", "caption", [f("label")])]),
  ),
];
