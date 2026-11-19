/**
 * Studio → Cues, the sound desk (#626, the step 4 polish sheets 01–04, replacing mockup 12's one
 * long page; book shots O9, O11, O12, O30): four sub-pages, Cues, Library, Limits and categories
 * and Log, as pills under the Cues tab, each under the same master strip. Every form posts to the
 * page routes (cues/pages.ts), which send it on to the API.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import type { Category, SoundSettings } from "./catalog.js";
import { notice } from "./controls.js";
import { libraryView } from "./library-view.js";
import { limitsView } from "./limits-view.js";
import { cueList } from "./list-view.js";
import type { CueQuery } from "./list-view.js";
import { logView } from "./log-view.js";
import type { LogQuery } from "./log-view.js";
import type { CueView, LogRow } from "./store.js";
import { masterStrip } from "./strip.js";

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

export const SUBS = ["cues", "library", "limits", "log"] as const;
export type Sub = (typeof SUBS)[number];
/** A sub-page's path under the Cues tab; Cues is the tab itself. */
export const subPath = (sub: Sub): string => `${PREFIX}cues${sub === "cues" ? "" : `/${sub}`}`;

export function deskPage(o: {
  sub: Sub;
  settings: SoundSettings & { revision: number };
  zones: DeskZone[];
  cues: CueView[];
  library: LibraryView[];
  log: (LogRow & { seq: number })[];
  /** The last sound check's lines, when the page comes back from one. */
  check: LogRow[] | null;
  query: CueQuery & LogQuery;
  timeZone: string;
  now: Date;
  canTake: boolean;
  canWrite: boolean;
  done?: string;
  error?: string;
}): Html {
  const time = (d: Date | string) =>
    new Date(d).toLocaleTimeString("en-GB", { timeZone: o.timeZone });
  const pill = (sub: Sub, label: string, count?: number) =>
    html`<a
      class="moments-pill"
      data-sub="${sub}"
      ${sub === o.sub ? html`aria-current="page"` : ""}
      href="${subPath(sub)}"
      >${label}${count === undefined ? "" : html` <span class="moments-pill__count">${count}</span>`}</a
    >`;
  const subnav = html`<nav class="moments-subnav" aria-label="Sound desk">
    ${pill("cues", "Cues", o.cues.length)}${pill("library", "Library", o.library.length)}${pill("limits", "Limits and categories")}${pill("log", "Log")}
  </nav>`;
  const title = (id: string) => o.library.find((l) => l.id === id)?.title ?? id;
  const body =
    o.sub === "cues"
      ? cueList({
          cues: o.cues,
          settings: o.settings,
          library: o.library,
          query: o.query,
          canWrite: o.canWrite,
        })
      : o.sub === "library"
        ? libraryView({ library: o.library, canWrite: o.canWrite })
        : o.sub === "limits"
          ? limitsView({ settings: o.settings, zones: o.zones, canWrite: o.canWrite })
          : logView({
              rows: o.log,
              zones: o.zones.map((z) => z.zone_key),
              query: o.query,
              time,
              title,
            });
  return html`${notice(o.done, o.error)}
    <div class="moments-desk">
      ${subnav}
      ${masterStrip({
        sub: o.sub,
        settings: o.settings,
        zones: o.zones,
        check: o.check,
        now: o.now,
        time,
        canTake: o.canTake,
        canWrite: o.canWrite,
      })}
      ${body}
    </div>`;
}
