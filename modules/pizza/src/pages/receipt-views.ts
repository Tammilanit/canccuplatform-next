/**
 * The money step's own pages (mockup 18): the amount pad for the total, the photo of a receipt,
 * and the machine read to check. Euros are typed on the pad (or the phone's decimal keyboard),
 * never on − / + steppers. The read only suggests: the holder confirms or corrects every number,
 * and a difference from the menu, a line with no pizza and a pizza with no line are all shown.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { PROVIDER } from "../reader.js";
import type { ReceiptMatch } from "../receipt-match.js";
import { formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { euro } from "./money-format.js";
import { outsideNotice } from "./money-views.js";
import { base, flash } from "./order-view.js";
import type { OrderView } from "./order-view.js";

const plain = (cents: number | null) =>
  cents === null ? "" : `${Math.floor(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** An amount field the pad fills; the phone's decimal keyboard without a script. */
function amountField(name: string, value: number | null, label: string, big = false): Html {
  return html`<input${attrs({
    class: `canccu-input pizza-amount-input${big ? " pizza-amount-input--big" : ""}`,
    name,
    inputmode: "decimal",
    autocomplete: "off",
    required: true,
    placeholder: "0.00",
    value: plain(value),
    "aria-label": label,
    "data-pad-target": big ? "" : undefined,
  })} />`;
}

/** Mockup 18 D: the amount pad. */
export function padView(
  c: PageCtx,
  o: OrderView,
  s: { total: number | null; reader: boolean; error?: string },
): Html {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  return html`${flash(s.error)}
    <form method="post" action="${base(o)}/money/total" class="pizza-form pizza-pad" data-pad>
      ${formKey()}
      ${amountField("total", s.total, c.t("pad.title"), true)}
      <p class="pizza-muted pizza-centered">${c.t("pad.paid_to", { pizzeria: o.pizzeria.name })}</p>
      <div class="pizza-pad__keys" hidden>
        ${keys.map(
          (k) => html`<button
            type="button"
            class="pizza-pad__key"
            data-pad-key="${k}"
            ${k === "back" ? html`aria-label="${c.t("pad.delete")}"` : ""}
          >
            ${k === "back" ? "⌫" : k}
          </button>`,
        )}
      </div>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">${c.t("pad.save")}</button>
      ${s.reader
        ? ""
        : html`<a class="pizza-center" href="${base(o)}/money/scan">${c.t("money.photo_only")}</a>`}
      <p class="pizza-muted pizza-centered">${c.t("pad.even_note")}</p>
    </form>`;
}

/** Mockup 18 A and B: the notice before the photo is sent, then the photo. */
export function scanView(c: PageCtx, o: OrderView, s: { reader: boolean; error?: string }): Html {
  return html`${flash(s.error)}
    ${s.reader ? outsideNotice(c, c.t("money.outside_text", { provider: PROVIDER.name })) : ""}
    <form
      method="post"
      action="${base(o)}/money/scan"
      enctype="multipart/form-data"
      class="pizza-form"
      data-reading="${s.reader ? c.t("scan.reading") : ""}"
    >
      ${formKey()}
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("scan.photo")}</span
        ><input
          class="canccu-input"
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          required
      /></label>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t(s.reader ? "scan.read" : "scan.keep")}
      </button>
      <a class="pizza-center" href="${base(o)}/money">${c.t("scan.cancel")}</a>
    </form>`;
}

/** Mockup 18 C: the read to check; Confirm sends the total and every price in one write. */
export function checkView(c: PageCtx, o: OrderView, receiptId: string, r: ReceiptMatch): Html {
  const extras = r.lines.filter((l) => l.kind === "extra");
  const sum =
    r.pizzas.reduce((s, p) => s + (p.suggested_cents ?? p.price_cents ?? 0), 0) + r.extras_cents;
  const why = (p: ReceiptMatch["pizzas"][number]) => {
    if (p.line === null) return c.t("check.no_line");
    if (p.price_cents === null) return c.t("check.no_menu_price");
    return p.differs
      ? c.t("check.menu_said", { price: euro(c, p.price_cents) })
      : c.t("check.as_menu", { price: euro(c, p.price_cents) });
  };
  return html`<form method="post" action="${base(o)}/money/check" class="pizza-form">
    ${formKey()}<input type="hidden" name="receipt_id" value="${receiptId}" />
    <section class="pizza-card">
      <label class="canccu-field"
        ><span class="pizza-section">${c.t("check.total")}</span>
        <span class="pizza-card__title">${r.total_cents === null ? "—" : euro(c, r.total_cents)}</span>
        ${amountField("total", r.total_cents, c.t("check.total"))}</label
      >
    </section>
    <p class="pizza-section">${c.t("check.each")}</p>
    <ul class="pizza-people">
      ${r.pizzas.map(
        (p) => html`<li class="pizza-person${p.differs || p.line === null ? " pizza-person--warn" : ""}">
          <span class="pizza-person__text"
            ><span class="pizza-person__name">${p.label}</span
            ><span class="pizza-person__what">${why(p)}</span></span
          >
          ${amountField(`price_${p.item_id}`, p.suggested_cents ?? p.price_cents, p.label)}
        </li>`,
      )}
    </ul>
    ${extras.length === 0
      ? ""
      : html`<p class="pizza-section">${c.t("check.extras")}</p>
          <ul class="pizza-people">
            ${extras.map(
              (l) => html`<li class="pizza-person">
                <span class="pizza-person__text"><span class="pizza-person__name">${l.name}</span></span
                ><span class="pizza-amount canccu-num">${euro(c, l.amount_cents)}</span>
              </li>`,
            )}
          </ul>`}
    ${r.unmatched_lines.length === 0
      ? ""
      : html`<ul class="pizza-people">
          ${r.unmatched_lines.map(
            (i) => html`<li class="pizza-person pizza-person--warn">
              <span class="pizza-person__text"
                ><span class="pizza-person__name">${r.lines[i]?.text ?? ""}</span
                ><span class="pizza-person__what">${c.t("check.no_pizza")}</span></span
              >
            </li>`,
          )}
        </ul>`}
    <p class="pizza-centered ${r.adds_up ? "pizza-ok" : "pizza-warn"}">
      ${r.adds_up
        ? c.t("check.adds_up", { amount: euro(c, r.total_cents ?? 0) })
        : c.t("check.off_by", { sum: euro(c, sum), total: euro(c, r.total_cents ?? 0) })}
    </p>
    <div class="pizza-row">
      <a class="canccu-button canccu-button--secondary" href="${base(o)}/money/scan">${c.t("check.retake")}</a>
      <button class="canccu-button canccu-button--primary" type="submit">${c.t("check.confirm")}</button>
    </div>
  </form>`;
}
