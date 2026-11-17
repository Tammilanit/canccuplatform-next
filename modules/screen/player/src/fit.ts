/**
 * A long announcement fits its box (contracts/moments.md, Templates and placeholders; E17): its
 * title and body are written at the look's size and step down while the text overflows the card,
 * never below half, and claims.css holds the type at the readability floor besides. The step is
 * `--canccu-fit`, which claims.css multiplies into the type sizes, so a theme keeps its own scale.
 */
const STEPS = [1, 0.85, 0.72, 0.6, 0.5];

export function fitAnnouncements(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>(".canccu-widget--announcement")) {
    // Not laid out yet (a layout before the player mounts it): it waits for a tick on the page.
    if (box.clientHeight === 0) continue;
    // Measured once per text and box size; a redraw with new text brings a fresh measure.
    const key = `${String(box.clientHeight)}:${box.textContent}`;
    if (box.dataset.fit === key) continue;
    let i = 0;
    box.style.setProperty("--canccu-fit", "1");
    while (box.scrollHeight > box.clientHeight && i < STEPS.length - 1) {
      i += 1;
      box.style.setProperty("--canccu-fit", String(STEPS[i]));
    }
    box.dataset.fit = key;
  }
}
