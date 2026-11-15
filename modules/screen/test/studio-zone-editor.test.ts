// @vitest-environment happy-dom
/**
 * The zone editor as the browser runs it (static/studio-zone.js and studio-layout.js, #540), on
 * the page the server draws (src/studio/zone-views.ts), with studio.js's real helpers and strings:
 * a drag that moved nothing, the region map once a box lists nothing, the photo wall's seconds, a
 * zone whose layout is gone, a handle drag the browser cancels, and a hidden hero box.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Element, HTMLElement, HTMLInputElement, Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import { CLIENT_KEYS, translator } from "../src/studio/messages.js";
import type { ViewContext } from "../src/studio/views.js";
import { zoneEditorView, type Zone } from "../src/studio/zone-views.js";

// The environment's globals, typed by happy-dom: this module's compiler has no DOM library.
const win = globalThis as unknown as Window;
const { document } = win;
const t = translator("en");
const STUDIO_JS = readFileSync(join(import.meta.dirname, "../static/studio.js"), "utf8");
// A plain script has no types, so the path stays a value rather than a module to look up.
const SCRIPT = "../static/studio-zone.js";
const c: ViewContext = {
  t,
  rights: new Set(["screen.zones.write"]),
  nowMs: 0,
  timeZone: "UTC",
  startUrl: null,
};

const zone = (extra: Partial<Zone> = {}): Zone => ({
  key: "main",
  name: "Main",
  layout_id: "pulse",
  regions: {},
  header: null,
  hub_qr: "always",
  screen_name: "auto",
  hero_region: null,
  grow_for_showcase: false,
  motion_level: null,
  sound: { enabled: false, device_id: null },
  revision: 3,
  ...extra,
});

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

/** The zone page with its scripts run, as a browser loads it. */
async function open(z: Zone) {
  const text = JSON.stringify(Object.fromEntries(CLIENT_KEYS.map((k) => [k, t(k)])));
  document.body.innerHTML = `<script type="application/json" id="canccu-studio-text">${text}</script>
    <p class="canccu-studio-notice" role="status" hidden></p>
    ${String(zoneEditorView(c, z, BUILT_IN_LAYOUTS, [], [z])).replace(/<iframe[^>]*><\/iframe>/g, "")}`;
  win.eval(STUDIO_JS);
  const calls: Call[] = [];
  // studio-zone.js takes the helpers as it starts, so they are replaced before it runs.
  Object.assign((win as unknown as { canccuStudio: object }).canccuStudio, {
    api: (method: string, url: string, body: Record<string, unknown>) => {
      // The running previews' notice reads them as the page opens (studio-screen-preview.js).
      if (method === "GET")
        return Promise.resolve({ ok: true, status: 200, data: { previews: [] } });
      calls.push({ method, url, body });
      return Promise.resolve({ ok: true, status: 200, data: { revision: z.revision + 1 } });
    },
    reloadWith: vi.fn(),
  });
  vi.resetModules();
  await import(/* @vite-ignore */ SCRIPT);
  const form = document.querySelector("form[data-zone]") as HTMLElement;
  return {
    form,
    calls,
    notice: document.querySelector(".canccu-studio-notice") as HTMLElement,
    region: (id: string) => form.querySelector(`[data-region="${id}"]`) as HTMLElement,
    changes: () =>
      [...form.querySelectorAll("[data-changes] li")].map((li) => li.textContent.trim()),
    submit: async () => {
      form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  win.sessionStorage.clear();
});

// happy-dom's DragEvent drops the `dataTransfer` and `clientY` passed to it, so the event carries
// its own; the rows measure 0 high, so the pointer is below the middle of the row it is over.
function drag(target: Element, type: string): void {
  const event = new win.DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "none" } });
  Object.defineProperty(event, "clientY", { value: 1 });
  target.dispatchEvent(event);
}
const layoutWidgets = (region: HTMLElement) =>
  (region.querySelector("[name=layout_widgets]") as HTMLInputElement).checked;

describe("a drag of a widget row", () => {
  it("that moved nothing keeps the box on the layout's widgets", async () => {
    const { region, form } = await open(zone());
    const row = region("rail").querySelector("[data-widgets] li") as HTMLElement;
    drag(row, "dragstart");
    drag(row, "dragend");
    expect(layoutWidgets(region("rail"))).toBe(true);
    expect((form.querySelector("[data-save]") as HTMLInputElement).disabled).toBe(true);
  });

  it("that changed the order makes the widgets the box's own", async () => {
    const { region, changes } = await open(zone());
    const [first, second] = [...region("rail").querySelectorAll("[data-widgets] li")];
    drag(first as HTMLElement, "dragstart");
    drag(second as HTMLElement, "dragover");
    drag(first as HTMLElement, "dragend");
    expect(layoutWidgets(region("rail"))).toBe(false);
    expect(changes()).toContain(t("change.order", { region: "Side rail" }));
  });
});

