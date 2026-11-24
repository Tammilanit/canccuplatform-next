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
  cents === null
    ? ""
    : `${Math.floor(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

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
      ${formKey()} ${amountField("total", s.total, c.t("pad.title"), true)}
      <p class="pizza-muted pizza-centered">${c.t("pad.paid_to", { pizzeria: o.pizzeria.name })}</p>
      <div class="pizza-pad__keys" hidden>
        ${keys.map(
          (k) =>
            html`<button
              type="button"
              class="pizza-pad__key"
              data-pad-key="${k}"
              ${k === "back" ? html`aria-label="${c.t("pad.delete")}"` : ""}
            >
              ${k === "back" ? "⌫" : k}
            </button>`,
        )}
      </div>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t("pad.save")}
      </button>
      ${
        s.reader
          ? ""
          : html`<a class="pizza-center" href="${base(o)}/money/scan"
              >${c.t("money.photo_only")}</a
            >`
      }
      <p class="pizza-muted pizza-centered">${c.t("pad.even_note")}</p>
    </form>`;
}

const PHOTO_TYPES = "image/jpeg,image/png,image/webp";

/**
 * Mockup 18 A and B: the notice before the photo is sent, then the photo. A phone gets the camera
 * (its field opens the phone's own camera) and a saved photo as the second way; a PC, where nobody
 * photographs a receipt with the screen, gets one file picker that also takes a dropped file
 * (H2). Both are drawn and money.css shows one by the input the device has, not by its width: a
 * touch laptop with a mouse is a PC. Neither field is required, as only one is filled: the form
 * sends whichever photo it has.
 */
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
      <div class="pizza-only-touch pizza-form">
        <label class="pizza-camera">
          <span class="pizza-camera__frame" aria-hidden="true"></span>
          <span class="pizza-camera__text">${c.t("scan.take")}</span>
          <input
            class="pizza-camera__input"
            type="file"
            name="photo"
            accept="${PHOTO_TYPES}"
            capture="environment"
            data-auto-send
        /></label>
        <label class="pizza-saved"
          >${c.t("scan.saved")}<input
            class="pizza-camera__input"
            type="file"
            name="photo"
            accept="${PHOTO_TYPES}"
            data-auto-send
        /></label>
      </div>
      <label class="pizza-only-pointer pizza-drop">
        <span class="pizza-drop__title">${c.t("scan.attach")}</span>
        <span class="pizza-muted">${c.t("scan.drop")}</span>
        <input class="pizza-drop__input" type="file" name="photo" accept="${PHOTO_TYPES}" />
      </label>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t(s.reader ? "scan.read" : "scan.keep")}
      </button>
      <a class="pizza-center" href="${base(o)}/money">${c.t("scan.cancel")}</a>
    </form>`;
}

const photoUrl = (id: string) => `/api/pizza/receipts/${encodeURIComponent(id)}/photo`;

/**
 * Mockup 18 C, laid out for its task (H3): the photo beside the lines read from it (sticky on a
 * desktop, a tap opens it whole on a phone); what needs a look first, each pizza with no line next
 * to the receipt line that matched no pizza; then the lines with their prices, the extras and the
 * total; and the sum check with Retake and Confirm in one footer that stays in view. Confirm sends
 * the total and every price in one write.
 */
export function checkView(
  c: PageCtx,
  o: OrderView,
  receiptId: string,
  r: ReceiptMatch,
  error?: string,
): Html {
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
  const problem = (p: ReceiptMatch["pizzas"][number]) => p.differs || p.line === null;
  const pizzaRow = (p: ReceiptMatch["pizzas"][number]) =>
    html`<li class="pizza-person${problem(p) ? " pizza-person--warn" : ""}">
      <span class="pizza-person__text"
        ><span class="pizza-person__name">${p.label}</span
        ><span class="pizza-person__what">${why(p)}</span></span
      >
      ${amountField(`price_${p.item_id}`, p.suggested_cents ?? p.price_cents, p.label)}
    </li>`;
  const toCheck = r.pizzas.filter(problem);
  const unmatched = r.unmatched_lines.map((i) => r.lines[i]?.text ?? "");
  const first =
    toCheck.length + unmatched.length === 0
      ? ""
      : html`<h2 class="pizza-section">${c.t("check.first")}</h2>
          <ul class="pizza-people pizza-list">
            ${toCheck.map(pizzaRow)}
            ${unmatched.map(
              (text) =>
                html`<li class="pizza-person pizza-person--warn">
                  <span class="pizza-person__text"
                    ><span class="pizza-person__name">${text}</span
                    ><span class="pizza-person__what">${c.t("check.no_pizza")}</span></span
                  >
                </li>`,
            )}
          </ul>`;
  const rest = r.pizzas.filter((p) => !problem(p));
  return html`${flash(error)}
    <form method="post" action="${base(o)}/money/check" class="pizza-form pizza-check">
      ${formKey()}<input type="hidden" name="receipt_id" value="${receiptId}" />
      <div class="pizza-pair pizza-pair--lead">
        <aside class="pizza-pair__aside pizza-check__photo">
          <a
            href="${photoUrl(receiptId)}"
            target="_blank"
            rel="noopener"
            data-viewer="${c.t("money.close_photo")}"
            ><img src="${photoUrl(receiptId)}" alt="${c.t("check.photo")}"
          /></a>
          <span class="pizza-muted">${c.t("check.zoom")}</span>
        </aside>
        <div class="pizza-pair__main pizza-check__lines">
          ${first}
          ${
            rest.length === 0
              ? ""
              : html`<h2 class="pizza-section">${c.t("check.each")}</h2>
                  <ul class="pizza-people pizza-list">
                    ${rest.map(pizzaRow)}
                  </ul>`
          }
          ${
            extras.length === 0
              ? ""
              : html`<h2 class="pizza-section">${c.t("check.extras")}</h2>
                  <ul class="pizza-people pizza-list">
                    ${extras.map(
                      (l) =>
                        html`<li class="pizza-person">
                          <span class="pizza-person__text"
                            ><span class="pizza-person__name">${l.name}</span></span
                          ><span class="pizza-amount canccu-num">${euro(c, l.amount_cents)}</span>
                        </li>`,
                    )}
                  </ul>`
          }
          <label class="pizza-person pizza-check__total"
            ><span class="pizza-person__text"
              ><span class="pizza-person__name">${c.t("check.total")}</span></span
            >${amountField("total", r.total_cents, c.t("check.total"))}</label
          >
        </div>
      </div>
      <div class="pizza-checkbar">
        <p class="${r.adds_up ? "pizza-ok" : "pizza-warn"}">
          ${
            r.adds_up
              ? c.t("check.adds_up", { amount: euro(c, r.total_cents ?? 0) })
              : c.t("check.off_by", { sum: euro(c, sum), total: euro(c, r.total_cents ?? 0) })
          }
        </p>
        <a class="canccu-button canccu-button--secondary" href="${base(o)}/money/scan"
          >${c.t("check.retake")}</a
        >
        <button class="canccu-button canccu-button--primary" type="submit">
          ${c.t("check.confirm")}
        </button>
      </div>
    </form>`;
}
