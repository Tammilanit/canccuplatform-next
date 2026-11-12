// The screen's copy of the run-of-show, kept from `agenda.*` events (plan #108, D7). Every event
// may arrive twice or late (a replay of the stream at start), so none may undo a newer one.
import { withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent, loadAgendaItems, loadAgendaLabels } from "../src/content/agenda.js";
import { DATABASE_URL, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

let n = 0;
function event(type: string, data: Record<string, unknown>, tenant = "alpha"): Event {
  n += 1;
  return {
    id: `ev_${n}`,
    type,
    version: 1,
    time: "2026-01-01T00:00:00Z",
    source: "agenda",
    tenant,
    data,
  };
}

function item(
  id: string,
  startsAt: string,
  endsAt: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    title: id,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "scheduled",
    revision: 1,
    ...extra,
  };
}

describe.skipIf(!DATABASE_URL)("agenda items", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const apply = (e: Event) => withTenant(e.tenant ?? "", () => applyAgendaEvent(h.db, e));
  const items = (tenant = "alpha") => withTenant(tenant, () => h.db.tenant(loadAgendaItems));

  it("keeps added items with their current times, per event", async () => {
    await apply(
      event("agenda.item.added", {
        item: item("it_1", "2026-01-01T18:00:00Z", "2026-01-01T19:00:00Z"),
        agenda_version: 1,
      }),
    );
    expect((await items()).get("it_1")).toEqual({
      id: "it_1",
      startsAt: new Date("2026-01-01T18:00:00Z"),
      endsAt: new Date("2026-01-01T19:00:00Z"),
      status: "scheduled",
    });
    expect((await items("beta")).size).toBe(0);
  });

  it("follows a delay, and an older event replayed later never undoes it", async () => {
    const delayed = item("it_1", "2026-01-01T18:15:00Z", "2026-01-01T19:15:00Z", { revision: 2 });
    await apply(event("agenda.item.delayed", { item: delayed, minutes: 15, agenda_version: 2 }));
    await apply(
      event("agenda.item.added", {
        item: item("it_1", "2026-01-01T18:00:00Z", "2026-01-01T19:00:00Z"),
        agenda_version: 1,
      }),
    );
    // started carries no agenda_version; its item is the one before the delay here.
    await apply(
      event("agenda.item.started", {
        item: item("it_1", "2026-01-01T18:00:00Z", "2026-01-01T19:00:00Z"),
      }),
    );
    expect((await items()).get("it_1")?.startsAt).toEqual(new Date("2026-01-01T18:15:00Z"));
  });

  it("marks a cancelled item and forgets a removed one for good", async () => {
    const cancelled = item("it_1", "2026-01-01T18:15:00Z", "2026-01-01T19:15:00Z", {
      status: "cancelled",
      revision: 3,
    });
    await apply(event("agenda.item.cancelled", { item: cancelled, agenda_version: 3 }));
    expect((await items()).get("it_1")?.status).toBe("cancelled");

    await apply(
      event("agenda.item.removed", { item_id: "it_1", visibility: "crew", agenda_version: 4 }),
    );
    await apply(
      event("agenda.item.changed", {
        item: { ...cancelled, revision: 2 },
        changed: ["title"],
        agenda_version: 2,
      }),
    );
    await apply(event("agenda.item.ended", { item: { ...cancelled, revision: 9 } }));
    expect((await items()).has("it_1")).toBe(false);
  });

  it("learns an item from started when it missed the item's earlier events", async () => {
    await apply(event("agenda.item.started", { item: item("it_2", "2026-01-01T20:00:00Z", null) }));
    expect((await items()).get("it_2")?.endsAt).toBeNull();
  });

  it("keeps each item's title and whether it is crew-only, for the schedule calendar", async () => {
    await apply(
      event("agenda.item.added", {
        item: item("it_4", "2026-01-02T18:00:00Z", "2026-01-02T19:00:00Z", {
          title: "Crew briefing",
          visibility: "crew",
        }),
        agenda_version: 6,
      }),
    );
    await apply(
      event("agenda.item.added", {
        item: item("it_5", "2026-01-02T19:00:00Z", "2026-01-02T20:00:00Z", {
          title: "Dinner",
          visibility: "public",
        }),
        agenda_version: 7,
      }),
    );
    const labels = await withTenant("alpha", () => h.db.tenant(loadAgendaLabels));
    expect(labels.get("it_4")).toEqual({ title: "Crew briefing", crew: true });
    expect(labels.get("it_5")).toEqual({ title: "Dinner", crew: false });
  });

  it("fills the title of a row kept before titles were, when its last event is replayed", async () => {
    await withTenant("alpha", () =>
      h.db.tenant((c) =>
        c.query(
          `INSERT INTO screen_agenda_items (id, starts_at, ends_at, status, revision, agenda_version)
           VALUES ('it_6', '2026-01-03T10:00:00Z', '2026-01-03T11:00:00Z', 'scheduled', 1, 8)`,
        ),
      ),
    );
    await apply(
      event("agenda.item.added", {
        item: item("it_6", "2026-01-03T10:00:00Z", "2026-01-03T11:00:00Z", {
          title: "Quiz",
          visibility: "crew",
        }),
        agenda_version: 8,
      }),
    );
    const labels = await withTenant("alpha", () => h.db.tenant(loadAgendaLabels));
    expect(labels.get("it_6")).toEqual({ title: "Quiz", crew: true });
  });

  it("ignores what it does not use and malformed items", async () => {
    await apply(event("agenda.kind.saved", { kind: { key: "talk" }, kinds_version: 1 }));
    await apply(event("agenda.item.added", { item: { id: "it_3" }, agenda_version: 5 }));
    expect([...(await items()).keys()].sort()).toEqual(["it_2", "it_4", "it_5", "it_6"]);
  });
});
