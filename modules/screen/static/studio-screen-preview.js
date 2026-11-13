/*
 * "Preview on a screen…" and the preview time in the zone editor (mockup 08; contracts/screen.md,
 * Preview time and Preview on a screen). The dialog's screens are the zone's own, drawn by the
 * server; this starts the preview with the zone as the form holds it, and keeps the notice of the
 * zone's running previews with a countdown and End preview.
 */

/** The preview time the page picked, or null for now. */
export const previewAt = (root) => root.querySelector("[data-preview-at]")?.value || null;

export function screenPreview(root, { api, failure, say, zone }) {
  const dialog = root.querySelector("[data-screen-preview-dialog]");
  const notice = root.querySelector("[data-screen-preview-notice]");
  if (!dialog || !notice) return;
  const error = dialog.querySelector("[data-screen-preview-error]");
  const title = notice.querySelector("[data-screen-preview-title]");
  const key = zone().key;
  const tell = (text) => {
    error.textContent = text;
    error.hidden = false;
  };

  root.querySelector("[data-screen-preview-open]")?.addEventListener("click", () => {
    error.hidden = true;
    dialog.showModal();
  });
  dialog
    .querySelector("[data-screen-preview-cancel]")
    .addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-screen-preview-start]").addEventListener("click", async () => {
    const device = dialog.querySelector("input[name=preview_device]:checked")?.value;
    if (!device) return tell(say("preview.pick"));
    const minutes = dialog.querySelector("input[name=preview_minutes]:checked")?.value ?? "2";
    const r = await api("PUT", `/api/screen/devices/${encodeURIComponent(device)}/preview`, {
      minutes: minutes === "" ? null : Number(minutes),
      zone: zone(),
      at: previewAt(root),
    });
    if (!r.ok) return tell(failure(r));
    dialog.close();
    await refresh();
  });

  const clock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  let timer;
  /** The notice: the first preview running on one of this zone's screens. */
  async function refresh() {
    clearInterval(timer);
    const r = await api("GET", "/api/screen/previews");
    const shown = r.ok ? r.data.previews.find((p) => p.zone_key === key) : undefined;
    notice.hidden = shown === undefined;
    if (shown === undefined) return;
    notice.dataset.device = shown.device_id;
    const tick = () => {
      const left = shown.until === null ? null : Date.parse(shown.until) - Date.now();
      if (left !== null && left <= 0) {
        clearInterval(timer);
        notice.hidden = true;
        return;
      }
      title.textContent =
        left === null
          ? say("preview.running", { device: shown.device_name })
          : say("preview.left", { device: shown.device_name, time: clock(left) });
    };
    tick();
    timer = setInterval(tick, 1000);
  }
  notice.querySelector("[data-screen-preview-end]").addEventListener("click", async () => {
    await api("DELETE", `/api/screen/devices/${encodeURIComponent(notice.dataset.device)}/preview`);
    await refresh();
  });
  void refresh();
}
