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
  return c.t("money.even_line", {
    total: euro(c, total),
    n: units,
    each: euro(c, Math.round(total / units)),
  });
}

function header(c: PageCtx, o: OrderView, m: MoneyView, me: string): Html {
  if (m.total_cents === null)
    return html`<section class="pizza-card">
      <p class="pizza-card__title">${c.t("money.no_total")}</p>
      <p class="pizza-card__meta">
        ${c.t("money.order_line", { pizzeria: o.pizzeria.name, n: o.pizza_count })}
      </p>
    </section>`;
  const amount = euro(c, m.total_cents);
  return html`<section class="pizza-card">
    <p class="pizza-card__title">
      ${
        m.payer?.user_id === me
          ? c.t("money.paid_by_you", { amount })
          : c.t("money.paid_by", { amount, name: m.payer?.name ?? "—" })
      }
    </p>
    <p class="pizza-card__meta">
      ${c.t(m.total_receipt_id === null ? "money.typed" : "money.from_receipt", { pizzeria: o.pizzeria.name })}
    </p>
  </section>`;
}

/** Mockup 18 A: no total yet. */
function addReceipt(c: PageCtx, o: OrderView, m: MoneyView, reader: boolean): Html {
  const priced = m.prices.every((p) => p.price_cents !== null);
  const sum = m.prices.reduce((s, p) => s + (p.price_cents ?? 0), 0);
  return html`<section class="pizza-card">
      <p class="pizza-card__title">${c.t("money.add_receipt")}</p>
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
    <section class="pizza-card">
      <p class="pizza-section">${c.t("money.this_order")}</p>
      <p>${c.t("money.order_line", { pizzeria: o.pizzeria.name, n: o.pizza_count })}</p>
      ${priced ? html`<p class="pizza-muted">${c.t("money.menu_sum", { amount: euro(c, sum) })}</p>` : ""}
    </section>`;
}

/** Mockup 18 E: the total is in; its receipts, seen by the holder, the crew and the organiser. */
function confirmed(c: PageCtx, o: OrderView, m: MoneyView): Html {
  return html`<section class="pizza-card pizza-card--here">
    <p class="pizza-card__title">
      ${c.t("money.confirmed", { amount: euro(c, m.total_cents ?? 0) })}
    </p>
    ${
      m.total_set_by === null
        ? ""
        : html`<p class="pizza-card__meta">
            ${c.t("money.confirmed_by", { name: m.total_set_by.name, time: time(c, m.total_set_at) })}
          </p>`
    }
    ${
      m.receipts.length === 0
        ? ""
        : html`<ul class="pizza-receipts">
              ${m.receipts.map(
                (r, i) =>
                  html`<li class="pizza-receipt">
                    <a href="${photoUrl(r.id)}"
                      ><img
                        src="${photoUrl(r.id)}"
                        alt="${c.t("money.receipt", { n: i + 1, time: time(c, r.added_at) })}"
                    /></a>
                    <span>${c.t("money.receipt", { n: i + 1, time: time(c, r.added_at) })}</span>
                  </li>`,
              )}
            </ul>
            <p class="pizza-muted">${c.t("money.receipt_who")}</p>`
    }
    <div class="pizza-card__links">
      <a href="${base(o)}/money/scan">${c.t("money.another")}</a>
      <a href="${base(o)}/money/total">${c.t("money.change_total")}</a>
    </div>
  </section>`;
}

