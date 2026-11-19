/**
 * The domain events a story fires on or ends with, in words (#638, P14): "a match is called",
 * as an item trigger reads "a tournament item starts" (P11), never `tournament.match.called`.
 */
import { DOMAIN_TYPES } from "./model.js";

const WORDS: Readonly<Record<keyof typeof DOMAIN_TYPES, string>> = {
  "tournament.registration.opened": "registration opens",
  "tournament.registration.closed": "registration closes",
  "tournament.checkin.opened": "check-in opens",
  "tournament.checkin.closed": "check-in closes",
  "tournament.match.called": "a match is called",
  "tournament.match.started": "a match starts",
  "tournament.match.finished": "a match ends",
  "tournament.round.started": "a tournament round starts",
  "pizza.order.opened": "a pizza order opens",
  "pizza.order.closing": "a pizza order is about to close",
  "pizza.order.placed": "a pizza order is placed",
  "pizza.order.arrived": "the pizzas arrive",
  "pizza.order.closed": "a pizza order closes",
  "games.surge.started": "a game surges",
  "screen.photo.added": "a photo is added",
};

/** An event type in words, lower case; one not listed reads as its parts. */
export const eventWords = (type: string): string =>
  WORDS[type] ?? type.replace(/[._]+/g, " ").trim();

export const capital = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
