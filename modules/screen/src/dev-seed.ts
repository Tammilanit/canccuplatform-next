/**
 * The demo event's screen content on the dev server (#788): `setup/deploy` runs
 * `node dist/dev-seed-cli.js` after the other modules' seeds, in dev mode only, so the main zone
 * has something new in each box all day: the demo photos on the photo wall (the hero's wall turns
 * every few seconds), a demo loop of slides and clips (`events/demo/media`) played in the main
 * zone's playlist widget at every hour, and a ticker line for each part of the day, long enough to
 * crawl. The run of show, the food and the announcements are the other modules' seeds.
 *
 * Every write goes through Screen's own routes (dev-seed-api.ts); the main zone, which a new event
 * starts with, is in place before (dev-seed-cli.ts). Each part is added to an event
 * that has none of its kind, and is left alone once anyone changed it: the seed's mark (on the
 * files volume, beside the event's other screen files) holds what it added, and a part that no
 * longer matches it was changed by hand. `force` (resetting the demo event,
 * docs/operations/dev-server.md) removes what the seed added and adds it again.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Answer, SeedApi } from "./dev-seed-api.js";

export const PHOTOS_ADDED = "added the demo photos to the photo wall";
export const PHOTOS_IN_PLACE = "the photo wall holds the demo photos; nothing changed";
export const PHOTOS_HAND_MADE =
  "the photo wall was changed by hand; nothing changed (reset the demo event to add the demo photos again)";
export const PHOTOS_OFF = "the demo event's photo wall is off; no photos added";
export const LOOP_ADDED = "added the demo loop, played in the main zone all day";
export const LOOP_IN_PLACE = "the main zone plays the demo loop; nothing changed";
export const LOOP_HAND_MADE =
  "the playlists or schedules were changed by hand; nothing changed (reset the demo event to add the demo loop again)";
export const TICKER_ADDED = "added the demo ticker lines through the day";
export const TICKER_IN_PLACE = "the ticker holds the demo lines; nothing changed";
export const TICKER_HAND_MADE =
  "the ticker windows were changed by hand; nothing changed (reset the demo event to add the demo lines again)";

export class Refused extends Error {}

/** Placeholder photos: generated images (events/demo/README.md), captions, people with no accounts. */
const PHOTOS: readonly [file: string, caption: string, author: string][] = [
  ["demo-photo-1.jpg", "Lights up in the hall", "Alex"],
  ["demo-photo-2.jpg", "The stage before doors", "Sam"],
  ["demo-photo-3.jpg", "Sunrise over the car park", "Robin"],
  ["demo-photo-4.jpg", "Bracket wall, round one", "Kim"],
  ["demo-photo-5.jpg", "Late-night snacks", "Jo"],
  ["demo-photo-6.jpg", "Glow sticks at the finals", "Alex"],
  ["demo-photo-7.jpg", "The quiet corner", "Sam"],
  ["demo-photo-8.jpg", "Cables, cables, cables", "Robin"],
];
/** The loop's items: a slide's dwell, or null for a clip's own length. */
const LOOP: readonly [file: string, title: string, seconds: number | null][] = [
  ["slides/demo-slide-welcome.jpg", "Demo slide: welcome", 10],
  ["demo-clip.mp4", "Demo clip", null],
  ["slides/demo-slide-tournament.jpg", "Demo slide: tournament", 10],
  ["demo-film.mp4", "Demo Event: the film", null],
  ["slides/demo-slide-food.jpg", "Demo slide: food", 10],
];
const LOOP_NAME = "Demo loop";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
/** A line per part of the day; at a screen's width each is wider than the ticker, so it crawls. */
const LINES: readonly [start: number, end: number, text: string][] = [
  [
    0,
    360,
    "Quiet hours in the hall: voices low and headphones on · Water and snacks at the info desk · The night crew is at the entrance if you need anything",
  ],
  [
    360,
    720,
    "Good morning! Breakfast is in the canteen · Today's run of show is in the hub: scan the QR · Lost something? Ask at the info desk",
  ],
  [
    720,
    1080,
    "Tournament check-in is at the stage desk · The group food order is in the hub · Share your photos with the crew for the photo wall",
  ],
  [
    1080,
    1440,
    "Tonight on stage: the tournament and the raffle · Keep the aisles clear of bags and cables · Food arrives at the entrance table",
  ],
];

