/**
 * The composer at Run the event → Announcements (mockup 05; contracts/moments.md, Announcements,
 * Pages): one form for every channel, a preview of each before anything goes out (U11), and the
 * live and scheduled ones beside it with Edit and Withdraw.
 */
import { html, notice } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import type { Channels, Level, RunItem } from "./store.js";
import type { Template } from "./templates.js";
import { freeVariables } from "./text.js";

/** What the form holds: the posted values again after a preview, or a template's. */
export interface ComposerState {
  title: string;
  body: string;
  level: Level;
  full_screen: boolean;
  channels: Channels;
  zones: string[];
  duration_seconds: number;
  item_id: string;
  when: "now" | "at" | "item";
  at_local: string;
  minutes_before: number;
  variables: Record<string, string>;
  template_key: string;
}

export interface Preview {
  title: string;
  body: string;
  regions: string[];
  line: string | null;
  push: { title: string; body: string; urgent: boolean } | null;
  discord: { text: string } | null;
  zones: string[];
}

const checked = (on: boolean) => (on ? html`checked` : "");
const selected = (on: boolean) => (on ? html`selected` : "");

function check(name: string, label: string, on: boolean, hint = ""): Html {
  return html`<div class="canccu-field canccu-field--check">
    <input
      class="canccu-check"
      type="checkbox"
      id="${name}"
      name="${name}"
      value="true"
      ${checked(on)}
    />
    <label class="canccu-field__label" for="${name}"
      >${label}${hint === "" ? "" : html` <span class="canccu-muted canccu-small">${hint}</span>`}</label
    >
  </div>`;
}

function radio(name: string, value: string, label: string, on: boolean): Html {
  return html`<label class="moments-choice"
    ><input type="radio" name="${name}" value="${value}" ${checked(on)} /> ${label}</label
  >`;
}

function templateChips(templates: Template[], current: string, item: string): Html {
  const q = (key: string) =>
    `${PREFIX}announce?template=${encodeURIComponent(key)}${item === "" ? "" : `&item=${encodeURIComponent(item)}`}`;
  const chip = (key: string, name: string) =>
    html`<a
      class="canccu-chip"
      href="${q(key)}"
      aria-current="${key === current ? "true" : "false"}"
      >${name}</a
    >`;
  return html`<nav class="canccu-chips canccu-chips--scroll" aria-label="Templates">
    ${templates.map((t) => chip(t.key, t.name))}${chip("", "Blank")}
  </nav>`;
}

export function composerForm(o: {
  state: ComposerState;
  templates: Template[];
  zones: string[];
  items: RunItem[];
  timeZone: string;
  canSaveTemplate: boolean;
  previewed: boolean;
}): Html {
  const s = o.state;
  const vars = freeVariables(s.title, s.body);
  const option = (v: string, label: string, on: boolean) =>
    html`<option value="${v}" ${selected(on)}>${label}</option>`;
  const durations = [300, 600, 900, 1800, 3600].map((d) =>
    option(String(d), `${String(d / 60)} min`, d === s.duration_seconds),
  );
  return html`<form class="canccu-form moments-form" method="post" action="${PREFIX}announce">
    ${formKey()}
    <input type="hidden" name="template_key" value="${s.template_key}" />
    <h2 class="canccu-card__title">New announcement</h2>
    ${templateChips(o.templates, s.template_key, s.item_id)}
    <div class="canccu-field">
      <label class="canccu-field__label" for="title">Title</label
      ><input
        class="canccu-input"
        id="title"
        name="title"
        maxlength="200"
        required
        value="${s.title}"
      />
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="body">Body (optional)</label
      ><textarea class="canccu-input" id="body" name="body" maxlength="400" rows="2">
${s.body}</textarea>
      <p class="canccu-small canccu-muted">
        Placeholders: {item.title}, {item.starts_at}, {item.starts_in}, {item.location},
        {event.name}, and any {name} of your own, filled below. At most 60 and 140 characters once
        filled.
      </p>
    </div>
    ${vars.map(
      (v) =>
        html`<div class="canccu-field">
          <label class="canccu-field__label" for="var_${v}">{${v}}</label
          ><input
            class="canccu-input"
            id="var_${v}"
            name="var_${v}"
            maxlength="60"
            value="${s.variables[v] ?? ""}"
          />
        </div>`,
    )}
    <div class="canccu-field">
      <label class="canccu-field__label" for="item_id">Run-of-show item (fills {item.…})</label>
      <select class="canccu-input" id="item_id" name="item_id">
        ${option("", "None", s.item_id === "")}
        ${o.items.map((i) => option(i.id, `${i.title} (${clock(i.starts_at, o.timeZone)})`, i.id === s.item_id))}
      </select>
    </div>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">Level</legend>
      ${radio("level", "info", "Info", s.level === "info")}
      ${radio("level", "urgent", "Urgent", s.level === "urgent")}
      <p class="canccu-small canccu-muted">
        Urgent: the warning colour, the screen's spotlight once, pushed in quiet hours. Emergency is
        on On air (hold 2 s).
      </p>
      ${check("full_screen", "Full screen", s.full_screen, "in the theme's look, where the screen is free")}
    </fieldset>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">Channels</legend>
      ${check("ch_screen", "Screen card", s.channels.screen, "rail, else ticker line")}
      ${check("ch_ticker", "Ticker line", s.channels.ticker, "until it ends")}
      ${check("ch_discord", "Discord channel", s.channels.discord, "posted by the bot from step 6")}
      ${check("ch_push", "Push to phones", s.channels.push, "the Announcements topic")}
    </fieldset>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">Zones (none ticked: every zone)</legend>
      ${o.zones.map((z) => check(`zone_${z}`, z, s.zones.includes(z)))}
    </fieldset>
    <fieldset class="moments-fieldset">
      <legend class="canccu-field__label">When</legend>
      ${radio("when", "now", "Now", s.when === "now")}
      ${radio("when", "at", "At a time", s.when === "at")}
      <input
        class="canccu-input"
        type="datetime-local"
        name="at_local"
        aria-label="At (event time)"
        value="${s.at_local}"
      />
      ${radio("when", "item", "With the run-of-show item, minutes before its start:", s.when === "item")}
      <input
        class="canccu-input moments-narrow"
        type="number"
        min="0"
        max="1440"
        name="minutes_before"
        aria-label="Minutes before"
        value="${String(s.minutes_before)}"
      />
      <p class="canccu-small canccu-muted">
        With an item it follows the item's delays; a cancelled item withdraws it.
      </p>
    </fieldset>
    <div class="canccu-field">
      <label class="canccu-field__label" for="duration">Shows for</label>
      <select class="canccu-input" id="duration" name="duration_seconds">
        ${durations}
      </select>
    </div>
    <div class="canccu-cluster">
      <button
        class="canccu-button canccu-button--${o.previewed ? "secondary" : "primary"}"
        type="submit"
        name="do"
        value="preview"
      >
        Preview
      </button>
      ${o.previewed ? html`<button class="canccu-button canccu-button--primary" type="submit" name="do" value="send">${s.when === "now" ? "Send" : "Schedule"}</button>` : ""}
      ${o.canSaveTemplate ? html`<button class="canccu-button canccu-button--ghost" type="submit" name="do" value="template">Save as template</button>` : ""}
    </div>
    <p class="canccu-small canccu-muted">Audited: who, what, when, every channel.</p>
  </form>`;
}

