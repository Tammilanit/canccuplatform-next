/** On air, the emergency and the spotlight form (mockups 03, 04, 07): server-drawn, phone-first, `packages/ui` classes. */
import type { Html } from "@canccu/ui";
import { html, notice } from "@canccu/ui";
import type { Class } from "./arbiter.js";
import type { ScreenImage } from "./cues/screen.js";
import { PREFIX, formKey } from "./page-kit.js";
import type { ZoneName } from "./page-kit.js";

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
  /** Orders the list only: the crew never sees it (the PO: rank numbers mean nothing; #638). */
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

/** A zone card lists this many moments, then "+n more" (amendment 3: no card far taller than its row). */
export const ZONE_ROWS = 4;

/**
 * On air (docs/design/grids/02-on-air.svg, amendment 3): the crew actions as one band above the
 * zones, the zones in one auto-fill grid in Screen's order, then Storyboards and Scenes in a band
 * of panels under them. The parts come in the phone's order, so no CSS `order` is needed.
 */
export function onAirView(o: {
  moments: MomentView[];
  zones: string[];
  zoneName: ZoneName;
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
  const cards = zones.map((zone) => {
    const here = o.moments.filter(
      (m) => (m.zones.length === 0 || m.zones.includes(zone)) && !m.left.includes(zone),
    );
    const count = (state: string) =>
      here.filter((m) => m.placements.some((p) => p.zone_key === zone && p.state === state)).length;
    // Hidden ones are under a full-screen moment, back when it ends: not waiting for a region.
    const placed = count("placed");
    const hidden = count("hidden");
    const summary = [
      [placed, "on air"],
      [hidden, "hidden"],
      [here.length - placed - hidden, "waiting"],
    ]
      .filter(([n]) => n !== 0)
      .map(([n, what]) => `${String(n)} ${String(what)}`)
      .join(" · ");
    const row = (m: MomentView) => momentRow(m, zone, o.now, o.canTake && !o.archived);
    const more = here.slice(ZONE_ROWS);
    return html`<li class="canccu-card moments-zone">
      <h2 class="canccu-card__title">${zone === "—" ? "No zones yet" : o.zoneName(zone)}</h2>
      ${summary === "" ? "" : html`<p class="canccu-small canccu-muted">${summary}</p>`}
      ${
        here.length === 0
          ? html`<p class="canccu-muted canccu-small">
              Nothing on air: the zone plays its rotation.
            </p>`
          : html`<ul class="moments-list">
              ${here.slice(0, ZONE_ROWS).map(row)}
            </ul>`
      }
      ${
        more.length === 0
          ? ""
          : html`<details class="moments-more">
              <summary class="canccu-small">+${String(more.length)} more</summary>
              <ul class="moments-list">
                ${more.map(row)}
              </ul>
            </details>`
      }
    </li>`;
  });
  const crew =
    o.archived || !(o.canTake || o.canAnnounce || o.canEmergency)
      ? ""
      : html`<section class="canccu-card moments-onair__crew">
          <h2 class="canccu-card__title">Crew actions</h2>
          <div class="moments-onair__buttons">
            ${o.canAnnounce ? html`<a class="canccu-button canccu-button--primary" href="${PREFIX}announce">Announce…</a>` : ""}
            ${o.canTake ? html`<a class="canccu-button canccu-button--secondary" href="${PREFIX}spotlight">Spotlight…</a>` : ""}
          </div>
          ${o.canEmergency ? emergencyBox(emergency) : ""}
        </section>`;
  return html`${flash}
    <div class="moments-onair">
      ${crew}
      <ul class="canccu-grid moments-onair__zones">
        ${cards}
      </ul>
      <div class="canccu-band moments-onair__panels">
        ${o.stories ?? ""}
        <section class="canccu-card moments-onair__scenes">
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
    <div class="moments-emergency__text">
      <p class="moments-emergency__title">Emergency</p>
      <p class="canccu-small">Every zone, full screen. Nothing outranks it.</p>
    </div>
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
  zoneName: ZoneName;
  sessions: { id: string; name: string }[];
  /** The event's images (Screen's), picked by thumbnail (mockup 04). */
  images: ScreenImage[];
  error?: string | undefined;
}): Html {
  const zoneChecks = html`<span class="canccu-chips"
    >${o.zones.map(
      (z) =>
        html`<label class="canccu-chip"
          ><input type="checkbox" name="zone" value="${z}" />${o.zoneName(z)}</label
        >`,
    )}</span
  >`;
  const photos =
    o.images.length === 0
      ? html`<p class="canccu-small canccu-muted">
          No images yet: add them in Screen studio → Content.
        </p>`
      : html`<div class="canccu-grid canccu-grid--tile moments-photos">
          ${o.images.map(
            (i) =>
              html`<label class="moments-photo"
                ><input type="radio" name="photo_asset" value="${i.id}" /><img
                  src="${PREFIX}spotlight/images/${i.id}"
                  alt="${i.title}"
                  loading="lazy"
                /><span class="moments-photo__title">${i.title}</span></label
              >`,
          )}
        </div>`;
  const option = (v: string, label: string) => html`<option value="${v}">${label}</option>`;
  return html`${o.error ? notice({ kind: "down", title: "Not started", text: o.error }) : ""}
    <form class="canccu-form moments-form" method="post" action="${PREFIX}spotlight">
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
      <fieldset class="moments-fieldset">
        <legend class="canccu-field__label">Photo</legend>
        ${photos}
      </fieldset>
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
      <div class="canccu-field canccu-field--check">
        <input class="canccu-check" id="hub_qr" type="checkbox" name="hub_qr" value="yes" />
        <label class="canccu-field__label" for="hub_qr">Show the QR to the phone hub</label>
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
