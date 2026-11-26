// The event's storyboards off while the screens are shot (screens.mjs, #813). The screens' views
// are the Pulse and its frames as mockups 02–05 draw them, not Moments' stories: a preset's round
// in the main hall's hero is a title card or a sting, which the hero's checks hold to the Pulse's
// rules. When a run starts in the hour after midnight, day.mjs squeezes the day so the fixture's
// Dinner starts minutes before, and Meal is served plays a round then and 5 and 10 minutes later.
// The midnight preset plays at midnight too. Turning a story off also ends its live run (Moments'
// runner), so none is left on air. The storyboards' own screen shots are the `moments` group's.
import { expect } from "./client.mjs";

const PATH = "/api/moments/storyboards";

const read = async (demo) => expect(await demo.call("GET", PATH), 200, "the storyboards").body;

/** Saves `doc`'s stories, each on as `enabled` says, against the revision it was read at. */
async function put(demo, doc, enabled, what) {
  const stories = doc.stories.map((s) => ({ ...s, enabled: enabled(s) }));
  expect(await demo.call("PUT", PATH, { body: { stories, revision: doc.revision } }), 200, what);
}

/** Turns every story off; answers what turns the ones that were on back on. */
export async function storiesOff(demo) {
  const doc = await read(demo);
  const on = new Set(doc.stories.filter((s) => s.enabled).map((s) => s.key));
  if (on.size === 0) return async () => undefined;
  await put(demo, doc, () => false, "turning the storyboards off");
  return async () =>
    put(
      demo,
      await read(demo),
      (s) => s.enabled || on.has(s.key),
      "turning the storyboards back on",
    );
}
