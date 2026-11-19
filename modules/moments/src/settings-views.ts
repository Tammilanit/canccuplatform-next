/** Priorities with the built-in rules (mockup 08) and History (mockup 09): server-drawn, `packages/ui` classes. */
import type { Html } from "@canccu/ui";
import { emptyState, html, notice } from "@canccu/ui";

import type { Class } from "./arbiter.js";
import type { HistoryFilter, HistoryRow } from "./history.js";
import { PREFIX } from "./page-kit.js";
import type { ZoneName } from "./page-kit.js";
import type { RuleView } from "./rules.js";
import { rulesView } from "./rules-view.js";
import { CLASS_NAMES } from "./views.js";

export function prioritiesView(o: {
  scope: string;
  order: readonly Class[];
  draft: boolean;
  zones: string[];
  zoneName: ZoneName;
  own: string[];
  revision: number;
  /** `auto`: the script draws it at once (a moved order's Preview reloads with the draft). */
  preview: { zone: string; ranks: Record<string, number>; auto: boolean } | null;
  rules: RuleView[];
  cues: string[];
  canWrite: boolean;
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const flash = o.error
    ? notice({ kind: "down", title: "Not saved", text: o.error })
    : o.done
      ? notice({ kind: "ok", title: o.done })
      : o.draft
        ? notice({
            kind: "warn",
            title: "Not saved yet",
            text: "Save the order to rank what is live by it.",
          })
        : "";
  const href = (order: readonly Class[]) =>
    `${PREFIX}priorities?scope=${encodeURIComponent(o.scope)}&order=${order.join(",")}`;
  const moved = (i: number, by: number): Class[] => {
    const next = [...o.order];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c as Class);
    return next;
  };
  const name = (c: Class) => CLASS_NAMES[c];
  // Only the order counts, so no rank numbers (the PO's note on O5). Emergency has no handle.
  const rows = o.order.map((c, i) => {
    const locked = c === "emergency";
    const movable = !locked && o.canWrite;
    const arrow = (by: number, label: string, glyph: string) =>
      html`<a
        class="canccu-button canccu-button--ghost canccu-button--sm"
        href="${href(moved(i, by))}"
        aria-label="Move ${name(c)} ${label}"
        >${glyph}</a
      >`;
    // Without the script the arrows still move a class, as a draft in the address.
    const arrows = movable
      ? html`<noscript
          ><span class="canccu-cluster"
            >${i > 1 ? arrow(-1, "up", "▲") : ""}${i < o.order.length - 1 ? arrow(1, "down", "▼") : ""}</span
          ></noscript
        >`
      : "";
    return html`<li
      class="moments-order__row${locked ? " moments-order__row--locked" : ""}"
      data-class="${c}"
    >
      ${movable ? html`<button class="moments-order__handle" type="button" data-order-handle aria-label="Move ${name(c)}" aria-describedby="order-help">⋮⋮</button>` : html`<span class="moments-order__handle" aria-hidden="true"></span>`}<span
        class="moments-order__name"
        >${name(c)}${locked ? html` <span class="canccu-small canccu-muted">locked at the top</span>` : ""}</span
      >${arrows}
    </li>`;
  });
  const scopes = [
    ["", "Event order"],
    ...o.zones.map((z) => [
      z,
      `${o.zoneName(z)} · ${o.own.includes(z) ? "own order" : "event order"}`,
    ]),
  ];
  const save = o.canWrite
    ? html`<form method="post" action="${PREFIX}priorities" class="canccu-cluster">
          <input type="hidden" name="scope" value="${o.scope}" /><input
            type="hidden"
            name="order"
            data-order-input
            value="${o.order.join(",")}"
          /><input type="hidden" name="revision" value="${o.revision}" />
          <button class="canccu-button canccu-button--primary" type="submit" name="do" value="save">
            Save order
          </button>
          ${o.scope === "" ? html`<button class="canccu-button canccu-button--ghost" type="submit" name="do" value="reset">Reset to default</button>` : o.own.includes(o.scope) ? html`<button class="canccu-button canccu-button--ghost" type="submit" name="do" value="follow">Follow the event order</button>` : ""}
        </form>
        <p class="canccu-small" data-order-unsaved hidden>
          Not saved yet: save the order to rank what is live by it.
        </p>
        <p class="canccu-small canccu-muted">
          Takes effect at once, also on what is live; nothing ends. Audited.
        </p>`
    : "";
  const preview =
    o.preview === null
      ? ""
      : html`<section class="canccu-card moments-preview">
          <h2 class="canccu-card__title">Preview: what ${o.zoneName(o.preview.zone)} would show</h2>
          <p class="canccu-small canccu-muted">
            With what is live now, ranked by the order on this page.
          </p>
          <div class="moments-preview__frame">
            <iframe
              src="/screen/zones/${encodeURIComponent(o.preview.zone)}"
              title="Preview of ${o.zoneName(o.preview.zone)}"
              data-preview
              data-zone="${o.preview.zone}"
              data-ranks="${JSON.stringify(o.preview.ranks)}"
              ${o.preview.auto ? " data-preview-auto" : ""}
            ></iframe>
          </div>
          <button class="canccu-button canccu-button--secondary" type="button" data-preview-run>
            Preview
          </button>
          <p class="canccu-small" data-preview-note hidden></p>
        </section>`;
  return html`${flash}
    <div class="moments-priorities">
      <section class="canccu-card">
        <h2 class="canccu-card__title">Order: higher wins</h2>
        <nav class="moments-scopes" aria-label="Where the order applies">
          ${scopes.map(([v, label]) => html`<a class="canccu-badge${v === o.scope ? " canccu-badge--primary" : " canccu-badge--plain"}" href="${PREFIX}priorities?scope=${encodeURIComponent(v ?? "")}">${label}</a>`)}
        </nav>
        ${o.canWrite ? html`<p class="canccu-small canccu-muted" id="order-help">Drag a class by its handle, or focus it and use the arrow keys. Emergency stays at the top.</p>` : ""}
        <ol class="moments-order" data-order>
          ${rows}
        </ol>
        <p class="moments-said" aria-live="polite" data-order-said></p>
        ${save}
      </section>
      ${preview}
    </div>
    ${rulesView(o.rules, {
      zones: o.zones,
      zoneName: o.zoneName,
      cues: o.cues,
      canWrite: o.canWrite,
    })}`;
}

