// The photo viewer (#789 item 14): a receipt's photo opens over the page and closes on ✕, Esc, a
// tap outside the photo and a swipe down. Without a script the link opens the photo itself.
(function () {
  "use strict";

  // A swipe this far down closes, as a phone's own photo viewers do.
  var SWIPE_PX = 80;
  var dialog = null;

  function make(closeLabel) {
    var d = document.createElement("dialog");
    d.className = "pizza-viewer";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "pizza-viewer__close";
    close.setAttribute("aria-label", closeLabel);
    close.textContent = "✕";
    close.addEventListener("click", function () {
      d.close();
    });
    var img = document.createElement("img");
    img.className = "pizza-viewer__photo";
    img.alt = "";
    d.appendChild(close);
    d.appendChild(img);
    // The dialog's box is the backdrop's too: a click on it, not on the photo or ✕, is outside.
    d.addEventListener("click", function (event) {
      if (event.target === d) d.close();
    });
    var startY = null;
    var startX = 0;
    d.addEventListener("touchstart", function (event) {
      // On a pinch-zoomed page a drag pans the photo; closing then would lose the zoom.
      var zoomed = window.visualViewport && window.visualViewport.scale > 1;
      startY = event.touches.length === 1 && !zoomed ? event.touches[0].clientY : null;
      startX = event.touches.length === 1 ? event.touches[0].clientX : 0;
    });
    // A second finger (pinch) cancels the gesture.
    d.addEventListener("touchmove", function (event) {
      if (event.touches.length > 1) startY = null;
    });
    d.addEventListener("touchend", function (event) {
      if (startY === null) return;
      var dy = event.changedTouches[0].clientY - startY;
      var dx = Math.abs(event.changedTouches[0].clientX - startX);
      startY = null;
      // Mostly vertical, so a sideways drag is not a close.
      if (dy >= SWIPE_PX && dy > dx) d.close();
    });
    document.body.appendChild(d);
    return d;
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[data-viewer]");
    if (!link || typeof HTMLDialogElement === "undefined") return;
    // A new tab or window (Ctrl, Cmd, Shift, a middle click) is the browser's to open.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (dialog === null) dialog = make(link.getAttribute("data-viewer"));
    var img = dialog.querySelector("img");
    var inner = link.querySelector("img");
    img.removeAttribute("src"); // the previous receipt must not show while the new one loads
    img.src = link.getAttribute("href");
    img.alt = inner ? inner.alt : "";
    dialog.showModal();
  });
})();
