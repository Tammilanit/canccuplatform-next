// The grids that scale (amendment 3, #642; docs/design/grids/02–05), in the moments group: On air
// with 1, 2, 4 and 8 zones at 1280 px, 8 at 1920 px and on a phone, and the sound library with
// the default pack alone and with 20 sounds. The script makes the zones and sounds it needs and
// removes them afterwards. Moments learns a zone from Screen's zone events, so each On air shot
// first waits until Moments' zone list is the script's, and fails with both lists when it is not.
import { readFileSync } from "node:fs";
import { SESSION } from "../modules/screen/test/stack/client.mjs";
import { moments } from "./demo-screenshots-moments.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";

const HD = { width: 1920, height: 1080 };
export const ZONE_COUNTS = [1, 2, 4, 8];
// Demo names in Screen's order once keyed: the shot's zones sort after the demo's main.
const NAMES = [
  "Entrance",
  "Café",
  "Stage",
  "Lobby",
  "Workshop",
  "Lounge",
  "Back room",
];
const ZONES_MS = 180_000;
// The default pack's 12 sounds are always listed: these 8 uploads make 20 (sheet 03).
const UPLOADS = [
  ["Bell long", "gong.ogg"],
  ["Countdown beep", "ding.ogg"],
  ["Crowd cheer", "applause.ogg"],
  ["Horn short", "nudge.ogg"],
  ["Last call jingle", "music-box.ogg"],
  ["Synth rise", "chime-bright.ogg"],
  ["Tada", "happy-beep.ogg"],
  ["Whoosh", "chime-soft.ogg"],
];
const SOUNDS = new URL("../modules/moments/static/sounds/", import.meta.url);
const LIBRARY = "/moments/cues/library";

/** The dry run's lines. */
export function gridsListed(at) {
  const lines = [];
  const add = (name, path, { width, height }, how) =>
    lines.push(`  ${name}.png  ${at(path)}  (${width}×${height}, ${how})`);
  for (const n of ZONE_COUNTS)
    add(
      `grids-on-air-${n}-zones`,
      "/moments/on-air",
      DESK,
      `${n} zone${n === 1 ? "" : "s"} made for it`,
    );
  add(
    "grids-on-air-8-zones-1920",
    "/moments/on-air",
    HD,
    "8 zones made for it",
  );
  add(
    "grids-on-air-8-zones-phone",
    "/moments/on-air",
    PHONE,
    "8 zones made for it",
  );
  for (const [n, how] of [
    [12, "the default pack alone"],
    [20, "8 sounds uploaded for it"],
  ]) {
    add(`grids-sounds-${n}`, LIBRARY, DESK, how);
    add(`grids-sounds-${n}-1920`, LIBRARY, HD, how);
  }
  add("grids-sounds-20-phone", LIBRARY, PHONE, "8 sounds uploaded for it");
  return lines;
}

