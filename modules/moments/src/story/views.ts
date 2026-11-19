/**
 * Studio → Moments → Storyboards: the crew's part on On air and the phone (SU2): fire, Stop loop,
 * Skip to finale, and the pages' notice; the builder is builder.ts. Server-drawn with
 * `packages/ui` classes.
 */
import type { Html } from "@canccu/ui";
import { html, notice } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { freeVariablesOf } from "./model.js";
import type { Story } from "./model.js";

export interface RunView {
  id: string;
  story_key: string;
  name: string;
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

/** Fire (with its item and free variables), and each live loop's Stop loop and Skip to finale. */
export function crewStories(o: {
  stories: Story[];
  runs: RunView[];
  items: ItemChoice[];
  now: number;
  canTake: boolean;
  back: string;
}): Html {
  if (!o.canTake) return html``;
  const takes = o.stories.filter((s) => s.enabled && s.triggers.some((t) => t.kind === "take"));
  const live = o.runs.filter((r) => r.status === "live");
  const fire = takes.map((s) => {
    const needsItem = s.triggers.some((t) => t.kind === "item");
    const choices = needsItem ? fireChoices(s, o.items, o.now) : [];
    const vars = freeVariablesOf(s);
    return html`<form
      class="canccu-stack moments-story-fire"
      method="post"
      action="${PREFIX}storyboards/${s.key}/fire"
    >
      ${formKey()}<input type="hidden" name="back" value="${o.back}" />
      ${
        needsItem
          ? html`<label class="canccu-field__label" for="item-${s.key}">Item</label>
              <select class="canccu-input" id="item-${s.key}" name="item_id">
                ${choices.length === 0 ? html`<option value="">No coming item it takes</option>` : choices.map((i, n) => html`<option value="${i.id}" ${n === 0 ? " selected" : ""}>${i.title} · ${i.starts_at.slice(11, 16)}</option>`)}
              </select>`
          : ""
      }
      ${vars.map((v) => html`<label class="canccu-field__label" for="${s.key}-${v}">{${v}}</label><input class="canccu-input" id="${s.key}-${v}" name="var_${v}" maxlength="120" />`)}
      <button class="canccu-button canccu-button--secondary canccu-button--block" type="submit">
        Fire ${s.name}
      </button>
    </form>`;
  });
  const running = live.map(
    (r) =>
      html`<li class="moments-list__row">
        <span
          ><strong>${r.name}</strong>${r.test ? " (test)" : ""} ·
          ${r.round === null ? "between rounds" : r.round.finale ? "finale" : `round ${String(r.round.number)}`}</span
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