interface Mark {
  photos?: string[];
  loop?: { assets: string[]; playlist: string; schedule: string; state: string };
  ticker?: string[];
}

export interface SeedOptions {
  version: string;
  /** `events/demo/media`. */
  media: string;
  filesRoot: string;
  tenant: string;
  now: () => Date;
  force: boolean;
}

function ok(a: Answer, what: string, ...statuses: number[]): Answer["body"] {
  if (!statuses.includes(a.status)) {
    const error = a.body.error as { message?: string } | undefined;
    throw new Error(`${what}: ${a.status} ${error?.message ?? ""}`.trim());
  }
  return a.body;
}

const list = <T>(body: Answer["body"], key: string): T[] => (body[key] as T[] | undefined) ?? [];
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Whether a part is the seed's to (re)add: `null` when it is, else what to say. */
function verdict(
  force: boolean,
  mine: boolean | null,
  empty: boolean,
  said: { inPlace: string; handMade: string },
): string | null {
  if (force) return null;
  if (mine === null) return empty ? null : said.handMade;
  return mine ? said.inPlace : said.handMade;
}

async function seedPhotos(api: SeedApi, o: SeedOptions, mark: Mark): Promise<string> {
  const read = await api.json("GET", "/api/screen/photos");
  if (
    read.status === 403 &&
    (read.body.error as { code?: string } | undefined)?.code === "feature_off"
  )
    return PHOTOS_OFF;
  const ids = list<{ id: string }>(ok(read, "listing the photos", 200), "photos").map((p) => p.id);
  const mine = mark.photos === undefined ? null : sameSet(ids, mark.photos);
  const skip = verdict(o.force, mine, ids.length === 0, {
    inPlace: PHOTOS_IN_PLACE,
    handMade: PHOTOS_HAND_MADE,
  });
  if (skip !== null) return skip;
  for (const id of (mark.photos ?? []).filter((p) => ids.includes(p)))
    ok(await api.json("DELETE", `/api/screen/photos/${id}`), "removing a demo photo", 204);
  const now = o.now().getTime();
  const added: string[] = [];
  // Posted through the last few hours, oldest first, as a day's photos come in.
  for (const [i, [file, caption, author]] of PHOTOS.entries()) {
    const posted = new Date(now - (PHOTOS.length - i) * 20 * 60_000).toISOString();
    const body = ok(
      await api.upload("/api/screen/photos", await readFile(join(o.media, "photos", file)), file, {
        caption,
        author_name: author,
        posted_at: posted,
      }),
      `adding ${file}`,
      201,
    );
    added.push(body.id as string);
  }
  mark.photos = added;
  return PHOTOS_ADDED;
}

/** The playlists and schedule windows as they stand: what a change by hand would alter. */
async function loopState(api: SeedApi): Promise<{ state: string; empty: boolean }> {
  const playlists = list<{ id: string; revision: number }>(
    ok(await api.json("GET", "/api/screen/playlists"), "listing the playlists", 200),
    "playlists",
  );
  const windows = list<{ id: string; revision: number }>(
    ok(await api.json("GET", "/api/screen/schedules"), "listing the schedules", 200),
    "schedules",
  );
  const rows = [...playlists, ...windows].map((r) => `${r.id}@${r.revision}`).sort();
  return {
    state: createHash("sha256").update(rows.join("\n")).digest("hex"),
    empty: rows.length === 0,
  };
}

