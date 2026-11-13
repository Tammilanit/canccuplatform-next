import { describe, expect, it } from "vitest";
import { html } from "../src/html.js";
import {
  barFor,
  dateRange,
  emptyState,
  errorView,
  frontPage,
  menuFor,
  notice,
  shellPage,
  timeLabel,
  type EventInfo,
} from "../src/shell.js";

const s = (h: { toString(): string }): string => h.toString();
const EVENT: EventInfo = {
  name: "Demo <Event>",
  status: "live",
  timeZone: "UTC",
  startsAt: "2026-03-14T08:00:00Z",
  endsAt: "2026-03-15T16:00:00Z",
  venue: "Demo Venue",
};
const NOW = new Date("2026-03-14T18:42:00Z");
const ORGANISER = { userName: "Demo Organiser", rights: new Set(["theming.theme.write"]) };

describe("menuFor", () => {
  it("lists only the pages the rights open and drops empty groups", () => {
    const groups = menuFor(new Set(["agenda.crew.read", "admin.settings.read"]));
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Run the event", ["agenda"]],
      ["Admin", ["settings", "health"]],
    ]);
  });
});

describe("barFor", () => {
  it("puts Quick add in the middle of five slots for an organiser", () => {
    const all = new Set(["agenda.items.write", "notify.topics.write", "screen.devices.read"]);
    expect(barFor(all).map((b) => b.label)).toEqual([
      "Run of show",
      "Notifications",
      "Quick add",
      "Screens",
    ]);
  });
  it("gives fewer slots for fewer rights", () => {
    expect(barFor(new Set(["agenda.crew.read"])).map((b) => b.id)).toEqual(["agenda"]);
  });
});

describe("shellPage", () => {
  const doc = s(
    shellPage({
      title: "Theme",
      current: "theme",
      event: EVENT,
      session: ORGANISER,
      tabs: [
        { href: "/theming/studio/", label: "Brand kit", current: true },
        { href: "/theming/studio/history", label: "History" },
      ],
      body: html`<p>body</p>`,
      now: NOW,
    }),
  );

  it("is phone-ready and escapes the event's name", () => {
    expect(doc).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(doc).toContain("Demo &lt;Event&gt;");
    expect(doc).not.toContain("Demo <Event>");
  });
  it("marks the current page in the menu and the tabs", () => {
    expect(doc).toMatch(
      /<a class="canccu-menu__item[^"]*" href="\/theming\/studio\/" aria-current="page">/,
    );
    expect(doc).toMatch(/href="\/theming\/studio\/" aria-current="page">Brand kit/);
    expect(doc).not.toContain("/agenda/");
  });
  it("shows who is signed in and signs out by POST", () => {
    expect(doc).toContain("Demo Organiser");
    expect(doc).toContain('<form method="post" action="/admin/sign-out">');
  });
  it("shows the event's dates, state and clock with its zone", () => {
    expect(doc).toContain("Sat 14 – Sun 15 Mar");
    expect(doc).toContain('canccu-badge canccu-badge--ok">Live');
    expect(doc).toMatch(/class="canccu-clock"[^>]*>18:42<small>UTC<\/small>/);
  });
  it("has no clock before the event starts", () => {
    const early = s(
      shellPage({ title: "x", event: EVENT, body: "", now: new Date("2026-03-13T12:00:00Z") }),
    );
    expect(early).toContain("Starts Sat");
    expect(early).not.toContain("canccu-clock");
  });
  it("leaves out of More what the bar shows", () => {
    const writer = {
      userName: "W",
      rights: new Set(["agenda.items.write", "admin.settings.read"]),
    };
    const page = s(shellPage({ title: "x", event: EVENT, session: writer, body: "" }));
    expect(page).toContain('class="canccu-menu__item canccu-menu__item--bar" href="/agenda/"');
    expect(page).toContain('class="canccu-menu__item" href="/admin/settings"');
    expect(page).toContain("Sat 14 – Sun 15 Mar · Demo Venue");
  });
  it("offers Quick add only with the right to add", () => {
    expect(doc).not.toContain("Quick add");
    const writer = { userName: "W", rights: new Set(["agenda.items.write"]) };
    const other = s(shellPage({ title: "x", current: "agenda", session: writer, body: "" }));
    expect(other).toContain('href="/agenda/add"');
  });
  it("marks an archived event with a badge and a banner", () => {
    const archived = s(
      shellPage({
        title: "x",
        event: { ...EVENT, status: "archived" },
        session: ORGANISER,
        body: "",
      }),
    );
    expect(archived).toContain(">Archived<");
    expect(archived).toContain("canccu-banner");
  });
  it("leaves Quick add out of the bar of an archived event", () => {
    const writer = { userName: "W", rights: new Set(["agenda.items.write"]) };
    const event = { ...EVENT, status: "archived" as const };
    const archived = s(shellPage({ title: "x", event, session: writer, body: "" }));
    expect(archived).not.toContain('href="/agenda/add"');
    expect(archived).toContain('href="/agenda/"');
  });
  it("shows the event's logo, which is its initials without one (theming's /theming/logo)", () => {
    expect(doc).toContain(
      '<header class="canccu-header"><img class="canccu-header__logo" src="/theming/logo" alt="">',
    );
    const bare = s(shellPage({ title: "x", body: "" }));
    expect(bare).not.toContain("canccu-header__logo");
  });
  it("shows three sub-page tabs on a phone and the rest behind a count", () => {
    const tabs = ["Live", "Devices", "Zones", "Schedule", "Content", "Ticker"].map((label) => ({
      href: `/s/${label}`,
      label,
      current: label === "Content",
    }));
    const page = s(shellPage({ title: "Studio", session: ORGANISER, tabs, body: "" }));
    const nav = /<nav class="canccu-tabs".*?<\/nav>/.exec(page)?.[0] ?? "";
    // The current tab stays among the three a phone shows.
    for (const shown of ["Live", "Devices", "Content"]) {
      expect(nav).toMatch(new RegExp(`<a href="/s/${shown}"[^>]*>${shown}</a>`));
    }
    for (const extra of ["Zones", "Schedule", "Ticker"]) {
      expect(nav).toContain(`<a class="canccu-tabs__extra" href="/s/${extra}">${extra}</a>`);
    }
    expect(nav).toContain('popovertarget="canccu-tabs-more">3 more</button>');
    const more = nav.slice(nav.indexOf('id="canccu-tabs-more"'));
    expect(more).toContain('<a href="/s/Zones">Zones</a>');
    const two = s(shellPage({ title: "x", session: ORGANISER, tabs: tabs.slice(0, 3), body: "" }));
    expect(two).not.toContain("canccu-tabs__more");
  });
});

