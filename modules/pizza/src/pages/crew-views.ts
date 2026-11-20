/**
 * The crew's Food page (mockup 10, without its door helper: U5 B): the day's orders with what needs
 * the crew, one order's people and pizzas with their comments, its history, and stepping in with a
 * reason. The desk shows a table; a phone the same orders as cards, what needs the crew first.
 */
import { attrs, html, timeLabel } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { PizzaSettings } from "../settings.js";
import type { OrderView } from "./order-view.js";
import { counts, flash, peopleOf } from "./order-view.js";
import { PREFIX, formKey } from "./kit.js";
import { isKey } from "./messages.js";
import type { MessageKey } from "./messages.js";
import type { PageCtx } from "./kit.js";

const MIN = 60_000;
const time = (c: PageCtx, iso: string | null | undefined) =>
  iso === null || iso === undefined ? "" : timeLabel(iso, c.zone);
const since = (now: Date, iso: string | null) =>
  iso === null ? 0 : Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / MIN));

/** What the order needs from the crew now, in words, or null (the scheduler's own times). */
export function needs(c: PageCtx, o: OrderView, s: PizzaSettings, now: Date): string | null {
  if (o.stale) return c.t("needs.stale");
  if (o.state === "open" && !s.auto_close && now.getTime() > new Date(o.closes_at).getTime())
    return c.t("needs.open_late", { n: since(now, o.closes_at) });
  if (o.state === "open" || o.state === "closed") {
    if (o.holder === null || o.holder === undefined) return c.t("needs.nobody");
    const closed = since(now, o.closed_at);
    if (o.state === "closed" && closed >= s.remind_holder_minutes)
      return c.t("needs.not_called", { n: closed });
    return null;
  }
  if (o.state === "placed") {
    const waited =
      o.estimate_at === null
        ? since(now, o.placed_at) >= s.arrival_check_no_estimate_minutes
        : since(now, o.estimate_at) >= s.arrival_check_minutes;
    return waited ? c.t("needs.no_sign", { n: since(now, o.placed_at) }) : null;
  }
  return null;
}

export function stateLabel(c: PageCtx, o: OrderView): Html {
  const nobody = (o.state === "open" || o.state === "closed") && !o.holder;
  const kind =
    o.state === "done" || o.state === "cancelled"
      ? "plain"
      : nobody
        ? "warn"
        : o.state === "placed" || o.state === "arrived"
          ? "info"
          : "ok";
  const words = c.t(`state.${o.state}` as MessageKey) + (nobody ? ` · ${c.t("hold.nobody")}` : "");
  return html`<span class="pizza-badge pizza-badge--${kind}">${words}</span>`;
}

function times(c: PageCtx, o: OrderView): string {
  const parts: string[] = [];
  if (o.state === "open") parts.push(c.t("times.closes", { time: time(c, o.closes_at) }));
  if (o.closed_at !== null && o.placed_at === null)
    parts.push(c.t("times.closed", { time: time(c, o.closed_at) }));
  if (o.placed_at !== null) parts.push(c.t("times.placed", { time: time(c, o.placed_at) }));
  if (o.estimate_at !== null && o.arrived_at === null)
    parts.push(c.t("times.about", { time: time(c, o.estimate_at) }));
  if (o.arrived_at !== null) parts.push(c.t("times.arrived", { time: time(c, o.arrived_at) }));
  if (o.done_at !== null) parts.push(c.t("times.done", { time: time(c, o.done_at) }));
  if (o.cancelled_at !== null)
    parts.push(c.t("times.cancelled", { time: time(c, o.cancelled_at) }));
  return parts.join(" · ");
}

const open = (o: OrderView) => `${PREFIX}crew/orders/${o.id}`;

