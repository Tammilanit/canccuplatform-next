/**
 * The Pins page and the frozen banner (#265; plan #190 S9): what screens draw, what is pinned, by
 * whom and until when, and "Freeze for the event" (the API's freeze form with the event's end).
 * The banner sits on every Studio page while a pin has an end, for everyone who may read the pin.
 */
import { attrs, dayLabel, html, notice, timeLabel } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { TenantContext } from "@canccu/kit";
import type { Db } from "../db.js";
import { inEffect } from "../pins/routes.js";
import type { PinDeps } from "../pins/routes.js";
import { readPin } from "../pins/store.js";
import type { PinRow, PinValues } from "../pins/store.js";
import type { Translate } from "./messages.js";
import type { ViewContext } from "./views.js";

const PIN_API = "/api/screen/pin";
const WRITE = "screen.bundle.write";

export interface InEffect {
  bundle_version: string;
  theme_revision: number;
}

/** "Sun 4 Jan 16:00", in the event's time zone: a freeze may end days from now. */
const when = (c: Pick<ViewContext, "timeZone">, iso: string) =>
  `${dayLabel(iso, c.timeZone)} ${timeLabel(iso, c.timeZone)}`;

const nameOf = (pin: PinRow) => pin.changed_by_name ?? pin.changed_by ?? "";

/** The one sentence that says what is frozen, until when and by whom. */
function frozenText(
  c: Pick<ViewContext, "t" | "timeZone">,
  pin: PinRow,
  now: InEffect,
): string | null {
  if (pin.until === null) return null;
  const values = {
    bundle: now.bundle_version,
    revision: now.theme_revision,
    time: when(c, pin.until.toISOString()),
    name: nameOf(pin),
  };
  return c.t(now.theme_revision === 0 ? "frozen.banner_bundle" : "frozen.banner", values);
}

/** The banner for the current tenant's pin, or nothing while no pin has an end. */
export async function frozenBanner(
  deps: Pick<PinDeps, "sources" | "bundles"> & { db: Db },
  ctx: TenantContext,
  t: Translate,
): Promise<Html | ""> {
  const pin = await deps.db.tenant(readPin);
  if (pin.until === null) return "";
  const c = { t, timeZone: ctx.time_zone };
  const text = frozenText(c, pin, await inEffect(deps, ctx.tenant_id, pin));
  if (text === null) return "";
  return html`<div class="canccu-studio-frozen">
    ${notice({ kind: "warn", title: c.t("frozen.title"), text })}
  </div>`;
}

function values(c: ViewContext, v: PinValues): [bundle: string, theme: string] {
  return [
    v.bundle_version === null
      ? c.t("pins.bundle_follows")
      : c.t("pins.bundle_value", { version: v.bundle_version }),
    v.theme_revision === null
      ? c.t("pins.theme_follows")
      : c.t("pins.theme_value", { revision: v.theme_revision }),
  ];
}

function changedLine(c: ViewContext, pin: PinRow): string {
  if (pin.changed_at === null) return c.t("pins.never");
  const time = when(c, pin.changed_at.toISOString());
  return pin.changed_by === null
    ? c.t("pins.restored", { time })
    : c.t("pins.changed", { name: nameOf(pin), time });
}

const button = (label: string, body: unknown, confirm: string, done: string, primary: boolean) =>
  html`<button${attrs({ class: `canccu-button canccu-button--${primary ? "primary" : "secondary"}`, type: "button", "data-call": "PUT", "data-url": PIN_API, "data-body": JSON.stringify(body), "data-confirm": confirm, "data-done": done })}>${label}</button>`;

/** Freeze or Unfreeze, for holders of `screen.bundle.write`; a hint for everyone else. */
function freezeCard(c: ViewContext, pin: PinRow, endsAt: string | null | undefined): Html {
  const { t } = c;
  if (!c.rights.has(WRITE)) {
    return html`<p class="canccu-small canccu-muted">${t("pins.no_right")}</p>`;
  }
  if (pin.until !== null) {
    return html`<section class="canccu-card">
      <h2 class="canccu-card__title">${t("pins.frozen_title")}</h2>
      <p class="canccu-card__desc">${t("pins.frozen_desc")}</p>
      <div class="canccu-cluster">
        ${button(t("pins.unfreeze"), { freeze: false }, t("pins.unfreeze_confirm"), t("pins.unfreeze_done"), false)}
      </div>
    </section>`;
  }
  const ends = endsAt ? Date.parse(endsAt) : NaN;
  // An event without an end, or one already past it, is asked for the freeze's end instead.
  const action =
    endsAt && ends > c.nowMs
      ? button(
          t("pins.freeze"),
          { freeze: true, until: endsAt },
          t("pins.freeze_confirm", { time: when(c, endsAt) }),
          t("pins.freeze_done"),
          true,
        )
      : html`<form class="canccu-form" data-freeze>
          <div class="canccu-field">
            <label class="canccu-field__label" for="canccu-studio-freeze-until"
              >${t("pins.freeze_until")}</label
            ><input
              class="canccu-input"
              id="canccu-studio-freeze-until"
              type="datetime-local"
              name="until"
              required
            />
          </div>
          <div class="canccu-cluster">
            <button class="canccu-button canccu-button--primary" type="submit">
              ${t("pins.freeze")}
            </button>
          </div>
        </form>`;
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">${t("pins.freeze_title")}</h2>
    <p class="canccu-card__desc">${t("pins.freeze_desc")}</p>
    ${action}
  </section>`;
}

export function pinsView(
  c: ViewContext,
  pin: PinRow,
  now: InEffect,
  endsAt: string | null | undefined,
): Html {
  const { t } = c;
  const theme =
    now.theme_revision === 0
      ? t("pins.theme_none")
      : t("pins.theme_value", { revision: now.theme_revision });
  const [bundle, pinnedTheme] = values(c, pin);
  const after =
    pin.restores === null
      ? ""
      : html`<dt>${t("pins.afterwards")}</dt>
          <dd>${values(c, pin.restores).join(" · ")}</dd>`;
  return html`<section class="canccu-card" data-live="pins-now">
      <h2 class="canccu-card__title">${t("pins.in_effect")}</h2>
      <p class="canccu-card__desc">${t("pins.in_effect_desc")}</p>
      <dl class="canccu-dl">
        <dt>${t("pins.bundle")}</dt>
        <dd>${t("pins.bundle_value", { version: now.bundle_version })}</dd>
        <dt>${t("pins.theme")}</dt>
        <dd>${theme}</dd>
      </dl>
    </section>
    <section class="canccu-card">
      <h2 class="canccu-card__title">${t("pins.pinned")}</h2>
      <p class="canccu-card__desc">${t("pins.pinned_desc")}</p>
      <dl class="canccu-dl">
        <dt>${t("pins.bundle")}</dt>
        <dd>${bundle}</dd>
        <dt>${t("pins.theme")}</dt>
        <dd>${pinnedTheme}</dd>
        <dt>${t("pins.until")}</dt>
        <dd>${pin.until === null ? t("pins.no_end") : when(c, pin.until.toISOString())}</dd>
        ${after}
      </dl>
      <p class="canccu-small canccu-muted">${changedLine(c, pin)}</p>
    </section>
    ${freezeCard(c, pin, endsAt)}`;
}
