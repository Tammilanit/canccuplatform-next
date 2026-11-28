/*
 * The Studio pages' controls that change only the page: a colour's swatch and hex field kept in
 * step, the logo's drop box, the phone's row above the bottom bar, and the Make it yours choices
 * as `PUT …/draft/brand` takes them (plan issue-784 D4–D8), which studio.js sends with the colours.
 */
"use strict";

(() => {
  const checked = (form, name) => form.querySelector(`input[name="${name}"]:checked`)?.value;

  /** The plate, pair, corners and background of the Make it yours form; none on other forms. */
  window.canccuStudioChoices = (form) => {
    if (form.querySelector('input[name="plate_kind"]') === null) return {};
    const looks = [...form.querySelectorAll('input[name="looks"]:checked')].map((el) => el.value);
    const on = (name) => form.querySelector(`input[name="${name}"]`)?.checked !== false;
    const image = form.elements.namedItem("backdrop_image")?.value;
    const box = form.elements.namedItem("box_opacity")?.value;
    return {
      logo_plate: {
        kind: checked(form, "plate_kind") ?? "none",
        shape: checked(form, "plate_shape") ?? "rounded",
        padding: checked(form, "plate_padding") ?? "medium",
      },
      // The platform font is no pair: null takes the pair away.
      font_pair: checked(form, "font_pair") || null,
      // Nothing is checked when the theme's own corners match no choice: they stay as they are.
      roundness: checked(form, "roundness"),
      backdrop: {
        // At least one look: the cycle needs something to show (the schema's minItems).
        ...(looks.length > 0 ? { looks } : {}),
        game_art: on("game_art"),
        daylight: on("daylight"),
        hype: on("hype"),
        ...(image ? { image } : {}),
      },
      ...(box ? { box_opacity: Number(box) } : {}),
    };
  };

  /* The box transparency's label follows its slider (studio-yours-background.ts, seeThrough). */
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (el.name !== "box_opacity") return;
    const shown = el.parentElement?.querySelector("output");
    const value = Number(el.value);
    if (shown)
      shown.textContent = value >= 1 ? "Solid" : `${Math.round((1 - value) * 100)}% see-through`;
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
