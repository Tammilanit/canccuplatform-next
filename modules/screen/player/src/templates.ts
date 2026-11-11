/**
 * The player's own template for every widget and claim template, in the same tree theming serves
 * (contracts/theming.md, The parsed tree), so a theme's template replaces one of them one for one
 * (plan S5). They read only the fields the screen contract documents for each type.
 */
import type { TreeNode } from "./tree.js";

type Attrs = Record<string, TreeNode[]>;

const t = (text: string): TreeNode => ({ text });
const f = (field: string): TreeNode => ({ field });
const sec = (section: string, ...children: TreeNode[]): TreeNode => ({
  section,
  inverted: false,
  children,
});
const not = (section: string, ...children: TreeNode[]): TreeNode => ({
  section,
  inverted: true,
  children,
});
/** An element; `cls` names a `canccu-widget__…` part, `extra` adds attributes. */
function el(tag: string, cls: string | null, children: TreeNode[], extra: Attrs = {}): TreeNode {
  const attrs: Attrs = cls === null ? extra : { class: [t(`canccu-widget__${cls}`)], ...extra };
  return { element: tag, attrs, children };
}
const title = (field: string): TreeNode => el("p", "title", [f(field)]);
const img = (field: string, cls: string, alt: TreeNode[] = []): TreeNode =>
  el("img", cls, [], { src: [f(field)], alt });

/** The QR handoff any widget may carry (contracts/screen.md, QR handoff). */
const QR: TreeNode = sec(
  "qr",
  el("figure", "qr", [img("image_url", "code"), el("figcaption", "caption", [f("label")])]),
);
/** A QR widget's own code: the view-model is the QR itself. */
const OWN_QR: TreeNode[] = [
  el("figure", "qr", [img("image_url", "code"), el("figcaption", "caption", [f("label")])]),
];

// The tree has no `{{.}}` (theming's names are `a.b` only), so no template can show a list of plain
// strings: the `names` and `voice_channels` lists stay off the defaults.
const AGENDA_ROW = el(
  "li",
  null,
  [
    el("span", "state", [f("state")]),
    el("strong", "name", [f("name")]),
    el("span", "meta", [sec("location", f("location"), t(" · ")), f("starts_text")]),
    el("span", null, [t("+"), f("delay_minutes"), t(" min")], {
      class: [t("canccu-widget__delay canccu-widget__delay--"), f("state")],
    }),
  ],
  { class: [t("canccu-widget__row canccu-widget__row--"), f("state")] },
);

export const DEFAULT_TEMPLATES: Readonly<Record<string, readonly TreeNode[]>> = {
  clock: [el("time", "big", [f("time")], { datetime: [f("iso")] }), el("p", "meta", [f("date")])],
  agenda_now: [title("title"), el("ul", "body", [sec("items", AGENDA_ROW)]), QR],
  countdown: [
    title("label"),
    el("time", "big", [], { datetime: [f("target_at")] }),
    sec("ends_text", el("p", "meta", [t("until "), f("ends_text")])),
  ],
  hot_game: [
    sec("game", sec("cover_url", img("cover_url", "image")), el("p", "big", [f("name")])),
    el("p", "meta", [f("players"), t(" playing now")]),
    QR,
  ],
  now_playing: [
    el("p", "title", [t("Playing now")]),
    el("ul", "body", [
      sec(
        "games",
        el("li", "row", [el("strong", "name", [f("name")]), el("span", "meta", [f("players")])]),
      ),
    ]),
    QR,
  ],
  bracket: [
    title("title"),
    sec("session", el("p", "meta", [f("game_name")])),
    el("ul", "body", [
      sec(
        "matches",
        el(
          "li",
          null,
          [
            el("span", "state", [f("label")]),
            sec("teams", el("strong", "name", [f("name")])),
            sec("results", el("span", "meta", [f("rank"), t(". "), f("points")])),
          ],
          { class: [t("canccu-widget__row canccu-widget__row--"), f("state")] },
        ),
      ),
    ]),
    QR,
  ],
  leaderboard: [
    title("title"),
    el("ol", "body", [
      sec(
        "rows",
        el("li", "row", [
          el("span", "state", [f("rank")]),
          el("strong", "name", [f("name")]),
          el("span", "meta", [f("points")]),
        ]),
      ),
    ]),
  ],
  photo: [
    el("figure", "photo", [
      img("url", "image", [f("caption")]),
      el("figcaption", "caption", [f("caption"), sec("author_name", t(" · "), f("author_name"))]),
    ]),
  ],
  announcement: [
    el("div", null, [title("title"), el("p", "body", [f("body")])], {
      class: [t("canccu-widget__level canccu-widget__level--"), f("level")],
    }),
  ],
  ticker: [el("p", "line", [f("text")])],
  food_status: [
    el("p", "title", [f("pizzeria_name")]),
    el("p", "big", [f("state")]),
    sec("target_at", el("time", "meta", [], { datetime: [f("target_at")] })),
    QR,
  ],
  qr: OWN_QR,
  checkin_qr: OWN_QR,
  venue_info: [
    el("ul", "body", [
      sec(
        "wifi",
        el("li", "row", [
          el("span", "state", [t("Wi-Fi")]),
          el("strong", "name", [f("ssid")]),
          sec("password", el("span", "meta", [f("password")])),
          not("password", el("span", "meta", [t("password on the hub")])),
          sec("note", el("span", "meta", [f("note")])),
        ]),
      ),
    ]),
    sec("has_floor_plan", el("p", "meta", [t("Floor plan on the hub")])),
    QR,
  ],
  stats: [
    el("ul", "body", [
      el("li", "row", [el("strong", "big", [f("members")]), el("span", "meta", [t("members")])]),
      el("li", "row", [el("strong", "big", [f("online")]), el("span", "meta", [t("online")])]),
      el("li", "row", [el("strong", "big", [f("in_voice")]), el("span", "meta", [t("in voice")])]),
    ]),
  ],
  match_called: [
    el("p", "title", [t("Match called")]),
    el("p", "big", [f("label")]),
    el("p", "meta", [f("game_name")]),
    el("ul", "body", [sec("teams", el("li", "row", [el("strong", "name", [f("name")])]))]),
  ],
  winner_card: [
    sec("image_url", img("image_url", "image")),
    el("p", "big", [f("title")]),
    sec("points", el("p", "meta", [f("points"), t(" points")])),
  ],
  sting: [sec("image_url", img("image_url", "image")), el("p", "big", [f("text")])],
  logo: [sec("url", img("url", "image", [f("name")])), not("url", el("p", "big", [f("name")]))],
};

interface ThemeTemplate {
  name: string;
  widget: string;
  tree: TreeNode[];
}

const isTemplate = (v: unknown): v is ThemeTemplate => {
  const x = v as Partial<ThemeTemplate> | null;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.name === "string" &&
    typeof x.widget === "string" &&
    Array.isArray(x.tree)
  );
};

/**
 * The entry's template when the theme has it for this type, else the theme's template named as the
 * type (it replaces the default), else the default. A template made for another type is never used.
 */
export function templateFor(
  type: string,
  named: string | null,
  themes: unknown,
): readonly TreeNode[] {
  const list = Array.isArray(themes) ? themes.filter(isTemplate) : [];
  const find = (name: string | null) =>
    name === null ? undefined : list.find((x) => x.name === name && x.widget === type);
  return find(named)?.tree ?? find(type)?.tree ?? DEFAULT_TEMPLATES[type] ?? [];
}
