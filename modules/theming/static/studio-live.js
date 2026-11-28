/*
 * The live preview (plan issue-784 D3): a change is posted to every preview frame as token values
 * before its save answers, so the frames follow at once; a save no longer reloads the page. After a
 * save (studio.js says so) the page reads itself again and swaps only its `data-refresh` parts (the
 * title row, the publish check, the plate advice), posts the colours as saved (the server may have
 * shaded one), and asks studio-previews.js to show the saved version in the frames. The chips try
 * how busy the screen is and the time of day in the screen frame only (D21); nothing is saved.
 */
"use strict";

(() => {
  const LIVE = "canccu-theme-live";
  const root = document.querySelector(".canccu-studio");
  if (root === null) return;
  const RADIUS = { square: "0", soft: "0.5rem", round: "1rem", pill: "2.5rem" };
  const PLATES = { light: "#f7f7f8", dark: "#121317", surface: "var(--canccu-color-surface)" };
  const PADDING = { small: "0.08", medium: "0.15", large: "0.25" };
  /** Every value posted, so a frame that loads later gets them too (Review focus 5). */
  const pending = {};
  const moment = {};

  const frames = () => [...document.querySelectorAll("iframe[data-preview]")];
  const isScreen = (frame) => frame.matches("[data-screen-preview]");
  function postTo(frame, message) {
    frame.contentWindow?.postMessage(message, location.origin);
  }
  function post(vars) {
    Object.assign(pending, vars);
    for (const frame of frames()) postTo(frame, { type: LIVE, vars });
  }
  // A frame that loads (or loads again) gets what was posted before it was ready.
  document.addEventListener(
    "load",
    (event) => {
      const frame = event.target;
      if (!(frame instanceof HTMLIFrameElement) || !frame.matches("[data-preview]")) return;
      postTo(frame, { type: LIVE, vars: pending });
      if (isScreen(frame)) postTo(frame, { type: LIVE, state: moment });
    },
    true,
  );

  const checked = (form, name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const family = (name) => `"${name}", system-ui, sans-serif`;

  /** The values a change of the Make it yours form stands for, as the token CSS will set them. */
  function varsOf(el) {
    const form = el.form;
    if (el.matches("input[data-hex-for]")) {
      return { [`--canccu-color-${el.dataset.hexFor.replace("_", "-")}`]: el.value };
    }
    if (el.matches(".canccu-studio-colour__hex") && /^#[0-9a-fA-F]{6}$/.test(el.value)) {
      return { [`--canccu-color-${el.name.replace("_", "-")}`]: el.value.toLowerCase() };
    }
    if (form === null) return undefined;
    if (el.name.startsWith("plate_")) {
      const kind = checked(form, "plate_kind");
      const circle = checked(form, "plate_shape") === "circle";
      if (kind === "none" || PLATES[kind] === undefined) {
        return Object.fromEntries(
          ["", "-radius", "-padding", "-aspect"].map((s) => [`--canccu-logo-plate${s}`, null]),
        );
      }
      return {
        "--canccu-logo-plate": PLATES[kind],
        "--canccu-logo-plate-radius": circle ? "50%" : "var(--canccu-radius)",
        "--canccu-logo-plate-padding": PADDING[checked(form, "plate_padding")] ?? "0.15",
        "--canccu-logo-plate-aspect": circle ? "1" : null,
      };
    }
    if (el.name === "roundness") return { "--canccu-radius": RADIUS[el.value] ?? "0.5rem" };
    // The value as asked: the save answers with it raised where the colours need it.
    if (el.name === "box_opacity") return { "--canccu-box-opacity": el.value };
    if (el.name === "font_pair") {
      const { heading, body } = el.dataset;
      const stack = (f) => (f === undefined ? null : family(f));
      return {
        "--canccu-font-heading": stack(heading),
        "--canccu-font-display": stack(heading),
        "--canccu-font-body": stack(body),
      };
    }
    return undefined;
  }

  function onEdit(event) {
    const vars = varsOf(event.target);
    if (vars !== undefined) post(vars);
  }
  document.addEventListener("input", onEdit);
  document.addEventListener("change", (event) => {
    const el = event.target;
    const chip = /^canccu-live-(scene|daypart)$/.exec(el.name ?? "");
    if (chip !== null) {
      moment[chip[1]] = el.value;
      for (const frame of frames().filter(isScreen)) postTo(frame, { type: LIVE, state: moment });
      return;
    }
    if (el.type === "radio" || el.type === "checkbox") onEdit(event);
  });
  // A look from the gallery as its apply is sent, and the saved colours again if it fails
  // (studio.js): never on a click alone, which a dialog or a busy save may stop.
  document.addEventListener("canccu-studio-look", (event) => post(event.detail));

  const savedLabel = (text) => {
    for (const el of document.querySelectorAll(".canccu-studio-saved"))
      el.lastChild.textContent = text;
  };
  new MutationObserver(() => {
    const state = root.dataset.saveState;
    savedLabel(state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved");
  }).observe(root, { attributes: true, attributeFilter: ["data-save-state"] });

  /** Bumped by each refresh, so one that a newer refresh overtook draws nothing. */
  let latest = 0;
  const hasFile = (el) =>
    [...el.querySelectorAll('input[type="file"]')].some((input) => input.files.length > 0);

  /** After a save: the page's parts as the server draws them now, and the frames on the saved version. */
  async function refresh() {
    const seq = ++latest;
    const res = await fetch(location.href, { credentials: "same-origin" }).catch(() => undefined);
    if (seq !== latest) return;
    // The draft went (discarded meanwhile) or the page cannot be read: the page is the one to read.
    if (res === undefined || !res.ok || res.redirected) return location.reload();
    const text = await res.text();
    if (seq !== latest) return;
    const doc = new DOMParser().parseFromString(text, "text/html");
    const next = doc.querySelector(".canccu-studio");
    // A save made after this page was read: its own refresh draws the page, and the version the
    // next save names never goes back (a 409 would stop every save after it).
    const read = Number(next?.dataset.draftVersion);
    const mine = Number(root.dataset.draftVersion);
    if (read < mine) return;
    // Newer than this page's own last save: another organiser wrote it. The form still holds the
    // old values, so taking the version would let the next save undo theirs without a 409.
    if (read > mine) return void document.dispatchEvent(new Event("canccu-studio-conflict"));
    for (const el of document.querySelectorAll("[data-refresh]")) {
      // A file picked and not yet sent stays: the save 400 ms on reads it from this input.
      if (hasFile(el)) continue;
      // A slider still held keeps the value under the hand; its own change saves and refreshes.
      if (el.querySelector("input[type=range]:active") !== null) continue;
      const part = doc.querySelector(`[data-refresh="${CSS.escape(el.dataset.refresh)}"]`);
      if (part !== null) el.replaceWith(document.importNode(part, true));
    }
    // The page now draws the saved version, so Publish no longer waits for a colour put right.
    Reflect.deleteProperty(root.dataset, "previewStale");
    for (const key of ["draftVersion", "ownWork", "vars"]) {
      if (next?.dataset[key] === undefined) Reflect.deleteProperty(root.dataset, key);
      else root.dataset[key] = next.dataset[key];
    }
    if (root.dataset.vars !== undefined) post(JSON.parse(root.dataset.vars));
    document.dispatchEvent(new CustomEvent("canccu-studio-redraw", { detail: doc }));
    root.dataset.saveState = "saved";
  }
  document.addEventListener("canccu-studio-saved", () => void refresh());
})();
