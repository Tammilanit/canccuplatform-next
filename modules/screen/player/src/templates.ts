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
// A row carries both its end and its start: the look shows the end on a now row and the start on a
// next or delayed row (rail.css), since a template cannot branch on a field's value.
const AGENDA_ROW = el(
  "li",
  null,
  [
    el("span", "state", [f("state")]),
    el("strong", "name", [f("name")]),
    sec("ends_text", el("span", "until", [t("until "), f("ends_text")])),
    el("span", "starts", [f("starts_text")]),
    sec("location", el("span", "where", [f("location")])),
    el("span", null, [t("+"), f("delay_minutes"), t(" min")], {
      class: [t("canccu-widget__delay canccu-widget__delay--"), f("state")],
    }),
  ],
  { class: [t("canccu-widget__row canccu-widget__row--"), f("state")] },
);

/**
 * A statistic's trend arrow (contracts/screen.md, Trend arrows): `up`, `down` or `flat` in the
 * class, the glyph drawn by the look (widgets.css), since a template cannot branch on a value. An
 * absent field (under 20 minutes of counts) draws no arrow.
 */
const trend = (field: string): TreeNode =>
  sec(
    field,
    el("span", null, [], { class: [t("canccu-widget__trend canccu-widget__trend--"), f(field)] }),
  );
/**
 * A number with its trend, its label under it and, where it has one, the day's peak under that,
 * as sheet 10's Right now draws it. An absent number draws nothing, not an empty label.
 */
const stat = (field: string, label: string, peak?: string): TreeNode =>
  sec(
    field,
    el("li", "stat", [
      el("strong", "big", [f(field), trend(`${field}_trend`)]),
      el("span", "meta", [t(label)]),
      ...(peak === undefined
        ? []
        : [sec(peak, el("span", "peak", [t("peak "), f("count"), t(" · "), f("time_text")]))]),
    ]),
  );

/** A photo with its caption, as a tile of the wall and as the pop over it. */
const PHOTO: TreeNode[] = [
  img("url", "image", [f("caption")]),
  el("figcaption", "caption", [f("caption"), sec("author_name", t(" · "), f("author_name"))]),
];

/**
 * A bar that fills as `field`'s time comes near, over the last `span` seconds (widget.ts,
 * fillCountdowns): a countdown's last hour. A template may hold no `data-` attribute (theming.md,
 * Widget templates), so the span travels in the class.
 */
const bar = (field: string, span: number): TreeNode =>
  el("time", null, [], {
    class: [t(`canccu-widget__bar canccu-widget__bar--${String(span)}s`)],
    datetime: [f(field)],
  });

/**
 * A check-in code's bar, over one rotation period. The period is an event setting (15–120 s,
 * notify.md, Settings) the view does not carry, but a code is valid for its own period and the
 * next (notify.openapi.yaml, CheckInCodeNow), so the bar holds `valid_until` in a child and the
 * span is `valid_until − rotates_at`.
 */
const CODE_BAR: TreeNode = sec(
  "rotates_at",
  sec(
    "valid_until",
    el("time", "bar", [el("time", "bar-end", [], { datetime: [f("valid_until")] })], {
      datetime: [f("rotates_at")],
    }),
  ),
);

