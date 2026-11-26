/*
 * The Studio pages' controls (plan issue-185 D8, D10; issue-784 D3). Each `data-action` control
 * calls the JSON API, which checks every right itself. Make it yours and the gallery's looks save
 * without a reload: studio-live.js draws the page's parts again and the frames follow; a stale save
 * (409) says another organiser changed the draft and saves nothing over it. The other actions
 * reload, so the page shows the draft as stored, and a refusal is carried over the reload and said
 * in words, with no native dialog (brief N1).
 */
"use strict";

(() => {
  const NOTICE_KEY = "canccu-studio-notice";
  const root = document.querySelector(".canccu-studio");
  const notice = document.querySelector(".canccu-studio-notice");
  const IMAGE_EXTS = { png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp", svg: "svg" };

  const draftVersion = () => Number(root?.dataset.draftVersion) || undefined;

  function show(message) {
    if (notice === null) return;
    notice.textContent = message;
    notice.hidden = false;
  }

  const carried = sessionStorage.getItem(NOTICE_KEY);
  if (carried !== null) {
    sessionStorage.removeItem(NOTICE_KEY);
    show(carried);
  }

  function messageOf(data, status) {
    const error = data?.error;
    if (error === undefined) return `The request failed (${status}).`;
    // A right's id stays in the server log, never on the page (UX audit B3).
    if (error.code === "missing_right") {
      return "Your role doesn't include this. If you need it, ask an event owner to add it to your role.";
    }
    // In words: a file's name before its message, never a path into theme.yaml (UX audit C1).
    const problems = (error.problems ?? [])
      .filter((p) => p.severity === "error")
      .map((p) =>
        !p.path || p.path.startsWith("theme.yaml") ? p.message : `${p.path}: ${p.message}`,
      );
    return [error.message, ...problems].join(" ");
  }

  /** One API call; a JSON body, or a file's bytes as they are. Throws the API's message. */
  async function call(method, url, body, type) {
    const init = { method, headers: {}, credentials: "same-origin" };
    if (body instanceof Blob) {
      init.body = body;
      init.headers["content-type"] = type || body.type || "application/octet-stream";
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
    const res = await fetch(url, init);
    if (res.status === 204) return undefined;
    const data = await res.json().catch(() => undefined);
    if (!res.ok)
      throw Object.assign(new Error(messageOf(data, res.status)), { status: res.status });
    return data;
  }

  const query = (params) =>
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

  /** A package replaces the draft's content, or starts the draft when there is none. */
  function putPackage(zip) {
    const q = query({ draft_version: draftVersion() });
    return call("PUT", `/api/theming/draft/package${q ? `?${q}` : ""}`, zip, "application/zip");
  }

  /** The logo goes in first, at `images/logo.<ext>`, so the brand can name it. */
  async function uploadLogo(file, version) {
    const ext = IMAGE_EXTS[file.name.split(".").pop().toLowerCase()];
    if (ext === undefined) throw new Error("The logo must be a PNG, JPEG, WebP or SVG file.");
    const path = `images/logo.${ext}`;
    const q = query({ path, draft_version: version });
    const draft = await call("PUT", `/api/theming/draft/file?${q}`, file);
    const problem = draft.problems.find((p) => p.path === path && p.severity === "error");
    if (problem !== undefined) {
      // Take the refused file out again, or its error would block Publish with no page to remove it.
      const back = query({ path, draft_version: draft.draft_version });
      const after = await call("DELETE", `/api/theming/draft/file?${back}`);
      // The page is not read again, so the next save must name the version this one left.
      root.dataset.draftVersion = String(after.draft_version);
      throw new Error(`${path}: ${problem.message}`);
    }
    return { path, version: draft.draft_version };
  }

  /** The form's own check failed: nothing was sent, so the page stays with what was typed. */
  class Invalid extends Error {}
  /** The call went through, but the page must be read again whole. */
  class Reload extends Error {}

  async function saveBrand(form) {
    if (!form.reportValidity()) throw new Invalid("A colour is a # and six or eight hex digits.");
    const f = form.elements;
    let version = draftVersion();
    let logo = f.namedItem("logo")?.value;
    const fileInput = f.namedItem("logo_file");
    const file = fileInput.files[0];
    if (file !== undefined) {
      // Taken now: a save behind this one names the stored logo, and a refused file is never
      // uploaded again by the next change (the page no longer reloads).
      fileInput.value = "";
      ({ path: logo, version } = await uploadLogo(file, version));
      keepLogo(form, logo);
      root.dataset.draftVersion = String(version);
    }
    const icon = f.namedItem("icon")?.value;
    const embed = f.namedItem("embed_color").value.trim();
    const choices = window.canccuStudioChoices?.(form) ?? {};
    const saved = await call("PUT", "/api/theming/draft/brand", {
      draft_version: version,
      primary: f.namedItem("primary").value,
      accent: f.namedItem("accent").value,
      scheme: form.querySelector('input[name="scheme"]:checked')?.value ?? "dark",
      ...(logo ? { logo } : {}),
      ...(icon ? { icon } : {}),
      ...(embed ? { embed_color: embed } : {}),
      ...choices,
    });
    // A save queued behind this one sends the version this one made.
    root.dataset.draftVersion = String(saved.draft.draft_version);
  }

  /** The text font: a family the theme holds, or none for the system font. */
  async function saveFont(form) {
    const family = form.elements.namedItem("body").value;
    const saved = await call("PATCH", "/api/theming/draft/tokens", {
      draft_version: draftVersion(),
      tokens: { fonts: { body: family || null } },
    });
    root.dataset.draftVersion = String(saved.draft_version);
  }

  function keepLogo(form, path) {
    let field = form.elements.namedItem("logo");
    if (field === null) {
      field = Object.assign(document.createElement("input"), { type: "hidden", name: "logo" });
      form.prepend(field);
    }
    field.value = path;
  }

  /** The frames take a look as its apply is sent, and the draft's colours again if refused. */
  const look = (json) =>
    document.dispatchEvent(new CustomEvent("canccu-studio-look", { detail: JSON.parse(json) }));

  /** A look from the gallery, or Reset to the draft's own (plan issue-784 D11). */
  async function applyPreset(el) {
    const version = draftVersion();
    // Without a draft the reload below draws the frames.
    const live = version !== undefined && el.dataset.vars !== undefined;
    if (live) look(el.dataset.vars);
    const draft = await call("PUT", "/api/theming/draft/preset", {
      preset: el.dataset.preset,
      scheme: el.dataset.scheme,
      ...(version === undefined ? {} : { draft_version: version }),
    }).catch((err) => {
      if (live && root.dataset.vars !== undefined) look(root.dataset.vars);
      throw err;
    });
    el.closest("dialog")?.close();
    for (const b of document.querySelectorAll('[data-action="preset"][aria-pressed]'))
      b.setAttribute("aria-pressed", String(b === el));
    root.dataset.draftVersion = String(draft.draft_version);
    // Without a draft before, the page has none of a draft's parts yet; and Make it yours's form
    // still holds the old choices, which its next save would send back over the preset's.
    if (version === undefined || document.querySelector('form[data-action="brand"]') !== null)
      throw new Reload();
  }

  const ACTIONS = {
    start: () => call("POST", "/api/theming/draft", { from: "current" }),
    preset: applyPreset,
    import: (form) => putPackage(form.elements.namedItem("import").files[0]),
    publish: () => call("POST", "/api/theming/draft/publish", { draft_version: draftVersion() }),
    "font-system": (el) =>
      call("PATCH", "/api/theming/draft/tokens", {
        draft_version: draftVersion(),
        tokens: { fonts: { [el.dataset.token]: null } },
      }),
    discard: () => call("DELETE", `/api/theming/draft?${query({ draft_version: draftVersion() })}`),
    restore: (el) =>
      call("POST", `/api/theming/revisions/${el.dataset.revision}/restore`, {
        current_revision: Number(root.dataset.currentRevision),
      }),
    brand: saveBrand,
    font: saveFont,
    simple: () =>
      call("POST", "/api/theming/draft/mode", {
        draft_version: draftVersion(),
        mode: "simple",
        remove_advanced: true,
      }),
  };

  // Advanced's actions (studio-advanced.js) use the same calls, refusals and reloads.
  window.canccuStudio = { call, query, draftVersion, Invalid, Reload };
  /** An action of this page, or one another script of it adds (`autosave` and `live` as below). */
  const actionOf = (name) => ACTIONS[name] ?? window.canccuStudioActions?.[name];

  let busy = false;
  /** The forms that save as they change: the brand kit has no Save (UX audit C2). */
  const SAVES_AS_CHANGED = new Set([saveBrand, saveFont]);
  const autosaves = (action) => SAVES_AS_CHANGED.has(action) || action?.autosave === true;
  /** What saves without reloading the page: the frames follow it live (studio-live.js, D3). */
  const LIVE = new Set([saveBrand, saveFont, applyPreset]);
  /** Set once another organiser's change refused a save: nothing more is saved over it. */
  let conflicted = false;
  const AUTO = 'form[data-action="brand"], form[data-action="font"], form[data-autosave]';
  const autoSaved = () => [...document.querySelectorAll(AUTO)];
  // What the person set, not the stored logo's name a save puts in a hidden field.
  const valuesOf = (form) =>
    JSON.stringify(
      [...form.elements]
        .filter((el) => el.name !== "" && el.type !== "hidden" && el.type !== "file")
        .map((el) => (el.type === "radio" ? el.checked : el.value)),
    );
  /** Each form as last sent (or drawn): one that differs holds a change not saved yet. */
  const sent = new Map(autoSaved().map((form) => [form, valuesOf(form)]));
  const unsaved = (form) =>
    valuesOf(form) !== sent.get(form) ||
    [...form.elements].some((el) => el.type === "file" && el.files.length > 0);

  /** `true` when the action went through, else what stopped it. */
  async function attempt(action, el) {
    const before = sent.get(el);
    if (autosaves(action)) sent.set(el, valuesOf(el));
    try {
      await action(el);
      return true;
    } catch (err) {
      // Nothing was sent, so the form still holds its change: a later save's flush tries it again.
      if (err instanceof Invalid && autosaves(action)) sent.set(el, before);
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * The previews show the version the page drew, so Publish waits for the next save's refresh
   * (studio-live.js clears the hold). The hold is kept on the page, so a preview drawn meanwhile
   * (studio-previews.js) cannot release it.
   */
  function holdPublish() {
    root.dataset.previewStale = "1";
    for (const b of document.querySelectorAll('[data-action="publish"], [data-action="light-ask"]'))
      b.disabled = true;
    const hint = document.querySelector(".canccu-studio-publish-hint");
    if (hint !== null) hint.textContent = "Put the colour right to update the previews.";
  }

  async function run(el, control) {
    const action = actionOf(el.dataset.action);
    // A form changed while a save runs is saved after it, below.
    if (action === undefined || busy || conflicted) return;
    busy = true;
    control.disabled = true;
    const live = LIVE.has(action) || action.live === true;
    if (live) root.dataset.saveState = "saving";
    let outcome = await attempt(action, el);
    let saved = outcome === true;
    // Each form changed meanwhile or still being typed in is saved too, so nothing typed is lost;
    // after a failure the rest wait, so the first failure is the one said.
    while (outcome === true && autosaves(action)) {
      const form = autoSaved().find(unsaved);
      if (form === undefined) break;
      outcome = await attempt(actionOf(form.dataset.action), form);
      saved ||= outcome === true;
    }
    busy = false;
    control.disabled = false;
    if (outcome instanceof Invalid) {
      // A reload would drop the browser's message and the value it is about.
      show(outcome.message);
      if (saved) holdPublish();
      if (live) root.dataset.saveState = saved ? "saved" : "failed";
      return;
    }
    if (live && !(outcome instanceof Reload)) {
      if (outcome === true) return void document.dispatchEvent(new Event("canccu-studio-saved"));
      // Another organiser's change: say so, and save nothing over it (Review focus 2).
      if (outcome.status === 409) {
        conflicted = true;
        root.dataset.saveState = "conflict";
        return show(
          "Another organiser changed this draft meanwhile, so your last change was not saved. Reload the page to see theirs.",
        );
      }
      root.dataset.saveState = "failed";
      if (saved) document.dispatchEvent(new Event("canccu-studio-saved"));
      return show(outcome.message);
    }
    if (outcome !== true && !(outcome instanceof Reload))
      sessionStorage.setItem(NOTICE_KEY, outcome.message);
    location.reload();
  }

  /** studio-live.js found a version this page did not write: the same stop as a refused save. */
  document.addEventListener("canccu-studio-conflict", () => {
    conflicted = true;
    root.dataset.saveState = "conflict";
    show(
      "Another organiser changed this draft meanwhile, so your last change may not be the latest. Reload the page to see theirs.",
    );
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-action]");
    if (form === null) return;
    event.preventDefault();
    void run(form, event.submitter ?? form);
  });
  /** Controls that change only the page: they call no API and never reload. */
  const screenFigure = document.querySelector(".canccu-studio-preview--screen");
  const fullSize = (on) => screenFigure?.classList.toggle("canccu-studio-preview--full", on);
  const LOCAL = {
    "discard-ask": () => document.getElementById("canccu-studio-discard")?.showModal(),
    "light-ask": () => document.getElementById("canccu-studio-light")?.showModal(),
    "dialog-close": (el) => el.closest("dialog")?.close(),
    preview: () => fullSize(true),
    "reset-ask": () => document.getElementById("canccu-studio-reset")?.showModal(),
    // The plate check's one click (sheet 2): that plate, saved as any choice is.
    "plate-suggest": (el) => {
      const radio = document.querySelector(
        `input[name="plate_kind"][value="${CSS.escape(el.dataset.plate)}"]`,
      );
      if (radio === null) return;
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    },
    swatch: (el) => {
      const hex = document.querySelector(`input[name="${CSS.escape(el.dataset.swatchFor)}"]`);
      const swatch = document.querySelector(
        `input[data-hex-for="${CSS.escape(el.dataset.swatchFor)}"]`,
      );
      if (hex === null || swatch === null) return;
      hex.value = el.dataset.colour;
      swatch.value = el.dataset.colour;
      swatch.dispatchEvent(new Event("input", { bubbles: true }));
      hex.dispatchEvent(new Event("change", { bubbles: true }));
    },
    replace: () => {
      document.getElementById("canccu-studio-replace")?.close();
      if (pendingLook !== undefined) void run(pendingLook, pendingLook);
    },
    "preview-close": () => fullSize(false),
  };

  /** A look picked over the organiser's own CSS, fonts, templates or embeds waits for a yes (D11). */
  let pendingLook;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button === null) return;
    const local = LOCAL[button.dataset.action];
    if (local !== undefined) return local(button);
    if (
      button.dataset.action === "preset" &&
      root?.dataset.ownWork === "1" &&
      !button.closest("dialog")
    ) {
      pendingLook = button;
      return document.getElementById("canccu-studio-replace")?.showModal();
    }
    void run(button, button);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") fullSize(false);
  });

  // The brand kit has no Save: each finished change saves the brand and reloads its previews.
  document.addEventListener("change", (event) => {
    const file = event.target.closest(".canccu-studio-file");
    const shown = file?.closest(".canccu-field")?.querySelector(".canccu-studio-drop__name");
    if (shown && file.files[0]) shown.textContent = file.files[0].name;
    const imported = event.target.closest('form[data-action="import"]');
    if (imported !== null) return void run(imported, imported);
    // `.form`: Advanced's controls belong to their form by its id, wherever they are drawn.
    const form = event.target.form?.matches(AUTO) ? event.target.form : null;
    if (form === null) return;
    // Saved 400 ms after the last change, so a run of clicks is one save (D3).
    clearTimeout(form.canccuSave);
    form.canccuSave = setTimeout(() => void run(form, form), 400);
  });
})();
