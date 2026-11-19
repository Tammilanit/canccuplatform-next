/**
 * The builder's first card (step 4 polish sheet 05, marker 2): what plays the story and what must
 * hold, as two chip rows with their labels in one column. Each trigger and each condition is a
 * chip that opens its own small form; a condition not set waits under "Add a condition". The
 * fields are those form.ts reads.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { ADD_TRIGGERS } from "./form.js";
import { triggerText } from "./describe.js";
import { DOMAIN_TYPES, ENERGIES } from "./model.js";
import type { Story, Trigger } from "./model.js";
import {
  change,
  chip,
  chipRow,
  field,
  segmented,
  select,
  textInput,
  toggle,
} from "./builder-fields.js";

const TRIGGER_NAMES: Record<(typeof ADD_TRIGGERS)[number], string> = {
  item: "A run-of-show item",
  domain: "Something happens (a match, an order…)",
  clock: "The clock",
  take: "By hand, from On air",
  scene: "A zone's scene changes",
  milestone: "A count reaches a mark",
};

/** A trigger in a few words, for its chip; the full sentence is the chip's title. */
export function triggerChip(t: Trigger): string {
  switch (t.kind) {
    case "item": {
      const when = t.anchor === "start" ? "starts" : "ends";
      if (t.item_id !== null) return `The item ${t.item_id} ${when}`;
      return t.kinds.length === 0 ? `Any item ${when}` : `A ${t.kinds.join(" or ")} item ${when}`;
    }
    case "domain":
      return `${t.type}${t.final_only ? " · a final" : ""}`;
    case "clock":
      if (t.mode === "every")
        return `Every ${String(t.every_minutes)} min, ${t.from ?? ""}–${t.until ?? ""}`;
      if (t.mode === "daily") return `Every day at ${t.at ?? ""}`;
      if (t.mode === "once") return t.at === null ? "Once (set a time)" : `Once at ${t.at}`;
      return t.mode === "event_start" ? "The event starts" : "The event ends";
    case "take":
      return "By hand, from On air";
    case "scene":
      return `A zone ${t.change} ${t.scene_key}`;
    case "milestone":
      return t.at === null ? `${t.count}: a new peak` : `${t.count} reach ${String(t.at)}`;
  }
}

function triggerFields(t: Trigger, i: number): Html {
  const p = (k: string) => `t${String(i)}_${k}`;
  const text = (k: string, label: string, v: string | number | null) =>
    field(p(k), label, textInput(p(k), p(k), v));
  switch (t.kind) {
    case "item":
      return html`${text("kinds", "Item kinds", t.kinds.join(", "))}${text("item_id", "Or one item (id)", t.item_id)}
      ${field(
        p("anchor"),
        "At its",
        select(
          p("anchor"),
          p("anchor"),
          [
            ["start", "start"],
            ["end", "end"],
          ],
          t.anchor,
        ),
      )}`;
    case "domain":
      return html`${field(
          p("type"),
          "Event",
          select(
            p("type"),
            p("type"),
            Object.keys(DOMAIN_TYPES).map((x) => [x, x] as const),
            t.type,
          ),
        )}
        <div class="moments-field--switch">
          ${toggle(p("final"), "yes", t.final_only, "Only for a final")}
        </div>`;
    case "clock":
      return html`${field(
        p("mode"),
        "Clock",
        select(
          p("mode"),
          p("mode"),
          ["daily", "once", "every", "event_start", "event_end"].map(
            (x) => [x, x.replace("_", " ")] as const,
          ),
          t.mode,
        ),
      )}
      ${text("at", "At (HH:MM, or a date-time once)", t.at)}${text("every", "Every (min, 15–240)", t.every_minutes)}
      ${text("from", "From (HH:MM)", t.from)}${text("until", "Until (HH:MM)", t.until)}`;
    case "scene":
      return html`${text("scene", "Scene", t.scene_key)}${field(
        p("change"),
        "When a zone",
        select(
          p("change"),
          p("change"),
          [
            ["enters", "enters it"],
            ["leaves", "leaves it"],
          ],
          t.change,
        ),
      )}`;
    case "milestone":
      return html`${field(
        p("count"),
        "Count",
        select(
          p("count"),
          p("count"),
          ["online", "checkins", "photos"].map((x) => [x, x] as const),
          t.count,
        ),
      )}${text("value", "Reaches (empty: a new peak)", t.at)}`;
    case "take":
      return html`<p class="canccu-small canccu-muted moments-field--wide">
        The crew fire it from On air and the phone.
      </p>`;
  }
}

const RUN_MODES = [
  ["per_source", "One run per source"],
  ["restart", "A new trigger restarts it"],
  ["ignore", "Ignored while it runs"],
] as const;

