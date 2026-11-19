/**
 * The master strip on top of every sound desk sub-page (#626, the step 4 polish sheet 01; book
 * shots O11, O12): Sound on, the master volume as a slider, Mute all 15 min and Sound check with
 * its zone menu, and each zone's use of the hour in a line. Muted, it turns amber and counts down;
 * after a sound check it says in words what each zone did.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import type { SoundSettings } from "./catalog.js";
import { meter, slider, toggle } from "./controls.js";
import { REASONS } from "./log-view.js";
import type { LogRow } from "./store.js";
import type { DeskZone, Sub } from "./views.js";

/** The zone's sound screen when it needs a look: none, offline or locked. */
export function screenFlag(z: DeskZone): Html {
  const s = z.sound_screen;
  if (s === null) return html`<span class="canccu-badge canccu-badge--late">no sound screen</span>`;
  if (!s.online) return html`<span class="canccu-badge canccu-badge--down">offline</span>`;
  if (s.audio_unlocked === false)
    return html`<span class="canccu-badge canccu-badge--late">audio locked</span>`;
  return html``;
}

const clockOf = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The sound check's answer per zone, from the log lines it wrote. A check passes every gate, so a
 * zone without a sound screen logs it played; the zone's state now says nobody heard it.
 */
function checkReport(rows: LogRow[], zones: DeskZone[], time: (d: Date) => string): Html {
  const first = rows[0];
  if (first === undefined) return html``;
  const screenless = (zone: string) =>
    zones.find((z) => z.zone_key === zone)?.sound_screen === null;
  const said = rows.map((r) =>
    r.outcome === "played" && !screenless(r.zone_key)
      ? `${r.zone_key} played it`
      : `${r.zone_key} ${r.reason === "no_sound_screen" || screenless(r.zone_key) ? "has no sound screen" : `did not: ${REASONS[r.reason] ?? r.reason}`}, so nothing was heard there`,
  );
  return html`<p class="moments-master__report" role="status">
    <b
      >Sound check sent to ${rows.length > 1 ? "every zone" : rows[0]?.zone_key} at
      ${time(first.at)}</b
    >
    · ${said.join(" · ")}
  </p>`;
}

export function masterStrip(o: {
  sub: Sub;
  settings: SoundSettings & { revision: number };
  zones: DeskZone[];
  check: LogRow[] | null;
  now: Date;
  time: (d: Date | string) => string;
  canTake: boolean;
  canWrite: boolean;
}): Html {
  const s = o.settings;
  const until = s.muted_until === null ? NaN : Date.parse(s.muted_until);
  const muted = until > o.now.getTime();
  const back = html`<input type="hidden" name="back" value="${o.sub}" />`;
  const master = html`<form
    class="moments-master__form"
    method="post"
    action="${PREFIX}cues/master"
  >
    <input type="hidden" name="revision" value="${s.revision}" />${back}
    <label class="moments-master__sound"
      >Sound
      ${toggle({ name: "enabled", on: s.enabled, label: "Sound on", enabled: o.canWrite, auto: true })}</label
    >
    ${slider({ id: "master-volume", name: "volume", label: "Master", min: 0, max: 100, step: 5, value: s.volume, format: "pct", enabled: o.canWrite })}
    ${o.canWrite ? html`<noscript><button class="canccu-button canccu-button--secondary canccu-button--sm" type="submit">Set</button></noscript>` : ""}
  </form>`;
  const mute = muted
    ? html`<form method="post" action="${PREFIX}cues/mute" class="moments-master__muted">
        ${formKey()}${back}<input type="hidden" name="minutes" value="0" />
        <span class="moments-master__countdown" data-until="${s.muted_until ?? ""}"
          >Muted · back at ${o.time(s.muted_until as string).slice(0, 5)}
          (${clockOf(until - o.now.getTime())} left)</span
        >
        ${o.canTake ? html`<button class="canccu-button canccu-button--primary canccu-button--sm" type="submit">Unmute now</button>` : ""}
      </form>`
    : o.canTake
      ? html`<form method="post" action="${PREFIX}cues/mute">
          ${formKey()}${back}<input type="hidden" name="minutes" value="15" />
          <button
            class="canccu-button canccu-button--secondary canccu-button--sm moments-master__mute"
            type="submit"
          >
            Mute all 15 min
          </button>
        </form>`
      : "";
  // The zone menu: a details list, so it opens without the script; each zone is its own button.
  const check = o.canTake
    ? html`<form method="post" action="${PREFIX}cues/check" class="moments-master__check">
        ${formKey()}${back}
        <details class="moments-menu">
          <summary class="canccu-button canccu-button--secondary canccu-button--sm">
            Sound check
          </summary>
          <div class="moments-menu__list">
            <button class="moments-menu__item" type="submit" name="zone_key" value="">
              Every zone
            </button>
            ${o.zones.map((z) => html`<button class="moments-menu__item" type="submit" name="zone_key" value="${z.zone_key}">${z.zone_key}</button>`)}
          </div>
        </details>
      </form>`
    : "";
  const zones = html`<ul class="moments-master__zones">
    ${o.zones.map(
      (z) =>
        html`<li>
          <b>${z.zone_key}</b> ${meter(z.hour, s.hourly_budget, `${z.zone_key} this hour`)}
          <span class="canccu-small">${z.hour} of ${s.hourly_budget} this hour</span>
          ${screenFlag(z)}
        </li>`,
    )}
  </ul>`;
  return html`<section
    class="canccu-card moments-master${muted ? " moments-master--muted" : ""}"
    aria-label="Master"
  >
    <div class="moments-master__top">
      ${master}
      <div class="moments-master__actions">${mute}${check}</div>
    </div>
    <div class="moments-master__foot">
      ${o.check === null ? zones : checkReport(o.check, o.zones, o.time)}
      ${o.sub === "limits" ? "" : html`<a class="moments-master__link canccu-small" href="${PREFIX}cues/limits">Limits and categories ›</a>`}
    </div>
  </section>`;
}
