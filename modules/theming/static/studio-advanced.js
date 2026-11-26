/*
 * Advanced's controls (plan issue-784 D14–D16). Each token control posts its value to the preview
 * frames as it changes (studio-live.js sends it on, also to a frame that loads later), and the one
 * tokens form saves 400 ms after the last change through studio.js, without a reload. Adding a
 * font, the screen's own picture or video and a box look reload the page, which then names them; saving
 * a file the theme already names does not.
 */
"use strict";

(() => {
  const root = document.querySelector(".canccu-studio");
  const tokensForm = document.getElementById("canccu-studio-tokens");
  const studio = window.canccuStudio;
  if (root === null || tokensForm === null || studio === undefined) return;
  const { call, query, draftVersion, Invalid, Reload } = studio;
  const IMAGE_EXTS = { png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp" };
  const VIDEO_EXTS = { mp4: "mp4", webm: "webm" };

  const setVersion = (draft) => {
    root.dataset.draftVersion = String(draft.draft_version);
    return draft;
  };

  /** What a control stands for in the frames, as the token CSS will set it. */
  function varsOf(el) {
    if (el.form !== tokensForm || el.dataset.var === undefined) return undefined;
    if (el.type === "radio" && !el.checked) return undefined;
    if (el instanceof HTMLSelectElement) {
      return { [el.dataset.var]: el.selectedOptions[0]?.dataset.stack ?? null };
    }
    if (el.type === "range") {
      const out = tokensForm.ownerDocument.querySelector(`output[for="${CSS.escape(el.id)}"]`);
      if (out !== null) out.textContent = `${el.value} px`;
      return { [el.dataset.var]: `${el.value}${el.dataset.unit ?? ""}` };
    }
    return { [el.dataset.var]: el.value };
  }
  function onEdit(event) {
    const vars = varsOf(event.target);
    if (vars !== undefined)
      document.dispatchEvent(new CustomEvent("canccu-studio-look", { detail: vars }));
  }
  document.addEventListener("input", onEdit);
  document.addEventListener("change", onEdit);

  /** Only what differs from the page as drawn: an unchanged token would still be stored. */
  function tokensOf(form) {
    const tokens = {};
    const put = (name, value) => {
      const [group, key] = name.split(".");
      tokens[group] = { ...tokens[group], [key]: value };
    };
    const radios = new Map();
    for (const el of form.elements) {
      if (el.name === "") continue;
      if (el.type === "radio") {
        radios.set(el.name, [...(radios.get(el.name) ?? []), el]);
        continue;
      }
      if (el instanceof HTMLSelectElement) {
        // The first option is the platform's or the pair's font: no token of the theme's own.
        if (!el.selectedOptions[0]?.defaultSelected)
          put(el.name, el.value === "" ? null : el.value);
      } else if (el.value !== el.defaultValue) {
        put(el.name, `${el.value}${el.dataset.unit ?? ""}`);
      }
    }
    for (const [name, group] of radios) {
      const now = group.find((el) => el.checked);
      if (now !== undefined && !now.defaultChecked) put(name, now.value);
    }
    return tokens;
  }
  async function saveTokens(form) {
    const tokens = tokensOf(form);
    if (Object.keys(tokens).length === 0) return;
    setVersion(
      await call("PATCH", "/api/theming/draft/tokens", { draft_version: draftVersion(), tokens }),
    );
    // The page does not reload, so what was just stored is now the drawn state: a change back to
    // the first value would otherwise look like no change and never be saved.
    markSent(form, tokens);
  }
  function markSent(form, tokens) {
    const sent = (name) => {
      const [group, key] = name.split(".");
      return tokens[group] !== undefined && key in tokens[group];
    };
    for (const el of form.elements) {
      if (el.name === "" || !sent(el.name)) continue;
      if (el.type === "radio") el.defaultChecked = el.checked;
      else if (el instanceof HTMLSelectElement)
        for (const o of el.options) o.defaultSelected = o.selected;
      else el.defaultValue = el.value;
    }
  }
  saveTokens.autosave = true;
  saveTokens.live = true;

  /**
   * One file into the draft; a refused one is taken out again, so it never blocks Publish. A video
   * beside the one in use is a problem only until the old one goes (`storedIsEnough`): it counts as
   * refused only when its checks stored nothing.
   */
  async function upload(path, file, version, storedIsEnough = false) {
    const draft = await call(
      "PUT",
      `/api/theming/draft/file?${query({ path, draft_version: version })}`,
      file,
      "application/octet-stream",
    );
    const problem = draft.problems.find((p) => p.path === path && p.severity === "error");
    if (problem === undefined) return draft.draft_version;
    if (storedIsEnough && draft.files.some((f) => f.path === path)) return draft.draft_version;
    const back = query({ path, draft_version: draft.draft_version });
    setVersion(await call("DELETE", `/api/theming/draft/file?${back}`));
    throw new Error(problem.message);
  }
  const parts = (version, edit) =>
    call("PATCH", "/api/theming/draft/parts", { draft_version: version, ...edit });

  /** An own font (D14): its WOFF2 file and licence, named after the file. */
  async function addFont(form) {
    const font = form.elements.namedItem("font_file").files[0];
    const licence = form.elements.namedItem("licence_file").files[0];
    if (font === undefined || licence === undefined)
      throw new Invalid("Choose the font and its licence.");
    const base = font.name.replace(/\.woff2$/i, "");
    const slug = base
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "");
    // "Orbit-Bold" and "OrbitSans_Regular" read as Orbit and Orbit Sans in the lists.
    // Cleaned to the schema's family pattern (letters, digits, space, _ and -; 64 at most), before any upload.
    const family =
      (base.split(/[-_]/)[0] ?? "")
        .replaceAll(/[^A-Za-z0-9 _-]/g, "")
        .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
        .slice(0, 64)
        .trim() || "Own font";
    const file = `fonts/${slug || "font"}.woff2`;
    const licenceFile = `fonts/${slug || "font"}.${/\.md$/i.test(licence.name) ? "md" : "txt"}`;
    let v = await upload(file, font, draftVersion());
    v = await upload(licenceFile, licence, v);
    const fonts = JSON.parse(form.dataset.fonts ?? "[]").filter((f) => f.file !== file);
    const spdx = form.querySelector('input[name="licence"]:checked')?.value ?? "OFL-1.1";
    const weight = /bold/i.test(base) ? 700 : 400;
    await parts(v, {
      fonts: [...fonts, { family, weight, file, licence: spdx, licence_file: licenceFile }],
    });
  }

  /** The screen's own picture in place of the cycle (D8). */
  async function usePicture(form) {
    const file = form.elements.namedItem("backdrop_file").files[0];
    const ext = IMAGE_EXTS[file?.name.split(".").pop().toLowerCase()];
    if (ext === undefined) throw new Invalid("The picture must be a PNG, JPEG or WebP file.");
    // A new path each time: a refused file takes only its own path out, never the picture in use.
    const path = `images/backdrop-${Date.now()}.${ext}`;
    const v = await upload(path, file, draftVersion());
    await parts(v, { backdrop_image: path });
  }

  /** A file out of the draft; answers the new version. */
  const removeFile = async (path, version) =>
    (await call("DELETE", `/api/theming/draft/file?${query({ path, draft_version: version })}`))
      .draft_version;

  /** A video over the picture (D19): the one in use goes only once the new one is in its place. */
  async function useVideo(form) {
    const file = form.elements.namedItem("video_file").files[0];
    const ext = VIDEO_EXTS[file?.name.split(".").pop().toLowerCase()];
    if (ext === undefined) throw new Invalid("The video must be an MP4 or WebM file.");
    const path = `videos/backdrop-${Date.now()}.${ext}`;
    let v = await upload(path, file, draftVersion(), true);
    v = (await parts(v, { backdrop_video: path })).draft_version;
    if (form.dataset.video) await removeFile(form.dataset.video, v);
  }
  async function videoOff(el) {
    const v = (await parts(draftVersion(), { backdrop_video: null })).draft_version;
    await removeFile(el.dataset.video, v);
  }

  /** A box look (D16): every box of the type uses it, or the platform's look. */
  const useLook = (form) =>
    parts(draftVersion(), {
      looks: {
        [form.dataset.type]: form.elements.namedItem(`look.${form.dataset.type}`).value || null,
      },
    });

  /** The editor's file (D15); a new one is then named in theme.yaml and opened by its name. */
  async function saveFile(form) {
    const path = form.dataset.path;
    const text = form.elements.namedItem("text").value;
    // Checked first: a refused upload would take the theme's file away until it is put right.
    const { problems } = await call("POST", "/api/theming/draft/check", { path, text });
    if (problems.some((p) => p.severity === "error"))
      throw new Invalid("Put the marked lines right first: nothing unsafe is saved.");
    const q = query({ path, draft_version: draftVersion() });
    const v = setVersion(
      await call("PUT", `/api/theming/draft/file?${q}`, new Blob([text])),
    ).draft_version;
    if (form.dataset.listed === "1") return;
    const edit = path.startsWith("css/")
      ? { css: [...JSON.parse(form.dataset.css ?? "[]"), path] }
      : {
          templates: { [form.dataset.name]: { widget: form.dataset.widget, file: path } },
          looks: { [form.dataset.widget]: form.dataset.name },
        };
    setVersion(await parts(v, edit));
    window.history.replaceState(null, "", `?${query({ edit: path })}#canccu-studio-editor`);
    throw new Reload();
  }
  saveFile.live = true;

  window.canccuStudioActions = {
    tokens: saveTokens,
    "font-add": addFont,
    "backdrop-image": usePicture,
    "backdrop-cycle": () => parts(draftVersion(), { backdrop_image: null, backdrop_video: null }),
    "backdrop-video": useVideo,
    "backdrop-video-off": videoOff,
    look: useLook,
    editor: saveFile,
  };

  // A box look is chosen, not typed: the choice is the save.
  document.addEventListener("change", (event) => {
    const form = event.target.closest?.('form[data-action="look"]');
    if (form !== null && form !== undefined) form.requestSubmit();
  });
})();
