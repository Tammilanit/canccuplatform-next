/**
 * The attendee's Food page and starting an order (mockups 03, 06 and 16): the open orders first,
 * each with your stake; today's earlier ones below so "did ours arrive?" has an answer; one clear
 * action when nothing is open; and the guest, not-a-member and ordering-off states, none of them
 * a dead end.
 */
import { emptyState, html, notice } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { Translate } from "./messages.js";
import { PREFIX, SIGN_IN, formKey } from "./kit.js";
import { stateLabel } from "./crew-views.js";
import { counts, flash, post, time } from "./order-view.js";
import type { OrderView } from "./order-view.js";

/** What an attendee page knows of its viewer: a guest has no session and is no member. */
export interface FoodCtx {
  t: Translate;
  lang: string;
  zone: string;
  tenant: string;
  signedIn: boolean;
  member: boolean;
  /** May start an order now: a member, ordering on, and `pizza.order.open` when `open_by` is crew. */
  mayStart: boolean;
}

export const orderHref = (o: { id: string }) => `${PREFIX}orders/${o.id}`;
export const isOpen = (o: OrderView) => o.state === "open" && !o.stale;

/** "Order 2 · Demo Pizzeria". */
export const orderName = (c: FoodCtx, o: { seq: number; pizzeria: { name: string } }) =>
  c.t("order.title", { seq: o.seq, pizzeria: o.pizzeria.name });

/** Where an order stands, in a few words for its card. */
function standing(c: FoodCtx, o: OrderView): string {
  switch (o.state) {
    case "open":
      return c.t("food.closes", { time: time(c, o.closes_at) });
    case "closed":
      return c.t("food.closed_at", { time: time(c, o.closed_at) });
    case "placed":
      return o.estimate_at === null
        ? c.t("food.called_at", { time: time(c, o.placed_at) })
        : c.t("food.about", { time: time(c, o.estimate_at) });
    case "arrived":
      return c.t("food.arrived_at", { time: time(c, o.arrived_at) });
    case "done":
      return c.t("food.done_at", { time: time(c, o.done_at ?? o.arrived_at) });
    case "cancelled":
      return c.t("food.cancelled_at", { time: time(c, o.cancelled_at) });
  }
}

function orderCard(c: FoodCtx, o: OrderView): Html {
  const stake = o.mine?.length ?? 0;
  const holder =
    o.holder === undefined
      ? ""
      : o.holder === null
        ? c.t("hold.nobody")
        : c.t("food.held_by", { name: o.holder.name ?? "—" });
  return html`<a class="pizza-card pizza-card--link" href="${orderHref(o)}">
    <span class="pizza-row">
      <span class="pizza-title">${orderName(c, o)}</span>${stateLabel(c, o)}
    </span>
    <span class="pizza-meta">${standing(c, o)} · ${counts(c, o)}</span>
    ${holder === "" ? "" : html`<span class="pizza-meta">${holder}</span>`}
    ${
      stake === 0
        ? ""
        : html`<span class="pizza-badge pizza-badge--ok"
            >${c.t(stake === 1 ? "food.stake_one" : "food.stake", { n: stake })}</span
          >`
    }
  </a>`;
}

/** The way in for someone who cannot order yet: sign in, or join the event. */
export function wayIn(c: FoodCtx, back: string): Slot {
  if (!c.signedIn)
    return html`<section class="pizza-block pizza-wayin">
      <p class="pizza-title">${c.t("food.guest_title")}</p>
      <p class="pizza-muted">${c.t("food.guest_text")}</p>
      <a
        class="canccu-button canccu-button--primary pizza-wide"
        href="${SIGN_IN}?next=${encodeURIComponent(back)}"
        >${c.t("food.sign_in")}</a
      >
    </section>`;
  if (!c.member)
    return html`<section class="pizza-block pizza-wayin">
      <p class="pizza-title">${c.t("food.join_title")}</p>
      <p class="pizza-muted">${c.t("food.join_text")}</p>
      <a class="canccu-button canccu-button--primary pizza-wide" href="/notify/join"
        >${c.t("food.join")}</a
      >
    </section>`;
  return "";
}

/** Mockup 16: an order open from an earlier day blocks nothing, but should not stay (E10). */
function staleNotice(c: FoodCtx, o: OrderView): Html {
  return notice({
    kind: "warn",
    title: c.t("food.stale", { seq: o.seq, day: o.day }),
    text: c.t("food.stale_text"),
    ...(c.member
      ? {
          actions: post(
            `${orderHref(o)}/step/cancel`,
            c.t("food.stale_cancel"),
            "canccu-button--secondary",
          ),
        }
      : {}),
  });
}

/** An earlier order of the day: one line of a plain list, as it is only looked up. */
function earlierRow(c: FoodCtx, o: OrderView): Html {
  return html`<li>
    <a class="pizza-list__link" href="${orderHref(o)}"
      ><span class="pizza-list__text"
        ><span class="pizza-title">${orderName(c, o)}</span
        ><span class="pizza-meta">${standing(c, o)} · ${counts(c, o)}</span></span
      >${stateLabel(c, o)}</a
    >
  </li>`;
}

