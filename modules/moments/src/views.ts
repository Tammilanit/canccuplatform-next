/** The Moments pages' views (mockups 03, 04, 07, 08, 09): server-drawn, phone-first, `packages/ui` classes. */
import type { Html } from "@canccu/ui";
import { emptyState, html, notice } from "@canccu/ui";
import { CLASSES, rankOf } from "./arbiter.js";
import type { Class } from "./arbiter.js";
import type { HistoryFilter, HistoryRow } from "./history.js";
import { PREFIX, formKey } from "./page-kit.js";
import type { RuleView } from "./rules.js";

export const CLASS_NAMES: Record<Class, string> = {
  emergency: "Emergency",
  stream: "Stream (Cast track, later)",
  announcement: "Announcement",
  spotlight: "Crew spotlight",
  storyboard: "Storyboard",
  tournament: "Tournament",
  finals: "Finals",
  hot_game: "Hot game",
  reactions: "Reactions",
  ticker: "Ticker",
};

export interface Placement {
  zone_key: string;
  state: string;
  role: string | null;
}
export interface MomentView {
  id: string;
  class: Class;
  rank: number;
  template: string;
  title: string;
  origin: string;
  who: string;
  zones: string[];
  left: string[];
  expires_at: string | null;
  starts_at: string;
  patience_seconds: number;
  placements: Placement[];
}

