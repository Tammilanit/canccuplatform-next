/**
 * The Content page's playlists and Push now (#264; mockup 10, plan S7, S8, S10, S11): the builder
 * beside the library, each playlist's document and the library it draws from, the push form and
 * the pushes playing now; each control only for holders of the right its API checks, and the API
 * refusing every write without it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, SESSIONS, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { seedAssets } from "./seed.js";
import { CLIENT_KEYS, translator } from "../src/studio/messages.js";

const as = (session: string, body?: unknown) => ({ host: "alpha.test", session, body });

interface Doc {
  id: string;
  name: string;
  revision: number;
  windows: number;
  items: { asset_id: string }[];
}

describe.skipIf(!DATABASE_URL)("studio playlists and push", () => {
  let h: Harness;
  let loop: string;
  let menu: string;
  let ads: string;
  beforeAll(async () => {
    SESSIONS.pusher = ["screen.content.read", "screen.push.write"];
    h = await harness();
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await call(h, "POST", "/api/screen/zones", as("admin", { key: "cafe", name: "Café" }));
    await seedAssets(
      h,
      { id: "as_poster", kind: "image" },
      { id: "as_trailer", kind: "video", durationSeconds: 101 },
      { id: "as_deck", kind: "pptx", slides: 12 },
      { id: "as_chime", kind: "audio" },
    );
    const make = async (body: Record<string, unknown>) =>
      (await call(h, "POST", "/api/screen/playlists", as("admin", body))).json<{ id: string }>().id;
    loop = await make({
      name: "Welcome loop",
      type: "regular",
      priority: 5,
      items: [
        { asset_id: "as_deck", duration_seconds: 8 },
        { asset_id: "as_poster", duration_seconds: 15 },
      ],
    });
    menu = await make({ name: "Menu", type: "regular", items: [] });
    ads = await make({
      name: "Ads",
      type: "break",
      items: [],
      break: { period_seconds: 60, break_seconds: 5 },
    });
    for (const day of [1, 2]) {
      const window = { zone_key: "main", playlist_id: loop, priority: 10, days: [day] };
      const at = { start_minute: 600, end_minute: 1200 };
      const res = await call(h, "POST", "/api/screen/schedules", as("admin", { ...window, ...at }));
      expect(res.statusCode).toBe(201);
    }
  });
  afterAll(async () => {
    Reflect.deleteProperty(SESSIONS, "pusher");
    await h.close();
  });

  const content = (session: string, query = "") =>
    call(h, "GET", `/admin/screen/content${query}`, { host: "alpha.test", session });
  const json = (body: string, id: string): unknown =>
    JSON.parse(
      new RegExp(`<script type="application/json" id="${id}">(.*?)</script>`, "s").exec(
        body,
      )?.[1] ?? "null",
    );
  const until = (hours: number) => new Date(h.clock.now + hours * 3600_000).toISOString();

  it("draws the builder beside the library, on the first playlist or the one asked for", async () => {
    const body = (await content("editor")).body;
    expect(body).toContain("canccu-studio-content__side");
    // Playlists by name: Ads, Menu, Welcome loop; a break playlist is in the list too.
    const pick = /<select[^>]*data-playlist-pick[^>]*>(.*?)<\/select>/s.exec(body)?.[1] ?? "";
    expect(pick.indexOf("Ads")).toBeLessThan(pick.indexOf("Menu"));
    expect(pick).toContain(`value="${loop}"`);
    // It opens on the first playlist a window or a push can play, as mockup 10 does.
    expect((json(body, "canccu-studio-playlist") as Doc).id).toBe(menu);
    const chosen = json(
      (await content("editor", `?playlist=${loop}`)).body,
      "canccu-studio-playlist",
    ) as Doc;
    expect(chosen).toMatchObject({ id: loop, name: "Welcome loop", revision: 1, windows: 2 });
    expect(chosen.items.map((i) => i.asset_id)).toEqual(["as_deck", "as_poster"]);
    // An unknown id falls back to the first, rather than an editor for nothing.
    expect(
      (json((await content("editor", "?playlist=pl_none")).body, "canccu-studio-playlist") as Doc)
        .id,
    ).toBe(menu);
    expect(
      (json((await content("editor", `?playlist=${ads}`)).body, "canccu-studio-playlist") as Doc)
        .id,
    ).toBe(ads);
  });

  it("gives the builder the whole library it draws from, without sounds", async () => {
    const library = json((await content("editor")).body, "canccu-studio-library") as Record<
      string,
      Record<string, unknown>
    >;
    expect(library.as_deck).toMatchObject({ kind: "pptx", title: "as_deck", slides: 12 });
    expect(library.as_trailer).toMatchObject({ kind: "video", duration_seconds: 101 });
    expect(library.as_chime).toBeUndefined();
  });

  it("lets only holders of screen.content.write build: drag, add, save, delete", async () => {
    const editor = (await content("editor", `?playlist=${loop}`)).body;
    expect(editor).toMatch(/data-playlist-editor[^>]*data-write="true"/);
    expect(editor).toContain("data-playlist-new");
    expect(editor).toMatch(
      /draggable="true"[^>]*data-drag-asset="as_poster"|data-drag-asset="as_poster"[^>]*draggable="true"/,
    );
    // A sound plays in no playlist, so it is not dragged.
    expect(editor).not.toContain('data-drag-asset="as_chime"');
    const reader = (await content("content", `?playlist=${loop}`)).body;
    expect(reader).toMatch(/data-playlist-editor[^>]*data-write="false"/);
    expect(reader).not.toContain("data-playlist-new");
    expect(reader).not.toContain("data-drag-asset");
    expect((json(reader, "canccu-studio-playlist") as Doc).id).toBe(loop);
  });

  it("offers Push now only to holders of screen.push.write, with every zone and the presets", async () => {
    for (const session of ["editor", "content"]) {
      expect((await content(session)).body).not.toContain("data-push-form");
    }
    const body = (await content("pusher", `?playlist=${loop}`)).body;
    const form = /<form[^>]*data-push-form.*?<\/form>/s.exec(body)?.[0] ?? "";
    expect(form).toContain('data-time-zone="UTC"');
    // What: playable playlists (never a break one), the chosen one first, then assets.
    expect(form).toMatch(new RegExp(`<option value="playlist:${loop}" selected>`));
    expect(form).toContain(`value="playlist:${menu}"`);
    expect(form).not.toContain(`value="playlist:${ads}"`);
    expect(form).toContain('value="asset:as_trailer"');
    expect(form).not.toContain('value="asset:as_chime"');
    for (const zone of ['value="main"', 'value="cafe"', "Café", "All zones"]) {
      expect(form).toContain(zone);
    }
    for (const preset of ['value="15"', 'value="60"', 'value="day"', 'value="at"']) {
      expect(form).toContain(preset);
    }
    // The builder stays read-only for someone who may push but not edit.
    expect(body).toMatch(/data-playlist-editor[^>]*data-write="false"/);
  });

  it("lists the pushes playing now, with a clear for holders of screen.push.write", async () => {
    const pushed = (
      await call(
        h,
        "POST",
        "/api/screen/push",
        as("admin", { zones: ["cafe"], playlist_id: loop, until: until(2) }),
      )
    ).json<{ id: string }>();
    const all = (
      await call(
        h,
        "POST",
        "/api/screen/push",
        as("admin", { zones: [], asset_id: "as_trailer", until: until(1) }),
      )
    ).json<{ id: string }>();
    const ended = (
      await call(
        h,
        "POST",
        "/api/screen/push",
        as("admin", { zones: [], asset_id: "as_poster", until: until(1) }),
      )
    ).json<{ id: string }>();
    await call(h, "DELETE", `/api/screen/push/${ended.id}`, as("admin"));

    const body = (await content("pusher")).body;
    const list = /<section[^>]*data-pushes.*?<\/section>/s.exec(body)?.[0] ?? "";
    expect(list).toContain("Welcome loop");
    expect(list).toContain("Café");
    expect(list).toContain("as_trailer");
    expect(list).toContain("All zones");
    expect(list).not.toContain("as_poster");
    const end = new Date(h.clock.now + 2 * 3600_000);
    const hhmm = `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}`;
    expect(list).toContain(hhmm);
    for (const p of [pushed, all]) {
      expect(list).toContain(`data-call="DELETE" data-url="/api/screen/push/${p.id}"`);
    }
    // Content readers see what plays, and cannot end it.
    const read =
      /<section[^>]*data-pushes.*?<\/section>/s.exec((await content("editor")).body)?.[0] ?? "";
    expect(read).toContain("Welcome loop");
    expect(read).not.toContain("data-call");
  });

  it("refuses every playlist write without screen.content.write and every push action without screen.push.write", async () => {
    const doc = { name: "X", type: "regular", items: [] };
    const refused = [
      await call(h, "POST", "/api/screen/playlists", as("content", doc)),
      await call(h, "POST", "/api/screen/playlists", as("pusher", doc)),
      await call(h, "PUT", `/api/screen/playlists/${menu}`, as("content", { ...doc, revision: 1 })),
      await call(h, "DELETE", `/api/screen/playlists/${menu}`, as("pusher")),
      await call(
        h,
        "POST",
        "/api/screen/push",
        as("editor", { zones: [], playlist_id: menu, until: until(1) }),
      ),
    ];
    const open = (
      await call(
        h,
        "POST",
        "/api/screen/push",
        as("pusher", { zones: [], playlist_id: menu, until: until(1) }),
      )
    ).json<{ id: string }>();
    refused.push(await call(h, "DELETE", `/api/screen/push/${open.id}`, as("editor")));
    expect(
      refused.map((r) => [r.statusCode, r.json<{ error: { code: string } }>().error.code]),
    ).toEqual(refused.map(() => [403, "missing_right"]));
    // Holders act: the playlist saves with its revision, the push ends.
    const saved = await call(
      h,
      "PUT",
      `/api/screen/playlists/${menu}`,
      as("editor", { ...doc, name: "Menu", revision: 1 }),
    );
    expect(saved.statusCode).toBe(200);
    expect((await call(h, "DELETE", `/api/screen/push/${open.id}`, as("pusher"))).statusCode).toBe(
      204,
    );
  });

  it("serves the builder's scripts and gives them every string behind a message key", async () => {
    for (const name of [
      "studio-playlists.js",
      "studio-playlist-editor.js",
      "studio-playlist-item.js",
      "studio-playlist-builder.js",
    ]) {
      const res = await call(h, "GET", `/admin/screen/static/${name}`, { host: "alpha.test" });
      expect(res.statusCode, name).toBe(200);
      expect(res.headers["content-type"]).toContain("text/javascript");
    }
    const text = json((await content("admin")).body, "canccu-studio-text") as Record<
      string,
      string
    >;
    const t = translator("en");
    for (const key of CLIENT_KEYS.filter(
      (k) => k.startsWith("playlist.") || k.startsWith("push."),
    )) {
      expect(text[key], key).toBe(t(key));
    }
    for (const key of [
      "playlist.saved",
      "playlist.conflict",
      "playlist.cycle",
      "push.done",
      "push.too_far",
    ]) {
      expect(text[key], key).toBeTruthy();
    }
  });
});
