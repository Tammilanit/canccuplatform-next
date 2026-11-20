/** The hand-out (mockup 09 without money, the money issue's), cancelling, and an order that is over. */
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { base, flash, peopleOf, post, time } from "./order-view.js";
import type { OrderView } from "./order-view.js";

/** Mockup 09 B: the hand-out, "Everyone got theirs" with its undo, single ticks and the nudge. */
export function handOutView(c: PageCtx, o: OrderView, me: string, error?: string): Html {
  const people = peopleOf(o, me);
  const got = people.filter((p) => p.got).length;
  const waiting = people.length - got;
  const done = o.state === "done";
  return html`${flash(error)}
    <section class="pizza-card pizza-card--here">
      <p class="pizza-card__title">
        ${c.t("hand.here", { time: time(c, o.arrived_at), pickup: o.pickup ?? "—" })}
      </p>
      <p class="pizza-card__meta">${c.t("hand.told")}</p>
    </section>
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
    <p class="pizza-progress-label">${c.t("hand.collected", { got, all: people.length })}</p>
    <progress class="pizza-progress" max="${Math.max(people.length, 1)}" value="${got}"></progress>
    <p class="pizza-cols"><span>${c.t("hand.got_it")}</span></p>
    <ul class="pizza-people">
      ${people.map(
        (p) =>
          html`<li class="pizza-person">
            <span class="pizza-person__text"
              ><span class="pizza-person__name"
                >${p.you ? c.t("hand.you", { name: p.name }) : p.name}</span
              ><span class="pizza-person__what">${p.labels.join(" · ")}</span></span
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
