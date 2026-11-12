/**
 * The Content page (step 3 plan S5, S6; mockup 10): the asset library with search and kinds, the
 * event's storage use, the drop zone, links while `screen.web` is on, and per asset its replace,
 * one-step revert and delete; a deck shows its render job slide by slide. Server-drawn from the
 * reads the API answers; static/studio-content.js uploads and acts only through the API. Each
 * control shows only to holders of the right its API checks (S10).
 */
import { attrs, emptyState, html, raw } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { ASSET_KINDS, FILE_KINDS, isDeck } from "../assets/store.js";
import type { AssetKind } from "../assets/store.js";
import type { RenderWarning, SlideMeta } from "../render/client.js";
import { slideUrl } from "../render/jobs.js";
import { counted } from "./messages.js";
import type { MessageKey, Translate } from "./messages.js";
import { STUDIO } from "./views.js";
import type { ViewContext } from "./views.js";

/** The contract's `Asset`, as `listAssets` answers it. */
export interface ContentAsset {
  id: string;
  kind: AssetKind;
  title: string;
  version: number;
  url: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  health: "ok" | "degraded" | "error";
  health_message: string | null;
  can_revert: boolean;
  used_by: string[];
}

/** A deck's newest job of its current version, with its place in the fair queue. */
export interface DeckJob {
  id: string;
  asset_version: number;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  position: number | null;
  slides_done: number;
  slides: SlideMeta[] | null;
  warnings: RenderWarning[] | null;
  error_message: string | null;
}

export interface ContentData {
  assets: ContentAsset[];
  next: string | null;
  jobs: ReadonlyMap<string, DeckJob>;
  query: { q: string; kind: string; after: string };
  webOn: boolean;
  /** For writers: every asset's kind and whether it is used, for the upload's replace plan. */
  index: Record<string, [kind: string, used: boolean]> | null;
}

const WRITE = "screen.content.write";
const PAGE = `${STUDIO}content`;
const ICONS: Partial<Record<AssetKind, string>> = {
  audio: "bell",
  web: "compass",
  youtube: "monitor",
};

/** 412 MB: binary units, one decimal under 10, as static/studio-content.js writes the storage. */
export function sizeText(t: Translate, bytes: number): string {
  const units: [MessageKey, number][] = [
    ["size.gb", 2 ** 30],
    ["size.mb", 2 ** 20],
    ["size.kb", 2 ** 10],
  ];
  for (const [key, unit] of units) {
    if (bytes >= unit) {
      const n = bytes / unit;
      return t(key, { n: n < 10 ? Math.round(n * 10) / 10 : Math.round(n) });
    }
  }
  return t("size.b", { n: bytes });
}

const lengthText = (seconds: number): string => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

interface Call {
  call: string;
  url: string;
  body?: string;
  done?: string;
  confirm?: string;
}

/** A control static/studio.js acts on: the call, then a reload that says `done`. */
const button = (label: string, a: Call, kind = "secondary"): Html => {
  const data = { "data-call": a.call, "data-url": a.url, "data-body": a.body };
  const then = { "data-done": a.done, "data-confirm": a.confirm };
  return html`<button
    class="canccu-button canccu-button--${kind} canccu-button--sm"
    type="button"
    ${attrs({ ...data, ...then })}
  >
    ${label}
  </button>`;
};

function meta(c: ViewContext, a: ContentAsset): string {
  const { t } = c;
  const parts: string[] = [];
  if (a.kind === "web" || a.kind === "youtube") {
    parts.push(a.url === null ? "" : (URL.parse(a.url)?.hostname ?? a.url));
  } else {
    if (a.duration_seconds !== null) parts.push(lengthText(a.duration_seconds));
    if (a.size_bytes !== null) parts.push(sizeText(t, a.size_bytes));
    if (a.version > 1) parts.push(t("asset.version", { n: a.version }));
  }
  parts.push(
    a.used_by.length === 0 ? t("asset.unused") : counted(t, "asset.used", a.used_by.length),
  );
  return parts.filter((p) => p !== "").join(" · ");
}

function preview(a: ContentAsset, job: DeckJob | undefined): Html {
  const first = job?.state === "succeeded" ? job.slides?.[0] : undefined;
  const inner =
    a.kind === "image" && a.url !== null
      ? html`<img src="${a.url}" alt="" loading="lazy" />`
      : a.kind === "video" && a.url !== null
        ? html`<video src="${a.url}" preload="metadata" muted></video>`
        : first !== undefined
          ? html`<img
              src="${slideUrl(a.id, job?.asset_version ?? a.version, first.index)}"
              alt=""
              loading="lazy"
            />`
          : html`<span
              class="canccu-i canccu-i--${ICONS[a.kind] ?? "box"}"
              aria-hidden="true"
            ></span>`;
  return html`<div class="canccu-studio-asset__preview">${inner}</div>`;
}

