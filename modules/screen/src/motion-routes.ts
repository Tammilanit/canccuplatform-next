/**
 * `GET` and `PUT /api/screen/motion` (contracts/screen.md, Motion and burn-in drift): the Motion
 * card's event level and Follow the day, kept as Screen's own settings in admin, and each zone's
 * level now and next.
 */
import type { FastifyInstance } from "fastify";
import { MissingRight } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import { motionStyleOf } from "@canccu/ui";
import type { MotionStyle } from "@canccu/ui";
import type { Audit } from "./audit.js";
import type { Db } from "./db.js";
import type { Sources } from "./compose/sources.js";
import type { AgendaItem } from "./compose/widgets.js";
import {
  MOTION_LEVELS,
  eventMotion,
  isMotionLevel,
  phaseItems,
  themeMotionOf,
  zoneMotion,
} from "./compose/motion.js";
import type { MotionLevel, MotionPhase, ThemeMotion } from "./compose/motion.js";
import type { Settings } from "./health.js";
import { actorOf, assertWritable, body, invalidRequest, needs, tenantOf } from "./http.js";
import { themeFor } from "./pins/look.js";
import { readPin } from "./pins/store.js";

/** Screen's own settings as admin answers them. */
export interface SettingsDoc {
  settings_version: number;
  values: Record<string, unknown>;
}

/**
 * Admin's `PATCH /internal/admin/settings/screen` (contracts/admin.md, Settings); a 409 or 400
 * there is thrown as admin's error, so the person gets admin's code.
 */
export type SettingsWrite = (
  tenantId: string,
  write: { settings_version: number; values: Record<string, unknown>; actor_user_id: string },
) => Promise<SettingsDoc>;

export interface MotionDeps {
  db: Db;
  rights: RightsChecker;
  audit: Audit;
  sources: Sources;
  settings: Settings;
  /** None in tests that never save; main gives admin's. */
  writeSettings?: SettingsWrite;
  now?: () => number;
}

interface MotionBody {
  settings_version: number;
  motion_level: MotionLevel;
  follow_the_day: boolean;
}

function motionInput(value: Record<string, unknown>): MotionBody {
  const extra = Object.keys(value).find(
    (k) => !["settings_version", "motion_level", "follow_the_day"].includes(k),
  );
  if (extra !== undefined) throw invalidRequest(`Unknown field \`${extra}\`.`);
  const version = value.settings_version;
  if (!Number.isInteger(version) || (version as number) < 0) {
    throw invalidRequest("`settings_version` must be the whole number read with the settings.");
  }
  if (!isMotionLevel(value.motion_level)) {
    throw invalidRequest(`\`motion_level\` must be one of ${MOTION_LEVELS.join(", ")}.`);
  }
  if (typeof value.follow_the_day !== "boolean") {
    throw invalidRequest("`follow_the_day` must be true or false.");
  }
  return {
    settings_version: version as number,
    motion_level: value.motion_level,
    follow_the_day: value.follow_the_day,
  };
}

export interface MotionZone {
  key: string;
  name: string;
  motion_level: MotionLevel | null;
  level: MotionLevel;
  phase: MotionPhase;
  next: { level: MotionLevel; phase: MotionPhase; at: string } | null;
}

/** The `Motion` answer (contracts/screen.openapi.yaml), and the theme's style for Studio's card. */
export interface MotionRead {
  answer: {
    settings_version: number;
    motion_level: MotionLevel;
    follow_the_day: boolean;
    theme_motion: ThemeMotion;
    zones: MotionZone[];
  };
  style: MotionStyle;
}

/** The event's held settings as Screen reads them, for `GET` and Studio's card. */
export async function heldSettings(settings: Settings): Promise<SettingsDoc> {
  await settings.ensure();
  return {
    settings_version: settings.settingsVersion ?? 0,
    values: {
      motion_level: settings.get("motion_level", "lively"),
      follow_the_day: settings.get("follow_the_day", true),
    },
  };
}

