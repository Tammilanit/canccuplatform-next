/** Markup that is already safe to insert. Only `html`, `raw` and the components make one. */
export class Html {
  readonly #markup: string;
  constructor(markup: string) {
    this.#markup = markup;
  }
  toString(): string {
    return this.#markup;
  }
}

/** Anything `html` accepts in a slot: text is escaped, `Html` is inserted as is, lists are joined. */
export type Slot = Html | string | number | null | undefined | false | readonly Slot[];

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for use in HTML content or a quoted attribute value. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Mark trusted markup as `Html`. Never pass user or profile text to it. */
export function raw(markup: string): Html {
  return new Html(markup);
}

function render(slot: Slot): string {
  if (slot === null || slot === undefined || slot === false) return "";
  if (slot instanceof Html) return slot.toString();
  if (typeof slot === "number") return String(slot);
  if (typeof slot === "string") return escapeHtml(slot);
  return slot.map(render).join("");
}

/** Tagged template: escapes every interpolated value unless it is `Html`. */
export function html(strings: TemplateStringsArray, ...slots: Slot[]): Html {
  let out = strings[0] ?? "";
  slots.forEach((slot, i) => {
    out += render(slot) + (strings[i + 1] ?? "");
  });
  return new Html(out);
}

/** Attributes: `true` gives a bare attribute, `false` / `undefined` omit it, values are escaped. */
export function attrs(values: Record<string, string | number | boolean | undefined>): Html {
  let out = "";
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === false) continue;
    out += value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`;
  }
  return new Html(out);
}
