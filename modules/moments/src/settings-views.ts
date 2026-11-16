/** Priorities with the built-in rules (mockup 08) and History (mockup 09): server-drawn, `packages/ui` classes. */
import type { Html } from "@canccu/ui";
import { emptyState, html, notice } from "@canccu/ui";
import { CLASSES, rankOf } from "./arbiter.js";
import type { Class } from "./arbiter.js";
import type { HistoryFilter, HistoryRow } from "./history.js";
import { PREFIX } from "./page-kit.js";
import type { RuleView } from "./rules.js";
import { CLASS_NAMES } from "./views.js";

export function prioritiesView(o: {
  scope: string;
  order: readonly Class[];
  draft: boolean;
  zones: string[];
  own: string[];
  revision: number;
  preview: { zone: string; ranks: Record<string, number> } | null;
  rules: RuleView[];
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
  const rows = o.order.map((c, i) => {
    const locked = c === "emergency";
    const up =
      !locked && i > 1 && o.canWrite
        ? html`<a
            class="canccu-button canccu-button--ghost canccu-button--sm"
            href="${href(moved(i, -1))}"
            aria-label="Move ${CLASS_NAMES[c]} up"
            >▲</a
          >`
        : "";
    const down =
      !locked && i < o.order.length - 1 && o.canWrite
        ? html`<a
            class="canccu-button canccu-button--ghost canccu-button--sm"
            href="${href(moved(i, 1))}"
            aria-label="Move ${CLASS_NAMES[c]} down"
            >▼</a
          >`
        : "";
    return html`<li class="moments-order__row">
      <span class="moments-order__name"
        >${CLASS_NAMES[c]}${locked ? html` <span class="canccu-small canccu-muted">locked at the top</span>` : ""}</span
      ><span class="canccu-num">${rankOf(o.order, c)}</span
      ><span class="canccu-cluster">${up}${down}</span>
    </li>`;
  });
  const scopes = [
    ["", "Event order"],
    ...o.zones.map((z) => [z, o.own.includes(z) ? `${z} · own order` : `${z} · event order`]),
  ];
  const save = o.canWrite
    ? html`<form method="post" action="${PREFIX}priorities" class="canccu-cluster">
          <input type="hidden" name="scope" value="${o.scope}" /><input
            type="hidden"
            name="order"
            value="${o.order.join(",")}"
          /><input type="hidden" name="revision" value="${o.revision}" />
          <button class="canccu-button canccu-button--primary" type="submit" name="do" value="save">
            Save order
          </button>
          ${o.scope === "" ? html`<button class="canccu-button canccu-button--ghost" type="submit" name="do" value="reset">Reset to default</button>` : o.own.includes(o.scope) ? html`<button class="canccu-button canccu-button--ghost" type="submit" name="do" value="follow">Follow the event order</button>` : ""}
        </form>
        <p class="canccu-small canccu-muted">
          Takes effect at once, also on what is live; nothing ends. Audited.
        </p>`
    : "";
  const preview =
    o.preview === null
      ? ""
      : html`<section class="canccu-card moments-preview">
          <h2 class="canccu-card__title">Preview: what ${o.preview.zone} would show</h2>
          <p class="canccu-small canccu-muted">
            With what is live now, ranked by the order on this page.
          </p>
          <div class="moments-preview__frame">
            <iframe
              src="/screen/zones/${encodeURIComponent(o.preview.zone)}"
              title="Preview of ${o.preview.zone}"
              data-preview
              data-zone="${o.preview.zone}"
              data-ranks="${JSON.stringify(o.preview.ranks)}"
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
        <ol class="moments-order">
          ${rows}
        </ol>
        ${save}
      </section>
      ${preview}
    </div>
    ${rulesView(o.rules, o.canWrite)}`;
}

function rulesView(rules: RuleView[], canWrite: boolean): Html {
  const rows = rules.map((r) => {
    const classes = CLASSES.filter((c) => c !== "emergency").map(
      (c) =>
        html`<option value="${c}" ${c === r.class ? " selected" : ""}>${CLASS_NAMES[c]}</option>`,
    );
    return html`<form class="moments-rule" method="post" action="${PREFIX}rules/${r.rule_id}">
      <input type="hidden" name="revision" value="${r.revision}" /><input
        type="hidden"
        name="template"
        value="${r.template}"
      />
      <div class="canccu-field canccu-field--check">
        <input
          class="canccu-check"
          type="checkbox"
          id="on-${r.rule_id}"
          name="enabled"
          value="true"
          ${r.enabled ? " checked" : ""}${canWrite ? "" : " disabled"}
        />
        <label class="canccu-field__label" for="on-${r.rule_id}"
          >${r.rule_id.replaceAll("_", " ")}</label
        >
      </div>
      <p class="canccu-small canccu-muted">On ${r.on.join(", ")}</p>
      <label class="canccu-small"
        >As
        <select class="canccu-input" name="class" ${canWrite ? "" : " disabled"}>
          ${classes}
        </select></label
      >
      <label class="canccu-small"
        >Regions
        <input
          class="canccu-input"
          name="regions"
          value="${r.regions.join(", ")}"
          ${canWrite ? "" : " disabled"}
      /></label>
      <label class="canccu-small"
        >Seconds
        <input
          class="canccu-input"
          type="number"
          min="1"
          max="7200"
          name="ttl_seconds"
          value="${r.ttl_seconds}"
          ${canWrite ? "" : " disabled"}
      /></label>
      <label class="canccu-small"
        >Zones
        <input
          class="canccu-input"
          name="zones"
          value="${r.zones.join(", ")}"
          placeholder="every zone"
          ${canWrite ? "" : " disabled"}
      /></label>
      <label class="canccu-small"
        >Cue
        <input
          class="canccu-input"
          name="cue"
          value="${r.cue ?? ""}"
          ${canWrite ? "" : " disabled"}
      /></label>
      ${canWrite ? html`<button class="canccu-button canccu-button--secondary canccu-button--sm" type="submit">Save</button>` : ""}
    </form>`;
  });
  return html`<section class="canccu-card moments-rules">
    <h2 class="canccu-card__title">Built-in rules</h2>
    <p class="canccu-small canccu-muted">
      What fires by itself when the tournament, pizza and games modules report. Each rule's cue is
      set up on the Cues tab: its picture and its sound.
    </p>
    ${rows}
  </section>`;
}

const ORIGINS = ["rule", "crew", "emergency", "module"];
const ACTIONS = ["started", "refused", "placed", "hidden", "queued", "back", "changed", "ended"];
const REGIONS = ["full", "hero", "rail", "venue_rail", "ticker", "overlay"];

export function historyView(o: {
  rows: HistoryRow[];
  zones: string[];
  filter: HistoryFilter;
  timeZone: string;
  more: number | null;
}): Html {
  const query = new URLSearchParams(
    Object.entries(o.filter).filter(([, v]) => v !== undefined) as [string, string][],
  ).toString();
  const select = (name: keyof HistoryFilter, label: string, values: string[]) =>
    html`<div class="canccu-field">
      <label class="canccu-field__label" for="f-${name}">${label}</label
      ><select class="canccu-input" id="f-${name}" name="${name}">
        <option value="">All</option>
        ${values.map((v) => html`<option value="${v}" ${o.filter[name] === v ? " selected" : ""}>${v}</option>`)}
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
          <table class="canccu-table">
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
                    <td class="canccu-num">${time(r.at)}</td>
                    <td>${r.zone_key ?? "all"}</td>
                    <td>
                      <b>${r.title}</b><br /><span class="canccu-small canccu-muted"
                        >${r.action}</span
                      >
                    </td>
                    <td>${r.region ?? "—"}</td>
                    <td>${r.why}</td>
                    <td>${r.displaced ?? "—"}</td>
                    <td>${r.outcome ?? "—"}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`;
  return html`<form class="moments-filters" method="get" action="${PREFIX}history">
      ${select("zone", "Zone", o.zones)}${select("region", "Region", REGIONS)}${select("origin", "Source", ORIGINS)}${select("action", "Outcome", ACTIONS)}
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
