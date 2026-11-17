/**
 * What Moments consumes (contracts/moments.md): Screen's placements and zones, archiving, and the
 * catalog events its rules and live sources follow. Each tenant event is handled in one tenant
 * transaction, whose override events the outbox sends after the commit. Handlers are idempotent:
 * events come at least once, and to every container.
 */
import type { Event, SqlClient } from "@canccu/kit";
import { CREW_CUES } from "./cues/catalog.js";
import type { Db } from "./db.js";
import type { Engine } from "./engine.js";
import { applyClaims, claimsReportOf } from "./placements.js";
import { applyRules } from "./rules.js";
import { evaluateScenes, recordFact, storeAgenda } from "./scene-store.js";
import type { AgendaReader } from "./scene-store.js";
import { recordSource, refreshBound } from "./sources.js";
import { addZone } from "./store.js";
import { storyEvent } from "./story/triggers.js";
import { endAll, noteTenant, zoneRemoved } from "./tick.js";

export const TENANT_STREAMS = [
  "screen",
  "tenants",
  "tournament",
  "pizza",
  "games",
  "agenda",
  "notify",
  "bot",
];

export interface ConsumerDeps {
  db: Db;
  engine: Engine;
  flush: () => Promise<unknown>;
  now: () => Date;
  /** The event's agenda, read again on each of its changes (scenes' agenda conditions). */
  agenda?: AgendaReader;
  /** The event's time zone for the scenes' time conditions; UTC without it. */
  timeZoneOf?: (tenant: string) => Promise<string>;
}

/** One tenant event, run inside its tenant (the kit's subscribeTenants sets it). */
export async function handleTenantEvent(deps: ConsumerDeps, e: Event): Promise<void> {
  if (e.tenant === undefined) return;
  const now = deps.now();
  if (e.type === "tenants.status.changed") {
    if (e.data.to !== "archived") return;
    await deps.db.tenant((c) => endAll(c, deps.engine, now));
    await deps.db.global((c) =>
      c.query(
        `INSERT INTO moments_tenants (tenant_id, archived_at) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`,
        [e.tenant, now],
      ),
    );
    await deps.flush();
    return;
  }
  if (e.type === "tenants.tenant.cloned") {
    const source = e.data.source_tenant_id;
    if (typeof source === "string" && TENANT_ID.test(source) && source !== e.tenant)
      await cloneFrom(deps.db, source, e.tenant);
    return;
  }
  if (e.source === "tenants") return;
  await noteTenant(deps.db, e.tenant);
  // Reads go before the transaction, so none holds it open while another module answers.
  const agenda =
    e.source === "agenda" && typeof e.data.agenda_version === "number" && deps.agenda
      ? await deps.agenda(e.tenant).catch(() => null)
      : null;
  const timeZone = (await deps.timeZoneOf?.(e.tenant)) ?? "UTC";
  await deps.db.tenant(async (c) => {
    let scenes = false;
    if (e.type === "screen.claims.changed") {
      const report = claimsReportOf(e.data);
      if (report !== null) await applyClaims(c, report, now);
    } else if (e.type === "screen.zone.saved" && typeof e.data.zone_key === "string") {
      await addZone(c, e.data.zone_key);
      scenes = true;
    } else if (e.type === "screen.zone.removed" && typeof e.data.zone_key === "string") {
      await zoneRemoved(c, deps.engine, e.data.zone_key, now);
    } else if (e.type === "screen.photo.added" && typeof e.data.photo_id === "string") {
      // A new photo's sound is a Moments cue (contracts/screen.md, A new photo); Screen draws its pop.
      const id = e.data.photo_id;
      await deps.engine.fireCue(
        c,
        { cue: CREW_CUES.photo, zones: [], key: `photo:${id}`, source: id },
        now,
      );
      await storyEvent({ c, engine: deps.engine, now }, e);
    } else if (e.source !== "screen") {
      // An archived event is read-only (E10): no rule starts or renews a moment on it.
      if (await isArchived(c, e.tenant as string)) return;
      if (agenda !== null) await storeAgenda(c, agenda);
      scenes = (await recordFact(c, e)) || agenda !== null;
      const touched = await recordSource(c, e);
      await applyRules(c, deps.engine, e, now);
      await storyEvent({ c, engine: deps.engine, now }, e);
      if (touched !== null) await refreshBound(c, deps.engine, touched, now);
    }
    if (scenes) await evaluateScenes(c, deps.engine.outbox, { timeZone, now });
  });
  await deps.flush();
}

