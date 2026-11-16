/**
 * The cues and sound API (contracts/moments.md, Cues and sound): the sound desk's settings, mute
 * and check, the cues, the library and the log. Every write is validated whole (the legacy's
 * unvalidated PATCH was its known problem 11) and audited; mute and check are crew actions.
 */
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { KitError, requireTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import { invalid } from "../content.js";
import { READ, SETTINGS, TAKE, actorOf, archivedError, crewAction, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { CALM, CATEGORIES, EFFECTS, PACK, PRIORITY } from "./catalog.js";
import type { Category } from "./catalog.js";
import type { Energy } from "./decide.js";
import { cueOf, int, settingsOf } from "./validate.js";
import {
  addSound,
  deleteCue,
  loadCue,
  loadCues,
  loadLibrary,
  loadSettings,
  readLog,
  removeSound,
  saveCue,
  saveSettings,
} from "./store.js";

type Body = Record<string, unknown>;
const bodyOf = (b: unknown): Body => (typeof b === "object" && b !== null ? (b as Body) : {});

/** D23 as D16 changed it: MP3 or OGG (Screen checks), at most 30 s and 1 MiB, a warning over 10 s. */
const MAX_BYTES = 1_048_576;
const MAX_SECONDS = 30;
const WARN_SECONDS = 10;
const CUE_NAME = /^[a-z][a-z0-9_]{0,31}(\.[a-z0-9_]{1,32}){0,2}$/;
const PACK_FILES = new Set(PACK.map((p) => p.file));
const PACK_DIR = new URL("../../static/sounds/", import.meta.url).pathname;

const conflict = () =>
  new KitError("Someone saved meanwhile: read it again.", {
    status: 409,
    code: "version_conflict",
  });
const notFound = (what: string) =>
  new KitError(`No such ${what}.`, { status: 404, code: "not_found" });

const LETS_THROUGH: Record<Energy, Category[]> = {
  party: [...CATEGORIES],
  lively: [...CATEGORIES],
  calm: CATEGORIES.filter((c) => CALM.has(c)),
  quiet: ["urgent"],
};

/** The sound desk's view: the settings, each category's fixed parts, each zone's state now. */
export async function deskView(c: SqlClient, deps: AppDeps, now: Date): Promise<Body> {
  const settings = await loadSettings(c);
  const { rows } = await c.query(`SELECT zone_key FROM moments_zones ORDER BY zone_key`, []);
  const tenant = requireTenant();
  const zones = [];
  for (const zone of rows.map((r) => r.zone_key as string)) {
    const at = now.getTime();
    const [minute, hour] = await deps.cues.counts(zone, at);
    const status = await deps.screen.zoneSound(tenant, zone);
    zones.push({
      zone_key: zone,
      minute,
      hour,
      energy: status?.energy ?? null,
      lets_through: status === null ? null : LETS_THROUGH[status.energy],
      sound_screen: status?.device ?? null,
    });
  }
  return {
    settings,
    categories: CATEGORIES.map((name) => ({
      name,
      priority: PRIORITY[name],
      interrupts: name === "urgent",
      plays_at_calm: CALM.has(name),
    })),
    zones,
  };
}

async function library(c: SqlClient): Promise<Body[]> {
  const cues = await loadCues(c);
  return (await loadLibrary(c)).map((s) => ({
    ...s,
    used_by: cues
      .filter((q) => q.sounds.includes(s.id) || q.voice_line === s.id)
      .map((q) => q.name),
    warning: s.length_ms > WARN_SECONDS * 1000 ? "over 10 s: long sounds tire a room" : null,
  }));
}

export function cueRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { preHandler: requireRight(deps.rights, READ) };
  const write = { preHandler: requireRight(deps.rights, SETTINGS) };
  const take = { preHandler: requireRight(deps.rights, TAKE) };
  /** A settings write: refused on an archived event, one transaction with its audit entry. */
  const writing = <T>(
    request: Parameters<typeof tenantOf>[0],
    fn: (c: SqlClient, tenant: string, actor: string) => Promise<T>,
  ) => {
    const ctx = tenantOf(request);
    if (ctx.status === "archived") throw archivedError();
    const actor = actorOf(request.session).user_id;
    return deps.db.tenant((c) => fn(c, ctx.tenant_id, actor));
  };

  app.get("/api/moments/sound", read, () => deps.db.tenant((c) => deskView(c, deps, deps.now())));

  app.put("/api/moments/sound/settings", write, (request) =>
    writing(request, async (c, tenant, actor) => {
      const b = bodyOf(request.body);
      const next = settingsOf(b);
      if (typeof next === "string") throw invalid(next);
      await c.query(`SELECT 1 FROM moments_sound_settings FOR UPDATE`, []);
      const before = await loadSettings(c);
      const saved = { ...next, muted_until: before.muted_until };
      if (b.revision !== before.revision || !(await saveSettings(c, saved, before.revision)))
        throw conflict();
      const old: Partial<typeof before> = { ...before };
      delete old.revision;
      await deps.audit({
        tenant_id: tenant,
        actor_user_id: actor,
        action: "moments.sound.changed",
        target: { type: "sound", id: tenant },
        changes: { settings: { old, new: saved } },
      });
      return loadSettings(c);
    }),
  );

  app.post("/api/moments/sound/mute", take, (request, reply) =>
    crewAction(deps, request, reply, async (c, actor, now) => {
      const minutes = bodyOf(request.body).minutes;
      if (!int(minutes, 0, 240)) throw invalid("`minutes` is 0 (unmute) to 240.");
      await c.query(`SELECT 1 FROM moments_sound_settings FOR UPDATE`, []);
      const before = await loadSettings(c);
      const { revision, ...s } = before;
      const until =
        minutes === 0 ? null : new Date(now.getTime() + (minutes as number) * 60_000).toISOString();
      if (!(await saveSettings(c, { ...s, muted_until: until }, revision))) throw conflict();
      await deps.audit({
        tenant_id: tenantOf(request).tenant_id,
        actor_user_id: actor.user_id,
        action: "moments.sound.muted",
        target: { type: "sound", id: tenantOf(request).tenant_id },
        changes: { muted_until: { old: before.muted_until, new: until } },
      });
      return { status: 200, body: await loadSettings(c) };
    }),
  );

  app.post("/api/moments/sound/check", take, (request, reply) =>
    crewAction(deps, request, reply, async (c, actor, now) => {
      const b = bodyOf(request.body);
      const zones = b.zones ?? [];
      if (
        !Array.isArray(zones) ||
        !zones.every((z) => typeof z === "string" && /^[a-z0-9_-]{2,32}$/.test(z))
      )
        throw invalid("`zones` lists zone keys.");
      const sound = b.sound_id ?? null;
      if (!(sound === null || typeof sound === "string"))
        throw invalid("`sound_id` names a sound.");
      await deps.cues.check(c, zones as string[], sound, now);
      await deps.audit({
        tenant_id: tenantOf(request).tenant_id,
        actor_user_id: actor.user_id,
        action: "moments.sound.checked",
        target: { type: "sound", id: tenantOf(request).tenant_id },
        changes: { zones: { old: null, new: zones }, sound_id: { old: null, new: sound } },
      });
      return { status: 200, body: { zones, sound_id: sound } };
    }),
  );

  app.get<{ Querystring: Record<string, string> }>("/api/moments/sound/log", read, (request) => {
    const q = request.query;
    const limit = q.limit === undefined ? 100 : Number(q.limit);
    if (!int(limit, 1, 500)) throw invalid("`limit` is 1 to 500.");
    const before = q.before === undefined ? undefined : Number(q.before);
    if (before !== undefined && !Number.isInteger(before))
      throw invalid("`before` is a row's `seq`.");
    return deps.db.tenant(async (c) => ({
      rows: await readLog(c, {
        limit,
        ...(q.zone === undefined ? {} : { zone: q.zone }),
        ...(before === undefined ? {} : { before }),
      }),
    }));
  });

  app.get("/api/moments/cues", read, () =>
    deps.db.tenant(async (c) => ({
      cues: await loadCues(c),
      categories: CATEGORIES.map((name) => ({ name, priority: PRIORITY[name] })),
      effects: EFFECTS,
    })),
  );

  app.put<{ Params: { name: string } }>("/api/moments/cues/:name", write, (request) =>
    writing(request, async (c, tenant, actor) => {
      const name = request.params.name;
      if (!CUE_NAME.test(name)) throw invalid("A cue's name is lowercase words joined by dots.");
      const b = bodyOf(request.body);
      const before = await loadCue(c, name);
      const ids = new Set((await loadLibrary(c)).map((s) => s.id));
      const cue = cueOf(name, b, ids, before?.builtin ?? false);
      if (typeof cue === "string") throw invalid(cue);
      if (b.revision !== (before?.revision ?? 0) || !(await saveCue(c, cue, before?.revision ?? 0)))
        throw conflict();
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      for (const [k, v] of Object.entries(cue)) {
        const old = before === null ? null : (before as unknown as Body)[k];
        if (JSON.stringify(old) !== JSON.stringify(v)) changes[k] = { old, new: v };
      }
      await deps.audit({
        tenant_id: tenant,
        actor_user_id: actor,
        action: "moments.cue.changed",
        target: { type: "cue", id: name },
        changes,
      });
      return loadCue(c, name);
    }),
  );

  app.delete<{ Params: { name: string } }>(
    "/api/moments/cues/:name",
    write,
    async (request, reply) => {
      await writing(request, async (c, tenant, actor) => {
        const before = await loadCue(c, request.params.name);
        if (before === null) throw notFound("cue");
        await deleteCue(c, before.name);
        await deps.audit({
          tenant_id: tenant,
          actor_user_id: actor,
          action: before.builtin ? "moments.cue.reset" : "moments.cue.removed",
          target: { type: "cue", id: before.name },
        });
      });
      return reply.status(204).send();
    },
  );

  app.get("/api/moments/sounds", read, () =>
    deps.db.tenant(async (c) => ({ sounds: await library(c) })),
  );

  app.post("/api/moments/sounds", write, async (request, reply) => {
    const assetId = bodyOf(request.body).asset_id;
    if (typeof assetId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(assetId))
      throw invalid("`asset_id` names one of Screen's audio assets.");
    const ctx = tenantOf(request);
    const asset = await deps.screen.asset(ctx.tenant_id, assetId);
    if (asset === null) throw notFound("asset");
    if (asset.kind !== "audio") throw invalid("Only an `audio` asset can be a sound.");
    if (asset.size_bytes === null || asset.size_bytes > MAX_BYTES)
      throw invalid("A sound is at most 1 MiB.");
    if (asset.duration_seconds === null || asset.duration_seconds > MAX_SECONDS)
      throw invalid("A sound is at most 30 s long.");
    const id = await writing(request, async (c, tenant, actor) => {
      const { rows } = await c.query(`SELECT id FROM moments_sounds WHERE asset_id = $1`, [
        assetId,
      ]);
      if (rows.length > 0) return rows[0]?.id as string;
      const sid = `snd_${assetId}`;
      await addSound(
        c,
        {
          id: sid,
          title: asset.title,
          url: asset.url,
          length_ms: Math.round((asset.duration_seconds as number) * 1000),
          size_bytes: asset.size_bytes,
          source: "upload",
          asset_id: assetId,
        },
        deps.now(),
      );
      await deps.audit({
        tenant_id: tenant,
        actor_user_id: actor,
        action: "moments.sound.linked",
        target: { type: "sound", id: sid },
        changes: { asset_id: { old: null, new: assetId } },
      });
      return sid;
    });
    const view = (await deps.db.tenant(library)).find((s) => s.id === id);
    return reply.status(201).send(view);
  });

  app.delete<{ Params: { id: string } }>(
    "/api/moments/sounds/:id",
    write,
    async (request, reply) => {
      await writing(request, async (c, tenant, actor) => {
        const id = request.params.id;
        const s = (await library(c)).find((x) => x.id === id && x.source === "upload");
        if (s === undefined) throw notFound("sound of the event");
        if ((s.used_by as string[]).length > 0)
          throw new KitError(`Used by ${(s.used_by as string[]).join(", ")}.`, {
            status: 409,
            code: "sound_in_use",
          });
        await removeSound(c, id);
        await deps.audit({
          tenant_id: tenant,
          actor_user_id: actor,
          action: "moments.sound.unlinked",
          target: { type: "sound", id },
        });
      });
      return reply.status(204).send();
    },
  );
}

/** The CC0 pack, public and immutable: screens fetch it without a session (contracts/moments.md). */
export function packRoutes(app: FastifyInstance): void {
  app.get<{ Params: { file: string } }>(
    "/api/moments/sounds/pack/:file",
    async (request, reply) => {
      const file = request.params.file;
      if (!PACK_FILES.has(file)) throw notFound("sound");
      return reply
        .type("audio/ogg")
        .header("cache-control", "public, max-age=86400")
        .send(await readFile(`${PACK_DIR}${file}`));
    },
  );
}