function warning(t: Translate, w: RenderWarning): string {
  if (w.code !== "font_missing" || w.font === null) return w.message;
  if (w.slides.length === 0) return t("render.font_missing_all", { font: w.font });
  return counted(t, "render.font_missing", w.slides.length, {
    font: w.font,
    slides: w.slides.join(", "),
  });
}

/** The render job's part: redrawn by the page's live refresh, quickly while the job is live. */
function renderPart(c: ViewContext, a: ContentAsset, job: DeckJob | undefined): Html {
  const { t } = c;
  const write = c.rights.has(WRITE);
  const again = write
    ? button(t("render.again"), {
        call: "POST",
        url: "/api/screen/render-jobs",
        body: JSON.stringify({ asset_id: a.id }),
        done: t("render.again_done"),
      })
    : "";
  const cancel =
    write && job !== undefined
      ? button(t("render.cancel"), {
          call: "DELETE",
          url: `/api/screen/render-jobs/${job.id}`,
          done: t("render.cancel_done"),
        })
      : "";
  const fast = html`<span data-live-fast hidden></span>`;
  let body: Slot;
  if (job === undefined)
    body = html`<p class="canccu-small">${t("render.none")}</p>
      ${again}`;
  else if (job.state === "queued") {
    const text =
      job.position === null ? t("render.queued_next") : t("render.queued", { place: job.position });
    body = html`<p class="canccu-small">${text}</p>
      ${cancel}${fast}`;
  } else if (job.state === "running") {
    body = html`<p class="canccu-small">${counted(t, "render.running", job.slides_done)}</p>
      <progress aria-label="${t("render.running", { count: job.slides_done })}"></progress
      >${cancel}${fast}`;
  } else if (job.state === "succeeded") {
    const slides = job.slides ?? [];
    const strip = slides.map(
      (s) =>
        html`<li>
          <img${attrs({ src: slideUrl(a.id, job.asset_version, s.index), alt: t("render.slide", { n: s.index }), width: s.width, height: s.height, loading: "lazy" })} />
        </li>`,
    );
    const warnings = (job.warnings ?? []).map(
      (w) =>
        html`<li>
          <span class="canccu-i canccu-i--warn" aria-hidden="true"></span> ${warning(t, w)}
        </li>`,
    );
    body = html`<p class="canccu-small">${counted(t, "render.succeeded", slides.length)}</p>
      <ol class="canccu-studio-slides" aria-label="${t("render.slides", { title: a.title })}">
        ${strip}
      </ol>
      ${
        warnings.length === 0
          ? ""
          : html`<ul class="canccu-studio-warnings canccu-small">
              ${warnings}
            </ul>`
      }`;
  } else if (job.state === "failed") {
    body = html`<p class="canccu-small canccu-studio-refused">
        ${t("render.failed", { message: job.error_message ?? "" })}
      </p>
      ${again}`;
  } else
    body = html`<p class="canccu-small">${t("render.cancelled")}</p>
      ${again}`;
  return html`<div class="canccu-studio-render" data-live="render-${a.id}">${body}</div>`;
}

function assetCard(c: ViewContext, d: ContentData, a: ContentAsset): Html {
  const { t } = c;
  const write = c.rights.has(WRITE);
  const job = d.jobs.get(a.id);
  const link = a.kind === "web" || a.kind === "youtube";
  const notes: Slot[] = [];
  if (link && !d.webOn) notes.push(t("asset.web_off"));
  if (a.health !== "ok") {
    notes.push(
      t(a.health === "error" ? "asset.error" : "asset.degraded", {
        message: a.health_message ?? "",
      }),
    );
  }
  const actions: Slot[] = [];
  if (write && FILE_KINDS.includes(a.kind)) {
    actions.push(
      html`<label class="canccu-button canccu-button--secondary canccu-button--sm"
        >${t("asset.replace")}<input type="file" hidden data-replace="${a.id}"
      /></label>`,
    );
  }
  if (write && a.can_revert) {
    actions.push(
      button(t("asset.revert"), {
        call: "POST",
        url: `/api/screen/assets/${a.id}/revert`,
        done: t("asset.reverted"),
      }),
    );
  }
  if (write && link && a.health !== "ok") {
    actions.push(
      button(t("asset.recheck"), {
        call: "PATCH",
        url: `/api/screen/assets/${a.id}`,
        body: JSON.stringify({ reset_health: true }),
        done: t("asset.rechecked"),
      }),
    );
  }
  if (write) {
    actions.push(
      button(
        t("asset.delete"),
        {
          call: "DELETE",
          url: `/api/screen/assets/${a.id}`,
          confirm: t("asset.delete_confirm"),
          done: t("asset.deleted"),
        },
        "danger-ghost",
      ),
    );
  }
  return html`<article class="canccu-card canccu-studio-asset" id="asset-${a.id}">
    ${preview(a, job)}
    <p class="canccu-overline">${t(`kind.${a.kind}`)}</p>
    <h3 class="canccu-studio-asset__title">${a.title}</h3>
    <p class="canccu-small canccu-muted" data-asset-status>${meta(c, a)}</p>
    ${notes.map((n) => html`<p class="canccu-small canccu-studio-refused">${n}</p>`)}
    ${isDeck(a.kind) ? renderPart(c, a, job) : ""}
    ${actions.length === 0 ? "" : html`<div class="canccu-cluster">${actions}</div>`}
  </article>`;
}

