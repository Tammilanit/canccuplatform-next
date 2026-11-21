/**
 * Pizzerias and menus (mockup 11 A–C): the event's pizzerias, one pizzeria with its menu, and the
 * menu CSV's preview before anything changes; reading a menu photo (11 D) is in menu-read.ts.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { euros } from "../csv.js";
import type { MenuFile } from "../menu-csv.js";
import { flash } from "./order-view.js";
import { PREFIX, formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";

export interface MenuLine {
  id: string;
  number?: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  hidden?: boolean;
}

export interface PizzeriaView {
  id: string;
  name: string;
  phone?: string | null;
  website: string | null;
  service: "delivery" | "takeaway";
  hidden?: boolean;
  menu?: { items: MenuLine[]; base: MenuLine | null; toppings: MenuLine[] };
}

const P = `${PREFIX}crew/pizzerias`;
const price = (cents: number | null) => (cents === null ? "" : `€ ${euros(cents)}`);
const visible = (p: PizzeriaView) => (p.menu?.items ?? []).filter((i) => i.hidden !== true);

function summary(c: PageCtx, p: PizzeriaView): string {
  const items = visible(p);
  const priced = items.length > 0 && items.every((i) => i.price_cents !== null);
  return [
    p.service === "takeaway" ? c.t("menus.takeaway") : c.t("menus.delivers"),
    items.length === 1 ? c.t("menus.items_one") : c.t("menus.items", { n: items.length }),
    priced ? c.t("menus.prices") : c.t("menus.no_prices"),
  ].join(" · ");
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Mockup 11 A. */
export function pizzeriasView(c: PageCtx, list: PizzeriaView[], error?: string): Html {
  return html`${flash(error)}
    <div class="canccu-cluster pizza-menu-tools">
      <a class="canccu-button canccu-button--secondary canccu-button--sm" href="${P}/import"
        >${c.t("menus.import")}</a
      >
      <a class="canccu-button canccu-button--secondary canccu-button--sm" href="${P}/menu.csv"
        >${c.t("menus.download_all")}</a
      >
    </div>
    <p class="canccu-overline">${c.t("menus.count", { n: list.length })}</p>
    <ul class="canccu-card canccu-card--flush canccu-list">
      ${list.map(
        (p) =>
          html`<li>
            <a class="canccu-list__row" href="${P}/${p.id}">
              <div class="canccu-list__main">
                <p class="canccu-list__title">${p.name}</p>
                <p class="canccu-list__meta">${summary(c, p)}</p>
                <p class="canccu-list__meta">
                  ${p.website === null ? c.t("menus.no_web") : `${host(p.website)} ↗`}
                </p>
              </div>
            </a>
          </li>`,
      )}
    </ul>
    <details class="pizza-details">
      <summary class="canccu-button canccu-button--secondary">+ ${c.t("menus.add")}</summary>
      <form method="post" action="${P}" class="pizza-form">
        ${formKey()}
        <label class="canccu-field"
          ><span class="canccu-field__label">${c.t("menus.name")}</span
          ><input class="canccu-input" name="name" maxlength="80" required
        /></label>
        <button class="canccu-button canccu-button--primary" type="submit">
          ${c.t("menus.add")}
        </button>
      </form>
    </details>
    <p class="canccu-muted canccu-small">${c.t("menus.profile_note")}</p>`;
}

