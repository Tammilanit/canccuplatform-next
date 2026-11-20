/**
 * An order's due steps (the plan's Forgotten orders): what the scheduler does to it, and when, from
 * its state and the event's settings. Pure, so the tick can write them and check each again under
 * the order's lock before it acts.
 */
import type { OrderRow } from "./store.js";
import type { PizzaSettings } from "./settings.js";
import { dayTurn } from "./time.js";

export type ReminderKind = "open_past_target" | "closed_not_placed" | "not_arrived" | "released";
export type Role = "holder" | "crew";

/** A reminder: who hears it, and how many minutes past its anchor it says. */
export interface Remind {
  kind: ReminderKind;
  minutes: number;
  /** `holder`: the holder, or the crew while nobody holds the order. `crew`: the holder too. */
  to: "holder" | "crew" | "crew_only";
  /** Reminders of one family: when a later one is due as well, only the later one is sent. */
  family: string;
}

export interface Due {
  /**
   * The row's key: the step's name and its anchor, `close@<closes_at>`. A sent row stays as the
   * record, so an unchanged anchor runs once, while a reopen with a new close time or a later
   * claim gives the step a new anchor and arms it again.
   */
  step: string;
  due_at: Date;
  /** What the step does; `remind` sends to people, the rest change the order. */
  does: "last_call" | "close" | "remind" | "release" | "done" | "forgotten";
  remind?: Remind;
}

const MIN = 60_000;
const after = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MIN);
const key = (name: string, anchor: Date) => `${name}@${anchor.toISOString()}`;

/** Every step the order has in its state, past ones included; a sent key is never sent again. */
export function dueSteps(o: OrderRow, s: PizzaSettings, timeZone: string): Due[] {
  const out: Due[] = [];
  const reminders = (
    family: string,
    kind: ReminderKind,
    anchor: Date,
    holderAt: number,
    crewAt: number,
    crewOnly = false,
  ) => {
    out.push({
      step: key(`${family}_holder`, anchor),
      due_at: after(anchor, holderAt),
      does: "remind",
      remind: { kind, minutes: holderAt, to: "holder", family },
    });
    out.push({
      step: key(`${family}_crew`, anchor),
      due_at: after(anchor, crewAt),
      does: "remind",
      remind: { kind, minutes: crewAt, to: crewOnly ? "crew_only" : "crew", family },
    });
  };
  if (o.state === "open") {
    out.push({
      step: key("closing", o.closes_at),
      due_at: after(o.closes_at, -s.last_call_minutes),
      does: "last_call",
    });
    if (s.auto_close)
      out.push({ step: key("close", o.closes_at), due_at: o.closes_at, does: "close" });
    else
      reminders(
        "open",
        "open_past_target",
        o.closes_at,
        s.remind_holder_minutes,
        s.remind_crew_minutes,
      );
  } else if (o.state === "closed") {
    // A claim after a release restarts the clock (the legacy rule).
    const since = new Date(Math.max(o.closed_at?.getTime() ?? 0, o.claimed_at?.getTime() ?? 0));
    reminders("closed", "closed_not_placed", since, s.remind_holder_minutes, s.remind_crew_minutes);
    if (o.holder_user_id !== null)
      out.push({
        step: key("release", since),
        due_at: after(since, s.release_after_minutes),
        does: "release",
      });
  } else if (o.state === "placed" && o.placed_at !== null) {
    const [anchor, wait] =
      o.estimate_at !== null
        ? [o.estimate_at, s.arrival_check_minutes]
        : [o.placed_at, s.arrival_check_no_estimate_minutes];
    const gap = Math.max(s.remind_crew_minutes - s.remind_holder_minutes, 0);
    reminders("arrival", "not_arrived", anchor, wait, wait + gap, true);
  } else if (o.state === "arrived" && o.arrived_at !== null) {
    out.push({
      step: key("done", o.arrived_at),
      due_at: after(o.arrived_at, s.done_after_arrival_minutes),
      does: "done",
    });
  }
  if (s.close_forgotten && ["open", "closed", "placed", "arrived"].includes(o.state)) {
    const turn = dayTurn(o.day, timeZone);
    out.push({ step: key("forgotten", turn), due_at: turn, does: "forgotten" });
  }
  return out;
}

/** A reminder more than this late is no news any more: an outage never sends stale ones. */
export const SEND_WINDOW_MS = 30 * MIN;

/** Why a due reminder is passed over, or null to send it. */
export function staleReason(d: Due, all: Due[], now: Date): "late" | "superseded" | null {
  if (d.remind === undefined) return null;
  if (now.getTime() - d.due_at.getTime() > SEND_WINDOW_MS) return "late";
  const later = all.some(
    (x) =>
      x.remind?.family === d.remind?.family &&
      x.due_at.getTime() > d.due_at.getTime() &&
      x.due_at.getTime() <= now.getTime(),
  );
  return later ? "superseded" : null;
}
