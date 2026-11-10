// "Slide ranges are clamped to the new deck" (contracts/screen/content.openapi.yaml, replace):
// once the replaced deck's render says how many slides it has, and on a revert to a deck whose
// render is kept. Ported from the legacy `asset-replace.ts` `clampToSlideCount`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, harness, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { fakeRenderer, pdfPages } from "./render-fake.js";
import type { FakeRenderer } from "./render-fake.js";

interface Item {
  id: string;
  slide_start: number | null;
  slide_end: number | null;
}

describe.skipIf(!DATABASE_URL)("slide ranges after a deck changes", () => {
  let h: Harness;
  let dir: string;
  let renderer: FakeRenderer;
  beforeAll(async () => {
    h = await harness();
    dir = await mkdtemp(join(tmpdir(), "canccu-deck-clamp-"));
    renderer = await fakeRenderer(dir, { slides: 10 });
  });
  afterAll(async () => {
    await renderer.close();
    await h.close();
    await rm(dir, { recursive: true, force: true });
  });

  const admin = { host: "alpha.test", session: "admin" };
  const read = async (id: string) =>
    (await call(h, "GET", `/api/screen/playlists/${id}`, admin)).json<{
      revision: number;
      items: Item[];
    }>();
  const ranges = async (id: string) =>
    (await read(id)).items.map((i) => [i.slide_start, i.slide_end]);

  it("clamps the ranges to the replaced deck once it is rendered, and to a reverted one", async () => {
    const deck = (await upload(h, "/api/screen/assets", pdfPages(1), "Talk.pdf", admin)).json<{
      id: string;
    }>().id;
    await h.dispatch(renderer.path);
    const item = (slide_start: number | null, slide_end: number | null) => ({
      asset_id: deck,
      duration_seconds: 30,
      slide_start,
      slide_end,
    });
    const made = await call(h, "POST", "/api/screen/playlists", {
      ...admin,
      body: {
        name: "Talks",
        type: "regular",
        items: [item(2, 9), item(7, null), item(8, 10), item(null, null)],
      },
    });
    expect(made.statusCode).toBe(201);
    const playlist = made.json<{ id: string }>().id;

    renderer.behaviour = { slides: 6 };
    h.clock.now += 1000;
    await upload(h, `/api/screen/assets/${deck}/replace`, pdfPages(2), "Talk v2.pdf", admin);
    // Until the new deck is rendered its count is unknown, and the ranges stay.
    expect(await ranges(playlist)).toEqual([
      [2, 9],
      [7, null],
      [8, 10],
      [null, null],
    ]);
    const before = (await read(playlist)).revision;
    await h.dispatch(renderer.path);
    // A start past the end shows the whole deck, as in legacy; an end past it ends there.
    expect(await ranges(playlist)).toEqual([
      [2, 6],
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect((await read(playlist)).revision).toBe(before + 1);

    // Back to the 10-slide deck: nothing is past its end, so nothing changes.
    await call(h, "POST", `/api/screen/assets/${deck}/revert`, admin);
    expect((await read(playlist)).revision).toBe(before + 1);

    renderer.behaviour = { slides: 12 };
    h.clock.now += 1000;
    await upload(h, `/api/screen/assets/${deck}/replace`, pdfPages(3), "Talk v3.pdf", admin);
    await h.dispatch(renderer.path);
    const now = await read(playlist);
    const put = await call(h, "PUT", `/api/screen/playlists/${playlist}`, {
      ...admin,
      body: { name: "Talks", type: "regular", revision: now.revision, items: [item(11, 12)] },
    });
    expect(put.statusCode).toBe(200);
    await call(h, "POST", `/api/screen/assets/${deck}/revert`, admin);
    expect(await ranges(playlist)).toEqual([[null, null]]);
  });
});
