/**
 * The window editor's choices and "what plays at…" (#543): a window bound to an item no longer
 * offered keeps it as a hidden option nobody can pick, cancelled items are offered only to the
 * windows already bound to them, the rail's next is every item at the first next start as the
 * screen's `agenda_now` gives it, and only the editor's page stops text selection on the grid.
 */
import { readFile } from "node:fs/promises";
import { withTenant } from "@canccu/kit";
import { html } from "@canccu/ui";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent, loadAgendaChoices } from "../src/content/agenda.js";
import { railAt } from "../src/compose/widgets.js";
import type { AgendaItem } from "../src/compose/widgets.js";
import { translator } from "../src/studio/messages.js";
import { editorView } from "../src/studio/schedule-editor.js";
import type { EditorData } from "../src/studio/schedule-editor.js";
import { FULL_DAY } from "../src/studio/schedule-axis.js";
import { scheduleView } from "../src/studio/schedule-view.js";
import { DATABASE_URL, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const ctx = (rights: string[] = ["screen.content.write"]) => ({
  t: translator("en"),
  rights: new Set(rights),
  nowMs: 0,
  timeZone: "UTC",
  startUrl: null,
});
const tight = (body: string) => body.replace(/>\s+/g, ">").replace(/\s+</g, "<");

function editor(over: Partial<EditorData>, rights?: string[]): string {
  const data: EditorData = {
    zones: [{ key: "main", name: "Main" }] as unknown as EditorData["zones"],
    playlists: [{ id: "p1", name: "Loop" }],
    layouts: [],
    items: [],
    windows: [],
    zone: "main",
    isoDay: 4,
    ...over,
  };
  return tight(String(editorView(ctx(rights), data).dialog));
}

const bound = (agenda_item_id: string) => ({
  id: "w1",
  playlist_id: "p1",
  priority: 10,
  layout_id: null,
  agenda_item_id,
});

describe("the window editor's run-of-show picker", () => {
  it("keeps a bound item no longer offered as a hidden option nobody can pick", () => {
    const body = editor({ windows: [bound("it_gone")] });
    expect(body).toContain(
      '<option value="it_gone" hidden disabled>Its current item (not offered)</option>',
    );
    expect(body.match(/value="it_gone"/g)).toHaveLength(1);
  });

  it("keeps a crew item from a reader without the right as one nobody can pick", () => {
    const items = [
      { id: "it_crew", title: "Briefing", crew: true, startsAt: "2026-01-01T13:00:00Z" },
    ];
    const body = editor({ items, windows: [bound("it_crew")] });
    expect(body).toContain('<option value="it_crew" hidden disabled>A crew item</option>');
    expect(body).not.toContain("Its current item");
  });

  it("keeps a playlist and a layout no longer offered as options nobody can pick", () => {
    const window = { ...bound("x"), agenda_item_id: null, playlist_id: "gone", layout_id: "old" };
    const body = editor({ windows: [window] });
    expect(body).toContain('<option value="gone" hidden disabled>');
    expect(body).toContain('<option value="old" hidden disabled>');
  });
});

describe("the rail at a time", () => {
  const item = (id: string, starts_at: string, ends_at: string): AgendaItem => ({
    id,
    title: id,
    kind: "other",
    starts_at,
    ends_at,
    delay_minutes: 0,
    location: null,
    visibility: "public",
    status: "scheduled",
    zone: null,
  });

  it("lists every item at the first next start, as the screen's agenda_now does", () => {
    const items = [
      item("final", "2026-01-01T14:30:00Z", "2026-01-01T16:00:00Z"),
      item("lunch", "2026-01-01T13:00:00Z", "2026-01-01T14:00:00Z"),
      item("semis", "2026-01-01T14:30:00Z", "2026-01-01T16:00:00Z"),
      item("dinner", "2026-01-01T18:00:00Z", "2026-01-01T19:00:00Z"),
    ];
    const rail = railAt(items, "main", Date.parse("2026-01-01T13:30:00Z"));
    expect(rail.now.map((i) => i.id)).toEqual(["lunch"]);
    expect(rail.next.map((i) => i.id).sort()).toEqual(["final", "semis"]);
    expect(railAt(items, "main", Date.parse("2026-01-01T18:30:00Z")).next).toEqual([]);
  });
});

describe("text selection on the grid", () => {
  const view = (withEditor: boolean) =>
    tight(
      String(
        scheduleView(ctx(), {
          model: { axis: FULL_DAY, days: [], now: null },
          calendar: {
            from: "2026-01-01T00:00:00.000Z",
            to: "2026-01-02T00:00:00.000Z",
            time_zone: "UTC",
            zones: [],
          },
          zones: [],
          zone: "main",
          page: { days: ["2026-01-01"], prev: null, next: null },
          day: "2026-01-01",
          playlists: new Map(),
          at: html``,
          editor: withEditor ? { add: html``, dialog: html``, hint: html`` } : null,
        }).body,
      ),
    );

  it("stops it only where the editor drags, so readers can still copy the calendar", async () => {
    expect(view(true)).toContain("canccu-sched__grid--edit");
    expect(view(false)).not.toContain("canccu-sched__grid--edit");
    const css = await readFile(new URL("../static/studio-schedule.css", import.meta.url), "utf8");
    const rules = [...css.matchAll(/([^{}]+)\{[^}]*user-select:\s*none/g)].map((m) => m[1]?.trim());
    expect(rules).toEqual([".canccu-sched__grid--edit .canccu-sched__body"]);
  });
});

describe.skipIf(!DATABASE_URL)("the items a window may follow", () => {
  let h: Harness;
  const added = (id: string, status: string, version: number) => ({
    id: `e_${id}_${version}`,
    type: "agenda.item.added",
    version: 1,
    time: "",
    source: "agenda",
    tenant: "alpha",
    data: {
      item: {
        id,
        title: id,
        visibility: "public",
        starts_at: "2026-01-01T13:00:00Z",
        ends_at: "2026-01-01T14:00:00Z",
        status,
        revision: 1,
      },
      agenda_version: version,
    },
  });
  beforeAll(async () => {
    h = await harness();
    await withTenant("alpha", async () => {
      await applyAgendaEvent(h.db, added("it_on", "scheduled", 1));
      await applyAgendaEvent(h.db, added("it_off", "cancelled", 2));
      await applyAgendaEvent(h.db, added("it_kept", "cancelled", 3));
    });
  });
  afterAll(async () => {
    await h.close();
  });

  it("leaves out cancelled items unless a window is already bound to one", async () => {
    const ids = await withTenant("alpha", () =>
      h.db.tenant((c) => loadAgendaChoices(c, new Set(["it_kept"]))),
    );
    expect(ids.map((i) => i.id).sort()).toEqual(["it_kept", "it_on"]);
  });
});
