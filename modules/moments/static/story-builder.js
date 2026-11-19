// The storyboard builder's script (step 4 polish sheets 05 and 06): the phone's three tabs, a
// step's form opened from the strip, steps moved by drag or the arrow keys (the new order goes in
// the form's `order`, which form.ts reads), placeholders put into the field in use, the count of
// changes, and the preview in the real player with its scrub. The builder works without it: every
// part is shown, a step opens through the address and moves with its Move buttons.
"use strict";
(function () {
  const root = document.querySelector("[data-builder]");
  if (!root) return;
  const form = document.getElementById("story-save");
  root.classList.add("moments-builder--js");

  // The tabs (sheet 06): only on a narrow screen, where the stylesheet shows one part at a time.
  const tabs = root.querySelector(".moments-builder__tabs");
  const show = (part) => {
    root.dataset.show = part;
    for (const t of tabs.querySelectorAll("[role=tab]"))
      t.setAttribute("aria-selected", String(t.dataset.tabTo === part));
  };
  if (tabs) {
    tabs.hidden = false;
    show("overview");
    for (const to of root.querySelectorAll("[data-tab-to]"))
      to.addEventListener("click", (event) => {
        if (!window.getComputedStyle(tabs).display.startsWith("none")) {
          event.preventDefault();
          show(to.dataset.tabTo);
          tabs.scrollIntoView({ block: "nearest" });
        }
      });
  }

  // Changes not saved yet, counted by field, in the pending row and beside Save.
  const changed = new Set();
  const state = root.querySelector("[data-builder-state]");
  const unsaved = document.querySelector("[data-builder-unsaved]");
  const note = (name) => {
    changed.add(name);
    if (state) state.textContent = changed.size === 1 ? "1 change" : `${changed.size} changes`;
    if (unsaved) unsaved.hidden = false;
  };
  form?.addEventListener("input", (event) => {
    if (event.target.name && !event.target.hasAttribute("form")) note(event.target.name);
  });
  for (const outside of document.querySelectorAll('[form="story-save"]'))
    outside.addEventListener("input", () => note(outside.name));

  // The strip: a step opens its form beside it; its place is kept in the form and the address.
  const list = root.querySelector("[data-steps]");
  const items = () => [...list.children];
  const stepInput = form?.querySelector('input[name="step"]');
  const orderInput = form?.querySelector('input[name="order"]');
  const open = (i) => {
    for (const f of root.querySelectorAll("[data-step-form]")) f.hidden = f.dataset.stepForm !== i;
    for (const a of list.querySelectorAll(".moments-step"))
      if (a.dataset.step === i) a.setAttribute("aria-current", "step");
      else a.removeAttribute("aria-current");
    if (stepInput) stepInput.value = i;
    const url = new URL(location.href);
    url.searchParams.set("step", i);
    for (const key of ["done", "error"]) url.searchParams.delete(key);
    history.replaceState(null, "", url);
  };
  // The repeat is by place in the round, so its bracket stays where it is when steps move.
  const from = Number(list?.dataset.repeatFrom ?? -1);
  const to = Number(list?.dataset.repeatTo ?? -1);
  const times = list?.dataset.repeatTimes;
  const redraw = () => {
    items().forEach((li, at) => {
      const a = li.querySelector(".moments-step");
      a.querySelector(".moments-step__name").textContent = `${at + 1} · ${a.dataset.name}`;
      li.classList.toggle("moments-steps__item--repeat", at >= from && at <= to);
      li.classList.toggle("moments-steps__item--repeat-first", at === from);
      li.classList.toggle("moments-steps__item--repeat-last", at === to);
      if (at === from && times) li.dataset.times = times;
      else delete li.dataset.times;
    });
    if (orderInput) orderInput.value = items().map((li) => li.firstElementChild.dataset.step);
    for (const f of root.querySelectorAll("[data-step-form]")) {
      const at = items().findIndex(
        (li) => li.firstElementChild.dataset.step === f.dataset.stepForm,
      );
      const head = f.querySelector("[data-step-head]");
      const a = items()[at].firstElementChild;
      head.textContent = `Step ${at + 1} · ${a.dataset.name}`;
    }
  };
  const move = (li, by) => {
    const all = items();
    const at = all.indexOf(li) + by;
    if (at < 0 || at >= all.length) return;
    list.insertBefore(li, by < 0 ? all[at] : all[at].nextElementSibling);
    redraw();
    note("order");
  };
  if (list) {
    redraw();
    for (const a of list.querySelectorAll(".moments-step")) {
      const li = a.parentElement;
      a.addEventListener("click", (event) => {
        if (a.dataset.dragged === "yes") {
          delete a.dataset.dragged;
          event.preventDefault();
          return;
        }
        event.preventDefault();
        open(a.dataset.step);
      });
      a.addEventListener("keydown", (event) => {
        const by = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
        if (by === undefined) return;
        event.preventDefault();
        move(li, by);
        a.focus();
      });
      // A mouse or a pen drags; a finger scrolls the strip and moves a step with its buttons.
      a.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "touch" || event.button !== 0) return;
        const start = { x: event.clientX, y: event.clientY };
        const done = new AbortController();
        const mine = { signal: done.signal };
        let dragging = false;
        document.addEventListener(
          "pointermove",
          (e) => {
            if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
            dragging = true;
            li.classList.add("moments-steps__item--dragging");
            const across = window.getComputedStyle(list).flexDirection === "row";
            const others = items().filter((x) => x !== li);
            const at = others.findIndex((x) => {
              const b = x.getBoundingClientRect();
              return across ? e.clientX < b.left + b.width / 2 : e.clientY < b.top + b.height / 2;
            });
            const before = at === -1 ? null : others[at];
            if (li.nextElementSibling !== before) {
              list.insertBefore(li, before);
              redraw();
            }
          },
          mine,
        );
        const end = () => {
          done.abort();
          li.classList.remove("moments-steps__item--dragging");
          if (dragging) {
            a.dataset.dragged = "yes";
            note("order");
          }
        };
        document.addEventListener("pointerup", end, mine);
        document.addEventListener("pointercancel", end, mine);
      });
    }
    // A step's Move buttons save without the script; with it they move the step here.
    for (const b of root.querySelectorAll('button[name="move"]'))
      b.addEventListener("click", (event) => {
        event.preventDefault();
        const [i, by] = b.value.split(":");
        const a = list.querySelector(`.moments-step[data-step="${i}"]`);
        move(a.parentElement, Number(by));
      });
  }

  // Placeholders go into the field last used in the open step (its first text field before that).
  let last = null;
  root.addEventListener("focusin", (event) => {
    if (event.target.matches("[data-step-form] input.canccu-input")) last = event.target;
  });
  for (const b of root.querySelectorAll("[data-insert]"))
    b.addEventListener("click", () => {
      const f = b.closest("[data-step-form]");
      const input = last && f.contains(last) ? last : f.querySelector("input.canccu-input");
      const at = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, at) + b.dataset.insert + input.value.slice(at);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      input.focus();
    });

  // The preview (SU4): one round in the real player, scrubbed to a moment of it, played through,
  // or the whole loop with its gaps shortened to 2 s. The round is a claim whose steps run from
  // `starts_at`, so a scrub is only an earlier start.
  const frame = root.querySelector("iframe[data-story-preview]");
  if (!frame) return;
  const said = root.querySelector("[data-preview-note]");
  const json = { "content-type": "application/json" };
  const steps = JSON.parse(frame.dataset.steps);
  const chain = JSON.parse(frame.dataset.regions);
  const length = Number(frame.dataset.length);
  const scrub = root.querySelector("[data-story-scrub]");
  const at = root.querySelector("[data-scrub-at]");
  const clock = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const showAt = (ms) => {
    if (at) at.textContent = `${clock(ms)} of ${clock(length)}`;
  };
  let base = null;
  const read = async () => {
    const zone = encodeURIComponent(frame.dataset.zone);
    const got = await fetch(`/api/screen/zones/${zone}`, { headers: json });
    if (!got.ok) {
      said.textContent =
        "The player preview needs the right to edit zones; the round is drawn here.";
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
    frame.contentWindow.postMessage({ type: "canccu-screen-preview", state }, location.origin);
  };
  // Play moves the scrub along with the round; touching the scrub stops it.
  let playing = null;
  const stop = () => {
    window.clearInterval(playing);
    playing = null;
  };
  scrub?.addEventListener("input", () => {
    stop();
    showAt(Number(scrub.value));
    void draw(Number(scrub.value));
  });
  root.querySelector("[data-story-play]")?.addEventListener("click", () => {
    stop();
    const began = Date.now();
    void draw(0);
    playing = window.setInterval(() => {
      const ms = Math.min(length, Date.now() - began);
      if (scrub) scrub.value = String(ms);
      showAt(ms);
      if (ms >= length) stop();
    }, 250);
  });
  const rounds = JSON.parse(frame.dataset.rounds);
  root.querySelector("[data-story-loop]")?.addEventListener("click", () => {
    stop();
    // Each round plays through, then 2 s of the rotation stand for the gap before the next.
    let t = 0;
    for (const [i] of rounds.entries()) {
      setTimeout(() => {
        said.textContent = `Round ${i + 1} of ${rounds.length}`;
        void draw(0);
      }, t);
      t += length + 2000;
    }
  });
  // The zone chosen under the preview is the one it draws and the one Test-fire uses.
  for (const radio of root.querySelectorAll('[name="zone"], [name="preview_zone"]'))
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      frame.dataset.zone = radio.value;
      base = null;
      for (const n of document.querySelectorAll("[data-zone-name]")) n.textContent = radio.value;
      frame.src = `/screen/zones/${encodeURIComponent(radio.value)}`;
    });
  frame.addEventListener("load", () => void draw(Number(scrub?.value ?? 0)));
  void draw(0);
})();
