/**
 * The `test_pattern` command (#783; contracts/screen.md, Commands): the whole page covered by a
 * pattern the crew reads from across the room. The border and corner marks show whether the
 * browser crops the edges (overscan, a kiosk not in full screen), the circle whether the picture is
 * stretched, and the name and size which screen this is and how big its page is (portrait shows).
 * Built with textContent only, like the frames.
 */
import { el } from "./frames.js";

export function testPattern(device: string, width: number, height: number): HTMLElement {
  const pattern = el("div", "canccu-test-pattern");
  pattern.setAttribute("role", "status");
  for (const corner of ["tl", "tr", "bl", "br"]) {
    pattern.append(
      el("span", `canccu-test-pattern__corner canccu-test-pattern__corner--${corner}`),
    );
  }
  const bars = el("div", "canccu-test-pattern__bars");
  for (let i = 0; i < 6; i++) bars.append(el("span", "canccu-test-pattern__bar"));
  const label = el("div", "canccu-test-pattern__label");
  label.append(
    el("p", "canccu-test-pattern__kicker", "Test pattern"),
    el("p", "canccu-test-pattern__name", device),
    el(
      "p",
      "canccu-test-pattern__size",
      `${width}×${height}${height > width ? " · portrait" : ""}`,
    ),
    el("p", "canccu-test-pattern__left", ""),
  );
  pattern.append(el("div", "canccu-test-pattern__circle"), bars, label);
  return pattern;
}
