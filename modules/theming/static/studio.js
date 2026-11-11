/*
 * The Studio pages' controls (plan issue-185 D8, D10). Each `data-action` control calls the JSON
 * API, which checks every right itself; the page then reloads, so it always shows the draft as
 * stored. A refusal is carried over the reload and said in words: after a conflict the page is the
 * one to read again, with no native dialog (brief N1).
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
    const problems = (error.problems ?? [])
      .filter((p) => p.severity === "error")
      .map((p) => `${p.path}: ${p.message}`);
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
    if (problem !== undefined) throw new Error(`${path}: ${problem.message}`);
    return { path, version: draft.draft_version };
  }

  async function saveBrand(form) {
    const f = form.elements;
    let version = draftVersion();
    let logo = f.namedItem("logo")?.value;
    const file = f.namedItem("logo_file").files[0];
    if (file !== undefined) ({ path: logo, version } = await uploadLogo(file, version));
    const icon = f.namedItem("icon")?.value;
    const embed = f.namedItem("embed_color").value.trim();
    await call("PUT", "/api/theming/draft/brand", {
      draft_version: version,
      primary: f.namedItem("primary").value,
      accent: f.namedItem("accent").value,
      scheme: form.querySelector('input[name="scheme"]:checked')?.value ?? "dark",
      ...(logo ? { logo } : {}),
      ...(icon ? { icon } : {}),
      ...(embed ? { embed_color: embed } : {}),
    });
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
    discard: () => call("DELETE", `/api/theming/draft?${query({ draft_version: draftVersion() })}`),
    restore: (el) =>
      call("POST", `/api/theming/revisions/${el.dataset.revision}/restore`, {
        current_revision: Number(root.dataset.currentRevision),
      }),
    brand: saveBrand,
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
  async function run(el, control) {
    const action = ACTIONS[el.dataset.action];
    if (action === undefined || busy) return;
    busy = true;
    control.disabled = true;
    try {
      await action(el);
    } catch (err) {
      sessionStorage.setItem(NOTICE_KEY, err instanceof Error ? err.message : String(err));
    }
    location.reload();
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-action]");
    if (form === null) return;
    event.preventDefault();
    void run(form, event.submitter ?? form);
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button === null) return;
    void run(button, button);
  });

  /*
   * Publishing changed CSS needs its preview first (D10): the button waits until every preview
   * frame shows this draft version as a surface page. A frame may finish before this script runs.
   */
  const held = document.querySelector("[data-needs-preview]");
  if (held !== null) {
    const frames = [...document.querySelectorAll("iframe[data-preview]")];
    const shown = (frame) => {
      const doc = frame.contentDocument;
      return (
        doc !== null &&
        doc.readyState === "complete" &&
        doc.querySelector(".canccu-surface") !== null
      );
    };
    const check = () => {
      if (frames.every(shown)) {
        held.disabled = false;
        const hint = document.querySelector(".canccu-studio-publish-hint");
        if (hint !== null) hint.textContent = "Preview shown: this version can be published.";
      }
    };
    for (const frame of frames) frame.addEventListener("load", check);
    check();
  }
})();
