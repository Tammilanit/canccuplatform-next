/**
 * A long announcement fits its box (contracts/moments.md, Templates and placeholders; E17): its
 * title and body are written at the look's size and step down while the text overflows the card,
 * never below half, and claims.css holds the type at the readability floor besides. The step is
 * `--canccu-fit`, which claims.css multiplies into the type sizes, so a theme keeps its own scale.
 */
const STEPS = [1, 0.85, 0.72, 0.6, 0.5];

/** Web fonts loaded so far: a late font reflows the text, so every box is measured again. */
let fontLoads = 0;
const watched = new WeakSet<object>();

function watchFonts(): void {
  const fonts = (globalThis.document as Document | undefined)?.fonts as EventTarget | undefined;
  if (fonts === undefined || watched.has(fonts)) return;
  watched.add(fonts);
  fonts.addEventListener("loadingdone", () => {
    fontLoads += 1;
  });
}

export function fitAnnouncements(root: ParentNode): void {
  watchFonts();
  for (const box of root.querySelectorAll<HTMLElement>(".canccu-widget--announcement")) {
    // Not laid out yet (a layout before the player mounts it): it waits for a tick on the page.
    if (box.clientHeight === 0) continue;
    // Measured once per text, box size and font set; the player's tick brings a fresh measure.
    const key = `${String(box.clientWidth)}x${String(box.clientHeight)}:${String(fontLoads)}:${box.textContent}`;
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
