/**
 * The one tooltip of the organiser pages (#782, docs/design/README.md decision 9): its text sits
 * beside the trigger as `role="tooltip"` and the trigger names it with `aria-describedby`. ui.css
 * shows it on hover and keyboard focus; admin's shell.js, which every organiser shell loads, opens
 * it on a tap (an info button, a chip) or a long press (an icon button, whose tap still acts).
 * canccu_kit.ui_tips draws the same markup for the Python modules.
 */
import { Html, attrs, html } from "./html.js";
import { icon } from "./shell.js";

// Unique within any page: the count only grows while the process runs.
let seq = 0;
const nextId = (): string => `canccu-tip-${String(++seq)}`;

const text = (id: string, words: string, hidden = false): Html =>
  html`<span${attrs({ role: "tooltip", id, class: "canccu-tip__text", "aria-hidden": hidden ? "true" : undefined })}>${words}</span>`;

/** Wraps a focusable trigger (its markup starts with its own tag) with a tooltip. */
export function tooltip(trigger: Html, words: string): Html {
  const id = nextId();
  const named = String(trigger).replace(/^<([a-z][a-z0-9-]*)/i, `<$1 aria-describedby="${id}"`);
  return html`<span class="canccu-tip">${new Html(named)}${text(id, words)}</span>`;
}

/** A small "i" button that explains the thing beside it. */
export function infoTip(words: string): Html {
  const id = nextId();
  return html`<span class="canccu-tip"><button type="button" class="canccu-tip__info" aria-label="More about this" aria-describedby="${id}">${icon("info")}</button>${text(id, words)}</span>`;
}

export interface IconButtonOptions {
  icon: string;
  /** What the button does: its accessible name and its tooltip. */
  label: string;
  href?: string;
  type?: "button" | "submit";
  name?: string;
  value?: string;
}

/** An icon-only button. The tooltip repeats the label, so screen readers hear it once. */
export function iconButton(o: IconButtonOptions): Html {
  const id = nextId();
  const cls = "canccu-button canccu-button--ghost canccu-button--icon";
  const inner = icon(o.icon);
  const trigger =
    o.href === undefined
      ? html`<button${attrs({ type: o.type ?? "button", class: cls, "aria-label": o.label, name: o.name, value: o.value })}>${inner}</button>`
      : html`<a${attrs({ class: cls, href: o.href, "aria-label": o.label })}>${inner}</a>`;
  return html`<span class="canccu-tip">${trigger}${text(id, o.label, true)}</span>`;
}

/** A status chip (the shell's badge colours) whose tooltip says what the status means. */
export function statusChip(kind: string, label: string, words: string): Html {
  const id = nextId();
  return html`<span class="canccu-tip"><span${attrs({ class: `canccu-badge canccu-badge--${kind}`, tabindex: 0, "aria-describedby": id })}>${label}</span>${text(id, words)}</span>`;
}
