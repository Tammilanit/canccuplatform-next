/**
 * A deck's render part on the Content page (step 3 plan S6; mockup 10): its job's state, at most
 * three slides then a "+N" tile so the strip fits a library card, and its font warnings in words.
 * Redrawn by the page's live refresh, quickly while the job is live.
 */
import { attrs, html } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import type { RenderWarning, SlideMeta } from "../render/client.js";
import { slideUrl } from "../render/jobs.js";
import { counted } from "./messages.js";
import type { Translate } from "./messages.js";
import type { ViewContext } from "./views.js";

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

export const WRITE = "screen.content.write";
const STRIP = 3;

export interface Call {
  call: string;
  url: string;
  body?: string;
  done?: string;
  confirm?: string;
}

/** A control static/studio.js acts on: the call, then a reload that says `done`. */
export const button = (label: string, a: Call, kind = "secondary"): Html => {
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

/** 2, 4–6, 9: runs of slides in order as ranges. */
export function slideRuns(slides: readonly number[]): string {
  const sorted = [...new Set(slides)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const n of sorted) {
    const last = runs.at(-1);
    if (last !== undefined && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(", ");
}

export function warningText(t: Translate, w: RenderWarning, total: number): string {
  if (w.code !== "font_missing" || w.font === null) return w.message;
  const font = w.font;
  if (w.slides.length === 0) return t("render.font_missing_all", { font });
  const every = new Set(w.slides).size === total && w.slides.every((n) => n >= 1 && n <= total);
  if (every && total > 1) return t("render.font_missing_every", { font, count: total });
  const many = w.slides.length > 1;
  return t(many ? "render.font_missing" : "render.font_missing.one", {
    font,
    slides: slideRuns(w.slides),
  });
}

function strip(t: Translate, id: string, title: string, job: DeckJob): Html {
  const slides = job.slides ?? [];
  const shown = slides.slice(0, STRIP).map(
    (s) =>
      html`<li>
        <img${attrs({ src: slideUrl(id, job.asset_version, s.index), alt: t("render.slide", { n: s.index }), width: s.width, height: s.height, loading: "lazy" })} />
      </li>`,
  );
  const rest = slides.length - shown.length;
  const more =
    rest > 0
      ? html`<li
          class="canccu-studio-slides__more"
          aria-label="${counted(t, "render.more_label", rest)}"
        >
          +${rest}
        </li>`
      : "";
  return html`<ol class="canccu-studio-slides" aria-label="${t("render.slides", { title })}">
    ${shown}${more}
  </ol>`;
}

export function renderPart(
  c: ViewContext,
  a: { id: string; title: string },
  job: DeckJob | undefined,
): Html {
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
    const total = job.slides?.length ?? 0;
    const warnings = (job.warnings ?? []).map(
      (w) =>
        html`<li>
          <span class="canccu-i canccu-i--warn" aria-hidden="true"></span>
          ${warningText(t, w, total)}
        </li>`,
    );
    body = html`<p class="canccu-small">${counted(t, "render.succeeded", total)}</p>
      ${strip(t, a.id, a.title, job)}
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