describe("errorView", () => {
  it("never shows the right a page needs", () => {
    const view = s(
      errorView(
        { status: 403, code: "missing_right", message: "needs right theming.theme.write" },
        {
          session: ORGANISER,
          page: "the Theme studio",
          event: "Demo Event",
        },
      ),
    );
    expect(view).toContain("No access");
    expect(view).toContain("doesn&#39;t include the Theme studio");
    expect(view).not.toContain("theming.theme.write");
  });
  it.each([
    [404, "not_found", "Not found"],
    [403, "admin_access_restricted", "Not at the venue"],
    [409, "event_archived", "Event archived"],
    [503, "tenants_unavailable", "Something went wrong"],
  ])("%i %s is %s", (status, code, title) => {
    const view = s(errorView({ status, code, message: "raw detail" }, { session: ORGANISER }));
    expect(view).toContain(title);
    expect(view).not.toContain("raw detail");
  });
  it("says a refused change in the module's own words", () => {
    const view = s(
      errorView({ status: 400, code: "invalid_request", message: "Pick a colour." }, {}),
    );
    expect(view).toContain("Couldn&#39;t do that");
    expect(view).toContain("Pick a colour.");
  });
});

describe("parts", () => {
  it("empty state and notice", () => {
    expect(
      s(
        emptyState({
          icon: "calendar",
          title: "Nothing yet",
          text: "Add one.",
          action: html`<a>Add</a>`,
        }),
      ),
    ).toMatchSnapshot();
    expect(s(notice({ kind: "ok", title: "Saved", text: "Applies now." }))).toMatchSnapshot();
  });
  it("front page", () => {
    expect(
      s(frontPage({ title: "Sign in", event: EVENT, card: html`<h1>Sign in</h1>`, now: NOW })),
    ).toContain(
      '<div class="canccu-poster"><img class="canccu-poster__logo" src="/theming/logo" alt=""><div class="canccu-poster__name">Demo &lt;Event&gt;',
    );
  });
});

describe("time", () => {
  it("is 24-hour in the event's zone", () => {
    expect(timeLabel("2026-03-14T18:42:00Z", "Europe/Helsinki")).toBe("20:42");
  });
  it("names both days of a range in one month once", () => {
    expect(dateRange(EVENT)).toBe("Sat 14 – Sun 15 Mar");
    expect(dateRange({ ...EVENT, endsAt: "2026-04-02T10:00:00Z" })).toBe("Sat 14 Mar – Thu 2 Apr");
  });
});
