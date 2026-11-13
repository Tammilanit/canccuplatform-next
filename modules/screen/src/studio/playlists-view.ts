/**
 * The Content page's side column (step 3 plan S7, S8; mockup 10): the playlist builder, Push now
 * and the pushes playing now. The server draws the frame and hands the chosen playlist and the
 * library to static/studio-playlists.js as JSON, which draws the items and the run order as they
 * are edited and saves the whole playlist through the API. Each control shows only to holders of
 * the right its API checks (S10): building is `screen.content.write`, pushing and clearing
 * `screen.push.write`.
 */
import { attrs, emptyState, html, raw } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { button } from "./content-render.js";
import { contentView } from "./content-view.js";
import type { ContentData } from "./content-view.js";
import type { PlaylistsData } from "./playlists-data.js";
import { STUDIO, clockTime } from "./views.js";
import type { ViewContext, ZoneSummary } from "./views.js";

const BUILD = "screen.content.write";
const PUSH = "screen.push.write";

/** A JSON block for the page script; `<` escaped so no text can close the element. */
const block = (id: string, value: unknown): Html =>
  raw(
    `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`,
  );

function newPlaylist(c: ViewContext): Html {
  const { t } = c;
  return html`<details class="canccu-studio-new">
    <summary class="canccu-button canccu-button--secondary canccu-button--sm">
      ${t("playlist.new")}
    </summary>
    <form class="canccu-studio-new__form" data-playlist-new>
      <input
        class="canccu-input"
        name="name"
        required
        maxlength="80"
        ${attrs({ placeholder: t("playlist.name"), "aria-label": t("playlist.name") })}
      />
      <select class="canccu-input" name="type" aria-label="${t("playlist.type")}">
        <option value="regular">${t("playlist.type.regular")}</option>
        <option value="slideshow">${t("playlist.type.slideshow")}</option>
      </select>
      <button class="canccu-button canccu-button--primary canccu-button--sm" type="submit">
        ${t("playlist.create")}
      </button>
    </form>
  </details>`;
}

/** The library's search and page ride along the picker, so picking a playlist keeps the library. */
const libraryKeep = (q: ContentData["query"]): Html[] =>
  Object.entries(q)
    .filter(([, v]) => v !== "")
    .map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}" />`);

function playlistPanel(c: ViewContext, d: PlaylistsData, library: ContentData["query"]): Html {
  const { t } = c;
  const write = c.rights.has(BUILD);
  const pick =
    d.playlists.length === 0
      ? ""
      : html`<form method="get" action="${STUDIO}content" class="canccu-studio-pick">
          <select
            class="canccu-input"
            name="playlist"
            data-playlist-pick
            aria-label="${t("playlist.pick")}"
          >
            ${d.playlists.map(
              (p) =>
                html`<option${attrs({ value: p.id, selected: p.id === d.chosen?.id })}>
                  ${p.name} · ${t(`playlist.type.${p.type}`)}
                </option>`,
            )}
          </select>
          ${libraryKeep(library)}
        </form>`;
  const editor =
    d.chosen === null
      ? emptyState({
          icon: "sliders",
          title: t("playlist.none_title"),
          text: t("playlist.none_text"),
        })
      : html`<div
          class="canccu-studio-builder"
          data-playlist-editor
          ${attrs({ "data-write": String(write) })}
        ></div>`;
  return html`<section class="canccu-card canccu-studio-panel" aria-label="${t("playlist.title")}">
    <div class="canccu-studio-panel__head">
      <h2 class="canccu-studio-panel__title">${t("playlist.title")}</h2>
      ${pick}${write ? newPlaylist(c) : ""}
    </div>
    ${editor}${block("canccu-studio-playlist", d.chosen)}${block("canccu-studio-library", d.library)}
  </section>`;
}

