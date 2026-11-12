/*
 * The Content page's uploads (#263; mockup 10), on studio.js's helpers. Files dropped or chosen
 * are checked by name first (`name-check`); a same-named asset of the file's kind may be replaced,
 * never without the person's choice (studio-replace-plan.js). Each file then uploads on its own,
 * with its progress and, when refused, the API's own words. Also: the event's storage use, a
 * card's replace and adding a web or YouTube link. Every change goes through the JSON API.
 */
import { replacePlan } from "./studio-replace-plan.js";

const { api, failure, reloadWith, say, show } = window.canccuStudio;
const ASSETS = "/api/screen/assets";

/** 412 MB: binary units, one decimal under 10, as the page's server-drawn sizes. */
function size(bytes) {
  const units = [
    ["size.gb", 2 ** 30],
    ["size.mb", 2 ** 20],
    ["size.kb", 2 ** 10],
  ];
  for (const [key, unit] of units) {
    const n = bytes / unit;
    if (n >= 1) return say(key, { n: n < 10 ? Math.round(n * 10) / 10 : Math.round(n) });
  }
  return say("size.b", { n: bytes });
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

// The event's storage across its modules (contracts/tenants.md, Storage quota): left hidden when
// tenants cannot answer, rather than showing a wrong number.
const storage = document.querySelector("[data-storage]");
if (storage) {
  fetch(storage.dataset.storage, { credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s || !(s.quota_bytes > 0)) return;
      storage.querySelector("span").textContent = say("storage.used", {
        used: size(s.used_bytes),
        quota: size(s.quota_bytes),
      });
      // The share used; CSS keeps a sliver visible, so a little use never reads as none.
      const percent = Math.min(100, (s.used_bytes / s.quota_bytes) * 100);
      storage.querySelector("[role=meter]").setAttribute("aria-valuenow", percent.toFixed(1));
      storage.querySelector(".canccu-studio-storage__fill").style.width = `${percent}%`;
      storage.hidden = false;
    })
    .catch(() => {});
}

/** The words for a refused upload: the page's own for size and quota, else the API's message. */
function refusal(status, data) {
  const code = data?.error?.code;
  if (status === 0) return say("upload.failed");
  if (code === "storage_quota_exceeded") return say("upload.quota");
  if (code === "file_too_large" || status === 413) return say("upload.too_large");
  if (status >= 500 || !data?.error?.message) return say("error.failed");
  return say("upload.refused", { message: data.error.message });
}

