/**
 * The Ticker page (step 3 plan U8, L13; mockup 13): one line across every screen, set in a few
 * taps, so the same page is the phone remote.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { TickerNow } from "../ticker/resolve.js";
import type { MessageKey } from "./messages.js";
import { clockTime } from "./views.js";
import type { ViewContext } from "./views.js";

const SOURCES: Record<string, MessageKey> = {
  admin: "ticker.from.admin",
  bot: "ticker.from.bot",
  window: "ticker.from.window",
};

export function tickerView(c: ViewContext, now: TickerNow): Html {
  const { t } = c;
  const source = now.source === null ? undefined : SOURCES[now.source];
  const showing =
    now.text === null
      ? html`<p class="canccu-muted">${t("ticker.nothing")}</p>`
      : html`<p class="canccu-studio-ticker-line">${t("ticker.showing", { text: now.text })}</p>
          <p class="canccu-small canccu-muted">
            ${[source ? t(source) : "", now.until ? t("ticker.until", { time: clockTime(now.until, c.timeZone) }) : t("ticker.no_end")].filter(Boolean).join(" · ")}
          </p>`;
  const choice = (value: string, key: MessageKey, checked = false) =>
    html`<label class="canccu-studio-choice"
      ><input type="radio" name="for" value="${value}" ${attrs({ checked })} /> ${t(key)}</label
    >`;
  const clear =
    now.source === "admin" || now.source === "bot"
      ? html`<button${attrs({ class: "canccu-button canccu-button--danger-ghost", type: "button", "data-call": "DELETE", "data-url": "/api/screen/ticker", "data-done": t("ticker.clear_done") })}>${t("ticker.clear")}</button>`
      : "";
  const form = html`<form class="canccu-card canccu-form" data-ticker>
    <div class="canccu-field">
      <label class="canccu-field__label" for="canccu-studio-ticker-text">${t("ticker.text")}</label
      ><textarea
        class="canccu-input"
        id="canccu-studio-ticker-text"
        name="text"
        required
        maxlength="280"
        rows="2"
        aria-describedby="canccu-studio-ticker-count"
      ></textarea>
      <p class="canccu-field__hint" id="canccu-studio-ticker-count" aria-live="polite">
        ${t("ticker.chars", { count: 0 })}
      </p>
    </div>
    <fieldset class="canccu-studio-choices">
      <legend class="canccu-field__label">${t("ticker.for")}</legend>
      ${choice("15", "ticker.15m")}${choice("60", "ticker.1h", true)}${choice("240", "ticker.4h")}${choice("at", "ticker.at")}${choice("none", "ticker.forever")}<input
        class="canccu-input canccu-studio-at"
        type="time"
        name="at"
        aria-label="${t("ticker.at")}"
      />
    </fieldset>
    <div class="canccu-cluster">
      <button class="canccu-button canccu-button--primary canccu-button--lg" type="submit">
        ${t("ticker.set")}</button
      >${clear}
    </div>
  </form>`;
  return html`<section class="canccu-card" data-live="ticker-now">${showing}</section>
    ${form}`;
}