/** Mockup 03: the Food page. `orders` is null where a guest may not read them (info-page mode). */
export function foodView(
  c: FoodCtx,
  orders: OrderView[] | null,
  o: { ordering: boolean; note: string; error?: string },
): Html {
  const start = c.mayStart
    ? (label: string, primary: boolean, wide = true) =>
        html`<a
          class="canccu-button ${primary ? "canccu-button--primary" : "canccu-button--secondary"}${wide ? " pizza-wide" : ""}"
          href="${PREFIX}start"
          >${label}</a
        >`
    : () => "";
  const closed =
    c.member && !o.ordering
      ? notice({ kind: "warn", title: c.t("food.ordering_off"), text: o.note || undefined })
      : "";
  if (orders === null) return html`${flash(o.error)}${closed}${wayIn(c, PREFIX)}`;
  const open = orders.filter(isOpen);
  const stale = orders.filter((x) => x.stale);
  const earlier = orders.filter((x) => !isOpen(x) && !x.stale).sort((a, b) => b.seq - a.seq);
  // The open orders are what people browse and join: cards in the shared grid, the way to start
  // another beside their heading, so the page reads as one task at any width (A2).
  const openPart =
    open.length > 0
      ? html`<div class="pizza-heading">
            <h2 class="pizza-section">${c.t("food.open_orders")}</h2>
            ${start(c.t("food.start_another"), false, false)}
          </div>
          <ul class="canccu-grid pizza-orders">
            ${open.map((x) => html`<li>${orderCard(c, x)}</li>`)}
          </ul>`
      : c.member && o.ordering
        ? emptyState({
            icon: "food",
            title: c.t("food.none_open"),
            text: c.t(c.mayStart ? "food.none_open_text" : "food.none_open_wait"),
            action: start(c.t("food.start"), true),
          })
        : html`<p class="pizza-muted">${c.t("food.none_open")}</p>`;
  return html`${flash(o.error)}${closed}${stale.map((x) => staleNotice(c, x))} ${openPart}
  ${
    earlier.length === 0
      ? ""
      : html`<h2 class="pizza-section">${c.t("food.earlier")}</h2>
          <ul class="pizza-list">
            ${earlier.map((x) => earlierRow(c, x))}
          </ul>`
  }
  ${wayIn(c, PREFIX)}`;
}

export interface PizzeriaChoice {
  id: string;
  name: string;
  service: "delivery" | "takeaway";
}

/** Mockup 06: a pizzeria, a close time, a note to everyone. One open order per pizzeria (D1). */
export function startView(
  c: FoodCtx,
  pizzerias: PizzeriaChoice[],
  open: OrderView[],
  times: string[],
  error?: string,
): Html {
  const openAt = new Map(open.map((o) => [o.pizzeria.id, o]));
  let first = true;
  const choices = pizzerias.map((p) => {
    const has = openAt.get(p.id);
    if (has !== undefined)
      return html`<div class="pizza-block">
        <span class="pizza-title">${p.name}</span>
        <a href="${orderHref(has)}/add">${c.t("start.join_instead", { seq: has.seq })}</a>
      </div>`;
    const checked = first;
    first = false;
    return html`<label class="pizza-choice">
      <input type="radio" name="pizzeria_id" value="${p.id}" ${checked ? "checked" : ""} required />
      <span class="pizza-choice__stack"
        ><span class="pizza-title">${p.name}</span>
        <span class="pizza-choice__hint"
          >${c.t(p.service === "takeaway" ? "start.takeaway" : "start.delivery")}</span
        ></span
      >
    </label>`;
  });
  return html`${flash(error)}
    <form method="post" action="${PREFIX}start" class="pizza-form">
      ${formKey()}
      <fieldset class="pizza-fieldset">
        <legend>${c.t("start.pizzeria")}</legend>
        <div class="pizza-choices pizza-choices--stack">${choices}</div>
      </fieldset>
      <fieldset class="pizza-fieldset">
        <legend>${c.t("start.closes")}</legend>
        <div class="pizza-choices">
          ${times.map(
            (t, i) =>
              html`<label class="pizza-choice"
                ><input type="radio" name="closes" value="${t}" ${i === 0 ? "checked" : ""} /><span
                  >${t}</span
                ></label
              >`,
          )}
          <label class="pizza-choice"
            ><input type="radio" name="closes" value="other" /><span
              >${c.t("start.other_time")}</span
            ></label
          >
        </div>
        <label class="canccu-field"
          ><span class="canccu-field__label">${c.t("start.other_field")}</span>
          <input class="canccu-input" type="time" name="closes_other"
        /></label>
        <p class="pizza-muted">${c.t("start.closes_hint")}</p>
      </fieldset>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("start.note")}</span>
        <input class="canccu-input" name="note" maxlength="200" />
      </label>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t("start.open")}
      </button>
    </form>`;
}
