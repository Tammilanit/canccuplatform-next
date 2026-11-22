import { html, icon } from "@canccu/ui";
import type { EventInfo, Html } from "@canccu/ui";
import type { Translate } from "./messages.js";

/** Theming's one address for the event's logo, its initials without one (contracts/theming.md). */
const LOGO = "/theming/logo";

/**
 * The hub's frame around an attendee's page (amendment 5, mockups 03–05): the event's header,
 * which leads back to its front door `/`, and the hub's bar. The bar holds only pages that exist
 * (Now and Food; More for the rest): Schedule, Play and Alerts join it with their pages, which the
 * App track builds, so no tab leads nowhere. One nav for both widths: a bar at a phone's foot, the
 * header's links on a desktop (static/hub.css).
 */
export function frame(
  event: EventInfo | undefined,
  t: Translate,
  signedIn: boolean,
  signIn: string,
): Html {
  const more = html`<button class="pizza-hubbar__item" type="button" popovertarget="pizza-more">
      ${icon("more")}<span>${t("frame.more")}</span>
    </button>
    <div class="pizza-more" id="pizza-more" popover>
      <a href="/privacy">${t("frame.privacy")}</a>
      ${
        signedIn
          ? html`<form method="post" action="/admin/sign-out">
              <button type="submit">${t("frame.sign_out")}</button>
            </form>`
          : html`<a href="${signIn}">${t("frame.sign_in")}</a>`
      }
    </div>`;
  return html`<header class="pizza-frame">
    <a class="pizza-frame__event" href="/"
      ><img class="pizza-frame__logo" src="${LOGO}" alt="" /><span class="pizza-frame__name"
        >${event?.name ?? t("frame.event")}</span
      ></a
    >
    <nav class="pizza-hubbar" aria-label="${t("frame.hub")}">
      <a class="pizza-hubbar__item" href="/">${icon("pulse")}<span>${t("frame.now")}</span></a>
      <a class="pizza-hubbar__item" href="/pizza/" aria-current="page"
        >${icon("food")}<span>${t("frame.food")}</span></a
      >
      ${more}
    </nav>
  </header>`;
}
