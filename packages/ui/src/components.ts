import { Html, attrs, html, raw, type Slot } from "./html.js";
import { themeStyle, type ProfileLike } from "./theme.js";

export interface ButtonOptions {
  label: string;
  type?: "submit" | "button" | "reset";
  variant?: "primary" | "secondary" | "danger";
  name?: string;
  value?: string;
  disabled?: boolean;
}

/** A button; `type` defaults to `submit`, `variant` to `primary`. */
export function button(o: ButtonOptions): Html {
  const variant = o.variant ?? "primary";
  return html`<button${attrs({
    class: `canccu-button canccu-button--${variant}`,
    type: o.type ?? "submit",
    name: o.name,
    value: o.value,
    disabled: o.disabled,
  })}>${o.label}</button>`;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldOptions {
  name: string;
  label: string;
  type?: "text" | "number" | "password" | "checkbox" | "select";
  value?: string | number | boolean;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Choices for `type: "select"`. */
  options?: readonly FieldOption[];
}

/** A labelled form field with an optional hint and error (settings value types: text, number, bool, choice). */
export function field(o: FieldOptions): Html {
  const type = o.type ?? (o.options ? "select" : "text");
  const id = `canccu-field-${o.name}`;
  const describedBy = o.error ? `${id}-error` : o.hint ? `${id}-hint` : undefined;
  const common = {
    id,
    name: o.name,
    required: o.required,
    "aria-invalid": o.error ? "true" : undefined,
    "aria-describedby": describedBy,
  };
  let control: Html;
  if (type === "select") {
    const options = (o.options ?? []).map(
      (opt) =>
        html`<option${attrs({ value: opt.value, selected: String(o.value) === opt.value })}>${opt.label}</option>`,
    );
    control = html`<select${attrs({ class: "canccu-input", ...common })}>${options}</select>`;
  } else if (type === "checkbox") {
    control = html`<input${attrs({ class: "canccu-check", type, value: "true", checked: o.value === true, ...common })}>`;
  } else {
    const value = o.value === undefined || typeof o.value === "boolean" ? undefined : o.value;
    control = html`<input${attrs({ class: "canccu-input", type, value, ...common })}>`;
  }
  const label = html`<label${attrs({ class: "canccu-field__label", for: id })}>${o.label}</label>`;
  const help: Slot = o.error
    ? html`<p${attrs({ class: "canccu-field__error", id: `${id}-error` })}>${o.error}</p>`
    : o.hint
      ? html`<p${attrs({ class: "canccu-field__hint", id: `${id}-hint` })}>${o.hint}</p>`
      : undefined;
  const body = type === "checkbox" ? html`${control} ${label}` : html`${label}${control}`;
  const cls = type === "checkbox" ? "canccu-field canccu-field--check" : "canccu-field";
  return html`<div${attrs({ class: cls })}>${body}${help}</div>`;
}

export interface CardOptions {
  title?: string;
  body: Slot;
}

/** A card: a bordered section with an optional heading. */
export function card(o: CardOptions): Html {
  const title = o.title === undefined ? "" : html`<h2 class="canccu-card__title">${o.title}</h2>`;
  return html`<section class="canccu-card">${title}${o.body}</section>`;
}

/** Which kind of page this is; a theme targets `canccu-surface--<surface>` (contracts/theming.md). */
export type Surface = "screen" | "hub" | "info" | "admin";

export interface PageOptions {
  title: string;
  body: Slot;
  /** The event profile; its theme overrides the ui.css defaults. */
  profile?: ProfileLike;
  /** URL of the main logo (`logos.main`), resolved by the module. */
  logoUrl?: string;
  /** Where the module serves ui.css. */
  cssHref?: string;
  /** Defaults to `admin`: the surface themes restyle least, so a forgotten option fails safe. */
  surface?: Surface;
  /** The response's CSP nonce for the theme `<style>`; required once the module sends the nonce CSP. */
  nonce?: string;
}

/** A full HTML document: ui.css, the profile theme, a header with the logo, and main. */
export function page(o: PageOptions): Html {
  const style = raw(themeStyle(o.profile, o.nonce));
  const logo =
    o.logoUrl === undefined
      ? ""
      : html`<img${attrs({ class: "canccu-header__logo", src: o.logoUrl, alt: "" })}>`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<link${attrs({ rel: "stylesheet", href: o.cssHref ?? "/ui/ui.css" })}>
${style}</head>
<body${attrs({ class: `canccu-page canccu-surface canccu-surface--${o.surface ?? "admin"}` })}>
<header class="canccu-header">${logo}<span class="canccu-header__title">${o.title}</span></header>
<main class="canccu-main">${o.body}</main>
</body>
</html>
`;
}

export type HealthStatus = "ok" | "degraded" | "down";

/** A health badge (contracts/admin.md Health status); the text is the status word. */
export function healthBadge(status: HealthStatus): Html {
  return html`<span${attrs({ class: `canccu-badge canccu-badge--${status}` })}>${status}</span>`;
}
