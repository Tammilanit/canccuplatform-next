// @vitest-environment happy-dom
// The two backgrounds on the device (contracts/theming.md, The two backgrounds): the stage's
// classes and art at each level and over time, the card's art and veil, and the Pulse hero.
import { describe, expect, it } from "vitest";
import { StageLayer, mountBehindStage, stageLook } from "../src/stage.js";
import { DEFAULT_TEMPLATES } from "../src/templates.js";
import { renderTree } from "../src/tree.js";
import { drawWidget } from "../src/widget.js";

const T0 = Date.parse("2026-03-14T21:10:30Z");
const ART = `/api/screen/art/${"a".repeat(64)}.webp`;
const stage = {
  phase: "peak",
  kind: "tournament",
  tint: { until: new Date(T0 + 30_000).toISOString(), art: { url: ART, scrim: 0.7 } },
};

describe("the stage", () => {
  it("wears the kind and phase always, and a box's tint with its art only at lively and party", () => {
    expect(stageLook(stage, "lively", T0)).toEqual({
      classes: [
        "canccu-stage",
        "canccu-stage--kind-tournament",
        "canccu-stage--phase-peak",
        "canccu-stage--tinted",
        "canccu-stage--art",
      ],
      art: { url: ART, scrim: 0.7 },
    });
    expect(stageLook(stage, "party", T0).art).not.toBeNull();
    for (const level of ["none", "calm"] as const) {
      expect(stageLook(stage, level, T0)).toEqual({
        classes: ["canccu-stage", "canccu-stage--kind-tournament", "canccu-stage--phase-peak"],
        art: null,
      });
    }
  });

  it("ends the tint at its until by the screen's own clock", () => {
    expect(stageLook(stage, "lively", T0 + 29_999).classes).toContain("canccu-stage--tinted");
    expect(stageLook(stage, "lively", T0 + 30_000).classes).not.toContain("canccu-stage--tinted");
  });

  it("keeps the tint's colours without art, and refuses art from anywhere else", () => {
    const noArt = { ...stage, tint: { ...stage.tint, art: null } };
    expect(stageLook(noArt, "lively", T0).classes).toContain("canccu-stage--tinted");
    expect(stageLook(noArt, "lively", T0).art).toBeNull();
    const elsewhere = { ...stage, tint: { ...stage.tint, art: { url: "https://x.example/a.webp", scrim: 0.7 } } };
    expect(stageLook(elsewhere, "lively", T0).classes).not.toContain("canccu-stage--art");
  }); // prettier-ignore

  it("leaves a class out for a key no class may carry, and draws only glows for an older server", () => {
    expect(stageLook({ kind: "a b", phase: "Peak" }, "lively", T0).classes).toEqual([
      "canccu-stage",
    ]);
    expect(stageLook(undefined, "party", T0).classes).toEqual(["canccu-stage"]);
  });

  it("puts one stage with its six layers first in the body, and sets the art and scrim", () => {
    const layer = new StageLayer(document.body);
    document.body.append(document.createElement("main"));
    layer.apply(stage, "lively", T0);
    layer.apply(stage, "lively", T0 + 1000);
    const el = document.body.firstElementChild as HTMLElement;
    expect(document.querySelectorAll(".canccu-stage")).toHaveLength(1);
    expect([...el.children].map((c) => c.className)).toEqual(
      ["art", "glow", "kind", "phase", "tint", "scrim"].map((l) => `canccu-stage__${l}`),
    );
    expect((el.firstElementChild as HTMLElement).style.backgroundImage).toContain(ART);
    expect(el.style.getPropertyValue("--canccu-stage-scrim")).toBe("0.7");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the card's background", () => {
  it("draws the art first under the box's content with its veil", () => {
    const el = drawWidget("hot_game", null, {
      game: { id: "g_1", name: "Demo Game", cover_url: "/games/covers/g_1.webp" },
      players: 14,
      card_art: { url: "/games/covers/g_1.webp", veil: 0.75 },
    }, undefined); // prettier-ignore
    const art = el.firstElementChild as HTMLElement;
    expect(art.className).toBe("canccu-widget__art");
    expect(art.style.backgroundImage).toContain("/games/covers/g_1.webp");
    expect(art.style.getPropertyValue("--canccu-card-veil")).toBe("0.75");
  });

  it("draws no art without card_art, or for an image on another host", () => {
    expect(drawWidget("hot_game", null, { players: 1 }, undefined).querySelector(".canccu-widget__art")).toBeNull();
    const other = drawWidget("hot_game", null, { card_art: { url: "//x.example/a.png", veil: 0.6 } }, undefined);
    expect(other.querySelector(".canccu-widget__art")).toBeNull();
  }); // prettier-ignore
});

describe("the Pulse hero", () => {
  const draw = (view: Record<string, unknown>): HTMLElement => {
    const box = document.createElement("div");
    box.append(...renderTree(DEFAULT_TEMPLATES.countdown ?? [], { qr: null, stale: false, empty: false, ...view }));
    return box;
  }; // prettier-ignore
  const text = (box: ParentNode, cls: string) =>
    box.querySelector(`.canccu-widget__${cls}`)?.textContent ?? null;

  it("shows the game's band, teams left, the description and the chip of what starts first", () => {
    const box = draw({
      label: "Demo Game Cup grand final",
      target_at: "2026-03-14T21:15:00Z",
      starts_text: "21:15",
      location: "Stage",
      teams_left: 8,
      description: "Bring your own headset.",
      game: { id: "g_1", name: "Demo Game", cover_url: "/games/covers/g_1.webp" },
      chip: { label: "Semis", target_at: "2026-03-14T20:00:00Z" },
    });
    expect(text(box, "kicker")).toBe("Tonight on stage");
    expect(box.querySelector(".canccu-widget__band-image")?.getAttribute("src")).toBe("/games/covers/g_1.webp");
    expect(text(box, "band-name")).toBe("Demo Game");
    expect(text(box, "teams")).toBe("8 teams left");
    expect(text(box, "description")).toBe("Bring your own headset.");
    expect(text(box, "chip-label")).toBe("Semis starts in");
    expect(box.querySelector(".canccu-widget__chip-time")?.getAttribute("datetime")).toBe("2026-03-14T20:00:00Z");
  }); // prettier-ignore

  it("draws no game band, chip or teams while the view has none", () => {
    const box = draw({ label: "Dinner", target_at: "2026-03-14T19:00:00Z", game: null, chip: null, description: null, next_up: true });
    expect(text(box, "kicker")).toBe("Next on stage");
    for (const part of ["band-image", "band-name", "chip", "teams", "description"]) expect(text(box, part)).toBeNull();
  }); // prettier-ignore

  // v8 rule 5 (docs/design/README.md, "No half-empty large panel"): without the game's art, the
  // theme's own art takes the band, so the large panel is never empty below the title.
  it("puts the theme's band in place of the game's art when the item has none", () => {
    const themed = (view: Record<string, unknown>) =>
      draw({ label: "Semis", target_at: "2026-03-14T19:00:00Z", ...view }).querySelector(".canccu-widget__band--theme");
    for (const game of [null, undefined, { id: "g_1", name: "Demo Game", cover_url: null }]) {
      const band = themed({ game });
      expect(band, JSON.stringify(game)).not.toBeNull();
      expect(band?.classList.contains("canccu-widget__band")).toBe(true);
      expect(band?.getAttribute("aria-hidden")).toBe("true");
      expect(band?.childElementCount).toBe(0);
    }
    expect(themed({ game: { id: "g_1", name: "Demo Game", cover_url: "/games/covers/g_1.webp" } })).toBeNull();
  }); // prettier-ignore

  it("gives a showcased announcement the theme's band too", () => {
    const box = document.createElement("div");
    box.append(...renderTree(DEFAULT_TEMPLATES.announcement ?? [], { qr: null, stale: false, empty: false, title: "Grand final on stage", body: "Seats open 20:30", level: "info" }));
    expect(box.firstElementChild?.className).toBe("canccu-widget__band canccu-widget__band--theme");
    expect(text(box, "title")).toBe("Grand final on stage");
  }); // prettier-ignore
});

describe("mounting a screen behind the stage", () => {
  it("keeps the stage first and the marks after the screen, and leaves a mounted screen in place", () => {
    const el = (cls: string) => Object.assign(document.createElement("div"), { className: cls });
    const body = document.createElement("div");
    const [stageEl, mark, old, screen] = [el("canccu-stage"), el("canccu-mark"), el("old"), el("new")];
    body.append(old, mark, stageEl);
    expect(mountBehindStage(body, screen, ".canccu-mark")).toBe(true);
    expect([...body.children]).toEqual([stageEl, screen, mark]);
    expect(mountBehindStage(body, screen, ".canccu-mark")).toBe(false);
    expect([...body.children]).toEqual([stageEl, screen, mark]);
    // Without a stage the screen is simply first.
    const bare = document.createElement("div");
    bare.append(old);
    expect(mountBehindStage(bare, screen, ".canccu-mark")).toBe(true);
    expect([...bare.children]).toEqual([screen]);
  }); // prettier-ignore
});

describe("the stage on the kiosk's page", () => {
  it("stays first in the body, behind a screen the player keeps between ticks", async () => {
    const { vi } = await import("vitest");
    const { Player } = await import("../src/player.js");
    const { FakeApi, fakeNav, json, screenState } = await import("./fake.js");
    vi.useFakeTimers({ now: T0 });
    try {
      document.body.replaceChildren();
      const state = screenState({});
      const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, state));
      const player = new Player({ fetch: api.fetch, nav: fakeNav(), root: document.body, bundle: "1.0.0" });
      await player.start();
      await vi.advanceTimersByTimeAsync(3000);
      const [stageEl, screen] = [...document.body.children];
      expect(stageEl?.className).toMatch(/^canccu-stage\b/);
      expect(screen?.matches(".canccu-layout")).toBe(true);
      // A new state for the same layout: the screen is kept, not mounted again behind a new stage.
      player.settle({ status: 200, body: { ...state, state_version: 2 } } as never);
      await vi.advanceTimersByTimeAsync(3000);
      // The same elements: mounting the screen again would restart its fades.
      expect(document.body.children[0]).toBe(stageEl);
      expect(document.body.children[1]).toBe(screen);
      player.live.stop();
    } finally {
      vi.useRealTimers();
    }
  }); // prettier-ignore
});