/** Mockup 11 B: one pizzeria, its details and its menu. */
export function pizzeriaView(c: PageCtx, p: PizzeriaView, error?: string, reader = false): Html {
  const menu = p.menu ?? { items: [], base: null, toppings: [] };
  const radio = (v: "delivery" | "takeaway", label: string) =>
    html`<label class="pizza-choice"
      ><input${attrs({ type: "radio", name: "service", value: v, checked: p.service === v })} /><span
        >${label}</span
      ></label
    >`;
  const shown = visible(p);
  return html`${flash(error)}
    <form method="post" action="${P}/${p.id}" class="canccu-card pizza-form">
      ${formKey()}
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("menus.name")}</span
        ><input class="canccu-input" name="name" maxlength="80" required value="${p.name}"
      /></label>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("menus.phone")}</span
        ><input
          class="canccu-input"
          name="phone"
          maxlength="40"
          value="${p.phone ?? ""}"
          inputmode="tel"
      /></label>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("menus.web")}</span
        ><input
          class="canccu-input"
          name="website"
          type="url"
          maxlength="300"
          value="${p.website ?? ""}"
          placeholder="https://"
      /></label>
      <fieldset class="pizza-fieldset">
        <legend class="canccu-field__label">${c.t("menus.service")}</legend>
        <div class="pizza-choices pizza-choices--two">
          ${radio("delivery", c.t("menus.delivers"))}${radio("takeaway", c.t("menus.takeaway"))}
        </div>
      </fieldset>
      <p class="canccu-muted canccu-small">
        ${menu.base === null ? c.t("menus.no_own") : c.t("menus.own", { n: menu.toppings.filter((t) => t.hidden !== true).length })}
      </p>
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--primary" type="submit" name="do" value="save">
          ${c.t("menus.save")}
        </button>
        <button
          class="canccu-button canccu-button--danger-ghost"
          type="submit"
          name="do"
          value="hide"
        >
          ${c.t("menus.hide")}
        </button>
      </div>
    </form>
    <p class="canccu-overline">${c.t("menus.menu", { n: shown.length })}</p>
    <div class="canccu-cluster pizza-menu-tools">
      <a class="canccu-button canccu-button--secondary canccu-button--sm" href="${P}/import"
        >${c.t("menus.import_short")}</a
      >
      <a
        class="canccu-button canccu-button--secondary canccu-button--sm"
        href="${P}/menu.csv?pizzeria_id=${p.id}"
        >${c.t("menus.download")}</a
      >
      ${
        reader
          ? html`<a
              class="canccu-button canccu-button--secondary canccu-button--sm"
              href="${P}/${p.id}/read"
              >${c.t("read.button")}</a
            >`
          : ""
      }
    </div>
    <ul class="canccu-card canccu-card--flush canccu-list">
      ${menu.items.map(
        (
          i,
        ) => html`<li${attrs({ class: i.hidden === true ? "canccu-list__row pizza-hidden" : "canccu-list__row" })}>
          <div class="canccu-list__main">
            <p class="canccu-list__title">${i.number ?? ""} ${i.name}</p>
            <p class="canccu-list__meta">${i.hidden === true ? c.t("menus.hidden") : (i.description ?? "")}</p>
          </div>
          <span class="canccu-list__end canccu-num">${i.hidden === true ? "" : price(i.price_cents)}</span>
        </li>`,
      )}
    </ul>`;
}

/** The import's first step: a CSV file or its text. */
export function importView(c: PageCtx, error?: string): Html {
  return html`${flash(error)}
    <form method="post" action="${P}/import" class="canccu-card pizza-form" data-csv>
      ${formKey()}
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("import.file")}</span
        ><input class="canccu-input" type="file" accept=".csv,text/csv" data-csv-file
      /></label>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("import.text")}</span
        ><textarea
          class="canccu-input pizza-csv"
          name="csv"
          rows="8"
          required
          spellcheck="false"
        ></textarea>
      </label>
      <p class="canccu-muted canccu-small">${c.t("import.spec")}</p>
      <button class="canccu-button canccu-button--primary" type="submit">
        ${c.t("import.preview")}
      </button>
    </form>`;
}

export interface Change {
  pizzeria: string;
  title: string;
  what: string;
  kind: "new" | "changed" | "hidden";
}