function pushForm(c: ViewContext, d: PlaylistsData, zones: readonly ZoneSummary[]): Html {
  const { t } = c;
  const playable = d.playlists.filter((p) => p.type !== "break");
  const option = (value: string, label: string, selected = false) =>
    html`<option${attrs({ value, selected })}>${label}</option>`;
  const chip = (value: string, label: string, all = false) =>
    html`<label class="canccu-studio-chip"
      ><input type="checkbox" name="zone" ${attrs({ value, checked: all, "data-all": all })} />
      ${label}</label
    >`;
  const preset = (value: string, label: string, checked = false, extra: Html | string = "") =>
    html`<label class="canccu-studio-chip"
      ><input type="radio" name="for" ${attrs({ value, checked, "data-preset": value })} />
      ${label}${extra}</label
    >`;
  const at = html`<input
    class="canccu-input canccu-studio-push__at"
    type="time"
    name="at"
    aria-label="${t("push.at_label")}"
  />`;
  return html`<form
    class="canccu-studio-push"
    data-push-form
    ${attrs({ "data-time-zone": c.timeZone })}
  >
    <label class="canccu-field">
      <span class="canccu-label">${t("push.what")}</span>
      <select class="canccu-input" name="what" required>
        <optgroup label="${t("push.playlists")}">
          ${playable.map((p) => option(`playlist:${p.id}`, p.name, p.id === d.chosen?.id))}
        </optgroup>
        <optgroup label="${t("push.assets")}">
          ${Object.entries(d.library).map(([id, a]) => option(`asset:${id}`, a.title))}
        </optgroup>
      </select>
    </label>
    <fieldset class="canccu-studio-push__set">
      <legend class="canccu-label">${t("push.zones")}</legend>
      <div class="canccu-cluster">
        ${chip("", t("push.all"), true)}${zones.map((z) => chip(z.key, z.name))}
      </div>
    </fieldset>
    <fieldset class="canccu-studio-push__set">
      <legend class="canccu-label">${t("push.until")}</legend>
      <div class="canccu-cluster">
        ${preset("15", t("push.15"))}${preset("60", t("push.60"), true)}${preset("day", t("push.day"))}
        ${preset("at", t("push.at"), false, at)}
      </div>
    </fieldset>
    <button class="canccu-button canccu-button--primary" type="submit">${t("push.submit")}</button>
  </form>`;
}

function pushList(c: ViewContext, d: PlaylistsData, zones: readonly ZoneSummary[]): Html {
  const { t } = c;
  const name = (key: string) => zones.find((z) => z.key === key)?.name ?? key;
  const rows = d.pushes.map((p) => {
    const where = p.zones.length === 0 ? t("push.all") : p.zones.map(name).join(", ");
    const clear = c.rights.has(PUSH)
      ? button(
          t("pushes.clear"),
          {
            call: "DELETE",
            url: `/api/screen/push/${p.id}`,
            confirm: t("pushes.clear_confirm"),
            done: t("pushes.cleared"),
          },
          "danger-ghost",
        )
      : "";
    return html`<li class="canccu-studio-pushes__row">
      <span>
        <strong>${p.what ?? t("pushes.gone")}</strong>
        <span class="canccu-small canccu-muted"
          >${where} · ${t("pushes.until", { time: clockTime(p.until, c.timeZone) })}</span
        >
      </span>
      ${clear}
    </li>`;
  });
  return html`<section class="canccu-studio-pushes" data-pushes aria-label="${t("pushes.title")}">
    <h3 class="canccu-label">${t("pushes.title")}</h3>
    ${
      rows.length === 0
        ? html`<p class="canccu-small canccu-muted">${t("pushes.none")}</p>`
        : html`<ul class="canccu-studio-pushes__list">
            ${rows}
          </ul>`
    }
  </section>`;
}

function playlistsView(
  c: ViewContext,
  d: PlaylistsData,
  zones: readonly ZoneSummary[],
  library: ContentData["query"],
): Html {
  const { t } = c;
  return html`${playlistPanel(c, d, library)}
    <div class="canccu-card canccu-studio-panel canccu-studio-panel--push">
      <h2 class="canccu-studio-panel__title">${t("push.title")}</h2>
      <p class="canccu-small canccu-muted">${t("push.desc")}</p>
      ${c.rights.has(PUSH) ? pushForm(c, d, zones) : ""}${pushList(c, d, zones)}
    </div>`;
}

/** Mockup 10: the library beside the builder and Push now, or above them where there is no room. */
export const contentPage = (
  c: ViewContext,
  content: ContentData,
  d: PlaylistsData,
  zones: readonly ZoneSummary[],
): Html =>
  html`<div class="canccu-studio-content">
    <div class="canccu-studio-content__grid">
      <div class="canccu-studio-content__main">${contentView(c, content, d.chosen?.id ?? "")}</div>
      <aside class="canccu-studio-content__side">
        ${playlistsView(c, d, zones, content.query)}
      </aside>
    </div>
  </div>`;
