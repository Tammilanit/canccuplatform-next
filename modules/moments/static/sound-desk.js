// The sound desk's script (#626, the step 4 polish sheets 01–04): the sliders say their value,
// switches and the master save as they change, steppers step, the players play one sound at a
// time, the mute counts down, the library takes a dropped file, and the cue editor moves sounds
// between its players and its chips, says what a level is heard at, lists the unsaved changes and
// tries the cue here or on a zone. Every page works without it.
"use strict";
(function () {
  // The slider's value in words, as the server first draws it (cues/controls.ts, `said`).
  const said = (range) => {
    const n = Number(range.value);
    const format = range.dataset.format;
    if (format === "pct") return `${n} %`;
    if (format === "count") return String(n);
    const s = format === "stops" ? Number((range.dataset.stops ?? "").split(",")[n] ?? 0) : n;
    if (s === 0) return "Off";
    if (s < 60 || (format === "secs" && s % 60 !== 0)) return `${s} s`;
    return s % 60 === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
  };
  for (const range of document.querySelectorAll("input[type=range][data-format]")) {
    const out = document.querySelector(`output[for="${range.id}"]`);
    range.addEventListener("input", () => {
      if (out) out.textContent = said(range);
    });
  }

  // A row's On and the master's switch save at once; the master volume when the thumb is let go.
  for (const box of document.querySelectorAll("[data-autosubmit]"))
    box.addEventListener("change", () => box.form.requestSubmit());
  for (const range of document.querySelectorAll(".moments-master__form input[type=range]"))
    range.addEventListener("change", () => range.form.requestSubmit());

  // Steppers: the buttons are hidden until the script can work them.
  for (const stepper of document.querySelectorAll("[data-stepper]")) {
    const input = stepper.querySelector("input");
    const by = Number(stepper.dataset.by);
    const [less, more] = stepper.querySelectorAll("button");
    const step = (sign) => {
      const next = Math.min(
        Number(input.max),
        Math.max(Number(input.min), Number(input.value) + sign * by),
      );
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    for (const [button, sign] of [
      [less, -1],
      [more, 1],
    ]) {
      button.hidden = false;
      button.addEventListener("click", () => step(sign));
    }
  }

  // Players: one sound at a time on the whole page; the waveform fills as it plays.
  let playing = null;
  const stop = () => {
    if (playing === null) return;
    const { audio, player } = playing;
    playing = null;
    audio.pause();
    player.classList.remove("is-playing");
    for (const bar of player.querySelectorAll(".moments-wave__bar"))
      bar.classList.remove("is-played");
  };
  const play = (player, level) => {
    stop();
    const audio = new Audio(player.dataset.sound);
    audio.volume = Math.min(1, Math.max(0, level ?? Number(player.dataset.level ?? 1)));
    playing = { audio, player };
    player.classList.add("is-playing");
    const bars = [...player.querySelectorAll(".moments-wave__bar")];
    audio.addEventListener("timeupdate", () => {
      const done = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
      bars.forEach((bar, i) => bar.classList.toggle("is-played", i / bars.length < done));
    });
    audio.addEventListener("ended", () => {
      if (playing?.audio === audio) stop();
    });
    audio.play().catch(() => {
      if (playing?.audio === audio) stop();
    });
  };
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".moments-player__play");
    if (!button) return;
    const player = button.closest("[data-player]");
    if (playing?.player === player) stop();
    else play(player);
  });

  // The mute counts down to its end, then the page reads the desk again.
  const countdown = document.querySelector("[data-until]");
  if (countdown) {
    const until = Date.parse(countdown.dataset.until);
    const tick = () => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      countdown.textContent = countdown.textContent.replace(/\(\d+:\d\d left\)/, `(${clock} left)`);
      if (left === 0) location.reload();
      else setTimeout(tick, 1000);
    };
    tick();
  }

  // The library: the file becomes one of Screen's `audio` assets, then the form links it by id;
  // Moments checks its length and size with Screen before it keeps it (D23). Choosing or dropping
  // a file uploads it at once.
  for (const form of document.querySelectorAll("form[data-upload-sound]")) {
    const file = form.querySelector("input[type=file]");
    file.addEventListener("change", () => form.requestSubmit());
    form.addEventListener("dragover", (event) => {
      event.preventDefault();
      form.classList.add("is-over");
    });
    form.addEventListener("dragleave", () => form.classList.remove("is-over"));
    form.addEventListener("drop", (event) => {
      event.preventDefault();
      form.classList.remove("is-over");
      if (event.dataTransfer.files.length === 0) return;
      file.files = event.dataTransfer.files;
      form.requestSubmit();
    });
    form.addEventListener("submit", async (event) => {
      const id = form.querySelector("input[name=asset_id]");
      if (id.value !== "") return;
      event.preventDefault();
      const chosen = file.files[0];
      if (chosen === undefined) return;
      const body = new FormData();
      body.append("file", chosen);
      const res = await fetch("/api/screen/assets", { method: "POST", body });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        const why = (answer.error && answer.error.message) || "Screen could not keep the file.";
        location.assign(`/moments/cues/library?error=${encodeURIComponent(why)}`);
        return;
      }
      id.value = answer.id;
      form.submit();
    });
  }

  const editor = document.querySelector("form[data-editor]");
  if (editor) cueEditor(editor);

  function cueEditor(form) {
    const chosen = form.querySelector("[data-chosen]");
    const add = form.querySelector("[data-add]");
    const LABELS = {
      name: "name",
      enabled: "on",
      category: "category",
      sounds: "sounds",
      voice_line: "voice line",
      level: "level",
      cooldown_step: "not again for",
      catch_up_minutes: "catch-up",
      once_per_source: "once per source",
      effects: "effects",
      hold_seconds: "holds for",
    };
    const values = () => {
      const out = {};
      for (const name of Object.keys(LABELS))
        out[name] = [...form.elements]
          .filter((el) => el.name === name && (!/checkbox|radio/.test(el.type) || el.checked))
          .map((el) => el.value)
          .sort()
          .join(",");
      return out;
    };
    const loaded = values();
    const note = form.querySelector("[data-unsaved]");
    const unsaved = () => {
      const now = values();
      // In the form's order, so the list reads as the page does.
      const names = [...new Set([...form.elements].map((el) => el.name))].filter(
        (name) => name in LABELS && now[name] !== loaded[name],
      );
      note.textContent =
        names.length === 0
          ? "No changes yet."
          : `Unsaved changes: ${names.map((n) => LABELS[n]).join(", ")}`;
    };

    // The waveform's look from the sound's id, as cues/controls.ts draws it.
    const wave = (id) => {
      const span = document.createElement("span");
      span.className = "moments-wave";
      span.setAttribute("aria-hidden", "true");
      let h = 2166136261;
      for (let i = 0; i < 28; i++) {
        h = Math.imul(h ^ (id.charCodeAt(i % id.length) + i), 16777619) >>> 0;
        const bar = document.createElement("i");
        bar.className = `moments-wave__bar moments-wave__bar--${(h % 8) + 1}`;
        span.append(bar);
      }
      return span;
    };
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    // A sound chosen from the chips becomes a player; its own checkbox moves into the remove box.
    const toPlayer = (label, input) => {
      const { title, url, length } = label.dataset;
      const li = el("li");
      Object.assign(li.dataset, { title, url, length });
      const player = el("div", "moments-player");
      player.dataset.player = "";
      player.dataset.sound = url;
      const button = el("button", "moments-player__play");
      button.type = "button";
      button.setAttribute("aria-label", `Play ${title}`);
      const remove = el("label", "moments-remove");
      input.setAttribute("aria-label", `Remove ${title}`);
      const x = el("span", "", "×");
      x.setAttribute("aria-hidden", "true");
      remove.append(input, x);
      player.append(
        button,
        el("span", "moments-player__title", title),
        wave(input.value),
        el("span", "moments-player__length canccu-num", `${(Number(length) / 1000).toFixed(1)} s`),
        remove,
      );
      li.append(player);
      chosen.append(li);
      label.remove();
    };
    const toChip = (li, input) => {
      const { title, url, length } = li.dataset;
      const label = el("label", "canccu-chip");
      Object.assign(label.dataset, { title, url, length });
      input.removeAttribute("aria-label");
      label.append(input, document.createTextNode(`+ ${title}`));
      add.append(label);
      if (playing?.player === li.querySelector("[data-player]")) stop();
      li.remove();
    };

    const heardNote = form.querySelector("[data-heard]");
    const meaning = form.querySelector("[data-meaning-line]");
    const heard = () => {
      const category = form.querySelector("input[name=category]:checked");
      const master = Number(heardNote.dataset.master);
      const cat = Number(category.dataset.level);
      const level = Number(form.elements.level.value);
      const at = Math.round((master * cat * level) / 10000);
      heardNote.textContent = `Heard at ${at} %: master ${master} % × ${category.dataset.name} ${cat} % × this cue ${level} %.`;
      return at / 100;
    };

    form.addEventListener("change", (event) => {
      const t = event.target;
      if (t.name === "sounds" && t.checked && t.closest("[data-add]"))
        toPlayer(t.closest("label"), t);
      else if (t.name === "sounds" && !t.checked && t.closest("[data-chosen]"))
        toChip(t.closest("li"), t);
      if (t.name === "category") {
        meaning.textContent = t.dataset.meaning;
        heard();
      }
      unsaved();
    });
    form.addEventListener("input", (event) => {
      if (event.target.name === "level") heard();
      unsaved();
    });

    // Try it: here plays the first chosen sound at its level and an effect on the preview; on a
    // zone the form goes to the try path in the background, so the edits stay on the page.
    const box = form.querySelector("[data-preview-box]");
    const tryNote = form.querySelector("[data-try-note]");
    let last = null;
    const effect = () => {
      const pool = [...form.querySelectorAll("input[name=effects]:checked")].map((e) => e.value);
      const fresh = pool.length > 1 ? pool.filter((e) => e !== last) : pool;
      const pick = fresh[Math.floor(Math.random() * fresh.length)];
      box.className = "moments-mini__box";
      if (pick === undefined) return;
      last = pick;
      void box.offsetWidth;
      box.classList.add(`moments-fx--${pick}`);
    };
    const say = (text) => {
      tryNote.textContent = text;
      tryNote.hidden = text === "";
    };
    form.querySelector("[data-try]").addEventListener("click", async (event) => {
      event.preventDefault();
      const where = form.querySelector("input[name=try_zone]:checked")?.value ?? "here";
      if (where === "here") {
        const first = chosen.querySelector("[data-player]");
        if (first) play(first, heard());
        effect();
        say(first ? "" : "Choose a sound to hear it.");
        return;
      }
      const action = event.currentTarget.getAttribute("formaction");
      const res = await fetch(action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
      });
      const answer = new URL(res.url).searchParams;
      say(answer.get("done") ?? answer.get("error") ?? "That did not work.");
      // A try is a crew action with its own key: the next one needs a fresh one.
      const key = form.elements.idempotency_key;
      key.value = crypto.getRandomValues(new Uint32Array(3)).join("-");
    });
    unsaved();
  }
})();
