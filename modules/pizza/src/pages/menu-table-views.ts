/**
 * A menu read as an editable table (#789 items 3, 5, 6 and 15): each item's number, name,
 * toppings, price, category and page; the own pizza and its toppings apart, gathered toppings
 * apart again for the crew to confirm; unsure rows and a price another read gave differently
 * marked, a category's price named as such, the campaign and lunch notes above, never applied.
 * Without a script every button posts the table (`menu-table.ts`); static/menu-table.js adds,
 * deletes and merges rows in place. The CSV stays, to download or to edit and import.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { euros } from "../csv.js";
import { rowsToCsv } from "../menu-rows.js";
import type { MenuRow } from "../reader.js";
import { PREFIX, formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import type { MessageKey } from "./messages.js";
import { menuProgressAttrs } from "./menu-read-views.js";
import { tableFields } from "./menu-table.js";
import type { Table } from "./menu-table.js";
import { readErrorView } from "./read-errors.js";
import type { ReadFailure } from "./read-errors.js";

/** A price as the page's language writes it, for its input. */
const priceText = (c: PageCtx, cents: number | null): string =>
  cents === null ? "" : c.lang === "fi" ? euros(cents).replace(".", ",") : euros(cents);

const field = (
  c: PageCtx,
  i: number | string,
  name: string,
  label: MessageKey,
  value: string,
  o: Record<string, string | undefined> = {},
): Html =>
  html`<td data-label="${c.t(label)}">
    <input${attrs({ class: "canccu-input", name: `row[${i}][${name}]`, value, "aria-label": c.t(label), ...o })} />
  </td>`;

/** Each row's fields the visible inputs do not carry, inside a cell (inputs belong in cells). */
function hidden(r: MenuRow, i: number | string, visible: string[], conflict: boolean): Html[] {
  const all = tableFields({ rows: [r], notes: [], conflicts: conflict ? [0] : [] });
  return Object.entries(all)
    .map(([k, v]) => [k.replace("row[0]", `row[${i}]`), v] as const)
    .filter(([k]) => !visible.some((f) => k.endsWith(`[${f}]`)))
    .map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}" />`);
}

/** Merge into the row above (hidden on a section's first row) and delete, with its hidden fields. */
function rowEnd(c: PageCtx, i: number | string, above: number | undefined, fields: Html[]): Html {
  const button = (value: string, label: MessageKey, mark: string, hide = false) =>
    html`<button${attrs({
      class: "canccu-button canccu-button--ghost pizza-table__button",
      type: "submit",
      name: "do",
      value,
      "data-plain": "",
      hidden: hide ? "" : undefined,
      title: c.t(label),
      "aria-label": c.t(label),
    })}>${mark}</button>`;
  return html`<td class="pizza-table__do">
    ${fields} ${button(`merge:${above ?? i}:${i}`, "menuread.merge", "⤒", above === undefined)}
    ${button(`delete:${i}`, "menuread.delete", "✕")}
  </td>`;
}

const BLANK: MenuRow = {
  page: 1,
  kind: "item",
  number: null,
  name: "",
  description: null,
  price_cents: null,
  category: null,
  category_price_cents: null,
  included_toppings: null,
  extra_topping_cents: null,
  tier: null,
  unsure: false,
};

