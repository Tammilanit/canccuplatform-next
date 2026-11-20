/** The hand-out (mockup 09, with each person's amount and Paid), cancelling, and an order that is over. */
import { html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { euro } from "./money-format.js";
import type { MoneyPerson, MoneyView } from "./money-format.js";
import { paidTick } from "./money-views.js";
import { base, flash, peopleOf, post, time } from "./order-view.js";
import type { OrderView } from "./order-view.js";

/** Mockup 09 C: the order's money once everyone got theirs. */
function moneyAfter(c: PageCtx, o: OrderView, m: MoneyView, me: string): Slot {
  if (m.total_cents === null) return "";
  const amount = euro(c, m.total_cents);
  const paid = m.people.filter((p) => p.paid === true).map((p) => p.name ?? "—");
  const open = m.people.filter((p) => p.paid === false);
  return html`<section class="pizza-card">
    <p class="pizza-section">${c.t("hand.money")}</p>
    <p class="pizza-card__title">
      ${m.payer?.user_id === me
        ? c.t("hand.you_paid_total", { pizzeria: o.pizzeria.name, amount })
        : c.t("money.paid_by", { amount, name: m.payer?.name ?? "—" })}
    </p>
    ${paid.length === 0 ? "" : html`<p>${c.t("hand.paid_you_names", { names: paid.join(", ") })}</p>`}
    ${open.length === 0
      ? ""
      : html`<p class="pizza-section">${c.t("hand.still_owes")}</p>
          <ul class="pizza-people">
            ${open.map(
              (p) => html`<li class="pizza-person">
                <span class="pizza-person__text"><span class="pizza-person__name">${p.name ?? "—"}</span></span
                ><span class="pizza-amount canccu-num">${euro(c, p.amount_cents ?? 0)}</span>
              </li>`,
            )}
          </ul>`}
    <a class="canccu-button canccu-button--secondary pizza-wide" href="${base(o)}/money"
      >${c.t("hand.order_money")}</a
    >
  </section>`;
}

/**
 * Mockup 09 A and B: the hand-out, "Everyone got theirs" with its undo, single ticks and the nudge;
 * each person's amount once the order has one, and the Paid column when it settles to the payer.
 */
export function handOutView(
  c: PageCtx,
  o: OrderView,
  me: string,
  error?: string,
  m?: MoneyView,
): Html {
  const people = peopleOf(o, me);
  const got = people.filter((p) => p.got).length;
  const waiting = people.length - got;
  const done = o.state === "done";
  const money = new Map<string, MoneyPerson>((m?.people ?? []).map((p) => [p.user_id ?? "", p]));
  const toPayer = m?.settle_to === "payer";
  const paidCount = (m?.people ?? []).filter((p) => p.paid === true).length;
  const what = (p: (typeof people)[number]) => {
    const mp = money.get(p.user_id);
    const tail =
      m?.payer?.user_id === p.user_id
        ? c.t(p.user_id === me ? "hand.you_paid" : "record.paid_pizzeria")
        : mp?.amount_cents == null
          ? null
          : euro(c, mp.amount_cents);
    return [...p.labels, ...(tail === null ? [] : [tail])].join(" · ");
  };
  return html`${flash(error)}
    <section class="pizza-card pizza-card--here">
      <p class="pizza-card__title">
        ${c.t("hand.here", { time: time(c, o.arrived_at), pickup: o.pickup ?? "—" })}
      </p>
      <p class="pizza-card__meta">${c.t("hand.told")}</p>
    </section>
    ${m === undefined || toPayer
      ? ""
      : html`<section class="pizza-card">
          <p class="pizza-card__title">${c.t("hand.organiser")}</p>
          <p class="pizza-card__meta">${c.t("hand.organiser_text")}</p>
        </section>`}
    ${done && m !== undefined && toPayer ? moneyAfter(c, o, m, me) : ""}
    ${
      done
        ? html`<section class="pizza-card">
            <p class="pizza-card__title">${c.t("hand.done", { seq: o.seq })}</p>
            <p class="pizza-card__meta">
              ${c.t("hand.done_at", { got, all: people.length, time: time(c, o.done_at) })}
            </p>
          </section>`
        : html`<form
            method="post"
            action="${base(o)}/hand-out"
            data-everyone="${c.t("hand.everyone_done", { seq: o.seq })}"
            data-undo="${c.t("hand.undo")}"
          >
            ${formKey()}
            <button class="canccu-button pizza-go pizza-wide" type="submit">
              ✓ ${c.t("hand.everyone")}
            </button>
            <p class="pizza-muted pizza-centered">${c.t("hand.everyone_hint")}</p>
          </form>`
    }
    <p class="pizza-progress-label">
      ${toPayer
        ? c.t("hand.collected_paid", { got, all: people.length, paid: paidCount })
        : c.t("hand.collected", { got, all: people.length })}
    </p>
    <progress class="pizza-progress" max="${Math.max(people.length, 1)}" value="${got}"></progress>
    <p class="pizza-cols">
      <span>${c.t("hand.got_it")}</span>${toPayer ? html`<span>${c.t("hand.paid_you")}</span>` : ""}
    </p>
    <ul class="pizza-people">
      ${people.map(
        (p) =>
          html`<li class="pizza-person">
            <span class="pizza-person__text"
              ><span class="pizza-person__name"
                >${p.you ? c.t("hand.you", { name: p.name }) : p.name}</span
              ><span class="pizza-person__what">${what(p)}</span></span
            >
            ${
              done
                ? html`<span
                    class="pizza-tick ${p.got ? "pizza-tick--on" : ""}"
                    aria-label="${p.got ? c.t("hand.got_it") : c.t("hand.not_yet")}"
                  ></span>`
                : html`<form method="post" action="${base(o)}/tick" class="pizza-inline">
                    ${formKey()}<input type="hidden" name="user_id" value="${p.user_id}" /><input
                      type="hidden"
                      name="handed_out"
                      value="${p.got ? "no" : "yes"}"
                    />
                    <button
                      class="pizza-tick ${p.got ? "pizza-tick--on" : ""}"
                      type="submit"
                      aria-pressed="${p.got ? "true" : "false"}"
                      aria-label="${c.t("hand.tick", { name: p.name })}"
                    ></button>
                  </form>`
            }
            ${!toPayer
              ? ""
              : money.get(p.user_id)?.paid == null
                ? html`<span class="pizza-tick pizza-tick--none" aria-hidden="true">—</span>`
                : paidTick(c, o, money.get(p.user_id) as MoneyPerson, "hand-out")}
          </li>`,
      )}
    </ul>
    ${
      done
        ? ""
        : html`<div class="pizza-row">
            ${
              o.nudged_at !== null && o.nudged_at !== undefined
                ? html`<p class="pizza-muted">
                    ${c.t("hand.nudged", { time: time(c, o.nudged_at) })}
                  </p>`
                : waiting > 0
                  ? post(
                      `${base(o)}/nudge`,
                      c.t("hand.nudge", { n: waiting }),
                      "canccu-button--secondary",
                    )
                  : ""
            }
            ${post(`${base(o)}/step/done`, c.t("hand.done_button"), "canccu-button--primary")}
          </div>`
    }`;
}

/** Cancel, with the words the people in it are told. */
export function cancelView(c: PageCtx, o: OrderView, error?: string): Html {
  return html`${flash(error)}
    <form method="post" action="${base(o)}/step/cancel" class="pizza-form">
      ${formKey()}
      <p>${c.t("cancel.what", { n: o.people_count })}</p>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("cancel.reason")}</span
        ><input
          class="canccu-input"
          name="reason"
          maxlength="200"
          placeholder="${c.t("cancel.placeholder")}"
      /></label>
      <button class="canccu-button canccu-button--danger pizza-wide" type="submit">
        ${c.t("cancel.confirm")}
      </button>
      <a class="pizza-center" href="${base(o)}">${c.t("cancel.keep")}</a>
    </form>`;
}

/** An order that is over: done or cancelled. */
export function overView(c: PageCtx, o: OrderView): Html {
  return html`<section class="pizza-card">
    <p class="pizza-card__title">
      ${o.state === "done" ? c.t("hand.done", { seq: o.seq }) : c.t("over.cancelled", { seq: o.seq })}
    </p>
    <p class="pizza-card__meta">
      ${o.state === "done" ? c.t("over.done_at", { time: time(c, o.done_at) }) : (o.cancel_reason ?? "")}
    </p>
  </section>`;
}
