/**
 * The demo event's Moments on the dev server (#715): `setup/deploy` runs
 * `node dist/dev-seed-cli.js` after the agenda's seed, in dev mode only. It copies the presets
 * (storyboards and scenes, as an event's first use does) and turns Prize draw on for the demo run
 * of show's raffle (modules/agenda/src/canccu_agenda/dev_seed.py), so a story is ready to go on
 * air: On air offers its Fire, and its rounds come before the raffle.
 *
 * The raffle moves to another day when the agenda's seed moves the run of show, so the seed
 * points Prize draw at the new item while the storyboards are still what it left (its mark holds
 * the revision it wrote). A save by anyone else keeps it out; `force` (resetting the demo event,
 * docs/operations/dev-server.md) puts the presets back with Prize draw on.
 */
import { DEMO_TENANT, withTenant } from "@canccu/kit";
import type { Db } from "./db.js";
import type { AgendaItem } from "./scene-eval.js";
import { ensureScenes } from "./scene-store.js";
import { lockSettings } from "./store.js";
import { checkStories } from "./story/check.js";
import type { Story } from "./story/model.js";
import { toggled } from "./story/picker.js";
import { PRESETS } from "./story/presets.js";
import { ensureStories, readMark, writeMark, writeStories } from "./story/store.js";

export const READY = "turned Prize draw on for the run of show's raffle";
export const UP_TO_DATE = "Prize draw follows the run of show's raffle; nothing changed";
export const NO_RAFFLE = "the run of show has no raffle ahead; nothing changed";
export const HAND_MADE =
  "the demo event's storyboards were changed by hand; nothing changed" +
  " (reset the demo event to turn the demo story on again)";

export class Refused extends Error {}

const STORY = "prize_draw";
/** The agenda seed's raffle title. */
const RAFFLE = "Raffle";
const MARK = "dev-seed";

interface Mark {
  revision: number;
  item_id: string;
}

/** The next scheduled public raffle that has not started. */
function nextRaffle(items: readonly AgendaItem[], now: Date): AgendaItem | undefined {
  return items
    .filter(
      (i) =>
        (i as { title?: unknown }).title === RAFFLE &&
        i.visibility === "public" &&
        (i.status ?? "scheduled") === "scheduled" &&
        Date.parse(i.starts_at) > now.getTime(),
    )
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
}

/** Prize draw on, its item trigger on `itemId`; copied from its preset when the list lacks it. */
function withPrizeDraw(list: Story[], itemId: string): Story[] {
  const on = list.some((s) => s.key === STORY && s.enabled) ? list : toggled(list, STORY);
  return on.map((s) =>
    s.key !== STORY
      ? s
      : {
          ...s,
          triggers: s.triggers.map((t) => (t.kind === "item" ? { ...t, item_id: itemId } : t)),
        },
  );
}

export async function seedDemoMoments(
  d: { db: Db; now: () => Date },
  o: { version: string; items: readonly AgendaItem[] | null; force: boolean },
): Promise<string> {
  if (o.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${o.version}, not dev: nothing changed`);
  const raffle = nextRaffle(o.items ?? [], d.now());
  return withTenant(DEMO_TENANT, () =>
    d.db.tenant(async (c) => {
      await lockSettings(c, "stories");
      await ensureScenes(c);
      const doc = await ensureStories(c);
      const mark = await readMark<Mark>(c, MARK);
      if (!o.force && doc.revision !== 0 && mark?.revision !== doc.revision) return HAND_MADE;
      if (raffle === undefined) return NO_RAFFLE;
      if (!o.force && mark?.item_id === raffle.id) return UP_TO_DATE;
      const base = o.force ? (JSON.parse(JSON.stringify(PRESETS)) as Story[]) : doc.stories;
      const stories = withPrizeDraw(base, raffle.id);
      const why = checkStories(stories, doc.settings);
      if (why !== null) throw new Error(`the demo storyboards do not pass their checks: ${why}`);
      await writeStories(c, stories, doc.settings, doc.revision + 1);
      await writeMark(c, MARK, { revision: doc.revision + 1, item_id: raffle.id });
      return READY;
    }),
  );
}
