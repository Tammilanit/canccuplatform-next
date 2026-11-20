// The Food pages' few touches; every page works without them (plain forms and links).
"use strict";

(function () {
  // Call mode (mockup 08): ticks live only on this phone, so a dropped call starts where it stopped.
  var call = document.querySelector("[data-call]");
  if (call) {
    var key = "canccu-pizza-call-" + call.getAttribute("data-call");
    var ticked = {};
    try {
      ticked = JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      ticked = {};
    }
    call.querySelectorAll("[data-tick]").forEach(function (box) {
      var id = box.getAttribute("data-tick");
      box.checked = ticked[id] === true;
      box.addEventListener("change", function () {
        ticked[id] = box.checked;
        try {
          localStorage.setItem(key, JSON.stringify(ticked));
        } catch {
          // A private window keeps no storage: the ticks still show until the page closes.
        }
      });
    });
  }

  // Copy as text: one button where the clipboard is there; the text stays selectable otherwise.
  document.querySelectorAll("[data-copy]").forEach(function (details) {
    var text = details.querySelector("textarea");
    if (!text || !navigator.clipboard) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "canccu-button canccu-button--secondary canccu-button--sm";
    button.textContent = details.querySelector("summary").textContent;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(text.value).then(function () {
        button.textContent = "✓";
      });
    });
    details.appendChild(button);
  });

  // Called in: "About 19:31" from the chosen estimate.
  var estimate = document.querySelector("[data-estimate]");
  if (estimate) {
    var about = estimate.querySelector("[data-about]");
    var show = function () {
      var chosen = estimate.querySelector("input[name=estimate_minutes]:checked");
      var minutes = chosen ? Number(chosen.value) : 0;
      if (!chosen || chosen.value === "") {
        about.textContent = "";
        return;
      }
      var at = new Date(Date.now() + minutes * 60000);
      about.textContent = "≈ " + at.toTimeString().slice(0, 5);
    };
    estimate.addEventListener("change", show);
    show();
  }

  // "Everyone got theirs" (mockup 09): ticks everyone at once, with ten seconds to undo before it
  // is sent; a page left meanwhile still sends it.
  var everyone = document.querySelector("form[data-everyone]");
  if (everyone) {
    var pending = null;
    var banner = null;
    var send = function () {
      if (pending === null) return;
      clearTimeout(pending);
      pending = null;
      HTMLFormElement.prototype.submit.call(everyone);
    };
    everyone.addEventListener("submit", function (event) {
      event.preventDefault();
      if (pending !== null) return;
      document.querySelectorAll(".pizza-tick").forEach(function (t) {
        t.setAttribute("data-was", t.classList.contains("pizza-tick--on") ? "on" : "off");
        t.classList.add("pizza-tick--on");
      });
      banner = document.createElement("div");
      banner.className = "pizza-card pizza-undo";
      banner.setAttribute("role", "status");
      var words = document.createElement("span");
      words.textContent = everyone.getAttribute("data-everyone");
      var undo = document.createElement("button");
      undo.type = "button";
      undo.className = "canccu-button canccu-button--ghost";
      undo.textContent = everyone.getAttribute("data-undo");
      undo.addEventListener("click", function () {
        clearTimeout(pending);
        pending = null;
        banner.remove();
        everyone.hidden = false;
        document.querySelectorAll(".pizza-tick").forEach(function (t) {
          if (t.getAttribute("data-was") === "off") t.classList.remove("pizza-tick--on");
        });
      });
      banner.append(words, undo);
      everyone.hidden = true;
      everyone.after(banner);
      undo.focus();
      pending = setTimeout(send, 10000);
    });
    window.addEventListener("pagehide", function () {
      if (pending === null) return;
      clearTimeout(pending);
      pending = null;
      navigator.sendBeacon(everyone.action, new URLSearchParams(new FormData(everyone)));
    });
  }

  // The menu import: a chosen file fills the text the form sends.
  var file = document.querySelector("[data-csv-file]");
  if (file) {
    file.addEventListener("change", function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      chosen.text().then(function (text) {
        file.form.querySelector("textarea[name=csv]").value = text;
      });
    });
  }

  // Food settings: each slider says its time as it moves.
  document.querySelectorAll("input[data-minutes]").forEach(function (range) {
    var out = range.parentElement.querySelector("[data-minutes-out]");
    var form = range.form;
    var say = function () {
      var n = Number(range.value);
      var h = Math.floor(n / 60);
      var m = n % 60;
      var t = h === 0 ? form.dataset.min : m === 0 ? form.dataset.h : form.dataset.hmin;
      out.textContent = t
        .replace("{n}", h === 0 ? m : h)
        .replace("{h}", h)
        .replace("{m}", m);
    };
    range.addEventListener("input", say);
  });
})();
