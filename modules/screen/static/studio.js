/*
 * The Screen studio's controls (step 3 plan U5–U8). Every change goes through the JSON API, which
 * checks the right and audits; the page then reloads, or, for a command, only says it was sent.
 * Destructive actions ask with a second tap, never a native dialog (brief N1). Strings come from the
 * page's JSON block, in the event's language.
 */
"use strict";

(() => {
  const NOTICE_KEY = "canccu-studio-notice";
  const text = JSON.parse(document.getElementById("canccu-studio-text")?.textContent || "{}");
  const notice = document.querySelector(".canccu-studio-notice");
  const say = (key, values = {}) =>
    (text[key] || key).replace(/\{([a-z_]+)\}/g, (whole, name) =>
      name in values ? String(values[name]) : whole,
    );

  /** `key.one` for one, `key` otherwise, when the catalogue has both (as messages.ts's counted). */
  const counted = (key, count, values = {}) =>
    say(count === 1 && `${key}.one` in text ? `${key}.one` : key, { count, ...values });

  function show(message, action) {
    if (notice === null) return;
    notice.replaceChildren(message);
    if (action) notice.append(" ", action);
    notice.hidden = false;
    notice.scrollIntoView({ block: "nearest" });
  }
  const carried = sessionStorage.getItem(NOTICE_KEY);
  if (carried !== null) {
    sessionStorage.removeItem(NOTICE_KEY);
    show(carried);
  }
  const reloadWith = (message, next) => {
    if (message) sessionStorage.setItem(NOTICE_KEY, message);
    if (next) location.assign(next);
    else location.reload();
  };

  async function api(method, url, body) {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, data };
  }
  const failure = (r) =>
    r.status >= 500 || !r.data?.error?.message
      ? say("error.failed")
      : say("error.refused", { message: r.data.error.message });
  // The zone editor's own script (static/studio-zone.js) acts through the same helpers.
  window.canccuStudio = { api, confirmed, counted, failure, reloadWith, say, show, notice };

  // A destructive action asks once more on the button itself; a second tap within 5 s acts.
  function confirmed(button) {
    const ask = button.dataset.confirm;
    if (!ask || button.dataset.armed === "1") return true;
    const label = button.textContent;
    button.dataset.armed = "1";
    button.textContent = ask;
    setTimeout(() => {
      button.dataset.armed = "";
      button.textContent = label;
    }, 5000);
    return false;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-call]");
    if (button === null || !confirmed(button)) return;
    button.disabled = true;
    const body = button.dataset.body ? JSON.parse(button.dataset.body) : undefined;
    const r = await api(button.dataset.call, button.dataset.url, body);
    button.disabled = false;
    if (!r.ok) return show(failure(r));
    if (button.dataset.stay !== undefined) return show(button.dataset.done || "");
    reloadWith(button.dataset.done, button.dataset.next);
  });

  // Live views: loaded while on screen and let go off it, so a long fleet never holds more open
  // streams than the 20 a session may have (contracts/screen.md, A zone for a session).
  const frames = document.querySelectorAll("iframe[data-src]");
  if (frames.length > 0 && "IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const frame = e.target;
        if (e.isIntersecting && !frame.getAttribute("src")) frame.src = frame.dataset.src;
        if (!e.isIntersecting && frame.getAttribute("src")) frame.removeAttribute("src");
      }
    });
    frames.forEach((f) => seen.observe(f));
  } else frames.forEach((f) => (f.src = f.dataset.src));

  // Each live view drawn at its screen's size (1920×1080, or 1080×1920 upright) is scaled to the
  // box that holds it (static/studio.css); offsetWidth is that size, as a transform leaves it.
  const fit = new ResizeObserver((entries) => {
    for (const e of entries) {
      const frame = e.target.querySelector(":scope > iframe");
      if (frame) frame.style.transform = `scale(${e.contentRect.width / frame.offsetWidth})`;
    }
  });
  document
    .querySelectorAll(".canccu-studio-thumb iframe")
    .forEach((frame) => fit.observe(frame.parentElement));

  // Health and counts stay current: the page is read again and each `data-live` part replaced,
  // every 10 s, or every 2 s while a part holds a `data-live-fast` mark (a deck rendering).
  const live = document.querySelectorAll("[data-live]");
  if (live.length > 0) {
    let ticks = 0;
    setInterval(async () => {
      ticks += 1;
      if (document.hidden) return;
      if (ticks % 5 !== 0 && document.querySelector("[data-live-fast]") === null) return;
      const response = await fetch(location.pathname + location.search, {
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const fresh = new DOMParser().parseFromString(await response.text(), "text/html");
      for (const part of document.querySelectorAll("[data-live]")) {
        const next = fresh.querySelector(`[data-live="${CSS.escape(part.dataset.live)}"]`);
        if (next && next.innerHTML !== part.innerHTML) {
          const open = part.querySelector("details")?.open;
          part.innerHTML = next.innerHTML;
          const details = part.querySelector("details");
          if (details && open !== undefined) details.open = open;
        }
      }
    }, 2_000);
  }

  // Pairing: by the button, or by the kiosk's QR, whose code rides in the fragment. The fragment is
  // cleared once read, so the code stays out of the history (contracts/screen.md, Pairing).
  const pair = document.getElementById("canccu-studio-pair");
  if (pair) {
    const open = (code) => {
      pair.querySelector("[name=code]").value = code;
      pair.showModal();
      pair.querySelector(code ? "[name=name]" : "[name=code]").focus();
    };
    document.querySelector("[data-open-pair]")?.addEventListener("click", () => open(""));
    pair.querySelector("[data-close]").addEventListener("click", () => pair.close());
    if (location.hash.startsWith("#pair=")) {
      const code = decodeURIComponent(location.hash.slice(6)).replace(/[^A-Za-z0-9]/g, "");
      history.replaceState(null, "", location.pathname + location.search);
      open(code.toUpperCase());
    }
    pair.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const f = new FormData(event.target);
      const name = String(f.get("name")).trim();
      const body = {
        code: String(f.get("code"))
          .replace(/[^A-Za-z0-9]/g, "")
          .toUpperCase(),
        name,
        ...(f.get("zone_key") ? { zone_key: f.get("zone_key") } : {}),
      };
      const r = await api("POST", "/api/screen/devices", body);
      if (!r.ok) return show(failure(r));
      reloadWith(say("pair.done", { device: name }));
    });
  }

  // A device's name and what it shows: a rename and an assignment, each only when it changed.
  for (const form of document.querySelectorAll("form[data-device]")) {
    const before = new FormData(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = `/api/screen/devices/${encodeURIComponent(form.dataset.device)}`;
      const now = new FormData(form);
      if (now.get("name") !== before.get("name")) {
        const r = await api("PATCH", url, { name: now.get("name") });
        if (!r.ok) return show(failure(r));
      }
      const shows = String(now.get("shows"));
      if (shows !== before.get("shows")) {
        const [kind, key] = [
          shows.slice(0, shows.indexOf(":")),
          shows.slice(shows.indexOf(":") + 1),
        ];
        const r =
          shows === ""
            ? await api("DELETE", `${url}/assignment`)
            : await api(
                "PUT",
                `${url}/assignment`,
                kind === "zone"
                  ? { zone_key: key }
                  : { mirror_of: kind === "device" ? { device_id: key } : { zone_key: key } },
              );
        if (!r.ok) return show(failure(r));
      }
      reloadWith(form.dataset.done);
    });
  }

  // A new zone: the key follows the name until it is edited; the Pulse's hero counts down to the
  // next item, as the contract has Studio offer first.
  const newZone = document.querySelector("form[data-new-zone]");
  if (newZone) {
    const key = newZone.elements.key;
    newZone.elements.name.addEventListener("input", (e) => {
      if (key.dataset.edited) return;
      key.value = e.target.value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
    });
    key.addEventListener("input", () => (key.dataset.edited = "1"));
    newZone.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = {
        key: key.value,
        name: newZone.elements.name.value.trim(),
        regions: { hero: { idle: "next" } },
      };
      const r = await api("POST", "/api/screen/zones", body);
      if (!r.ok) return show(failure(r));
      location.assign(`/admin/screen/zones/${encodeURIComponent(body.key)}`);
    });
  }

  // The ticker, also the phone remote: one line, an end, one tap.
  const ticker = document.querySelector("form[data-ticker]");
  if (ticker) {
    const field = ticker.elements.text;
    const count = document.getElementById("canccu-studio-ticker-count");
    field.addEventListener(
      "input",
      () => (count.textContent = say("ticker.chars", { count: field.value.length })),
    );
    ticker.elements.at.addEventListener(
      "input",
      () => (ticker.querySelector("[value=at]").checked = true),
    );
    ticker.addEventListener("submit", async (event) => {
      event.preventDefault();
      const choice = new FormData(ticker).get("for");
      let until = null;
      if (choice === "at") {
        const [h, m] = (ticker.elements.at.value || "").split(":").map(Number);
        const at = new Date();
        at.setHours(h || 0, m || 0, 0, 0);
        if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
        until = at.toISOString();
      } else if (choice !== "none")
        until = new Date(Date.now() + Number(choice) * 60_000).toISOString();
      const r = await api("PUT", "/api/screen/ticker", { text: field.value.trim(), until });
      if (!r.ok) return show(failure(r));
      reloadWith(say("ticker.set_done"));
    });
  }

  // "Freeze for the event" when the event has no end: the end comes from this form, in the
  // browser's own time, as the ticker's end does.
  const freeze = document.querySelector("form[data-freeze]");
  if (freeze) {
    freeze.addEventListener("submit", async (event) => {
      event.preventDefault();
      const until = new Date(freeze.elements.until.value).toISOString();
      const r = await api("PUT", "/api/screen/pin", { freeze: true, until });
      if (!r.ok) return show(failure(r));
      reloadWith(say("pins.freeze_done"));
    });
  }
})();
