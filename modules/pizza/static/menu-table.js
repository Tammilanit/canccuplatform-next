// A menu read's table, edited in place (#789 item 3): "Add a row", a row's delete and its merge
// into the row above change the table on the page, without sending it. The rows keep their
// field names (row[i][…]); the server reads them in the order of i, so a row removed here
// leaves only a gap. Without a script each of these buttons posts the table and the server
// draws it again.
(function () {
  "use strict";

  var form = document.querySelector("form[data-menu-table]");
  if (!form) return;
  var template = form.querySelector("template[data-row-template]");
  var items = form.querySelector("tbody[data-items]");

  function field(row, name) {
    var i = row.getAttribute("data-row");
    return form.querySelector('[name="row[' + i + "][" + name + ']"]');
  }

  // Each section's first row has no row above to merge into; the rest point at the one above.
  function relink() {
    form.querySelectorAll("tbody").forEach(function (body) {
      var above = null;
      body.querySelectorAll("tr[data-row]").forEach(function (row) {
        var merge = row.querySelector('button[value^="merge:"]');
        var i = row.getAttribute("data-row");
        if (merge) {
          merge.hidden = above === null;
          merge.value = "merge:" + (above === null ? i : above) + ":" + i;
        }
        above = i;
      });
    });
  }

  function next() {
    var most = -1;
    form.querySelectorAll("tr[data-row]").forEach(function (row) {
      most = Math.max(most, Number(row.getAttribute("data-row")));
    });
    return most + 1;
  }

  function addRow() {
    var i = String(next());
    var markup = template.innerHTML.split("__i__").join(i);
    var holder = document.createElement("tbody");
    holder.innerHTML = markup;
    var row = holder.querySelector("tr");
    items.appendChild(row);
    relink();
    var number = field(row, "number");
    if (number) number.focus();
  }

  // The row above keeps what it has; what it lacks comes from the row merged into it.
  function merge(into, from) {
    ["number", "description", "price", "category"].forEach(function (name) {
      var a = field(into, name);
      var b = field(from, name);
      if (a && b && a.value.trim() === "" && b.value.trim() !== "") a.value = b.value;
    });
    var flags = field(into, "flags");
    var theirs = field(from, "flags");
    if (
      flags &&
      theirs &&
      theirs.value.indexOf("unsure") !== -1 &&
      flags.value.indexOf("unsure") === -1
    )
      flags.value = flags.value ? flags.value + ",unsure" : "unsure";
    from.remove();
  }

  form.addEventListener("click", function (event) {
    var b = event.target.closest ? event.target.closest("button[name=do]") : null;
    if (!b) return;
    var parts = b.value.split(":");
    var row = b.closest("tr[data-row]");
    if (parts[0] === "add") {
      event.preventDefault();
      addRow();
    } else if (parts[0] === "delete" && row) {
      event.preventDefault();
      row.remove();
      relink();
    } else if (parts[0] === "merge" && row) {
      event.preventDefault();
      var into = form.querySelector('tr[data-row="' + parts[1] + '"]');
      if (into && into !== row) merge(into, row);
      relink();
    }
  });
})();