/** What the file changes, item by item, against the menus as they are (mockup 11 C). */
export function changesOf(
  c: PageCtx,
  file: MenuFile,
  current: Map<string, PizzeriaView>,
): Change[] {
  const out: Change[] = [];
  for (const p of file.pizzerias) {
    const now = current.get(p.name.toLowerCase());
    const items = (now?.menu?.items ?? []).filter((i) => i.hidden !== true);
    if (now === undefined)
      out.push({
        pizzeria: p.name,
        title: p.name,
        what: c.t("import.new_pizzeria", { n: p.menu.items.length }),
        kind: "new",
      });
    for (const it of p.menu.items) {
      const was = items.find((i) => i.number === it.number);
      const title = `${it.number} ${it.name}`;
      if (was === undefined) {
        if (now !== undefined)
          out.push({
            pizzeria: p.name,
            title,
            what: `${c.t("import.new")}${it.price_cents === null ? "" : ` · ${price(it.price_cents)}`}`,
            kind: "new",
          });
        continue;
      }
      const what: string[] = [];
      if (was.name !== it.name) what.push(c.t("import.renamed", { from: was.name }));
      if (was.price_cents !== it.price_cents)
        what.push(
          c.t("import.price", {
            from: price(was.price_cents) || "—",
            to: price(it.price_cents) || "—",
          }),
        );
      if ((was.description ?? null) !== it.description) what.push(c.t("import.description"));
      if (what.length > 0)
        out.push({ pizzeria: p.name, title, what: what.join(" · "), kind: "changed" });
    }
    for (const i of items)
      if (!p.menu.items.some((it) => it.number === i.number))
        out.push({
          pizzeria: p.name,
          title: `${i.number ?? ""} ${i.name}`,
          what: c.t("import.dropped"),
          kind: "hidden",
        });
  }
  return out;
}

/** Mockup 11 C: the preview, with its errors and warnings by row, and Apply. */
export function previewView(
  c: PageCtx,
  csv: string,
  file: MenuFile,
  changes: Change[],
  rows: number,
): Html {
  const issue = (i: { row: number | null; column: string | null; message: string }) =>
    html`<li>
      ${i.row === null ? "" : c.t("import.row", { row: i.row })}${i.column === null ? "" : ` · ${i.column}`}:
      ${i.message}
    </li>`;
  const blocked = file.errors.length > 0;
  return html`<section class="canccu-card">
      <p class="pizza-card__title">
        ${c.t("import.summary", { rows, pizzerias: file.pizzerias.length })}
      </p>
    </section>
    ${
      blocked
        ? html`<div class="canccu-notice canccu-notice--down" role="alert">
            <div class="canccu-notice__body">
              <p class="canccu-notice__title">${c.t("import.errors")}</p>
              <ul>
                ${file.errors.map(issue)}
              </ul>
            </div>
          </div>`
        : ""
    }
    ${
      file.warnings.length > 0
        ? html`<div class="canccu-notice canccu-notice--warn">
            <div class="canccu-notice__body">
              <p class="canccu-notice__title">${c.t("import.warnings")}</p>
              <ul>
                ${file.warnings.map(issue)}
              </ul>
            </div>
          </div>`
        : ""
    }
    <p class="canccu-overline">${c.t("import.changes", { n: changes.length })}</p>
    <ul class="canccu-card canccu-card--flush canccu-list">
      ${
        changes.length === 0
          ? html`<li class="canccu-list__row canccu-muted">${c.t("import.nothing")}</li>`
          : changes.map(
              (ch) =>
                html`<li class="canccu-list__row">
                  <div class="canccu-list__main">
                    <p class="canccu-list__title">${ch.title}</p>
                    <p class="canccu-list__meta pizza-change pizza-change--${ch.kind}">
                      ${file.pizzerias.length > 1 ? `${ch.pizzeria} · ` : ""}${ch.what}
                    </p>
                  </div>
                </li>`,
            )
      }
    </ul>
    <form method="post" action="${P}/import/apply" class="canccu-savebar">
      ${formKey()}
      <textarea name="csv" hidden>${csv}</textarea>
      <span class="canccu-savebar__text">${c.t("import.changes", { n: changes.length })}</span>
      <a class="canccu-button canccu-button--secondary" href="${P}/import"
        >${c.t("import.cancel")}</a
      >
      <button
        class="canccu-button canccu-button--primary"
        type="submit"
        ${blocked ? "disabled" : ""}
      >
        ${c.t("import.apply")}
      </button>
    </form>`;
}
