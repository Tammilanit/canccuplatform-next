/**
 * Studio → Cues, the sound desk (mockup 12; contracts/moments.md, Pages): each zone's budget and
 * what it lets through now, the master, the categories, the cues, the library and the log. Every
 * form posts to the page routes (cues/pages.ts), which send it on to the API.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { CATEGORIES } from "./catalog.js";
import type { Category, Cue, SoundSettings } from "./catalog.js";
import { logView } from "./log-view.js";
import type { LogRow } from "./store.js";

export interface DeskZone {
  zone_key: string;
  minute: number;
  hour: number;
  energy: string | null;
  lets_through: Category[] | null;
  sound_screen: { name: string; online: boolean; audio_unlocked: boolean | null } | null;
}
export interface LibraryView {
  id: string;
  title: string;
  url: string;
  length_ms: number;
  source: "pack" | "upload";
  used_by: string[];
  warning: string | null;
}

export const words = (c: string): string => c.replaceAll("_", " ");
const secs = (s: number): string =>
  s === 0 ? "—" : s % 60 === 0 ? `${String(s / 60)} min` : `${String(s)} s`;
const disabled = (on: boolean): string => (on ? "" : " disabled");
export const notice = (done?: string, error?: string): Html =>
  html`${done ? html`<p class="canccu-notice canccu-notice--success" role="status">${done}</p>` : ""}${error ? html`<p class="canccu-notice canccu-notice--danger" role="alert">${error}</p>` : ""}`;

function screenOf(z: DeskZone): Html {
  const s = z.sound_screen;
  if (s === null) return html`<span class="canccu-muted">no sound screen</span>`;
  const flag = !s.online
    ? html` <span class="canccu-badge canccu-badge--danger">offline</span>`
    : s.audio_unlocked === false
      ? html` <span class="canccu-badge canccu-badge--warning">audio locked</span>`
      : "";
  return html`${s.name}${flag}`;
}

function letsThrough(z: DeskZone): string {
  if (z.lets_through === null) return "unknown: Screen did not answer";
  if (z.lets_through.length === CATEGORIES.length) return "every category";
  if (z.lets_through.length === 1) return "urgent only";
  return z.lets_through.map(words).join(", ");
}

export function deskView(o: {
  settings: SoundSettings & { revision: number };
  zones: DeskZone[];
  cues: (Cue & { revision: number })[];
  library: LibraryView[];
  log: (LogRow & { seq: number })[];
  timeZone: string;
  now: Date;
  canTake: boolean;
  canWrite: boolean;
  done?: string;
  error?: string;
}): Html {
  const s = o.settings;
  const muted = s.muted_until !== null && Date.parse(s.muted_until) > o.now.getTime();
  const time = (d: Date | string) =>
    new Date(d).toLocaleTimeString("en-GB", { timeZone: o.timeZone });
  const title = (id: string) => o.library.find((l) => l.id === id)?.title ?? id;
  const budget = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Budget per zone</h2>
    <p class="canccu-small canccu-muted">
      At most ${s.per_minute} sounds a minute and ${s.hourly_budget} an hour per zone; one at a
      time.
    </p>
    <table class="canccu-table">
      <thead>
        <tr>
          <th>Zone</th>
          <th>This hour</th>
          <th>This minute</th>
          <th>Lets through now</th>
          <th>Sound screen</th>
        </tr>
      </thead>
      <tbody>
        ${o.zones.map(
          (z) =>
            html`<tr>
              <td>${z.zone_key}</td>
              <td class="canccu-num">${z.hour} / ${s.hourly_budget}</td>
              <td class="canccu-num">${z.minute} / ${s.per_minute}</td>
              <td>
                ${z.energy === "quiet" ? "quiet scene" : (z.energy ?? "—")}: ${letsThrough(z)}
              </td>
              <td>${screenOf(z)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <p class="canccu-small canccu-muted">
      Urgent always passes and still counts. Limits are event settings.
    </p>
  </section>`;
  const master = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Master</h2>
    <p>
      ${s.enabled ? `Sounds on · volume ${String(s.volume)} %` : "Sounds off"}${muted ? html` · <b>muted until ${time(s.muted_until as string)}</b>` : ""}
    </p>
    ${
      o.canTake
        ? html`<div class="canccu-cluster">
            <form method="post" action="${PREFIX}cues/mute">
              ${formKey()}<input type="hidden" name="minutes" value="${muted ? "0" : "15"}" />
              <button class="canccu-button canccu-button--secondary" type="submit">
                ${muted ? "Unmute" : "Mute all for 15 min"}
              </button>
            </form>
            <form class="canccu-cluster" method="post" action="${PREFIX}cues/check">
              ${formKey()}
              <select class="canccu-input" name="zone_key" aria-label="Zone">
                <option value="">Every zone</option>
                ${o.zones.map((z) => html`<option value="${z.zone_key}">${z.zone_key}</option>`)}
              </select>
              <button class="canccu-button canccu-button--secondary" type="submit">
                Sound check…
              </button>
            </form>
          </div>`
        : ""
    }
  </section>`;
  const settings = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Categories · the rule axis</h2>
    <p class="canccu-small canccu-muted">Six, fixed. Events add cues, never categories.</p>
    <form method="post" action="${PREFIX}cues/settings">
      <input type="hidden" name="revision" value="${s.revision}" />
      <div class="canccu-cluster">
        <label class="canccu-small"
          ><input
            type="checkbox"
            name="enabled"
            ${s.enabled ? "checked" : ""}${disabled(o.canWrite)}
          />
          Sounds on</label
        >
        <label class="canccu-small"
          >Volume %
          <input
            class="canccu-input"
            type="number"
            min="0"
            max="100"
            name="volume"
            value="${s.volume}"
            ${disabled(o.canWrite)}
        /></label>
        <label class="canccu-small"
          >Per hour
          <input
            class="canccu-input"
            type="number"
            min="0"
            max="1000"
            name="hourly_budget"
            value="${s.hourly_budget}"
            ${disabled(o.canWrite)}
        /></label>
        <label class="canccu-small"
          >Per minute
          <input
            class="canccu-input"
            type="number"
            min="1"
            max="60"
            name="per_minute"
            value="${s.per_minute}"
            ${disabled(o.canWrite)}
        /></label>
        <label class="canccu-small"
          >Seconds per source
          <input
            class="canccu-input"
            type="number"
            min="0"
            max="3600"
            name="per_source_seconds"
            value="${s.per_source_seconds}"
            ${disabled(o.canWrite)}
        /></label>
      </div>
      <table class="canccu-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Priority</th>
            <th>Level %</th>
            <th>Interrupts</th>
            <th>At calm</th>
            <th>On</th>
          </tr>
        </thead>
        <tbody>
          ${CATEGORIES.map(
            (c, i) =>
              html`<tr>
                <td>${words(c)}</td>
                <td class="canccu-num">${[70, 50, 40, 30, 20, 10][i]}</td>
                <td>
                  <input
                    class="canccu-input"
                    type="number"
                    min="0"
                    max="100"
                    name="${c}.level"
                    value="${s.categories[c].level}"
                    aria-label="${words(c)} level"
                    ${disabled(o.canWrite)}
                  />
                </td>
                <td>${c === "urgent" ? "yes" : "no, waits"}</td>
                <td>
                  ${c === "urgent" || c === "attention" || c === "result" ? "plays" : "silent"}
                </td>
                <td>
                  <input
                    type="checkbox"
                    name="${c}.enabled"
                    aria-label="${words(c)} on"
                    ${s.categories[c].enabled ? "checked" : ""}${disabled(o.canWrite)}
                  />
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${o.canWrite ? html`<button class="canccu-button canccu-button--primary" type="submit">Save</button>` : ""}
    </form>
  </section>`;
  const cues = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Cues · per event</h2>
    <p class="canccu-small canccu-muted">
      Seeded from the 25 legacy cues; the event adds its own. Several sounds are picked at random,
      never the same twice running. A cue's level multiplies its category's; the voice line plays
      right after the sound and counts once in the budget.
    </p>
    ${o.canWrite ? html`<p><a class="canccu-button canccu-button--secondary" href="${PREFIX}cues/new">+ Add a cue</a></p>` : ""}
    <div class="moments-table">
      <table class="canccu-table">
        <thead>
          <tr>
            <th>Cue</th>
            <th>Category</th>
            <th>Sounds</th>
            <th>Voice line</th>
            <th>Picture</th>
            <th>Level</th>
            <th>Not again for</th>
            <th>Catch-up</th>
            <th>On</th>
          </tr>
        </thead>
        <tbody>
          ${o.cues.map(
            (c) =>
              html`<tr>
                <td>
                  ${o.canWrite ? html`<a href="${PREFIX}cues/edit/${c.name}">${c.name}</a>` : c.name}${c.builtin ? "" : html` <span class="canccu-badge">event's own</span>`}
                </td>
                <td>${words(c.category)}</td>
                <td>
                  ${c.sounds.map(title).join(", ") || "—"}${c.sounds.length > 1 ? html`<br /><span class="canccu-small canccu-muted">${c.sounds.length} sounds</span>` : ""}
                </td>
                <td>${c.voice_line === null ? "—" : title(c.voice_line)}</td>
                <td>
                  ${c.effects.length === 0 ? "sound only" : html`${c.effects.map(words).join(", ")}<br /><span class="canccu-small canccu-muted">holds ${c.hold_seconds} s</span>`}
                </td>
                <td class="canccu-num">${c.level}</td>
                <td>${secs(c.cooldown_seconds)}</td>
                <td>
                  ${c.catch_up_before_start === null ? secs(c.catch_up_seconds) : `T−${String(c.catch_up_before_start[0])} to T−${String(c.catch_up_before_start[1])}`}
                </td>
                <td>${c.enabled ? "on" : "off"}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`;
  const library = html`<section class="canccu-card">
    <h2 class="canccu-card__title">Library</h2>
    <p class="canccu-small canccu-muted">
      Any sound can go to any cue. At most 30 s and 1 MiB each; a warning over 10 s. The default
      pack is CC0, with a credits file.
    </p>
    ${
      o.canWrite
        ? html`<form
            class="canccu-cluster"
            method="post"
            action="${PREFIX}cues/library"
            data-upload-sound
          >
            <input type="hidden" name="asset_id" value="" />
            <label class="canccu-small"
              >Upload MP3 or OGG
              <input
                class="canccu-input"
                type="file"
                name="file"
                accept="audio/mpeg,audio/ogg,.mp3,.ogg"
            /></label>
            <button class="canccu-button canccu-button--secondary" type="submit">Upload</button>
            <noscript
              ><span class="canccu-small canccu-muted"
                >Uploading needs the page's script.</span
              ></noscript
            >
          </form>`
        : ""
    }
    <table class="canccu-table">
      <thead>
        <tr>
          <th>Sound</th>
          <th>Length</th>
          <th>Source</th>
          <th>Used by</th>
          <th>Preview</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${o.library.map(
          (l) =>
            html`<tr>
              <td>
                ${l.title}${l.warning === null ? "" : html`<br /><span class="canccu-small canccu-warning">⚠ ${l.warning}</span>`}
              </td>
              <td class="canccu-num">${(l.length_ms / 1000).toFixed(1)} s</td>
              <td>${l.source === "pack" ? "default pack · CC0" : "uploaded by the event"}</td>
              <td>
                ${l.used_by.length === 0 ? "—" : `${String(l.used_by.length)} cue${l.used_by.length === 1 ? "" : "s"}`}
              </td>
              <td><audio controls preload="none" src="${l.url}"></audio></td>
              <td>
                ${o.canWrite && l.source === "upload" ? html`<form method="post" action="${PREFIX}cues/library/${l.id}/remove"><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit">Remove</button></form>` : ""}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </section>`;
  const log = logView(o.log, time);
  return html`${notice(o.done, o.error)}
    <div class="moments-desk">${budget}${master}${settings}${cues}${library}${log}</div>`;
}
