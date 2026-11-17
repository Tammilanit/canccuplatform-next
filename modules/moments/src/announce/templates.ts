/**
 * Announcement templates (contracts/moments.md, Templates and placeholders; D11): four built-ins,
 * platform data in the code, plus the event's own rows. A template's free variables are the
 * `{name}`s its texts use, so the organiser defines one by writing it.
 */
import type { SqlClient } from "@canccu/kit";
import type { Level } from "./store.js";
import { freeVariables } from "./text.js";

export interface Template {
  key: string;
  name: string;
  title: string;
  body: string;
  level: Level;
  builtin: boolean;
  variables: string[];
  revision: number;
}

const builtin = (key: string, name: string, title: string, body: string): Template => ({
  key,
  name,
  title,
  body,
  level: "info",
  builtin: true,
  variables: freeVariables(title, body),
  revision: 0,
});

/** Mockup 05's set, in its order. */
export const BUILTINS: readonly Template[] = [
  builtin("food", "Food is here", "Food is here", "Pick up at {place}."),
  builtin(
    "starting_soon",
    "Starting in 15 minutes",
    "{item.title} starts in {item.starts_in}",
    "{item.location}",
  ),
  builtin("lost_found", "Lost and found", "Lost and found: {thing}", "Ask at the info desk."),
  builtin(
    "doors_close",
    "Doors close soon",
    "Doors close at {time}",
    "Thanks for coming to {event.name}.",
  ),
];

export const isBuiltin = (key: string): boolean => BUILTINS.some((t) => t.key === key);

export async function loadTemplates(c: SqlClient): Promise<Template[]> {
  const { rows } = await c.query(
    `SELECT key, name, title, body, level, revision FROM moments_announcement_templates ORDER BY name, key`,
    [],
  );
  const own = rows.map((r) => ({
    key: r.key as string,
    name: r.name as string,
    title: r.title as string,
    body: r.body as string,
    level: r.level as Level,
    builtin: false,
    variables: freeVariables(r.title as string, r.body as string),
    revision: r.revision as number,
  }));
  return [...BUILTINS, ...own];
}
