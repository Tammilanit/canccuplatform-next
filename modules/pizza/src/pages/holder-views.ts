/**
 * The holder's pages (mockups 07–09): the checklist from prepare to hand-out, call mode with the
 * ported summary, called in with the estimate and the payer, it's here with the pickup place, and
 * the hand-out list with "Everyone got theirs". One main action at a time; every step has its undo
 * while the next has not happened. No money here: the money issue adds it.
 */
import { attrs, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { Summary } from "../summary.js";
import { formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { base, counts, flash, post, time } from "./order-view.js";
import type { OrderView } from "./order-view.js";

/** The checklist's steps: done, the current one, or still to come. */
function steps(c: PageCtx, o: OrderView, s: { lastCall: string; autoClose: boolean }): Html {
  const rows: [string, Slot, string | null][] = [
    [
      c.t("check.prepare"),
      html`${o.pizzeria.name}, ${c.t("check.closes", { time: time(c, o.closes_at) })}`,
      null,
    ],
    [
      c.t("check.close"),
      o.state === "open"
        ? s.autoClose
          ? c.t("check.close_auto", { last: s.lastCall, time: time(c, o.closes_at) })
          : c.t("check.close_manual", { last: s.lastCall })
        : c.t("check.closed_at", { time: time(c, o.closed_at ?? o.placed_at) }),
      null,
    ],
    [c.t("check.call"), c.t("check.call_hint"), `${base(o)}/call`],
    [
      c.t("check.called"),
      o.placed_at === null
        ? c.t("check.called_hint")
        : o.estimate_at === null
          ? c.t("check.called_at", { time: time(c, o.placed_at) })
          : c.t("check.called_about", {
              time: time(c, o.placed_at),
              about: time(c, o.estimate_at),
            }),
      `${base(o)}/called-in`,
    ],
    [
      c.t("check.here"),
      o.arrived_at === null
        ? c.t("check.here_hint")
        : c.t("check.here_at", { time: time(c, o.arrived_at), pickup: o.pickup ?? "—" }),
      `${base(o)}/here`,
    ],
    [c.t("check.hand_out"), c.t("check.hand_out_hint"), `${base(o)}/hand-out`],
  ];
  // The step to take now: the ones before it are done (all of them once the order is done).
  const current = { open: 2, closed: 3, placed: 5, arrived: 6, done: 7, cancelled: 0 }[o.state];
  return html`<ol class="pizza-steps">
    ${rows.map(([title, hint, href], i) => {
      const n = i + 1;
      const state = n < current ? "done" : n === current ? "now" : "later";
      const body = html`<span class="pizza-step__box" aria-hidden="true"></span
        ><span class="pizza-step__text"
          ><span class="pizza-step__title">${n} ${title}</span
          ><span class="pizza-step__hint">${hint}</span></span
        >`;
      return html`<li${attrs({ class: `pizza-step pizza-step--${state}`, "aria-current": state === "now" ? "step" : undefined })}>
        ${href === null ? html`<div class="pizza-step__row">${body}</div>` : html`<a class="pizza-step__row" href="${href}">${body}</a>`}
      </li>`;
    })}
  </ol>`;
}

/** Mockup 07 A: the holder's checklist. */
export function checklistView(
  c: PageCtx,
  o: OrderView,
  s: { lastCall: string; autoClose: boolean; error?: string },
): Html {
  const unplaced = o.state === "open" || o.state === "closed";
  const phone = o.pizzeria.phone ?? null;
  const web = o.pizzeria.website ?? null;
  const main =
    o.state === "open"
      ? post(`${base(o)}/step/close`, c.t("check.close_now"), "canccu-button--primary pizza-wide")
      : o.state === "closed"
        ? html`<a class="canccu-button canccu-button--primary pizza-wide" href="${base(o)}/call"
            >${c.t("check.open_call")}</a
          >`
        : o.state === "placed"
          ? html`<a class="canccu-button canccu-button--primary pizza-wide" href="${base(o)}/here"
              >${c.t("check.its_here")}</a
            >`
          : o.state === "arrived"
            ? html`<a
                class="canccu-button canccu-button--primary pizza-wide"
                href="${base(o)}/hand-out"
                >${c.t("check.open_hand_out")}</a
              >`
            : "";
  const undo =
    o.state === "closed"
      ? post(`${base(o)}/step/reopen`, c.t("check.reopen"), "canccu-button--ghost")
      : o.state === "placed" || o.state === "arrived"
        ? post(
            `${base(o)}/step/undo`,
            c.t(o.state === "placed" ? "check.undo_placed" : "check.undo_arrived"),
            "canccu-button--ghost",
          )
        : "";
  return html`${flash(s.error)}
    <section class="pizza-card">
      <p class="pizza-card__title">
        ${o.pizzeria.name} · ${c.t("check.closes", { time: time(c, o.closes_at) })}
      </p>
      <p class="pizza-card__meta">${counts(c, o)} · ${c.t("check.you_hold")}</p>
      <p class="pizza-card__links">
        ${phone === null ? "" : html`<a href="tel:${phone.replace(/\s+/g, "")}">${c.t("pizzeria.call", { phone })}</a>`}
        ${web === null ? "" : html`<a href="${web}" rel="noreferrer noopener" target="_blank">${c.t("pizzeria.web")} ↗</a>`}
      </p>
    </section>
    ${steps(c, o, s)} ${main}
    <div class="pizza-row">
      ${unplaced ? post(`${base(o)}/step/release`, c.t("check.release"), "canccu-button--ghost") : undo}
      ${unplaced ? html`<a class="canccu-danger-link" href="${base(o)}/cancel">${c.t("check.cancel")}</a>` : ""}
    </div>
    ${unplaced ? html`<div class="pizza-row">${undo}</div>` : ""}
    ${o.state === "open" || o.state === "closed" ? editForm(c, o) : ""}`;
}

/** "Edit": the close time and the note, while not called in. */
function editForm(c: PageCtx, o: OrderView): Html {
  return html`<details class="pizza-details">
    <summary>${c.t("edit.title")}</summary>
    <form method="post" action="${base(o)}/edit" class="pizza-form">
      ${formKey()}
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("edit.closes")}</span
        ><input
          class="canccu-input"
          type="time"
          name="closes"
          value="${time(c, o.closes_at)}"
          required
      /></label>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("edit.note")}</span
        ><input class="canccu-input" name="note" maxlength="200" value="${o.note ?? ""}"
      /></label>
      <button class="canccu-button canccu-button--secondary" type="submit">
        ${c.t("edit.save")}
      </button>
    </form>
  </details>`;
}

/** Mockup 07 B and C: an order the caller does not hold. */
export function notHeldView(c: PageCtx, o: OrderView, error?: string): Html {
  const unplaced = o.state === "open" || o.state === "closed";
  const holder = o.holder ?? null;
  const badge =
    holder === null
      ? html`<span class="pizza-badge pizza-badge--warn">${c.t("hold.nobody")}</span>`
      : html`<span class="pizza-badge pizza-badge--info">${c.t("hold.held")}</span>`;
  const head = html`<section class="pizza-card">
    <p class="pizza-card__title">
      ${c.t("order.title", { seq: o.seq, pizzeria: o.pizzeria.name })}
    </p>
    ${badge}
    <p class="pizza-card__meta">${counts(c, o)}</p>
  </section>`;
  if (holder === null && unplaced)
    return html`${flash(error)}${head}
      <section class="pizza-card">
        <p>${c.t("hold.needs_someone")}</p>
        ${post(`${base(o)}/step/claim`, c.t("hold.take_over"), "canccu-button--primary pizza-wide")}
      </section>
      <p class="pizza-muted">${c.t("hold.race")}</p>`;
  const since = o.claimed_at ?? null;
  return html`${flash(error)}${head}
    <section class="pizza-card">
      <p class="pizza-card__title">
        ${holder === null ? c.t("hold.nobody") : c.t("hold.holds", { name: holder.name ?? "—" })}
      </p>
      <p class="pizza-card__meta">
        ${since === null ? "" : c.t("hold.since", { time: time(c, since) })} ${c.t("hold.ask")}
      </p>
    </section>`;
}

/** Mockup 08, left: the list read aloud, numbers first, with ticks that live on this phone. */
export function callView(c: PageCtx, o: OrderView, summary: Summary): Html {
  const phone = o.pizzeria.phone ?? null;
  const web = o.pizzeria.website ?? null;
  return html`<div class="pizza-call" data-call="${o.id}">
    <p class="pizza-call__name">${o.pizzeria.name}</p>
    <p class="pizza-muted">
      ${counts(c, o)} ·
      ${o.pizzeria.service === "takeaway" ? c.t("call.takeaway") : c.t("call.delivery")}
    </p>
    ${
      phone === null
        ? html`<p class="pizza-muted">${c.t("call.no_phone")}</p>`
        : html`<a class="canccu-button pizza-go pizza-wide" href="tel:${phone.replace(/\s+/g, "")}"
            >📞 ${c.t("pizzeria.call", { phone })}</a
          >`
    }
    ${web === null ? "" : html`<p><a href="${web}" rel="noreferrer noopener" target="_blank">${c.t("pizzeria.web")} ↗</a></p>`}
    <ul class="pizza-lines">
      ${summary.lines.map(
        (l, i) =>
          html`<li>
            <label class="pizza-line"
              ><span class="pizza-line__count">${l.count} ×</span
              ><span class="pizza-line__text"
                ><span class="pizza-line__label">${l.label}</span>${
                  l.note === null ? "" : html`<span class="pizza-line__note">${l.note}</span>`
                }</span
              ><input
                class="canccu-check"
                type="checkbox"
                data-tick="${i}"
                aria-label="${c.t("call.tick")}"
            /></label>
          </li>`,
      )}
    </ul>
    <details class="pizza-details" data-copy>
      <summary>${c.t("call.copy")}</summary>
      <textarea class="canccu-input pizza-copy" readonly rows="8">${summary.text}</textarea>
    </details>
    <a class="canccu-button canccu-button--primary pizza-wide" href="${base(o)}/called-in"
      >${c.t("call.called_in")}</a
    >
  </div>`;
}

/** Mockup 08, right: called in, with the estimate and who paid. */
export function calledInView(
  c: PageCtx,
  o: OrderView,
  people: { user_id: string; name: string }[],
  me: string,
  error?: string,
): Html {
  const choices: [string, string][] = [
    ["30", c.t("called.min", { n: 30 })],
    ["45", c.t("called.min", { n: 45 })],
    ["60", c.t("called.min", { n: 60 })],
    ["", c.t("called.unknown")],
  ];
  return html`${flash(error)}
    <form method="post" action="${base(o)}/called-in" class="pizza-form" data-estimate>
      ${formKey()}
      <fieldset class="pizza-fieldset">
        <legend>${c.t("called.when")}</legend>
        <div class="pizza-choices">
          ${choices.map(
            ([v, label]) =>
              html`<label class="pizza-choice"
                ><input
                  type="radio"
                  name="estimate_minutes"
                  value="${v}"
                  ${v === "45" ? "checked" : ""}
                /><span>${label}</span></label
              >`,
          )}
        </div>
        <p class="pizza-about" data-about aria-live="polite"></p>
      </fieldset>
      <fieldset class="pizza-fieldset">
        <legend class="canccu-overline">${c.t("called.payer")}</legend>
        ${people.map(
          (p) =>
            html`<label class="pizza-choice pizza-choice--row"
              ><input
                type="radio"
                name="payer_user_id"
                value="${p.user_id}"
                ${p.user_id === me ? "checked" : ""}
              /><span
                >${p.user_id === me ? c.t("called.me", { name: p.name }) : p.name}</span
              ></label
            >`,
        )}
        <p class="pizza-muted">${c.t("called.payer_hint")}</p>
      </fieldset>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t("called.mark")}
      </button>
      <a class="pizza-center" href="${base(o)}/call">${c.t("called.back")}</a>
    </form>`;
}

/** It's here, and where to collect it. */
export function hereView(c: PageCtx, o: OrderView, error?: string): Html {
  return html`${flash(error)}
    <form method="post" action="${base(o)}/here" class="pizza-form">
      ${formKey()}
      <p class="pizza-muted">
        ${o.estimate_at === null ? c.t("here.no_estimate") : c.t("here.estimate", { time: time(c, o.estimate_at) })}
      </p>
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("here.where")}</span
        ><input
          class="canccu-input"
          name="pickup"
          maxlength="80"
          value="${o.pickup ?? ""}"
          placeholder="${c.t("here.placeholder")}"
      /></label>
      <p class="pizza-muted">${c.t("here.told")}</p>
      <button class="canccu-button canccu-button--primary pizza-wide" type="submit">
        ${c.t("here.mark")}
      </button>
    </form>`;
}
