/** The announcements API (contracts/moments.md, Announcements; moments/announcements.openapi.yaml). */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import { invalid, zonesOf } from "../content.js";
import { SETTINGS, actorOf, archivedError, crewAction, failure, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { knownZones, lockSettings } from "../store.js";
import { chainOf, compose, editAnnouncement, filled, withdrawAnnouncement } from "./service.js";
import type { Draft } from "./service.js";
import { listAnnouncements, lockAnnouncement, runOfShow } from "./store.js";
import type { AnnouncementRow, Channels, RunItem, When } from "./store.js";
import { isBuiltin, loadTemplates } from "./templates.js";
import { BODY_MAX, TITLE_MAX, checkText } from "./text.js";

export const ANNOUNCE = "moments.announce";
/** How far ahead an announcement may be scheduled at a time. */
const AHEAD_MS = 14 * 86_400_000;
const TEMPLATE_KEY = /^[a-z][a-z0-9_]{1,31}$/;

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (typeof b === "object" && b !== null ? (b as Body) : {});

function str(v: unknown, field: string, max: number, required: boolean): string {
  if (v === undefined || v === null) {
    if (required) throw invalid(`\`${field}\` is required.`);
    return "";
  }
  if (typeof v !== "string" || v.length > max || (required && v.trim() === ""))
    throw invalid(`\`${field}\` is text of ${required ? "1 to " : "at most "}${max} characters.`);
  return v;
}

function bool(v: unknown, field: string, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") throw invalid(`\`${field}\` is true or false.`);
  return v;
}

function variablesOf(v: unknown): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw invalid("`variables` names values.");
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== "string" || x.length > 60)
      throw invalid(`The value of {${k}} is text of at most 60 characters.`);
    out[k] = x;
  }
  return out;
}

function channelsOf(v: unknown): Channels {
  const b = bodyOf(v);
  const ch = {
    screen: bool(b.screen, "channels.screen", true),
    ticker: bool(b.ticker, "channels.ticker", false),
    discord: bool(b.discord, "channels.discord", false),
    push: bool(b.push, "channels.push", false),
  };
  if (!Object.values(ch).some(Boolean)) throw invalid("Choose at least one channel.");
  return ch;
}

function whenOf(v: unknown, itemId: string | null, now: Date): When {
  const b = bodyOf(v);
  const mode = b.mode ?? "now";
  if (mode === "now") return { mode };
  if (mode === "at") {
    const at = typeof b.at === "string" ? Date.parse(b.at) : Number.NaN;
    if (Number.isNaN(at) || at > now.getTime() + AHEAD_MS)
      throw invalid("`when.at` is a time at most 14 days ahead.");
    return { mode, at: new Date(at).toISOString() };
  }
  if (mode === "item") {
    if (itemId === null) throw invalid("Sending with a run-of-show item needs `item_id`.");
    const lead = b.minutes_before ?? 0;
    if (!Number.isInteger(lead) || (lead as number) < 0 || (lead as number) > 1440)
      throw invalid("`when.minutes_before` is 0 to 1440.");
    return { mode, minutes_before: lead as number };
  }
  throw invalid("`when.mode` is now, at or item.");
}

/** The composer's body as a draft, checked whole: types, ranges, placeholders and limits. */
async function draftOf(
  c: SqlClient,
  b: Body,
  event: { name: string; time_zone: string },
  now: Date,
): Promise<{ draft: Draft; item: RunItem | null }> {
  if (b.level !== "info" && b.level !== "urgent")
    throw invalid("`level` is info or urgent; an emergency starts from Emergency.");
  const itemId =
    b.item_id === undefined || b.item_id === null ? null : str(b.item_id, "item_id", 64, true);
  const duration = b.duration_seconds ?? 300;
  if (!Number.isInteger(duration) || (duration as number) < 60 || (duration as number) > 7200)
    throw invalid("`duration_seconds` is 60 to 7200.");
  const draft: Draft = {
    level: b.level,
    full_screen: bool(b.full_screen, "full_screen", false),
    title_text: str(b.title, "title", 200, true),
    body_text: str(b.body, "body", 400, false),
    variables: variablesOf(b.variables),
    item_id: itemId,
    channels: channelsOf(b.channels),
    zones: zonesOf(b.zones),
    duration_seconds: duration as number,
    when: whenOf(b.when, itemId, now),
    event_name: event.name,
    time_zone: event.time_zone,
    template_key:
      typeof b.template_key === "string" && TEMPLATE_KEY.test(b.template_key)
        ? b.template_key
        : null,
  };
  const item = await checkTexts(c, draft, now);
  return { draft, item };
}

