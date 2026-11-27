// @vitest-environment happy-dom
// The living stage (#787 D10, D12, D13; contracts/screen.md, The stage): the look cycle, the
// time of day, the hype's energy and the game's art, at each level and under reduced motion.
import { describe, expect, it } from "vitest";
import { LOOK_FADE_MS, daypartAt, lookAt } from "../src/stage-look.js";
import { StageLayer } from "../src/stage.js";
import type { StageLife } from "../src/stage.js";

const T0 = Date.parse("2026-03-14T21:10:30Z");
const ALL = ["glows", "gradient", "particles", "waves"];
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ART = `/api/screen/art/${"b".repeat(64)}.webp`;

/** Each change of look over `ms` from `from`, sampled every 10 s. */
function changes(zone: string, looks: string[], from: number, ms: number) {
  const out: { at: number; look: string }[] = [];
  let last = "";
  for (let t = from; t < from + ms; t += 10_000) {
    const { look } = lookAt(zone, looks, t, "lively");
    if (look !== last) out.push({ at: t, look });
    last = look;
  }
  return out;
}

describe("the look cycle", () => {
  it("shows the same look on two screens of a zone and after a reload", () => {
    for (let t = T0; t < T0 + 2 * 60 * MIN; t += 7 * MIN)
      expect(lookAt("main", ALL, t, "lively")).toEqual(lookAt("main", [...ALL], t, "lively"));
    const main = changes("main", ALL, T0, 60 * MIN).map((c) => c.look);
    const stage = changes("stage", ALL, T0, 60 * MIN).map((c) => c.look);
    expect(main).not.toEqual(stage);
  });

  it("holds each look 3 to 6 minutes, never the same twice in a row, and uses them all", () => {
    const seen = changes("main", ALL, Date.parse("2026-03-14T00:00:00Z"), DAY);
    for (const [i, c] of seen.entries()) {
      const next = seen[i + 1];
      if (i === 0 || next === undefined) continue;
      expect(next.at - c.at).toBeGreaterThanOrEqual(3 * MIN);
      expect(next.at - c.at).toBeLessThanOrEqual(6 * MIN + 10_000);
      expect(next.look).not.toBe(c.look);
    }
    expect(new Set(seen.map((c) => c.look))).toEqual(new Set(ALL));
  });

  it("names the look it fades from for 40 s", () => {
    const first = changes("main", ALL, T0, 30 * MIN)[1];
    if (first === undefined) throw new Error("no change in 30 minutes");
    const now = lookAt("main", ALL, first.at, "lively");
    expect(now.from).not.toBeNull();
    expect(now.from).not.toBe(now.look);
    expect(lookAt("main", ALL, now.since + LOOK_FADE_MS, "lively").from).toBeNull();
  });

  it("does not cycle with one look", () => {
    expect(changes("main", ["waves"], T0, 60 * MIN)).toEqual([{ at: T0, look: "waves" }]);
    expect(lookAt("main", ["waves"], T0, "lively").from).toBeNull();
  });

  it("leaves the particles out at none", () => {
    const looks = changes("main", ["particles", "waves", "gradient"], T0, 2 * 60 * MIN);
    expect(looks.some((c) => c.look === "particles")).toBe(true);
    for (let t = T0; t < T0 + 2 * 60 * MIN; t += MIN)
      expect(lookAt("main", ["particles", "waves", "gradient"], t, "none").look).not.toBe(
        "particles",
      );
    expect(lookAt("main", ["particles"], T0, "none").look).toBe("glows");
  });
});

describe("the time of day", () => {
  it("is morning, day or late in the event's time zone", () => {
    expect(daypartAt(Date.parse("2026-03-14T07:00:00Z"), "UTC")).toBe("morning");
    expect(daypartAt(Date.parse("2026-03-14T14:00:00Z"), "UTC")).toBe("day");
    expect(daypartAt(Date.parse("2026-03-14T20:30:00Z"), "UTC")).toBe("day");
    expect(daypartAt(Date.parse("2026-03-14T01:00:00Z"), "UTC")).toBe("late");
    expect(daypartAt(Date.parse("2026-03-14T23:30:00Z"), "UTC")).toBe("late");
    expect(daypartAt(Date.parse("2026-03-14T05:00:00Z"), "Etc/GMT-2")).toBe("morning");
    expect(daypartAt(Date.parse("2026-03-14T05:00:00Z"), "no/such_zone")).toBe("day");
  });
});

