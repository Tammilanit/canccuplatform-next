/**
 * Live's quick actions (#444; mockup 13, the crew remote): on a phone, the three things done most on
 * the floor, one tap each, below the zones. Each opens the page that already does it (the agenda's
 * Delay page, the Ticker tab, Content's Push now), so nothing here acts on its own.
 */
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AgendaItem } from "../compose/widgets.js";
import { STUDIO } from "./views.js";
import type { ViewContext } from "./views.js";

/**
 * What a delay should move: of the items running at `nowMs`, the one that started last, since a
 * long item (doors open all evening) usually holds a shorter one inside it, and the shorter one is
 * what the floor runs late on. A cancelled item never runs; one with no end runs from its start.
 */
export function runningNow(items: readonly AgendaItem[] | null, nowMs: number): AgendaItem | null {
  const running = (items ?? []).filter(
    (i) =>
      i.status !== "cancelled" &&
      Date.parse(i.starts_at) <= nowMs &&
      (i.ends_at === null || Date.parse(i.ends_at) > nowMs),
  );
  running.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return running[0] ?? null;
}

const link = (href: string, label: string): Html =>
  html`<a class="canccu-button canccu-button--secondary" href="${href}">${label}</a>`;

export function quickActions(c: ViewContext, running: AgendaItem | null): Html | "" {
  const { t } = c;
  const actions: Html[] = [];
  if (c.rights.has("agenda.items.write")) {
    actions.push(
      running === null
        ? html`${link("/agenda/", t("live.delay_now"))}
            <p class="canccu-small canccu-muted">${t("live.delay_none")}</p>`
        : link(`/agenda/items/${encodeURIComponent(running.id)}/delay`, t("live.delay_now")),
    );
  }
  if (c.rights.has("screen.ticker.write"))
    actions.push(link(`${STUDIO}ticker`, t("live.ticker_now")));
  if (c.rights.has("screen.push.write"))
    actions.push(link(`${STUDIO}content#push`, t("live.push_now")));
  if (actions.length === 0) return "";
  return html`<section class="canccu-card canccu-studio-quick">
    <h2 class="canccu-card__title">${t("live.quick")}</h2>
    <div class="canccu-studio-quick__actions">${actions}</div>
  </section>`;
}
