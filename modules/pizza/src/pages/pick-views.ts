/**
 * Picking a pizza (mockups 02 B and 04): the menu with the legacy filter and each item's price when
 * it has one (D7 B), the own pizza from the base and 1–6 toppings (a "Fantasia" base includes some,
 * #789), Other as free text, and your
 * last pizza from this pizzeria one tap away (U6). One plain form per tab, so it works without a
 * script; static/food.js filters as you type and stops the toppings at the limit.
 */
import { attrs, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { menuMatches } from "../menu-filter.js";
import { LIMITS, ownPizzaPrice } from "../validate.js";
import { formKey } from "./kit.js";
import { flash } from "./order-view.js";
import type { MineView, OrderView } from "./order-view.js";
import { orderHref } from "./food-views.js";
import type { FoodCtx } from "./food-views.js";

export type Tab = "menu" | "own" | "other";

interface Line {
  id: string;
  number?: string | null;
  name: string;
  description: string | null;
  price_cents: number | null;
  /** The base's (#789 item 6). */
  included_toppings?: number | null;
  extra_topping_cents?: number | null;
  /** A topping's. */
  tier?: "normal" | "special" | null;
}

export interface Menu {
  items: Line[];
  base: Line | null;
  toppings: Line[];
}

/** €9.50, or 9,50 € in Finnish. */
export function price(c: Pick<FoodCtx, "lang">, cents: number | null): string {
  if (cents === null) return "";
  return new Intl.NumberFormat(c.lang === "fi" ? "fi-FI" : "en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/** The form's fields that say what the pizza is: the same for a new pizza and "the same again". */
export function pizzaFields(
  p: Pick<MineView, "kind" | "toppings" | "text">,
  menuItem?: string,
): Html {
  if (p.kind === "menu")
    return html`<input type="hidden" name="menu_item_id" value="${menuItem ?? ""}" />`;
  if (p.kind === "custom")
    return html`${(p.toppings ?? []).map((t) => html`<input type="hidden" name="toppings" value="${t}" />`)}`;
  return html`<input type="hidden" name="text" value="${p.text ?? ""}" />`;
}

const kindOf = { menu: "menu", own: "custom", other: "text" } as const;

/** U6: the last pizza from this pizzeria, when it can still be ordered as it was. */
function lastTime(
  c: FoodCtx,
  o: OrderView,
  last: { pizza: MineView; when: string; menuItem?: string } | null,
): Slot {
  if (last === null) return "";
  const p = last.pizza;
  const extra = [p.note, p.comment].filter((x): x is string => x !== null);
  return html`<form method="post" action="${orderHref(o)}/add" class="pizza-block pizza-again">
    ${formKey()}
    <input type="hidden" name="kind" value="${p.kind}" />${pizzaFields(p, last.menuItem)}
    ${p.note === null ? "" : html`<input type="hidden" name="note" value="${p.note}" />`}
    ${p.comment === null ? "" : html`<input type="hidden" name="comment" value="${p.comment}" />`}
    <p class="pizza-section">${c.t("pick.last_time")}</p>
    <p class="pizza-title">${[p.label, ...extra].join(" · ")}</p>
    <p class="pizza-meta">${o.pizzeria.name} · ${last.when}</p>
    <button class="canccu-button canccu-button--secondary pizza-wide" type="submit">
      ${c.t("pick.same_again")}
    </button>
  </form>`;
}

function textField(
  name: string,
  label: string,
  max: number,
  value: string | null,
  rows = false,
): Html {
  return html`<label class="canccu-field"
    ><span class="canccu-field__label">${label}</span>
    ${
      rows
        ? html`<textarea class="canccu-input" name="${name}" maxlength="${max}" rows="2" required>
${value ?? ""}</textarea>`
        : html`<input
            class="canccu-input"
            name="${name}"
            maxlength="${max}"
            value="${value ?? ""}"
          />`
    }
  </label>`;
}

/**
 * The own pizza's tab: the base, what a "Fantasia" base includes and costs past that, each
 * topping with what it adds, and the price so far, which static/food.js keeps running (#789).
 */
function ownPizza(c: FoodCtx, base: Line, toppings: Line[], chosen: Set<string>): Html {
  const included = base.included_toppings ?? null;
  const extra = base.extra_topping_cents ?? null;
  const fantasia =
    included === null
      ? ""
      : [
          c.t("pick.includes", { n: included }),
          ...(extra === null ? [] : [c.t("pick.each_extra", { price: price(c, extra) })]),
        ].join(" · ");
  // A Fantasia's normal topping is in the base's price until the included ones run out.
  const adds = (t: Line) => {
    const special = t.tier === "special";
    const costs = t.price_cents !== null && (included === null || special);
    return `${costs ? ` +${price(c, t.price_cents)}` : ""}${special ? ` · ${c.t("pick.special")}` : ""}`;
  };
  const now = ownPizzaPrice(
    { price_cents: base.price_cents, included_toppings: included, extra_topping_cents: extra },
    toppings
      .filter((t) => chosen.has(t.name))
      .map((t) => ({ price_cents: t.price_cents, tier: t.tier ?? null })),
  );
  return html`<p class="pizza-section">${c.t("pick.base")}</p>
    <p class="pizza-block">
      <span class="pizza-title">${base.name}</span>
      <span class="pizza-meta"
        >${[base.description, price(c, base.price_cents)].filter(Boolean).join(" · ")}</span
      >
      ${fantasia === "" ? "" : html`<span class="pizza-meta">${fantasia}</span>`}
    </p>
    <fieldset class="pizza-fieldset" data-toppings="${LIMITS.toppings}">
      <legend>${c.t("pick.toppings", { max: LIMITS.toppings })}</legend>
      <div class="pizza-choices">
        ${toppings.map(
          (t) =>
            html`<label class="pizza-choice"
              ><input${attrs({
                type: "checkbox",
                name: "toppings",
                value: t.name,
                checked: chosen.has(t.name),
                "data-price": t.price_cents ?? undefined,
                "data-tier": t.tier === "special" ? "special" : undefined,
              })} /><span>${t.name}${adds(t)}</span></label
            >`,
        )}
      </div>
    </fieldset>
    ${
      base.price_cents === null
        ? ""
        : html`<p${attrs({
            class: "pizza-meta",
            "data-own-price": base.price_cents,
            "data-included": included ?? undefined,
            "data-extra": extra ?? undefined,
          })}>
          ${c.t("pick.own_price")} <output data-own-total>${price(c, now)}</output>
        </p>`
    }`;
}

export function pickView(
  c: FoodCtx,
  o: OrderView,
  menu: Menu,
  q: {
    tab: Tab;
    query: string;
    edit: MineView | null;
    last: { pizza: MineView; when: string; menuItem?: string } | null;
    error?: string;
  },
): Html {
  const tabs: [Tab, string][] = [
    ["menu", c.t("pick.menu")],
    ...(menu.base === null ? [] : ([["own", c.t("pick.own")]] as [Tab, string][])),
    ["other", c.t("pick.other")],
  ];
  const edit = q.edit;
  const here = (t: Tab) => `${orderHref(o)}/add?tab=${t}${edit === null ? "" : `&edit=${edit.id}`}`;
  const nav = html`<nav class="canccu-tabs" aria-label="${c.t("pick.kinds")}">
    ${tabs.map(([t, label]) => html`<a${attrs({ href: here(t), "aria-current": t === q.tab ? "page" : undefined })}>${label}</a>`)}
  </nav>`;
  let body: Slot;
  if (q.tab === "own" && menu.base !== null) {
    const chosen = new Set(edit?.kind === "custom" ? (edit.toppings ?? []) : []);
    body = ownPizza(c, menu.base, menu.toppings, chosen);
  } else if (q.tab === "other") {
    body = html`${textField("text", c.t("pick.other_what"), LIMITS.text, edit?.kind === "text" ? edit.text : null, true)}
      <p class="pizza-muted">${c.t("pick.other_hint")}</p>`;
  } else {
    const shown = menu.items.filter((i) => menuMatches(i, q.query));
    const picked = edit?.kind === "menu" ? edit.number : null;
    body = html`<div class="pizza-filter" role="search">
        <label class="canccu-field"
          ><span class="canccu-field__label">${c.t("pick.filter")}</span>
          <input
            class="canccu-input"
            type="search"
            name="q"
            value="${q.query}"
            form="pizza-filter"
            data-filter
          />
        </label>
        <button class="canccu-button canccu-button--secondary" type="submit" form="pizza-filter">
          ${c.t("pick.filter_go")}
        </button>
      </div>
      <fieldset class="pizza-fieldset">
        <legend class="pizza-sr">${c.t("pick.menu")}</legend>
        <ul class="pizza-menu">
          ${shown.map(
            (i, n) =>
              html`<li data-item="${`${i.name} ${i.description ?? ""}`.toLowerCase()}">
                <label class="pizza-menu__item"
                  ><input
                    type="radio"
                    name="menu_item_id"
                    value="${i.id}"
                    required
                    ${(picked === null ? n === 0 && shown.length === 1 : i.number === picked) ? "checked" : ""}
                  />
                  <span class="pizza-menu__text"
                    ><span class="pizza-title">#${i.number ?? ""} ${i.name}</span>
                    ${i.description === null ? "" : html`<span class="pizza-muted">${i.description}</span>`}</span
                  >
                  <span class="pizza-menu__price">${price(c, i.price_cents)}</span></label
                >
              </li>`,
          )}
        </ul>
        ${shown.length === 0 ? html`<p class="pizza-muted">${c.t("pick.no_match")}</p>` : ""}
      </fieldset>`;
  }
  // A form never sits in another (the browser drops the inner one): the same again comes first.
  // The note and Add are used with the pick: on a desktop they stay beside the menu (pizza-pair).
  const again = q.tab === "menu" && edit === null ? lastTime(c, o, q.last) : "";
  return html`${flash(q.error)}${nav}${again}
    <form id="pizza-filter" method="get" action="${orderHref(o)}/add"></form>
    ${
      edit === null
        ? ""
        : html`<input type="hidden" name="edit" value="${edit.id}" form="pizza-filter" />
            <input type="hidden" name="tab" value="${q.tab}" form="pizza-filter" />`
    }
    <form method="post" action="${orderHref(o)}/add" class="pizza-form">
      ${formKey()}
      <input type="hidden" name="kind" value="${kindOf[q.tab]}" />
      ${edit === null ? "" : html`<input type="hidden" name="edit" value="${edit.id}" />`}
      <div class="pizza-pair">
        <div class="pizza-pair__main">${body}</div>
        <div class="pizza-pair__aside">
          ${textField("note", c.t("pick.note"), LIMITS.note, edit?.note ?? null)}
          ${textField("comment", c.t("pick.comment"), LIMITS.comment, edit?.comment ?? null)}
          <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
            ${c.t(edit === null ? "pick.add" : "pick.save")}
          </button>
        </div>
      </div>
    </form>`;
}
