// @vitest-environment happy-dom
/**
 * An announcement's beat (contracts/screen.md, Announcements by level, #780; D10, D11): counted
 * from `starts_at`, so a reload lands in the same beat; nothing moves at `none` (and so under
 * reduced motion); an edit restarts nothing; a withdrawn full screen gives the screen back at once.
 */
import { afterEach, describe, expect, it } from "vitest";
import { animateAnnouncements, beatAt, postedText } from "../src/announce-motion.js";
import type { ClaimState } from "../src/claims.js";
import type { Level } from "../src/motion.js";
import { Screen } from "../src/screen.js";
import type { Region } from "../src/state.js";
import { drawWidget } from "../src/widget.js";
import { screenState } from "./fake.js";

const T0 = Date.parse("2026-03-14T19:30:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: number) => T0 + s * 1000;

describe("the beat clock", () => {
  it("enters, re-emphasises every 25 s and brings the second line 12 s into each 30 s", () => {
    expect(beatAt(T0, at(0.5))).toEqual({ entering: true, reemphasis: false, secondBeat: false });
    expect(beatAt(T0, at(25.2))).toEqual({ entering: false, reemphasis: true, secondBeat: false });
    expect(beatAt(T0, at(43))).toEqual({ entering: false, reemphasis: false, secondBeat: true });
    expect(beatAt(T0, at(60))).toEqual({ entering: false, reemphasis: false, secondBeat: false });
    // A device a little behind the server's start enters too.
    expect(beatAt(T0, at(-0.3)).entering).toBe(true);
  });

  it("answers the same after a reload: it reads only the start and the time", () => {
    for (const s of [0.5, 25.2, 43, 60, 312.4])
      expect(beatAt(T0, at(s))).toEqual(beatAt(T0, at(s)));
  });

  it("says how long ago it was posted", () => {
    expect(postedText(20_000)).toBe("Posted just now");
    expect(postedText(3 * 60_000 + 5_000)).toBe("Posted 3 min ago");
    expect(postedText(65 * 60_000)).toBe("Posted 1 h 5 min ago");
  });
});

/** A claimed card in a region of the given role, as the screen draws it. */
function mount(level: string, region = "_full", more: Record<string, unknown> = {}) {
  const root = document.createElement("main");
  const section = document.createElement("section");
  section.className = `canccu-region canccu-region--${region}`;
  const box = drawWidget("announcement", null, {
    title: "Pizza is here", body: "Order 7", level, starts_at: iso(T0), expires_at: iso(at(180)),
    second_line: "Collect at the café", qr: null, ...more,
  }, null); // prettier-ignore
  box.classList.add("canccu-is-claim");
  section.append(box);
  root.append(section);
  return { root, box };
}
const has = (box: HTMLElement, cls: string) => box.classList.contains(`canccu-ann--${cls}`);
const particles = (box: HTMLElement) => box.querySelectorAll(".canccu-widget__ambient > i").length;

describe("an announcement's motion on the screen", () => {
  it("breaks Important in, dims the rest, and keeps a full screen alive", () => {
    const { root, box } = mount("important");
    animateAnnouncements(root, at(0.5), "party");
    expect(has(box, "entering")).toBe(true);
    expect(root.dataset.breakin).toBe("");
    expect(has(box, "alive")).toBe(true);
    expect(particles(box)).toBe(26);
    animateAnnouncements(root, at(25.2), "party");
    expect(has(box, "entering")).toBe(false);
    expect(root.dataset.breakin).toBeUndefined();
    expect(has(box, "reemphasis")).toBe(true);
    animateAnnouncements(root, at(43), "party");
    expect(has(box, "second")).toBe(true);
  });

  it("moves nothing at `none`: no motion class, no particles, the second line kept in place", () => {
    const { root, box } = mount("important");
    for (const s of [0.5, 25.2, 43]) {
      animateAnnouncements(root, at(s), "none");
      for (const cls of ["entering", "reemphasis", "second", "alive"])
        expect(has(box, cls)).toBe(false);
    }
    expect(box.querySelector(".canccu-widget__ambient")).toBeNull();
    expect(root.dataset.breakin).toBeUndefined();
    expect(box.querySelector(".canccu-widget__second")?.textContent).toBe("Collect at the café");
  });

  it("keeps the living details current at every level, `none` too", () => {
    const { root, box } = mount("important");
    animateAnnouncements(root, at(150), "none");
    expect(box.querySelector(".canccu-widget__posted")?.textContent).toBe("Posted 2 min ago");
    expect(box.querySelector(".canccu-widget__left")?.textContent).toBe("1 min left");
    const bar = box.querySelector<HTMLElement>(".canccu-widget__timebar");
    expect(bar?.style.getPropertyValue("--canccu-left")).toBe("0.167");
  });

  it("draws no particles at `calm`, and keeps only a full Info or Important alive", () => {
    const calm = mount("info");
    animateAnnouncements(calm.root, at(0.5), "calm");
    expect(has(calm.box, "entering")).toBe(true);
    expect(calm.root.dataset.breakin).toBeUndefined();
    // The drifting ground stays, at half pace; the particles do not.
    expect(calm.box.querySelector(".canccu-widget__ambient")).not.toBeNull();
    expect(particles(calm.box)).toBe(0);
    for (const [level, region] of [["important", "hero"], ["urgent", "_full"], ["emergency", "_full"]]) {
      const { root, box } = mount(level as string, region);
      animateAnnouncements(root, at(43), "party");
      expect(has(box, "alive"), `${String(level)} in ${String(region)}`).toBe(false);
      expect(particles(box)).toBe(0);
    }
  }); // prettier-ignore

  it("restarts nothing on a redraw in place: the phase stays, the entrance does not come back", () => {
    const { root, box } = mount("important");
    animateAnnouncements(root, at(0.5), "lively");
    const phase = box.style.getPropertyValue("--canccu-ann-since");
    // An edit: new texts in the same box, with the same start (screen.ts, redraw in place).
    const fresh = drawWidget("announcement", null, {
      title: "Pizza is here", body: "Order 8", level: "important", starts_at: iso(T0), qr: null,
    }, null); // prettier-ignore
    box.replaceChildren(...fresh.childNodes);
    box.className = `${fresh.className} canccu-is-claim canccu-is-active`;
    animateAnnouncements(root, at(40), "lively");
    expect(has(box, "entering")).toBe(false);
    expect(box.style.getPropertyValue("--canccu-ann-since")).toBe(phase);
    expect(particles(box)).toBe(14 + 12);
    // The particles drawn again carry the phase they have now, not the start's.
    const first = box.querySelector<HTMLElement>(".canccu-widget__ambient > i");
    expect(first?.style.animationDelay).toBe("-40s");
  });
});

describe("a withdrawn full screen", () => {
  let shift = 0;
  const host = { serverNow: () => at(30) + shift, reducedMotion: () => false };
  afterEach(() => {
    shift = 0;
  });

  const region = (id: string, claim: unknown = null): Region => ({
    id, role: id === "_full" ? "full" : id, area: { column: 1, row: 1, columns: 12, rows: 12 },
    layer: id === "_full" ? 10 : 0, rotation: "sequence", order: [], cycle_started_at: iso(T0),
    idle: "blank", idle_view: null, widgets: [], claim,
  }); // prettier-ignore
  const full: ClaimState = {
    override_id: "ov_1", hidden: false, role: "full", rank: 80, template: "announcement",
    content: { title: "The raffle at 21", body: "Tickets at the info desk", level: "info" },
    steps: null, sound: null, on_end: "resume", starts_at: iso(T0), ends_at: null,
    expires_at: iso(at(300)), keep_ticker: true,
  }; // prettier-ignore
  const state = (claim: unknown, level: Level) =>
    screenState({
      layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
      regions: [region("ticker"), region("_full", claim)],
      display: { motion: "lively", motion_level: level, drift: false },
    });

  it("gives the screen back at once, with no exit animation holding the takeover", () => {
    const screen = new Screen(host);
    screen.draw(state(full, "party"));
    expect(screen.root.dataset.takeover).toBe("ticker");
    screen.draw(state(null, "party"));
    expect(screen.root.dataset.takeover).toBeUndefined();
    expect(screen.root.dataset.breakin).toBeUndefined();
  });
});
