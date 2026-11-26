/**
 * What Screen adds to an announcement's claim (contracts/screen.md, Moments drive it: claims; #780):
 * its QR made whole on the event's hostname, and a full screen's nearby content, which only Screen
 * can compose since it alone holds the zone's view-models.
 */
import type { Claim, Override } from "./claims.js";
import { qrImage, viewOf } from "./widgets.js";
import type { ZoneFacts } from "./widgets.js";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A path is safe to join to the origin only when it cannot name another host (`//host`). */
const isPath = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//");

/**
 * An announcement whose `qr.url` is a path: a rule (Pizza is here) knows no hostname, so Screen
 * joins it to the event's and draws the code, as it does for its own `qr` widgets.
 */
export function announceClaim(o: Override, facts: ZoneFacts): Override {
  const qr = o.content.qr;
  if (o.template !== "announcement" || !isObject(qr) || !isPath(qr.url)) return o;
  const url = facts.origin + qr.url;
  const label = typeof qr.label === "string" ? qr.label : "";
  return { ...o, content: { ...o.content, qr: { url, label, image_url: qrImage(url) } } };
}

/** Urgent and the emergency wear no decoration: nothing sits beside them. */
const DECORATED = new Set(["info", "important"]);

/**
 * A full-screen announcement's nearby content: the food box for a pizza-sourced one while it has
 * an order to tell, else now and next; null when neither has anything to show.
 */
export function asideOf(claim: Claim, o: Override, facts: ZoneFacts): Claim["aside"] | null {
  if (claim.role !== "full" || claim.template !== "announcement") return null;
  if (!DECORATED.has(claim.content.level as string)) return null;
  if (o.source_module === "pizza") {
    const food = viewOf("food_status", {}, facts);
    if (!food.empty) return { widget: "food_status", view: food };
  }
  const agenda = viewOf("agenda_now", {}, facts);
  return agenda.empty ? null : { widget: "agenda_now", view: agenda };
}
