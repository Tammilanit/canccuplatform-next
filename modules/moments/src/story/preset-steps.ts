/**
 * The presets' building blocks (the storyboards plan, The preset catalogue (final)): a step at
 * ×1, a `title_card` message card (SL3), and the ends with only the crew's Stop loop, which each
 * preset narrows. A countdown with an empty `target_at` counts to the trigger time T.
 */
import { EMPTY_CONDITIONS } from "./model.js";
import type { Ends, Round, Rounds, Story, StoryStep, Trigger } from "./model.js";

export const step = (
  template: string,
  content: Record<string, unknown>,
  s: number,
  o: Partial<StoryStep> = {},
): StoryStep => ({
  template,
  content,
  duration_seconds: s,
  transition: template === "sting" ? "flash" : "rise",
  cue: null,
  on_the_dot: false,
  message: false,
  ...o,
});

export const card = (title: string, subtitle: string, s: number, o: Partial<StoryStep> = {}) =>
  step("title_card", { title, subtitle, image_url: null }, s, o);

export const sting = (text: string, s: number, o: Partial<StoryStep> = {}) =>
  step("sting", { text, image_url: null }, s, o);

/**
 * The hub, where a QR points: Moments does not read the venue's Wi-Fi or Notify's rotating code,
 * since a claim carries its whole view-model.
 */
export const hub = (label: string) => ({ qr: { path: "/notify/", label } });

export const NO_END: Ends = {
  rounds: null,
  for_minutes: null,
  until_clock: null,
  until_event: null,
  crew: true,
};

type Spec = Omit<Partial<Story>, "round"> &
  Pick<Story, "key" | "name" | "triggers" | "rounds" | "end"> & {
    steps: StoryStep[];
    repeat?: Round["repeat"];
    hold_seconds?: Round["hold_seconds"];
  };

/** A preset with the usual defaults: on, every zone, per source, hero → rail, first round sounds. */
export const preset = ({ steps, repeat = null, hold_seconds = null, ...o }: Spec): Story => ({
  preset: o.key,
  enabled: true,
  conditions: { ...EMPTY_CONDITIONS },
  run_mode: "per_source",
  full_screen: false,
  finale: null,
  sound: "first",
  ...o,
  round: { steps, repeat, hold_seconds },
});

export const item = (kinds: string[], anchor: "start" | "end"): Trigger => ({
  kind: "item",
  kinds,
  item_id: null,
  anchor,
});
export const domain = (type: string, final_only = false): Trigger => ({
  kind: "domain",
  type,
  final_only,
});
export const clockEvery = (every_minutes: number, from: string, until: string): Trigger => ({
  kind: "clock",
  mode: "every",
  at: null,
  every_minutes,
  from,
  until,
});
export const TAKE: Trigger = { kind: "take" };
export const ONE_ROUND = {
  rounds: { mode: "offsets", offsets_minutes: [0] } as Rounds,
  end: { ...NO_END, rounds: 1 },
};
export const every = (every_minutes: number): Rounds => ({
  mode: "every",
  every_minutes,
  from_minutes: 0,
});
export const offsets = (...offsets_minutes: number[]): Rounds => ({
  mode: "offsets",
  offsets_minutes,
});
