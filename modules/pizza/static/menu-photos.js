// A menu's pages before they are read (#789 items 1 and 15): each photo taken or chosen joins
// the pages, shown as a numbered thumbnail to move up, move down or remove, up to the form's
// limit; "Add another page" opens the camera again; the cost estimate follows the pages. The
// pages travel in one file field in their order, so the server reads them as one menu in that
// order. Without a script each field sends its own photos as they are.
/* global createImageBitmap, DataTransfer */
(function () {
  "use strict";

  var form = document.querySelector("form[data-pages]");
  if (!form || typeof DataTransfer !== "function") return;
  var max = Number(form.getAttribute("data-max-pages")) || 6;
  var inputs = Array.prototype.slice.call(form.querySelectorAll("input[data-page-input]"));
  var thumbs = form.querySelector("[data-thumbs]");
  var add = form.querySelector("[data-add-page]");
  var estimate = form.querySelector("[data-estimate]");
  var camera = form.querySelector("input[data-page-input][capture]");
  var pages = [];

  // The pages' one field: the visible ones only collect, so a page is never sent twice.
  var carrier = document.createElement("input");
  carrier.type = "file";
  carrier.name = "photo";
  carrier.multiple = true;
  carrier.hidden = true;
  form.appendChild(carrier);

  function label(text, n) {
    return (text || "").replace("{n}", String(n));
  }

  function costText(n) {
    var each = Number(estimate.getAttribute("data-page-cost")) || 1500;
    var cost = "$" + ((n * each) / 1000000).toFixed(4);
    if (n <= 1)
      return label(estimate.getAttribute("data-estimate-one"), n).replace(
        "{cost}",
        "$" + (each / 1000000).toFixed(4),
      );
    return label(estimate.getAttribute("data-estimate"), n).replace("{cost}", cost);
  }

  // A small picture of the page: drawn, as the page allows no blob: images.
  function preview(file) {
    var canvas = document.createElement("canvas");
    canvas.className = "pizza-thumbs__image";
    canvas.width = 96;
    canvas.height = 128;
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file)
        .then(function (bitmap) {
          var scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
          var w = bitmap.width * scale;
          var h = bitmap.height * scale;
          canvas
            .getContext("2d")
            .drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        })
        .catch(function () {
          // A photo the browser cannot draw is still a page; the server reads it.
        });
    }
    return canvas;
  }

  function button(text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "canccu-button canccu-button--ghost";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function move(i, by) {
    var j = i + by;
    if (j < 0 || j >= pages.length) return;
    var page = pages[i];
    pages[i] = pages[j];
    pages[j] = page;
    render();
  }

  function render() {
    var dt = new DataTransfer();
    pages.forEach(function (p) {
      dt.items.add(p.file);
    });
    carrier.files = dt.files;
    thumbs.textContent = "";
    pages.forEach(function (p, i) {
      var li = document.createElement("li");
      li.className = "pizza-thumbs__page";
      var name = document.createElement("span");
      name.textContent = label(thumbs.getAttribute("data-page-label"), i + 1);
      li.appendChild(p.preview);
      li.appendChild(name);
      var tools = document.createElement("span");
      tools.className = "pizza-thumbs__tools";
      if (i > 0)
        tools.appendChild(
          button(thumbs.getAttribute("data-up"), function () {
            move(i, -1);
          }),
        );
      if (i < pages.length - 1)
        tools.appendChild(
          button(thumbs.getAttribute("data-down"), function () {
            move(i, 1);
          }),
        );
      tools.appendChild(
        button(thumbs.getAttribute("data-remove"), function () {
          pages.splice(i, 1);
          render();
        }),
      );
      li.appendChild(tools);
      thumbs.appendChild(li);
    });
    thumbs.hidden = pages.length === 0;
    add.hidden = pages.length === 0 || pages.length >= max;
    estimate.textContent = costText(Math.max(1, pages.length));
    var limits = (form.getAttribute("data-timeouts") || "").split(",");
    var limit = limits[Math.max(1, pages.length) - 1];
    if (limit) form.setAttribute("data-timeout", limit);
  }

  inputs.forEach(function (input) {
    input.removeAttribute("name");
    input.addEventListener("change", function () {
      Array.prototype.slice.call(input.files || []).forEach(function (file) {
        if (pages.length < max) pages.push({ file: file, preview: preview(file) });
      });
      input.value = "";
      render();
    });
  });

  if (add && camera)
    add.addEventListener("click", function () {
      camera.click();
    });
})();
