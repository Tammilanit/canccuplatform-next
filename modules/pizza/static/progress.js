// Real progress for a photo form (#789 items 2 and 11, D11): the photo is sent with an upload bar,
// then the page says what the server is doing as it does it ("Reading the receipt…", "Checking
// the prices…"), read from the server's own steps, and goes where the server says. A read past
// the page's time limit says so and offers the form again; a busy reader's Try again counts down
// and sends itself. A menu read (#789 items 2 and 15) says how many pages it reads, waits longer
// for more pages, and ends with its table's fields to post (the table is kept nowhere else); a
// button marked `data-plain` (the table's own actions) sends the form as it is. Without a script
// each form posts and redirects as before.
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

  // The page's limit grows with the pages sent: the form names one per count.
  function timeoutOf(form, data) {
    var limits = (form.getAttribute("data-timeouts") || "").split(",").map(Number);
    var pages = 0;
    data.forEach(function (v) {
      if (typeof v === "object" && v && v.size > 0) pages += 1;
    });
    var limit = limits[Math.max(1, pages) - 1] || limits[limits.length - 1];
    return limit || Number(form.getAttribute("data-timeout")) || 60000;
  }

  // A result kept nowhere but in its form: posted as a page of its own.
  function post(target) {
    var f = document.createElement("form");
    f.method = "post";
    f.action = target.action;
    Object.keys(target.fields).forEach(function (name) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = target.fields[name];
      f.appendChild(input);
    });
    document.body.appendChild(f);
    f.submit();
  }

  function send(form, submitter) {
    var data = new FormData(form, submitter || undefined);
    var xhr = new XMLHttpRequest();
    var seen = 0;
    var done = false;
    xhr.open("POST", form.action);
    xhr.setRequestHeader("Accept", "application/x-ndjson");
    xhr.timeout = timeoutOf(form, data);
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
        } else if (step.post) {
          done = true;
          post(step.post);
        } else if (step.phase === "reading") {
          var many = step.pages > 1 && form.getAttribute("data-reading-pages");
          var words = many || form.getAttribute("data-reading") || "";
          say(
            form,
            words
              .replace("{n}", String(step.pages || ""))
              .replace("{s}", String(step.seconds || "")),
            null,
          );
        } else if (step.phase === "checking") {
          say(form, form.getAttribute("data-checking"), null);
        }
      }
    };
    xhr.onload = xhr.onprogress;
    var lost = function () {
      if (done) return;
      done = true;
      xhr.abort();
      say(form, form.getAttribute("data-lost"), 0);
      busy(form, false);
      // The same button sends the form again.
      var retry = form.getAttribute("data-retry-label");
      var again = submitter || form.querySelector("button[type=submit]:not([data-plain])");
      if (retry && again) again.textContent = retry;
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
      if (event.submitter && event.submitter.hasAttribute("data-plain")) return;
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
