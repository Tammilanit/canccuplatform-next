/** The history page (plan issue-185 D8): newest first, restore and export. */
import { attrs, html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { STUDIO, actionButton } from "./studio-views.js";

interface RevisionSummary {
  revision: number;
  name?: string;
  mode: string;
  published_at: string;
  actor_user_id: string | null;
  restored_from?: number;
  pinned: boolean;
}

/** `list` holds up to `pageSize + 1` rows; the extra one only says that older revisions exist. */
export function historyView(
  list: { current_revision: number; revisions: Record<string, unknown>[] },
  pageSize: number,
  before: number | undefined,
): Html {
  const current = list.current_revision;
  const all = list.revisions as unknown as RevisionSummary[];
  const revisions = all.slice(0, pageSize);
  const rows = revisions.map((r) => {
    const restore =
      r.revision === current
        ? html`<strong>On every screen</strong>`
        : actionButton("Restore", {
            "data-action": "restore",
            "data-revision": String(r.revision),
          });
    return html`<li class="canccu-studio-revision"><span class="canccu-studio-revision__title">Revision ${r.revision}</span> ${r.name ?? ""} · ${r.mode} · <time${attrs({ datetime: r.published_at })}>${r.published_at.slice(0, 16).replace("T", " ")}</time>${r.actor_user_id === null ? "" : ` · ${r.actor_user_id}`}${r.restored_from === undefined ? "" : ` · restored from ${r.restored_from}`}${r.pinned ? html` · <span class="canccu-badge canccu-badge--degraded">Pinned</span>` : ""}
<span class="canccu-studio-row">${restore} <a${attrs({ href: `/api/theming/revisions/${r.revision}/package` })}>Export</a></span></li>`;
  });
  const last = revisions.at(-1);
  const more =
    all.length > pageSize && last !== undefined
      ? html`<p><a${attrs({ href: `${STUDIO}history?before=${last.revision}` })}>Older revisions</a></p>`
      : "";
  const empty =
    before === undefined
      ? html`<p>Nothing published yet: screens show the event profile's look.</p>`
      : html`<p>No older revisions. <a href="${STUDIO}history">Newest revisions</a></p>`;
  return html`<div class="canccu-studio" ${attrs({ "data-current-revision": current })}>
    ${
      revisions.length === 0
        ? empty
        : html`<p>
              Restore publishes a copy of an earlier revision as a new one; history only grows. The
              last 20 revisions are kept, and every pinned one.
            </p>
            <ol class="canccu-studio-revisions">
              ${rows}
            </ol>`
    }${more}
  </div>`;
}
