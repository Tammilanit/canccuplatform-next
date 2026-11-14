// @vitest-environment happy-dom
/**
 * The box editor's gap warnings as drawn in the browser (static/studio-layout.js, #486): the
 * shared warn notice, a Fill the gap that cannot throw on a stale button, the focus and the
 * announcement after a fill, and the gaps worked out once per draw. studio.js runs as the page
 * loads it, so its helpers (say, the shared plural, the notice) are the real ones.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HTMLButtonElement, HTMLElement, Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import type { Area, Layout } from "../src/compose/layouts.js";
import { LAYOUT_CLIENT_KEYS, LAYOUT_EN } from "../src/studio/layout-messages.js";
import * as geometry from "../static/studio-boxes.js";
import { boxEditor } from "../static/studio-layout.js";

vi.mock("../static/studio-boxes.js", async (original) => {
  const real = await original<typeof import("../static/studio-boxes.js")>();
  return { ...real, gaps: vi.fn(real.gaps) };
});

const win = globalThis as unknown as Window;
const PULSE = BUILT_IN_LAYOUTS.find((l) => l.id === "pulse") as Layout;
const NAMES = {
  header: "Header",
  hero: "Hero",
  rail: "Side rail",
  venue_rail: "Venue card",
  ticker: "Ticker",
};
const TEXT = Object.fromEntries(
  LAYOUT_CLIENT_KEYS.map((k) => [k, (LAYOUT_EN as Record<string, string>)[k]]),
);
const STUDIO_JS = readFileSync(join(import.meta.dirname, "../static/studio.js"), "utf8");
type Studio = Parameters<typeof boxEditor>[1] & { show: (message: string) => void };
const place = (a: Area) => `${a.row} / ${a.column} / span ${a.rows} / span ${a.columns}`;

/** The zone page's parts the editor reads, with Pulse's boxes as the zone saved them. */
function page(saved: Record<string, { area?: Area; hidden?: boolean }>) {
  const boxes = PULSE.regions
    .map((r) => {
      const s = saved[r.id] ?? {};
      const area = s.area ?? r.area;
      const box = {
        area,
        layoutArea: r.area,
        layer: r.layer ?? 0,
        frame: false,
        hidden: !!s.hidden,
      };
      return `<button type="button" data-pick="${r.id}" data-area="${place(area)}"
        data-box='${JSON.stringify({ ...box, frame: r.id === "header" || r.id === "ticker" })}'></button>`;
    })
    .join("");
  win.document.body.innerHTML = `
    <script type="application/json" id="canccu-studio-text">${JSON.stringify(TEXT)}</script>
    <p class="canccu-studio-notice" role="status" hidden></p>
    <form data-zone='${JSON.stringify({ key: "main", layout_id: "pulse", hero_region: null, regions: {} })}'
      data-region-names='${JSON.stringify(NAMES)}' data-layout-names='{"pulse":"Pulse"}' data-layout="pulse">
      <div data-grid="12 12" data-boxes>${boxes}</div>
      <div data-hidden-boxes hidden></div>
      <ul data-changes></ul>
    </form>`;
  // studio.js as the page runs it: it puts its helpers on window.canccuStudio.
  win.eval(STUDIO_JS);
  const studio = (win as unknown as { canccuStudio: Studio }).canccuStudio;
  const form = win.document.querySelector("form") as HTMLElement;
  const list = form.querySelector("[data-changes]") as HTMLElement;
  // The zone page's part (studio-zone.js): the gap lines go under the changes.
  const editor = boxEditor(form, {
    say: studio.say,
    counted: studio.counted,
    tell: studio.show,
    changed: () => {
      list.replaceChildren(...(editor.gapLines() as HTMLElement[]));
    },
  });
  list.replaceChildren(...(editor.gapLines() as HTMLElement[]));
  return { form, list, notice: win.document.querySelector(".canccu-studio-notice") as HTMLElement };
}
const heroArea = (form: HTMLElement) =>
  (form.querySelector('[data-pick="hero"]') as HTMLElement).style.gridArea;

beforeEach(() => {
  vi.mocked(geometry.gaps).mockClear();
});

describe("a gap's warning", () => {
  it("is the shared warn notice, naming every box beside it, with Fill the gap", () => {
    const { list } = page({ hero: { area: { column: 1, row: 2, columns: 7, rows: 10 } } });
    const line = list.querySelector("li") as HTMLElement;
    expect(line.classList.contains("canccu-notice")).toBe(true);
    expect(line.classList.contains("canccu-notice--warn")).toBe(true);
    expect(line.textContent).toContain(
      "1 column between Hero and Side rail is empty, beside Venue card too",
    );
    expect(line.querySelector("[data-fill-gap]")?.textContent).toBe("Fill the gap");
  });

  it("fills, says so, and moves the focus to the next gap's button", () => {
    const { form, list, notice } = page({ ticker: { hidden: true } });
    expect(list.querySelectorAll("[data-fill-gap]")).toHaveLength(2);
    (list.querySelector("[data-fill-gap]") as HTMLButtonElement).click();
    expect(heroArea(form)).toBe("2 / 1 / span 11 / span 8");
    expect(notice.textContent).toBe("Hero now fills the gap");
    const next = list.querySelectorAll("[data-fill-gap]");
    expect(next).toHaveLength(1);
    expect(win.document.activeElement).toBe(next[0]);
  });

  it("moves the focus to the Changes list once the last gap is filled", () => {
    const { list } = page({ hero: { area: { column: 1, row: 2, columns: 7, rows: 10 } } });
    (list.querySelector("[data-fill-gap]") as HTMLButtonElement).click();
    expect(list.querySelector("[data-fill-gap]")).toBeNull();
    expect(win.document.activeElement).toBe(list);
  });

  it("does nothing for a button whose gap is gone", () => {
    const { form, list, notice } = page({
      hero: { area: { column: 1, row: 2, columns: 7, rows: 10 } },
    });
    const stale = (list.querySelector("[data-fill-gap]") as HTMLButtonElement).cloneNode(
      true,
    ) as HTMLButtonElement;
    stale.dataset.fillGap = "3";
    form.append(stale);
    expect(() => {
      stale.click();
    }).not.toThrow();
    expect(heroArea(form)).toBe("2 / 1 / span 10 / span 7");
    expect(notice.hidden).toBe(true);
  });

  it("is worked out once per draw, not again for the Changes list", () => {
    const { form } = page({});
    const pick = form.querySelector('[data-pick="hero"]') as HTMLElement;
    const narrower = win.document.createElement("button");
    narrower.dataset.size = "narrower";
    const region = win.document.createElement("section");
    region.dataset.region = "hero";
    region.append(narrower);
    form.append(region);
    vi.mocked(geometry.gaps).mockClear();
    narrower.click();
    expect(pick.style.gridArea).toBe("2 / 1 / span 10 / span 7");
    expect(geometry.gaps).toHaveBeenCalledTimes(1);
  });
});
