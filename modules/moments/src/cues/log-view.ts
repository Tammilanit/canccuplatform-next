/** The sound desk's log (mockup 12; E12, E13, E14): every decision with its reason code. */
import type { Html } from "@canccu/ui";
import { emptyState, html } from "@canccu/ui";
import type { LogRow } from "./store.js";

/** The log's reason codes in words (contracts/moments.md, The sound log). */
export const REASONS: Record<string, string> = {
  free: "played at once",
  waited: "waited in the queue",
  interrupted: "urgent interrupts",
  urgent_passes: "urgent passes the limits and counts",
  master_off: "sounds are off",
  muted: "muted",
  quiet: "quiet scene: urgent only",
  calm: "calm: only urgent, attention and result",
  category_off: "its category is off",
  cue_off: "the cue is off",
  no_sound: "the cue has no sound",
  cooldown: "not again yet",
  emergency: "an emergency runs: urgent only",
  dedupe: "already sounded",
  once_per_source: "once per source",
  outside_window: "outside its window",
  coalesced: "coalesced: the same cue 2 s ago",
  flood_source: "flood guard: per source",
  flood_minute: "flood guard: per minute",
  budget: "hourly budget",
  ambient_gap: "ambient waits 30 s between",
  busy: "ambient never waits",
  stale: "stale: 4 s in the queue",
  device_offline: "the sound screen is offline",
  audio_locked: "the sound screen's audio is locked",
  no_sound_screen: "the zone has no sound screen",
  unknown_cue: "no such cue",
  sound_check: "sound check",
};

export function logView(rows: (LogRow & { seq: number })[], time: (d: Date) => string): Html {
  return html`<section class="canccu-card">
    <h2 class="canccu-card__title">Sound log</h2>
    <p class="canccu-small canccu-muted">
      Every decision, with its reason code. The picture plays even when the sound does not.
    </p>
    ${
      rows.length === 0
        ? emptyState({
            icon: "clock",
            title: "Nothing yet",
            text: "Every sound that played, waited or stayed silent is written here.",
          })
        : html`<div class="moments-table">
            <table class="canccu-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Zone</th>
                  <th>Cue</th>
                  <th>Outcome</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (r) =>
                    html`<tr>
                      <td class="canccu-num">${time(r.at)}</td>
                      <td>${r.zone_key}</td>
                      <td>${r.cue}</td>
                      <td>${r.outcome}</td>
                      <td>
                        <code>${r.reason}</code>
                        ${REASONS[r.reason] ?? ""}${r.detail === null ? "" : html` <span class="canccu-muted">(${r.detail})</span>`}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`
    }
  </section>`;
}
