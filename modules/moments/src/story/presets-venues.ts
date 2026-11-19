/**
 * The catalogue's "some venues" presets, off by default: each event turns on what fits its venue
 * (the storyboards plan, The preset catalogue (final): 12–19, 23; #602). Prize draw and Group
 * photo name no item until the organiser picks one (an item trigger with no kind and no item
 * never fires; a take asks for the item), and Premiere's `clock once` has no time until one is
 * set, so the presets pass validation off and on.
 */
import { EMPTY_CONDITIONS } from "./model.js";
import {
  NO_END,
  ONE_ROUND,
  TAKE,
  card,
  clockEvery,
  domain,
  every,
  hub,
  item,
  offsets,
  preset,
  step,
  sting,
} from "./preset-steps.js";

const off = { enabled: false };

export const ARRIVAL_CHECKIN = preset({
  ...off,
  key: "arrival_checkin",
  name: "Arrival check-in",
  triggers: [item(["doors"], "start")],
  steps: [step("qr", hub("Check in at the door"), 30, { message: true })],
  rounds: every(30),
  end: { ...NO_END, rounds: 6 },
});

/** The cooldown is the story's: a second surge within 30 minutes, of any game, waits. */
export const HOT_GAME = preset({
  ...off,
  key: "hot_game",
  name: "Hot game",
  triggers: [domain("games.surge.started")],
  conditions: { ...EMPTY_CONDITIONS, cooldown_minutes: 30 },
  steps: [
    sting("Hot right now", 3, { cue: "chrome.hot" }),
    card("{game.name|A game} is hot", "{game.players|Many} playing now", 30, { message: true }),
  ],
  ...ONE_ROUND,
});

export const RECORD_CROWD = preset({
  ...off,
  key: "record_crowd",
  name: "Record crowd",
  triggers: [{ kind: "milestone", count: "online", at: null }],
  conditions: { ...EMPTY_CONDITIONS, once: "day" },
  steps: [
    sting("New record", 3, { cue: "story.record" }),
    card("{milestone.value|So many} of us online", "A new record for {event.name}", 15, {
      message: true,
    }),
  ],
  ...ONE_ROUND,
});

export const SPONSOR_THANKS = preset({
  ...off,
  key: "sponsor_thanks",
  name: "Sponsor thanks",
  triggers: [clockEvery(60, "10:00", "22:00")],
  steps: [
    card("Thanks to our sponsors", "{event.name} is made possible by them", 15, { message: true }),
  ],
  ...ONE_ROUND,
});

export const PRIZE_DRAW = preset({
  ...off,
  key: "prize_draw",
  name: "Prize draw",
  triggers: [item([], "start"), TAKE],
  steps: [
    card("Prize draw at {item.starts_at}", "{item.location|On stage}", 20, { message: true }),
  ],
  rounds: offsets(-10, -2),
  end: { ...NO_END, until_event: { kind: "item_starts" } },
  finale: [card("Prize draw now", "{item.location|On stage}", 10, { cue: "story.draw" })],
});

export const GROUP_PHOTO = preset({
  ...off,
  key: "group_photo",
  name: "Group photo",
  triggers: [item([], "start"), TAKE],
  steps: [
    card("Group photo · {item.location|by the stage}", "At {item.starts_at}: everyone in", 20, {
      message: true,
      cue: "story.photo",
    }),
  ],
  rounds: offsets(-10, -3),
  end: { ...NO_END, until_event: { kind: "item_starts" } },
  finale: [card("Group photo now", "{item.location|By the stage}", 8)],
  sound: "last",
});

export const VENUE_INFO = preset({
  ...off,
  key: "venue_info",
  name: "Venue info",
  triggers: [clockEvery(45, "09:00", "23:00")],
  steps: [
    step(
      "title_card",
      {
        title: "Venue info",
        subtitle: "Wi-Fi, the floor plan and the house rules",
        image_url: null,
        ...hub("Venue info in the hub"),
      },
      20,
      { message: true },
    ),
    card("Floor plan", "Find your way: the plan is on the hub", 15),
  ],
  ...ONE_ROUND,
});

export const STAGE_BREAK = preset({
  ...off,
  key: "stage_break",
  name: "Stage break",
  triggers: [item(["tournament", "ceremony"], "end")],
  conditions: { ...EMPTY_CONDITIONS, item_zone: true },
  steps: [card("Back at {next.starts_at}", "{next.title}", 30, { message: true })],
  rounds: every(5),
  end: { ...NO_END, until_event: { kind: "next_item_starts" } },
});

/**
 * Countdown → video → after-card (PV1, mockup 22). Its `{item.*}` placeholders carry a fallback,
 * since a `clock once` and a take without an item fill none (SD3); the video lands on the item's
 * time (on the dot). The organiser picks the video before turning it on.
 */
export const PREMIERE = preset({
  ...off,
  key: "premiere",
  name: "Premiere",
  triggers: [
    item(["premiere"], "start"),
    TAKE,
    { kind: "clock", mode: "once", at: null, every_minutes: null, from: null, until: null },
  ],
  conditions: { ...EMPTY_CONDITIONS, quiet: "skip", once: "source" },
  steps: [
    step(
      "countdown",
      {
        label: "{item.title|The premiere}",
        target_at: "",
        ends_text: "",
        // No clock time: a take's countdown runs 30 s whatever the item's time (S3, #625).
        description: "Lights down, sound up",
      },
      30,
      { message: true },
    ),
    step("video", { asset_id: "" }, 1, { on_the_dot: true, transition: "fade" }),
    card("Thanks for watching", "{again|See you at the next one}", 15, { transition: "fade" }),
  ],
  ...ONE_ROUND,
});
