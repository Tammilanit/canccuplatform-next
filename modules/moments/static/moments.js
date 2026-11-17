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

  // Storyboards (SU4): one round in the real player, scrubbed to a moment of it, or the whole
  // loop with its gaps shortened to 2 s. The round is a claim whose steps run from `starts_at`, so
  // a scrub is only an earlier start.
  const story = document.querySelector("iframe[data-story-preview]");
  if (story) {
    const note = document.querySelector("[data-preview-note]");
    const zone = encodeURIComponent(story.dataset.zone);
    const json = { "content-type": "application/json" };
    const steps = JSON.parse(story.dataset.steps);
    const chain = JSON.parse(story.dataset.regions);
    const length = Number(story.dataset.length);
    let base = null;
    const read = async () => {
      const got = await fetch(`/api/screen/zones/${zone}`, { headers: json });
      if (!got.ok) {
        note.textContent =
          "The player preview needs the right to edit zones; the round is drawn above.";
        return null;
      }
      const res = await fetch(`/api/screen/zones/${zone}/preview`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(await got.json()),
      });
      return res.ok ? res.json() : null;
    };
    const draw = async (offsetMs) => {
      base = base ?? (await read());
      if (!base) return;
      const state = JSON.parse(JSON.stringify(base));
      const now = Date.now();
      const region = (role) => state.regions.find((r) => r.role === role);
      const role = chain.find((r) => region(r) && !(region(r).claim && region(r).claim.rank > 65));
      if (role) {
        region(role).claim = {
          override_id: "preview-story",
          hidden: false,
          role,
          rank: 65,
          template: steps[0] ? steps[0].template : "title_card",
          content: steps[0] ? steps[0].content : {},
          steps,
          sound: null,
          on_end: "resume",
          starts_at: new Date(now - offsetMs).toISOString(),
          ends_at: null,
          expires_at: new Date(now - offsetMs + length).toISOString(),
        };
      }
      story.contentWindow.postMessage({ type: "canccu-screen-preview", state }, location.origin);
    };
    const scrub = document.querySelector("[data-story-scrub]");
    scrub?.addEventListener("input", () => void draw(Number(scrub.value)));
    const rounds = JSON.parse(story.dataset.rounds);
    document.querySelector("[data-story-loop]")?.addEventListener("click", () => {
      // Each round plays through, then 2 s of the rotation stand for the gap before the next.
      let at = 0;
      for (const [i] of rounds.entries()) {
        setTimeout(() => {
          note.textContent = `Round ${i + 1} of ${rounds.length}`;
          void draw(0);
        }, at);
        at += length + 2000;
      }
    });
    story.addEventListener("load", () => void draw(0));
    void draw(0);
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