/** The page address with these parameters; `after` first, so the pager's links read plainly. */
function pageUrl(q: Record<string, string>): string {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== ""));
  return params.size === 0 ? PAGE : `${PAGE}?${params.toString()}`;
}

function finder(c: ViewContext, d: ContentData): Html {
  const { t } = c;
  const kinds: [string, string][] = [
    ["", t("content.kind_all")],
    ...ASSET_KINDS.map((k): [string, string] => [k, t(`kind.${k}`)]),
  ];
  return html`<div class="canccu-studio-library-head">
    <form class="canccu-cluster canccu-studio-find" method="get" action="${PAGE}" role="search">
      <input
        class="canccu-input"
        type="search"
        name="q"
        maxlength="120"
        ${attrs({ value: d.query.q, placeholder: t("content.search"), "aria-label": t("content.search") })}
      />
      <select class="canccu-input" name="kind" aria-label="${t("content.kind_all")}">
        ${kinds.map(([v, label]) => html`<option${attrs({ value: v, selected: v === d.query.kind })}>${label}</option>`)}
      </select>
      <button class="canccu-button canccu-button--secondary" type="submit">
        ${t("content.find")}
      </button>
    </form>
    <div class="canccu-studio-storage" data-storage="/api/tenants/current/storage" hidden>
      <span class="canccu-small"></span
      ><meter min="0" max="1" value="0" aria-label="${t("storage.label")}"></meter>
    </div>
  </div>`;
}

function adders(c: ViewContext, d: ContentData): Html {
  const { t } = c;
  const drop = html`<section
    class="canccu-studio-drop"
    data-upload
    aria-label="${t("upload.drop")}"
  >
    <p class="canccu-studio-drop__text">${t("upload.drop")}</p>
    <p class="canccu-small canccu-muted">${t("upload.hint")}</p>
    <label class="canccu-button canccu-button--primary"
      >${t("upload.choose")}<input type="file" multiple hidden data-upload-input
    /></label>
    <div class="canccu-studio-plan" data-upload-plan hidden></div>
    <ul class="canccu-studio-uploads" data-upload-list aria-label="${t("upload.list")}" hidden></ul>
  </section>`;
  if (!d.webOn) return drop;
  const field = (name: string, label: string, control: Html, hint?: string) =>
    html`<div class="canccu-field">
      <label class="canccu-field__label" for="canccu-studio-link-${name}">${label}</label
      >${control}${hint === undefined ? "" : html`<p class="canccu-field__hint">${hint}</p>`}
    </div>`;
  return html`${drop}
    <details class="canccu-card canccu-studio-link" data-add-link>
      <summary>${t("link.title")}</summary>
      <form class="canccu-form">
        ${field(
          "kind",
          t("link.kind"),
          html`<select class="canccu-input" id="canccu-studio-link-kind" name="kind">
            <option value="web">${t("kind.web")}</option>
            <option value="youtube">${t("kind.youtube")}</option>
          </select>`,
        )}
        ${field("url", t("link.url"), html`<input class="canccu-input" id="canccu-studio-link-url" name="url" type="url" required pattern="https://.+" />`, t("link.url_hint"))}
        ${field("title", t("link.name"), html`<input class="canccu-input" id="canccu-studio-link-title" name="title" required maxlength="200" />`)}
        <button class="canccu-button canccu-button--primary" type="submit">${t("link.add")}</button>
      </form>
    </details>`;
}

export function contentView(c: ViewContext, d: ContentData): Html {
  const { t } = c;
  const searched = d.query.q !== "" || d.query.kind !== "";
  const library =
    d.assets.length > 0
      ? html`<div class="canccu-studio-library">${d.assets.map((a) => assetCard(c, d, a))}</div>`
      : searched
        ? emptyState({ icon: "box", title: t("content.none_title"), text: t("content.none_text") })
        : emptyState({
            icon: "box",
            title: t("content.empty_title"),
            text: t("content.empty_text"),
          });
  const filters = { q: d.query.q, kind: d.query.kind };
  const pager = [
    d.query.after === ""
      ? ""
      : html`<a class="canccu-button canccu-button--ghost" href="${pageUrl(filters)}"
          >${t("content.newest")}</a
        >`,
    d.next === null
      ? ""
      : html`<a
          class="canccu-button canccu-button--secondary"
          href="${pageUrl({ after: d.next, ...filters })}"
          >${t("content.older")}</a
        >`,
  ];
  const index =
    d.index === null
      ? ""
      : raw(
          `<script type="application/json" id="canccu-studio-assets">${JSON.stringify(d.index).replace(/</g, "\\u003c")}</script>`,
        );
  return html`${finder(c, d)}${c.rights.has(WRITE) ? adders(c, d) : ""}${library}
    <div class="canccu-cluster">${pager}</div>
    ${index}`;
}