async function seedLoop(api: SeedApi, o: SeedOptions, mark: Mark): Promise<string> {
  const before = await loopState(api);
  const mine = mark.loop === undefined ? null : mark.loop.state === before.state;
  const skip = verdict(o.force, mine, before.empty, {
    inPlace: LOOP_IN_PLACE,
    handMade: LOOP_HAND_MADE,
  });
  if (skip !== null) return skip;
  if (mark.loop !== undefined) {
    // The window first: it keeps the playlist in use, as the playlist keeps its assets.
    const gone = [200, 204, 404];
    ok(
      await api.json("DELETE", `/api/screen/schedules/${mark.loop.schedule}`),
      "removing the demo window",
      ...gone,
    );
    ok(
      await api.json("DELETE", `/api/screen/playlists/${mark.loop.playlist}`),
      "removing the demo loop",
      ...gone,
    );
    for (const id of mark.loop.assets)
      ok(await api.json("DELETE", `/api/screen/assets/${id}`), "removing a demo asset", ...gone);
  }
  const assets: string[] = [];
  for (const [file, title] of LOOP) {
    const body = ok(
      await api.upload("/api/screen/assets", await readFile(join(o.media, file)), file, { title }),
      `uploading ${file}`,
      201,
    );
    assets.push(body.id as string);
  }
  const playlist = ok(
    await api.json("POST", "/api/screen/playlists", {
      name: LOOP_NAME,
      type: "regular",
      items: LOOP.map(([, , seconds], i) => ({ asset_id: assets[i], duration_seconds: seconds })),
    }),
    "adding the demo loop",
    201,
  );
  // Priority 0, the lowest, so any window the crew adds wins over it.
  const window = ok(
    await api.json("POST", "/api/screen/schedules", {
      zone_key: "main",
      playlist_id: playlist.id,
      priority: 0,
      days: EVERY_DAY,
      start_minute: 0,
      end_minute: 1440,
    }),
    "scheduling the demo loop",
    201,
  );
  mark.loop = {
    assets,
    playlist: playlist.id as string,
    schedule: window.id as string,
    state: (await loopState(api)).state,
  };
  return LOOP_ADDED;
}

async function seedTicker(api: SeedApi, o: SeedOptions, mark: Mark): Promise<string> {
  const ids = list<{ id: string }>(
    ok(await api.json("GET", "/api/screen/ticker/windows"), "listing the ticker windows", 200),
    "windows",
  ).map((w) => w.id);
  const mine = mark.ticker === undefined ? null : sameSet(ids, mark.ticker);
  const skip = verdict(o.force, mine, ids.length === 0, {
    inPlace: TICKER_IN_PLACE,
    handMade: TICKER_HAND_MADE,
  });
  if (skip !== null) return skip;
  for (const id of (mark.ticker ?? []).filter((w) => ids.includes(w)))
    ok(await api.json("DELETE", `/api/screen/ticker/windows/${id}`), "removing a demo line", 204);
  const added: string[] = [];
  for (const [start, end, text] of LINES) {
    const body = ok(
      await api.json("POST", "/api/screen/ticker/windows", {
        text,
        days: EVERY_DAY,
        start_minute: start,
        end_minute: end,
      }),
      "adding a demo ticker line",
      201,
    );
    added.push(body.id as string);
  }
  mark.ticker = added;
  return TICKER_ADDED;
}

export async function seedDemoScreen(api: SeedApi, o: SeedOptions): Promise<string[]> {
  if (o.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${o.version}, not dev: nothing changed`);
  const dir = join(o.filesRoot, o.tenant, "screen");
  const file = join(dir, "dev-seed.json");
  const text = await readFile(file, "utf8").catch(() => null);
  const mark = (text === null ? {} : JSON.parse(text)) as Mark;
  const before = JSON.stringify(mark);
  try {
    return [
      await seedPhotos(api, o, mark),
      await seedLoop(api, o, mark),
      await seedTicker(api, o, mark),
    ];
  } finally {
    // Also after a part failed, so what the parts before it added is known as the seed's.
    if (JSON.stringify(mark) !== before) {
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(mark) + "\n");
    }
  }
}
