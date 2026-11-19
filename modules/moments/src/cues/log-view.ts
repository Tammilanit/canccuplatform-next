/**
 * The sound desk's Log (#626, the step 4 polish sheets 03 and 04; E12–E14): each row says what
 * happened in words, the reason code the grey second line; filtered by outcome, zone and a search.
 * On a phone each row is a card.
 */
import type { Html } from "@canccu/ui";
import { emptyState, html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import { OUTCOMES, cueTitle } from "./names.js";
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
  video: "a story's video plays its own sound",
  hidden: "its round is not shown here",
  story_cap: "over the story's cap",
};

export const FILTERS = ["played", "queued", "suppressed", "missed"] as const;
export interface LogQuery {
  outcome?: string;
  zone?: string;
  q?: string;
}

const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What happened, in a sentence: the sound that played, or why it did not. */
function sentence(r: LogRow, title: (id: string) => string): string {
  const why = upper(REASONS[r.reason] ?? r.reason.replaceAll("_", " "));
  const detail = r.detail === null ? "" : ` (${r.detail})`;
  if (r.outcome === "played") {
    const sound = r.sound === null ? "The sound" : title(r.sound);
    if (r.reason === "sound_check") return `${sound}: a test sound, sent from Cues`;
    return r.reason === "free" ? sound : `${sound}: ${REASONS[r.reason] ?? r.reason}${detail}`;
  }
  return `${why}${detail}`;
}

export function logView(o: {
  rows: LogRow[];
  zones: string[];
  query: LogQuery;
  time: (d: Date) => string;
  title: (id: string) => string;
}): Html {
  const q = o.query;
  const link = (change: LogQuery) => {
    const next = { ...q, ...change };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== "") params.set(k, v);
    const s = params.toString();
    return `${PREFIX}cues/log${s === "" ? "" : `?${s}`}`;
  };
  const chip = (label: string, change: LogQuery, current: boolean) =>
    html`<a class="canccu-chip" href="${link(change)}" aria-current="${current ? "true" : "false"}">${label}</a>`;
  const filters = html`<div class="moments-logbar">
    <form class="moments-search" method="get" action="${PREFIX}cues/log" role="search">
      ${q.outcome ? html`<input type="hidden" name="outcome" value="${q.outcome}" />` : ""}
      ${q.zone ? html`<input type="hidden" name="zone" value="${q.zone}" />` : ""}
      <input class="canccu-input" type="search" name="q" value="${q.q ?? ""}" placeholder="Search cue or reason" aria-label="Search cue or reason" />
    </form>
    <nav class="canccu-chips canccu-chips--scroll" aria-label="Outcome">
      ${chip("All", { outcome: "" }, !q.outcome)}
      ${FILTERS.map((f) => chip(OUTCOMES[f] ?? f, { outcome: f }, q.outcome === f))}
    </nav>
    <nav class="canccu-chips canccu-chips--scroll moments-logbar__zones" aria-label="Zone">
      ${chip("Every zone", { zone: "" }, !q.zone)}
      ${o.zones.map((z) => chip(z, { zone: z }, q.zone === z))}
    </nav>
  </div>`;
  const rows = o.rows.map(
    (r) =>
      html`<li class="moments-logrow">
        <span class="moments-logrow__time canccu-num">${o.time(r.at)}</span>
        <span class="moments-logrow__zone">${r.zone_key}</span>
        <span class="moments-logrow__cue"
          ><b>${cueTitle(r.cue)}</b> <span class="moments-sub">${r.cue}</span></span
        >
        <span class="moments-logrow__what"
          ><span class="canccu-badge moments-outcome moments-outcome--${r.outcome}">${OUTCOMES[r.outcome] ?? r.outcome}</span>
          <span>${sentence(r, o.title)}</span> <span class="moments-sub">${r.reason}</span></span
        >
      </li>`,
  );
  const empty =
    q.outcome || q.zone || q.q
      ? emptyState({ icon: "clock", title: "Nothing matches", text: "Try another outcome, zone or word." })
      : emptyState({
          icon: "clock",
          title: "Nothing yet",
          text: "Every sound that played, waited or stayed silent is written here.",
        });
  return html`<section class="canccu-card">
    ${filters}
    ${
      o.rows.length === 0
        ? empty
        : html`<div class="moments-loghead" aria-hidden="true">
              <span>Time</span><span>Zone</span><span>Cue</span><span>What happened</span>
            </div>
            <ol class="moments-log">
              ${rows}
            </ol>`
    }
  </section>`;
}
