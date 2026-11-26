/**
 * Advanced's controls (plan issue-784 D14, D22; pack sheet 4): one entry per token, grouped by what
 * it affects, each in words with its tooltip. The page, its live preview and the browser test all
 * read this table, so a token added to packages/ui without a control fails test/studio-controls.
 * The motion level, `motion_style.speed` and `motion_style.intensity` (the sheet's "strength") have
 * no control: the zone sets the level in Screen settings, and the hype curve covers the rest (D22).
 */
import { cssVar } from "@canccu/ui";

export type ControlGroup = "colours" | "type" | "shapes" | "screen" | "motion";

export interface Control {
  group: ControlGroup;
  /** `<group>.<name>` as `PATCH …/draft/tokens` takes it. */
  token: string;
  label: string;
  /** The line under the label: what it colours or moves. */
  what: string;
  /** The tooltip behind the ⓘ. */
  hint: string;
  control: "colour" | "font" | "slider" | "chips";
  /** A slider's ends, in px. */
  range?: [number, number];
  step?: number;
  /** A chip row's values and their words. */
  options?: [string, string][];
  /**
   * The custom property the live preview sets in the frames. The motion style has no token CSS of
   * its own (the player applies it as classes from the saved draft), so its two are the preview's.
   */
  cssVar: string;
}

export const GROUPS: [ControlGroup, string, string][] = [
  ["colours", "Colours", "For the screens, the hub and the organiser pages."],
  ["type", "Type", "The fonts every surface uses."],
  ["shapes", "Shapes and spacing", "Corners, lines and room between boxes, on every surface."],
  ["screen", "Screen", "Only the venue screens."],
  ["motion", "Motion", "How the screens' effects feel."],
];

const colour = (name: string, label: string, what: string, hint: string): Control => ({
  group: "colours",
  token: `colors.${name}`,
  label,
  what,
  hint,
  control: "colour",
  cssVar: cssVar("color", name),
});

const font = (name: string, label: string, what: string, hint: string): Control => ({
  group: "type",
  token: `fonts.${name}`,
  label,
  what,
  hint,
  control: "font",
  cssVar: cssVar("font", name),
});

const slider = (
  group: ControlGroup,
  name: string,
  label: string,
  what: string,
  hint: string,
  range: [number, number],
  step = 1,
): Control => ({
  group,
  token: `sizes.${name}`,
  label,
  what,
  hint,
  control: "slider",
  range,
  step,
  cssVar: cssVar("size", name),
});

export const ADVANCED_CONTROLS: readonly Control[] = [
  colour(
    "background",
    "Background",
    "Behind everything",
    "The colour behind every screen and page. Text and boxes sit on it.",
  ),
  colour(
    "surface",
    "Boxes",
    "Cards and boxes",
    "Cards, boxes and panels on every surface. Text sits on it too, so it needs to read well.",
  ),
  colour(
    "border",
    "Lines",
    "Edges of boxes and fields",
    "The edges of boxes, fields and dividers.",
  ),
  colour(
    "text",
    "Text",
    "Titles and body text",
    "Most words on every surface. It reads on the background and on boxes.",
  ),
  colour(
    "text_muted",
    "Quiet text",
    "Times, places, second lines",
    "Times, places and other second lines. Text needs at least 4.5:1 on the background to read well.",
  ),
  colour(
    "primary",
    "Main colour",
    "Buttons, the countdown",
    "Buttons, the countdown and what the event wants seen first.",
  ),
  colour(
    "primary_text",
    "Text on the main colour",
    "Words on buttons",
    "Words drawn on the main colour, such as a button's label.",
  ),
  colour(
    "accent",
    "Second colour",
    "Labels and glows",
    "Labels, highlights and the screen's glows.",
  ),
  colour("status_ok", "All good", "Open, on time", "Shows that something is open or on time."),
  colour(
    "status_degraded",
    "Needs a look",
    "Late, almost full",
    "Shows that something is late or almost full.",
  ),
  colour(
    "status_down",
    "Problem",
    "Closed, cancelled",
    "Shows that something is closed, cancelled or down.",
  ),
  font("heading", "Headings", "Titles on every page", "Titles of pages, boxes and screens."),
  font(
    "body",
    "Text",
    "Everything else",
    "Everything that is no title: lists, descriptions and buttons.",
  ),
  font(
    "display",
    "Big screen numbers",
    "Countdowns and scores",
    "The big numbers on the screens: countdowns, clocks and scores.",
  ),
  font(
    "mono",
    "Fixed-width text",
    "Codes and number tables",
    "Pairing codes and tables of numbers, where each character takes the same width.",
  ),
  slider(
    "shapes",
    "radius",
    "Corner roundness",
    "Boxes, buttons and pictures",
    "How round the corners of boxes, buttons and pictures are. 0 is square.",
    [0, 24],
  ),
  slider(
    "shapes",
    "border_width",
    "Line width",
    "Edges of boxes",
    "How thick the edges of boxes and fields are. 0 draws none.",
    [0, 4],
  ),
  slider(
    "shapes",
    "gap",
    "Space between boxes",
    "On every page",
    "The room between boxes and between a box's parts.",
    [8, 32],
  ),
  slider(
    "screen",
    "safe_inset",
    "Edge margin on screens",
    "Keeps text off the TV's edge",
    "Some TVs cut off the outer edge of the picture. Raise this if text touches the edge on yours.",
    [24, 96],
    4,
  ),
  {
    group: "motion",
    token: "motion_style.pack",
    label: "Motion style",
    what: "How the screen's effects feel",
    hint: "Standard is calm and clean, Broadcast moves like TV graphics, Arcade like a game.",
    control: "chips",
    options: [
      ["standard", "Standard"],
      ["broadcast", "Broadcast"],
      ["arcade", "Arcade"],
    ],
    cssVar: "--canccu-motion-pack",
  },
  {
    group: "motion",
    token: "motion_style.spotlight",
    label: "Countdown spotlight",
    what: "The countdown's last five minutes",
    hint: "How the countdown stands out in its last five minutes before a start.",
    control: "chips",
    options: [
      ["glow_and_trace", "Glow and tracing border"],
      ["glow", "Glow"],
      ["trace", "Tracing border"],
    ],
    cssVar: "--canccu-motion-spotlight",
  },
];

/** A size token in px for its slider: px as it is, rem at the platform's 16 px, else undefined. */
export function pxOf(value: string | undefined): number | undefined {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value?.trim() ?? "");
  if (m === null) return undefined;
  const n = Number(m[1]);
  return m[2] === "rem" ? n * 16 : n;
}
