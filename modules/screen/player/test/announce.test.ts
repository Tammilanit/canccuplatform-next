// @vitest-environment happy-dom
/**
 * The announcement card by level (contracts/screen.md, Announcements by level, #780): its label
 * and icon, the source's art, the instruction band of an alarm, the second line, and the nearby
 * content of a full screen.
 */
import { describe, expect, it } from "vitest";
import { claimShown } from "../src/claims.js";
import type { ClaimState } from "../src/claims.js";
import { drawWidget, liveView } from "../src/widget.js";

const card = (view: Record<string, unknown>): HTMLElement =>
  drawWidget(
    "announcement",
    null,
    { title: "Pizza is here", body: "Order 7 · Collect at the café", starts_at: "2026-03-14T19:30:00Z", qr: null, ...view },
    null,
  ); // prettier-ignore
const textOf = (box: ParentNode, cls: string): string | null =>
  box.querySelector(`.canccu-widget__${cls}`)?.textContent ?? null;
const PNG = "data:image/png;base64,QUJD";

describe("an announcement's card by level", () => {
  it("says its level in words, never its code, with its icon", () => {
    const labels = { info: "Info", important: "Important", urgent: "Urgent", emergency: "Emergency" };
    for (const [level, label] of Object.entries(labels)) {
      expect(textOf(card({ level }), "kicker"), level).toBe(label);
    }
    expect(card({ level: "important", icon: "food" }).querySelector(".canccu-widget__icon--food")).not.toBeNull();
    // No icon, or one the player does not know: the info sign.
    expect(card({ level: "info", icon: "rocket" }).querySelector(".canccu-widget__icon--info")).not.toBeNull();
    // An alarm wears the warning sign whatever icon was picked.
    expect(card({ level: "urgent", icon: "food" }).querySelector(".canccu-widget__icon--alert")).not.toBeNull();
    expect(textOf(card({ level: "important", from_crew: true }), "kicker")).toBe("From the crew");
  }); // prettier-ignore

  it("draws the source's art: its own picture, or the look's for its kind; none on an alarm", () => {
    const food = card({ level: "important", art: { kind: "food", url: null } });
    expect(food.querySelector(".canccu-widget__ann-art--food")).not.toBeNull();
    expect(food.querySelector(".canccu-widget__art-img")).toBeNull();
    const game = card({ level: "important", art: { kind: "game", url: PNG } });
    expect(game.querySelector(".canccu-widget__ann-art--game img")?.getAttribute("src")).toBe(PNG);
    // A picture from another host is never drawn; the kind's picture stands in.
    const away = card({ level: "important", art: { kind: "game", url: "https://x.example/a.png" } });
    expect(away.querySelector(".canccu-widget__art-img")).toBeNull();
    expect(card({ level: "info", art: null }).querySelector(".canccu-widget__ann-art")).toBeNull();
    expect(card({ level: "urgent", art: { kind: "food", url: null } }).querySelector(".canccu-widget__ann-art")).toBeNull();
  }); // prettier-ignore

  it("draws the instruction band at urgent and the emergency: the ticker line, else the body", () => {
    expect(
      textOf(card({ level: "urgent", ticker_line: "Players to the stage" }), "instruction"),
    ).toBe("Players to the stage");
    expect(
      textOf(card({ level: "emergency", body: "Follow the exit signs." }), "instruction"),
    ).toBe("Follow the exit signs.");
    // The band says where its text came from, so a body it carries is not drawn twice.
    expect(
      card({ level: "emergency" }).querySelector(".canccu-widget__band-from--body"),
    ).not.toBeNull();
    expect(
      card({ level: "urgent", ticker_line: "x" }).querySelector(".canccu-widget__band-from--line"),
    ).not.toBeNull();
    expect(card({ level: "info" }).querySelector("[class*=band-from]")).toBeNull();
    expect(card({ level: "info" }).querySelector(".canccu-widget__instruction")).toBeNull();
    expect(card({ level: "important" }).querySelector(".canccu-widget__instruction")).toBeNull();
  });

  it("carries the second beat's line and the living details, but not on an alarm", () => {
    const important = card({
      level: "important",
      second_line: "Collect at the café",
      expires_at: "2026-03-14T19:33:00Z",
      countdown_at: "2026-03-14T20:00:00Z",
    });
    expect(textOf(important, "second")).toBe("Collect at the café");
    expect(important.querySelector("time.canccu-widget__posted")?.getAttribute("datetime")).toBe(
      "2026-03-14T19:30:00Z",
    );
    expect(important.querySelector("time.canccu-widget__left")?.getAttribute("datetime")).toBe(
      "2026-03-14T19:33:00Z",
    );
    expect(important.querySelector(".canccu-widget__countdown time")?.getAttribute("datetime")).toBe(
      "2026-03-14T20:00:00Z",
    );
    expect(card({ level: "urgent", second_line: "x" }).querySelector(".canccu-widget__second")).toBeNull();
    expect(card({ level: "info", countdown_at: null }).querySelector(".canccu-widget__countdown")).toBeNull();
  }); // prettier-ignore

  it("keeps label, title and body in one block, so they share one left edge", () => {
    const box = card({ level: "important" });
    const block = box.querySelector(".canccu-widget__level--important");
    for (const part of ["kicker", "title", "body", "details"]) {
      expect(block?.querySelector(`:scope > .canccu-widget__${part}`), part).not.toBeNull();
    }
  });
});

describe("a full screen's nearby content", () => {
  const aside = {
    widget: "agenda_now",
    view: { items: [{ name: "Semis", state: "next", starts_text: "20:00" }], qr: null, stale: false, empty: false },
  }; // prettier-ignore

  it("draws the clock, the composed widget and the QR to the details beside the card", () => {
    const view = liveView("announcement", { level: "important", aside }, Date.parse("2026-03-14T19:31:00Z"), "UTC");
    const box = card({ ...view, qr: { url: "https://demo.example/pizza/orders/o_7", label: "Your order", image_url: PNG } });
    const column = box.querySelector(":scope > .canccu-widget__aside");
    expect(column?.querySelector(".canccu-widget--clock")?.textContent).toContain("19:31");
    expect(column?.querySelector(".canccu-widget--agenda_now")?.textContent).toContain("Semis");
    expect(column?.querySelector(".canccu-widget__caption")?.textContent).toBe("Your order");
  }); // prettier-ignore

  it("is absent from a claim Screen gave none", () => {
    expect(card({ level: "important" }).querySelector(".canccu-widget__aside")).toBeNull();
    expect(liveView("announcement", { level: "info" }, 0, "UTC")).not.toHaveProperty("aside_clock");
  });

  it("rides from the claim into the card's view", () => {
    const claim: ClaimState = {
      override_id: "ov_1", hidden: false, role: "full", rank: 80, template: "announcement",
      content: { title: "Pizza is here", body: "", level: "important" }, steps: null, sound: null,
      on_end: "resume", starts_at: "2026-03-14T19:30:00Z", ends_at: null, expires_at: null, aside,
    }; // prettier-ignore
    expect(claimShown(claim, Date.parse("2026-03-14T19:31:00Z"))?.view.aside).toEqual(aside);
    const plain: ClaimState = { ...claim, aside: undefined };
    expect(claimShown(plain, Date.parse("2026-03-14T19:31:00Z"))?.view).not.toHaveProperty("aside");
  });
});
