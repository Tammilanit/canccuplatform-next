/// <reference lib="dom" />
/**
 * Advanced in Chromium (plan issue-784 D14–D16, pack sheet 4): every control of the table moves
 * the screen frame before its save answers, the CSS editor marks a refused line as it is typed,
 * a box look reaches the screen frame, and the hub page frame is as tall as its page.
 */
import type { Frame, Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { ADVANCED_CONTROLS } from "../src/studio-controls.js";
import { png } from "./drafting.js";
import { browser, studioSuite } from "./studio-page.js";
import { mp4 } from "./videos.js";

describe.skipIf(browser === undefined)("Advanced in Chromium", { timeout: 60_000 }, () => {
  const s = studioSuite();
  const { open, api, draft } = s;

  /** Level up · Sunset: own fonts, CSS, templates and layouts, as the customise-everything organiser has. */
  async function levelUp(): Promise<void> {
    const applied = await api("PUT", "/api/theming/draft/preset", {
      preset: "level-up",
      scheme: "sunset",
    });
    expect(applied.status).toBe(200);
  }

  async function frame(page: Page, selector: string): Promise<Frame> {
    const f = await (await page.waitForSelector(selector, { state: "attached" })).contentFrame();
    if (f === null) throw new Error(`${selector} shows no frame`);
    await f.waitForLoadState("load");
    return f;
  }
  const SCREEN = "iframe[data-screen-preview]";
  const cssVar = (f: Frame, name: string) =>
    f.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  /** Sets a value as a person's drag or pick would, with the events the browser sends. */
  const setValue = (page: Page, selector: string, value: string) =>
    page.locator(selector).evaluate((el: HTMLInputElement, v) => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);

  it("moves the screen frame with every control, then saves the tokens", async () => {
    await levelUp();
    const page = await open("/theming/studio/advanced");
    let loads = 0;
    page.on("load", () => (loads += 1));
    const screen = await frame(page, SCREEN);
    for (const c of ADVANCED_CONTROLS) {
      const before = await cssVar(screen, c.cssVar);
      const at = `[name="${c.token}"]`;
      if (c.control === "colour") {
        await setValue(page, `input${at}`, before === "#123456" ? "#654321" : "#123456");
      } else if (c.control === "slider") {
        const [min, max] = c.range ?? [0, 0];
        const now = Number(await page.locator(`input${at}`).inputValue());
        await setValue(page, `input${at}`, String(now === max ? min : max));
      } else if (c.control === "font") {
        const select = page.locator(`select${at}`);
        const other = await select.evaluate((el: HTMLSelectElement) => {
          const now = el.selectedOptions[0]?.dataset.stack;
          return [...el.options].find((o) => o.dataset.stack !== now)?.value;
        });
        expect(other, c.token).toBeDefined();
        await select.selectOption(other ?? "");
      } else {
        await page.locator(`input${at}:not(:checked)`).first().check();
      }
      await expect
        .poll(() => cssVar(screen, c.cssVar), { timeout: 5_000, message: c.token })
        .not.toBe(before);
    }
    // Saved 400 ms after the last change, in as many saves as the changes took.
    const tokens = async () =>
      (await draft()).manifest.tokens as Record<string, Record<string, string> | undefined>;
    await expect
      .poll(async () => (await tokens()).motion_style?.spotlight, { timeout: 15_000 })
      .toBeDefined();
    const saved = await tokens();
    expect(saved.sizes?.safe_inset).toMatch(/px$/);
    expect(saved.motion_style?.pack).toBeDefined();
    expect(loads).toBe(0);
  });

  it("saves a token set back to the value the page was drawn with", async () => {
    await levelUp();
    const page = await open("/theming/studio/advanced");
    const input = 'input[name="colors.primary"]';
    const first = await page.locator(input).inputValue();
    const red = first === "#ff0000" ? "#00ff00" : "#ff0000";
    const primary = async () =>
      ((await draft()).manifest.tokens as Record<string, Record<string, string>>).colors?.primary;
    await setValue(page, input, red);
    await expect.poll(primary, { timeout: 5_000 }).toBe(red);
    await setValue(page, input, first);
    await expect.poll(primary, { timeout: 5_000 }).toBe(first);
  });

  it("shows the preset's values again after Reset on Advanced", async () => {
    await levelUp();
    const page = await open("/theming/studio/advanced");
    const input = 'input[name="colors.primary"]';
    const first = await page.locator(input).inputValue();
    await setValue(page, input, first === "#ff0000" ? "#00ff00" : "#ff0000");
    await expect
      .poll(
        async () =>
          ((await draft()).manifest.tokens as Record<string, Record<string, string>>).colors
            ?.primary,
        { timeout: 5_000 },
      )
      .not.toBe(first);
    await page.locator('[data-action="reset-ask"]').click();
    await Promise.all([
      page.waitForEvent("load"),
      page.locator('#canccu-studio-reset [data-action="preset"]').click(),
    ]);
    expect(await page.locator(input).inputValue()).toBe(first);
  });

  it("cleans an own font's family to the schema's pattern before it uploads anything", async () => {
    await levelUp();
    const ctx = await s.context();
    const puts: string[] = [];
    let parts: { fonts?: { family: string }[] } | undefined;
    await ctx.route("**/api/theming/draft/file?*", async (r) => {
      puts.push(r.request().method());
      await r.fulfill({ json: { draft_version: 99, problems: [] } });
    });
    await ctx.route("**/api/theming/draft/parts", async (r) => {
      parts = r.request().postDataJSON() as typeof parts;
      await r.fulfill({ json: { draft_version: 100 } });
    });
    const page = await ctx.newPage();
    await page.goto(`${s.origin}/theming/studio/advanced`);
    await page.getByText("Add a font").click();
    const form = page.locator('form[data-action="font-add"]');
    await form.locator('input[name="font_file"]').setInputFiles({
      name: "Roboto[wght].woff2",
      mimeType: "font/woff2",
      buffer: Buffer.from("x"),
    });
    await form.locator('input[name="licence_file"]').setInputFiles({
      name: "OFL.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await form.locator("button[type=submit]").click();
    await expect.poll(() => parts?.fonts?.[0]?.family).toMatch(/^[A-Za-z0-9 _-]{1,64}$/);
    expect(puts).toEqual(["PUT", "PUT"]);
  });

  /** A file into the draft as the page uploads one. */
  async function putFile(path: string, bytes: Buffer): Promise<number> {
    const version = (await draft()).draft_version;
    const res = await fetch(
      `${s.origin}/api/theming/draft/file?path=${encodeURIComponent(path)}&draft_version=${version}`,
      {
        method: "PUT",
        headers: {
          cookie: "canccu_session=embedder",
          origin: s.origin,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
      },
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { draft_version: number }).draft_version;
  }

  /** Picks `bytes` as `name` in a form's file field and sends the form; it says why it refused. */
  async function refusedPick(page: Page, form: string, field: string, name: string) {
    const f = page.locator(`form[data-action="${form}"]`);
    await f.locator(`input[name="${field}"]`).setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("<html>not a picture</html>"),
    });
    await f.locator("button[type=submit]").click();
    await page.waitForSelector(".canccu-studio-notice:not([hidden])");
  }

  it("keeps the picture in use when a new one is refused", async () => {
    await levelUp();
    const v = await putFile("images/still.png", await png("#223344", 32));
    const set = await api("PATCH", "/api/theming/draft/parts", {
      draft_version: v,
      backdrop_image: "images/still.png",
    });
    expect(set.status).toBe(200);
    const page = await open("/theming/studio/advanced");
    await refusedPick(page, "backdrop-image", "backdrop_file", "new.png");
    const after = await draft();
    const brand = after.manifest.brand as { backdrop?: { image?: string } };
    expect(brand.backdrop?.image).toBe("images/still.png");
    expect(after.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect((after.files ?? []).map((f) => f.path)).toContain("images/still.png");
  });

  it("keeps the video in use when a new one is refused", async () => {
    await levelUp();
    await putFile("images/still.png", await png("#223344", 32));
    const v = await putFile("videos/loop.mp4", mp4());
    const set = await api("PATCH", "/api/theming/draft/parts", {
      draft_version: v,
      backdrop_image: "images/still.png",
      backdrop_video: "videos/loop.mp4",
    });
    expect(set.status).toBe(200);
    const page = await open("/theming/studio/advanced");
    await refusedPick(page, "backdrop-video", "video_file", "new.mp4");
    const after = await draft();
    const brand = after.manifest.brand as { backdrop?: { video?: string } };
    expect(brand.backdrop?.video).toBe("videos/loop.mp4");
    expect(after.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect((after.files ?? []).map((f) => f.path).filter((p) => p.startsWith("videos/"))).toEqual([
      "videos/loop.mp4",
    ]);
  });

  it("takes the video's file away with the looks cycle", async () => {
    await levelUp();
    await putFile("images/still.png", await png("#223344", 32));
    const v = await putFile("videos/loop.mp4", mp4());
    await api("PATCH", "/api/theming/draft/parts", {
      draft_version: v,
      backdrop_image: "images/still.png",
      backdrop_video: "videos/loop.mp4",
    });
    const page = await open("/theming/studio/advanced");
    await page.locator('[data-action="backdrop-cycle"]').click();
    await expect
      .poll(async () =>
        ((await draft()).files ?? []).map((f) => f.path).filter((p) => p.startsWith("videos/")),
      )
      .toEqual([]);
    const brand = (await draft()).manifest.brand as { backdrop?: { video?: string } };
    expect(brand.backdrop?.video).toBeUndefined();
  });

  it("marks a refused line of the CSS as it is typed", async () => {
    await levelUp();
    const page = await open("/theming/studio/advanced");
    const editor = page.locator("textarea.canccu-studio-editor__text");
    await editor.fill(
      ".t-flare {\n  color: var(--canccu-color-accent);\n  background: url(https://example.org/flare.png);\n}\n",
    );
    const mark = ".canccu-studio-editor__gutter li:nth-child(3).canccu-studio-editor__line--error";
    await page.waitForSelector(mark, { timeout: 1_000 });
    expect(await page.locator(".canccu-studio-editor__problems").textContent()).toContain("Line 3");
    // Only a check: nothing was stored.
    expect((await draft()).files?.map((f) => f.path)).not.toContain("css/theme.css");
  });

  it("gives the screen frame the countdown's new look", async () => {
    await levelUp();
    const ctx = await s.context();
    // One zone, drawn by a stand-in for screen's virtual screen that keeps what it is posted.
    await ctx.route("**/api/screen/zones", (r) =>
      r.fulfill({ json: { zones: [{ key: "main", name: "Main hall" }] } }),
    );
    await ctx.route("**/api/screen/zones/main/state", (r) =>
      r.fulfill({ json: { layout: { id: "main", regions: [] }, regions: [], theme: {} } }),
    );
    await ctx.route("**/screen/zones/main", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body class="canccu-surface"><script>
          addEventListener("message", (e) => {
            window.received = e.data;
            parent.postMessage({ type: "canccu-screen-preview-drawn", id: e.data.id }, location.origin);
          });</script></body>`,
      }),
    );
    const page = await ctx.newPage();
    await page.goto(`${s.origin}/theming/studio/advanced`);
    const countdownTemplate = async () => {
      const screen = await frame(page, SCREEN);
      return screen.evaluate(() => {
        const state = (
          window as unknown as { received?: { state: { theme: { layouts: unknown } } } }
        ).received?.state;
        if (state === undefined) return undefined;
        const layouts = state.theme.layouts as {
          regions: { widgets: { widget: string; template?: string }[] }[];
        }[];
        const w = layouts
          .flatMap((l) => l.regions.flatMap((r) => r.widgets))
          .find((x) => x.widget === "countdown");
        return w?.template ?? "platform";
      });
    };
    await expect.poll(countdownTemplate).toBe("xp_countdown");
    await Promise.all([
      page.waitForEvent("load"),
      page.locator('select[name="look.countdown"]').selectOption(""),
    ]);
    await expect.poll(countdownTemplate).toBe("platform");
  });

  it("sizes the hub page frame to its page, with no empty half below the cards", async () => {
    await levelUp();
    const page = await open("/theming/studio/advanced");
    const hub = await frame(page, 'iframe[data-surface="page"]');
    const height = () =>
      page
        .locator('iframe[data-surface="page"]')
        .evaluate((f: HTMLIFrameElement) => f.clientHeight);
    // The lowest box of the page, leaving out wrappers as tall as the frame.
    const content = () =>
      hub.evaluate(() =>
        Math.max(
          ...[...document.body.querySelectorAll("*")]
            .map((e) => e.getBoundingClientRect())
            .filter((r) => r.height > 0 && r.height < innerHeight - 1)
            .map((r) => r.bottom),
        ),
      );
    await expect.poll(height).toBeLessThan(800);
    const lowest = await content();
    expect(await height()).toBeGreaterThanOrEqual(Math.floor(lowest));
    expect(await height()).toBeLessThanOrEqual(Math.ceil(lowest) + 32);
  });
});
