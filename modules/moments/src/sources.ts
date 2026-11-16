/**
 * Live data for moments (contracts/moments.md, Live and interactive; D18): the latest
 * leaderboard and each session with its matches, kept from the tournament's catalog events, and
 * the view-models a bound moment shows. When a source changes, every moment bound to it gets the
 * new content through `.changed`. Until the source has spoken, a placeholder says so.
 */
import type { Event, SqlClient } from "@canccu/kit";
import type { Engine } from "./engine.js";
import { runningMoments } from "./store.js";
import type { Binding, MomentRow } from "./store.js";

type Data = Record<string, unknown>;
const obj = (v: unknown): Data => (typeof v === "object" && v !== null ? (v as Data) : {});
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const names = (people: unknown): string[] => list(people).map((p) => str(p.name));

export const COLLECTING = "Collecting standings…";

/** The `leaderboard` widget's view-model from the event's `top` (contracts/screen.md, Widgets). */
export function leaderboardView(top: unknown): Data {
  const rows = list(top).map((r) => ({
    rank: r.rank,
    name: str(obj(r.person).name),
    points: r.points,
    is_finalist: r.is_finalist === true,
  }));
  return { title: rows.length > 0 ? "Standings" : COLLECTING, rows };
}

async function put(c: SqlClient, kind: string, ref: string, data: Data, revision: number) {
  await c.query(
    `INSERT INTO moments_sources (kind, ref, data, revision) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, kind, ref) DO UPDATE SET data = EXCLUDED.data,
       revision = EXCLUDED.revision
     WHERE moments_sources.revision <= EXCLUDED.revision`,
    [kind, ref, data, revision],
  );
}

/**
 * Keeps what a binding shows; answers the binding the event touched, or null. Delivery is at
 * least once and out of turn, so each source keeps its newest revision (contracts/events.md).
 */
export async function recordSource(c: SqlClient, e: Event): Promise<Binding | null> {
  const d = e.data;
  const at = Date.parse(e.time);
  if (e.type === "tournament.leaderboard.changed") {
    await put(c, "leaderboard", "", { top: d.top }, Number(d.leaderboard_version) || 0);
    return { source: "leaderboard" };
  }
  if (!e.type.startsWith("tournament.")) return null;
  const session = obj(d.session);
  const sessionId = str(session.id) || str(d.session_id);
  if (str(session.id) !== "")
    await put(c, "session", sessionId, session, Number(session.revision) || 0);
  const match = obj(d.match);
  const matchId = str(match.id) || str(d.match_id);
  if (matchId !== "") {
    const { rows } = await c.query(
      `SELECT data FROM moments_sources WHERE kind = 'match' AND ref = $1`,
      [matchId],
    );
    const before = obj(rows[0]?.data);
    const results = Array.isArray(d.results) ? d.results : before.results;
    await put(
      c,
      "match",
      matchId,
      {
        ...before,
        ...(str(match.id) ? { match } : {}),
        session_id: sessionId || before.session_id,
        results,
      },
      at,
    );
  }
  return sessionId === "" ? null : { source: "session", ref: sessionId };
}

/** The `bracket` widget's view-model for a session, from the kept session and its matches. */
async function bracketView(c: SqlClient, sessionId: string): Promise<Data> {
  const { rows } = await c.query(
    `SELECT kind, data FROM moments_sources
     WHERE (kind = 'session' AND ref = $1) OR (kind = 'match' AND data->>'session_id' = $1)`,
    [sessionId],
  );
  const session = obj(rows.find((r) => r.kind === "session")?.data);
  const matches = rows.filter((r) => r.kind === "match").map((r) => obj(r.data));
  const order = list(session.matches).map((m) => str(m.id));
  const gameName = str(obj(session.game).name);
  return {
    title: gameName === "" ? "Collecting the bracket…" : gameName,
    session: { id: sessionId, game_name: gameName, status: str(session.status) },
    matches: matches
      .sort((a, b) => order.indexOf(str(obj(a.match).id)) - order.indexOf(str(obj(b.match).id)))
      .map((m) => {
        const match = obj(m.match);
        const state = match.finished_at ? "finished" : match.started_at ? "running" : "called";
        return {
          label: str(match.label),
          state,
          teams: list(match.teams).map((t) => ({
            name: str(t.name) || names(t.people).join(" & "),
            names: names(t.people),
          })),
          results: list(m.results).map((r) => ({
            rank: r.rank,
            names: names(r.people),
            points: r.points,
          })),
        };
      }),
  };
}

/** What a binding shows now. */
export async function renderBinding(c: SqlClient, b: Binding): Promise<Data | null> {
  if (b.source === "leaderboard") {
    const { rows } = await c.query(
      `SELECT data FROM moments_sources WHERE kind = 'leaderboard' AND ref = ''`,
      [],
    );
    return leaderboardView(obj(rows[0]?.data).top);
  }
  if (b.source === "session" && typeof b.ref === "string") return bracketView(c, b.ref);
  return null;
}

/** Sends the new content to every running moment bound to `b`; its QR and crew mark stay. */
export async function refreshBound(
  c: SqlClient,
  engine: Engine,
  b: Binding,
  now: Date,
): Promise<void> {
  const bound: MomentRow[] = await runningMoments(
    c,
    "binding->>'source' = $1 AND coalesce(binding->>'ref', '') = $2",
    [b.source, b.ref ?? ""],
    "wait",
  );
  if (bound.length === 0) return;
  const view = await renderBinding(c, b);
  if (view === null) return;
  for (const m of bound) {
    const keep: Data = {};
    for (const k of ["qr", "from_crew"]) if (k in m.content) keep[k] = m.content[k];
    await engine.setContent(c, m, { ...view, ...keep }, now);
  }
}