/** Mockup 10: the day's orders. */
export function ordersView(
  c: PageCtx,
  day: string,
  orders: OrderView[],
  s: PizzaSettings,
  now: Date,
  error?: string,
): Html {
  const need = new Map(orders.map((o) => [o.id, needs(c, o, s, now)]));
  const needing = orders.filter((o) => need.get(o.id) !== null);
  const openCount = orders.filter((o) => o.state === "open" || o.state === "closed").length;
  const chips = html`<div class="canccu-chips pizza-chips">
    <span class="pizza-badge pizza-badge--info">${c.t("crew.today", { n: orders.length })}</span>
    <span class="pizza-badge pizza-badge--warn"
      >${c.t("crew.needs_you", { n: needing.length })}</span
    >
    <span class="pizza-badge pizza-badge--ok">${c.t("crew.open", { n: openCount })}</span>
    <form method="get" action="${PREFIX}crew" class="pizza-day">
      <label
        ><span class="canccu-small">${c.t("crew.day")}</span>
        <input class="canccu-input" type="date" name="day" value="${day}"
      /></label>
      <button class="canccu-button canccu-button--secondary canccu-button--sm" type="submit">
        ${c.t("crew.show")}
      </button>
    </form>
  </div>`;
  if (orders.length === 0)
    return html`${flash(error)}${chips}
      <div class="canccu-empty"><p class="canccu-empty__title">${c.t("crew.none")}</p></div>`;
  const table = html`<div class="canccu-card canccu-card--flush pizza-desk">
    <table class="canccu-table">
      <thead>
        <tr>
          <th>${c.t("crew.col_order")}</th>
          <th>${c.t("crew.col_pizzeria")}</th>
          <th>${c.t("crew.col_state")}</th>
          <th>${c.t("crew.col_holder")}</th>
          <th>${c.t("crew.col_pizzas")}</th>
          <th>${c.t("crew.col_times")}</th>
          <th>${c.t("crew.col_needs")}</th>
          <th><span class="pizza-sr">${c.t("crew.open_order")}</span></th>
        </tr>
      </thead>
      <tbody>
        ${orders.map(
          (o) => html`<tr${attrs({ class: need.get(o.id) === null ? undefined : "pizza-needs" })}>
            <td class="canccu-num">${o.seq}</td>
            <td>${o.pizzeria.name}</td>
            <td>${stateLabel(c, o)}</td>
            <td>${o.holder?.name ?? "—"}</td>
            <td class="canccu-num">${o.pizza_count} · ${o.people_count}</td>
            <td>${times(c, o)}</td>
            <td class="pizza-needs__text">${need.get(o.id) ?? "—"}</td>
            <td><a href="${open(o)}">${c.t("crew.open_order")} ›</a></td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
  const groups: [string, OrderView[]][] = [
    [c.t("crew.group_needs"), needing],
    [
      c.t("crew.group_way"),
      orders.filter(
        (o) => need.get(o.id) === null && (o.state === "placed" || o.state === "arrived"),
      ),
    ],
    [
      c.t("crew.group_open"),
      orders.filter((o) => need.get(o.id) === null && (o.state === "open" || o.state === "closed")),
    ],
    [c.t("crew.group_over"), orders.filter((o) => o.state === "done" || o.state === "cancelled")],
  ];
  const cards = html`<div class="pizza-phone">
    ${groups
      .filter(([, list]) => list.length > 0)
      .map(
        ([title, list]) =>
          html`<p class="canccu-overline">${title}</p>
            <ul class="pizza-cards">
              ${list.map(
                (o) =>
                  html`<li>
                    <a class="pizza-card pizza-card--link" href="${open(o)}">
                      <span class="pizza-card__title"
                        >${c.t("order.title", { seq: o.seq, pizzeria: o.pizzeria.name })}</span
                      >
                      ${stateLabel(c, o)}
                      <span class="pizza-card__meta">${times(c, o)} · ${counts(c, o)}</span>
                      ${o.holder?.name ? html`<span class="pizza-card__meta">${c.t("crew.holder", { name: o.holder.name })}</span>` : ""}
                      ${o.pickup ? html`<span class="pizza-card__meta">${c.t("crew.pickup", { pickup: o.pickup })}</span>` : ""}
                      ${need.get(o.id) ? html`<span class="pizza-needs__text">${need.get(o.id)}</span>` : ""}
                    </a>
                  </li>`,
              )}
            </ul>`,
      )}
  </div>`;
  return html`${flash(error)}${chips}${table}${cards}`;
}

export interface HistoryEntry {
  at: string;
  actor: { user_id: string; name: string | null } | null;
  kind: string;
  detail: Record<string, unknown>;
}

/** One line of the order's history, in words. */
function historyLine(c: PageCtx, e: HistoryEntry): string {
  const d = e.detail;
  // Done and released say why in `reason`; a cancel's `reason` is the person's own words.
  const key = `history.${e.kind === "done" || e.kind === "released" ? `${e.kind}_${String(d.reason)}` : e.kind}`;
  if (!isKey(key)) return `${e.kind} · ${e.actor?.name ?? c.t("history.app")}`;
  const kind = `reminder.${String(d.kind)}`;
  return c.t(key, {
    who: e.actor?.name ?? c.t("history.app"),
    reason: e.kind === "cancelled" && typeof d.reason === "string" ? `: ${d.reason}` : "",
    kind: isKey(kind) ? c.t(kind) : "",
    minutes: typeof d.minutes === "number" ? d.minutes : "",
    to: d.to === "crew" ? c.t("history.to_crew") : c.t("history.to_holder"),
    label: typeof d.label === "string" ? d.label : "",
    pickup: typeof d.pickup === "string" ? d.pickup : "—",
  });
}

