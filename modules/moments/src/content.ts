/**
 * The crew's requests from their bodies (contracts/moments.md, The crew spotlight; Emergency):
 * what each shows, as the screen's widget view-models, and the QR handoff as Screen draws it.
 */
import qrcode from "qrcode-generator";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { MomentRequest } from "./engine.js";
import { renderBinding } from "./sources.js";
import type { Actor, Binding, Qr } from "./store.js";

type Data = Record<string, unknown>;

export const invalid = (message: string): KitError =>
  new KitError(message, { status: 400, code: "invalid_request" });

const ZONE_KEY = /^[a-z0-9_-]{2,32}$/;

export function zonesOf(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((z) => typeof z === "string" && ZONE_KEY.test(z))) {
    throw invalid("`zones` lists zone keys.");
  }
  return [...new Set(v as string[])];
}

function text(v: unknown, field: string, max: number, required = false): string | null {
  if (v === undefined || v === null || v === "") {
    if (required) throw invalid(`\`${field}\` is required.`);
    return null;
  }
  if (typeof v !== "string" || v.length > max)
    throw invalid(`\`${field}\` is text of at most ${max} characters.`);
  return v.trim();
}

const path = (v: unknown): boolean =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && v.length <= 512;

export function qrOf(v: unknown): Qr | null {
  if (v === undefined || v === null) return null;
  const q = v as Data;
  if (
    typeof v !== "object" ||
    !path(q.path) ||
    typeof q.label !== "string" ||
    q.label.length > 60
  ) {
    throw invalid("`qr` has a `path` on the event's hostname and a `label`.");
  }
  return { path: q.path as string, label: q.label };
}

/** The view-model's `qr`, as Screen makes it for its widgets (contracts/screen.md, QR handoff). */
export function qrView(host: string, qr: Qr): Data {
  const url = `https://${host}${qr.path}`;
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const svg = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return {
    url,
    label: qr.label,
    image_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  };
}

function seconds(v: unknown, field: string, fallback: number, max: number): number {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) {
    throw invalid(`\`${field}\` is 1 to ${max}.`);
  }
  return v as number;
}

/** The spotlight's request (D18, L15): in the hero, "From the crew", the name only in the history. */
export async function spotlightRequest(
  c: SqlClient,
  body: Data,
  actor: Actor,
  host: string,
  now: Date,
): Promise<MomentRequest> {
  const show = body.show;
  const qr = qrOf(body.qr);
  let template: string;
  let content: Data;
  let binding: Binding | null = null;
  if (show === "standings") {
    binding = { source: "leaderboard" };
    template = "leaderboard";
    content = (await renderBinding(c, binding)) ?? {};
  } else if (show === "bracket") {
    const session = text(body.session_id, "session_id", 64, true) as string;
    binding = { source: "session", ref: session };
    template = "bracket";
    content = (await renderBinding(c, binding)) ?? {};
  } else if (show === "photo") {
    if (!path(body.photo_url)) throw invalid("`photo_url` is a path on the event's hostname.");
    const caption = text(body.caption, "caption", 140) ?? "";
    const photo = { url: body.photo_url, caption, author_name: null, posted_at: now.toISOString() };
    template = "photo";
    content = { ...photo, featured: false, featured_until: null, tiles: [photo] };
  } else if (show === "message") {
    template = "announcement";
    content = {
      title: text(body.title, "title", 80, true),
      body: text(body.body, "body", 280) ?? "",
      level: "info",
      starts_at: now.toISOString(),
    };
  } else {
    throw invalid("`show` is standings, bracket, photo or message.");
  }
  return {
    class: "spotlight",
    template,
    content: { ...content, from_crew: true, ...(qr === null ? {} : { qr: qrView(host, qr) }) },
    origin: "crew",
    why: `${actor.name} · spotlight`,
    zones: zonesOf(body.zones),
    ttl_seconds: seconds(body.duration_seconds, "duration_seconds", 300, 7200),
    qr,
    binding,
    actor,
  };
}

export const EMERGENCY_TITLE = "Please leave the hall";
export const EMERGENCY_BODY = "Follow the exit signs.";

/** The emergency (mockup 07): full screen at rank 100, the safety look, no end of its own. */
export function emergencyRequest(body: Data, actor: Actor, why: string, now: Date): MomentRequest {
  return {
    class: "emergency",
    template: "announcement",
    content: {
      title: text(body.title, "title", 80) ?? EMERGENCY_TITLE,
      body: text(body.body, "body", 280) ?? EMERGENCY_BODY,
      level: "emergency",
      starts_at: now.toISOString(),
    },
    origin: "emergency",
    why,
    zones: zonesOf(body.zones),
    ttl_seconds: null,
    actor,
  };
}

/** "All clear" after an emergency: the rail for 60 s (mockup 07, step 4). */
export function allClearRequest(
  actor: Actor,
  why: string,
  zones: string[],
  now: Date,
): MomentRequest {
  return {
    class: "announcement",
    template: "announcement",
    content: {
      title: "All clear",
      body: "You may go back in. Thank you for your patience.",
      level: "info",
      starts_at: now.toISOString(),
    },
    origin: "emergency",
    why,
    zones,
    ttl_seconds: 60,
    actor,
  };
}
