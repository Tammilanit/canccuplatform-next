/**
 * Catalog events the built-in rules follow, shaped as contracts/events.md outlines them, for the
 * emitters that land in later steps (D7). rules.test.ts holds each one's fields to the catalog.
 */
import type { Event } from "@canccu/kit";

let n = 0;
export function event(
  type: string,
  data: Record<string, unknown>,
  time = "2026-01-01T19:45:00Z",
): Event {
  n += 1;
  return {
    id: `01928f3e-7a2b-7c4d-9e8f-${String(n).padStart(12, "0")}`,
    type,
    version: 1,
    time,
    source: type.split(".")[0],
    tenant: "demo",
    data,
  } as Event;
}

const person = (id: string, name: string) => ({
  user_id: id,
  discord_user_id: null,
  name,
});
const session = (isFinal: boolean) => ({
  id: "ts_1",
  tournament_id: "tn_1",
  game: { id: "g_1", name: "Demo Game" },
  starts_at: "2026-01-01T19:30:00Z",
  registration_closes_at: "2026-01-01T19:00:00Z",
  ends_at: null,
  status: "running",
  is_final: isFinal,
  checkin_enabled: false,
  matches: [{ id: "tm_1", label: "Heat 1" }],
  voice_plan: "solo",
  registered_count: 2,
  checked_in_count: 0,
  revision: 6,
});
const match = {
  id: "tm_1",
  session_id: "ts_1",
  label: "Heat 1",
  teams: [
    { team_id: null, name: null, user_ids: ["u_1"], people: [person("u_1", "Demo Player")] },
    { team_id: null, name: null, user_ids: ["u_2"], people: [person("u_2", "Demo Player 2")] },
  ],
  called_at: "2026-01-01T19:45:00Z",
  started_at: null,
  finished_at: null,
};
const order = (state: string) => ({
  id: "po_1",
  seq: 1,
  state,
  pizzeria: { id: "pz_1", name: "Demo Pizzeria" },
  target_at: "2026-01-01T18:00:00Z",
  holder: person("u_1", "Demo Player"),
  pizza_count: 6,
  people_count: 4,
  opened_at: "2026-01-01T17:00:00Z",
  closed_at: null,
  placed_at: null,
  arrived_at: null,
  revision: 3,
});
const results = [
  {
    rank: 1,
    team_id: null,
    user_ids: ["u_2"],
    people: [person("u_2", "Demo Player 2")],
    points: 38,
  },
  { rank: 2, team_id: null, user_ids: ["u_1"], people: [person("u_1", "Demo Player")], points: 36 },
];

export const FIXTURES = {
  called: () =>
    event("tournament.match.called", { session: session(false), match, user_ids: ["u_1", "u_2"] }),
  started: () =>
    event("tournament.match.started", {
      session: session(false),
      match: { ...match, started_at: "2026-01-01T19:50:00Z" },
      actor_user_id: null,
    }),
  finished: (isFinal: boolean) =>
    event("tournament.match.finished", {
      session: session(isFinal),
      match,
      results,
      actor_user_id: null,
    }),
  leaderboard: (version: number, points = 38) =>
    event("tournament.leaderboard.changed", {
      leaderboard_version: version,
      top: [
        { rank: 1, person: person("u_2", "Demo Player 2"), points, is_finalist: true },
        { rank: 2, person: person("u_1", "Demo Player"), points: 36, is_finalist: false },
      ],
    }),
  placed: () => event("pizza.order.placed", { order: order("placed"), actor_user_id: "u_1" }),
  arrived: () =>
    event("pizza.order.arrived", {
      order: order("arrived"),
      user_ids: ["u_1"],
      people: [person("u_1", "Demo Player")],
    }),
  cancelled: () =>
    event("pizza.order.cancelled", {
      order: order("cancelled"),
      reason: "cancelled",
      user_ids: [],
      people: [],
      actor_user_id: "u_1",
    }),
  surge: () =>
    event("games.surge.started", {
      game: { id: "g_1", name: "Demo Game", cover_url: null },
      players: 14,
      threshold: 10,
    }),
  surgeEnded: () =>
    event("games.surge.ended", { game: { id: "g_1", name: "Demo Game" }, players: 6 }),
};
