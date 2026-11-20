/**
 * Food settings (`/pizza/crew/settings`, mockup 17 A and B): ordering, and the scheduler's times
 * and forgotten orders. Read and saved through admin's settings API as the person, with
 * `admin.settings.write` and the version they read, so admin checks, audits and announces the
 * change; the keys this page does not show (settling up, the money issue's) are sent back as read.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AppDeps } from "../http.js";
import { DEFAULT_SETTINGS, TIME_BOUNDS } from "../settings.js";
import type { TimeKey } from "../settings.js";
import { flash } from "./order-view.js";
import { PREFIX, SETTINGS_WRITE, formKey, organiserPage, pageCtx } from "./kit.js";
import type { PageCtx } from "./kit.js";
import type { MessageKey } from "./messages.js";

type Values = Record<string, unknown>;
const PATH = "/api/admin/settings/pizza";
const TIMES = Object.keys(TIME_BOUNDS) as TimeKey[];
const COUNTS = { max_open_orders: [1, 20], max_items_per_person: [1, 20] } as const;

/** The minutes as people read them: "10 min", "2 h", "1 h 30 min". */
export function duration(c: PageCtx, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return c.t("time.min", { n: m });
  return m === 0 ? c.t("time.h", { n: h }) : c.t("time.h_min", { h, m });
}

function form(c: PageCtx, values: Values, version: number, error?: string): Html {
  const v = { ...DEFAULT_SETTINGS, ...values } as Values;
  const sw = (key: string, label: MessageKey, hint: MessageKey) =>
    html`<label class="pizza-switch"
      ><span class="pizza-switch__text"
        ><span class="pizza-switch__label">${c.t(label)}</span
        ><span class="canccu-muted canccu-small">${c.t(hint)}</span></span
      ><input
        type="hidden"
        name="${key}"
        value="off" /><input${attrs({ class: "pizza-switch__box", type: "checkbox", name: key, value: "on", checked: v[key] !== false })}
    /></label>`;
  const count = (key: keyof typeof COUNTS, label: MessageKey, hint: MessageKey) =>
    html`<label class="pizza-setting"
      ><span class="pizza-switch__text"
        ><span class="pizza-switch__label">${c.t(label)}</span
        ><span class="canccu-muted canccu-small">${c.t(hint)}</span></span
      ><input${attrs({ class: "canccu-input pizza-number", type: "number", name: key, min: COUNTS[key][0], max: COUNTS[key][1], step: 1, value: Number(v[key]), required: true })}
    /></label>`;
  const slider = (key: TimeKey) =>
    html`<label class="pizza-slider"
      ><span class="pizza-switch__label">${c.t(`settings.${key}` as MessageKey)}</span
      ><input${attrs({ type: "range", name: key, min: TIME_BOUNDS[key][0], max: TIME_BOUNDS[key][1], step: key === "last_call_minutes" ? 1 : 5, value: Number(v[key]), "data-minutes": "" })} /><output
        class="canccu-num"
        data-minutes-out
        >${duration(c, Number(v[key]))}</output
      ></label
    >`;
  const by = v.open_by === "crew" ? "crew" : "anyone";
  return html`${flash(error)}
    <form
      method="post"
      action="${PREFIX}crew/settings"
      class="canccu-settings"
      data-min="${c.t("time.min")}"
      data-h="${c.t("time.h")}"
      data-hmin="${c.t("time.h_min")}"
    >
      ${formKey()}<input type="hidden" name="settings_version" value="${version}" />
      <section class="canccu-card pizza-form">
        <h2 class="canccu-card__title">${c.t("settings.ordering")}</h2>
        ${sw("ordering_open", "settings.ordering_open", "settings.ordering_open_hint")}
        <fieldset class="pizza-fieldset">
          <legend class="pizza-switch__label">${c.t("settings.open_by")}</legend>
          <div class="pizza-choices pizza-choices--two">
            <label class="pizza-choice"
              ><input${attrs({ type: "radio", name: "open_by", value: "anyone", checked: by === "anyone" })} /><span
                >${c.t("settings.anyone")}</span
              ></label
            >
            <label class="pizza-choice"
              ><input${attrs({ type: "radio", name: "open_by", value: "crew", checked: by === "crew" })} /><span
                >${c.t("settings.crew_only")}</span
              ></label
            >
          </div>
        </fieldset>
        ${count("max_open_orders", "settings.max_open_orders", "settings.max_open_orders_hint")}
        ${count("max_items_per_person", "settings.max_items_per_person", "settings.max_items_per_person_hint")}
      </section>
      <section class="canccu-card pizza-form">
        <h2 class="canccu-card__title">${c.t("settings.times")}</h2>
        ${TIMES.map(slider)} ${sw("auto_close", "settings.auto_close", "settings.auto_close_hint")}
        ${sw("close_forgotten", "settings.close_forgotten", "settings.close_forgotten_hint")}
      </section>
      <div class="canccu-savebar">
        <span class="canccu-savebar__text">${c.t("settings.saved_where")}</span>
        <a class="canccu-button canccu-button--secondary" href="${PREFIX}crew/settings"
          >${c.t("settings.cancel")}</a
        >
        <button class="canccu-button canccu-button--primary" type="submit">
          ${c.t("settings.save")}
        </button>
      </div>
    </form>`;
}

/** The form's values as admin's settings take them: numbers within bounds, switches as booleans. */
export function valuesOf(form: Record<string, unknown>, read: Values): Values {
  const out: Values = { ...read };
  const flag = (k: string) => {
    const raw = form[k];
    const last: unknown = Array.isArray(raw) ? (raw as unknown[]).at(-1) : raw;
    if (last === "on" || last === "off") out[k] = last === "on";
  };
  for (const k of ["ordering_open", "auto_close", "close_forgotten"]) flag(k);
  if (form.open_by === "anyone" || form.open_by === "crew") out.open_by = form.open_by;
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
  const read = async (request: FastifyRequest) => {
    const r = await deps.admin.request("GET", PATH, asPerson(request));
    if (r.status >= 400)
      throw new KitError("Admin did not answer with the settings.", {
        status: 502,
        code: "admin_unavailable",
      });
    const b = r.body as { values?: Values; settings_version?: number };
    return { values: b.values ?? {}, version: b.settings_version ?? 0 };
  };

  app.get<{ Querystring: { error?: string } }>("/crew/settings", async (request, reply) => {
    const c = await writer(request);
    const s = await read(request);
    return organiserPage(request, reply, deps, c, {
      title: c.t("crew.title"),
      tab: "settings",
      narrow: true,
      body: form(c, s.values, s.version, request.query.error),
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
