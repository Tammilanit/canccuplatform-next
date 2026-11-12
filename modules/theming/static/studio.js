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

  async function saveBrand(form) {
    if (!form.reportValidity()) throw new Error("A colour is a # and six or eight hex digits.");
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
  let running;
  /** The forms that save as they change; one changed while a save ran is saved before the reload. */
  const SAVES_AS_CHANGED = new Set([saveBrand, saveFont]);
  const again = new Map();
  async function attempt(action, el) {
    try {
      await action(el);
    } catch (err) {
      sessionStorage.setItem(NOTICE_KEY, err instanceof Error ? err.message : String(err));
    }
  }
  async function run(el, control) {
    const action = ACTIONS[el.dataset.action];
    if (action === undefined) return;
    if (busy) {
      // The brand kit has no Save, so a change dropped here would be lost without a word.
      if (SAVES_AS_CHANGED.has(action) && SAVES_AS_CHANGED.has(running)) again.set(action, el);
      return;
    }
    busy = true;
    running = action;
    control.disabled = true;
    await attempt(action, el);
    while (again.size > 0) {
      const [save, form] = again.entries().next().value;
      again.delete(save);
      await attempt(save, form);
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

  /* Each preview is a page at its own size, scaled to its box's width. */
  const scaled = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const width = parseFloat(getComputedStyle(target).getPropertyValue("--canccu-studio-w"));
      if (width > 0) target.style.setProperty("--canccu-studio-scale", target.clientWidth / width);
    }
  });
  for (const box of document.querySelectorAll(".canccu-studio-preview__box")) scaled.observe(box);

  /*
   * The screen preview is screen's virtual screen of one of the event's zones: the real player and
   * layout with the zone's real content (contracts/screen.md, A zone for a session). The page reads
   * the zone's state with this session, gives it the draft's look and posts it to the frame, which
   * draws a posted state instead of the live zone. Where the zones cannot be read (no right to see
   * the event's screens, or no screen module), the Studio's own sample screen stands in.
   */
  const screenFrame = document.querySelector("iframe[data-screen-preview]");
  let screenShown = false;
  const PREVIEW_MESSAGE = "canccu-screen-preview";

  async function readJson(url) {
    const res = await fetch(url, { credentials: "same-origin" }).catch(() => undefined);
    return res?.ok ? res.json().catch(() => undefined) : undefined;
  }

  function withDraft(state) {
    const d = screenFrame.dataset;
    if (d.tokensCssUrl === undefined) return undefined;
    const logo = d.logoUrl;
    const withLogo = (w) =>
      w?.widget === "logo" && logo !== undefined && w.view
        ? { ...w, view: { ...w.view, url: logo } }
        : w;
    return {
      ...state,
      theme: {
        ...state.theme,
        tokens_css_url: d.tokensCssUrl,
        css_url: d.cssUrl ?? null,
        logo_url: logo ?? null,
        templates: JSON.parse(d.templates ?? "[]"),
      },
      regions: state.regions.map((r) => ({
        ...r,
        widgets: r.widgets.map(withLogo),
        idle_view: withLogo(r.idle_view),
      })),
    };
  }

  function load(src, onLoad) {
    screenShown = false;
    screenFrame.addEventListener("load", onLoad, { once: true });
    screenFrame.src = src;
  }

  const fallback = () =>
    load(screenFrame.dataset.fallbackSrc, () => {
      screenShown = isSurface(screenFrame);
      check();
    });

  async function showZone(zone) {
    const key = encodeURIComponent(zone.key);
    const state = await readJson(`/api/screen/zones/${key}/state`);
    if (state === undefined || !Array.isArray(state.regions)) return fallback();
    const caption = document.querySelector(".canccu-studio-zone");
    if (caption !== null) caption.textContent = `· ${zone.name}`;
    const draft = withDraft(state);
    load(`/screen/zones/${key}`, () => {
      if (draft !== undefined) {
        screenFrame.contentWindow.postMessage(
          { type: PREVIEW_MESSAGE, state: draft },
          location.origin,
        );
      }
      screenShown = true;
      check();
    });
  }

  async function startScreen() {
    const zones = (await readJson("/api/screen/zones"))?.zones;
    if (!Array.isArray(zones) || zones.length === 0) return fallback();
    const select = document.querySelector(".canccu-studio-zones");
    const first = zones.find((z) => z.key === "main") ?? zones[0];
    if (select !== null && zones.length > 1) {
      for (const z of zones) select.add(new Option(z.name, z.key, false, z === first));
      select.hidden = false;
      select.addEventListener("change", () => {
        const zone = zones.find((z) => z.key === select.value);
        if (zone !== undefined) void showZone(zone);
      });
    }
    await showZone(first);
  }

  /*
   * Publishing changed CSS needs its preview first (D10): the button waits until every preview
   * frame shows this draft version: a surface page of the Studio's, or the screen given the draft.
   * A frame may finish before this script runs.
   */
  function isSurface(frame) {
    const doc = frame.contentDocument;
    return (
      doc !== null && doc.readyState === "complete" && doc.querySelector(".canccu-surface") !== null
    );
  }
  const shown = (frame) => (frame === screenFrame ? screenShown : isSurface(frame));
  const held = [...document.querySelectorAll("[data-needs-preview]")];
  const frames = [...document.querySelectorAll("iframe[data-preview]")];
  function check() {
    if (held.length === 0 || !frames.every(shown)) return;
    for (const button of held) button.disabled = false;
    const hint = document.querySelector(".canccu-studio-publish-hint");
    if (hint !== null) hint.textContent = "Previews shown: this version can be published.";
  }
  for (const frame of frames) if (frame !== screenFrame) frame.addEventListener("load", check);
  if (screenFrame !== null) void startScreen();
  check();
})();