async function isArchived(c: SqlClient, tenant: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM moments_tenants WHERE tenant_id = $1 AND archived_at IS NOT NULL`,
    [tenant],
  );
  return rows.length > 0;
}

/**
 * Screen's zone events replayed from the start of each stream at every boot, so zones saved while
 * Moments was down or before it ran are known (moments with every zone narrow to them, D3). Only
 * the set of zones changes here: a past removal must never end a moment running now; the live
 * subscription (handleTenantEvent) ends moments on a zone removed now.
 */
export async function handleZoneReplay(deps: ConsumerDeps, e: Event): Promise<void> {
  const zone = e.data.zone_key;
  if (e.tenant === undefined || typeof zone !== "string") return;
  if (e.type === "screen.zone.saved") {
    await noteTenant(deps.db, e.tenant);
    await deps.db.tenant((c) => addZone(c, zone));
  } else if (e.type === "screen.zone.removed") {
    await deps.db.tenant((c) => c.query(`DELETE FROM moments_zones WHERE zone_key = $1`, [zone]));
  }
}

const TENANT_ID = /^[a-z][a-z0-9-]{2,31}$/;

/**
 * Clone with an event (D22): the source's priorities, rules, scenes, announcement templates and stories
 * become the new event's, where it has none of its own yet (scenes it never saved count as
 * none). Never the history, the live moments, an announcement or a zone's scene. The tenants module checked the series and the caller before it
 * emitted `tenants.tenant.cloned`; the event comes at least once, so the copy is idempotent.
 */
async function cloneFrom(db: Db, source: string, target: string): Promise<void> {
  await db.global(async (c) => {
    // The app role is bound by RLS: each side is read and written with its own tenant set.
    await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [source]);
    const priorities = (
      await c.query(`SELECT event_order, zone_orders FROM moments_priorities`, [])
    ).rows;
    const rules = (await c.query(`SELECT rule_id, settings FROM moments_rules`, [])).rows;
    const scenes = (await c.query(`SELECT scenes FROM moments_scenes`, [])).rows;
    const templates = (
      await c.query(`SELECT key, name, title, body, level FROM moments_announcement_templates`, [])
    ).rows;
    const stories = (await c.query(`SELECT stories, settings FROM moments_stories`, [])).rows;
    await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [target]);
    for (const p of priorities) {
      await c.query(
        `INSERT INTO moments_priorities (event_order, zone_orders, revision) VALUES ($1, $2, 0)
         ON CONFLICT DO NOTHING`,
        [p.event_order, p.zone_orders],
      );
    }
    for (const r of rules) {
      await c.query(
        `INSERT INTO moments_rules (rule_id, settings, revision) VALUES ($1, $2, 0)
         ON CONFLICT DO NOTHING`,
        [r.rule_id, r.settings],
      );
    }
    for (const s of scenes) {
      await c.query(
        `INSERT INTO moments_scenes (scenes, revision) VALUES ($1, 0)
         ON CONFLICT (tenant_id) DO UPDATE SET scenes = EXCLUDED.scenes
         WHERE moments_scenes.revision = 0`,
        [JSON.stringify(s.scenes)],
      );
    }
    // The stories with their on/off and settings (SD8); never a run or the event's facts.
    for (const st of stories) {
      await c.query(
        `INSERT INTO moments_stories (stories, settings, event, revision) VALUES ($1, $2, '{}', 1)
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(st.stories), JSON.stringify(st.settings)],
      );
    }
    for (const t of templates) {
      await c.query(
        `INSERT INTO moments_announcement_templates (key, name, title, body, level, revision)
         VALUES ($1, $2, $3, $4, $5, 1) ON CONFLICT DO NOTHING`,
        [t.key, t.name, t.title, t.body, t.level],
      );
    }
  });
}

/** Platform events: a deleted event's rows, a deleted user's name in the history. */
export async function handlePlatformEvent(deps: ConsumerDeps, e: Event): Promise<void> {
  if (e.type === "tenants.tenant.deleted" && typeof e.data.tenant_id === "string") {
    const tenant = e.data.tenant_id;
    await deps.db.global(async (c) => {
      // The app role is bound by RLS; a deleted event's rows go with the tenant set to it.
      await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [tenant]);
      for (const table of [
        "moment_placements",
        "moment_overrides",
        "moments",
        "moments_zones",
        "moments_priorities",
        "moments_rules",
        "moments_sources",
        "moments_history",
        "moments_idempotency",
        "moments_outbox",
        "moments_sound_settings",
        "moments_cues",
        "moments_sounds",
        "moments_sound_zones",
        "moments_sound_sources",
        "moments_sound_log",
        "moments_scenes",
        "moments_scene_zones",
        "moments_scene_crew",
        "moments_checkins",
        "moments_announcements",
        "moments_announcement_templates",
        "moments_stories",
        "moments_story_runs",
        "moments_story_marks",
      ]) {
        await c.query(`DELETE FROM ${table}`, []);
      }
      await c.query(`DELETE FROM moments_tenants WHERE tenant_id = $1`, [tenant]);
      await c.query(`DELETE FROM moments_outbox_tenants WHERE tenant_id = $1`, [tenant]);
    });
  } else if (e.type === "tenants.user.deleted" && typeof e.data.user_id === "string") {
    const user = e.data.user_id;
    const tenants = await deps.db.global(async (c) => {
      const { rows } = await c.query(`SELECT tenant_id FROM moments_tenants`, []);
      return rows.map((r) => r.tenant_id as string);
    });
    for (const tenant of tenants) {
      await deps.db.global(async (c) => {
        await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [tenant]);
        await forgetUser(c, user);
      });
    }
  }
}

/** The person's name in a `why` ("Demo Crew · spotlight") replaced, the action kept. */
const ANONYMOUS_WHY = `'A person' || substring(why from position(' · ' in why))`;

/**
 * Removes a person's name and id from the history and the moments: the rows they acted on, and
 * every row of a moment they started, whose `why` names them.
 */
export async function forgetUser(
  c: { query: (text: string, values: unknown[]) => Promise<unknown> },
  user: string,
): Promise<void> {
  await c.query(
    `UPDATE moments_history SET why = ${ANONYMOUS_WHY}
     WHERE origin IN ('crew', 'emergency')
       AND moment_id IN (SELECT id FROM moments WHERE actor_user_id = $1)`,
    [user],
  );
  await c.query(
    `UPDATE moments_history SET actor_user_id = NULL, actor_name = NULL WHERE actor_user_id = $1`,
    [user],
  );
  await c.query(
    `UPDATE moments_announcements SET actor_user_id = NULL, actor_name = NULL WHERE actor_user_id = $1`,
    [user],
  );
  await c.query(
    `UPDATE moments SET actor_user_id = NULL, actor_name = NULL,
       why = CASE WHEN origin IN ('crew', 'emergency') THEN ${ANONYMOUS_WHY} ELSE why END
     WHERE actor_user_id = $1`,
    [user],
  );
}
