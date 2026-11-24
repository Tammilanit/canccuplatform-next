/** On air's list of a zone's queue (#777, rule 7; amendment 3's forms: a list, not boxes). */
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { ZoneQueue } from "./queue-data.js";
import { CLASS_NAMES, actionForm } from "./views.js";

/** A zone's queue (#777, rule 7): what waits in order, for how long, and what went stale. */
export function queueView(
  q: ZoneQueue | undefined,
  zone: string,
  now: Date,
  canAct: boolean,
): Html {
  const waiting = q?.waiting ?? [];
  const stale = q?.stale ?? [];
  const since = (t: string) => {
    const s = Math.max(0, Math.round((now.getTime() - Date.parse(t)) / 1000));
    return `waiting ${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
  };
  const row = (w: ZoneQueue["waiting"][number]) =>
    html`<li class="canccu-list__item moments-queue__item">
      <span class="moments-queue__what"
        >${w.title}
        <span class="canccu-small canccu-muted"
          >${CLASS_NAMES[w.class]} · ${since(w.since)}${w.in_rail ? " · In the rail" : ""}</span
        ></span
      >
      ${canAct ? html`<span class="canccu-cluster moments-actions">${actionForm("forward", w.moment_id, zone, "Move forward")} ${actionForm("end", w.moment_id, zone, "Skip")}</span>` : ""}
    </li>`;
  return html`<h3 class="canccu-small moments-queue__title">Waiting</h3>
    ${
      waiting.length === 0
        ? html`<p class="canccu-small canccu-muted">Nothing waiting.</p>`
        : html`<ol class="canccu-list moments-queue">
            ${waiting.map(row)}
          </ol>`
    }
    ${
      stale.length === 0
        ? ""
        : html`<details class="moments-more">
            <summary class="canccu-small">Went stale (${String(stale.length)})</summary>
            <ul class="canccu-list">
              ${stale.map((x) => html`<li class="canccu-list__item canccu-small">${x.title} · ${CLASS_NAMES[x.class]}</li>`)}
            </ul>
          </details>`
    }`;
}
