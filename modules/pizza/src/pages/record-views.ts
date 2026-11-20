/**
 * The daily record and the export for the payment system (mockup 12; `pizza.record.read`): a day's
 * orders with total, split, payer, settle to and flags; one order's money; the export's preview
 * with the orders it leaves out named. Amounts are the API's; these pages only show them.
 */
import { html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { DailyRecord, RecordDay } from "../record.js";
import { PREFIX } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { euro, pizzasOf } from "./money-format.js";
import type { MoneyView } from "./money-format.js";
import { time } from "./order-view.js";

type RecordOrder = RecordDay["orders"][number] & {
  placed_at: string | null;
  arrived_at: string | null;
  done_at: string | null;
  total_from_receipt: boolean;
  paid_count: number;
};

export const WHOLE = "all";

/** The days to pick from, and the whole event (mockup 12 A's chips). */
export function dayChips(
  c: PageCtx,
  days: { day: string; label: string }[],
  picked: string,
  path: string,
): Html {
  const chip = (day: string, label: string) =>
    html`<a
      class="canccu-button canccu-button--sm ${day === picked ? "canccu-button--primary" : "canccu-button--secondary"}"
      href="${PREFIX}${path}?day=${day}"
      ${day === picked ? html`aria-current="page"` : ""}
      >${label}</a
    >`;
  return html`<nav class="pizza-days" aria-label="${c.t("export.which")}">
    ${days.map((d) => chip(d.day, d.label))} ${chip(WHOLE, c.t("record.whole"))}
  </nav>`;
}

const pizzasIn = (o: RecordDay["orders"][number]) => o.people.reduce((s, p) => s + p.units, 0);

function orderCard(c: PageCtx, o: RecordOrder, flags: DailyRecord["flags"]): Html {
  const total =
    o.total_cents === null
      ? c.t("money.no_total")
      : c.t(o.split_effective === "exact" ? "record.split_exact" : "record.split_even", {
          amount: euro(c, o.total_cents),
        });
  const payer = o.payer_name ?? "—";
  return html`<li>
    <a class="pizza-card pizza-card--link" href="${PREFIX}crew/record/${o.id}">
      <p class="pizza-card__title">${c.t("record.order", { seq: o.seq, pizzeria: o.pizzeria })}</p>
      <p>${total}</p>
      <p class="pizza-card__meta">
        ${
          o.payer_name === null
            ? pizzasOf(c, pizzasIn(o))
            : c.t(o.settle_to === "payer" ? "record.to_them" : "record.via_organiser", {
                name: payer,
              })
        }
      </p>
      ${flags
        .filter((f) => f.order_id === o.id)
        .map((f) => html`<p class="pizza-badge pizza-badge--warn">${f.text}</p>`)}
    </a>
  </li>`;
}

/** Mockup 12 A: the picked day's orders, or the whole event's, day by day. */
export function recordView(c: PageCtx, r: DailyRecord, picked: string, all: RecordDay[]): Html {
  const days = picked === WHOLE ? r.days : r.days.filter((d) => d.day === picked);
  return html`${dayChips(c, all, picked, "crew/record")}
    ${days.length === 0 ? html`<p class="canccu-muted">${c.t("record.empty")}</p>` : ""}
    ${days.map(
      (d) =>
        html`<section>
          <p class="pizza-section">
            ${c.t("record.day_line", {
              day: d.label,
              orders: d.order_count,
              pizzas: d.orders.reduce((s, o) => s + pizzasIn(o), 0),
            })}
          </p>
          <ul class="pizza-people">
            ${d.orders.map((o) => orderCard(c, o as RecordOrder, r.flags))}
          </ul>
        </section>`,
    )}
    <a class="canccu-button canccu-button--primary" href="${PREFIX}crew/export?day=${picked}"
      >${c.t("record.export")}</a
    >`;
}

/** Mockup 12 B: one order's money, as the treasurer checks it. */
export function recordOrderView(
  c: PageCtx,
  o: RecordOrder,
  day: string,
  m: MoneyView,
  flags: DailyRecord["flags"],
  history: Slot,
): Html {
  const sum = m.people.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  const owing = m.people.filter((p) => p.paid !== null);
  return html`<section class="pizza-card">
      <p class="pizza-card__title">${o.pizzeria} · ${day}</p>
      <p class="pizza-card__meta">
        ${c.t("record.times", {
          placed: time(c, o.placed_at) || "—",
          arrived: time(c, o.arrived_at) || "—",
          done: time(c, o.done_at) || "—",
        })}
      </p>
      ${o.payer_name === null ? "" : html`<p>${c.t("record.payer_paid", { name: o.payer_name })}</p>`}
      <p class="pizza-card__title">
        ${
          o.total_cents === null
            ? c.t("money.no_total")
            : c.t(o.total_from_receipt ? "record.receipt_confirmed" : "record.total_typed", {
                amount: euro(c, o.total_cents),
              })
        }
      </p>
      ${flags
        .filter((f) => f.order_id === o.id)
        .map((f) => html`<p class="pizza-badge pizza-badge--warn">${f.text}</p>`)}
    </section>
    <p class="pizza-section">
      ${c.t(m.split_effective === "exact" ? "money.each_exact" : "money.each_even")}
    </p>
    <ul class="pizza-people">
      ${m.people.map(
        (p) =>
          html`<li class="pizza-person">
            <span class="pizza-person__text"
              ><span class="pizza-person__name">${p.name ?? "—"}</span
              ><span class="pizza-person__what"
                >${pizzasOf(c, p.units)}${
                  p.user_id !== null && p.user_id === m.payer?.user_id
                    ? ` · ${c.t("record.paid_pizzeria")}`
                    : ""
                }</span
              ></span
            ><span class="pizza-amount canccu-num"
              >${p.amount_cents === null ? "—" : euro(c, p.amount_cents)}</span
            >
          </li>`,
      )}
    </ul>
    ${
      o.total_cents !== null && sum === o.total_cents
        ? html`<p class="pizza-ok">${c.t("record.sum_ok", { amount: euro(c, sum) })}</p>`
        : ""
    }
    <p>
      ${
        m.settle_to === "payer"
          ? c.t("record.settles_payer", { name: m.payer?.name ?? "—" })
          : c.t("record.settles_organiser")
      }
    </p>
    ${
      m.settle_to === "payer"
        ? html`<p class="pizza-muted">
            ${c.t("record.marked", { k: owing.filter((p) => p.paid === true).length, n: owing.length })}
          </p>`
        : ""
    }
    ${
      m.receipts.length === 0
        ? ""
        : html`<p class="pizza-section">${c.t("record.receipts")}</p>
            <ul class="pizza-receipts">
              ${m.receipts.map(
                (r, i) =>
                  html`<li class="pizza-receipt">
                    <a href="/api/pizza/receipts/${r.id}/photo"
                      ><img
                        src="/api/pizza/receipts/${r.id}/photo"
                        alt="${c.t("money.receipt", { n: i + 1, time: time(c, r.added_at) })}"
                        loading="lazy"
                    /></a>
                  </li>`,
              )}
            </ul>
            <p class="pizza-muted">${c.t("money.receipt_who")}</p>`
    }
    ${history}`;
}

export interface ExportAnswer {
  file_name: string;
  csv: string;
  left_out: { order_id: string; pizzeria: string; reason: string }[];
}

/** Mockup 12 C: the export, its orders left out named, a preview and the file. */
export function exportView(
  c: PageCtx,
  e: ExportAnswer,
  rows: string[][],
  picked: string,
  days: { day: string; label: string }[],
): Html {
  const [head = [], ...body] = rows;
  const col = (name: string) => head.indexOf(name);
  const orders = new Set(body.map((r) => r[col("order_id")])).size;
  const shown = body.slice(0, 4);
  const seqOf = (id: string) => id.split("-").at(-1) ?? id;
  return html`${dayChips(c, days, picked, "crew/export")}
    <p class="pizza-card__title">${c.t("export.count", { orders, rows: body.length })}</p>
    ${e.left_out.map(
      (l) =>
        html`<div class="canccu-notice canccu-notice--degraded">
          <p class="canccu-notice__title">${c.t("export.left_out", { seq: seqOf(l.order_id) })}</p>
          <p>${c.t("export.left_out_text")}</p>
        </div>`,
    )}
    <p class="pizza-section">${c.t("export.preview")}</p>
    <table class="pizza-table">
      <thead>
        <tr>
          <th>${c.t("export.col_order")}</th>
          <th>${c.t("export.col_nick")}</th>
          <th class="canccu-num">${c.t("export.col_units")}</th>
          <th class="canccu-num">${c.t("export.col_amount")}</th>
        </tr>
      </thead>
      <tbody>
        ${shown.map(
          (r) =>
            html`<tr>
              <td>…${(r[col("order_id")] ?? "").slice(-4)}</td>
              <td>${r[col("nick")] ?? ""}</td>
              <td class="canccu-num">${r[col("units")] ?? ""}</td>
              <td class="canccu-num">${r[col("amount")] || "—"}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <p class="pizza-muted">${c.t("export.showing", { n: shown.length, all: body.length })}</p>
    <p class="pizza-muted">${c.t("export.format")}</p>
    <p class="pizza-muted">${c.t("export.spec")}</p>
    <a
      class="canccu-button canccu-button--primary"
      href="/api/pizza/export.csv${picked === WHOLE ? "" : `?day=${picked}`}"
      download="${e.file_name}"
      >${c.t("export.download")}</a
    >`;
}
