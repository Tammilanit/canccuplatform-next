/**
 * The sound desk's words (#626, the step 4 polish sheets 01–04): each cue's plain name before its
 * id (the book's O9 listed raw ids), each category's level and rules in a sentence, and the log's
 * outcomes as the sheets name them ("suppressed" reads "Held back"; the codes stay as they are).
 */
import { CALM, CATEGORIES } from "./catalog.js";
import type { Category, SoundSettings } from "./catalog.js";

const NAMES: Record<string, string> = {
  "announce.attention": "Announcement",
  "announce.urgent": "Urgent announcement",
  "announce.result": "Result announced",
  "announce.ended": "Announcement over",
  "announce.cleared": "All clear",
  "emergency.start": "Emergency",
  "poll.open": "Poll opens",
  "poll.result": "Poll result",
  "nowplaying.start": "Now playing",
  "ticker.message": "Ticker message",
  "photo.showcase": "Photo showcase",
  "cast.live": "Stream goes live",
  "cast.ended": "Stream over",
  "tournament.pre": "Tournament about to start",
  "tournament.start": "Tournament starts",
  "tournament.post": "Tournament over",
  "chrome.hot": "Hot game chip",
  "chrome.voice": "Voice chip",
  "chrome.spike": "Spike chip",
  "strip.tournament_next": "Next tournament soon",
  "strip.finals_open": "Finals open",
  "strip.finals_start": "Finals start",
  "pizza.open": "Pizza orders open",
  "pizza.closed": "Pizza orders closed",
  "pizza.placed": "Pizza is here",
  "story.doors": "Doors open",
  "story.midnight": "Midnight",
  "story.meal": "Meal time",
  "story.checkin": "Check-in",
  "story.record": "New record",
  "story.photo": "Photo time",
  "story.draw": "Prize draw",
  "story.chime": "Storyboard chime",
  sound_check: "Sound check",
  "story.video": "Storyboard video",
};

/** A built-in's plain name; an event's own reads as its id in words ("raffle.draw": "Raffle draw"). */
export function cueTitle(name: string): string {
  const known = NAMES[name];
  if (known !== undefined) return known;
  const words = name.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const categoryName = (c: Category): string => {
  const words = c.replace("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "result and attention": a list in words. */
export const listed = (items: string[]): string =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

/** The category's level and rules in a sentence, as the editor states it under its chips. */
export function categoryMeaning(c: Category, s: SoundSettings): string {
  const above = CATEGORIES.slice(0, CATEGORIES.indexOf(c)).map((x) =>
    categoryName(x).toLowerCase(),
  );
  const waits = c === "urgent" ? "interrupts whatever plays" : `waits behind ${listed(above)}`;
  const calm =
    c === "urgent"
      ? "plays at calm and in a quiet scene"
      : CALM.has(c)
        ? "plays at calm"
        : "is silent at calm";
  const off = s.categories[c].enabled ? "" : " It is off for this event.";
  return `${categoryName(c)} plays at ${String(s.categories[c].level)} %, ${waits}, and ${calm}.${off}`;
}

/** The log's outcomes in words (contracts/moments.md, The sound log). */
export const OUTCOMES: Record<string, string> = {
  played: "Played",
  queued: "Waited",
  suppressed: "Held back",
  missed: "Missed",
  dropped: "Dropped",
};

/** A length in words: "Off", "30 s", "2 min", "1 min 30 s". */
export function seconds(n: number, zero = "Off"): string {
  if (n === 0) return zero;
  if (n < 60) return `${String(n)} s`;
  const m = Math.floor(n / 60);
  return n % 60 === 0 ? `${String(m)} min` : `${String(m)} min ${String(n % 60)} s`;
}