function left(expires: string | null, now: Date): string {
  if (expires === null) return "until cleared";
  const s = Math.max(0, Math.round((Date.parse(expires) - now.getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec} left` : `${m}:${sec} left`;
}

const STATES: Record<string, string> = { hidden: "Hidden", unplaced: "Queued" };

function momentRow(m: MomentView, zone: string, now: Date, canAct: boolean): Html {
  const p = m.placements.find((x) => x.zone_key === zone);
  const state = p === undefined ? "starting" : p.state;
  const waits =
    state === "unplaced"
      ? `no region of its chain is free; waits up to ${Math.round(m.patience_seconds / 60)} min, then drops`
      : state === "hidden"
        ? "under a full-screen moment; back when it ends"
        : state === "starting"
          ? "on its way to the screens"
          : "";
  const actions =
    canAct && m.class !== "emergency"
      ? html`<div class="canccu-cluster moments-actions">
          ${m.expires_at === null ? "" : actionForm("extend", m.id, zone, "Extend +5")}
          ${actionForm("end", m.id, zone, "End in zone")}
        </div>`
      : "";
  return html`<li class="moments-item moments-item--${state}">
    <div class="moments-item__head">
      <span class="canccu-badge${state === "placed" ? " canccu-badge--primary" : ""}"
        >${p?.role ?? STATES[state] ?? "—"}</span
      >
      <span class="canccu-small canccu-muted">rank ${m.rank}</span>
      ${STATES[state] === undefined ? "" : html`<span class="canccu-badge canccu-badge--late">${STATES[state]}</span>`}
    </div>
    <p class="moments-item__title">${m.title}</p>
    <p class="canccu-small canccu-muted">
      ${CLASS_NAMES[m.class]} · ${m.who} · ${left(m.expires_at, now)}
    </p>
    ${waits === "" ? "" : html`<p class="canccu-small">${waits}</p>`} ${actions}
  </li>`;
}

function actionForm(action: "end" | "extend", id: string, zone: string, label: string): Html {
  return html`<form method="post" action="${PREFIX}on-air/${action}">
    ${formKey()}<input type="hidden" name="moment_id" value="${id}" /><input
      type="hidden"
      name="zone_key"
      value="${zone}"
    />
    <button
      class="canccu-button canccu-button--${action === "end" ? "danger-ghost" : "secondary"} canccu-button--sm"
      type="submit"
    >
      ${label}
    </button>
  </form>`;
}

export function onAirView(o: {
  moments: MomentView[];
  zones: string[];
  now: Date;
  canTake: boolean;
  canEmergency: boolean;
  archived: boolean;
  done?: string | undefined;
  error?: string | undefined;
}): Html {
  const emergency = o.moments.find((m) => m.class === "emergency");
  const flash = o.error
    ? notice({ kind: "down", title: "Not done", text: o.error })
    : o.done
      ? notice({ kind: "ok", title: o.done })
      : "";
  const zones = o.zones.length === 0 ? ["—"] : o.zones;
  const columns = zones.map((zone) => {
    const here = o.moments.filter(
      (m) => (m.zones.length === 0 || m.zones.includes(zone)) && !m.left.includes(zone),
    );
    return html`<section class="canccu-card moments-zone">
      <h2 class="canccu-card__title">${zone === "—" ? "No zones yet" : zone}</h2>
      ${
        here.length === 0
          ? html`<p class="canccu-muted canccu-small">
              Nothing on air: the zone plays its rotation.
            </p>`
          : html`<ul class="moments-list">
              ${here.map((m) => momentRow(m, zone, o.now, o.canTake && !o.archived))}
            </ul>`
      }
    </section>`;
  });
  const crew =
    o.archived || !(o.canTake || o.canEmergency)
      ? ""
      : html`<section class="canccu-card moments-crew">
          <h2 class="canccu-card__title">Crew actions</h2>
          <div class="moments-crew__buttons">
            ${o.canTake ? html`<a class="canccu-button canccu-button--secondary canccu-button--block" href="${PREFIX}spotlight">Spotlight…</a>` : ""}
          </div>
          ${o.canEmergency ? emergencyBox(emergency) : ""}
        </section>`;
  return html`${flash}
    <div class="moments-onair">
      <div class="moments-zones">${columns}</div>
      ${crew}
    </div>`;
}

function emergencyBox(running: MomentView | undefined): Html {
  if (running !== undefined) {
    return html`<form
      class="moments-emergency moments-emergency--on"
      method="post"
      action="${PREFIX}emergency/end"
    >
      ${formKey()}
      <p class="moments-emergency__title">Emergency on air</p>
      <p class="canccu-small">${running.title}</p>
      <div class="canccu-field canccu-field--check">
        <input
          class="canccu-check"
          type="checkbox"
          id="all-clear"
          name="all_clear"
          value="true"
          checked
        />
        <label class="canccu-field__label" for="all-clear">Show "All clear" for 60 s</label>
      </div>
      <button
        class="canccu-button canccu-button--danger canccu-button--block canccu-button--lg"
        type="submit"
      >
        End emergency
      </button>
    </form>`;
  }
  return html`<form
    class="moments-emergency"
    method="post"
    action="${PREFIX}emergency"
    data-hold-to-start
  >
    ${formKey()}
    <p class="moments-emergency__title">Emergency</p>
    <p class="canccu-small">Every zone, full screen. Nothing outranks it.</p>
    <button
      class="canccu-button canccu-button--danger canccu-button--block canccu-button--lg moments-hold"
      type="submit"
      data-hold-ms="2000"
    >
      <span class="moments-hold__fill" aria-hidden="true"></span><span>Press and hold 2 s</span>
    </button>
  </form>`;
}

/** Without the page script there is no hold: the emergency asks once more instead. */
export function confirmEmergency(key: string): Html {
  return html`<form class="moments-emergency" method="post" action="${PREFIX}emergency">
    <input type="hidden" name="idempotency_key" value="${key}" /><input
      type="hidden"
      name="held"
      value="yes"
    />
    <p class="moments-emergency__title">
      Every zone goes full screen, with the alarm. Nothing outranks it.
    </p>
    <div class="canccu-cluster">
      <button class="canccu-button canccu-button--danger canccu-button--lg" type="submit">
        Start the emergency</button
      ><a class="canccu-button canccu-button--ghost" href="${PREFIX}on-air">Cancel</a>
    </div>
  </form>`;
}

export function spotlightView(o: {
  zones: string[];
  sessions: { id: string; name: string }[];
}): Html {
  const zoneChecks = o.zones.map(
    (z) =>
      html`<div class="canccu-field canccu-field--check">
        <input class="canccu-check" type="checkbox" id="zone-${z}" name="zone" value="${z}" />
        <label class="canccu-field__label" for="zone-${z}">${z}</label>
      </div>`,
  );
  const option = (v: string, label: string) => html`<option value="${v}">${label}</option>`;
  return html`<form class="canccu-form moments-form" method="post" action="${PREFIX}spotlight">
    ${formKey()}
    <div class="canccu-field">
      <label class="canccu-field__label" for="show">What it shows</label>
      <select class="canccu-input" id="show" name="show">
        ${option("message", "A message")}${option("standings", "The standings")}${option("bracket", "A bracket")}${option("photo", "A photo")}
      </select>
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="title">Message</label
      ><input class="canccu-input" id="title" name="title" maxlength="80" />
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="body">More (optional)</label
      ><input class="canccu-input" id="body" name="body" maxlength="280" />
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="session_id">Bracket of</label>
      <select class="canccu-input" id="session_id" name="session_id">
        ${o.sessions.length === 0 ? option("", "No sessions yet") : o.sessions.map((s) => option(s.id, s.name))}
      </select>
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="photo_url"
        >Photo (a path on this event, such as /screen/files/…)</label
      ><input class="canccu-input" id="photo_url" name="photo_url" />
    </div>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">Zones (none ticked: every zone)</legend>
      ${zoneChecks}
    </fieldset>
    <div class="canccu-field">
      <label class="canccu-field__label" for="duration">For</label>
      <select class="canccu-input" id="duration" name="duration_seconds">
        ${option("300", "5 min")}${option("600", "10 min")}${option("900", "15 min")}${option("1800", "30 min")}
      </select>
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="qr_path"
        >QR to (optional, a path such as /notify/)</label
      ><input class="canccu-input" id="qr_path" name="qr_path" />
    </div>
    <p class="canccu-small canccu-muted">
      The screens say "From the crew"; the history keeps your name.
    </p>
    <div class="canccu-cluster">
      <button class="canccu-button canccu-button--primary" type="submit">Start spotlight</button
      ><a class="canccu-button canccu-button--ghost" href="${PREFIX}on-air">Cancel</a>
    </div>
  </form>`;
}

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
      What fires by itself when the tournament, pizza and games modules report. Cues sound once the
      sound desk lands.
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