export const DEFAULT_TEMPLATES: Readonly<Record<string, readonly TreeNode[]>> = {
  clock: [el("p", "meta", [f("date")]), el("time", "big", [f("time")], { datetime: [f("iso")] })],
  // No title: each row is labelled (NOW, NEXT), so "Now and next" above them says it twice.
  agenda_now: [el("ul", "body", [sec("items", AGENDA_ROW)]), QR],
  // `starts_text`, `location` and `delay_minutes` are the player's (hero-rail.ts): the countdown's
  // view-model has only the target, so the player adds what the rail's row of the same item says.
  // `next_up` is the player's too (screen.ts, idleOf): only the idle `next` countdown is surely the
  // next item; a widget's countdown may count to any item, and a claim's to anything.
  // The Pulse hero (contracts/screen.md, The Pulse hero; sheets 9–10): a hero that holds a later
  // item than the next one (it has a `chip`) says "Tonight", the game's art is a band with its
  // name, and the chip counts down to what comes first, with the countdown's spotlight.
  countdown: [
    sec(
      "game",
      sec(
        "cover_url",
        el("div", "band", [img("cover_url", "band-image"), el("p", "band-name", [f("name")])]),
      ),
    ),
    sec("chip", el("p", "kicker", [t("Tonight on stage")])),
    not("chip", sec("next_up", el("p", "kicker", [t("Next on stage")]))),
    el("p", "headline", [f("label")]),
    el("p", "when", [
      sec("starts_text", el("span", "starts", [f("starts_text")])),
      sec("location", el("span", "where", [f("location")])),
      sec("teams_left", el("span", "teams", [f("teams_left"), t(" teams left")])),
      sec(
        "delay_minutes",
        el("span", null, [t("+"), f("delay_minutes"), t(" min")], {
          class: [t("canccu-widget__delay canccu-widget__delay--delayed")],
        }),
      ),
    ]),
    sec("description", el("p", "description", [f("description")])),
    sec(
      "chip",
      el("p", "chip", [
        el("span", "chip-label", [f("label"), t(" starts in")]),
        el("time", "chip-time", [], { datetime: [f("target_at")] }),
      ]),
    ),
    el("p", "count", [t("Starts in "), el("time", "big", [], { datetime: [f("target_at")] })]),
    bar("target_at", 3600),
  ],
  hot_game: [
    el("p", "kicker", [t("Hot right now")]),
    sec("game", sec("cover_url", img("cover_url", "image")), el("p", "big", [f("name")])),
    el("p", "meta", [f("players"), t(" playing now")]),
    QR,
  ],
  now_playing: [
    el("p", "title", [t("Playing now")]),
    el("ul", "body", [
      sec(
        "games",
        el("li", "row", [
          el("strong", "name", [f("name")]),
          el("span", "meta", [f("players"), trend("trend")]),
        ]),
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
  // The wall (change 6): five tiles, the lead first (wall.css draws it large); a new photo pops
  // over the whole box while `featured`.
  photo: [
    el("div", "wall", [sec("tiles", el("figure", "tile", PHOTO))]),
    sec("featured", el("figure", "pop", PHOTO)),
  ],
  announcement: [
    el(
      "div",
      null,
      [el("p", "kicker", [t("Announcement")]), title("title"), el("p", "body", [f("body")])],
      {
        class: [t("canccu-widget__level canccu-widget__level--"), f("level")],
      },
    ),
  ],
  ticker: [el("p", "label", [t("Info")]), el("p", "line", [f("text")])],
  food_status: [
    el("p", "title", [f("pizzeria_name")]),
    el("p", "big", [f("state")]),
    sec("target_at", el("time", "meta", [], { datetime: [f("target_at")] })),
    QR,
  ],
  qr: OWN_QR,
  checkin_qr: [...OWN_QR, CODE_BAR],
  venue_info: [
    el("ul", "body", [
      sec(
        "wifi",
        el("li", "row", [
          el("span", "state", [t("Wi-Fi")]),
          el("strong", "name", [f("ssid")]),
          sec("password", el("span", "meta", [f("password")])),
          not("password", el("span", "meta", [t("Password on the hub")])),
          sec("note", el("span", "meta", [f("note")])),
        ]),
      ),
    ]),
    sec("has_floor_plan", el("p", "meta", [t("Floor plan on the hub")])),
    QR,
  ],
  // Right now (sheet 10); `still` is Ambient's one line, "N still online" (wall.css).
  stats: [
    el("p", "kicker", [t("Right now")]),
    el("ul", "stats", [
      stat("online", "online", "online_peak"),
      stat("in_voice", "in voice", "in_voice_peak"),
      stat("checked_in", "checked in"),
    ]),
    sec("online", el("p", "still", [f("online"), t(" still online"), trend("online_trend")])),
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
  // The name is written out beside the image, so the image's `alt` stays empty.
  logo: [
    sec("url", img("url", "image")),
    el("p", "name", [f("name")]),
    sec("zone_name", el("p", "zone", [f("zone_name")])),
  ],
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