describe("the promoted hot game (sheet 15)", () => {
  it("says since when the game surges, in the event's time zone, as a widget and as a claim", async () => {
    const { Screen } = await import("../src/screen.js");
    const { screenState } = await import("./fake.js");
    const since = new Date(T0 - 600_000).toISOString(); // 21:00:30 UTC, 23:00 in Helsinki
    const hot = { game: { name: "Demo Game", cover_url: null }, players: 14, since, qr: null, stale: false, empty: false };
    const region = (over: Record<string, unknown>) => ({
      id: "hero", role: "hero", area: { column: 1, row: 1, columns: 6, rows: 6 }, layer: 0,
      rotation: "sequence", order: [0], cycle_started_at: new Date(T0).toISOString(), idle: "logo",
      idle_view: null, widgets: [], claim: null, ...over,
    });
    const claim = {
      override_id: "ov_1", hidden: false, role: "hero", rank: 80, template: "hot_game", content: hot,
      steps: null, sound: null, on_end: "resume", starts_at: new Date(T0 - 1000).toISOString(),
      ends_at: null, expires_at: null,
    };
    const host = { serverNow: () => T0, reducedMotion: () => true };
    const surging = (r: Record<string, unknown>) => {
      const s = screenState({
        tenant: { id: "alpha", name: "Demo Event", time_zone: "Europe/Helsinki", status: "live" },
        layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
        regions: [region(r)],
        display: { motion: "none", drift: false },
      });
      return new Screen(host).draw(s).querySelector(".canccu-widget--hot_game .canccu-widget__since")?.textContent;
    };
    const asWidget = { widgets: [{ widget: "hot_game", template: null, dwell_seconds: 10, view: hot }] };
    expect(surging(asWidget)).toBe("surging since 23:00");
    expect(surging({ claim })).toBe("surging since 23:00");
  }); // prettier-ignore

  it("leaves the line out without a since", () => {
    const box = document.createElement("div");
    box.append(
      ...renderTree(DEFAULT_TEMPLATES.hot_game ?? [], { game: { name: "Demo Game" }, players: 14 }),
    );
    expect(box.querySelector(".canccu-widget__since")).toBeNull();
  });
});
