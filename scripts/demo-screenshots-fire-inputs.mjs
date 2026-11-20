// The Fire inputs shot of scripts/demo-screenshots-stories.mjs (#646): two of the event's own
// stories fired by hand whose cards both name `{place}`, so On air's Fire asks it once for each,
// under the story's name. They are taken out again before the shots go on.
import { moments } from "./demo-screenshots-moments.mjs";

const ok = (r, what) => {
  if (r.status !== 200)
    throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const PLACE_KEYS = ["prize_draw_desk", "group_photo_spot"];

/** A story of the event's own fired by hand, its card naming `{place}`. */
const placeStory = (key, name) => ({
  key,
  name,
  preset: null,
  enabled: true,
  triggers: [{ kind: "take" }],
  conditions: {
    zones: [],
    item_zone: false,
    scenes: [],
    not_scenes: [],
    energy_min: null,
    energy_max: null,
    window: null,
    days: [],
    once: null,
    cooldown_minutes: 0,
    quiet: "calm",
  },
  run_mode: "per_source",
  full_screen: false,
  round: {
    steps: [
      {
        template: "title_card",
        content: { title: `${name} at {place}`, subtitle: "", image_url: null },
        duration_seconds: 20,
        transition: "rise",
        cue: null,
        on_the_dot: false,
        message: true,
      },
    ],
    repeat: null,
    hold_seconds: null,
  },
  rounds: { mode: "offsets", offsets_minutes: [0] },
  end: {
    rounds: 1,
    for_minutes: null,
    until_clock: null,
    until_event: null,
    crew: true,
  },
  finale: null,
  sound: "first",
});

/** Adds the two `{place}` stories, or (`on` false) takes them out again. */
export async function placeStories(on) {
  const doc = ok(
    await moments("GET", "/api/moments/storyboards"),
    "the storyboards",
  );
  const rest = doc.stories.filter((s) => !PLACE_KEYS.includes(s.key));
  const stories = on
    ? [
        ...rest,
        placeStory(PLACE_KEYS[0], "Prize draw"),
        placeStory(PLACE_KEYS[1], "Group photo"),
      ]
    : rest;
  if (!on && stories.length === doc.stories.length) return;
  ok(
    await moments("PUT", "/api/moments/storyboards", {
      stories,
      revision: doc.revision,
    }),
    on ? "adding two stories that ask {place}" : "removing the {place} stories",
  );
}