/** Placeholders known and filled, the item known, and the filled texts within their limits (E17). */
async function checkTexts(
  c: SqlClient,
  d: Pick<Draft, "title_text" | "body_text" | "variables" | "item_id" | "event_name" | "time_zone">,
  now: Date,
): Promise<RunItem | null> {
  for (const text of [d.title_text, d.body_text]) {
    const why = checkText(text, d.variables, d.item_id !== null);
    if (why !== null) throw invalid(why);
  }
  let item: RunItem | null = null;
  if (d.item_id !== null) {
    const items = await runOfShow(c);
    if (items === null) throw invalid("The run of show is not known yet: try again in a moment.");
    item = items.find((i) => i.id === d.item_id) ?? null;
    if (item === null) throw invalid("No such run-of-show item.");
  }
  const raw = filled(d, item, now, false);
  if (raw.title.length > TITLE_MAX)
    throw invalid(
      `The title is ${String(raw.title.length)} characters once filled; at most ${String(TITLE_MAX)}.`,
    );
  if (raw.body.length > BODY_MAX)
    throw invalid(
      `The body is ${String(raw.body.length)} characters once filled; at most ${String(BODY_MAX)}.`,
    );
  return item;
}

export function announcementView(a: AnnouncementRow): Body {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    id: a.id,
    status: a.status,
    level: a.level,
    full_screen: a.full_screen,
    title_text: a.title_text,
    body_text: a.body_text,
    variables: a.variables,
    item_id: a.item_id,
    title: a.title,
    body: a.body,
    channels: a.channels,
    zones: a.zones,
    duration_seconds: a.duration_seconds,
    when: a.when,
    fire_at: iso(a.fire_at),
    sent_at: iso(a.sent_at),
    expires_at: iso(a.expires_at),
    updated_until: iso(a.updated_until),
    ended_at: iso(a.ended_at),
    end_reason: a.end_reason,
    why: a.why,
    actor: a.actor_user_id === null ? null : { user_id: a.actor_user_id, name: a.actor_name ?? "" },
    moments: { card: a.card_moment_id, line: a.line_moment_id },
  };
}

/** What each channel would carry (U11): the composer's preview, and nothing saved. */
export async function previewOf(
  c: SqlClient,
  d: Draft,
  item: RunItem | null,
  now: Date,
): Promise<Body> {
  const text = filled(d, item, now);
  return {
    title: text.title,
    body: text.body,
    regions: d.channels.screen ? chainOf(d.level, d.full_screen) : [],
    line: d.channels.ticker ? text.line : null,
    push: d.channels.push
      ? { title: text.title, body: text.body, urgent: d.level === "urgent" }
      : null,
    discord: d.channels.discord
      ? { text: text.body === "" ? text.title : `${text.title}\n${text.body}` }
      : null,
    zones: d.zones.length > 0 ? d.zones : (await knownZones(c)).sort(),
  };
}

const notRunning = () =>
  new KitError("That announcement has ended or was withdrawn.", {
    status: 409,
    code: "not_running",
  });

async function eventOf(deps: AppDeps, request: FastifyRequest) {
  const ctx = tenantOf(request);
  const e = await deps.tenants
    .event(request.headers.host, request.headers.cookie)
    .catch(() => null);
  return { name: e?.name ?? "", time_zone: ctx.time_zone };
}

