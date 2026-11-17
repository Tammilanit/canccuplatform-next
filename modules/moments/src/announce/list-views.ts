/**
 * Beside the composer (mockup 05): the live and scheduled announcements with Edit and Withdraw
 * (one tap), the ended ones folded away, the event's own templates; and the edit form, which
 * changes a live one in place (L13).
 */
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { PREFIX, formKey } from "../page-kit.js";
import type { Level } from "./store.js";
import type { Template } from "./templates.js";
import { freeVariables } from "./text.js";

export interface Listed {
  id: string;
  status: string;
  title: string;
  level: Level;
  /** "3:12 left", "at 20:15", "with Breakfast · 07:45". */
  when: string;
}

export function listView(o: {
  listed: Listed[];
  canWrite: boolean;
  templates: Template[];
  canDeleteTemplates: boolean;
}): Html {
  const open = o.listed.filter((a) => a.status === "live" || a.status === "scheduled");
  const done = o.listed.filter((a) => a.status !== "live" && a.status !== "scheduled");
  const item = (a: Listed) =>
    html`<li class="moments-row">
      <div>
        <strong>${a.title}</strong>
        <span class="canccu-small canccu-muted"
          >${a.level === "urgent" ? "urgent · " : ""}${a.status} · ${a.when}</span
        >
      </div>
      ${
        o.canWrite && (a.status === "live" || a.status === "scheduled")
          ? html`<div class="canccu-cluster">
              <a
                class="canccu-button canccu-button--ghost canccu-button--sm"
                href="${PREFIX}announce?edit=${a.id}"
                >Edit</a
              >
              <form method="post" action="${PREFIX}announce/${a.id}/withdraw">
                ${formKey()}<button
                  class="canccu-button canccu-button--secondary canccu-button--sm"
                  type="submit"
                >
                  Withdraw
                </button>
              </form>
            </div>`
          : ""
      }
    </li>`;
  const own = o.templates.filter((t) => !t.builtin);
  return html`<section class="canccu-card">
      <h2 class="canccu-card__title">Live and scheduled</h2>
      ${
        open.length === 0
          ? html`<p class="canccu-muted canccu-small">Nothing live or scheduled.</p>`
          : html`<ul class="moments-list">
              ${open.map(item)}
            </ul>`
      }
      ${
        done.length === 0
          ? ""
          : html`<details>
              <summary class="canccu-small">Ended and withdrawn</summary>
              <ul class="moments-list">
                ${done.map(item)}
              </ul>
            </details>`
      }
    </section>
    ${
      own.length === 0
        ? ""
        : html`<section class="canccu-card">
            <h2 class="canccu-card__title">The event's templates</h2>
            <ul class="moments-list">
              ${own.map(
                (t) =>
                  html`<li class="moments-row">
                    <span>${t.name}</span>
                    ${o.canDeleteTemplates ? html`<form method="post" action="${PREFIX}announce/templates/${t.key}/delete"><button class="canccu-button canccu-button--ghost canccu-button--sm" type="submit">Delete</button></form>` : ""}
                  </li>`,
              )}
            </ul>
          </section>`
    }`;
}

export function editView(o: {
  id: string;
  status: string;
  title: string;
  body: string;
  variables: Record<string, string>;
}): Html {
  const vars = freeVariables(o.title, o.body);
  return html`<form
    class="canccu-form moments-form"
    method="post"
    action="${PREFIX}announce/${o.id}/edit"
  >
    ${formKey()}
    <h2 class="canccu-card__title">Edit announcement</h2>
    <p class="canccu-small canccu-muted">
      ${o.status === "live" ? "It changes in place on every screen, with an Updated chip and no new sound." : "It goes out with the new text when its time comes."}
    </p>
    <div class="canccu-field">
      <label class="canccu-field__label" for="title">Title</label
      ><input
        class="canccu-input"
        id="title"
        name="title"
        maxlength="200"
        required
        value="${o.title}"
      />
    </div>
    <div class="canccu-field">
      <label class="canccu-field__label" for="body">Body (optional)</label
      ><textarea class="canccu-input" id="body" name="body" maxlength="400" rows="2">
${o.body}</textarea>
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
            value="${o.variables[v] ?? ""}"
          />
        </div>`,
    )}
    <div class="canccu-cluster">
      <button class="canccu-button canccu-button--primary" type="submit">Save</button
      ><a class="canccu-button canccu-button--ghost" href="${PREFIX}announce">Cancel</a>
    </div>
  </form>`;
}

/** An ended or withdrawn one, opened from an old link: what went out, and no form to change it. */
export function closedView(o: {
  status: string;
  title: string;
  body: string;
  why: string | null;
}): Html {
  return html`<h2 class="canccu-card__title">Announcement</h2>
    <p class="canccu-small canccu-muted">
      This one is ${o.status}${o.why === null ? "" : html` · ${o.why}`}: it can no longer be
      changed.
    </p>
    <p><strong>${o.title}</strong></p>
    ${o.body === "" ? "" : html`<p>${o.body}</p>`}
    <div class="canccu-cluster">
      <a class="canccu-button canccu-button--ghost" href="${PREFIX}announce">Back</a>
    </div>`;
}