/** Mockup 19 D: pizzas without a price, each with its own field on the amount pad's keyboard. */
function unpriced(c: PageCtx, o: OrderView, m: MoneyView): Slot {
  const missing = m.prices.filter((p) => p.price_cents === null);
  if (missing.length === 0) return "";
  const names = new Map(m.people.map((p) => [p.user_id, p.name]));
  return html`<section class="pizza-card">
    <p class="pizza-card__title">
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

function split(c: PageCtx, o: OrderView, m: MoneyView): Slot {
  if (m.total_effective_cents === null) return "";
  return html`<form method="post" action="${base(o)}/money/split" class="pizza-card pizza-form">
    ${formKey()}
    <fieldset class="pizza-fieldset">
      <legend class="pizza-section">${c.t("money.split")}</legend>
      <div class="pizza-pills">
        ${choice("split", "exact", c.t("money.exact"), m.split_effective === "exact", !m.exact_possible)}
        ${choice("split", "even", c.t("money.even"), m.split_effective === "even")}
      </div>
    </fieldset>
    <p class="pizza-muted">${splitLine(c, m)}</p>
  </form>`;
}

function people(c: PageCtx, m: MoneyView, me: string): Html {
  const who = (p: MoneyPerson) =>
    p.user_id === me ? c.t("money.you", { name: p.name ?? "—" }) : (p.name ?? "—");
  return html`<p class="pizza-section">
      ${c.t(m.split_effective === "exact" ? "money.each_exact" : "money.each_even")}
    </p>
    <ul class="pizza-people">
      ${m.people.map(
        (p) =>
          html`<li class="pizza-person">
            <span class="pizza-person__text"
              ><span class="pizza-person__name">${who(p)}</span
              ><span class="pizza-person__what">${pizzasOf(c, p.units)}</span></span
            ><span class="pizza-amount canccu-num"
              >${p.amount_cents === null ? "—" : euro(c, p.amount_cents)}</span
            >
          </li>`,
      )}
    </ul>`;
}

function whoIsPaid(c: PageCtx, o: OrderView, m: MoneyView, directly: boolean): Slot {
  if (!directly && m.settle_to === "organiser") return "";
  const payer = m.settle_to === "payer";
  return html`<form method="post" action="${base(o)}/money/settle" class="pizza-card pizza-form">
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
  return html`<section class="pizza-card">
    <p class="pizza-section">${c.t("money.pay_with")}</p>
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

/** Mockup 19 C: who still owes the payer, with the ticks. */
function owes(c: PageCtx, o: OrderView, m: MoneyView): Slot {
  if (m.settle_to !== "payer") return "";
  const owing = m.people.filter((p) => p.paid !== null);
  const sum = (ps: MoneyPerson[]) => ps.reduce((s, p) => s + (p.amount_cents ?? 0), 0);
  const open = owing.filter((p) => p.paid === false);
  return html`<section class="pizza-card">
    <p class="pizza-section">${c.t("money.owes")}</p>
    <p class="pizza-card__title">${c.t("money.to_collect", { amount: euro(c, sum(open)) })}</p>
    <p class="pizza-muted">
      ${c.t("money.owe_line", { n: owing.length, amount: euro(c, sum(owing)), k: owing.length - open.length })}
    </p>
    <p class="pizza-cols"><span>${c.t("money.paid")}</span></p>
    <ul class="pizza-people">
      ${owing.map(
        (p) =>
          html`<li class="pizza-person">
            <span class="pizza-person__text"
              ><span class="pizza-person__name">${p.name ?? "—"}</span
              ><span class="pizza-person__what"
                >${c.t("money.owes_you", { amount: euro(c, p.amount_cents ?? 0) })}</span
              ></span
            >${paidTick(c, o, p, "money")}
          </li>`,
      )}
    </ul>
    <p class="pizza-muted">${c.t("money.memo")}</p>
  </section>`;
}

export function moneyPageView(c: PageCtx, o: OrderView, m: MoneyView, s: MoneyPageOpts): Html {
  return html`${flash(s.error)} ${header(c, o, m, s.me)}
  ${m.total_cents === null ? addReceipt(c, o, m, s.reader) : confirmed(c, o, m)}
  ${unpriced(c, o, m)}
  ${m.total_cents === null ? "" : html`${split(c, o, m)} ${people(c, m, s.me)}`}
  ${whoIsPaid(c, o, m, s.directly)} ${payWith(c, o, m, s.me)} ${owes(c, o, m)}`;
}