export function announceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const announce = { preHandler: requireRight(deps.rights, ANNOUNCE) };
  const settings = { preHandler: requireRight(deps.rights, SETTINGS) };

  app.get("/api/moments/announcements", announce, async () =>
    deps.db.tenant(async (c) => ({
      announcements: (await listAnnouncements(c)).map(announcementView),
    })),
  );

  app.post("/api/moments/announcements/preview", announce, async (request) => {
    const event = await eventOf(deps, request);
    const now = deps.now();
    return deps.db.tenant(async (c) => {
      const { draft, item } = await draftOf(c, bodyOf(request.body), event, now);
      return previewOf(c, draft, item, now);
    });
  });

  app.post("/api/moments/announcements", announce, async (request, reply) => {
    const event = await eventOf(deps, request);
    return crewAction(deps, request, reply, async (c, actor, now) => {
      const { draft } = await draftOf(c, bodyOf(request.body), event, now);
      const a = await compose(c, deps.engine, draft, actor, now);
      await deps.audit({
        tenant_id: tenantOf(request).tenant_id,
        actor_user_id: actor.user_id,
        action: "moments.announcement.sent",
        target: { type: "announcement", id: a.id },
        changes: {
          title: { old: null, new: a.title ?? a.title_text },
          level: { old: null, new: a.level },
          full_screen: { old: null, new: a.full_screen },
          channels: { old: null, new: a.channels },
          zones: { old: null, new: a.zones },
          when: { old: null, new: a.when },
        },
      });
      return { status: 201, body: announcementView(a) };
    });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/moments/announcements/:id",
    announce,
    (request, reply) =>
      crewAction(deps, request, reply, async (c, actor, now) => {
        const b = bodyOf(request.body);
        const a = await lockAnnouncement(c, request.params.id);
        if (a === null) return failure(404, "not_found", "No such announcement.");
        if (a.status !== "live" && a.status !== "scheduled") throw notRunning();
        const edit = {
          title_text: str(b.title, "title", 200, true),
          body_text: b.body === undefined ? a.body_text : str(b.body, "body", 400, false),
          variables: b.variables === undefined ? a.variables : variablesOf(b.variables),
        };
        await checkTexts(c, { ...a, ...edit }, now);
        const before = { title: a.title ?? a.title_text, body: a.body ?? a.body_text };
        await editAnnouncement(c, deps.engine, a, edit, actor, now);
        await deps.audit({
          tenant_id: tenantOf(request).tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.announcement.changed",
          target: { type: "announcement", id: a.id },
          changes: {
            title: { old: before.title, new: a.title ?? a.title_text },
            body: { old: before.body, new: a.body ?? a.body_text },
          },
        });
        return { status: 200, body: announcementView(a) };
      }),
  );

  app.post<{ Params: { id: string } }>(
    "/api/moments/announcements/:id/withdraw",
    announce,
    (request, reply) =>
      crewAction(deps, request, reply, async (c, actor, now) => {
        const a = await lockAnnouncement(c, request.params.id);
        if (a === null) return failure(404, "not_found", "No such announcement.");
        if (a.status !== "live" && a.status !== "scheduled") throw notRunning();
        await withdrawAnnouncement(
          c,
          deps.engine,
          a,
          { reason: "withdrawn", why: `${actor.name} withdrew it.`, actor },
          now,
        );
        await deps.audit({
          tenant_id: tenantOf(request).tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.announcement.withdrawn",
          target: { type: "announcement", id: a.id },
          changes: { status: { old: "live", new: "withdrawn" } },
        });
        return { status: 200, body: announcementView(a) };
      }),
  );

  app.get("/api/moments/announcement-templates", announce, async () =>
    deps.db.tenant(async (c) => ({ templates: await loadTemplates(c) })),
  );

  app.put<{ Params: { key: string } }>(
    "/api/moments/announcement-templates/:key",
    settings,
    async (request) => {
      const ctx = tenantOf(request);
      if (ctx.status === "archived") throw archivedError();
      const actor = actorOf(request.session);
      const key = request.params.key;
      if (!TEMPLATE_KEY.test(key))
        throw invalid("A template key is a-z, 0-9 and _, a letter first.");
      if (isBuiltin(key))
        throw invalid("A built-in template keeps its key: save it under another.");
      const b = bodyOf(request.body);
      if (b.level !== "info" && b.level !== "urgent") throw invalid("`level` is info or urgent.");
      const t = {
        name: str(b.name, "name", 40, true),
        title: str(b.title, "title", 200, true),
        body: str(b.body, "body", 400, false),
        level: b.level,
      };
      for (const text of [t.title, t.body]) {
        // A template's free variables are filled in the composer; only their names are checked here.
        const why = checkText(text, new Proxy({}, { get: () => "x" }), true);
        if (why !== null) throw invalid(why);
      }
      return deps.db.tenant(async (c) => {
        await lockSettings(c, `template:${key}`);
        const { rows } = await c.query(
          `SELECT name, title, body, level, revision FROM moments_announcement_templates WHERE key = $1`,
          [key],
        );
        const old = rows[0] as Body | undefined;
        if (b.revision !== ((old?.revision as number | undefined) ?? 0))
          throw new KitError("Someone saved meanwhile: read it again.", {
            status: 409,
            code: "version_conflict",
          });
        const revision = ((old?.revision as number | undefined) ?? 0) + 1;
        await c.query(
          `INSERT INTO moments_announcement_templates (key, name, title, body, level, revision)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, key) DO UPDATE SET name = $2, title = $3, body = $4, level = $5,
             revision = $6`,
          [key, t.name, t.title, t.body, t.level, revision],
        );
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.announcement_template.saved",
          target: { type: "announcement_template", id: key },
          changes: Object.fromEntries(
            Object.entries(t).map(([k, v]) => [k, { old: old?.[k] ?? null, new: v }]),
          ),
        });
        return (await loadTemplates(c)).find((x) => x.key === key);
      });
    },
  );

  app.delete<{ Params: { key: string } }>(
    "/api/moments/announcement-templates/:key",
    settings,
    async (request, reply) => {
      const ctx = tenantOf(request);
      if (ctx.status === "archived") throw archivedError();
      const actor = actorOf(request.session);
      const key = request.params.key;
      if (isBuiltin(key)) throw invalid("A built-in template cannot be deleted.");
      const gone = await deps.db.tenant(async (c) => {
        const { rows } = await c.query(
          `DELETE FROM moments_announcement_templates WHERE key = $1 RETURNING name`,
          [key],
        );
        if (rows.length === 0) return false;
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor.user_id,
          action: "moments.announcement_template.deleted",
          target: { type: "announcement_template", id: key },
          changes: { name: { old: rows[0]?.name ?? null, new: null } },
        });
        return true;
      });
      if (!gone) throw new KitError("No such template.", { status: 404, code: "not_found" });
      return reply.status(204).send();
    },
  );
}
