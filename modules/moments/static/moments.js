// The Moments pages' one script: the emergency's press and hold, On air kept live, and the
// Priorities preview in the real player. Each page works without it (contracts/moments.md, Pages).
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

  // Priorities: Screen's zone preview path composes the zone with the running moments ranked as
  // this page's order ranks them, and the real player in the frame draws it.
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
  }
})();
