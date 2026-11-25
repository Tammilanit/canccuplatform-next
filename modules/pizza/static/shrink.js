// Photos shrunk on the phone before they are sent (#789 item 10, D8): a phone's full-size photo
// can be 20–30 MB, slow to send over the event's network; 2,000 px on its long side is more than
// the server keeps (1,600, or 2,400 for a tall receipt), so nothing readable is lost. Without a
// script, or a browser that cannot redraw the photo, the form sends it as it is and the server
// shrinks it.
/* global createImageBitmap, DataTransfer, File */
(function () {
  "use strict";

  var EDGE = 2000;
  // A receipt more than twice as tall as wide keeps more, as the server does.
  var TALL_EDGE = 2400;
  var QUALITY = 0.85;

  if (typeof createImageBitmap !== "function" || typeof DataTransfer !== "function") return;

  function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bitmap) {
      var w = bitmap.width;
      var h = bitmap.height;
      var edge = h > 2 * w ? TALL_EDGE : EDGE;
      var scale = Math.min(1, edge / Math.max(w, h));
      // A small JPEG goes as it is: redrawing it would only lose quality.
      if (scale === 1 && file.type === "image/jpeg") return file;
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      var ctx = canvas.getContext("2d");
      // A PNG's transparent parts become white, as the server's JPEG makes them.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve) {
        canvas.toBlob(
          function (blob) {
            if (!blob) return resolve(file);
            var name = file.name.replace(/\.[^.]*$/, "") + ".jpg";
            resolve(new File([blob], name, { type: "image/jpeg" }));
          },
          "image/jpeg",
          QUALITY,
        );
      });
    });
  }

  function shrinkInput(input) {
    var files = Array.prototype.slice.call(input.files || []);
    if (files.length === 0) return Promise.resolve();
    return Promise.all(files.map(shrink)).then(function (small) {
      var dt = new DataTransfer();
      small.forEach(function (f) {
        dt.items.add(f);
      });
      input.files = dt.files;
    });
  }

  // Caught before any other submit listener (the page's "Reading…", the progress): the form is
  // held, its photos redrawn, then sent again with the submitter it had.
  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!form.hasAttribute || !form.hasAttribute("data-shrink")) return;
      if (form.getAttribute("data-shrunk") === "1") {
        form.removeAttribute("data-shrunk");
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      var submitter = event.submitter || null;
      var inputs = Array.prototype.slice.call(form.querySelectorAll("input[type=file]"));
      Promise.all(inputs.map(shrinkInput))
        .catch(function () {
          // A photo the browser cannot redraw goes as it is: the server shrinks it.
        })
        .then(function () {
          // A task later, not a microtask: with no photo to redraw this runs while the first
          // submit event is still being dispatched, and the browser drops a submit from there.
          setTimeout(function () {
            form.setAttribute("data-shrunk", "1");
            if (submitter && submitter.form === form) form.requestSubmit(submitter);
            else form.requestSubmit();
          }, 0);
        });
    },
    true,
  );
})();
