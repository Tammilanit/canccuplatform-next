// Real progress for a photo form (#789 items 2 and 11, D11): the photo is sent with an upload bar,
// then the page says what the server is doing as it does it ("Reading the receipt…", "Checking
// the prices…"), read from the server's own steps, and goes where the server says. A read past
// the page's time limit says so and offers the form again; a busy reader's Try again counts down
// and sends itself. Without a script each form posts and redirects as before.
/* global XMLHttpRequest */
(function () {
  "use strict";

  function box(form) {
    var el = form.querySelector(".pizza-progress");
    if (el) return el;
    el = document.createElement("div");
    el.className = "pizza-progress";
    el.setAttribute("role", "status");
    var bar = document.createElement("progress");
    bar.className = "pizza-progress__bar";
    bar.max = 100;
    bar.value = 0;
    var text = document.createElement("span");
    text.className = "pizza-progress__text";
    el.appendChild(bar);
    el.appendChild(text);
    form.appendChild(el);
    return el;
  }

  function say(form, words, value) {
    var el = box(form);
    el.querySelector(".pizza-progress__text").textContent = words;
    var bar = el.querySelector(".pizza-progress__bar");
    // No value: the bar moves without a measure while the server works.
    if (value === null) bar.removeAttribute("value");
    else bar.value = value;
  }

  function busy(form, on) {
    form.querySelectorAll("button, input[type=file]").forEach(function (b) {
      b.disabled = on;
    });
  }

  function send(form, submitter) {
    var data = new FormData(form, submitter || undefined);
    var xhr = new XMLHttpRequest();
    var seen = 0;
    var done = false;
    xhr.open("POST", form.action);
    xhr.setRequestHeader("Accept", "application/x-ndjson");
    xhr.timeout = Number(form.getAttribute("data-timeout")) || 60000;
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable)
        say(form, form.getAttribute("data-sending"), Math.round((100 * e.loaded) / e.total));
    };
    xhr.onprogress = function () {
      var lines = xhr.responseText.slice(seen).split("\n");
      // The last piece may be a line still arriving.
      for (var i = 0; i < lines.length - 1; i++) {
        seen += lines[i].length + 1;
        var step;
        try {
          step = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (step.location) {
          done = true;
          window.location.assign(step.location);
        } else if (step.phase === "reading") {
          var words = form.getAttribute("data-reading") || "";
          say(form, words.replace("{s}", String(step.seconds || "")), null);
        } else if (step.phase === "checking") {
          say(form, form.getAttribute("data-checking"), null);
        }
      }
    };
    xhr.onload = xhr.onprogress;
    var lost = function () {
      if (done) return;
      say(form, form.getAttribute("data-lost"), 0);
      busy(form, false);
    };
    xhr.ontimeout = lost;
    xhr.onerror = lost;
    xhr.onloadend = function () {
      if (!done) lost();
    };
    busy(form, true);
    say(form, form.getAttribute("data-sending"), 0);
    xhr.send(data);
  }

  document.querySelectorAll("form[data-progress]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (typeof XMLHttpRequest === "undefined") return;
      event.preventDefault();
      send(form, event.submitter);
    });
  });

  // A busy reader: the page tries again by itself after the wait the reader named.
  document.querySelectorAll("form[data-countdown]").forEach(function (form) {
    var left = Number(form.getAttribute("data-countdown"));
    var note = form.querySelector("[data-countdown-note]");
    var words = form.getAttribute("data-countdown-text") || "";
    var tick = function () {
      if (note) note.textContent = words.replace("{n}", String(left));
      if (left <= 0) {
        form.requestSubmit();
        return;
      }
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  });
})();