describe("the region map", () => {
  it("says Nothing once the last widget of a box is removed", async () => {
    const { form, region } = await open(zone());
    const shows = () =>
      form.querySelector('[data-pick="rail"] [data-shows]')?.textContent.trim() ?? "";
    expect(shows()).not.toBe(t("zone.region_empty"));
    for (const remove of region("rail").querySelectorAll('[data-widget-move="remove"]'))
      (remove as HTMLElement).click();
    expect(shows()).toBe(t("zone.region_empty"));
  });
});

describe("the photo wall's seconds", () => {
  const seconds = (region: HTMLElement, value: string) => {
    const input = region.querySelector("[name=photo_seconds]") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  };

  for (const bad of ["7.5", "4", "61"]) {
    it(`refuses ${bad}: nothing is saved or previewed, and the notice says why`, async () => {
      const { region, calls, submit, notice, form } = await open(zone());
      seconds(region("hero"), bad);
      await submit();
      (form.querySelector("[data-zone-preview]") as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toEqual([]);
      expect(notice.textContent).toBe(t("photo_wall.seconds_invalid"));
    });
  }

  it("saves a whole number from 5 to 60 on the box's photo entry", async () => {
    const { region, calls, submit } = await open(zone());
    seconds(region("hero"), "12");
    await submit();
    expect(calls).toHaveLength(1);
    const regions = calls[0]?.body.regions as Record<
      string,
      { widgets: Record<string, unknown>[] }
    >;
    expect(regions.hero?.widgets.find((w) => w.widget === "photo")).toEqual({
      widget: "photo",
      props: { photo_seconds: 12 },
    });
  });
});

describe("a zone whose layout is gone", () => {
  const stale = zone({
    layout_id: "gone",
    regions: {
      hero: { area: { column: 1, row: 2, columns: 6, rows: 10 } },
      rail: { hidden: true },
    },
  });

  it("draws the Pulse's boxes, not the old layout's sizes and hidden boxes, and says so", async () => {
    const { form } = await open(stale);
    const box = (id: string) =>
      form.querySelector(`[data-boxes] [data-pick="${id}"]`) as HTMLElement;
    expect(box("hero").style.gridArea).toBe("2 / 1 / span 10 / span 8");
    expect(box("rail").hidden).toBe(false);
    expect(form.querySelectorAll("[data-fill-gap]")).toHaveLength(0);
    expect(document.body.textContent).toContain(t("zone.layout_missing", { layout: "gone" }));
  });

  it("saves without them", async () => {
    const { form, calls, submit } = await open(stale);
    const name = form.querySelector("[name=name]") as HTMLInputElement;
    name.value = "Main hall";
    name.dispatchEvent(new win.Event("input", { bubbles: true }));
    await submit();
    expect(calls[0]?.body.regions).toEqual({});
  });
});

describe("a handle drag", () => {
  for (const end of ["pointercancel", "lostpointercapture"]) {
    it(`stops at ${end}: a later pointer move resizes nothing`, async () => {
      const { form } = await open(zone());
      const map = form.querySelector("[data-boxes]") as HTMLElement;
      map.getBoundingClientRect = () => new win.DOMRect(0, 0, 120, 120);
      const hero = map.querySelector('[data-pick="hero"]') as HTMLElement;
      const handle = hero.querySelector('[data-edge="right"]') as HTMLElement;
      handle.setPointerCapture = () => undefined;
      const pointer = (type: string, clientX: number) =>
        handle.dispatchEvent(new win.PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }));
      pointer("pointerdown", 80);
      pointer("pointermove", 70);
      expect(hero.style.gridArea).toBe("2 / 1 / span 10 / span 7");
      pointer(end, 70);
      pointer("pointermove", 50);
      expect(hero.style.gridArea).toBe("2 / 1 / span 10 / span 7");
    });
  }
});

describe("hiding the box that holds the hero role", () => {
  it("gives the role back to Hero, on the card, in Changes and in what is saved", async () => {
    const { form, region, changes, calls, submit } = await open(
      zone({ layout_id: "dashboard", hero_region: "online" }),
    );
    const hide = region("online").querySelector("[data-box-hide]") as HTMLInputElement;
    hide.checked = true;
    hide.dispatchEvent(new win.Event("change", { bubbles: true }));
    const pressed = (id: string) =>
      form.querySelector(`[data-hero="${id}"]`)?.getAttribute("aria-pressed");
    expect(pressed("hero")).toBe("true");
    expect(pressed("online")).toBe("false");
    expect(changes()).toContain(t("change.hero", { from: "Online", to: "Hero" }));
    await submit();
    expect(calls[0]?.body.hero_region).toBeNull();
  });
});
