/**
 * The sample content of the Studio's preview surfaces (plan issue-185 D9, issue-784 D2), in stable
 * classes only, so a theme restyles them as it will the real surfaces. Each page also takes the
 * live preview's token values (static/preview-live.js).
 */
import { html, shellPage } from "@canccu/ui";
import type { EventInfo, Html, Surface } from "@canccu/ui";
import { STUDIO } from "./studio-views.js";

export const LIVE_SCRIPT = html`<script src="${STUDIO}static/preview-live.js"></script>`;

/** What one preview links: the token CSS, the event CSS, the logo and the Discord colour. */
export interface Look {
  tokens: string;
  /** The organiser pages' tokens: the platform colours where the theme fails the contrast rules. */
  adminTokens: string;
  css: string | undefined;
  logo: string | undefined;
  embedColor: string;
}

const widget = (type: string, title: string, body: Html | string, footer = ""): Html =>
  html`<article class="canccu-widget canccu-widget--${type}">
    <h2 class="canccu-widget__title">${title}</h2>
    <div class="canccu-widget__body">${body}</div>
    ${footer === "" ? "" : html`<footer class="canccu-widget__footer">${footer}</footer>`}
  </article>`;

const region = (id: string, content: Html): Html =>
  html`<section class="canccu-region canccu-region--${id}">${content}</section>`;

/** The sample content of each surface, in stable classes only. */
export const SAMPLES: Record<string, { title: string; surface: Surface; body: () => Html }> = {
  screen: {
    title: "Demo Event",
    surface: "screen",
    body: () =>
      html`<div class="canccu-layout canccu-layout--preview">
        ${region(
          "hero",
          widget(
            "agenda",
            "Now",
            html`<p class="canccu-is-active">Dinner</p>
              <p>+15 min</p>`,
            "Next: Demo Game Cup, 21:00 · Stage",
          ),
        )}${region("side", widget("clock", "Time", html`<p>18:42</p>`))}${region(
          "ticker",
          widget("ticker", "Info", html`<p>Pizza orders close at 20:00</p>`),
        )}
      </div>`,
  },
  hub: {
    title: "Demo Event",
    surface: "hub",
    // The hub's home as the pack draws it (sheet 1): now, the next things, and the alerts.
    body: () =>
      html`<div class="canccu-grid">
          <section class="canccu-card">
            <p class="canccu-overline">Now</p>
            <h2 class="canccu-card__title">
              Dinner <span class="canccu-badge canccu-badge--late">+15 min</span>
            </h2>
            <p>Café · until 19:15</p>
            <button class="canccu-button canccu-button--primary" type="button">Order pizza</button>
          </section>
          <section class="canccu-card">
            <h2 class="canccu-card__title">Tournament final</h2>
            <p class="canccu-muted">Main hall · 20:00</p>
          </section>
          <section class="canccu-card">
            <h2 class="canccu-card__title">Pizza</h2>
            <p><span class="canccu-badge canccu-badge--ok">Orders open</span> until 19:55</p>
          </section>
          <section class="canccu-card">
            <h2 class="canccu-card__title">Schedule</h2>
            <p class="canccu-muted">6 more today</p>
          </section>
        </div>
        <button class="canccu-button canccu-button--primary canccu-button--block" type="button">
          Turn on alerts
        </button>`,
  },
};

/** A whole embed as the bot posts it: Discord's own look, the event's bar colour and logo. */
export function discordCard(look: Look, event: string): Html {
  const logo =
    look.logo === undefined
      ? ""
      : html`<img class="canccu-preview-discord__logo" src="${look.logo}" alt="" />`;
  // An SVG bar, not a style attribute: the page policy allows no inline styles.
  return html`<div class="canccu-preview-discord">
    <div class="canccu-preview-discord__embed">
      <svg
        class="canccu-preview-discord__bar"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect width="1" height="1" fill="${look.embedColor}" />
      </svg>
      <div class="canccu-preview-discord__body">
        <p class="canccu-preview-discord__author">${logo}${event}</p>
        <p class="canccu-preview-discord__title">Dinner is 15 min late</p>
        <p>Now until 19:15 in the café. The semi-finals start at 19:45.</p>
      </div>
    </div>
  </div>`;
}

/**
 * The organiser pages as they are: the shell with the event's admin tokens, which every organiser
 * page links (UX audit C3: the preview shows what is). After the current tokens the shell links,
 * so the draft's win.
 */
export function organiserPage(
  nonce: string,
  event: EventInfo | undefined,
  look: Look,
  stylesheet: (href: string | undefined) => Html | string,
): Html {
  return shellPage({
    title: "Run of show",
    nonce,
    surface: "admin",
    cssHref: `${STUDIO}static/ui.css`,
    head: html`<link rel="stylesheet" href="${STUDIO}static/preview.css" />${stylesheet(
        look.adminTokens,
      )}`,
    event,
    tabs: [
      { href: "#", label: "Day", current: true },
      { href: "#", label: "Templates" },
    ],
    body: html`<section class="canccu-card">
        <h2 class="canccu-card__title">Dinner</h2>
        <p class="canccu-muted">Café · until 19:15</p>
        <p class="canccu-cluster">
          <button class="canccu-button canccu-button--primary" type="button">Save</button>
          <button class="canccu-button canccu-button--ghost" type="button">Undo</button>
          <a href="#">A link</a>
        </p>
        <p class="canccu-cluster">
          <span class="canccu-badge canccu-badge--ok">Running</span>
          <span class="canccu-badge canccu-badge--degraded">Slow</span>
          <span class="canccu-badge canccu-badge--down">Down</span>
        </p>
      </section>
      ${LIVE_SCRIPT}`,
  });
}