export function tableView(
  c: PageCtx,
  o: { pizzeriaId: string; pizzeria: string; table: Table; failure?: ReadFailure | null },
): Html {
  const { rows, notes, conflicts } = o.table;
  const action = `${PREFIX}crew/pizzerias/${encodeURIComponent(o.pizzeriaId)}/read/table`;
  const items = rows.flatMap((r, i) => (r.kind === "item" ? [i] : []));
  const bases = rows.flatMap((r, i) => (r.kind === "base" ? [i] : []));
  const toppings = rows.flatMap((r, i) => (r.kind === "topping" && r.gathered !== true ? [i] : []));
  const gathered = rows.flatMap((r, i) => (r.gathered === true ? [i] : []));
  const csv = rowsToCsv(o.pizzeria, rows);
  const price = (r: MenuRow, i: number | string) =>
    html`<td data-label="${c.t("menuread.price")}">
      <input${attrs({
        class: `canccu-input pizza-table__price${conflicts.includes(Number(i)) ? " pizza-unsure" : ""}`,
        name: `row[${i}][price]`,
        value: priceText(c, r.price_cents),
        inputmode: "decimal",
        "aria-label": c.t("menuread.price"),
      })} />
      ${
        r.price_from_category === true
          ? html`<span class="pizza-badge pizza-badge--info"
              >${c.t("menuread.from_category")}</span
            >`
          : ""
      }
    </td>`;
  const itemRow = (r: MenuRow, i: number | string, above: number | undefined) =>
    html`<tr${attrs({ class: r.unsure ? "pizza-unsure" : undefined, "data-row": String(i) })}>
      ${field(c, i, "number", "menuread.number", r.number ?? "", {
        class: "canccu-input pizza-table__number",
      })}
      ${field(c, i, "name", "menuread.name", r.name)}
      ${field(c, i, "description", "menuread.toppings", r.description ?? "")}
      ${price(r, i)}
      ${field(c, i, "category", "menuread.category", r.category ?? "", {
        class: "canccu-input pizza-table__category",
      })}
      ${field(c, i, "page", "menuread.page", String(r.page), {
        class: "canccu-input pizza-table__page",
        inputmode: "numeric",
      })}
      ${rowEnd(
        c,
        i,
        above,
        hidden(
          r,
          i,
          ["number", "name", "description", "price", "category", "page"],
          conflicts.includes(Number(i)),
        ),
      )}
    </tr>`;
  const ownRow = (list: number[]) => (i: number, k: number) => {
    const r = rows[i] as MenuRow;
    const base = r.kind === "base";
    const visible = ["name", "price", ...(base ? ["included", "extra"] : ["tier"])];
    return html`<tr${attrs({ class: r.unsure ? "pizza-unsure" : undefined, "data-row": String(i) })}>
      ${field(c, i, "name", "menuread.name", r.name)} ${price(r, i)}
      ${
        base
          ? html`${field(c, i, "included", "menuread.included", r.included_toppings === null ? "" : String(r.included_toppings), { class: "canccu-input pizza-table__page", inputmode: "numeric" })}
            ${field(c, i, "extra", "menuread.extra", priceText(c, r.extra_topping_cents), { class: "canccu-input pizza-table__price", inputmode: "decimal" })}`
          : html`<td data-label="${c.t("menuread.tier")}" colspan="2">
              <select class="canccu-input" name="row[${i}][tier]" aria-label="${c.t("menuread.tier")}">
                <option${attrs({ value: "normal", selected: r.tier === "special" ? undefined : "" })}>${c.t("menuread.tier_normal")}</option>
                <option${attrs({ value: "special", selected: r.tier === "special" ? "" : undefined })}>${c.t("menuread.tier_special")}</option>
              </select>
            </td>`
      }
      ${rowEnd(c, i, k === 0 ? undefined : list[k - 1], hidden(r, i, visible, conflicts.includes(i)))}
    </tr>`;
  };
  /** The base's table names its included toppings and extra price; a toppings table its kind. */
  const ownTable = (list: number[], base: boolean) =>
    html`<div class="pizza-table-wrap">
      <table class="pizza-table pizza-menu-table">
        <thead>
          <tr>
            <th>${c.t("menuread.name")}</th>
            <th>${c.t("menuread.price")}</th>
            ${
              base
                ? html`<th>${c.t("menuread.included")}</th>
                    <th>${c.t("menuread.extra")}</th>`
                : html`<th colspan="2">${c.t("menuread.tier")}</th>`
            }
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(ownRow(list))}
        </tbody>
      </table>
    </div>`;
  return html`<p class="pizza-title">${c.t("read.result", { n: items.length })}</p>
    ${
      notes.length === 0
        ? ""
        : html`<section class="canccu-notice pizza-menu-notes" role="note">
            <p>${c.t("menuread.notes")}</p>
            <ul>
              ${notes.map(
                (n) => html`<li>${c.t("menuread.note", { text: n.text, page: n.page })}</li>`,
              )}
            </ul>
          </section>`
    }
    ${
      conflicts.length === 0
        ? ""
        : html`<p class="pizza-badge pizza-badge--warn">${c.t("menuread.conflicts")}</p>`
    }
    ${o.failure === null || o.failure === undefined ? "" : readErrorView(c, o.failure, {})}
    <p class="canccu-muted canccu-small">${c.t("menuread.fix")}</p>
    <!-- Enter in a field shows the table again with the edits, never a row's delete. -->
    <form${attrs({
      method: "post",
      action,
      enctype: "multipart/form-data",
      class: "pizza-form pizza-menu-read",
      "data-shrink": "",
      "data-menu-table": "",
      ...menuProgressAttrs(c),
    })}>
      ${formKey()}
      <button class="pizza-sr-only" type="submit" name="do" value="show" data-plain tabindex="-1"
        aria-hidden="true">
        ${c.t("menuread.check")}
      </button>
      ${notes.map(
        (n, i) =>
          html`<input type="hidden" name="note[${i}][kind]" value="${n.kind}" /><input
              type="hidden"
              name="note[${i}][text]"
              value="${n.text}"
            /><input type="hidden" name="note[${i}][page]" value="${n.page}" />`,
      )}
      <div class="pizza-table-wrap">
        <table class="pizza-table pizza-menu-table">
          <thead>
            <tr>
              <th>${c.t("menuread.number")}</th>
              <th>${c.t("menuread.name")}</th>
              <th>${c.t("menuread.toppings")}</th>
              <th>${c.t("menuread.price")}</th>
              <th>${c.t("menuread.category")}</th>
              <th>${c.t("menuread.page")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody data-items>
            ${items.map((i, k) => itemRow(rows[i] as MenuRow, i, k === 0 ? undefined : items[k - 1]))}
          </tbody>
        </table>
        <template data-row-template>${itemRow(BLANK, "__i__", undefined)}</template>
      </div>
      ${
        bases.length + toppings.length === 0
          ? ""
          : html`<h2 class="pizza-subtitle">${c.t("menuread.own")}</h2>
              ${bases.length === 0 ? "" : ownTable(bases, true)}
              ${toppings.length === 0 ? "" : ownTable(toppings, false)}`
      }
      ${
        gathered.length === 0
          ? ""
          : html`<p class="pizza-badge pizza-badge--warn">${c.t("menuread.gathered")}</p>
              ${ownTable(gathered, false)}`
      }
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--secondary" type="submit" name="do" value="add" data-plain>
          ${c.t("menuread.add")}
        </button>
      </div>
      <fieldset class="pizza-menu-more">
        <legend>${c.t("menuread.more")}</legend>
        <p class="canccu-muted canccu-small">${c.t("menuread.more_hint")}</p>
        <input
          class="canccu-input"
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label="${c.t("menuread.more")}"
        />
        <button class="canccu-button canccu-button--secondary" type="submit" name="do" value="more">
          ${c.t("menuread.more")}
        </button>
      </fieldset>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit" name="do" value="check" data-plain>
        ${c.t("menuread.check")}
      </button>
    </form>
    <details class="pizza-part">
      <summary>${c.t("menuread.csv")}</summary>
      <form method="post" action="${PREFIX}crew/pizzerias/import" class="pizza-form">
        ${formKey()}
        <textarea class="canccu-input pizza-csv" name="csv" rows="${Math.min(rows.length + 2, 20)}" spellcheck="false">
${csv}</textarea>
        <div class="canccu-cluster">
          <button class="canccu-button canccu-button--secondary" type="submit">${c.t("read.use")}</button>
          <a
            class="canccu-button canccu-button--secondary"
            download="menu.csv"
            href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}"
            >${c.t("read.download")}</a
          >
        </div>
      </form>
    </details>`;
}
