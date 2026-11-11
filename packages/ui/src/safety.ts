/**
 * The elements that keep people safe (contracts/theming.md, Advanced mode): a device's pairing
 * code, the offline marker and the privacy link on public pages. ui.css draws each in
 * `canccu-base` with every declaration `!important`, which no theme layer can override. That holds
 * only for an element that is a direct child of `<body class="canccu-page">`, after all its other
 * children, holding text only: ui.css guards the root and the page, not any other ancestor.
 */
export const SAFETY_CLASSES = [
  "canccu-pairing-code",
  "canccu-offline-marker",
  "canccu-privacy-link",
] as const;
export type SafetyClass = (typeof SAFETY_CLASSES)[number];
