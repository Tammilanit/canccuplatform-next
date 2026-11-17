/**
 * The tick's turn for announcements (contracts/moments.md, Sending, scheduling, editing,
 * withdrawing): scheduled ones follow their run-of-show item and go out when due; live ones lose
 * their item (E15), drop the "Updated" chip after 60 s, and end with their card. From the rows
 * alone, so a restart loses nothing.
 */
import type { SqlClient } from "@canccu/kit";
import type { Engine } from "../engine.js";
import { lockMoment } from "../store.js";
import {
  fireAt,
  itemOf,
  joined,
  momentsOf,
  patchMoments,
  send,
  withdrawAnnouncement,
} from "./service.js";
import { openAnnouncements, runOfShow, saveAnnouncement } from "./store.js";
import type { AnnouncementRow, EndReason, RunItem } from "./store.js";

/**
 * Why its item takes it away (E15), or null while the item stands or the run of show is unknown.
 * The `why` goes out on the public `.withdrawn` event and is stored for every announcer, so it
 * names the item only when the item is public: a crew item may time an announcement, never show.
 */
function itemGone(
  a: AnnouncementRow,
  items: RunItem[] | null,
): { reason: EndReason; why: string } | null {
  if (a.item_id === null || items === null) return null;
  const item = itemOf(a, items);
  if (item === null) return { reason: "item_removed", why: "Its run-of-show item was removed." };
  if (item.status !== "cancelled") return null;
  const why =
    item.visibility === "public"
      ? `${item.title} was cancelled.`
      : "Its run-of-show item was cancelled.";
  return { reason: "item_cancelled", why };
}

export async function tickAnnouncements(c: SqlClient, engine: Engine, now: Date): Promise<void> {
  const items = await runOfShow(c);
  for (const a of await openAnnouncements(c, "scheduled")) {
    const gone = itemGone(a, items);
    if (gone !== null) {
      await withdrawAnnouncement(c, engine, a, { ...gone, actor: null }, now);
      continue;
    }
    const at = fireAt(a, items, now);
    if (at !== null && at <= now) {
      await send(c, engine, a, itemOf(a, items), now);
    } else if (at?.getTime() !== a.fire_at?.getTime()) {
      a.fire_at = at;
      await saveAnnouncement(c, a);
    }
  }
  for (const a of await openAnnouncements(c, "live")) {
    const gone = itemGone(a, items);
    if (gone !== null) {
      await withdrawAnnouncement(c, engine, a, { ...gone, actor: null }, now);
      continue;
    }
    if (await endedWithItsMoments(c, engine, a, now)) continue;
    if (a.updated_until !== null && a.updated_until <= now) {
      a.updated_until = null;
      await patchMoments(c, engine, a, joined(a.title ?? "", a.body ?? ""), false, now);
      await saveAnnouncement(c, a);
    }
  }
}

/**
 * Its main moment (the card, else the line) is over: expired, it simply ended; ended by a person
 * on On air, it is withdrawn everywhere, so the bot and the list agree with the screens.
 */
async function endedWithItsMoments(
  c: SqlClient,
  engine: Engine,
  a: AnnouncementRow,
  now: Date,
): Promise<boolean> {
  const main = a.card_moment_id ?? a.line_moment_id;
  // Discord or push only: no moment carries it, so its own time ends it, not the next tick.
  if (main === null && (a.expires_at === null || a.expires_at > now)) return false;
  const m = main === null ? null : await lockMoment(c, main);
  if (m !== null && m.ended_at === null) return false;
  if (m?.end_reason === "cleared") {
    await withdrawAnnouncement(
      c,
      engine,
      a,
      { reason: "ended_on_air", why: "Ended on On air.", actor: null },
      now,
    );
    return true;
  }
  for (const other of await momentsOf(c, a)) await engine.end(c, other, "expired", null, now);
  a.status = "ended";
  a.ended_at = m?.ended_at ?? now;
  a.end_reason = "expired";
  a.updated_until = null;
  await saveAnnouncement(c, a);
  return true;
}