const sorted = (list) => [...list].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** Waits until Moments knows exactly `keys`; otherwise fails with both lists. */
async function zonesMatch(demo, keys) {
  const until = Date.now() + ZONES_MS;
  let known = [];
  while (Date.now() < until) {
    const r = await moments("GET", "/api/moments/moments");
    known = r.body?.zones ?? [];
    if (r.status === 200 && same(known, keys)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const screen = (await demo.call("GET", "/api/screen/zones")).body?.zones?.map(
    (z) => z.key,
  );
  throw new Error(
    `Moments' zones ${JSON.stringify(sorted(known))} are not the script's ${JSON.stringify(sorted(keys))} ` +
      `(Screen lists ${JSON.stringify(sorted(screen ?? []))}) after ${ZONES_MS / 1000} s`,
  );
}

const drawn = (n) => async (page) => {
  await page.waitForFunction(
    (want) => document.querySelectorAll(".moments-zone").length === want,
    n,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
};

async function onAirShots({ demo, shot, fail }) {
  const removed = [];
  const added = [];
  let keys = [];
  try {
    const list = (await demo.call("GET", "/api/screen/zones")).body.zones;
    keys = list.map((z) => z.key);
    for (const zone of list) {
      if (zone.key === "main") continue;
      // A zone in use (a screen, a schedule) keeps its place; a count below it is skipped.
      if (
        (await demo.call("DELETE", `/api/screen/zones/${zone.key}`)).status ===
        204
      ) {
        removed.push(zone);
        keys = keys.filter((k) => k !== zone.key);
      }
    }
    for (const n of ZONE_COUNTS) {
      if (n < keys.length) {
        fail(
          `on air with ${n} zones: ${keys.length} zones are in use (${keys.join(", ")})`,
        );
        continue;
      }
      while (keys.length < n) {
        const key = `shot-zone-${keys.length + 1}`;
        const made = await demo.call("POST", "/api/screen/zones", {
          body: {
            key,
            name: NAMES[keys.length - 1] ?? `Zone ${keys.length + 1}`,
          },
        });
        if (made.status !== 201)
          throw new Error(`adding ${key}: HTTP ${made.status}`);
        added.push(key);
        keys.push(key);
      }
      try {
        await zonesMatch(demo, keys);
        const o = { ready: drawn(n) };
        await shot(
          `grids-on-air-${n}-zones`,
          "/moments/on-air",
          DESK,
          SESSION,
          o,
        );
        if (n === 8) {
          await shot(
            "grids-on-air-8-zones-1920",
            "/moments/on-air",
            HD,
            SESSION,
            o,
          );
          await shot(
            "grids-on-air-8-zones-phone",
            "/moments/on-air",
            PHONE,
            SESSION,
            {
              ...o,
              touch: true,
            },
          );
        }
      } catch (err) {
        fail(`on air with ${n} zones: ${firstLine(err)}`);
      }
    }
  } catch (err) {
    fail(`on air zones: ${firstLine(err)}`);
  } finally {
    for (const key of added)
      await demo.call("DELETE", `/api/screen/zones/${key}`);
    for (const zone of removed) {
      const { revision: _r, ...body } = zone;
      const back = await demo.call("POST", "/api/screen/zones", { body });
      if (back.status !== 201)
        fail(`putting back zone ${zone.key}: HTTP ${back.status}`);
    }
    // The shots after these read Moments' zones: wait until it has the demo's again.
    const restored =
      (await demo.call("GET", "/api/screen/zones")).body?.zones ?? [];
    await zonesMatch(
      demo,
      restored.map((z) => z.key),
    ).catch((err) => fail(`on air zones cleanup: ${firstLine(err)}`));
  }
}

/** One of the pack's files uploaded to Screen under a title, then linked into the library. */
async function addSound(demo, title, file) {
  const boundary = "canccu-grids-shot";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="title"\r\n\r\n${title}\r\n` +
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${file}"\r\n` +
        "content-type: audio/ogg\r\n\r\n",
    ),
    readFileSync(new URL(file, SOUNDS)),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const type = `multipart/form-data; boundary=${boundary}`;
  const asset = await demo.call("POST", "/api/screen/assets", { body, type });
  if (asset.status !== 201)
    throw new Error(`uploading ${title}: HTTP ${asset.status}`);
  const made = { asset: asset.body.id, sound: null };
  // Screen reads an upload's length as it stores it; a sound needs it, so a slow probe is waited out.
  for (let i = 0; i < 20 && made.sound === null; i++) {
    const r = await moments("POST", "/api/moments/sounds", {
      asset_id: made.asset,
    });
    if (r.status === 201) made.sound = r.body.id;
    else await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (made.sound === null) throw new Error(`linking ${title} to the library`);
  return made;
}

async function soundShots({ demo, shot, fail }) {
  const made = [];
  try {
    await shot("grids-sounds-12", LIBRARY, DESK, SESSION);
    await shot("grids-sounds-12-1920", LIBRARY, HD, SESSION);
    for (const [title, file] of UPLOADS)
      made.push(await addSound(demo, title, file));
    await shot("grids-sounds-20", LIBRARY, DESK, SESSION);
    await shot("grids-sounds-20-1920", LIBRARY, HD, SESSION);
    await shot("grids-sounds-20-phone", LIBRARY, PHONE, SESSION, {
      touch: true,
    });
  } catch (err) {
    fail(`sound library: ${firstLine(err)}`);
  } finally {
    for (const { asset, sound } of made) {
      if (sound !== null)
        await moments("DELETE", `/api/moments/sounds/${sound}`);
      await demo.call("DELETE", `/api/screen/assets/${asset}`);
    }
  }
}

export async function gridsShots(run) {
  await onAirShots(run);
  await soundShots(run);
}