/** Each channel as it will go out, and the card in the real player (moments.js draws it). */
export function previewView(p: Preview, s: ComposerState, zone: string | undefined): Html {
  const card = {
    title: p.title,
    body: p.body,
    level: s.level,
    starts_at: new Date().toISOString(),
    updated: false,
    ticker_line: p.line,
  };
  const player =
    zone === undefined || p.regions.length === 0
      ? ""
      : html`<div class="moments-preview__frame">
            <iframe
              src="/screen/zones/${encodeURIComponent(zone)}"
              title="Preview of ${zone}"
              data-announce-preview
              data-zone="${zone}"
              data-card="${JSON.stringify(card)}"
              data-chain="${JSON.stringify(p.regions)}"
              data-line="${p.line ?? ""}"
              data-urgent="${s.level === "urgent" ? "true" : ""}"
            ></iframe>
          </div>
          <p class="canccu-small canccu-muted" data-preview-note>
            The real player, with the event's theme, on ${zone}.
          </p>`;
  const row = (label: string, body: Html | string) =>
    html`<div class="moments-channel">
      <p class="moments-channel__label">${label}</p>
      ${body}
    </div>`;
  return html`<section class="canccu-card moments-preview" aria-label="Preview">
    <h2 class="canccu-card__title">Preview</h2>
    ${player}
    ${
      p.regions.length > 0
        ? row(
            "Screen card",
            html`<p><strong>${p.title}</strong> ${p.body}</p>
              <p class="canccu-small canccu-muted">${p.regions.join(" → ")}</p>`,
          )
        : ""
    }
    ${p.line === null ? "" : row("Ticker line", html`<p>${p.line}</p>`)}
    ${
      p.discord === null
        ? ""
        : row(
            "Discord",
            html`<p class="moments-pre">${p.discord.text}</p>
              <p class="canccu-small canccu-muted">Posted by the bot from step 6.</p>`,
          )
    }
    ${
      p.push === null
        ? ""
        : row(
            "Push",
            html`<p><strong>${p.push.title}</strong> ${p.push.body}</p>
              <p class="canccu-small canccu-muted">
                ${p.push.urgent ? "Urgent: delivered in quiet hours, over the cap." : "Held in quiet hours and over the cap."}
              </p>`,
          )
    }
    ${row(
      "Who hears about it",
      html`<p>
        ${String(p.zones.length)} zone${p.zones.length === 1 ? "" : "s"}
        (${p.zones.join(", ")})${p.discord === null ? "" : " · the Discord channel"}${p.push === null ? "" : " · phones that follow Announcements"}
      </p>`,
    )}
  </section>`;
}

export const flash = (done?: string, error?: string): Html | string =>
  error
    ? notice({ kind: "down", title: "Not sent", text: error })
    : done
      ? notice({ kind: "ok", title: done })
      : "";

export function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}
