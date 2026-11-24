// The money pages (#644): what is nicer with a script; every page works without it.
(function () {
  "use strict";

  // Copy a payer's MobilePay number or bank account: shown only where the clipboard is there.
  document.querySelectorAll("button[data-copy]").forEach(function (button) {
    if (!navigator.clipboard) return;
    button.hidden = false;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(button.getAttribute("data-copy")).then(function () {
        button.textContent = "✓";
      });
    });
  });

  // The amount pad: its keys type into the amount, as the phone's decimal keyboard does.
  var pad = document.querySelector("form[data-pad]");
  if (pad) {
    var amount = pad.querySelector("[data-pad-target]");
    var keys = pad.querySelector(".pizza-pad__keys");
    keys.hidden = false;
    amount.setAttribute("inputmode", "none");
    keys.addEventListener("click", function (event) {
      var key = event.target.closest("[data-pad-key]");
      if (!key) return;
      var k = key.getAttribute("data-pad-key");
      var v = amount.value.replace(",", ".");
      if (k === "back") v = v.slice(0, -1);
      else if (k === "." && v.indexOf(".") >= 0) return;
      else if (/\.\d\d$/.test(v)) return;
      else v = v + k;
      amount.value = v;
    });
  }

  // Scanning: a photo taken or picked is sent at once; without a script the form's button sends it.
  var scan = document.querySelector("form[data-reading]");
  if (scan) {
    scan.querySelectorAll("input[data-auto-send]").forEach(function (input) {
      input.addEventListener("change", function () {
        if (input.files && input.files.length > 0) scan.requestSubmit();
      });
    });
  }
})();
