/*
 * The window editor on the schedule page (#267, plan #190 S4; mockup 09), on studio.js's helpers.
 * Add window and a window's Edit open one dialog; Save creates, or replaces with the revision the
 * page read, and Delete asks with a second tap (brief N1). With a mouse or a pen, a drag on a day
 * opens the dialog for a new window there, a weekly window's block moves by its drag and changes
 * its end by its lower edge, all on a 15-minute snap, and saves at once. Touch keeps its scroll:
 * on a phone the dialog does it all. A revision someone else replaced answers 409, and a window
 * someone deleted 404: both say so and offer a reload (E7). Every change goes through the API,
 * which checks the right and audits; the page holds no right of its own.
 */
import {
  clock,
  createdTimes,
  isoDay,
  movedTimes,
  resizedTimes,
  windowBody,
} from "./studio-schedule-edit.js";

const { api, failure, reloadWith, say, show } = window.canccuStudio;
const dialog = document.getElementById("canccu-sched-editor");
const form = dialog?.querySelector("form[data-window-form]");
const grid = document.querySelector(".canccu-sched__grid[data-axis]");

if (dialog && form) {
  const API = "/api/screen/schedules";
  const windows = JSON.parse(
    document.getElementById("canccu-sched-windows")?.textContent || '{"schedules":[]}',
  ).schedules;
  const byId = (id) => windows.find((w) => w.id === id);
  const f = form.elements;
  const error = form.querySelector("[data-window-error]");
  const remove = form.querySelector("[data-window-delete]");
  const title = form.querySelector("#canccu-sched-editor-title");

  const conflict = () => {
    const again = Object.assign(document.createElement("button"), {
      type: "button",
      className: "canccu-button canccu-button--secondary canccu-button--sm",
      textContent: say("window.reload"),
    });
    again.addEventListener("click", () => location.reload());
    show(say("window.conflict"), again);
  };
  /** The API's answer as words on the page, or a reload with the done message carried over. */
  async function act(method, url, body, done) {
    const r = await api(method, url, body);
    if (r.status === 409 || (r.status === 404 && method !== "POST")) {
      dialog.close();
      return conflict();
    }
    if (!r.ok) {
      error.textContent = failure(r);
      error.hidden = false;
      if (!dialog.open) show(failure(r));
      return;
    }
    reloadWith(say(done));
  }

  const kindShown = () => {
    const bound = f.kind.value === "bound";
    for (const part of form.querySelectorAll("[data-kind]")) {
      part.hidden = part.dataset.kind !== (bound ? "bound" : "weekly");
    }
  };
  form.addEventListener("change", (event) => {
    if (event.target.name === "kind") kindShown();
  });

  /** The dialog for a new window (`w` without an id, maybe from a drag) or for window `w`. */
  function open(w) {
    // The markup holds a new window's defaults; without the reset a new window would start from
    // whatever the last dialog held, and a quick Save would copy it.
    form.reset();
    disarm();
    const editing = w.id !== undefined;
    title.textContent = editing ? title.dataset.edit : title.dataset.new;
    f.id.value = w.id ?? "";
    f.revision.value = w.revision ?? "";
    f.zone_key.value = w.zone_key ?? dialog.dataset.zone;
    if (w.playlist_id) f.playlist_id.value = w.playlist_id;
    f.priority.value = w.priority ?? 10;
    f.layout_id.value = w.layout_id ?? "";
    f.kind.value = w.agenda_item_id ? "bound" : "weekly";
    f.agenda_item_id.value = w.agenda_item_id ?? "";
    if (w.days) for (const box of f.days) box.checked = w.days.includes(Number(box.value));
    if (w.start_minute !== undefined) f.start.value = clock(w.start_minute);
    if (w.end_minute !== undefined) f.end.value = clock(w.end_minute);
    remove.hidden = !editing;
    error.hidden = true;
    kindShown();
    dialog.showModal();
    f.playlist_id.focus();
  }

  document.querySelector("[data-window-new]")?.addEventListener("click", () => open({}));
  document.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-window-edit]");
    const w = edit && byId(edit.dataset.windowEdit);
    if (!w) return;
    edit.closest("[popover]")?.hidePopover();
    open(w);
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => disarm());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const days = [...f.days].filter((box) => box.checked).map((box) => box.value);
    const fields = Object.fromEntries(
      [
        "zone_key",
        "playlist_id",
        "priority",
        "layout_id",
        "kind",
        "start",
        "end",
        "agenda_item_id",
      ].map((k) => [k, f[k].value]),
    );
    const made = windowBody({ ...fields, days });
    if (!made.ok) {
      error.textContent = say(made.error);
      error.hidden = false;
      return;
    }
    if (!f.id.value) return act("POST", API, made.body, "window.created");
    const body = { ...made.body, revision: Number(f.revision.value) };
    return act("PUT", `${API}/${encodeURIComponent(f.id.value)}`, body, "window.saved");
  });

  // A second tap within 5 s deletes; the first only asks. Opening or closing the dialog disarms,
  // so the first tap on one window never counts as the second on another.
  const label = remove.textContent;
  let disarming = 0;
  function disarm() {
    window.clearTimeout(disarming);
    remove.dataset.armed = "";
    remove.textContent = label;
  }
  remove.addEventListener("click", () => {
    if (remove.dataset.armed !== "1") {
      remove.dataset.armed = "1";
      remove.textContent = remove.dataset.confirm;
      disarming = setTimeout(disarm, 5000);
      return;
    }
    const url = `${API}/${encodeURIComponent(f.id.value)}?revision=${encodeURIComponent(f.revision.value)}`;
    return act("DELETE", url, undefined, "window.deleted");
  });

  if (grid) {
    const [axisStart, axisEnd] = grid.dataset.axis.split(" ").map(Number);
    /** The axis minute under the pointer, in the column `body`. */
    const minuteAt = (body, y) => {
      const box = body.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (y - box.top) / box.height));
      return axisStart + ratio * (axisEnd - axisStart);
    };
    const minutesPerPixel = (body) => (axisEnd - axisStart) / body.getBoundingClientRect().height;
    let drag = null;
    // A drag that moved swallows the click that ends it, so it does not also open the popover.
    let swallow = false;

    grid.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      const body = event.target.closest(".canccu-sched__body");
      const block = event.target.closest("[data-window]");
      if (!body || (block && !block.hasAttribute("data-drag"))) return;
      if (event.target.closest("[popover]")) return;
      const lane = event.target.closest("[data-zone]");
      const day = event.target.closest("[data-date]");
      drag = {
        body,
        block,
        lane,
        date: day?.dataset.date,
        mode: block ? (event.target.closest("[data-resize]") ? "resize" : "move") : "create",
        fromY: event.clientY,
        from: minuteAt(body, event.clientY),
        height: block?.getBoundingClientRect().height ?? 0,
        moved: false,
        mark: null,
      };
    });

    grid.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dy = event.clientY - drag.fromY;
      if (!drag.moved) {
        if (Math.abs(dy) < 4) return;
        // Captured only once it is a drag: a plain click must still reach the block's popover.
        drag.moved = true;
        grid.setPointerCapture(event.pointerId);
      }
      if (drag.mode === "create") {
        if (!drag.mark) {
          drag.mark = Object.assign(document.createElement("div"), {
            className: "canccu-sched__drawing",
          });
          (drag.lane ?? drag.body).append(drag.mark);
        }
        const [a, b] = [drag.from, minuteAt(drag.body, event.clientY)].sort((x, y) => x - y);
        const span = axisEnd - axisStart;
        drag.mark.style.top = `${((a - axisStart) / span) * 100}%`;
        drag.mark.style.height = `${((b - a) / span) * 100}%`;
      } else if (drag.mode === "move") {
        drag.block.style.transform = `translateY(${dy}px)`;
      } else {
        drag.block.style.height = `${Math.max(8, drag.height + dy)}px`;
      }
    });

    const end = async (event, cancelled) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.mark?.remove();
      if (d.block) d.block.removeAttribute("style");
      if (!d.moved || cancelled) return;
      swallow = true;
      setTimeout(() => (swallow = false), 0);
      if (d.mode === "create") {
        const t = createdTimes(d.date, d.from, minuteAt(d.body, event.clientY));
        return open({ zone_key: d.lane?.dataset.zone, days: [isoDay(t.date)], ...t });
      }
      const w = byId(d.block.dataset.window);
      if (!w) return;
      const delta = (event.clientY - d.fromY) * minutesPerPixel(d.body);
      const times = d.mode === "move" ? movedTimes(w, delta) : resizedTimes(w, delta);
      if (times === null) return;
      const body = {
        zone_key: w.zone_key,
        playlist_id: w.playlist_id,
        priority: w.priority,
        layout_id: w.layout_id,
        // A move carries its shifted days; a resize keeps the window's own.
        days: w.days,
        ...times,
        revision: w.revision,
      };
      await act("PUT", `${API}/${encodeURIComponent(w.id)}`, body, "window.saved");
    };
    grid.addEventListener("pointerup", (event) => end(event, false));
    grid.addEventListener("pointercancel", (event) => end(event, true));
    grid.addEventListener(
      "click",
      (event) => {
        if (!swallow) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }
}
