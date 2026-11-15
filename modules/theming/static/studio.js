/*
 * The Studio pages' controls (plan issue-185 D8, D10). Each `data-action` control calls the JSON
 * API, which checks every right itself; the page then reloads, so it always shows the draft as
 * stored. A refusal is carried over the reload and said in words: after a conflict the page is the
 * one to read again, with no native dialog (brief N1). The brand kit saves as it changes, so its
 * previews follow the form (UX audit C2).
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
    if (!res.ok) throw new Error(messageOf(data, res.status));
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
      await call("DELETE", `/api/theming/draft/file?${back}`);
      throw new Error(`${path}: ${problem.message}`);
    }
    return { path, version: draft.draft_version };
  }

  /** The form's own check failed: nothing was sent, so the page stays with what was typed. */
  class Invalid extends Error {}

  async function saveBrand(form) {
    if (!form.reportValidity()) throw new Invalid("A colour is a # and six or eight hex digits.");
    const f = form.elements;
    let version = draftVersion();
    let logo = f.namedItem("logo")?.value;
    const fileInput = f.namedItem("logo_file");
    const file = fileInput.files[0];
    if (file !== undefined) {
      ({ path: logo, version } = await uploadLogo(file, version));
      // A save queued behind this one names the stored logo instead of uploading it again.
      fileInput.value = "";
      keepLogo(form, logo);
      root.dataset.draftVersion = String(version);
    }
    const icon = f.namedItem("icon")?.value;
    const embed = f.namedItem("embed_color").value.trim();
    const saved = await call("PUT", "/api/theming/draft/brand", {
      draft_version: version,
      primary: f.namedItem("primary").value,
      accent: f.namedItem("accent").value,
      scheme: form.querySelector('input[name="scheme"]:checked')?.value ?? "dark",
      ...(logo ? { logo } : {}),
      ...(icon ? { icon } : {}),
      ...(embed ? { embed_color: embed } : {}),
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

  /** Only what changed: sending a token unchanged would still make the theme advanced. */
  async function saveTokens(form) {
    const tokens = {};
    for (const el of form.elements) {
      if (el.name === "" || el.type === "submit") continue;
      const changed =
        el instanceof HTMLSelectElement
          ? !el.selectedOptions[0]?.defaultSelected
          : el.value !== el.defaultValue;
      if (!changed) continue;
      if (el.name === "motion") {
        tokens.motion = el.value;
        continue;
      }
      const [group, name] = el.name.split(".");
      tokens[group] = { ...tokens[group], [name]: el.value.trim() };
    }
    if (Object.keys(tokens).length === 0) throw new Error("Nothing changed.");
    await call("PATCH", "/api/theming/draft/tokens", { draft_version: draftVersion(), tokens });
  }

  async function starter(name) {
    const res = await fetch(`/theming/studio/starters/${encodeURIComponent(name)}.zip`, {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`The starting point ${name} could not be read.`);
    await putPackage(await res.blob());
  }

  const ACTIONS = {
    start: () => call("POST", "/api/theming/draft", { from: "current" }),
    starter: (el) => starter(el.dataset.starter),
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
    tokens: saveTokens,
    package: (form) => putPackage(form.elements.namedItem("package").files[0]),
    simple: () =>
      call("POST", "/api/theming/draft/mode", {
        draft_version: draftVersion(),
        mode: "simple",
        remove_advanced: true,
      }),
  };

  let busy = false;
  /** The forms that save as they change: the brand kit has no Save (UX audit C2). */
  const SAVES_AS_CHANGED = new Set([saveBrand, saveFont]);
  const autoSaved = () => [
    ...document.querySelectorAll('form[data-action="brand"], form[data-action="font"]'),
  ];
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

  /** `true` when the action went through; a refusal is carried over the reload. */
  async function attempt(action, el) {
    const before = sent.get(el);
    if (SAVES_AS_CHANGED.has(action)) sent.set(el, valuesOf(el));
    try {
      await action(el);
      return true;
    } catch (err) {
      if (err instanceof Invalid) {
        // Nothing was sent, so the form still holds its change: a later save's flush tries it
        // again rather than reload over it.
        if (SAVES_AS_CHANGED.has(action)) sent.set(el, before);
        return err;
      }
      sessionStorage.setItem(NOTICE_KEY, err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * The previews show the version the page drew, so Publish waits for the reload. The hold is kept
   * on the page, so a preview drawn later (studio-previews.js) cannot release it.
   */
  function holdPublish() {
    root.dataset.previewStale = "1";
    for (const b of document.querySelectorAll('[data-action="publish"], [data-action="light-ask"]'))
      b.disabled = true;
    const hint = document.querySelector(".canccu-studio-publish-hint");
    if (hint !== null) hint.textContent = "Put the colour right to update the previews.";
  }

  async function run(el, control) {
    const action = ACTIONS[el.dataset.action];
    // A form changed while a save runs is saved after it, below.
    if (action === undefined || busy) return;
    busy = true;
    control.disabled = true;
    let outcome = await attempt(action, el);
    let saved = outcome === true;
    // Before the reload, each form changed meanwhile or still being typed in, so nothing typed is
    // lost; after a failure the rest wait, so the first failure is the one said.
    while (outcome === true && SAVES_AS_CHANGED.has(action)) {
      const form = autoSaved().find(unsaved);
      if (form === undefined) break;
      outcome = await attempt(ACTIONS[form.dataset.action], form);
      saved ||= outcome === true;
    }
    if (outcome instanceof Invalid) {
      // A reload would drop the browser's message and the value it is about.
      show(outcome.message);
      if (saved) holdPublish();
      busy = false;
      control.disabled = false;
      return;
    }
    location.reload();
  }

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
    "preview-close": () => fullSize(false),
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button === null) return;
    const local = LOCAL[button.dataset.action];
    if (local !== undefined) local(button);
    else void run(button, button);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") fullSize(false);
  });

  /* A colour's swatch and its hex field show the same colour. */
  const hexOf = (swatch) => swatch.form?.elements.namedItem(swatch.dataset.hexFor);
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (el.matches("input[data-hex-for]")) {
      const hex = hexOf(el);
      if (hex) hex.value = el.value;
    } else if (el.matches(".canccu-studio-colour__hex") && /^#[0-9a-fA-F]{6}/.test(el.value)) {
      const swatch = el.form?.querySelector(`input[data-hex-for="${CSS.escape(el.name)}"]`);
      if (swatch) swatch.value = el.value.slice(0, 7).toLowerCase();
    }
  });
  /*
   * The logo's drop box takes a dropped file as if it were chosen: left to the browser, a drop opens
   * the file and leaves the Studio.
   */
  document.addEventListener("dragover", (event) => {
    if (event.target.closest(".canccu-studio-drop") !== null) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    const box = event.target.closest(".canccu-studio-drop");
    if (box === null) return;
    event.preventDefault();
    const input = document.getElementById(box.htmlFor);
    const files = event.dataTransfer?.files;
    if (input === null || !files || files.length === 0) return;
    input.files = files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // The brand kit has no Save: each finished change saves the brand and reloads its previews.
  document.addEventListener("change", (event) => {
    const file = event.target.closest(".canccu-studio-file");
    const shown = file?.closest(".canccu-field")?.querySelector(".canccu-studio-drop__name");
    if (shown && file.files[0]) shown.textContent = file.files[0].name;
    const form = event.target.closest('form[data-action="brand"], form[data-action="font"]');
    if (form !== null) void run(form, form);
  });

  /*
   * On a phone Preview and Publish share a row above the bottom bar (sheet 6); it hides while the
   * page moves, so the form gets the height, and comes back when it stops.
   */
  const pendbar = document.querySelector(".canccu-studio-pendbar");
  const tabbar = document.querySelector(".canccu-tabbar");
  if (pendbar !== null) {
    const above = () =>
      pendbar.style.setProperty("--canccu-studio-bar", `${tabbar?.offsetHeight ?? 0}px`);
    above();
    addEventListener("resize", above);
    let still;
    addEventListener(
      "scroll",
      () => {
        pendbar.classList.add("canccu-studio-pendbar--moving");
        clearTimeout(still);
        still = setTimeout(() => pendbar.classList.remove("canccu-studio-pendbar--moving"), 400);
      },
      { passive: true },
    );
  }
})();
