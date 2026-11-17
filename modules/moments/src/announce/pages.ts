/**
 * Run the event → Announcements (contracts/moments.md, Announcements, Pages; mockup 05, U5, U11).
 * Every action goes on to the API (viaApi), so the page has the API's rights, validation,
 * idempotency and audit and nothing of its own.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { html } from "@canccu/ui";
import { SETTINGS, tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { PREFIX, page, pageNeeds, refusal, viaApi } from "../page-kit.js";
import { knownZones } from "../store.js";
import { ANNOUNCE } from "./routes.js";
import { listAnnouncements, lockAnnouncement, runOfShow } from "./store.js";
import type { AnnouncementRow, RunItem } from "./store.js";
import { isBuiltin, loadTemplates } from "./templates.js";
import { clock, composerForm, editView, flash, listView, previewView } from "./views.js";
import type { ComposerState, Listed, Preview } from "./views.js";

type Form = Record<string, string | undefined>;
type Q = { Querystring: Form; Body: Form };

const BLANK: ComposerState = {
  title: "",
  body: "",
  level: "info",
  full_screen: false,
  channels: { screen: true, ticker: false, discord: false, push: false },
  zones: [],
  duration_seconds: 300,
  item_id: "",
  when: "now",
  at_local: "",
  minutes_before: 15,
  variables: {},
  template_key: "",
};

/** The form as posted: unticked boxes are absent, so absent is false. */
function stateOf(f: Form): ComposerState {
  const on = (k: string) => f[k] === "true";
  const vars: Record<string, string> = {};
  const zones: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith("var_") && typeof v === "string") vars[k.slice(4)] = v;
    if (k.startsWith("zone_") && v === "true") zones.push(k.slice(5));
  }
  const when = f.when === "at" || f.when === "item" ? f.when : "now";
  return {
    title: f.title ?? "",
    body: f.body ?? "",
    level: f.level === "urgent" ? "urgent" : "info",
    full_screen: on("full_screen"),
    channels: {
      screen: on("ch_screen"),
      ticker: on("ch_ticker"),
      discord: on("ch_discord"),
      push: on("ch_push"),
    },
    zones,
    duration_seconds: Number(f.duration_seconds ?? 300),
    item_id: f.item_id ?? "",
    when,
    at_local: f.at_local ?? "",
    minutes_before: Number(f.minutes_before ?? 0),
    variables: vars,
    template_key: f.template_key ?? "",
  };
}

