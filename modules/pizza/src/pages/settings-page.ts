/**
 * Food → Settings (`/pizza/crew/settings`, mockup 17, the admin control room's sheets 05 and 06):
 * ordering, the scheduler's times and forgotten orders, settling up and the AI reader. Admin's old
 * address for Food's form opens this tab (#747). Read and saved through admin's settings API as the
 * person, with `admin.settings.write` and the version they read, so admin checks, audits and
 * announces the change; keys the page does not show (the reader's, without a provider key) are
 * sent back as read. Whoever may only read the event's settings sees them read only.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { AppDeps } from "../http.js";
import { readerKeySet } from "../reader-key.js";
import { NOTE_MAX, TIME_BOUNDS } from "../settings.js";
import { PREFIX, SETTINGS_READ, SETTINGS_WRITE, organiserPage, pageCtx } from "./kit.js";
import { COUNTS, settingsForm } from "./settings-views.js";

type Values = Record<string, unknown>;
const PATH = "/api/admin/settings/pizza";

/** The form's values as admin's settings take them: numbers within bounds, switches as booleans. */
export function valuesOf(form: Record<string, unknown>, read: Values): Values {
  const out: Values = { ...read };
  const flag = (k: string) => {
    const raw = form[k];
    const last: unknown = Array.isArray(raw) ? (raw as unknown[]).at(-1) : raw;
    if (last === "on" || last === "off") out[k] = last === "on";
  };
  for (const k of [
    "ordering_open",
    "auto_close",
    "close_forgotten",
    "settle_to_payer",
    "ai_reader",
  ])
    flag(k);
  if (form.open_by === "anyone" || form.open_by === "crew") out.open_by = form.open_by;
  if (typeof form.ordering_note === "string")
    out.ordering_note = form.ordering_note.trim().slice(0, NOTE_MAX);
  const bounds: Record<string, readonly [number, number]> = { ...COUNTS, ...TIME_BOUNDS };
  for (const [k, [min, max]] of Object.entries(bounds)) {
    const n = Number(form[k]);
    if (Number.isInteger(n) && n >= min && n <= max) out[k] = n;
  }
  return out;
}

export function settingsPage(app: FastifyInstance, deps: AppDeps): void {
  const asPerson = (request: FastifyRequest) => ({
    headers: {
      cookie: request.headers.cookie ?? "",
      host: request.headers.host ?? "",
      ...(typeof request.headers["x-forwarded-for"] === "string"
        ? { "x-forwarded-for": request.headers["x-forwarded-for"] }
        : {}),
    },
  });
  const writer = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(SETTINGS_WRITE))
      throw new KitError(`needs right ${SETTINGS_WRITE}`, { status: 403, code: "missing_right" });
    return c;
  };
  // Whoever may read the event's settings sees them here, as on admin's page they replace.
  const reader = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(SETTINGS_READ) && !c.session.rights.has(SETTINGS_WRITE))
      throw new KitError(`needs right ${SETTINGS_READ}`, { status: 403, code: "missing_right" });
    return c;
  };
  const read = async (request: FastifyRequest) => {
    const r = await deps.admin.request("GET", PATH, asPerson(request));
    // Nothing saved yet is version 0 with no values; a 404 says admin keeps no food settings for
    // the event: either way the form shows the defaults, and the first save makes them the event's.
    if (r.status === 404) return { values: {}, version: 0 };
    // The person's own refusal (signed out, the right taken meanwhile) is theirs, not admin failing.
    if (r.status === 401 || r.status === 403) {
      const e = (r.body as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new KitError(e?.message ?? "Admin refused the settings.", {
        status: r.status,
        code: e?.code ?? (r.status === 401 ? "not_signed_in" : "missing_right"),
      });
    }
    if (r.status >= 400)
      throw new KitError("Admin did not answer with the settings.", {
        status: 502,
        code: "admin_unavailable",
      });
    const b = r.body as { values?: Values; settings_version?: number };
    return { values: b.values ?? {}, version: b.settings_version ?? 0 };
  };

  app.get<{ Querystring: { error?: string } }>("/crew/settings", async (request, reply) => {
    const c = await reader(request);
    const s = await read(request);
    return organiserPage(request, reply, deps, c, {
      title: c.t("crew.title"),
      description: c.t("about.settings"),
      tab: "settings",
      narrow: true,
      body: settingsForm(c, {
        ...s,
        reader: await readerKeySet(deps),
        write: c.session.rights.has(SETTINGS_WRITE),
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
      }),
    });
  });

  app.post("/crew/settings", async (request, reply) => {
    const c = await writer(request);
    const f = (request.body ?? {}) as Record<string, unknown>;
    const s = await read(request);
    const r = await deps.admin.request("PUT", PATH, {
      ...asPerson(request),
      json: { settings_version: Number(f.settings_version), values: valuesOf(f, s.values) },
    });
    if (r.status === 409)
      return reply.redirect(
        `${PREFIX}crew/settings?error=${encodeURIComponent(c.t("settings.conflict"))}`,
        303,
      );
    if (r.status >= 400) {
      const e =
        (r.body as { error?: { message?: string } } | undefined)?.error?.message ??
        c.t("settings.failed");
      return reply.redirect(`${PREFIX}crew/settings?error=${encodeURIComponent(e)}`, 303);
    }
    return reply.redirect(`${PREFIX}crew/settings`, 303);
  });
}
