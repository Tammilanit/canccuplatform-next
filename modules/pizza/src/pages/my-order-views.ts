/**
 * My order (mockups 02 C, 05, 06 B and 16): the order's steps in plain words as they happen, your
 * pizzas (editable until close, then whom to ask), where to collect it and "I've got mine" (U9);
 * and the edge states: cancelled (why, never blaming), nobody holds it, closed while you chose.
 */
import { attrs, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { PREFIX } from "./kit.js";
import { flash, post, time } from "./order-view.js";
import type { OrderView } from "./order-view.js";
import { orderHref, orderName, wayIn } from "./food-views.js";
import type { FoodCtx } from "./food-views.js";
import type { MessageKey } from "./messages.js";
import { euro } from "./money-format.js";

const holderName = (c: FoodCtx, o: OrderView) => o.holder?.name ?? c.t("food.the_holder");

/** Where the order stands, in one sentence for its header (mockup 05's top line). */
function status(c: FoodCtx, o: OrderView): string {
  switch (o.state) {
    case "open":
      return c.t("mine.open_closes", { time: time(c, o.closes_at) });
    case "closed":
      return c.t("mine.calling", { name: holderName(c, o), time: time(c, o.closed_at) });
    case "placed":
      return c.t("mine.called_at", { time: time(c, o.placed_at) });
    case "arrived":
      return c.t("mine.here_title");
    case "done":
      return c.t("state.done");
    case "cancelled":
      return c.t("state.cancelled");
  }
}

/**
 * The four steps people say (L4) as a timeline: done ones with their times, the current one lit,
 * later ones dimmed. Nothing in it is ticked, so nothing looks like a box to tick (A5–A7).
 */
function steps(c: FoodCtx, o: OrderView): Html {
  const reached = { open: 1, closed: 2, placed: 3, arrived: 5, done: 5, cancelled: 0 }[o.state];
  const onTheWay = o.state === "placed" && o.estimate_at !== null ? 4 : reached;
  const collect =
    o.pickup !== null
      ? c.t("mine.collect_at", { pickup: o.pickup })
      : c.t("mine.collect_from", { name: holderName(c, o) });
  const rows: [string, string][] = [
    [
      c.t("state.open"),
      o.state === "open"
        ? c.t("mine.closes", { time: time(c, o.closes_at) })
        : `${time(c, o.opened_at)}–${time(c, o.closed_at ?? o.placed_at)}`,
    ],
    [
      c.t("state.closed"),
      o.state === "closed"
        ? c.t("mine.since", { time: time(c, o.closed_at) })
        : time(c, o.closed_at),
    ],
    [c.t("mine.called_in"), time(c, o.placed_at)],
    [
      c.t("state.placed"),
      o.estimate_at === null ? "" : c.t("mine.estimate", { time: time(c, o.estimate_at) }),
    ],
    [
      c.t("mine.here"),
      o.state === "open" || o.state === "closed"
        ? ""
        : o.arrived_at === null
          ? collect
          : `${time(c, o.arrived_at)} · ${collect}`,
    ],
  ];
  // Once it is here, the last step is where things stand: it is lit, not done.
  const now = Math.max(reached, onTheWay);
  return html`<ol class="pizza-timeline">
    ${rows.map(([title, hint], i) => {
      const n = i + 1;
      const state = n < now ? "done" : n === now ? "now" : "later";
      return html`<li${attrs({ class: `pizza-timeline__step pizza-timeline__step--${state}`, "aria-current": state === "now" ? "step" : undefined })}>
        <span class="pizza-timeline__title">${title}</span>
        ${hint === "" ? "" : html`<span class="pizza-timeline__hint">${hint}</span>`}
      </li>`;
    })}
  </ol>`;
}

function myPizzas(c: FoodCtx, o: OrderView): Slot {
  const mine = o.mine ?? [];
  if (mine.length === 0) return "";
  const editable = o.state === "open";
  return html`<h2 class="pizza-section">${c.t("mine.your_pizzas")}</h2>
    <ul class="pizza-list">
      ${mine.map((p) => {
        const extra = [p.note, p.comment].filter((x): x is string => x !== null).join(" · ");
        return html`<li>
          <span class="pizza-line__text"
            ><span class="pizza-line__label">${p.label}</span>
            ${extra === "" ? "" : html`<span class="pizza-line__note">${extra}</span>`}</span
          >
          ${
            editable
              ? html`<a
                    class="canccu-button canccu-button--ghost canccu-button--sm"
                    href="${orderHref(o)}/add?edit=${p.id}"
                    >${c.t("mine.edit")}</a
                  >${post(
                    `${PREFIX}items/${p.id}/delete`,
                    c.t("mine.remove"),
                    "canccu-button--ghost canccu-button--sm",
                    html`<input type="hidden" name="order_id" value="${o.id}" />`,
                  )}`
              : ""
          }
        </li>`;
      })}
    </ul>
    ${
      o.state === "closed"
        ? html`<p class="pizza-muted">${c.t("mine.locked", { name: holderName(c, o) })}</p>`
        : ""
    }`;
}

/**
 * The page's hero: where the order stands in one line. Once it is here, that line is "Pizza is
 * here", where to collect it and "I've got mine" (U9), the one thing the page is then for.
 */
function hero(c: FoodCtx, o: OrderView): Html {
  const held =
    o.holder === undefined
      ? ""
      : html`<p class="pizza-meta">
          ${o.holder === null ? c.t("hold.nobody") : c.t("food.held_by", { name: o.holder.name ?? "—" })}
        </p>`;
  const note = o.note ? html`<p class="pizza-muted">${o.note}</p>` : "";
  if (o.state !== "arrived" && o.state !== "done")
    return html`<section class="pizza-hero">
      <p class="pizza-hero__kicker">${orderName(c, o)}</p>
      <p class="pizza-hero__title">${status(c, o)}</p>
      ${held}${note}
    </section>`;
  const mine = o.mine ?? [];
  const got = mine.length > 0 && mine.every((p) => p.handed_out);
  return html`<section class="pizza-hero pizza-hero--here">
    <p class="pizza-hero__kicker">
      ${c.t("mine.arrived", { seq: o.seq, time: time(c, o.arrived_at) })}
    </p>
    <p class="pizza-hero__title">${c.t("mine.here_title")}</p>
    ${o.pickup === null ? "" : html`<p class="pizza-hero__big">${c.t("mine.collect_at", { pickup: o.pickup })}</p>`}
    ${held}
    ${
      mine.length === 0
        ? ""
        : got
          ? html`<p class="pizza-badge pizza-badge--ok">${c.t("mine.got")}</p>`
          : o.state === "arrived"
            ? html`${post(`${orderHref(o)}/got-mine`, c.t("mine.got_mine"), "canccu-button--primary pizza-wide")}
                <p class="pizza-muted">${c.t("mine.got_mine_hint")}</p>`
            : ""
    }
  </section>`;
}

/** Mockup 16: who cancelled and why, never the holder's name when the crew did it. */
function cancelledCard(c: FoodCtx, o: OrderView): Html {
  return html`<section class="pizza-block">
    <p class="pizza-title">${c.t("mine.cancelled", { seq: o.seq })}</p>
    ${o.cancel_reason ? html`<p>“${o.cancel_reason}”</p>` : ""}
    ${(o.mine?.length ?? 0) > 0 ? html`<p class="pizza-muted">${c.t("mine.not_ordered")}</p>` : ""}
    <a class="canccu-button canccu-button--secondary pizza-wide" href="${PREFIX}"
      >${c.t("mine.see_open")}</a
    >
  </section>`;
}

/** Mockup 16: released (by the holder, the crew or the timer); anyone in the event may take it. */
function nobodyCard(c: FoodCtx, o: OrderView): Html {
  return html`<section class="pizza-block">
    <p class="pizza-title">${c.t("mine.nobody", { seq: o.seq })}</p>
    <p class="pizza-muted">${c.t("mine.nobody_text")}</p>
    ${
      c.member
        ? post(
            `${orderHref(o)}/step/claim`,
            c.t("hold.take_over"),
            "canccu-button--primary pizza-wide",
          )
        : ""
    }
  </section>`;
}

/** A value with its Copy button (static/pizza.js); without a script the text is selectable. */
const copyable = (c: FoodCtx, label: string, value: string) =>
  html`<li class="pizza-copyable">
    <span>${label}</span
    ><button
      type="button"
      class="canccu-button canccu-button--secondary canccu-button--sm"
      data-copy="${value}"
      hidden
    >
      ${c.t("mine.copy")}
    </button>
  </li>`;

/**
 * The person's own amount once the order has one, and whom they pay (U12 A, M1): the organiser
 * after the event, or the payer, with the payer's "Pay me with" details. No money moves here.
 */
function myMoney(c: FoodCtx, o: OrderView): Slot {
  const amount = o.my_amount_cents;
  if (amount === null || amount === undefined) return "";
  const sum = euro(c, amount);
  const p = o.pay_to;
  const payer = o.settle_to === "payer" && p !== null && p !== undefined && o.my_paid !== null;
  // The amount shows once (A6): on its own, or in the sentence that says whom to pay.
  return html`<section class="pizza-block pizza-share">
    <h2 class="pizza-section">${c.t("mine.share")}</h2>
    ${
      !payer
        ? html`<p class="pizza-hero__big canccu-num">${sum}</p>
            ${o.my_amount_estimated === true ? html`<p class="pizza-muted">${c.t("mine.share_estimated")}</p>` : ""}
            ${o.settle_to === "payer" ? "" : html`<p>${c.t("mine.pay_organiser")}</p>`}`
        : html`<p class="pizza-hero__big">
              ${c.t("mine.pay_to", { name: p.name ?? "—", amount: sum })}
            </p>
            ${o.my_amount_estimated === true ? html`<p class="pizza-muted">${c.t("mine.share_estimated")}</p>` : ""}
            ${
              p.mobilepay === null && p.iban === null
                ? ""
                : html`<ul class="pizza-list">
                    ${p.mobilepay === null ? "" : copyable(c, c.t("money.mobilepay", { number: p.mobilepay }), p.mobilepay)}
                    ${p.iban === null ? "" : copyable(c, c.t("money.bank", { iban: p.iban }), p.iban)}
                  </ul>`
            }
            <p class="pizza-muted">${c.t("mine.no_app_money", { name: p.name ?? "—" })}</p>
            ${
              o.my_paid === true
                ? html`<p class="pizza-badge pizza-badge--ok">
                    ${c.t("mine.marked", { name: p.name ?? "—" })}
                  </p>`
                : ""
            }`
    }
  </section>`;
}

/** The holder's next step on their order (D19): a form for a step taken here, else its page. */
export function nextStep(
  o: OrderView,
): { label: MessageKey; href: string; method: "get" | "post" } | null {
  const hold = `${PREFIX}hold/${o.id}`;
  switch (o.state) {
    case "open":
      return { label: "mine.step_close", href: `${hold}/step/close`, method: "post" };
    case "closed":
      return { label: "mine.step_call", href: `${hold}/call`, method: "get" };
    case "placed":
      return (o.total_cents ?? null) === null
        ? { label: "mine.step_receipt", href: `${hold}/money`, method: "get" }
        : { label: "mine.step_here", href: `${hold}/here`, method: "get" };
    case "arrived":
      return { label: "mine.step_hand_out", href: `${hold}/hand-out`, method: "get" };
    default:
      return null;
  }
}

/** Whenever you hold the order, not only right after opening it (#789 item 13). */
function holderCard(c: FoodCtx, o: OrderView): Slot {
  const next = o.you_hold === true ? nextStep(o) : null;
  if (next === null) return "";
  const label = c.t(next.label);
  return html`<section class="pizza-block pizza-holder-card">
    <p class="pizza-title">${c.t("mine.you_hold")}</p>
    <div class="pizza-row">
      ${
        next.method === "post"
          ? post(next.href, label, "canccu-button--primary")
          : html`<a class="canccu-button canccu-button--primary" href="${next.href}">${label}</a>`
      }
      <a class="canccu-button canccu-button--secondary" href="${PREFIX}hold/${o.id}"
        >${c.t("mine.holder_view")}</a
      >
    </div>
  </section>`;
}

export function myOrderView(
  c: FoodCtx,
  o: OrderView,
  q: { added?: boolean; opened?: boolean; error?: string },
): Html {
  const header = hero(c, o);
  if (o.state === "cancelled")
    return html`${flash(q.error)}${header}${cancelledCard(c, o)}${wayIn(c, orderHref(o))}`;
  const opened =
    q.opened === true && o.you_hold === true
      ? notice({
          kind: "ok",
          title: c.t("mine.opened", { seq: o.seq }),
          text: c.t("mine.opened_text"),
          // The holder card below carries the holder's view and next step.
          actions: html`<a class="canccu-button canccu-button--primary" href="${orderHref(o)}/add"
            >${c.t("mine.add_own")}</a
          >`,
        })
      : "";
  const added =
    q.added === true
      ? notice({
          kind: "ok",
          title: c.t("mine.added", { seq: o.seq }),
          text: c.t("mine.added_text"),
        })
      : "";
  const add =
    o.state === "open" && c.member
      ? html`<a class="canccu-button canccu-button--primary pizza-wide" href="${orderHref(o)}/add"
          >${c.t((o.mine?.length ?? 0) === 0 ? "mine.add" : "mine.add_another")}</a
        >`
      : "";
  const nobody = (o.state === "open" || o.state === "closed") && o.holder === null;
  // Two columns on a desktop, as the timeline is read with the order: what is yours, then where
  // it stands. On a phone the timeline follows your pizzas and share.
  return html`${flash(q.error)}${opened}${added}
    <div class="pizza-pair">
      <div class="pizza-pair__main">
        ${header} ${holderCard(c, o)} ${nobody ? nobodyCard(c, o) : ""} ${myPizzas(c, o)}
        ${myMoney(c, o)} ${add}
      </div>
      <aside class="pizza-pair__aside">
        ${o.state === "done" ? "" : html`<h2 class="pizza-section">${c.t("mine.next")}</h2>`}
        ${steps(c, o)} ${wayIn(c, orderHref(o))}
      </aside>
    </div>`;
}

/** Mockup 16: the order closed while you chose (E3); the API names the orders still open. */
export function closedWhileView(
  c: FoodCtx,
  o: OrderView,
  others: { id: string; seq: number; pizzeria: { name: string } }[],
): Html {
  return html`<section class="pizza-block">
      <p class="pizza-title">
        ${c.t("mine.closed_while", { seq: o.seq, time: time(c, o.closed_at ?? o.placed_at) })}
      </p>
      <p>${c.t("mine.not_added")}</p>
    </section>
    ${others.map(
      (x) =>
        html`<a class="pizza-card pizza-card--link" href="${orderHref(x)}/add">
          <span class="pizza-title">${orderName(c, x)}</span>
          <span class="pizza-meta">${c.t("mine.add_there")}</span>
        </a>`,
    )}
    <a class="canccu-button canccu-button--secondary pizza-wide" href="${PREFIX}"
      >${c.t("mine.see_open")}</a
    >`;
}
