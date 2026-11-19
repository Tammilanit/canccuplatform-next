/**
 * Studio → Moments → Storyboards, the builder (SU5; mockup 18 redrawn as step 4 polish sheets 05
 * and 06, #627): the page head with Test-fire and Save, what plays it, the rounds on a timeline, the
 * round as a strip of steps with the chosen step's form beside it, and the preview with the checks
 * before saving. On a phone the same parts are three tabs, Overview, Round and Preview, with
 * Test-fire and Save in the pending row. One form holds every field form.ts reads; the
 * test-fire is a form of its own, so its controls name it with `form`. Server-drawn with
 * `packages/ui` classes, static/story-builder.css and static/story-builder.js.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import { sharedPlaceholders } from "./describe.js";
import type { Described } from "./describe.js";
import type { Story } from "./model.js";
import type { StorySettings } from "./store.js";
import { toggle } from "./builder-fields.js";
import { overviewCard } from "./builder-overview.js";
import { roundsCard } from "./builder-rounds.js";
import { checkCount, sideColumn } from "./builder-side.js";
import { roundColumns } from "./builder-steps.js";
import { flash } from "./views.js";
import type { ZoneName } from "../page-kit.js";

/** A step's view-model with its texts filled by the sample; a countdown's target stays as set. */
function sampled(v: unknown, sample: (t: string) => string): unknown {
  if (typeof v === "string") return sample(v);
  if (Array.isArray(v)) return v.map((x) => sampled(x, sample));
  if (typeof v === "object" && v !== null)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sampled(x, sample)]));
  return v;
}

/** The page head's line under the title and its actions (sheet 05, 1): Preset, on or off, then
 * Test-fire and Save, which stay in reach while the page scrolls; on a phone the pending row has
 * them. The test-fire is a form of its own; Save and the switch name the builder's form. */
export function builderHead(
  o: Pick<BuilderView, "story" | "zones" | "zoneName" | "canWrite" | "canTake">,
): {
  description: Html;
  actions: Html;
} {
  const st = o.story;
  const zone = o.zones[0];
  const test =
    o.canTake && zone !== undefined
      ? html`<form id="story-test" method="post" action="${PREFIX}storyboards/${st.key}/test">
          ${formKey()}
          <button class="canccu-button canccu-button--secondary" type="submit">
            ▶ Test-fire on <span data-zone-name>${o.zoneName(zone)}</span>
          </button>
        </form>`
      : "";
  return {
    description: html`<span class="moments-builder__status"
      ><span class="canccu-badge canccu-badge--plain"
        >${st.preset === null ? "The event's own" : "Preset"}</span
      >${
        o.canWrite
          ? toggle("enabled", "yes", st.enabled, "On for this event", { form: "story-save" })
          : html`<span>${st.enabled ? "On for this event" : "Off"}</span>`
      }</span
    >`,
    actions: html`<span class="moments-builder__actions">
      ${test}
      <span class="canccu-small canccu-muted" data-builder-unsaved hidden>Not saved yet</span>
      ${
        o.canWrite
          ? html`<button
              class="canccu-button canccu-button--primary"
              type="submit"
              form="story-save"
            >
              Save
            </button>`
          : ""
      }
    </span>`,
  };
}

export interface BuilderView {
  story: Story;
  d: Described;
  settings: StorySettings;
  zones: string[];
  zoneName: ZoneName;
  cues: string[];
  revision: number;
  canWrite: boolean;
  canTake: boolean;
  /** All stories' share of each zone's last 10 minutes. */
  airtime: { zone: string; share: number }[];
  /** The step whose form is open. */
  step: number;
  /** A text with its placeholders filled from the story's next item (the preview's sample). */
  sample: (text: string) => string;
  done?: string | undefined;
  error?: string | undefined;
}

export function builderView(o: BuilderView): Html {
  const { story: st, d } = o;
  const zone = o.zones[0];
  const step = Math.max(0, Math.min(o.step, st.round.steps.length - 1));
  const steps = d.compiled.steps
    .filter((p) => !p.video)
    .map((p) => ({
      template: p.template,
      content: sampled(p.content, o.sample) as Record<string, unknown>,
      duration_ms: Math.max(500, Math.min(60_000, p.duration_ms)),
    }));
  const n = checkCount(d);
  const tab = (id: string, label: string, on: boolean) =>
    html`<button
      class="moments-builder__tab"
      type="button"
      role="tab"
      aria-selected="${on ? "true" : "false"}"
      data-tab-to="${id}"
    >
      ${label}
    </button>`;
  return html`${flash(o.done, o.error)}
    <div class="moments-builder" data-builder>
      <div class="moments-builder__tabs" role="tablist" aria-label="Parts of the builder" hidden>
        ${tab("overview", "Overview", true)}${tab("round", "Round", false)}${tab("preview", "Preview", false)}
      </div>
      <form
        id="story-save"
        class="moments-builder__grid"
        method="post"
        action="${PREFIX}storyboards/${st.key}/save"
      >
        ${formKey()}<input type="hidden" name="revision" value="${String(o.revision)}" />
        <a
          class="moments-builder__checkline${n.look > 0 ? " moments-builder__checkline--look" : ""}"
          href="#checks"
          data-tab="overview"
          data-tab-to="preview"
          ><span class="moments-storychecks__mark" aria-hidden="true"
            >${n.look > 0 ? "!" : "✓"}</span
          ><span
            >${String(n.ok)} checks
            pass${n.look > 0 ? ` · ${String(n.look)} to look at` : " · none to look at"}</span
          ><span aria-hidden="true">›</span></a
        >
        <fieldset class="moments-builder__part" ${o.canWrite ? "" : "disabled"}>
          <legend class="moments-visually-hidden">What plays it and when</legend>
          ${overviewCard(st, o.zones, o.zoneName)} ${roundsCard(st, d, o.cues)}
        </fieldset>
        ${roundColumns({ story: st, d, cues: o.cues, step, canWrite: o.canWrite, placeholders: sharedPlaceholders(st), sample: o.sample })}
        ${sideColumn({ d, zones: o.zones, zoneName: o.zoneName, settings: o.settings, airtime: o.airtime, canTake: o.canTake, fullScreen: st.full_screen, steps })}
      </form>
      ${
        o.canWrite || o.canTake
          ? html`<div class="canccu-savebar moments-builder__pending">
              <span class="canccu-savebar__text" data-builder-state>No changes</span>
              ${
                o.canTake && zone !== undefined
                  ? html`<button
                      class="canccu-button canccu-button--secondary"
                      type="submit"
                      form="story-test"
                    >
                      ▶ Test-fire
                    </button>`
                  : ""
              }
              ${
                o.canWrite
                  ? html`<button
                      class="canccu-button canccu-button--primary"
                      type="submit"
                      form="story-save"
                    >
                      Save
                    </button>`
                  : ""
              }
            </div>`
          : ""
      }
    </div>`;
}