/**
 * The run of show the screens keep for their agenda version, so "Right now" says what they show;
 * read afresh only while none is kept (no screen has been drawn since the start).
 */
async function runOfShow(sources: Sources, tenantId: string): Promise<AgendaItem[] | null> {
  return (await sources.agendaDay?.(tenantId)) ?? sources.agendaItems(tenantId);
}

/** Each zone's level and phase now and its next change, for the given settings. */
export async function readMotion(
  deps: Pick<MotionDeps, "db" | "sources" | "now">,
  tenantId: string,
  doc: SettingsDoc,
): Promise<MotionRead> {
  const { zones, pin } = await deps.db.tenant(async (c) => ({
    zones: (await c.query("SELECT key, name, motion_level FROM screen_zones ORDER BY key"))
      .rows as { key: string; name: string; motion_level: MotionLevel | null }[],
    pin: await readPin(c),
  }));
  const [items, theme] = await Promise.all([
    runOfShow(deps.sources, tenantId),
    themeFor(deps.sources, tenantId, pin),
  ]);
  const event = eventMotion({ get: (k, f) => doc.values[k] ?? f });
  const themeMotion = themeMotionOf(theme?.tokens);
  const at = (deps.now ?? Date.now)();
  const answer = {
    settings_version: doc.settings_version,
    motion_level: event.eventLevel,
    follow_the_day: event.followTheDay,
    theme_motion: themeMotion,
    zones: zones.map((z) => {
      const m = zoneMotion(
        { ...event, pin: z.motion_level, themeMotion },
        phaseItems(items ?? [], z.key),
        at,
      );
      return {
        key: z.key,
        name: z.name,
        motion_level: z.motion_level,
        level: m.level,
        phase: m.phase,
        next: m.next === null ? null : { ...m.next, at: new Date(m.next.at).toISOString() },
      };
    }),
  };
  return { answer, style: motionStyleOf(theme?.tokens?.motion_style) };
}

export function motionRoutes(app: FastifyInstance, deps: MotionDeps): void {
  app.get(
    "/api/screen/motion",
    { preHandler: needs(deps.rights, "screen.devices.read") },
    async (request) => {
      const ctx = tenantOf(request);
      return (await readMotion(deps, ctx.tenant_id, await heldSettings(deps.settings))).answer;
    },
  );

  app.put(
    "/api/screen/motion",
    { preHandler: needs(deps.rights, "screen.zones.write") },
    async (request) => {
      const ctx = tenantOf(request);
      // Refused here first; admin refuses an archived event too (contracts/admin.md, Settings).
      assertWritable(ctx);
      const input = motionInput(body(request));
      const actor = actorOf(request);
      if (deps.writeSettings === undefined || actor === null) {
        throw new MissingRight("The motion settings are saved by a person, through admin.");
      }
      await deps.settings.ensure();
      const before = {
        motion_level: deps.settings.get("motion_level", "lively"),
        follow_the_day: deps.settings.get("follow_the_day", true),
      };
      const values = { motion_level: input.motion_level, follow_the_day: input.follow_the_day };
      const doc = await deps.writeSettings(ctx.tenant_id, {
        settings_version: input.settings_version,
        values,
        actor_user_id: actor,
      });
      // The held settings follow admin's event only later; without this the Zones page, read
      // right after the save, shows the old values and version and the next save gets a 409.
      // Admin holds the save already, so a failed re-read is no failed save: the event still comes.
      await deps.settings.load?.(ctx.tenant_id).catch((err: unknown) => {
        request.log.warn({ err }, "re-reading the screen settings after a motion save failed");
      });
      // Admin has the values now; the audit entry is Screen's own (contracts/admin.md, Settings).
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.motion.saved",
        target: { type: "settings", id: "screen" },
        changes: {
          motion_level: { from: before.motion_level, to: values.motion_level },
          follow_the_day: { from: before.follow_the_day, to: values.follow_the_day },
        },
      });
      return (await readMotion(deps, ctx.tenant_id, doc)).answer;
    },
  );
}
