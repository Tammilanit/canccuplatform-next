/**
 * The five L5 presets (the storyboards plan, The preset catalogue (final), 1–5; #114). The
 * check-in and venue cards point at the hub with a QR, as every preset's do.
 */
import { EMPTY_CONDITIONS } from "./model.js";
import type { Story } from "./model.js";
import { NO_END, card, hub, step } from "./preset-steps.js";

export const L5_PRESETS: readonly Story[] = [
  {
    key: "doors_open",
    name: "Doors open",
    preset: "doors_open",
    enabled: true,
    triggers: [{ kind: "item", kinds: ["doors"], item_id: null, anchor: "start" }],
    conditions: { ...EMPTY_CONDITIONS },
    run_mode: "per_source",
    full_screen: false,
    round: {
      steps: [
        step("sting", { text: "Doors are open", image_url: null }, 3, { cue: "story.doors" }),
        card("Welcome to {event.name}", "Find your seat, say hi, have fun", 20, { message: true }),
        step(
          "title_card",
          {
            title: "Wi-Fi and venue info",
            subtitle: "Open the hub",
            image_url: null,
            ...hub("Venue info in the hub"),
          },
          20,
        ),
        step("qr", hub("Check in at the door"), 20),
      ],
      repeat: null,
      hold_seconds: null,
    },
    rounds: { mode: "every", every_minutes: 10, from_minutes: 0 },
    end: { ...NO_END, rounds: 3 },
    finale: null,
    sound: "first",
  },
  {
    key: "starting_soon",
    name: "Starting soon",
    preset: "starting_soon",
    enabled: true,
    triggers: [
      { kind: "item", kinds: ["tournament", "ceremony"], item_id: null, anchor: "start" },
      { kind: "take" },
    ],
    conditions: { ...EMPTY_CONDITIONS },
    run_mode: "per_source",
    full_screen: false,
    round: {
      steps: [
        step("sting", { text: "Starting soon", image_url: null }, 3, { cue: "tournament.pre" }),
        step(
          "countdown",
          {
            label: "{item.title}",
            target_at: "",
            ends_text: "{item.location|the stage} · in {item.starts_in}",
          },
          20,
          { message: true },
        ),
      ],
      repeat: { from: 0, to: 1, times: 2 },
      hold_seconds: null,
    },
    rounds: { mode: "offsets", offsets_minutes: [-15, -5, -1] },
    end: { ...NO_END, until_event: { kind: "item_starts" } },
    finale: [
      card("It's on!", "{item.title} · {item.location|the stage}", 8, {
        cue: "tournament.start",
        transition: "flash",
      }),
    ],
    sound: "first_and_last",
  },
  {
    key: "match_called",
    name: "Match called",
    preset: "match_called",
    enabled: true,
    triggers: [{ kind: "domain", type: "tournament.match.called", final_only: false }],
    conditions: { ...EMPTY_CONDITIONS },
    run_mode: "per_source",
    full_screen: false,
    round: {
      steps: [
        card("Match called: {match.label}", "{match.teams} · {session.game}", 30, {
          message: true,
          cue: "tournament.start",
        }),
      ],
      repeat: null,
      hold_seconds: null,
    },
    rounds: { mode: "every", every_minutes: 2, from_minutes: 0 },
    end: {
      ...NO_END,
      rounds: 3,
      until_event: { kind: "domain", type: "tournament.match.started" },
    },
    finale: null,
    sound: "first",
  },
  {
    key: "champion",
    name: "Champion",
    preset: "champion",
    enabled: true,
    triggers: [
      { kind: "domain", type: "tournament.match.finished", final_only: true },
      { kind: "take" },
    ],
    conditions: { ...EMPTY_CONDITIONS },
    run_mode: "per_source",
    full_screen: false,
    round: {
      steps: [
        step("sting", { text: "And the champion is…", image_url: null }, 4),
        card("{winner.name|Our champion}", "{session.game|The final} champion", 30, {
          message: true,
          cue: "tournament.post",
        }),
        card("{session.name|The bracket}", "Thanks to every player", 20),
        step("qr", hub("Share your photos"), 15),
      ],
      repeat: null,
      hold_seconds: null,
    },
    rounds: { mode: "offsets", offsets_minutes: [0] },
    end: { ...NO_END, rounds: 1 },
    finale: null,
    sound: "first",
  },
  {
    key: "midnight",
    name: "Midnight",
    preset: "midnight",
    enabled: true,
    triggers: [
      { kind: "clock", mode: "daily", at: "00:00", every_minutes: null, from: null, until: null },
    ],
    conditions: { ...EMPTY_CONDITIONS, quiet: "skip" },
    run_mode: "per_source",
    full_screen: true,
    round: {
      steps: [
        step("countdown", { label: "Midnight", target_at: "", ends_text: "" }, 10, {
          cue: "story.midnight",
        }),
        step("sting", { text: "Midnight!", image_url: null }, 4, { on_the_dot: true }),
        card("Night {now.day} at {event.name}", "Keep it going", 15, { message: true }),
      ],
      repeat: null,
      hold_seconds: null,
    },
    rounds: { mode: "offsets", offsets_minutes: [0] },
    end: { ...NO_END, rounds: 1 },
    finale: null,
    sound: "first",
  },
];