function triggers(st: Story): Html[] {
  const chips = st.triggers.map((t, i) =>
    chip(
      triggerChip(t),
      html`<div class="moments-grid">${triggerFields(t, i)}</div>
        ${change(`t${String(i)}_remove`, "yes", "Remove this trigger")}`,
      { title: triggerText(t) },
    ),
  );
  const mode = RUN_MODES.find(([v]) => v === st.run_mode)?.[1] ?? st.run_mode;
  chips.push(
    chip(
      `Again: ${mode.toLowerCase()}`,
      html`<p class="canccu-small canccu-muted">When it is triggered again while it runs.</p>
        ${segmented("run_mode", RUN_MODES, st.run_mode, { label: "When it is triggered again" })}`,
    ),
    chip(
      "Add a trigger",
      html`<div class="moments-grid">
          ${field("add_trigger", "Plays also when", select("add_trigger", "add_trigger", [["", "—"], ...ADD_TRIGGERS.map((x) => [x, TRIGGER_NAMES[x]] as const)], ""))}
        </div>
        ${change("add", "trigger", "Add it", "canccu-button canccu-button--secondary canccu-button--sm")}`,
      { add: true },
    ),
  );
  return chips;
}

function zonesLabel(st: Story): string {
  const k = st.conditions;
  if (k.item_zone) return "Item's zone, else all";
  return k.zones.length === 0 ? "Every zone" : `Zones: ${k.zones.join(", ")}`;
}

/** The conditions: zones and the quiet rule always; the others as chips once set. */
function conditions(st: Story, zones: string[]): Html[] {
  const k = st.conditions;
  const text = (name: string, label: string, v: string | number | null | undefined, ph = "") =>
    field(name, label, textInput(name, name, v, { placeholder: ph }));
  const energy = (name: "energy_min" | "energy_max", label: string) =>
    field(
      name,
      label,
      select(name, name, [["", "any"], ...ENERGIES.map((x) => [x, x] as const)], k[name]),
    );
  const groups: { set: boolean; face: string; body: Html }[] = [
    {
      set: k.scenes.length > 0 || k.not_scenes.length > 0,
      face: [
        k.scenes.length > 0 ? `Only in ${k.scenes.join(" or ")}` : "",
        k.not_scenes.length > 0 ? `not in ${k.not_scenes.join(" or ")}` : "",
      ]
        .filter(Boolean)
        .join(", "),
      body: html`${text("scenes", "Only in scenes", k.scenes.join(", "))}${text("not_scenes", "Not in scenes", k.not_scenes.join(", "))}`,
    },
    {
      set: k.energy_min !== null || k.energy_max !== null,
      face: `Energy ${k.energy_min ?? "any"} to ${k.energy_max ?? "any"}`,
      body: html`${energy("energy_min", "Energy at least")}${energy("energy_max", "Energy at most")}`,
    },
    {
      set: k.window !== null,
      face: `Between ${k.window?.from ?? ""} and ${k.window?.until ?? ""}`,
      body: html`${text("window_from", "Between (HH:MM)", k.window?.from)}${text("window_until", "and (HH:MM)", k.window?.until)}`,
    },
    {
      set: k.days.length > 0,
      face: `On ${k.days.join(", ")}`,
      body: text("days", "Days (YYYY-MM-DD)", k.days.join(", ")),
    },
    {
      set: k.once !== null,
      face: `Once per ${k.once ?? ""}`,
      body: field(
        "once",
        "Once",
        select(
          "once",
          "once",
          [
            ["", "no"],
            ...(["event", "day", "source"] as const).map((x) => [x, `per ${x}`] as const),
          ],
          k.once,
        ),
      ),
    },
    {
      set: k.cooldown_minutes > 0,
      face: `Cooldown ${String(k.cooldown_minutes)} min`,
      body: text("cooldown", "Cooldown (min)", k.cooldown_minutes === 0 ? "" : k.cooldown_minutes),
    },
  ];
  const zoneBody = html`<div class="canccu-chips">
      ${zones.map(
        (z) =>
          html`<label class="canccu-chip"
            ><input
              type="checkbox"
              name="zone"
              value="${z}"
              ${k.zones.includes(z) ? "checked" : ""}
            />${z}</label
          >`,
      )}
    </div>
    <p class="canccu-small canccu-muted">None ticked: every zone.</p>
    ${toggle("item_zone", "yes", k.item_zone, "The item's zone, else all")}`;
  return [
    chip(zonesLabel(st), zoneBody),
    chip(
      `Quiet scene: ${k.quiet === "calm" ? "calm and silent" : "skip"}`,
      segmented(
        "quiet",
        [
          ["calm", "Play calm and silent"],
          ["skip", "Skip"],
        ],
        k.quiet,
        { label: "In a quiet scene" },
      ),
    ),
    ...groups
      .filter((g) => g.set)
      .map((g) => chip(g.face, html`<div class="moments-grid">${g.body}</div>`)),
    chip(
      "Add a condition",
      html`<div class="moments-grid">${groups.filter((g) => !g.set).map((g) => g.body)}</div>`,
      { add: true },
    ),
  ];
}

export function overviewCard(st: Story, zones: string[]): Html {
  return html`<section class="canccu-card moments-builder__overview" data-tab="overview">
    <div class="moments-chiprow">
      <label class="moments-chiprow__label" for="name"><strong>Name</strong></label>
      <div class="moments-chiprow__chips">${textInput("name", "name", st.name)}</div>
    </div>
    <hr class="moments-rule-line" />
    ${chipRow("Plays when", "any one", triggers(st))}
    <hr class="moments-rule-line" />
    ${chipRow("Only if", "all", conditions(st, zones))}
  </section>`;
}
