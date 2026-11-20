/**
 * The catalogue's other "every event" presets, on by default (the storyboards plan, The preset
 * catalogue (final): 6–11, 20–22, 24; #602). Presets 20 and 22 wait for events that steps 5 and
 * 7 emit (`pizza.order.closing`, `tournament.round.started`, provisional in contracts/events.md):
 * until then they are on and idle.
 */
import { EMPTY_CONDITIONS } from "./model.js";
import {
  NO_END,
  ONE_ROUND,
  TAKE,
  card,
  domain,
  every,
  food,
  hub,
  item,
  offsets,
  preset,
  step,
  sting,
} from "./preset-steps.js";

export const MEAL_SERVED = preset({
  key: "meal_served",
  name: "Meal is served",
  triggers: [item(["meal"], "start")],
  steps: [
    sting("Food is served", 3, { cue: "story.meal" }),
    card("{item.title} is served", "{item.location|Come and eat}", 20, { message: true }),
  ],
  rounds: every(5),
  end: { ...NO_END, rounds: 3, until_event: { kind: "item_ends" } },
});

export const QUIET_HOURS_SOON = preset({
  key: "quiet_hours_soon",
  name: "Quiet hours soon",
  triggers: [item(["quiet_hours"], "start")],
  steps: [
    card("Quiet hours from {item.starts_at}", "Headphones on, voices down", 20, {
      message: true,
      cue: "story.chime",
    }),
  ],
  rounds: offsets(-15, -5),
  end: { ...NO_END, until_event: { kind: "item_starts" } },
  // Played as quiet hours start, so calm and silent: it holds the scene's hand-over (SD9).
  finale: [card("Good night", "Quiet hours have started", 10, { transition: "fade" })],
});

export const GOOD_MORNING = preset({
  key: "good_morning",
  name: "Good morning",
  triggers: [item(["quiet_hours"], "end")],
  steps: [
    card("Good morning", "{event.name}", 10, { cue: "story.chime", transition: "fade" }),
    step(
      "title_card",
      {
        title: "Today at {event.name}",
        subtitle: "The whole run of show is on the hub",
        image_url: null,
        ...hub("Today's run of show"),
      },
      30,
      { message: true },
    ),
  ],
  ...ONE_ROUND,
});

export const CHECKIN_OPEN = preset({
  key: "checkin_open",
  name: "Check-in open",
  triggers: [domain("tournament.checkin.opened")],
  steps: [
    card(
      "Check in for {session.name|the next session}",
      "Until {checkin.closes_at|the session starts}: check in on the hub",
      20,
      { message: true, cue: "story.checkin" },
    ),
  ],
  rounds: every(10),
  end: { ...NO_END, until_event: { kind: "domain", type: "tournament.checkin.closed" } },
});

export const PIZZA_ORDER_OPEN = preset({
  key: "pizza_order_open",
  name: "Pizza order open",
  triggers: [domain("pizza.order.opened")],
  steps: [
    step(
      "title_card",
      {
        title: "Pizza order open",
        subtitle: "Order in the hub before {order.target_at|it closes}",
        image_url: null,
        ...food("Order pizza in the hub"),
      },
      20,
      { message: true, cue: "pizza.open" },
    ),
  ],
  rounds: every(10),
  end: { ...NO_END, rounds: 6, until_event: { kind: "domain", type: "pizza.order.closed" } },
  finale: [card("Order closed", "Thanks for ordering", 8, { cue: "pizza.closed" })],
});

export const CLOSING_TIME = preset({
  key: "closing_time",
  name: "Closing time",
  triggers: [
    { kind: "clock", mode: "event_end", at: null, every_minutes: null, from: null, until: null },
  ],
  steps: [
    card("{event.name} ends at {event.ends_at}", "Pack up, take your trash", 20, {
      message: true,
      cue: "story.chime",
    }),
    card("Thank you for coming", "See you at the next one", 15),
  ],
  rounds: offsets(-60, -30, -10),
  end: { ...NO_END, rounds: 3 },
  sound: "first_and_last",
});

export const PIZZA_LAST_CALL = preset({
  key: "pizza_last_call",
  name: "Pizza last call",
  triggers: [domain("pizza.order.closing"), TAKE],
  steps: [
    sting("Last call", 3, { cue: "pizza.open" }),
    step(
      "title_card",
      {
        title: "Last call: pizza order closes at {order.closes_at|any minute}",
        subtitle: "Order in the hub now",
        image_url: null,
        ...food("Order pizza in the hub"),
      },
      20,
      { message: true },
    ),
  ],
  // `pizza.order.closing` comes 10 minutes before the close: these are −10 and −2 of it.
  rounds: offsets(0, 8),
  end: { ...NO_END, until_event: { kind: "domain", type: "pizza.order.closed" } },
});

export const PIZZA_ARRIVED = preset({
  key: "pizza_arrived",
  name: "Pizza orders ready",
  triggers: [domain("pizza.order.arrived")],
  steps: [
    sting("Pizza is here", 3, { cue: "pizza.placed" }),
    card("Pizza is here", "Order {order.seq|ready}: come and get it", 20, { message: true }),
  ],
  rounds: every(5),
  // An arrived order is already closed, so no close can end it: the count does, or the order's
  // done once everyone got theirs, whichever comes first.
  end: { ...NO_END, rounds: 3, until_event: { kind: "domain", type: "pizza.order.done" } },
});

export const ROUND_START = preset({
  key: "round_start",
  name: "Round start",
  triggers: [domain("tournament.round.started"), TAKE],
  conditions: { ...EMPTY_CONDITIONS, once: "source" },
  steps: [
    sting("Next round", 3, { cue: "tournament.start" }),
    card("{session.name|The tournament}: round {round.number|} starts now", "Good luck", 20, {
      message: true,
    }),
  ],
  ...ONE_ROUND,
});

/** Champion's card again, 10 and 30 minutes later, silent; on and off with Champion by default. */
export const CHAMPION_REPLAY = preset({
  key: "champion_replay",
  name: "Champion replay",
  triggers: [domain("tournament.match.finished", true), TAKE],
  steps: [
    card("{winner.name|Our champion}", "{session.game|The final} champion", 20, { message: true }),
  ],
  rounds: offsets(10, 30),
  end: { ...NO_END, rounds: 2 },
});
