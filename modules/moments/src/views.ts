/** On air, the emergency and the spotlight form (mockups 03, 04, 07): server-drawn, phone-first, `packages/ui` classes. */
import type { Html } from "@canccu/ui";
import { html, notice } from "@canccu/ui";
import type { Class } from "./arbiter.js";
import { PREFIX, formKey } from "./page-kit.js";

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

const STATES: Record<string, string> = {
  hidden: "Hidden",
  unplaced: "Queued",
  starting: "Starting",
};

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
      ${
        p?.role
          ? html`<span class="canccu-badge${state === "placed" ? " canccu-badge--primary" : ""}"
              >${p.role}</span
            >`
          : ""
      }
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
  canAnnounce: boolean;
  canEmergency: boolean;
  archived: boolean;
  /** Each zone's scene and the crew buttons (scene-views.ts), drawn by the caller. */
  scenes: Html;
  /** The storyboards' fire, Stop loop and Skip to finale (story/views.ts), drawn by the caller. */
  stories?: Html;
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
    o.archived || !(o.canTake || o.canAnnounce || o.canEmergency)
      ? ""
      : html`<section class="canccu-card moments-crew">
          <h2 class="canccu-card__title">Crew actions</h2>
          <div class="moments-crew__buttons">
            ${o.canAnnounce ? html`<a class="canccu-button canccu-button--primary canccu-button--block" href="${PREFIX}announce">Announce…</a>` : ""}
            ${o.canTake ? html`<a class="canccu-button canccu-button--secondary canccu-button--block" href="${PREFIX}spotlight">Spotlight…</a>` : ""}
          </div>
          ${o.canEmergency ? emergencyBox(emergency) : ""}
        </section>`;
  return html`${flash}
    <div class="moments-onair">
      <div class="moments-zones">${columns}</div>
      <div class="moments-side">
        ${crew} ${o.stories ?? ""}
        <section class="canccu-card moments-crew">
          <h2 class="canccu-card__title">Scenes</h2>
          ${o.scenes}
        </section>
      </div>
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