const STEP_INS: {
  step: string;
  when: OrderView["state"][];
  danger?: boolean;
  needsHolder?: boolean;
}[] = [
  { step: "take-over", when: ["open", "closed"] },
  { step: "release", when: ["open", "closed"], needsHolder: true },
  { step: "close", when: ["open"] },
  { step: "reopen", when: ["closed"] },
  { step: "arrive", when: ["placed"] },
  { step: "done", when: ["arrived"] },
  { step: "undo", when: ["placed", "arrived"] },
  { step: "cancel", when: ["open", "closed", "placed", "arrived"], danger: true },
];

/** The steps the crew may take from its page. */
export const CREW_STEP_NAMES = STEP_INS.map((s) => s.step);

/** Mockup 10, below the table: one order, what the crew may do to it, its people and its history. */
export function orderView(c: PageCtx, o: OrderView, history: HistoryEntry[], error?: string): Html {
  const steps = STEP_INS.filter(
    (s) => s.when.includes(o.state) && (s.needsHolder !== true || (o.holder ?? null) !== null),
  );
  const people = peopleOf(o, c.session.userId);
  const comments = new Map<string, string[]>();
  for (const i of o.items ?? [])
    if (i.comment !== null)
      comments.set(i.user_id ?? i.id, [...(comments.get(i.user_id ?? i.id) ?? []), i.comment]);
  const stepIn: Slot =
    steps.length === 0
      ? ""
      : html`<form
          method="post"
          action="${PREFIX}crew/orders/${o.id}"
          class="canccu-card pizza-stepin"
        >
          ${formKey()}
          <h2 class="canccu-card__title">${c.t("crew.step_in")}</h2>
          <p class="canccu-muted canccu-small">${c.t("crew.step_in_hint")}</p>
          <label class="canccu-field"
            ><span class="canccu-field__label">${c.t("crew.reason")}</span
            ><input
              class="canccu-input"
              name="reason"
              maxlength="200"
              required
              placeholder="${c.t("crew.reason_placeholder")}"
          /></label>
          ${
            o.state === "placed"
              ? html`<label class="canccu-field"
                  ><span class="canccu-field__label">${c.t("here.where")}</span
                  ><input
                    class="canccu-input"
                    name="pickup"
                    maxlength="80"
                    value="${o.pickup ?? ""}"
                /></label>`
              : ""
          }
          <div class="canccu-cluster">
            ${steps.map(
              (s, i) =>
                html`<button
                  class="canccu-button ${s.danger === true ? "canccu-button--danger-ghost" : i === 0 ? "canccu-button--primary" : "canccu-button--secondary"}"
                  type="submit"
                  name="step"
                  value="${s.step}"
                >
                  ${c.t(`crew.do_${s.step.replace("-", "_")}` as MessageKey)}
                </button>`,
            )}
          </div>
        </form>`;
  return html`${flash(error)}
    <div class="pizza-order-head">
      ${stateLabel(c, o)}<span class="canccu-muted">${times(c, o)}</span>
    </div>
    ${o.pickup ? html`<p class="canccu-muted">${c.t("crew.pickup", { pickup: o.pickup })}</p>` : ""}
    ${o.state === "cancelled" && o.cancel_reason ? html`<p class="canccu-muted">${o.cancel_reason}</p>` : ""}
    ${stepIn}
    <div class="canccu-band">
      <section class="canccu-card">
        <h2 class="canccu-card__title">${c.t("crew.people")}</h2>
        ${
          people.length === 0
            ? html`<p class="canccu-muted">${c.t("crew.no_pizzas")}</p>`
            : html`<ul class="pizza-crew-people">
                ${people.map(
                  (p) =>
                    html`<li>
                      <span class="pizza-crew-people__name">${p.name}</span>
                      <span>${p.labels.join(" · ")}</span>
                      ${(comments.get(p.user_id) ?? []).map(
                        (cm) =>
                          html`<span class="canccu-muted canccu-small"
                            >${c.t("crew.comment", { text: cm })}</span
                          >`,
                      )}
                    </li>`,
                )}
              </ul>`
        }
      </section>
      <section class="canccu-card">
        <h2 class="canccu-card__title">${c.t("crew.history")}</h2>
        <ul class="canccu-history">
          ${history.map(
            (e) =>
              html`<li>
                <span class="canccu-num canccu-muted">${time(c, e.at)}</span> ${historyLine(c, e)}
              </li>`,
          )}
        </ul>
      </section>
    </div>`;
}