/** A wall-clock time in the event's time zone ("2026-03-14T20:15") as an instant. */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const asUtc = Date.parse(`${local}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  const offset = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    const n = (k: string) => Number(p[k] ?? 0);
    return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - t;
  };
  // Twice, so a time next to a daylight-saving change lands on the right side of it.
  const first = asUtc - offset(asUtc);
  return new Date(asUtc - offset(first));
}

function inputOf(s: ComposerState, timeZone: string): Record<string, unknown> {
  const at = s.when === "at" ? zonedToUtc(s.at_local, timeZone) : null;
  return {
    title: s.title,
    body: s.body,
    level: s.level,
    full_screen: s.full_screen,
    channels: s.channels,
    zones: s.zones,
    duration_seconds: s.duration_seconds,
    item_id: s.item_id === "" ? null : s.item_id,
    variables: s.variables,
    template_key: s.template_key === "" ? null : s.template_key,
    when:
      s.when === "now"
        ? { mode: "now" }
        : s.when === "at"
          ? { mode: "at", at: at?.toISOString() ?? "" }
          : { mode: "item", minutes_before: s.minutes_before },
  };
}

function listed(a: AnnouncementRow, items: RunItem[], timeZone: string): Listed {
  const t = (d: Date | null) => (d === null ? "" : clock(d.toISOString(), timeZone));
  const item = items.find((i) => i.id === a.item_id);
  const when =
    a.status === "live"
      ? `until ${t(a.expires_at)}`
      : a.status === "scheduled"
        ? a.when.mode === "item"
          ? `with ${item?.title ?? "its item"} · ${t(a.fire_at)}`
          : `at ${t(a.fire_at)}`
        : `${a.end_reason ?? a.status} ${t(a.ended_at)}${a.why === null ? "" : ` · ${a.why}`}`;
  return { id: a.id, status: a.status, title: a.title ?? a.title_text, level: a.level, when };
}

export function announcePages(pages: FastifyInstance, deps: AppDeps): void {
  const announce = { preHandler: pageNeeds(deps, ANNOUNCE) };
  const has = (r: FastifyRequest, right: string) => r.session?.rights.has(right) === true;
  const back = (reply: FastifyReply, key: "done" | "error", text: string) =>
    reply.redirect(`${PREFIX}announce?${key}=${encodeURIComponent(text)}`, 303);

  async function render(
    request: FastifyRequest<Q>,
    reply: FastifyReply,
    state: ComposerState,
    o: { preview?: Preview; error?: string; edit?: AnnouncementRow } = {},
  ): Promise<FastifyReply> {
    const ctx = tenantOf(request);
    const data = await deps.db.tenant(async (c) => ({
      templates: await loadTemplates(c),
      zones: (await knownZones(c)).sort(),
      items: ((await runOfShow(c)) ?? [])
        .filter((i) => i.status !== "cancelled")
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      announcements: await listAnnouncements(c),
    }));
    const archived = ctx.status === "archived";
    const left =
      o.edit === undefined
        ? composerForm({
            state,
            templates: data.templates,
            zones: data.zones,
            items: data.items,
            timeZone: ctx.time_zone,
            canSaveTemplate: has(request, SETTINGS) && !archived,
            previewed: o.preview !== undefined,
          })
        : editView({
            id: o.edit.id,
            status: o.edit.status,
            title: o.edit.title_text,
            body: o.edit.body_text,
            variables: o.edit.variables,
          });
    const preview =
      o.preview === undefined ? "" : previewView(o.preview, state, o.preview.zones[0]);
    return page(request, reply, deps, {
      title: "Announcements",
      current: "announce",
      description: "One form for the screens, the ticker, Discord and phones, previewed first.",
      body: html`${flash(request.query.done, o.error ?? request.query.error)}
        <div class="moments-announce">
          <section class="canccu-card">${left}</section>
          <div class="moments-side">
            ${preview}
            ${listView({
              listed: data.announcements.map((a) => listed(a, data.items, ctx.time_zone)),
              canWrite: !archived,
              templates: data.templates,
              canDeleteTemplates: has(request, SETTINGS) && !archived,
            })}
          </div>
        </div>`,
    });
  }

  pages.get<Q>("/announce", announce, async (request, reply) => {
    const q = request.query;
    if (q.edit !== undefined) {
      const edit = await deps.db.tenant((c) => lockAnnouncement(c, q.edit ?? ""));
      if (edit !== null) return render(request, reply, BLANK, { edit });
    }
    const templates = await deps.db.tenant((c) => loadTemplates(c));
    const t = templates.find((x) => x.key === q.template);
    return render(request, reply, {
      ...BLANK,
      ...(t === undefined
        ? {}
        : { title: t.title, body: t.body, level: t.level, template_key: t.key }),
      ...(q.item === undefined ? {} : { item_id: q.item, when: "item" as const }),
    });
  });

  pages.post<Q>("/announce", announce, async (request, reply) => {
    const state = stateOf(request.body);
    const tz = tenantOf(request).time_zone;
    if (request.body.do === "template") {
      const name = (request.body.template_name ?? state.title).trim().slice(0, 40);
      let key = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!/^[a-z]/.test(key)) key = `t_${key}`;
      if (isBuiltin(key)) key = `my_${key}`;
      key = key.slice(0, 32);
      const own = (await deps.db.tenant((c) => loadTemplates(c))).find((t) => t.key === key);
      const a = await viaApi(pages, request, "PUT", `/api/moments/announcement-templates/${key}`, {
        name: name === "" ? key : name,
        title: state.title,
        body: state.body,
        level: state.level,
        revision: own?.revision ?? 0,
      });
      return a.status >= 400
        ? back(reply, "error", refusal(a))
        : back(reply, "done", "Template saved.");
    }
    if (request.body.do === "send") {
      const a = await viaApi(
        pages,
        request,
        "POST",
        "/api/moments/announcements",
        inputOf(state, tz),
      );
      if (a.status >= 400) return render(request, reply, state, { error: refusal(a) });
      return back(reply, "done", a.body.status === "live" ? "Sent." : "Scheduled.");
    }
    const a = await viaApi(
      pages,
      request,
      "POST",
      "/api/moments/announcements/preview",
      inputOf(state, tz),
    );
    return a.status >= 400
      ? render(request, reply, state, { error: refusal(a) })
      : render(request, reply, state, { preview: a.body as unknown as Preview });
  });

  pages.post<Q & { Params: { id: string } }>(
    "/announce/:id/edit",
    announce,
    async (request, reply) => {
      const f = request.body;
      const variables = Object.fromEntries(
        Object.entries(f)
          .filter(([k]) => k.startsWith("var_"))
          .map(([k, v]) => [k.slice(4), v ?? ""]),
      );
      const a = await viaApi(
        pages,
        request,
        "PATCH",
        `/api/moments/announcements/${encodeURIComponent(request.params.id)}`,
        {
          title: f.title ?? "",
          body: f.body ?? "",
          variables,
        },
      );
      return a.status >= 400
        ? back(reply, "error", refusal(a))
        : back(reply, "done", "Updated everywhere.");
    },
  );

  pages.post<Q & { Params: { id: string } }>(
    "/announce/:id/withdraw",
    announce,
    async (request, reply) => {
      const a = await viaApi(
        pages,
        request,
        "POST",
        `/api/moments/announcements/${encodeURIComponent(request.params.id)}/withdraw`,
        {},
      );
      return a.status >= 400
        ? back(reply, "error", refusal(a))
        : back(reply, "done", "Withdrawn everywhere.");
    },
  );

  pages.post<Q & { Params: { key: string } }>(
    "/announce/templates/:key/delete",
    { preHandler: pageNeeds(deps, SETTINGS) },
    async (request, reply) => {
      const a = await viaApi(
        pages,
        request,
        "DELETE",
        `/api/moments/announcement-templates/${encodeURIComponent(request.params.key)}`,
        {},
      );
      return a.status >= 400
        ? back(reply, "error", refusal(a))
        : back(reply, "done", "Template deleted.");
    },
  );
}
