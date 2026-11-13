/*
 * The playlist builder's editor (#264; mockup 10), drawn into the Content page by
 * studio-playlists.js on studio.js's helpers. The chosen playlist is edited as one document: assets
 * dragged in from the library (or added from the list, for touch and keyboard), each item's length,
 * its order by drag or by the arrow buttons, the playlist's priority, and the run order as it will
 * play; Save sends it whole with its revision, so a change by someone else meanwhile is a
 * conflict, never lost. The rules are studio-playlist-builder.js's, which the API checks again.
 */
import {
  breakDwell,
  checkPlaylist,
  clock,
  moveItem,
  newItem,
  removeItem,
  runOrder,
} from "./studio-playlist-builder.js";
import { el, itemDetail, itemFields, numberField } from "./studio-playlist-item.js";

const { api, confirmed, failure, reloadWith, say, show } = window.canccuStudio;
export const PAGE = "/admin/screen/content";
export const ASSET = "application/x-canccu-asset";
const ITEM = "application/x-canccu-item";

const counted = (key, count, values = {}) =>
  say(count === 1 ? `${key}.one` : key, { count, ...values });
const smallButton = (label, kind = "ghost") =>
  el("button", {
    type: "button",
    className: `canccu-button canccu-button--${kind} canccu-button--sm`,
    textContent: label,
  });

