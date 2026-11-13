/*
 * The Content page's playlist builder and Push now (#264; mockup 10), on studio.js's helpers. The
 * chosen playlist is edited here as one document: assets dragged in from the library (or added
 * from the list, for touch and keyboard), each item's length, its order by drag or by the arrow
 * buttons, the playlist's priority, and the run order as it will play; Save sends it whole with
 * its revision, so a change by someone else meanwhile is a conflict, never lost. The rules are
 * studio-playlist-builder.js's, which the API checks again.
 */
import {
  checkPlaylist,
  clock,
  moveItem,
  newItem,
  pushUntil,
  removeItem,
  runOrder,
} from "./studio-playlist-builder.js";

const { api, failure, reloadWith, say, show } = window.canccuStudio;
const PAGE = "/admin/screen/content";
const ASSET = "application/x-canccu-asset";
const ITEM = "application/x-canccu-item";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null));
  return node;
};
const read = (id) => JSON.parse(document.getElementById(id)?.textContent || "null");
const counted = (key, count, values = {}) =>
  say(count === 1 ? `${key}.one` : key, { count, ...values });
const isDeck = (kind) => kind === "pptx" || kind === "pdf";
const smallButton = (label, kind = "ghost") =>
  el("button", {
    type: "button",
    className: `canccu-button canccu-button--${kind} canccu-button--sm`,
    textContent: label,
  });

document.querySelector("[data-playlist-pick]")?.addEventListener("change", (e) => {
  e.target.form.submit();
});

const create = document.querySelector("form[data-playlist-new]");
create?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = new FormData(create);
  const body = { name: String(f.get("name")).trim(), type: f.get("type"), items: [] };
  const r = await api("POST", "/api/screen/playlists", body);
  if (!r.ok) return show(failure(r));
  reloadWith(say("playlist.created"), `${PAGE}?playlist=${encodeURIComponent(r.data.id)}`);
});

const box = document.querySelector("[data-playlist-editor]");
const doc = read("canccu-studio-playlist");
const library = read("canccu-studio-library") ?? {};
if (box && doc) builder(box, doc, box.dataset.write === "true");

function builder(box, doc, write) {
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
        ? (doc.break?.slideshow_dwell_seconds ?? null)
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

  const number = (label, value, min, onValue, props = {}) => {
    const input = el("input", {
      className: "canccu-input canccu-studio-item__num",
      type: "number",
      min,
      step: 1,
      value: value ?? "",
      ariaLabel: label,
      title: label,
      ...props,
    });
    input.addEventListener("input", () => {
      onValue(input.value === "" ? null : Number(input.value));
      changed();
    });
    return input;
  };

  /** An item's own fields: seconds, a video's own length, a deck's range and time per slide. */
  function fields(item, asset) {
    const set = (key) => (v) => (item[key] = v);
    if (!asset || (slideshow && asset.kind === "image")) return null;
    const out = el("div", { className: "canccu-studio-item__fields" });
    if (isDeck(asset.kind)) {
      out.append(
        number(say("playlist.from"), item.slide_start, 1, set("slide_start"), { placeholder: "1" }),
        el("span", { textContent: "–", ariaHidden: "true" }),
        number(say("playlist.to"), item.slide_end, 1, set("slide_end"), {
          placeholder: asset.slides ?? "",
        }),
      );
    }
    const seconds = number(
      say(isDeck(asset.kind) ? "playlist.seconds_each" : "playlist.seconds"),
      item.duration_seconds,
      1,
      set("duration_seconds"),
    );
    if (asset.kind === "video") {
      const own = el("input", { type: "checkbox", checked: item.duration_seconds === null });
      seconds.disabled = own.checked;
      own.addEventListener("change", () => {
        seconds.disabled = own.checked;
        item.duration_seconds = own.checked ? null : Number(seconds.value) || 15;
        seconds.value = item.duration_seconds ?? "";
        changed();
      });
      out.append(el("label", { className: "canccu-field--check" }, own, " ", say("playlist.own")));
    }
    out.append(seconds, el("span", { className: "canccu-small canccu-muted", textContent: "s" }));
    return out;
  }

  /** What an item shows, for those who read the playlist without editing it. */
  function detail(item, asset) {
    if (!asset || write) return null;
    if (slideshow && asset.kind === "image") {
      return say("playlist.in_slideshow", { seconds: state.slideshow_image_seconds ?? 10 });
    }
    if (isDeck(asset.kind) && asset.slides) {
      return say("playlist.slides", {
        from: item.slide_start ?? 1,
        to: Math.min(item.slide_end ?? asset.slides, asset.slides),
      });
    }
    return asset.kind === "video" && item.duration_seconds === null
      ? say("playlist.own_video")
      : null;
  }

  function itemRow(item, i) {
    const asset = library[item.asset_id];
    const length = el("span", { className: "canccu-studio-item__length" });
    const error = el("p", { className: "canccu-small canccu-studio-refused", hidden: true });
    const text = detail(item, asset);
    const li = el(
      "li",
      { className: "canccu-studio-item" },
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
        write ? fields(item, asset) : null,
        error,
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
      li.append(tools);
    }
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
        number(say("playlist.priority"), state.priority, 0, (v) => (state.priority = v ?? 0), {
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
      // studio.js acts on it: a second tap within 5 s deletes, then the page without it; that
      // second tap reaches this listener first, so leaving asks nothing about unsaved edits.
      remove.addEventListener("click", () => {
        if (remove.dataset.armed === "1") dirty = false;
      });
      Object.assign(remove.dataset, {
        call: "DELETE",
        url: `/api/screen/playlists/${encodeURIComponent(doc.id)}`,
        confirm: say("playlist.delete_confirm"),
        done: say("playlist.deleted"),
        next: PAGE,
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

// The library's cards are dragged into the builder by their asset id.
document.addEventListener("dragstart", (e) => {
  const card = e.target.closest?.("[data-drag-asset]");
  if (!card) return;
  e.dataTransfer.setData(ASSET, card.dataset.dragAsset);
  e.dataTransfer.effectAllowed = "copy";
});

const push = document.querySelector("form[data-push-form]");
if (push) {
  const timeZone = push.dataset.timeZone;
  const all = push.querySelector("[data-all]");
  const zones = [...push.querySelectorAll("input[name=zone]:not([data-all])")];
  all.addEventListener("change", () => {
    if (all.checked) zones.forEach((z) => (z.checked = false));
  });
  zones.forEach((z) => z.addEventListener("change", () => z.checked && (all.checked = false)));
  // "End of day" only while the day ends within the 12 hours a push may run.
  const day = push.querySelector("[data-preset=day]");
  if ("error" in pushUntil("day", Date.now(), timeZone, "")) day.closest("label").hidden = true;
  push.elements.at.addEventListener(
    "input",
    () => (push.querySelector("[data-preset=at]").checked = true),
  );

  push.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = new FormData(push);
    const picked = zones.filter((z) => z.checked).map((z) => z.value);
    if (!all.checked && picked.length === 0) return show(say("push.no_zone"));
    const until = pushUntil(String(f.get("for")), Date.now(), timeZone, String(f.get("at") || ""));
    if ("error" in until) return show(say(until.error));
    const [kind, id] = String(f.get("what")).split(/:(.*)/s);
    const body = {
      zones: all.checked ? [] : picked,
      [kind === "asset" ? "asset_id" : "playlist_id"]: id,
      until: new Date(until.ms).toISOString(),
    };
    const r = await api("POST", "/api/screen/push", body);
    if (!r.ok) return show(failure(r));
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
    reloadWith(say("push.done", { time: time.format(until.ms) }));
  });
}
