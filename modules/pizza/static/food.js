// The attendee's Food pages' touches (#119); every page works without them.
"use strict";

(function () {
  // Live (D13, E16): the page follows the API's stream and draws itself again on a change, from
  // the page's own answer, so it shows what the caller may see. No polling: a dropped stream
  // shows "Reconnecting…", keeps the last state, and reads the page again once it is back.
  var main = document.querySelector("[data-live]");
  if (main && window.EventSource) {
    var banner = null;
    var timer = null;
    var pending = false;
    var busy = function () {
      // Never redraw under someone's fingers: a field in use waits for the next change.
      var el = document.activeElement;
      return el && main.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    };
    var redraw = function () {
      if (busy()) {
        pending = true;
        return;
      }
      pending = false;
      fetch(location.href, { credentials: "same-origin", headers: { accept: "text/html" } })
        .then(function (res) {
          return res.ok ? res.text() : null;
        })
        .then(function (text) {
          if (text === null) return;
          var next = new DOMParser()
            .parseFromString(text, "text/html")
            .querySelector("[data-live]");
          if (next) main.innerHTML = next.innerHTML;
        })
        .catch(function () {
          // Offline again: the stream's own error shows it, and its return reads the page anew.
        });
    };
    var soon = function () {
      clearTimeout(timer);
      // A burst of events (a pizza, its order's count) makes one read.
      timer = setTimeout(redraw, 250);
    };
    var offline = function (on) {
      if (on && !banner) {
        banner = document.createElement("p");
        banner.className = "canccu-notice canccu-notice--warn pizza-live";
        banner.setAttribute("role", "status");
        banner.textContent = main.getAttribute("data-offline") || "…";
        main.parentNode.insertBefore(banner, main);
      } else if (!on && banner) {
        banner.remove();
        banner = null;
      }
    };
    var seen = false;
    var wait = 3000;
    var connect = function () {
      var source = new EventSource(main.getAttribute("data-live"));
      source.addEventListener("ready", function () {
        offline(false);
        wait = 3000;
        // Also after a first failure: the page may have missed changes before it ever connected.
        if (seen) soon();
        seen = true;
      });
      source.addEventListener("change", soon);
      source.addEventListener("error", function () {
        offline(true);
        seen = true;
        // A non-200 answer (a restart behind the proxy, a 502) closes an EventSource for good:
        // the browser only retries a clean drop, so open a new one, backing off.
        if (source.readyState !== EventSource.CLOSED) return;
        setTimeout(connect, wait);
        wait = Math.min(wait * 2, 30000);
      });
    };
    connect();
    document.addEventListener("focusout", function () {
      if (pending) soon();
    });
  }

  // The menu's filter as you type, as the legacy menu filter matches: name or ingredient.
  var filter = document.querySelector("[data-filter]");
  if (filter) {
    filter.addEventListener("input", function () {
      var q = filter.value.trim().toLowerCase();
      document.querySelectorAll("[data-item]").forEach(function (row) {
        row.hidden = q !== "" && row.getAttribute("data-item").indexOf(q) === -1;
      });
    });
  }

  // Own pizza: the toppings stop at the limit, as the API counts them.
  var toppings = document.querySelector("[data-toppings]");
  if (toppings) {
    var max = Number(toppings.getAttribute("data-toppings"));
    var boxes = toppings.querySelectorAll("input[type=checkbox]");
    var cap = function () {
      var on = toppings.querySelectorAll("input:checked").length;
      boxes.forEach(function (box) {
        box.disabled = !box.checked && on >= max;
      });
    };
    // The own pizza's price as you choose, by the rule of validate.ts ownPizzaPrice (#789).
    var priced = document.querySelector("[data-own-price]");
    var total = priced && priced.querySelector("[data-own-total]");
    var euros = new Intl.NumberFormat(document.documentElement.lang === "fi" ? "fi-FI" : "en-IE", {
      style: "currency",
      currency: "EUR",
    });
    var run = function () {
      if (!total) return;
      var num = function (el, name) {
        var v = el.getAttribute(name);
        return v === null ? null : Number(v);
      };
      var included = num(priced, "data-included");
      var extra = num(priced, "data-extra");
      var sum = num(priced, "data-own-price");
      var normals = 0;
      toppings.querySelectorAll("input:checked").forEach(function (box) {
        var special = box.getAttribute("data-tier") === "special";
        var p = num(box, "data-price");
        if (included !== null && !special) normals += 1;
        else sum = sum === null || p === null ? null : sum + p;
      });
      if (included !== null && normals > included)
        sum = sum === null || extra === null ? null : sum + (normals - included) * extra;
      total.textContent = sum === null ? "" : euros.format(sum / 100);
    };
    boxes.forEach(function (box) {
      box.addEventListener("change", cap);
      box.addEventListener("change", run);
    });
    cap();
  }
})();
