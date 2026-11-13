/**
 * The Content page (step 3 plan S5, S6; mockup 10): the asset library with search and kinds, the
 * event's storage use, the drop zone, links while `screen.web` is on, and per asset its replace,
 * one-step revert and delete; a deck shows its render job (content-render.ts). Server-drawn from the
 * reads the API answers; static/studio-content.js uploads and acts only through the API. Each
 * control shows only to holders of the right its API checks (S10).
 */
import { attrs, emptyState, html, raw } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { ASSET_KINDS, FILE_KINDS, isDeck } from "../assets/store.js";
import type { AssetKind } from "../assets/store.js";
import { slideUrl } from "../render/jobs.js";
import { button, renderPart, WRITE } from "./content-render.js";
import type { DeckJob } from "./content-render.js";
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

export interface ContentData {
  assets: ContentAsset[];
  next: string | null;
  jobs: ReadonlyMap<string, DeckJob>;
  query: { q: string; kind: string; after: string };
  webOn: boolean;
  /** For writers: every asset's kind and whether it is used, for the upload's replace plan. */
  index: Record<string, [kind: string, used: boolean]> | null;
}

const PAGE = `${STUDIO}content`;
const ICONS: Partial<Record<AssetKind, string>> = {
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

function meta(c: ViewContext, a: ContentAsset): string {
  const { t } = c;
  const parts: string[] = [];
  if (a.kind === "web" || a.kind === "youtube") {
    parts.push(a.url === null ? "" : (URL.parse(a.url)?.hostname ?? a.url));
  } else {
    // A sound's length is on its play row.
    if (a.duration_seconds !== null && a.kind !== "audio") {
      parts.push(lengthText(a.duration_seconds));
    }
    if (a.size_bytes !== null) parts.push(sizeText(t, a.size_bytes));
    if (a.version > 1) parts.push(t("asset.version", { n: a.version }));
  }
  parts.push(
    a.used_by.length === 0 ? t("asset.unused") : counted(t, "asset.used", a.used_by.length),
  );
  return parts.filter((p) => p !== "").join(" · ");
}

/** A sound has nothing to look at: a short row with its length and a play button instead. */
function sound(c: ViewContext, a: ContentAsset): Html {
  const play =
    a.url === null
      ? ""
      : html`<button
          class="canccu-button canccu-button--secondary canccu-button--sm"
          type="button"
          data-play="${a.url}"
        >
          ${c.t("sound.play")}
        </button>`;
  const length = a.duration_seconds === null ? "" : lengthText(a.duration_seconds);
  return html`<div class="canccu-studio-sound">
    <span class="canccu-studio-sound__note" aria-hidden="true">♪</span>
    <span class="canccu-small canccu-muted">${length}</span>${play}
  </div>`;
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
  // A writer drags any asset a playlist can play into the builder (static/studio-playlists.js).
  const drag = write && a.kind !== "audio" ? html` draggable="true" data-drag-asset="${a.id}"` : "";
  return html`<article class="canccu-card canccu-studio-asset" id="asset-${a.id}" ${drag}>
    ${a.kind === "audio" ? sound(c, a) : preview(a, job)}
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

function finder(c: ViewContext, d: ContentData, playlist: string): Html {
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
      ${playlist === "" ? "" : html`<input type="hidden" name="playlist" value="${playlist}" />`}
      <button class="canccu-button canccu-button--secondary" type="submit">
        ${t("content.find")}
      </button>
    </form>
    <div class="canccu-studio-storage" data-storage="/api/tenants/current/storage" hidden>
      <span class="canccu-small"></span>
      <div
        class="canccu-studio-storage__track"
        role="meter"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
        aria-label="${t("storage.label")}"
      >
        <span class="canccu-studio-storage__fill"></span>
      </div>
    </div>
  </div>`;
}

/** One drop band (mockup 10): files on its first line, a pasted web or YouTube link on its second. */
function adders(c: ViewContext, d: ContentData): Html {
  const { t } = c;
  const link = d.webOn
    ? html`<form class="canccu-studio-drop__link" data-add-link aria-label="${t("link.title")}">
        <span class="canccu-small canccu-muted">${t("link.title")}</span>
        <select class="canccu-input" name="kind" aria-label="${t("link.kind")}">
          <option value="web">${t("kind.web")}</option>
          <option value="youtube">${t("kind.youtube")}</option>
        </select>
        <input
          class="canccu-input canccu-studio-drop__url"
          name="url"
          type="url"
          required
          pattern="https://.+"
          ${attrs({ placeholder: t("link.paste"), "aria-label": t("link.url") })}
        />
        <input
          class="canccu-input"
          name="title"
          required
          maxlength="200"
          ${attrs({ placeholder: t("link.name"), "aria-label": t("link.name") })}
        />
        <button class="canccu-button canccu-button--secondary canccu-button--sm" type="submit">
          ${t("link.add")}
        </button>
      </form>`
    : "";
  return html`<section class="canccu-studio-drop" data-upload aria-label="${t("upload.drop")}">
    <div class="canccu-studio-drop__files">
      <p class="canccu-studio-drop__text">
        <strong>${t("upload.drop")}</strong>
        <span class="canccu-small canccu-muted">· ${t("upload.hint")}</span>
      </p>
      <label class="canccu-button canccu-button--primary canccu-button--sm"
        >${t("upload.choose")}<input type="file" multiple hidden data-upload-input
      /></label>
    </div>
    ${link}
    <div class="canccu-studio-plan" data-upload-plan hidden></div>
    <ul class="canccu-studio-uploads" data-upload-list aria-label="${t("upload.list")}" hidden></ul>
  </section>`;
}

/**
 * `playlist` is the side column's open playlist: the search and the pager carry it, so a writer
 * can drag from a filtered or older page into that playlist rather than the default one.
 */
export function contentView(c: ViewContext, d: ContentData, playlist = ""): Html {
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
  const filters = { q: d.query.q, kind: d.query.kind, playlist };
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
  return html`${finder(c, d, playlist)}${c.rights.has(WRITE) ? adders(c, d) : ""}${library}
    <div class="canccu-cluster">${pager}</div>
    ${index}`;
}
