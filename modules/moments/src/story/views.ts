/**
 * Studio → Moments → Storyboards: the crew's part on On air and the phone (SU2): fire, Stop loop,
 * Skip to finale, and the pages' notice; the builder is builder.ts. Server-drawn with
 * `packages/ui` classes.
 */
import type { Html } from "@canccu/ui";
import { html, notice } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { itemTime, nextRound } from "./fire-words.js";
import { freeVariablesOf } from "./model.js";
import type { Story } from "./model.js";
import type { Timing } from "./timing.js";

export interface RunView {
  id: string;
  story_key: string;
  name: string;
  source: string;
  /** The run's T (its item's start or end, or the fire), for its next round's time. */
  t: string;
  status: string;
  test: boolean;
  zones: string[];
  round: { number: number; finale: boolean; until: string } | null;
  has_finale: boolean;
  started_at: string;
}
export interface ItemChoice {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string | null;
}

/**
 * Fire's items (O2, R22): those the story's item triggers take whose start (or end, by the
 * trigger's anchor) is still to come, soonest first, so the first is the default. A past item
 * would send the run straight to its finale.
 */
export function fireChoices(s: Story, items: readonly ItemChoice[], now: number): ItemChoice[] {
  const triggers = s.triggers.filter(
    (t): t is Extract<Story["triggers"][number], { kind: "item" }> => t.kind === "item",
  );
  return items
    .map((i) => {
      const times = triggers
        .filter((t) =>
          t.item_id !== null
            ? t.item_id === i.id
            : t.kinds.length === 0 || t.kinds.includes(i.kind),
        )
        .map((t) => Date.parse((t.anchor === "end" ? i.ends_at : i.starts_at) ?? ""))
        .filter((at) => at >= now);
      return { i, at: Math.min(...times) };
    })
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.i);
}

export const flash = (done?: string, error?: string): Html | string =>
  error
    ? notice({ kind: "down", title: "Not done", text: error })
    : done
      ? notice({ kind: "ok", title: done })
      : "";

/** The items a story takes, in words: "a tournament or ceremony item". */
export function takesWords(s: Story): string {
  const t = s.triggers.find((x) => x.kind === "item");
  if (t?.kind !== "item" || t.item_id !== null) return "its own item";
  return t.kinds.length === 0 ? "any item" : `a ${t.kinds.join(" or ")} item`;
}

/** What a story fires on, said in the chooser. */
function takesText(s: Story): string {
  if (!s.triggers.some((x) => x.kind === "item")) return "Needs no item";
  const w = takesWords(s);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} · the item above`;
}

/**
 * Fire, and each live loop's Stop loop and Skip to finale (docs/design/moments-on-air.svg, #638):
 * one item picker and one "Fire…" that opens a chooser of the stories the crew may fire, each a
 * submit button of the one form (its own `formaction`), so it works without the page script.
 */
export function crewStories(o: {
  stories: Story[];
  runs: RunView[];
  items: ItemChoice[];
  now: number;
  canTake: boolean;
  back: string;
  timeZone: string;
  settings: Timing;
}): Html {
  if (!o.canTake) return html``;
  const takes = o.stories.filter((s) => s.enabled && s.triggers.some((t) => t.kind === "take"));
  const live = o.runs.filter((r) => r.status === "live");
  // One picker for every story that fires on an item: the coming items any of them takes.
  const chosen = new Set(
    takes.flatMap((s) =>
      s.triggers.some((t) => t.kind === "item") ? fireChoices(s, o.items, o.now) : [],
    ),
  );
  const choices = o.items
    .filter((i) => chosen.has(i))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const needsItem = takes.some((s) => s.triggers.some((t) => t.kind === "item"));
  const vars = [...new Set(takes.flatMap((s) => freeVariablesOf(s)))];
  const fire =
    takes.length === 0
      ? ""
      : html`<form
          class="moments-fire"
          method="post"
          action="${PREFIX}storyboards/${takes[0]?.key ?? ""}/fire"
        >
          ${formKey()}<input type="hidden" name="back" value="${o.back}" />
          ${needsItem ? html`<label class="canccu-field__label" for="fire-item">Item</label>` : ""}
          <div class="moments-fire__row">
            ${
              needsItem
                ? html`<select
                    class="canccu-input moments-fire__item"
                    id="fire-item"
                    name="item_id"
                  >
                    ${choices.length === 0 ? html`<option value="">No coming item</option>` : choices.map((i, n) => html`<option value="${i.id}" ${n === 0 ? " selected" : ""}>${i.title} · ${itemTime(i.starts_at, o.now, o.timeZone)}</option>`)}
                  </select>`
                : ""
            }
            <details class="moments-fire__chooser">
              <summary class="canccu-button canccu-button--secondary">Fire…</summary>
              <div class="moments-fire__list">
                ${takes.map(
                  (s) =>
                    html`<button
                      class="moments-fire__story"
                      type="submit"
                      formaction="${PREFIX}storyboards/${s.key}/fire"
                    >
                      <b>Fire ${s.name}</b
                      ><span class="canccu-small canccu-muted">${takesText(s)}</span>
                    </button>`,
                )}
              </div>
            </details>
          </div>
          ${vars.map((v) => html`<label class="canccu-field__label" for="fire-${v}">{${v}}</label><input class="canccu-input" id="fire-${v}" name="var_${v}" maxlength="120" />`)}
        </form>`;
  const story = (key: string) => o.stories.find((s) => s.key === key);
  const between = (r: RunView): string => {
    const s = story(r.story_key);
    const next =
      s === undefined
        ? null
        : nextRound({
            story: s,
            t: Date.parse(r.t),
            // A run on an item counts its rounds from it (triggers.ts names its source so).
            anchored: r.source.startsWith("item:"),
            settings: o.settings,
            now: o.now,
            timeZone: o.timeZone,
          });
    return next ?? "between rounds";
  };
  const running = live.map(
    (r) =>
      html`<li class="moments-list__row">
        <span
          ><strong>${r.name}</strong>${r.test ? " (test)" : ""} ·
          ${r.round === null ? between(r) : r.round.finale ? "finale" : `round ${String(r.round.number)}`}</span
        >
        <span class="canccu-cluster">
          <form method="post" action="${PREFIX}storyboards/runs/${r.id}/stop">
            ${formKey()}<input type="hidden" name="back" value="${o.back}" /><button
              class="canccu-button canccu-button--ghost canccu-button--sm"
              type="submit"
            >
              Stop loop
            </button>
          </form>
          ${r.has_finale ? html`<form method="post" action="${PREFIX}storyboards/runs/${r.id}/finale">${formKey()}<input type="hidden" name="back" value="${o.back}" /><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit">Skip to finale</button></form>` : ""}
        </span>
      </li>`,
  );
  return html`<section class="canccu-card moments-crew">
    <h2 class="canccu-card__title">Storyboards</h2>
    ${
      running.length === 0
        ? html`<p class="canccu-small canccu-muted">No loop is running.</p>`
        : html`<ul class="moments-list">
            ${running}
          </ul>`
    }
    ${fire}
  </section>`;
}
