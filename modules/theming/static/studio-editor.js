/*
 * The editor of the theme's CSS and box looks (plan issue-784 D15): a plain textarea with its
 * lines numbered, checked 500 ms after the last keystroke by `POST …/draft/check`, which stores
 * nothing. Each problem is listed with its line and marks that line; saving is studio-advanced.js's.
 */
"use strict";

(() => {
  const form = document.querySelector(".canccu-studio-editor");
  if (form === null) return;
  const text = form.querySelector(".canccu-studio-editor__text");
  const gutter = form.querySelector(".canccu-studio-editor__gutter");
  const list = form.querySelector(".canccu-studio-editor__problems");
  const state = form.querySelector(".canccu-studio-editor__state");
  const MARK = "canccu-studio-editor__line--";
  /** Each problem line's severity, an error winning over a warning on the same line. */
  let marks = new Map();

  function drawGutter() {
    const lines = text.value.split("\n").length;
    while (gutter.children.length < lines) gutter.append(document.createElement("li"));
    while (gutter.children.length > lines) gutter.lastElementChild.remove();
    [...gutter.children].forEach((li, i) => {
      const severity = marks.get(i + 1);
      li.className = severity === undefined ? "" : MARK + severity;
    });
  }
  text.addEventListener("scroll", () => {
    gutter.scrollTop = text.scrollTop;
  });

  const say = (words) => {
    state.lastChild.textContent = words;
  };
  // The check's own words, without the "Refused:" and the line its mark already shows.
  const plain = (m) => m.replace(/^Refused: /, "").replace(/^line \d+: /, "");

  /** Only the latest check draws: an earlier one may answer after it. */
  let latest = 0;
  async function check() {
    const mine = ++latest;
    say("Checking…");
    const res = await fetch("/api/theming/draft/check", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: form.dataset.path, text: text.value }),
    }).catch(() => undefined);
    const data = res?.ok ? await res.json().catch(() => undefined) : undefined;
    if (mine !== latest) return;
    if (data === undefined) return say("Not checked: the check did not answer");
    marks = new Map();
    const items = data.problems.map((p) => {
      if (p.line !== undefined && marks.get(p.line) !== "error") marks.set(p.line, p.severity);
      const li = document.createElement("li");
      li.className = `canccu-studio-editor__problem canccu-studio-editor__problem--${p.severity}`;
      li.textContent = `${p.line === undefined ? "" : `Line ${p.line}: `}${plain(p.message)}`;
      return li;
    });
    list.replaceChildren(...items);
    drawGutter();
    say(items.length === 0 ? "Checked as you type: nothing to fix" : "Checked as you type");
  }

  let timer;
  text.addEventListener("input", () => {
    drawGutter();
    clearTimeout(timer);
    timer = setTimeout(() => void check(), 500);
  });
  drawGutter();
  if (text.value.trim() !== "") void check();
})();
