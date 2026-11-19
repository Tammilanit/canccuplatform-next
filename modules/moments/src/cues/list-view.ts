/**
 * The sound desk's Cues (#626, the step 4 polish sheets 01 and 04): plain names first with the id
 * and sounds the grey second line, grouped under their category with its level and calm rule;
 * chips filter, search finds a cue by name or id. The round button plays the cue's sound here, the
 * row opens the editor and On is a switch in the row. On a phone each row is a card.
 */
import type { Html } from "@canccu/ui";
import { emptyState, html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import { CALM, CATEGORIES } from "./catalog.js";
import type { Category, SoundSettings } from "./catalog.js";
import { meter, player, toggle } from "./controls.js";
import { categoryName, cueTitle, seconds } from "./names.js";
import type { CueView } from "./store.js";
import type { LibraryView } from "./views.js";

export interface CueQuery {
  category?: string;
  q?: string;
}

/** The cues the chip and the search leave: the search reads the plain name and the id. */
export function filterCues(cues: CueView[], q: CueQuery): CueView[] {
  const words = (q.q ?? "").trim().toLowerCase();
  return cues.filter(
    (c) =>
      (q.category === undefined || q.category === "" || c.category === q.category) &&
      (words === "" ||
        c.name.toLowerCase().includes(words) ||
        cueTitle(c.name).toLowerCase().includes(words)),
  );
}

const picture = (c: CueView): string => {
  if (c.effects.length === 0) return "Sound only";
  const effects = c.effects.map((e) => e.replace("_", " ")).join(", ");
  return `${effects.charAt(0).toUpperCase()}${effects.slice(1)} · holds ${String(c.hold_seconds)} s`;
};

function heading(c: Category, s: SoundSettings): Html {
  const rules = [
    c === "urgent" ? "interrupts" : "",
    CALM.has(c) ? "" : "silent at calm",
    s.categories[c].enabled ? "" : "off",
  ].filter((x) => x !== "");
  return html`<h3 class="moments-group">
    <span class="moments-tag moments-tag--${c}">${categoryName(c)}</span>
    <span class="canccu-small canccu-muted"
      >level ${s.categories[c].level} %${rules.map((r) => ` · ${r}`).join("")}</span
    >
  </h3>`;
}

function row(c: CueView, o: { library: LibraryView[]; canWrite: boolean }): Html {
  const sound = (id: string) => o.library.find((l) => l.id === id);
  const first = c.sounds.map(sound).find((l) => l !== undefined);
  const sub = [c.name, c.sounds.map((id) => sound(id)?.title ?? id).join(", ")]
    .filter((x) => x !== "")
    .join(" · ");
  const name = html`<b class="moments-cue__title">${cueTitle(c.name)}</b
    >${c.builtin ? "" : html` <span class="canccu-badge canccu-badge--plain">event's own</span>`}`;
  return html`<li class="moments-cue${c.enabled ? "" : " moments-cue--off"}">
    <span class="moments-cue__play"
      >${first === undefined ? "" : player({ id: first.id, title: cueTitle(c.name), url: first.url, length_ms: first.length_ms, compact: true })}</span
    >
    <span class="moments-cue__name"
      >${o.canWrite ? html`<a class="moments-cue__link" href="${PREFIX}cues/edit/${c.name}">${name}</a>` : name}
      <span class="moments-sub">${sub}</span></span
    >
    <span class="moments-cue__picture canccu-small">${picture(c)}</span>
    <span class="moments-cue__level"
      >${meter(c.level, 100, `${cueTitle(c.name)} level`)}
      <span class="canccu-small canccu-num">${c.level} %</span></span
    >
    <span class="moments-cue__again canccu-small">${seconds(c.cooldown_seconds, "none")}</span>
    <form class="moments-cue__on" method="post" action="${PREFIX}cues/edit/${c.name}/toggle">
      <input type="hidden" name="revision" value="${String(c.revision)}" />
      ${toggle({ name: "enabled", on: c.enabled, label: `${cueTitle(c.name)} on`, enabled: o.canWrite, auto: true })}
      ${o.canWrite ? html`<noscript><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit" name="turn" value="${c.enabled ? "off" : "on"}">${c.enabled ? "Turn off" : "Turn on"}</button></noscript>` : ""}
    </form>
  </li>`;
}

export function cueList(o: {
  cues: CueView[];
  settings: SoundSettings;
  library: LibraryView[];
  query: CueQuery;
  canWrite: boolean;
}): Html {
  const q = o.query;
  const href = (category: string) => {
    const p = new URLSearchParams();
    if (category !== "") p.set("category", category);
    if (q.q) p.set("q", q.q);
    const s = p.toString();
    return `${PREFIX}cues${s === "" ? "" : `?${s}`}`;
  };
  const chip = (label: string, category: string) =>
    html`<a
      class="canccu-chip"
      href="${href(category)}"
      aria-current="${(q.category ?? "") === category ? "true" : "false"}"
      >${label}</a
    >`;
  const shown = filterCues(o.cues, q);
  const groups = CATEGORIES.map((c) => [c, shown.filter((x) => x.category === c)] as const).filter(
    ([, list]) => list.length > 0,
  );
  return html`<section class="canccu-card moments-cues">
    <div class="moments-cuebar">
      <form class="moments-search" method="get" action="${PREFIX}cues" role="search">
        ${q.category ? html`<input type="hidden" name="category" value="${q.category}" />` : ""}
        <input
          class="canccu-input"
          type="search"
          name="q"
          value="${q.q ?? ""}"
          placeholder="Search cues"
          aria-label="Search cues"
        />
      </form>
      <nav class="canccu-chips canccu-chips--scroll" aria-label="Category">
        ${chip("All", "")}${CATEGORIES.map((c) => chip(categoryName(c), c))}
      </nav>
      ${o.canWrite ? html`<a class="canccu-button canccu-button--primary moments-cuebar__new" href="${PREFIX}cues/new">+ New cue</a>` : ""}
    </div>
    ${
      groups.length === 0
        ? emptyState({
            icon: "sliders",
            title: "No cue matches",
            text: "Try another category or word.",
          })
        : html`<div class="moments-cuehead" aria-hidden="true">
              <span></span><span>Cue</span><span>Picture</span><span>Level</span
              ><span>Not again for</span><span>On</span>
            </div>
            ${groups.map(
              ([c, list]) =>
                html`${heading(c, o.settings)}
                  <ul class="moments-cuelist">
                    ${list.map((x) => row(x, o))}
                  </ul>`,
            )}
            <p class="canccu-small canccu-muted moments-cues__count">
              ${shown.length} of ${o.cues.length} shown
            </p>`
    }
  </section>`;
}
