/** The `embed` widget: an event's own HTML and JS in the sandbox, over a still (contracts/theming.md, Embeds). */
import { attrs, html } from "./html.js";
import type { Html } from "./html.js";

export interface EmbedOptions {
  /** The embed's `frame_url` from the current theme; without one the widget is the still alone. */
  frameUrl?: string;
  /** The theme's logo: the still, on the theme background, under the frame. */
  logoUrl?: string;
}

/**
 * The same-host sandbox's paths, and nothing that climbs out of them: the widget frames only what
 * theming serves with the sandbox CSP, whatever address a theme read hands it.
 */
function inSandbox(url: string): boolean {
  return (
    /^\/theming\/sandbox\/[A-Za-z0-9._/-]+$/.test(url) &&
    url.split("/").every((segment) => segment !== "." && segment !== "..")
  );
}

/**
 * The still is always there and the frame lies over it, transparent until the embed paints: a
 * frame that fails to load, a sandbox refusal (an empty body) or a viewer who asks for reduced
 * motion (ui.css hides the frame) all leave the still showing, so an embed never blanks the screen.
 */
export function embedWidget(o: EmbedOptions): Html {
  const still = o.logoUrl === undefined ? "" : html`<img${attrs({ src: o.logoUrl, alt: "" })}>`;
  // `sandbox` without allow-same-origin gives the document an opaque origin, on top of the CSP's
  // own sandbox; an empty `allow` grants no permission. Nothing on a screen is focusable.
  const frame =
    o.frameUrl === undefined || !inSandbox(o.frameUrl)
      ? ""
      : html`<iframe${attrs({
          class: "canccu-embed",
          sandbox: "allow-scripts",
          allow: "",
          referrerpolicy: "no-referrer",
          src: o.frameUrl,
          title: "",
          "aria-hidden": "true",
          tabindex: "-1",
        })}></iframe>`;
  return html`<div class="canccu-widget canccu-widget--embed"><div class="canccu-widget__body">${still}</div>${frame}</div>`;
}
