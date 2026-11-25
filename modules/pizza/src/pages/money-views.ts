/**
 * An order's money, for its holder and the crew (mockups 18 A and E, 19): the total and where it
 * came from, its receipts, exact or even, each person's amount, a pizza without a price, who is
 * paid, "Pay me with" and who still owes the payer. Each form is one of the API's own writes.
 */
import { attrs, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { PROVIDER } from "../reader.js";
import { formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { euro, pizzasOf } from "./money-format.js";
import type { MoneyPerson, MoneyView } from "./money-format.js";
import { base, flash, time } from "./order-view.js";
import type { OrderView } from "./order-view.js";

export interface MoneyPageOpts {
  /** The event's AI reader is on and has a key: the scan reads, after the notice. */
  reader: boolean;
  /** The event lets holders take payment (M1): "Me directly" is offered. */
  directly: boolean;
  me: string;
  error?: string;
}

const photoUrl = (id: string) => `/api/pizza/receipts/${encodeURIComponent(id)}/photo`;

/** "Read by an outside service": said before any photo is sent (the plan, The optional AI reader). */
export const outsideNotice = (c: PageCtx, text: string): Html =>
  notice({ kind: "info", title: c.t("money.outside"), text });

/** The line under the split: how the amounts are worked out. */
export function splitLine(c: PageCtx, m: MoneyView): string {
  const total = m.total_effective_cents;
  const units = m.people.reduce((s, p) => s + p.units, 0);
  if (total === null || units === 0) return "";
  if (m.split_effective === "exact" && m.extras_cents !== null)
    return c.t("money.exact_line", {
      extras: euro(c, m.extras_cents),
      each: euro(c, Math.round(m.extras_cents / units)),
    });
  // The even-share limit (#789 item 8): who pays above it, or that there is no average to limit.
  const over = m.people.filter((p) => p.over_limit_cents > 0);
  if (over.length > 0) {
    const surplus = over.reduce((s, p) => s + p.over_limit_cents, 0);
    return c.t("money.even_over", {
      each: euro(c, Math.round((total - surplus) / units)),
      over: over.map((p) => `${p.name ?? "—"} +${euro(c, p.over_limit_cents)}`).join(", "),
    });
  }
  const line = c.t("money.even_line", {
    total: euro(c, total),
    n: units,
    each: euro(c, Math.round(total / units)),
  });
  return m.even_limit_cents === null ? c.t("money.even_no_average", { line }) : line;
}

/**
 * The page's hero: the total, who paid it and where it came from, with its receipts. It shows
 * once; the old "Total … confirmed" card said the same amount a second time.
 */
function hero(c: PageCtx, o: OrderView, m: MoneyView, me: string): Html {
  if (m.total_cents === null)
    return html`<section class="pizza-hero">
      <p class="pizza-hero__title">${c.t("money.no_total")}</p>
      <p class="pizza-meta">
        ${c.t("money.order_line", { pizzeria: o.pizzeria.name, n: o.pizza_count })}
      </p>
    </section>`;
  const amount = euro(c, m.total_cents);
  return html`<section class="pizza-hero pizza-money-hero">
    <div class="pizza-block">
      <p class="pizza-hero__title">
        ${
          m.payer?.user_id === me
            ? c.t("money.paid_by_you", { amount })
            : c.t("money.paid_by", { amount, name: m.payer?.name ?? "—" })
        }
      </p>
      <p class="pizza-meta">
        ${c.t(m.total_receipt_id === null ? "money.typed" : "money.from_receipt", { pizzeria: o.pizzeria.name })}${
          m.total_set_by === null
            ? ""
            : html` ·
              ${c.t("money.confirmed_by", { name: m.total_set_by.name, time: time(c, m.total_set_at) })}`
        }
      </p>
      <p class="pizza-links">
        <a href="${base(o)}/money/scan">${c.t("money.another")}</a>
        <a href="${base(o)}/money/total">${c.t("money.change_total")}</a>
      </p>
    </div>
    ${
      m.receipts.length === 0
        ? ""
        : html`<ul class="pizza-receipts" aria-describedby="pizza-receipt-who">
              ${m.receipts.map(
                (r, i) =>
                  html`<li class="pizza-receipt">
                    <a href="${photoUrl(r.id)}" data-viewer="${c.t("money.close_photo")}"
                      ><img
                        src="${photoUrl(r.id)}"
                        alt="${c.t("money.receipt", { n: i + 1, time: time(c, r.added_at) })}"
                    /></a>
                  </li>`,
              )}
            </ul>
            <p class="pizza-muted" id="pizza-receipt-who">${c.t("money.receipt_who")}</p>`
    }
  </section>`;
}

/** Mockup 18 A: no total yet. */
function addReceipt(c: PageCtx, o: OrderView, m: MoneyView, reader: boolean): Html {
  const priced = m.prices.every((p) => p.price_cents !== null);
  const sum = m.prices.reduce((s, p) => s + (p.price_cents ?? 0), 0);
  return html`<section class="pizza-block">
      <h2 class="pizza-section">${c.t("money.add_receipt")}</h2>
      <p class="pizza-muted">${c.t("money.add_receipt_hint")}</p>
    </section>
    ${reader ? outsideNotice(c, c.t("money.outside_text", { provider: PROVIDER.name })) : ""}
    <div class="pizza-stack">
      ${
        reader
          ? html`<a
                class="canccu-button canccu-button--primary pizza-wide"
                href="${base(o)}/money/scan"
                >${c.t("money.scan")}</a
              ><a
                class="canccu-button canccu-button--secondary pizza-wide"
                href="${base(o)}/money/total"
                >${c.t("money.type_instead")}</a
              >`
          : html`<a
                class="canccu-button canccu-button--primary pizza-wide"
                href="${base(o)}/money/total"
                >${c.t("pad.title")}</a
              ><a
                class="canccu-button canccu-button--secondary pizza-wide"
                href="${base(o)}/money/scan"
                >${c.t("money.photo_only")}</a
              >`
      }
    </div>
    <section class="pizza-block">
      <h2 class="pizza-section">${c.t("money.this_order")}</h2>
      ${priced ? html`<p class="pizza-muted">${c.t("money.menu_sum", { amount: euro(c, sum) })}</p>` : ""}
    </section>`;
}

/** Mockup 19 D: pizzas without a price, each with its own field on the amount pad's keyboard. */
function unpriced(c: PageCtx, o: OrderView, m: MoneyView): Slot {
  const missing = m.prices.filter((p) => p.price_cents === null);
  if (missing.length === 0) return "";
  const names = new Map(m.people.map((p) => [p.user_id, p.name]));
  return html`<section class="pizza-block">
    <p class="pizza-title">
      ${missing.length === 1 ? c.t("money.unpriced_one") : c.t("money.unpriced", { n: missing.length })}
    </p>
    <p class="pizza-muted">${c.t("money.unpriced_hint")}</p>
    ${missing.map(
      (p) =>
        html`<form method="post" action="${base(o)}/money/price" class="pizza-price">
          ${formKey()}<input type="hidden" name="item_id" value="${p.item_id}" />
          <label class="canccu-field"
            ><span class="canccu-field__label">${p.label} (${names.get(p.user_id) ?? "—"})</span
            ><input
              class="canccu-input pizza-amount-input"
              name="price"
              inputmode="decimal"
              autocomplete="off"
              required
              placeholder="0.00"
          /></label>
          <button class="canccu-button canccu-button--secondary" type="submit">
            ${c.t("money.save_price")}
          </button>
        </form>`,
    )}
    ${m.total_cents === null ? "" : html`<p class="pizza-muted">${c.t("money.unpriced_even", { line: splitLine(c, { ...m, split_effective: "even" }) })}</p>`}
  </section>`;
}

/**
 * One choice of a pair (mockup 19's pills): a submit button, so a tap selects it at once, as the
 * mockup does, and the page still works without a script. The current one shows as pressed.
 */
function choice(
  name: string,
  value: string,
  label: string,
  pressed: boolean,
  disabled = false,
): Html {
  return html`<button${attrs({
    class: "pizza-pill",
    type: "submit",
    name,
    value,
    disabled,
    "aria-pressed": pressed ? "true" : "false",
  })}>
    ${label}
  </button>`;
}

function splitChoice(c: PageCtx, o: OrderView, m: MoneyView): Slot {
  if (m.total_effective_cents === null) return "";
  return html`<form method="post" action="${base(o)}/money/split" class="pizza-form">
    ${formKey()}
    <fieldset class="pizza-fieldset">
      <legend class="pizza-sr">${c.t("money.split")}</legend>
      <div class="pizza-pills">
        ${choice("split", "exact", c.t("money.exact"), m.split_effective === "exact", !m.exact_possible)}
        ${choice("split", "even", c.t("money.even"), m.split_effective === "even")}
      </div>
    </fieldset>
  </form>`;
}

/** "#12 Kebab ×2, #1 Margherita": a person's pizzas, the same ones counted once. */
function pizzasLine(m: MoneyView, userId: string | null): { labels: string; cents: number | null } {
  // Anonymised people all have a null user_id: their rows cannot be told apart, so no breakdown.
  if (userId === null) return { labels: "", cents: null };
  const mine = m.prices.filter((p) => p.user_id === userId);
  const counts = new Map<string, number>();
  for (const p of mine) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
  const labels = [...counts].map(([l, n]) => (n === 1 ? l : `${l} ×${n}`)).join(", ");
  const cents = mine.every((p) => p.price_cents !== null)
    ? mine.reduce((s, p) => s + (p.price_cents ?? 0), 0)
    : null;
  return { labels, cents };
}

/**
 * Mockup 19 B and C as one table: each person's pizzas, how their amount is made (prices plus
 * their share of the extras, when exact) and, when it settles to the holder, their Paid tick on
 * the same row. Who owes you is the line over it, not a second list of the same people.
 */
function people(c: PageCtx, o: OrderView, m: MoneyView, me: string): Html {
  const who = (p: MoneyPerson) =>
    p.user_id === me ? c.t("money.you", { name: p.name ?? "—" }) : (p.name ?? "—");
  const exact = m.split_effective === "exact";
  const toPayer = m.settle_to === "payer";
  const made = (p: MoneyPerson) => {
    const l = pizzasLine(m, p.user_id);
    if (!exact || l.cents === null || p.amount_cents === null) return "";
    const extra = p.amount_cents - l.cents;
    return `${euro(c, l.cents)} ${extra < 0 ? "−" : "+"} ${euro(c, Math.abs(extra))}`;
  };
  const owing = m.people.filter((p) => p.paid !== null);
  const open = owing.filter((p) => p.paid === false);
  const sum = (ps: MoneyPerson[]) => ps.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  return html`<section class="pizza-block pizza-people-part">
    <div class="pizza-heading">
      <h2 class="pizza-section">${c.t(exact ? "money.each_exact" : "money.each_even")}</h2>
      ${splitChoice(c, o, m)}
    </div>
    <p class="pizza-muted">${splitLine(c, m)}</p>
    ${
      toPayer
        ? html`<p class="pizza-title">
              ${c.t("money.owes")} · ${c.t("money.to_collect", { amount: euro(c, sum(open)) })}
            </p>
            <p class="pizza-muted">
              ${c.t("money.owe_line", { n: owing.length, amount: euro(c, sum(owing)), k: owing.length - open.length })}
              · ${c.t("money.memo")}
            </p>`
        : ""
    }
    <table class="pizza-table pizza-people-table">
      <thead>
        <tr>
          <th>${c.t("money.col_person")}</th>
          <th>${c.t("money.col_pizzas")}</th>
          ${exact ? html`<th class="canccu-num">${c.t("money.col_made")}</th>` : ""}
          <th class="canccu-num">${c.t("money.col_amount")}</th>
          ${toPayer ? html`<th class="pizza-table__tick">${c.t("money.paid")}</th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${m.people.map(
          (p) =>
            html`<tr>
              <td class="pizza-person__name">${who(p)}</td>
              <td>${pizzasLine(m, p.user_id).labels || pizzasOf(c, p.units)}</td>
              ${exact ? html`<td class="canccu-num pizza-muted">${made(p)}</td>` : ""}
              <td class="canccu-num pizza-amount">
                ${p.amount_cents === null ? "—" : euro(c, p.amount_cents)}
              </td>
              ${
                toPayer
                  ? html`<td class="pizza-table__tick">
                      ${p.paid === null ? html`<span class="pizza-tick-none" aria-hidden="true">—</span>` : paidTick(c, o, p, "money")}
                    </td>`
                  : ""
              }
            </tr>`,
        )}
      </tbody>
    </table>
  </section>`;
}

function whoIsPaid(c: PageCtx, o: OrderView, m: MoneyView, directly: boolean): Slot {
  if (!directly && m.settle_to === "organiser") return "";
  const payer = m.settle_to === "payer";
  return html`<form method="post" action="${base(o)}/money/settle" class="pizza-form">
    ${formKey()}
    <fieldset class="pizza-fieldset">
      <legend class="pizza-section">${c.t("money.who_paid")}</legend>
      <div class="pizza-pills">
        ${choice("settle_to", "organiser", c.t("money.organiser"), !payer)}
        ${choice("settle_to", "payer", c.t("money.directly"), payer, !directly)}
      </div>
    </fieldset>
    <p class="pizza-muted">${c.t(payer ? "money.directly_text" : "money.organiser_text")}</p>
  </form>`;
}

/** Mockup 19 B: how the people pay the payer; the payer edits their own details here. */
function payWith(c: PageCtx, o: OrderView, m: MoneyView, me: string): Slot {
  if (m.settle_to !== "payer" || m.pay_to === null) return "";
  const p = m.pay_to;
  const others = m.people.filter((x) => x.user_id !== p.user_id).length;
  const shown = html`${p.mobilepay === null ? "" : html`<p>${c.t("money.mobilepay", { number: p.mobilepay })}</p>`}
  ${p.iban === null ? "" : html`<p>${c.t("money.bank", { iban: p.iban })}</p>`}
  ${p.mobilepay === null && p.iban === null ? html`<p class="pizza-muted">${c.t("money.no_details")}</p>` : ""}`;
  const edit =
    p.user_id !== me
      ? ""
      : html`<details class="pizza-details">
          <summary>${c.t("money.edit")}</summary>
          <form method="post" action="${base(o)}/money/pay-with" class="pizza-form">
            ${formKey()}
            <label class="canccu-field"
              ><span class="canccu-field__label">${c.t("money.mobilepay_label")}</span
              ><input
                class="canccu-input"
                name="mobilepay"
                inputmode="tel"
                autocomplete="tel"
                value="${p.mobilepay ?? ""}"
            /></label>
            <label class="canccu-field"
              ><span class="canccu-field__label">${c.t("money.iban_label")}</span
              ><input
                class="canccu-input"
                name="iban"
                autocomplete="off"
                spellcheck="false"
                value="${p.iban ?? ""}"
            /></label>
            <button class="canccu-button canccu-button--primary" type="submit">
              ${c.t("money.save_details")}
            </button>
          </form>
        </details>`;
  return html`<section class="pizza-block">
    <h3 class="pizza-section">${c.t("money.pay_with")}</h3>
    ${shown} ${edit}
    <p class="pizza-muted">${c.t("money.pay_with_hint", { n: others })}</p>
  </section>`;
}

/** A person's Paid tick: the holder's memo (U12 A). `back` is the page to return to. */
export function paidTick(
  c: PageCtx,
  o: OrderView,
  p: MoneyPerson,
  back: "money" | "hand-out",
): Html {
  return html`<form method="post" action="${base(o)}/paid" class="pizza-inline">
    ${formKey()}<input type="hidden" name="user_id" value="${p.user_id ?? ""}" /><input
      type="hidden"
      name="paid"
      value="${p.paid === true ? "no" : "yes"}"
    /><input type="hidden" name="back" value="${back}" />
    <button
      class="pizza-tick ${p.paid === true ? "pizza-tick--on" : ""}"
      type="submit"
      aria-pressed="${p.paid === true ? "true" : "false"}"
      aria-label="${c.t("money.mark", { name: p.name ?? "—" })}"
    ></button>
  </form>`;
}

export function moneyPageView(c: PageCtx, o: OrderView, m: MoneyView, s: MoneyPageOpts): Html {
  // One flow (#771): the total, then the people with their amounts and Paid ticks (what the
  // holder comes back to), then how it is settled, which is set once.
  return html`${flash(s.error)}${hero(c, o, m, s.me)}
  ${m.total_cents === null ? addReceipt(c, o, m, s.reader) : ""} ${unpriced(c, o, m)}
  ${m.total_cents === null ? "" : people(c, o, m, s.me)} ${whoIsPaid(c, o, m, s.directly)}
  ${payWith(c, o, m, s.me)}`;
}
