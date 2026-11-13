/*
 * "Preview on a screen…" in the Theme studio (design sheet 6; contracts/screen.md, Preview on a
 * screen; contracts/theming.md, On a screen). The event's screens come from Screen's API, a key
 * to the draft from theming, and Screen starts the preview with it. Screen reads a key's draft
 * when it composes a state, which a draft change does not cause: so after each change (the page
 * reloads) a preview this browser started is sent again once, and the screen follows the draft.
 */
"use strict";

(() => {
  const KEPT = "canccu-studio-screen";
  const root = document.querySelector(".canccu-studio");
  const dialog = document.getElementById("canccu-studio-screen");
  const notice = document.querySelector("[data-screen-preview-notice]");
  if (root === null || dialog === null || notice === null) return;
  const version = Number(root.dataset.draftVersion) || 0;
  const list = dialog.querySelector("[data-screen-preview-list]");
  const error = dialog.querySelector("[data-screen-preview-error]");
  const title = notice.querySelector("[data-screen-preview-title]");

  async function call(method, url, body) {
    const init = { method, headers: {}, credentials: "same-origin" };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
    const res = await fetch(url, init).catch(() => undefined);
    if (res === undefined) return { ok: false, status: 0, data: undefined };
    const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    return { ok: res.ok, status: res.status, data };
  }

  function words(r) {
    const e = r.data?.error;
    // A right's id stays in the server log, never on the page (UX audit B3).
    if (e?.code === "missing_right") {
      return "Your role doesn't include the event's screens. Ask an event owner to add it to your role.";
    }
    return e?.message ?? "The screens could not be reached. Try again in a moment.";
  }

  const say = (el, text) => {
    el.textContent = text;
    el.hidden = false;
  };
  const line = (text) => {
    const p = document.createElement("p");
    p.className = "canccu-small canccu-muted";
    p.textContent = text;
    return p;
  };

  /** A screen as the mockup lists it: its name, then where it is, or why it cannot preview. */
  function row(device, zones, first) {
    const online = device.health?.online === true;
    const zone = device.zone_key === null ? undefined : zones.get(device.zone_key);
    let where;
    if (device.zone_key === null) {
      where =
        device.mirror_of === null
          ? "not assigned · can't preview"
          : "mirrors a screen · can't preview";
    } else if (!online) where = "offline · can't preview";
    else where = `${zone?.name ?? device.zone_key} · online`;
    const label = document.createElement("label");
    label.className = "canccu-studio-pick canccu-studio-screen";
    const input = document.createElement("input");
    Object.assign(input, { className: "canccu-check", type: "radio", name: "device" });
    input.value = device.id;
    input.disabled = device.zone_key === null || !online;
    input.checked = !input.disabled && first;
    const name = document.createElement("b");
    name.textContent = device.name;
    const meta = document.createElement("span");
    meta.className = "canccu-small canccu-muted";
    meta.textContent = where;
    const text = document.createElement("span");
    text.append(name, document.createElement("br"), meta);
    label.append(input, text);
    return label;
  }

  async function open() {
    error.hidden = true;
    dialog.showModal();
    const [devices, zones] = await Promise.all([
      call("GET", "/api/screen/devices"),
      call("GET", "/api/screen/zones"),
    ]);
    if (!devices.ok) return list.replaceChildren(line(words(devices)));
    const byKey = new Map((zones.data?.zones ?? []).map((z) => [z.key, z]));
    const all = devices.data.devices;
    if (all.length === 0)
      return list.replaceChildren(line("No screen is paired to the event yet."));
    let first = true;
    list.replaceChildren(
      ...all.map((d) => {
        const r = row(d, byKey, first);
        if (r.querySelector("input:checked")) first = false;
        return r;
      }),
    );
  }

  async function start(event) {
    event.preventDefault();
    const form = event.target;
    const device = form.querySelector("input[name=device]:checked")?.value;
    if (device === undefined) return say(error, "Pick a screen that is online and in a zone.");
    const minutes = form.querySelector("input[name=minutes]:checked")?.value ?? "2";
    const key = await call("POST", "/api/theming/draft/preview-key");
    if (!key.ok) return say(error, words(key));
    const body = {
      minutes: minutes === "" ? null : Number(minutes),
      theme_preview_key: key.data.preview_key,
    };
    const started = await call(
      "PUT",
      `/api/screen/devices/${encodeURIComponent(device)}/preview`,
      body,
    );
    if (!started.ok) return say(error, words(started));
    sessionStorage.setItem(KEPT, JSON.stringify({ device, key: key.data.preview_key, version }));
    dialog.close();
    await refresh();
  }

  const clock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  let timer;
  /** The notice: the first preview of the draft running on one of the event's screens. */
  async function refresh() {
    clearInterval(timer);
    const r = await call("GET", "/api/screen/previews");
    const shown = r.ok ? r.data.previews.find((p) => p.theme) : undefined;
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
      const name = `Previewing on ${shown.device_name}`;
      title.textContent = left === null ? name : `${name} · ${clock(left)} left`;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  async function end() {
    await call(
      "DELETE",
      `/api/screen/devices/${encodeURIComponent(notice.dataset.device)}/preview`,
    );
    sessionStorage.removeItem(KEPT);
    await refresh();
  }

  /** This browser's preview gets the draft again, once per draft version. */
  async function follow() {
    const kept = JSON.parse(sessionStorage.getItem(KEPT) || "null");
    if (kept === null || kept.version === version) return;
    const r = await call("GET", "/api/screen/previews");
    const running = r.ok
      ? r.data.previews.find((p) => p.device_id === kept.device && p.theme)
      : undefined;
    if (running === undefined) return sessionStorage.removeItem(KEPT);
    const left = running.until === null ? null : Date.parse(running.until) - Date.now();
    const minutes = left === null ? null : Math.min(60, Math.max(1, Math.ceil(left / 60_000)));
    const url = `/api/screen/devices/${encodeURIComponent(kept.device)}/preview`;
    const again = await call("PUT", url, { minutes, theme_preview_key: kept.key });
    if (again.ok) sessionStorage.setItem(KEPT, JSON.stringify({ ...kept, version }));
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-screen-preview]");
    if (control?.dataset.screenPreview === "open") void open();
    else if (control?.dataset.screenPreview === "end") void end();
  });
  dialog.querySelector("form").addEventListener("submit", (event) => void start(event));
  void follow().then(refresh);
})();
