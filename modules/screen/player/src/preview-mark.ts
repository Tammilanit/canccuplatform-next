/**
 * The "Preview" mark of a preview on a screen (contracts/screen.md, Zones and assignments), so
 * nobody takes the screen for the live one; with the preview time when it shows another time
 * than now. A safety element of packages/ui: a direct child of the page, after the rest
 * (frames.ts keepSafetyLast), so no theme hides or moves it.
 */
import type { ScreenState } from "./state.js";

export function previewMark(root: HTMLElement, state: ScreenState | null): void {
  let mark = root.querySelector<HTMLElement>(":scope > .canccu-preview-mark");
  const preview = state?.preview ?? null;
  if (state === null || preview === null) {
    mark?.remove();
    return;
  }
  if (mark === null) {
    mark = document.createElement("div");
    mark.className = "canccu-preview-mark";
    mark.setAttribute("role", "status");
    root.append(mark);
  }
  const at =
    preview.at === null
      ? ""
      : ` · ${new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: state.tenant.time_zone,
        }).format(new Date(preview.at))}`;
  mark.textContent = `Preview${at}`;
}
