/**
 * The stable classes of contracts/theming.md (Stable classes and custom properties), which every
 * surface keeps, and the `t-` classes a theme may add. Removing one here is a breaking contract
 * change, as it is there.
 */
const STABLE = new Set([
  "canccu-page",
  "canccu-surface",
  "canccu-surface--screen",
  "canccu-surface--hub",
  "canccu-surface--info",
  "canccu-surface--admin",
  "canccu-header",
  "canccu-header__logo",
  "canccu-header__title",
  "canccu-main",
  "canccu-card",
  "canccu-card__title",
  "canccu-field",
  "canccu-field--check",
  "canccu-field__label",
  "canccu-field__hint",
  "canccu-field__error",
  "canccu-input",
  "canccu-check",
  "canccu-button",
  "canccu-button--primary",
  "canccu-button--secondary",
  "canccu-button--danger",
  "canccu-badge",
  "canccu-badge--ok",
  "canccu-badge--degraded",
  "canccu-badge--down",
  "canccu-layout",
  "canccu-region",
  "canccu-widget",
  "canccu-widget__title",
  "canccu-widget__body",
  "canccu-widget__footer",
  "canccu-embed",
  "canccu-is-active",
  "canccu-is-empty",
  "canccu-is-stale",
  "canccu-is-offline",
]);

/** `--<layout id>`, `--<region id>`, `--<widget type>`: modifiers named by the theme's own data. */
const OPEN_MODIFIER = /^canccu-(layout|region|widget)--[a-z0-9][a-z0-9_-]*$/;

export const isThemeClass = (name: string): boolean => name.startsWith("t-");

export const isStableClass = (name: string): boolean =>
  STABLE.has(name) || OPEN_MODIFIER.test(name);
