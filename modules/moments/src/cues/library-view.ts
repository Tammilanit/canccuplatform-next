/**
 * The sound desk's Library (#626, the step 4 polish sheets 03 and 04; D23): one upload button with
 * a drop area and the rules in words, then the sounds A to Z by title in the shared card grid
 * (docs/design/grids/03-sound-library.svg), each with its themed player, licence and the cues
 * that use it by name. The page's script uploads the file to Screen, then links it.
 */
import type { Html } from "@canccu/ui";
import { html } from "@canccu/ui";
import { PREFIX } from "../page-kit.js";
import { player } from "./controls.js";
import { cueTitle } from "./names.js";
import type { LibraryView } from "./views.js";

const cuesOf = (n: number): string =>
  n === 0 ? "no cue" : `${String(n)} cue${n === 1 ? "" : "s"}`;

/** "Tournament starts, Finals start +1": the first two by name, then how many more. */
const usedBy = (names: string[]): string =>
  names.length === 0
    ? "Not used by a cue yet"
    : `${names.slice(0, 2).map(cueTitle).join(", ")}${names.length > 2 ? ` +${String(names.length - 2)}` : ""}`;

function soundCard(l: LibraryView, canWrite: boolean): Html {
  const menu =
    canWrite && l.source === "upload"
      ? html`<details class="moments-menu moments-menu--end">
          <summary class="moments-menu__more" aria-label="More for ${l.title}">⋯</summary>
          <div class="moments-menu__list">
            <form method="post" action="${PREFIX}cues/library/${l.id}/remove">
              <button class="moments-menu__item" type="submit">Remove</button>
            </form>
          </div>
        </details>`
      : "";
  return html`<li class="moments-sound">
    ${player({ id: l.id, title: l.title, url: l.url, length_ms: l.length_ms })}
    <div class="moments-sound__meta">
      <p class="canccu-small canccu-muted">
        ${l.source === "pack" ? "Default pack · CC0" : "Uploaded"} · ${cuesOf(l.used_by.length)}
        <br />${usedBy(l.used_by)}
      </p>
      ${menu}
    </div>
    ${l.warning === null ? "" : html`<p class="canccu-small moments-warning">⚠ ${l.warning}</p>`}
  </li>`;
}

export function libraryView(o: { library: LibraryView[]; canWrite: boolean }): Html {
  // The upload: the file input is the button; a drop on the area picks the file the same way.
  const upload = o.canWrite
    ? html`<form
        class="moments-drop"
        method="post"
        action="${PREFIX}cues/library"
        data-upload-sound
      >
        <input type="hidden" name="asset_id" value="" />
        <label class="canccu-button canccu-button--secondary moments-drop__button"
          >↑ Upload a sound<input
            class="moments-said"
            type="file"
            name="file"
            accept="audio/mpeg,audio/ogg,.mp3,.ogg"
        /></label>
        <p class="canccu-small">
          Or drop MP3 or OGG files here.<br /><span class="canccu-muted"
            >At most 30 s and 1 MiB each; a warning over 10 s. The default pack is CC0, with a
            credits file.</span
          >
        </p>
        <noscript
          ><span class="canccu-small canccu-muted"
            >Uploading needs the page's script.</span
          ></noscript
        >
      </form>`
    : "";
  const n = o.library.length;
  return html`${upload}
    <p class="canccu-small canccu-muted moments-sounds__count">
      ${String(n)} sound${n === 1 ? "" : "s"} · A to Z
    </p>
    <ul class="canccu-grid moments-sounds">
      ${[...o.library]
        .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }))
        .map((l) => soundCard(l, o.canWrite))}
    </ul>`;
}