const ORIGINS = ["rule", "crew", "emergency", "module"];
const ACTIONS = ["started", "refused", "placed", "hidden", "queued", "back", "changed", "ended"];
const REGIONS = ["full", "hero", "rail", "venue_rail", "ticker", "overlay"];

export function historyView(o: {
  rows: HistoryRow[];
  zones: string[];
  zoneName: ZoneName;
  filter: HistoryFilter;
  timeZone: string;
  more: number | null;
}): Html {
  const query = new URLSearchParams(
    Object.entries(o.filter).filter(([, v]) => v !== undefined) as [string, string][],
  ).toString();
  const select = (
    name: keyof HistoryFilter,
    label: string,
    values: string[],
    words: (v: string) => string = (v) => v,
  ) =>
    html`<div class="canccu-field">
      <label class="canccu-field__label" for="f-${name}">${label}</label
      ><select class="canccu-input" id="f-${name}" name="${name}">
        <option value="">All</option>
        ${values.map((v) => html`<option value="${v}" ${o.filter[name] === v ? " selected" : ""}>${words(v)}</option>`)}
      </select>
    </div>`;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      timeZone: o.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const table =
    o.rows.length === 0
      ? emptyState({
          icon: "clock",
          title: "Nothing yet",
          text: "Every moment's start, place, wait and end is written here.",
        })
      : html`<div class="moments-table">
          <table class="canccu-table moments-history">
            <thead>
              <tr>
                <th>Time</th>
                <th>Zone</th>
                <th>Moment</th>
                <th>Region</th>
                <th>Why</th>
                <th>Displaced</th>
                <th>Ended or outcome</th>
              </tr>
            </thead>
            <tbody>
              ${o.rows.map(
                (r) =>
                  html`<tr>
                    <td class="canccu-num" data-label="Time">${time(r.at)}</td>
                    <td data-label="Zone">
                      ${r.zone_key === null ? "all" : o.zoneName(r.zone_key)}
                    </td>
                    <td data-label="Moment">
                      <b>${r.title}</b><br /><span class="canccu-small canccu-muted"
                        >${r.action}</span
                      >
                    </td>
                    <td data-label="Region">${r.region ?? "—"}</td>
                    <td data-label="Why">${r.why}</td>
                    <td data-label="Displaced">${r.displaced ?? "—"}</td>
                    <td data-label="Ended or outcome">${r.outcome ?? "—"}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`;
  return html`<form class="moments-filters" method="get" action="${PREFIX}history">
      ${select("zone", "Zone", o.zones, o.zoneName)}${select("region", "Region", REGIONS)}${select("origin", "Source", ORIGINS)}${select("action", "Outcome", ACTIONS)}
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--secondary" type="submit">Filter</button
        ><a
          class="canccu-button canccu-button--ghost"
          href="/api/moments/history.csv${query === "" ? "" : `?${query}`}"
          >Export CSV</a
        >
      </div>
    </form>
    ${table}
    ${o.more === null ? "" : html`<p><a class="canccu-button canccu-button--ghost" href="${PREFIX}history?${query}${query === "" ? "" : "&"}before=${o.more}">Older</a></p>`}`;
}
