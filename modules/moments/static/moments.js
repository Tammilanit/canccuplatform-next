// The Moments pages' one script: the emergency's press and hold, On air kept live, Priorities'
// drag and drop and its preview in the real player, and the rules' sliders. Each page works
// without it (contracts/moments.md, Pages).
"use strict";
(function () {
  // Emergency (mockup 07): only a 2-second hold sends; a click or a short press does nothing.
  for (const form of document.querySelectorAll("form[data-hold-to-start]")) {
    const button = form.querySelector("[data-hold-ms]");
    const ms = Number(button.dataset.holdMs);
    let timer = null;
    const stop = () => {
      clearTimeout(timer);
      timer = null;
      button.classList.remove("moments-hold--holding");
    };
    const start = (event) => {
      event.preventDefault();
      if (timer !== null) return;
      button.classList.add("moments-hold--holding");
      timer = setTimeout(() => {
        const held = document.createElement("input");
        held.type = "hidden";
        held.name = "held";
        held.value = "yes";
        form.append(held);
        form.submit();
      }, ms);
    };
    form.addEventListener("submit", (event) => event.preventDefault());
    button.addEventListener("pointerdown", start);
    button.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") start(event);
    });
    for (const end of ["pointerup", "pointerleave", "pointercancel", "keyup", "blur"]) {
      button.addEventListener(end, stop);
    }
  }

  // On air is live: read again every 10 s, unless someone is in the middle of something.
  if (document.querySelector(".moments-onair")) {
    setTimeout(function again() {
      const busy =
        document.querySelector(".moments-hold--holding") || document.activeElement?.closest("form");
      if (busy) setTimeout(again, 10000);
      else location.reload();
    }, 10000);
  }

  // Priorities (mockup 08): a class moves by its handle, dragged by a pointer or a finger, or with
  // the arrow keys while the handle has the focus. Emergency has no handle and stays first. A move
  // changes only the draft: Save sends it; the address keeps it, so a reload or Preview has it.
  const order = document.querySelector("[data-order]");
  const orderInput = document.querySelector("[data-order-input]");
  const loadedOrder = orderInput ? orderInput.value : "";
  if (order) {
    const unsaved = document.querySelector("[data-order-unsaved]");
    const said = document.querySelector("[data-order-said]");
    const rows = () => [...order.children];
    const nameOf = (row) => row.querySelector(".moments-order__name").firstChild.textContent.trim();
    // To `at` among the other rows; never above the emergency, the first row.
    const place = (row, at) => {
      const others = rows().filter((r) => r !== row);
      const before = others[Math.max(1, Math.min(at, others.length))] ?? null;
      if (row.nextElementSibling !== before) order.insertBefore(row, before);
    };
    const changed = (row) => {
      const classes = rows().map((r) => r.dataset.class);
      if (orderInput) orderInput.value = classes.join(",");
      if (unsaved) unsaved.hidden = false;
      const url = new URL(location.href);
      url.searchParams.set("order", classes.join(","));
      for (const key of ["done", "error", "preview"]) url.searchParams.delete(key);
      history.replaceState(null, "", url);
      said.textContent = `${nameOf(row)}: ${rows().indexOf(row) + 1} of ${rows().length}`;
    };
    for (const handle of order.querySelectorAll("[data-order-handle]")) {
      const row = handle.closest("li");
      handle.addEventListener("keydown", (event) => {
        const by = { ArrowUp: -1, ArrowDown: 1 }[event.key];
        if (by === undefined) return;
        event.preventDefault();
        const at = rows().indexOf(row) + by;
        if (at < 1 || at >= rows().length) return;
        place(row, at);
        handle.focus();
        changed(row);
      });
      // A moved row leaves the document for a moment, which drops its pointer capture, so the
      // drag listens on the document until the pointer lets go.
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        row.classList.add("moments-order__row--dragging");
        const from = rows().indexOf(row);
        const done = new AbortController();
        const mine = { signal: done.signal };
        const pointer = (e) => e.pointerId === event.pointerId;
        // The row goes before the first other row whose middle is below the pointer.
        document.addEventListener(
          "pointermove",
          (e) => {
            if (!pointer(e)) return;
            const others = rows().filter((r) => r !== row);
            const at = others.findIndex((r) => {
              const box = r.getBoundingClientRect();
              return e.clientY < box.top + box.height / 2;
            });
            place(row, at === -1 ? others.length : at);
          },
          mine,
        );
        const end = (e) => {
          if (!pointer(e)) return;
          done.abort();
          row.classList.remove("moments-order__row--dragging");
          if (rows().indexOf(row) !== from) changed(row);
          handle.focus();
        };
        document.addEventListener("pointerup", end, mine);
        document.addEventListener("pointercancel", end, mine);
      });
    }
  }

  // The built-in rules: the slider's value in words as it moves (the server draws the first).
  for (const range of document.querySelectorAll("[data-seconds]")) {
    const out = range.parentElement.querySelector("[data-seconds-out]");
    range.addEventListener("input", () => {
      const n = Number(range.value);
      const m = Math.floor(n / 60);
      out.textContent = n < 60 ? `${n} s` : n % 60 === 0 ? `${m} min` : `${m} min ${n % 60} s`;
    });
  }

  // Priorities: Screen's zone preview path composes the zone with the running moments ranked as
  // this page's order ranks them, and the real player in the frame draws it. The ranks come from
  // the server, so after a move Preview reloads the page with the draft and draws on load.
  const run = document.querySelector("[data-preview-run]");
  if (run) {
    const frame = document.querySelector("iframe[data-preview]");
    const note = document.querySelector("[data-preview-note]");
    const zone = encodeURIComponent(frame.dataset.zone);
    const ranks = Object.entries(JSON.parse(frame.dataset.ranks)).map(
      ([id, rank]) => `${id}:${rank}`,
    );
    const say = (text) => {
      note.textContent = text;
      note.hidden = text === "";
    };
    run.addEventListener("click", async () => {
      if (orderInput && orderInput.value !== loadedOrder) {
        const url = new URL(location.href);
        url.searchParams.set("preview", "1");
        location.assign(url);
        return;
      }
      say("");
      const json = { "content-type": "application/json" };
      const got = await fetch(`/api/screen/zones/${zone}`, { headers: json });
      if (!got.ok)
        return say("The zone could not be read: the preview needs the right to edit zones.");
      const query = ranks.length === 0 ? "" : `?ranks=${encodeURIComponent(ranks.join(","))}`;
      const res = await fetch(`/api/screen/zones/${zone}/preview${query}`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(await got.json()),
      });
      if (!res.ok) return say("Screen could not draw the preview just now.");
      frame.contentWindow.postMessage(
        { type: "canccu-screen-preview", state: await res.json() },
        location.origin,
      );
      say(ranks.length === 0 ? "Nothing is live: the zone plays its rotation." : "");
    });
    // The player in the frame listens once it has loaded.
    if (frame.hasAttribute("data-preview-auto"))
      frame.addEventListener("load", () => run.click(), { once: true });
  }

  // Announcements (U11): the card in the real player before it goes out. Screen's zone preview
  // composes the zone as it is now; the card takes the first region of its chain that the layout
  // has and no higher claim holds, as Screen would place it, and the ticker line the ticker.
  const announce = document.querySelector("iframe[data-announce-preview]");
  if (announce) {
    const note = document.querySelector("[data-preview-note]");
    const zone = encodeURIComponent(announce.dataset.zone);
    const json = { "content-type": "application/json" };
    const draw = async () => {
      const got = await fetch(`/api/screen/zones/${zone}`, { headers: json });
      if (!got.ok) {
        note.textContent = "The player preview needs the right to edit zones; the texts are below.";
        return;
      }
      const res = await fetch(`/api/screen/zones/${zone}/preview`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(await got.json()),
      });
      if (!res.ok) return;
      const state = await res.json();
      const now = new Date().toISOString();
      const claim = (role, template, content) => ({
        override_id: `preview-${role}`,
        hidden: false,
        role,
        rank: 80,
        template,
        content,
        steps: null,
        sound: null,
        on_end: "resume",
        starts_at: now,
        ends_at: null,
        expires_at: null,
      });
      const region = (role) => state.regions.find((r) => r.role === role);
      const free = (role) => region(role) && !(region(role).claim && region(role).claim.rank > 80);
      const role = JSON.parse(announce.dataset.chain).find(free);
      if (role) region(role).claim = claim(role, "announcement", JSON.parse(announce.dataset.card));
      const line = announce.dataset.line;
      if (line && role !== "ticker" && free("ticker")) {
        const urgent = announce.dataset.urgent === "true";
        region("ticker").claim = claim("ticker", "ticker", {
          text: line,
          until: null,
          source: "moments",
          urgent,
          updated: false,
        });
      }
      announce.contentWindow.postMessage({ type: "canccu-screen-preview", state }, location.origin);
    };
    // The frame's player listens once it has loaded; drawing again on load covers a slow frame.
    announce.addEventListener("load", () => void draw());
    void draw();
  }

  // The sound desk's library (D23): the file becomes one of Screen's `audio` assets, then the
  // form links it by id; Moments checks its length and size with Screen before it keeps it.
  for (const form of document.querySelectorAll("form[data-upload-sound]")) {
    form.addEventListener("submit", async (event) => {
      const id = form.querySelector("input[name=asset_id]");
      const file = form.querySelector("input[type=file]").files[0];
      if (id.value !== "") return;
      event.preventDefault();
      if (file === undefined) return;
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/screen/assets", { method: "POST", body });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        const why = (answer.error && answer.error.message) || "Screen could not keep the file.";
        location.assign(`/moments/cues?error=${encodeURIComponent(why)}`);
        return;
      }
      id.value = answer.id;
      form.submit();
    });
  }
})();
