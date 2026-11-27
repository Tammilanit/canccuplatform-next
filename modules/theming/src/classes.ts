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
  "canccu-widget__art",
  "canccu-widget__kicker",
  "canccu-embed",
  "canccu-is-active",
  "canccu-is-empty",
  "canccu-is-stale",
  "canccu-is-offline",
  ...["", "--none", "--calm", "--lively", "--party"].map((m) => `canccu-motion${m}`),
  ...["", "--standard", "--broadcast", "--arcade"].map((m) => `canccu-motion-pack${m}`),
  ...["", "--roll", "--flap", "--sweep", "--pop", "--tilt"].map((m) => `canccu-fx${m}`),
  ...["", "--outline", "--glow", "--trace", "--pop", "--burst"].map((m) => `canccu-spotlight${m}`),
  ...[
    "",
    "__backdrop",
    "__video",
    "__art",
    "__glow",
    "__kind",
    "__phase",
    "__tint",
    "__scrim",
    "--tinted",
    "--art",
    "--backdrop",
    "--video",
  ].map((m) => `canccu-stage${m}`),
]);

/** `--<layout id>`, `--<region id>`, `--<widget type>`: modifiers named by the theme's own data. */
const OPEN_MODIFIER = /^canccu-(layout|region|widget)--[a-z0-9][a-z0-9_-]*$/;
/** The stage's `--kind-<kind key>` and `--phase-<phase>`: named by the event's data. */
const OPEN_STAGE = /^canccu-stage--(kind|phase)-[a-z0-9][a-z0-9_-]*$/;

export const isThemeClass = (name: string): boolean => name.startsWith("t-");

export const isStableClass = (name: string): boolean =>
  STABLE.has(name) || OPEN_MODIFIER.test(name) || OPEN_STAGE.test(name);
