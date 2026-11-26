/*
 * My presets (plan issue-784 D18): Save as my look asks for a name and, once saved, opens Pick a
 * look at Your looks, where the new preset shows; Delete there asks first, then goes through
 * studio.js like any action (`mine-delete`), which reloads the gallery.
 */
"use strict";

(() => {
  const studio = window.canccuStudio;
  if (studio === undefined) return;
  const { call } = studio;

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mine-ask]");
    if (button === null) return;
    const dialog = document.getElementById(button.dataset.mineAsk);
    if (dialog === null) return;
    // Delete's dialog is one for every look: it takes the look's id and name from its button.
    const confirm = dialog.querySelector('[data-action="mine-delete"]');
    if (confirm !== null) {
      confirm.dataset.id = button.dataset.id;
      dialog.querySelector(".canccu-studio-mine-name").textContent = button.dataset.name;
    }
    dialog.showModal();
  });

  // Its own submit, not a studio.js action: success leaves the page for the gallery, and a
  // refusal is said in the dialog, which keeps the name typed.
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-mine-save]");
    if (form === null) return;
    event.preventDefault();
    const error = form.querySelector(".canccu-studio-mine-error");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await call("POST", "/api/theming/presets", { name: form.elements.namedItem("name").value });
      // Already on the gallery, a fragment change alone would neither reload nor list the new look.
      if (window.location.pathname === "/theming/studio/") {
        window.location.hash = "canccu-studio-mine";
        window.location.reload();
      } else window.location.assign("/theming/studio/#canccu-studio-mine");
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
      submit.disabled = false;
    }
  });

  window.canccuStudioActions = {
    ...window.canccuStudioActions,
    "mine-delete": (el) =>
      call("DELETE", `/api/theming/presets/${encodeURIComponent(el.dataset.id)}`),
  };
})();
