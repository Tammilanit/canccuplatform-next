/**
 * The gallery's thumbnails (plan issue-784 D12): a scheme as a small screen in inline SVG, drawn on
 * the server from its colours, with the event's logo on its plate and "Aa" in the preset's heading
 * font. Fifteen frames of the real player would cost more than the whole page; these stay as live
 * as what they are drawn from, the logo and the plate among it.
 */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { Colors } from "./brand.js";
import { plateColor } from "./logo-plate.js";
import type { Plate } from "./logo-plate.js";

export interface ThumbOptions {
  /** Unique on the page: the gradient's id. */
  id: string;
  logoUrl?: string | undefined;
  plate?: Plate | undefined;
  headingFamily: string;
  /** The corner radius at the thumbnail's scale, in its units. */
  radius: number;
}

const rect = (o: Record<string, string | number | undefined>): Html => html`<rect${attrs(o)} />`;

export function presetThumbnail(colors: Colors, o: ThumbOptions): Html {
  const card = { fill: colors.surface, stroke: colors.border, "stroke-width": 1, rx: o.radius };
  const plate = o.plate === undefined ? undefined : plateColor(o.plate, colors.surface);
  const logo =
    o.logoUrl === undefined
      ? rect({ x: 10, y: 7, width: 22, height: 8, rx: 2, fill: colors.text_muted })
      : html`${plate === undefined ? "" : rect({ x: 8, y: 5, width: 28, height: 12, rx: o.plate?.shape === "circle" ? 6 : 2, fill: plate })}<image${attrs({ href: o.logoUrl, x: 10, y: 6, width: 24, height: 10, preserveAspectRatio: "xMidYMid meet" })} />`;
  return html`<svg${attrs({ class: "canccu-studio-thumb", viewBox: "0 0 240 135", role: "img", "aria-hidden": "true" })}>
    <defs>
      <radialGradient${attrs({ id: o.id, cx: "0.85", cy: "0", r: "0.9" })}>
        <stop offset="0"${attrs({ "stop-color": colors.primary, "stop-opacity": "0.28" })} />
        <stop offset="1"${attrs({ "stop-color": colors.background, "stop-opacity": "0" })} />
      </radialGradient>
    </defs>
    ${rect({ width: 240, height: 135, fill: colors.background })}
    ${rect({ width: 240, height: 135, fill: `url(#${o.id})` })} ${logo}
    ${rect({ x: 8, y: 24, width: 140, height: 74, ...card })}
    <text${attrs({ x: 18, y: 56, "font-family": `${o.headingFamily}, system-ui, sans-serif`, "font-size": 20, "font-weight": 700, fill: colors.text })}>Aa</text>
    ${rect({ x: 18, y: 68, width: 62, height: 5, rx: 2.5, fill: colors.primary })}
    ${rect({ x: 18, y: 78, width: 96, height: 3, rx: 1.5, fill: colors.text_muted })}
    ${rect({ x: 156, y: 24, width: 76, height: 34, ...card })}
    ${rect({ x: 164, y: 34, width: 34, height: 4, rx: 2, fill: colors.accent })}
    ${rect({ x: 164, y: 43, width: 52, height: 3, rx: 1.5, fill: colors.text_muted })}
    ${rect({ x: 156, y: 64, width: 76, height: 34, ...card })}
    ${rect({ x: 8, y: 108, width: 14, height: 6, rx: 1, fill: colors.primary })}
    ${rect({ x: 28, y: 110, width: 90, height: 2, rx: 1, fill: colors.text_muted })}
  </svg>`;
}
