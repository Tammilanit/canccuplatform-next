/**
 * Announcement templates (contracts/moments.md, Templates and placeholders; D11): four built-ins,
 * platform data in the code, plus the event's own rows. A template's free variables are the
 * `{name}`s its texts use, so the organiser defines one by writing it.
 */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import { invalid } from "../content.js";
import { ANNOUNCE, SETTINGS, actorOf, archivedError, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { lockSettings } from "../store.js";
import { ICONS, LEVELS, oneOf } from "./chain.js";
import type { Icon, Level } from "./chain.js";
import { checkText, freeVariables } from "./text.js";

export interface Template {
  key: string;
  name: string;
  title: string;
  body: string;
  level: Level;
  /** The composer's icon (#780); an own template saved before it reads as `info`. */
  icon: Icon;
  builtin: boolean;
  variables: string[];
  revision: number;
}

const builtin = (key: string, name: string, icon: Icon, title: string, body: string): Template => ({
  key,
  name,
  title,
  body,
  level: "info",
  icon,
  builtin: true,
  variables: freeVariables(title, body),
  revision: 0,
});

/** Mockup 05's set, in its order. */
export const BUILTINS: readonly Template[] = [
  builtin("food", "Food is here", "food", "Food is here", "Pick up at {place}."),
  builtin(
    "starting_soon",
    "Starting in 15 minutes",
    "clock",
    "{item.title} starts in {item.starts_in}",
    "{item.location}",
  ),
  builtin(
    "lost_found",
    "Lost and found",
    "search",
    "Lost and found: {thing}",
    "Ask at the info desk.",
  ),
  builtin(
    "doors_close",
    "Doors close soon",
    "door",
    "Doors close at {time}",
    "Thanks for coming to {event.name}.",
  ),
];

export const TEMPLATE_KEY = /^[a-z][a-z0-9_]{1,31}$/;

export function str(v: unknown, field: string, max: number, required: boolean): string {
  if (v === undefined || v === null) {
    if (required) throw invalid(`\`${field}\` is required.`);
    return "";
  }
  if (typeof v !== "string" || v.length > max || (required && v.trim() === ""))
    throw invalid(`\`${field}\` is text of ${required ? "1 to " : "at most "}${max} characters.`);
  return v;
}

export const isBuiltin = (key: string): boolean => BUILTINS.some((t) => t.key === key);

export async function loadTemplates(c: SqlClient): Promise<Template[]> {
  const { rows } = await c.query(
    `SELECT key, name, title, body, level, icon, revision FROM moments_announcement_templates
     ORDER BY name, key`,
    [],
  );
  const own = rows.map((r) => ({
    key: r.key as string,
    name: r.name as string,
    title: r.title as string,
    body: r.body as string,
    level: r.level as Level,
    icon: (r.icon as Icon | null) ?? "info",
    builtin: false,
    variables: freeVariables(r.title as string, r.body as string),
    revision: r.revision as number,
  }));
  return [...BUILTINS, ...own];
}

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (typeof b === "object" && b !== null ? (b as Body) : {});

/** The templates' paths (moments/announcements.openapi.yaml); writes are settings, audited. */
export function templateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const announce = { preHandler: requireRight(deps.rights, ANNOUNCE) };
  const settings = { preHandler: requireRight(deps.rights, SETTINGS) };

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
      if (!LEVELS.includes(b.level as Level))
        throw invalid("`level` is info, important or urgent.");
      const t = {
        name: str(b.name, "name", 40, true),
        title: str(b.title, "title", 200, true),
        body: str(b.body, "body", 400, false),
        level: b.level as Level,
        icon: oneOf(b.icon, ICONS, "icon") ?? "info",
      };
      for (const text of [t.title, t.body]) {
        // A template's free variables are filled in the composer; only their names are checked here.
        const filled = Object.fromEntries(freeVariables(text).map((v) => [v, "x"]));
        const why = checkText(text, filled, true);
        if (why !== null) throw invalid(why);
      }
      return deps.db.tenant(async (c) => {
        await lockSettings(c, `template:${key}`);
        const { rows } = await c.query(
          `SELECT name, title, body, level, icon, revision FROM moments_announcement_templates
           WHERE key = $1`,
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
          `INSERT INTO moments_announcement_templates (key, name, title, body, level, icon, revision)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, key) DO UPDATE SET name = $2, title = $3, body = $4, level = $5,
             icon = $6, revision = $7`,
          [key, t.name, t.title, t.body, t.level, t.icon, revision],
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