/** One multipart upload with its progress; resolves with the status and the answer. */
function send(url, file, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.upload.addEventListener("load", () => onProgress(null));
    const done = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      resolve({ status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.addEventListener("load", done);
    xhr.addEventListener("error", done);
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
}

const drop = document.querySelector("[data-upload]");
if (drop) {
  const input = drop.querySelector("[data-upload-input]");
  const planBox = drop.querySelector("[data-upload-plan]");
  const list = drop.querySelector("[data-upload-list]");
  const index = JSON.parse(document.getElementById("canccu-studio-assets")?.textContent || "{}");
  let busy = false;

  /** Same-named assets per file, by `name-check` (at most 100 names a call). */
  async function matchesOf(files) {
    const out = [];
    for (let i = 0; i < files.length; i += 100) {
      const names = files.slice(i, i + 100).map((f) => f.name);
      const r = await api("POST", `${ASSETS}/name-check`, { names });
      if (!r.ok) throw r;
      for (const result of r.data.results) {
        // An asset added since this page was drawn is not in the index: never a replace target.
        out.push(
          result.asset_ids.map((id) => ({
            id,
            kind: index[id]?.[0] ?? null,
            used: index[id]?.[1] ?? false,
          })),
        );
      }
    }
    return out;
  }

  async function upload(files, plan) {
    busy = true;
    planBox.hidden = true;
    list.hidden = false;
    list.replaceChildren();
    const rows = files.map((file) => {
      const status = el("span", { className: "canccu-small canccu-muted" }, say("upload.waiting"));
      const bar = el("progress", { max: 100, value: 0 });
      const row = el(
        "li",
        {},
        el("span", { className: "canccu-studio-uploads__name" }, file.name),
        bar,
        status,
      );
      list.append(row);
      return { status, bar, row };
    });
    let added = 0;
    for (const [i, file] of files.entries()) {
      const { status, bar, row } = rows[i];
      const target = plan[i].replaceId;
      const url = target ? `${ASSETS}/${encodeURIComponent(target)}/replace` : ASSETS;
      const r = await send(url, file, (percent) => {
        if (percent === null) {
          bar.removeAttribute("value");
          status.textContent = say("upload.checking");
        } else {
          bar.value = percent;
          status.textContent = say("upload.sending", { percent });
        }
      });
      bar.remove();
      if (r.ok) {
        added += 1;
        status.textContent = say(target ? "upload.replaced" : "upload.added");
      } else {
        row.classList.add("canccu-studio-uploads__refused");
        status.textContent = refusal(r.status, r.data);
      }
    }
    busy = false;
    const refused = files.length - added;
    if (refused === 0) {
      return reloadWith(say(added === 1 ? "upload.all_done.one" : "upload.all_done", { added }));
    }
    const again = el(
      "button",
      { type: "button", className: "canccu-button canccu-button--secondary canccu-button--sm" },
      say("upload.show"),
    );
    again.addEventListener("click", () => location.reload());
    list.append(el("li", {}, say("upload.summary", { added, refused }), " ", again));
  }

  /** Same-named files: keep both or replace, per file and for all at once, then upload. */
  function ask(files, matches) {
    const state = { choice: "keep", own: {} };
    const draw = () => {
      const plan = replacePlan({ files, matches, choice: state.choice, own: state.own });
      const rows = plan.flatMap((entry, i) => {
        if (!entry.conflict) return [];
        const row = el("li", {}, el("p", {}, say("upload.same_name", { name: entry.name })));
        if (!entry.canReplace) {
          row.append(
            el(
              "p",
              { className: "canccu-small canccu-muted" },
              say(entry.reason === "batch" ? "upload.reason_batch" : "upload.reason_kind"),
            ),
          );
          return [row];
        }
        const pick = (choice) => {
          const id = `canccu-studio-plan-${i}-${choice}`;
          const radio = el("input", {
            type: "radio",
            name: `plan-${i}`,
            id,
            checked:
              choice === (entry.choice === "replace" || entry.needsPick ? "replace" : "keep"),
          });
          radio.addEventListener("change", () => {
            state.own[i] = { choice, assetId: state.own[i]?.assetId };
            draw();
          });
          return el(
            "label",
            { className: "canccu-studio-choice", htmlFor: id },
            radio,
            say(choice === "keep" ? "upload.keep" : "upload.replace"),
          );
        };
        row.append(
          el("div", { className: "canccu-studio-choices" }, pick("keep"), pick("replace")),
        );
        if (entry.eligible.length > 1 && (entry.choice === "replace" || entry.needsPick)) {
          const select = el(
            "select",
            { className: "canccu-input", ariaLabel: say("upload.pick") },
            el("option", { value: "" }, say("upload.pick")),
          );
          for (const m of entry.eligible) {
            const title = document.querySelector(`#asset-${CSS.escape(m.id)} h3`)?.textContent;
            select.append(
              el("option", { value: m.id, selected: m.id === entry.replaceId }, title || m.id),
            );
          }
          select.addEventListener("change", () => {
            state.own[i] = { choice: "replace", assetId: select.value || undefined };
            draw();
          });
          row.append(select);
          if (entry.needsPick)
            row.append(el("p", { className: "canccu-small" }, say("upload.pick_one")));
        }
        if (entry.onlyOneUsed)
          row.append(
            el("p", { className: "canccu-small canccu-muted" }, say("upload.only_one_used")),
          );
        return [row];
      });
      const controls = el("div", { className: "canccu-cluster" });
      if (rows.length > 1) {
        const all = el("input", { type: "checkbox", checked: state.choice === "replace" });
        all.addEventListener("change", () => {
          state.choice = all.checked ? "replace" : "keep";
          state.own = {};
          draw();
        });
        controls.append(
          el("label", { className: "canccu-field--check" }, all, " ", say("upload.replace_all")),
        );
      }
      const start = el(
        "button",
        {
          type: "button",
          className: "canccu-button canccu-button--primary",
          disabled: plan.some((e) => e.needsPick),
        },
        say("upload.start"),
      );
      start.addEventListener("click", () => upload(files, plan));
      const cancel = el(
        "button",
        { type: "button", className: "canccu-button canccu-button--ghost" },
        say("upload.cancel"),
      );
      cancel.addEventListener("click", () => (planBox.hidden = true));
      controls.append(start, cancel);
      planBox.replaceChildren(
        el("ul", { className: "canccu-studio-plan__list" }, ...rows),
        controls,
      );
      planBox.hidden = false;
    };
    draw();
  }

  async function take(fileList) {
    const files = [...fileList];
    if (busy || files.length === 0) return;
    let matches;
    try {
      matches = await matchesOf(files);
    } catch (r) {
      return show(failure(r));
    }
    const plan = replacePlan({ files, matches, choice: "keep" });
    if (plan.some((e) => e.conflict)) ask(files, matches);
    else upload(files, plan);
  }

  input.addEventListener("change", () => {
    take(input.files);
    input.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add("canccu-is-active");
    });
  }
  drop.addEventListener("dragleave", () => drop.classList.remove("canccu-is-active"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("canccu-is-active");
    const files = e.dataTransfer?.files ?? [];
    // A link dragged in from a browser tab goes to the band's link field, for its title.
    const url = files.length === 0 ? e.dataTransfer?.getData("text/uri-list").split("\n")[0] : "";
    const field = drop.querySelector("[data-add-link] [name=url]");
    if (url && field) {
      field.value = url.trim();
      return drop.querySelector("[data-add-link] [name=title]").focus();
    }
    take(files);
  });
}

// A card's replace: the new file with its progress in the card, then the page again.
document.addEventListener("change", async (event) => {
  const input = event.target.closest?.("input[data-replace]");
  if (!input || input.files.length === 0) return;
  const id = input.dataset.replace;
  const status = document.querySelector(`#asset-${CSS.escape(id)} [data-asset-status]`);
  const r = await send(`${ASSETS}/${encodeURIComponent(id)}/replace`, input.files[0], (percent) => {
    if (status) status.textContent = say("asset.replacing", { percent: percent ?? 100 });
  });
  input.value = "";
  if (r.ok) return reloadWith(say("asset.replaced"));
  show(refusal(r.status, r.data));
});

// A sound's play button: one sound at a time, the button saying Stop while it plays.
let playing = null;
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("button[data-play]");
  if (!button) return;
  const was = playing;
  if (was) {
    was.audio.pause();
    was.button.textContent = say("sound.play");
    playing = null;
  }
  if (was?.button === button) return;
  const audio = new window.Audio(button.dataset.play);
  audio.addEventListener("ended", () => {
    button.textContent = say("sound.play");
    if (playing?.audio === audio) playing = null;
  });
  audio.play().catch(() => (button.textContent = say("sound.play")));
  button.textContent = say("sound.stop");
  playing = { audio, button };
});

// A web page or YouTube video: one call, then the page again.
const link = document.querySelector("form[data-add-link]");
if (link) {
  link.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = new FormData(link);
    const body = {
      kind: f.get("kind"),
      url: String(f.get("url")).trim(),
      title: String(f.get("title")).trim(),
    };
    const r = await api("POST", ASSETS, body);
    if (!r.ok) return show(failure(r));
    reloadWith(say("link.added"));
  });
}