describe("the living stage", () => {
  const life = (over: Partial<StageLife> = {}): StageLife => ({
    zone: "main",
    timeZone: "UTC",
    hype: { level: 0.75, phase: "building" },
    ...over,
  });
  const draw = (
    o: { level?: "none" | "calm" | "lively" | "party"; life?: StageLife; backdrop?: object; stage?: object; now?: number } = {},
  ) => {
    document.body.innerHTML = "";
    const layer = new StageLayer(document.body);
    layer.apply(
      { phase: "peak", kind: null, tint: null, ...o.stage },
      o.level ?? "lively",
      o.now ?? T0,
      { looks: ALL, game_art: true, daylight: true, hype: true, ...o.backdrop },
      o.life ?? life(),
    );
    return document.querySelector(".canccu-stage") as HTMLElement;
  }; // prettier-ignore

  it("puts the look under every other layer, behind the boxes and the header", () => {
    const el = draw();
    const parts = [...el.children].map((c) => c.className);
    expect(parts.indexOf("canccu-stage__look")).toBeLessThan(parts.indexOf("canccu-stage__glow"));
    expect(parts.indexOf("canccu-stage__daylight")).toBeLessThan(
      parts.indexOf("canccu-stage__game"),
    );
    expect(parts.at(-1)).toBe("canccu-stage__scrim");
    expect(el.querySelector(".canccu-stage__particles")?.parentElement?.className).toBe(
      "canccu-stage__look",
    );
  });

  it("wears the look of the zone's cycle, the time of day and the hype", () => {
    const el = draw();
    const { look } = lookAt("main", ALL, T0, "lively");
    expect(el.classList).toContain(`canccu-stage--look-${look}`);
    expect(el.classList).toContain("canccu-stage--daylight-day");
    expect(el.classList).toContain("canccu-stage--hype-building");
    expect(el.style.getPropertyValue("--canccu-hype")).toBe("0.75");
  });

  it("follows the Theme studio's chips over the clock and the hype while they are posted", () => {
    document.body.dataset.canccuDaypart = "morning";
    document.body.dataset.canccuScene = "live";
    const el = draw();
    expect(el.classList).toContain("canccu-stage--daylight-morning");
    expect(el.classList).toContain("canccu-stage--hype-live");
    delete document.body.dataset.canccuDaypart;
    delete document.body.dataset.canccuScene;
  });

  it("leaves out what the theme switches off, and draws only glows for an older theming", () => {
    const off = draw({ backdrop: { daylight: false, hype: false } });
    expect([...off.classList].some((c) => c.includes("daylight") || c.includes("hype"))).toBe(
      false,
    );
    expect(off.style.getPropertyValue("--canccu-hype")).toBe("");
    document.body.innerHTML = "";
    const layer = new StageLayer(document.body);
    layer.apply({ phase: "peak" }, "lively", T0, undefined, life());
    expect(document.querySelector(".canccu-stage")?.classList).toContain(
      "canccu-stage--look-glows",
    );
  });

  it("holds an own picture still, with no cycle", () => {
    const el = draw({
      backdrop: { image_url: `/theming/a/${"c".repeat(64)}.png`, scrim: 0.7 },
    });
    expect([...el.classList].some((c) => c.startsWith("canccu-stage--look-"))).toBe(false);
  });

  it("draws more particles the higher the hype, and none at none", () => {
    const at = (level: number, motion: "none" | "lively" = "lively") =>
      draw({
        level: motion,
        backdrop: { looks: ["particles"] },
        life: life({ hype: { level, phase: "building" } }),
      }).querySelectorAll(".canccu-stage__particles > i").length;
    expect(at(0)).toBeGreaterThan(0);
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(1, "none")).toBe(0);
  });

  it("shows the game's art while the hype builds or is live, if the theme lets it", () => {
    const game = { url: ART, scrim: 0.75 };
    const shown = (phase: string, o: { game_art?: boolean } = {}) =>
      draw({
        stage: { game },
        backdrop: { game_art: o.game_art ?? true },
        life: life({ hype: { level: 0.5, phase } }),
      }).classList.contains("canccu-stage--game");
    expect(shown("building")).toBe(true);
    expect(shown("live")).toBe(true);
    expect(shown("quiet")).toBe(false);
    expect(shown("after")).toBe(false);
    expect(shown("live", { game_art: false })).toBe(false);
    const el = draw({ stage: { game }, life: life({ hype: { level: 1, phase: "live" } }) });
    expect((el.querySelector(".canccu-stage__game") as HTMLElement).style.backgroundImage).toBe(
      `url("${ART}")`,
    );
    expect(el.style.getPropertyValue("--canccu-stage-scrim")).toBe("0.75");
  });
});