export function builder(box, doc, write, library) {
  const state = {
    name: doc.name,
    priority: doc.priority,
    slideshow_image_seconds: doc.slideshow_image_seconds,
    items: doc.items.map((i) => ({ ...i })),
  };
  let dirty = false;
  let rows = [];
  // A break playlist in slideshow mode shows images for its dwell, as a slideshow does.
  const slideshow = doc.type === "slideshow" || doc.break?.mode === "slideshow";
  const asPlayed = () => ({
    ...state,
    type: slideshow ? "slideshow" : doc.type,
    slideshow_image_seconds:
      doc.type === "break"
        ? breakDwell(doc.break?.slideshow_dwell_seconds ?? null)
        : state.slideshow_image_seconds,
  });
  const summary = el("p", { className: "canccu-small canccu-muted" });
  const run = el("ol", { className: "canccu-studio-run" });
  const save = el("button", {
    type: "button",
    className: "canccu-button canccu-button--primary",
    textContent: say("playlist.save"),
  });
  const unsaved = el("span", { className: "canccu-small canccu-muted" });
  const changed = () => {
    dirty = true;
    refresh();
  };
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  /** Lengths, the cycle, refusals and the run order, without redrawing a field being typed in. */
  function refresh() {
    const order = runOrder(asPlayed(), library);
    const windows =
      doc.windows === 0 ? say("playlist.windows_none") : counted("playlist.windows", doc.windows);
    summary.textContent = [
      say(`playlist.type.${doc.type}`),
      counted("playlist.items", state.items.length),
      say("playlist.cycle", { time: clock(order.total) }),
      windows,
    ].join(" · ");
    const refusals = checkPlaylist(asPlayed(), library);
    order.rows.forEach((r, i) => {
      const row = rows[i];
      if (!row) return;
      row.length.textContent = r.skipped ? say(`playlist.skip.${r.skipped}`) : clock(r.seconds);
      const refused = refusals.find((x) => x.field === "items" && x.index === i);
      row.error.textContent = refused ? say(refused.key, refused.values) : "";
      row.error.hidden = !refused;
    });
    run.replaceChildren(
      ...order.rows
        .filter((r) => r.skipped === null)
        .map((r) =>
          el(
            "li",
            {},
            el("span", { className: "canccu-studio-run__at", textContent: clock(r.start) }),
            el("span", { textContent: library[state.items[r.index].asset_id]?.title ?? "" }),
            el("span", { className: "canccu-muted", textContent: clock(r.seconds) }),
          ),
        ),
    );
    save.disabled = !dirty;
    unsaved.textContent = dirty ? say("playlist.unsaved") : "";
  }

  const number = (label, value, min, onValue, props = {}) =>
    numberField(label, value, min, onValue, changed, props);

  function itemRow(item, i) {
    const asset = library[item.asset_id];
    const length = el("span", { className: "canccu-studio-item__length" });
    const error = el("p", { className: "canccu-small canccu-studio-refused", hidden: true });
    const text = write
      ? null
      : itemDetail(item, asset, slideshow, asPlayed().slideshow_image_seconds);
    const li = el(
      "li",
      { className: write ? "canccu-studio-item canccu-studio-item--edit" : "canccu-studio-item" },
      write
        ? el("span", {
            className: "canccu-studio-item__handle",
            textContent: "⋮⋮",
            title: say("playlist.drag"),
          })
        : null,
      el(
        "div",
        { className: "canccu-studio-item__main" },
        el("span", {
          className: "canccu-studio-item__title",
          textContent: asset?.title ?? item.asset_id,
        }),
        text === null
          ? null
          : el("span", { className: "canccu-small canccu-muted", textContent: ` · ${text}` }),
      ),
      length,
    );
    li.dataset.index = String(i);
    if (write) {
      li.draggable = true;
      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(ITEM, String(i));
        e.dataTransfer.effectAllowed = "move";
      });
      const tools = el("div", { className: "canccu-studio-item__tools" });
      const tool = (label, symbol, act, disabled) => {
        const b = smallButton(symbol);
        Object.assign(b, { ariaLabel: label, title: label, disabled });
        b.addEventListener("click", act);
        tools.append(b);
      };
      tool(say("playlist.move_up"), "↑", () => setItems(moveItem(state.items, i, i - 1)), i === 0);
      const last = i === state.items.length - 1;
      tool(say("playlist.move_down"), "↓", () => setItems(moveItem(state.items, i, i + 1)), last);
      tool(say("playlist.remove"), "✕", () => setItems(removeItem(state.items, i)), false);
      li.append(tools, itemFields(item, asset, slideshow, changed));
    }
    li.append(error);
    rows.push({ length, error });
    return li;
  }

  function setItems(items) {
    state.items = items;
    dirty = true;
    draw();
  }

  /** Where a drop lands: before the row under the pointer, or after it past its middle. */
  function dropIndex(e) {
    const li = e.target.closest?.("li[data-index]");
    if (!li) return state.items.length;
    const box = li.getBoundingClientRect();
    return Number(li.dataset.index) + (e.clientY > box.top + box.height / 2 ? 1 : 0);
  }

  function dropTarget(node) {
    node.addEventListener("dragover", (e) => {
      const types = [...e.dataTransfer.types];
      if (!types.includes(ASSET) && !types.includes(ITEM)) return;
      e.preventDefault();
      node.classList.add("canccu-is-active");
    });
    node.addEventListener("dragleave", () => node.classList.remove("canccu-is-active"));
    node.addEventListener("drop", (e) => {
      node.classList.remove("canccu-is-active");
      const at = dropIndex(e);
      const assetId = e.dataTransfer.getData(ASSET);
      const from = e.dataTransfer.getData(ITEM);
      if (!assetId && from === "") return;
      e.preventDefault();
      if (assetId && library[assetId]) {
        const items = [...state.items];
        items.splice(at, 0, newItem(assetId, library[assetId]));
        return setItems(items);
      }
      const i = Number(from);
      if (from !== "") setItems(moveItem(state.items, i, i < at ? at - 1 : at));
    });
  }

  function settings() {
    const name = el("input", {
      className: "canccu-input",
      value: state.name,
      maxLength: 80,
      ariaLabel: say("playlist.name"),
    });
    name.addEventListener("input", () => {
      state.name = name.value;
      changed();
    });
    const out = el(
      "div",
      { className: "canccu-studio-builder__settings" },
      el(
        "label",
        { className: "canccu-field" },
        el("span", { className: "canccu-label", textContent: say("playlist.name") }),
        name,
      ),
      el(
        "label",
        { className: "canccu-field", title: say("playlist.priority_hint") },
        el("span", { className: "canccu-label", textContent: say("playlist.priority") }),
        number(say("playlist.priority"), state.priority, 0, (v) => (state.priority = v), {
          max: 999,
        }),
      ),
    );
    if (doc.type === "slideshow") {
      out.append(
        el(
          "label",
          { className: "canccu-field" },
          el("span", { className: "canccu-label", textContent: say("playlist.image_seconds") }),
          number(
            say("playlist.image_seconds"),
            state.slideshow_image_seconds,
            1,
            (v) => (state.slideshow_image_seconds = v),
            { placeholder: "10" },
          ),
        ),
      );
    }
    return out;
  }

  function adder() {
    const add = el(
      "select",
      { className: "canccu-input", ariaLabel: say("playlist.add") },
      el("option", { value: "", textContent: say("playlist.add") }),
      ...Object.entries(library).map(([id, a]) =>
        el("option", { value: id, textContent: a.title }),
      ),
    );
    add.addEventListener("change", () => {
      if (add.value) setItems([...state.items, newItem(add.value, library[add.value])]);
    });
    const zone = el(
      "div",
      { className: "canccu-studio-builder__drop" },
      el("span", {
        className: "canccu-small canccu-muted",
        textContent: `+ ${say("playlist.drop")}`,
      }),
      add,
    );
    dropTarget(zone);
    return zone;
  }

  async function saveAll() {
    const refused = checkPlaylist(asPlayed(), library)[0];
    if (refused) {
      const reason = say(refused.key, refused.values);
      return show(
        refused.field === "items" ? say("playlist.fix", { n: refused.index + 1, reason }) : reason,
      );
    }
    save.disabled = true;
    const body = {
      name: state.name.trim(),
      type: doc.type,
      priority: state.priority,
      slideshow_image_seconds: state.slideshow_image_seconds,
      break: doc.break,
      items: state.items,
      revision: doc.revision,
    };
    const r = await api("PUT", `/api/screen/playlists/${encodeURIComponent(doc.id)}`, body);
    save.disabled = false;
    if (r.status === 409 && r.data?.error?.code === "version_conflict") {
      const again = smallButton(say("playlist.reload"), "secondary");
      again.addEventListener("click", () => {
        dirty = false;
        location.reload();
      });
      return show(say("playlist.conflict"), again);
    }
    if (!r.ok) return show(failure(r));
    dirty = false;
    reloadWith(say("playlist.saved"));
  }
  save.addEventListener("click", saveAll);

  function draw() {
    rows = [];
    const list = el("ol", { className: "canccu-studio-items" }, ...state.items.map(itemRow));
    if (state.items.length === 0) {
      list.append(
        el("li", { className: "canccu-small canccu-muted", textContent: say("playlist.empty") }),
      );
    }
    const parts = [summary];
    if (write) parts.push(settings());
    if (doc.type === "break")
      parts.push(
        el("p", {
          className: "canccu-small canccu-muted",
          textContent: say("playlist.break_note"),
        }),
      );
    parts.push(list);
    if (write) {
      dropTarget(list);
      parts.push(adder());
    }
    parts.push(el("h3", { className: "canccu-label", textContent: say("playlist.run") }), run);
    if (write) {
      const remove = el("button", {
        type: "button",
        className: "canccu-button canccu-button--danger-ghost canccu-button--sm",
        textContent: say("playlist.delete"),
      });
      // Asks once more on the button (studio.js's `confirmed`), then deletes; unsaved edits keep
      // their guard on leaving until the delete has gone through.
      Object.assign(remove.dataset, { confirm: say("playlist.delete_confirm") });
      remove.addEventListener("click", async () => {
        if (!confirmed(remove)) return;
        remove.disabled = true;
        const r = await api("DELETE", `/api/screen/playlists/${encodeURIComponent(doc.id)}`);
        remove.disabled = false;
        if (!r.ok) return show(failure(r));
        dirty = false;
        reloadWith(say("playlist.deleted"), PAGE);
      });
      parts.push(
        el(
          "div",
          { className: "canccu-cluster canccu-studio-builder__foot" },
          save,
          unsaved,
          remove,
        ),
      );
    }
    box.replaceChildren(...parts);
    refresh();
  }
  draw();
}
