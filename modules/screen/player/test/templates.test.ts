// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, templateFor } from "../src/templates.js";
import { renderTree } from "../src/tree.js";
import type { TreeNode } from "../src/tree.js";

const draw = (nodes: readonly TreeNode[], view: Record<string, unknown>): HTMLElement => {
  const box = document.createElement("div");
  box.append(...renderTree(nodes, { qr: null, stale: false, empty: false, ...view }));
  return box;
};

// contracts/screen.md, Widgets, and the claim-only templates; `logo` is theming's.
const TYPES = [
  "clock", "agenda_now", "countdown", "hot_game", "now_playing", "bracket", "leaderboard", "photo",
  "announcement", "ticker", "food_status", "qr", "checkin_qr", "venue_info", "stats",
  "match_called", "winner_card", "sting", "logo",
]; // prettier-ignore

describe("the player's default templates", () => {
  it("has one for every widget and claim template the screen draws", () => {
    for (const type of TYPES) expect(DEFAULT_TEMPLATES[type], type).toBeInstanceOf(Array);
  });

  it("draws each widget's view-model fields", () => {
    const t = (type: string, view: Record<string, unknown>) =>
      draw(DEFAULT_TEMPLATES[type] ?? [], view).textContent;
    expect(t("clock", { time: "18:42", date: "Sat 14 Mar" })).toBe("Sat 14 Mar18:42");
    const items = [
      { name: "Dinner", state: "now", starts_text: "18:00", ends_text: "19:15", location: "Café", delay_minutes: 15 },
      { name: "Semis", state: "next", starts_text: "19:30", ends_text: null, location: null, delay_minutes: 0 },
    ]; // prettier-ignore
    const agenda = t("agenda_now", { title: "Now and next", items });
    expect(agenda).toContain("Dinner");
    expect(agenda).toContain("+15 min");
    expect(agenda).toContain("Semis");
    expect(t("ticker", { text: "Seats open 20:30." })).toBe("InfoSeats open 20:30.");
    expect(
      t("venue_info", { wifi: [{ ssid: "demo-guest", password: null, note: null }] }),
    ).toContain("demo-guest");
    expect(t("announcement", { title: "Dinner is served", body: "Café", level: "info" })).toContain(
      "Dinner is served",
    );
  });

  // contracts/screen.md, Trend arrows (#416): the direction in the class, no arrow without one.
  it("draws a trend arrow beside each statistic that has one", () => {
    const stats = draw(DEFAULT_TEMPLATES.stats ?? [], {
      members: 1240,
      online: 218,
      in_voice: 38,
      online_trend: "up",
      in_voice_trend: "down",
    });
    const trends = [...stats.querySelectorAll(".canccu-widget__trend")].map((e) => e.className);
    expect(trends).toEqual([
      "canccu-widget__trend canccu-widget__trend--up",
      "canccu-widget__trend canccu-widget__trend--down",
    ]);
    expect(stats.querySelector(".canccu-widget__big")?.textContent).toBe("1240");
    const playing = draw(DEFAULT_TEMPLATES.now_playing ?? [], {
      available: true,
      games: [
        { game_id: "g_1", name: "Demo Game", players: 41, trend: "flat" },
        { game_id: "g_2", name: "Demo Racer", players: 23 },
      ],
    });
    const rows = [...playing.querySelectorAll(".canccu-widget__row")];
    expect(rows.map((r) => r.querySelector(".canccu-widget__trend")?.className ?? null)).toEqual([
      "canccu-widget__trend canccu-widget__trend--flat",
      null,
    ]);
    // A value that is not a direction never adds a class of its own.
    const odd = draw(DEFAULT_TEMPLATES.stats ?? [], { online: 1, online_trend: "up x" });
    expect(odd.querySelector(".canccu-widget__trend")?.className).toBe(
      "canccu-widget__trend canccu-widget__trend--upx",
    );
  });

  it("puts the countdown's target in a <time> the player keeps counting", () => {
    const box = draw(DEFAULT_TEMPLATES.countdown ?? [], {
      label: "Semis start in",
      target_at: "2026-01-01T19:30:00Z",
      ends_text: null,
    });
    expect(box.textContent).toContain("Semis start in");
    expect(box.querySelector("time.canccu-widget__big")?.getAttribute("datetime")).toBe(
      "2026-01-01T19:30:00Z",
    );
  });

  it("draws the QR handoff of a widget, and a QR widget's own code", () => {
    const qr = {
      url: "https://a.test/notify/",
      label: "Schedule",
      image_url: "data:image/svg+xml;base64,QQ",
    };
    const rail = draw(DEFAULT_TEMPLATES.agenda_now ?? [], { title: "Now", items: [], qr });
    expect(rail.querySelector("img")?.getAttribute("src")).toBe(qr.image_url);
    const own = draw(DEFAULT_TEMPLATES.qr ?? [], { ...qr, qr: null });
    expect(own.querySelector("img")?.getAttribute("src")).toBe(qr.image_url);
    expect(own.textContent).toContain("Schedule");
  });

  it("draws the logo, or the event's name without one", () => {
    const logo = draw(DEFAULT_TEMPLATES.logo ?? [], {
      url: "/theming/a/l.svg",
      name: "Demo Event",
    });
    expect(logo.querySelector("img")?.getAttribute("src")).toBe("/theming/a/l.svg");
    expect(logo.textContent).toBe("Demo Event");
    expect(draw(DEFAULT_TEMPLATES.logo ?? [], { url: null, name: "Demo Event" }).textContent).toBe(
      "Demo Event",
    );
  });
});

describe("which template a widget draws with", () => {
  const theirs = [
    { name: "big_clock", widget: "clock", tree: [{ text: "big" }] },
    { name: "clock", widget: "clock", tree: [{ text: "theirs" }] },
    { name: "countdown", widget: "agenda_now", tree: [{ text: "wrong type" }] },
  ];

  it("takes the entry's template, then the theme's template named as the type, then the default", () => {
    expect(templateFor("clock", "big_clock", theirs)).toEqual([{ text: "big" }]);
    expect(templateFor("clock", null, theirs)).toEqual([{ text: "theirs" }]);
    expect(templateFor("clock", "missing", theirs)).toEqual([{ text: "theirs" }]);
    expect(templateFor("countdown", null, theirs)).toBe(DEFAULT_TEMPLATES.countdown);
    expect(templateFor("countdown", "countdown", theirs)).toBe(DEFAULT_TEMPLATES.countdown);
  });

  it("has nothing for a type it does not know", () => {
    expect(templateFor("sponsor", null, [])).toEqual([]);
    expect(templateFor("clock", null, "junk")).toBe(DEFAULT_TEMPLATES.clock);
  });
});
