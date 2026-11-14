/*
 * The zone editor (step 3 plan U6; mockup 08), on top of static/studio.js's helpers. The map
 * places each region on the layout's grid and opens its detail; widgets reorder by drag or by
 * their buttons. The form becomes a `Zone` again, the Changes list says what differs from the zone
 * read, the real player previews it, and Go live saves it with the revision read.
 */
import { boxEditor } from "./studio-layout.js";
import { previewAt, screenPreview } from "./studio-screen-preview.js";

(() => {
  const studio = window.canccuStudio;
  const form = document.querySelector("form[data-zone]");
  if (!studio || !form) return;
  const { api, failure, reloadWith, say, show, notice } = studio;
  const UNDO_MS = 10 * 60_000;
  const PREVIEW_MESSAGE = "canccu-screen-preview";
  const original = JSON.parse(form.dataset.zone);
  const undoKey = `canccu-studio-undo:${original.key}`;
  const url = `/api/screen/zones/${encodeURIComponent(original.key)}`;
  const regions = () => [...form.querySelectorAll("section[data-region]")];
  const entriesOf = (r) =>
    [...r.querySelectorAll("[data-widgets] li")].map((li) => JSON.parse(li.dataset.entry));

  // The boxes, the gallery and the hero role (studio-layout.js); a tap on a box opens its region.
  const boxes = boxEditor(form, { say, tell: show, changed: () => changed() });
  for (const pick of form.querySelectorAll("[data-pick]")) {
    pick.addEventListener("click", () => {
      for (const p of form.querySelectorAll("[data-pick]"))
        p.setAttribute("aria-pressed", String(p === pick));
      for (const r of regions()) r.hidden = r.dataset.region !== pick.dataset.pick;
    });
  }

  // Each widget's seconds: its own, else the region's field, else the layout's default.
  const dwellOf = (r) => r.querySelector("[name=dwell_seconds]").value || r.dataset.layoutDwell;
  function refreshRegion(r) {
    const layoutWidgets = r.querySelector("[name=layout_widgets]").checked;
    r.querySelector("[data-widgets]").classList.toggle(
      "canccu-studio-widgets--layout",
      layoutWidgets,
    );
    for (const li of r.querySelectorAll("[data-widgets] li")) {
      if (li.dataset.ownDwell !== undefined) continue;
      li.querySelector(".canccu-studio-widget__meta").textContent = say("zone.widget_dwell", {
        seconds: dwellOf(r),
      });
    }
    // The photo wall's settings show while the box lists a photo (src/studio/widget-settings.ts).
    const wall = r.querySelector("[data-photo-wall]");
    if (wall) wall.hidden = !entriesOf(r).some((e) => e.widget === "photo");
    const names = [...r.querySelectorAll(".canccu-studio-widget__name")].map((n) => n.textContent);
    const shows = form.querySelector(`[data-pick="${CSS.escape(r.dataset.region)}"] [data-shows]`);
    if (shows && names.length > 0) shows.textContent = names.join(" → ");
  }

  form.addEventListener("click", (event) => {
    const move = event.target.closest("[data-widget-move]");
    const add = event.target.closest("[data-widget-add]");
    if (!move && !add) return;
    const region = event.target.closest("[data-region]");
    if (move) {
      const row = move.closest("li");
      const how = move.dataset.widgetMove;
      if (how === "up" && row.previousElementSibling) row.after(row.previousElementSibling);
      else if (how === "down" && row.nextElementSibling) row.before(row.nextElementSibling);
      else if (how === "remove") row.remove();
    } else {
      const choice = region.querySelector("[name=add]");
      const row = form
        .querySelector("template[data-widget-row]")
        .content.firstElementChild.cloneNode(true);
      row.dataset.entry = JSON.stringify({ widget: choice.value });
      row.querySelector(".canccu-studio-widget__name").textContent =
        choice.selectedOptions[0].textContent.trim();
      region.querySelector("[data-widgets]").append(row);
    }
    region.querySelector("[name=layout_widgets]").checked = false;
    changed(region);
  });

  // Drag a row by its handle (or anywhere on it) to another place in the same list.
  let dragged = null;
  form.addEventListener("dragstart", (event) => {
    dragged = event.target.closest?.("[data-widgets] li") ?? null;
    if (dragged) event.dataTransfer.effectAllowed = "move";
  });
  form.addEventListener("dragover", (event) => {
    const over = event.target.closest?.("[data-widgets] li");
    if (!dragged || !over || over === dragged || over.parentElement !== dragged.parentElement)
      return;
    event.preventDefault();
    const box = over.getBoundingClientRect();
    if (event.clientY > box.top + box.height / 2) over.after(dragged);
    else over.before(dragged);
  });
  form.addEventListener("dragend", () => {
    if (!dragged) return;
    const region = dragged.closest("[data-region]");
    region.querySelector("[name=layout_widgets]").checked = false;
    dragged = null;
    changed(region);
  });

  // Key order apart: a theme's props in another order are no change.
  const canonical = (value) =>
    JSON.stringify(value, (_, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort())
        : v,
    );

  /**
   * The box's entries with the photo wall's settings on each `photo` entry: only the props that
   * differ from the wall's defaults (contracts/screen.md, Photos), so an untouched wall saves none.
   */
  function withWall(r, entries) {
    const wall = r.querySelector("[data-photo-wall]");
    if (!wall) return entries;
    const seconds = wall.querySelector("[name=photo_seconds]").value;
    const order = wall.querySelector("[name=photo_order]").value;
    const pop = wall.querySelector("[name=pop_new]").checked;
    return entries.map((e) => {
      if (e.widget !== "photo") return e;
      const props = { ...(e.props || {}) };
      for (const key of ["photo_seconds", "order", "pop_new"]) Reflect.deleteProperty(props, key);
      if (seconds !== "") props.photo_seconds = Number(seconds);
      if (order !== "newest") props.order = order;
      if (!pop) props.pop_new = false;
      const next = { ...e, props };
      if (Object.keys(props).length === 0) delete next.props;
      return next;
    });
  }

  // The zone the form says, on top of what was read, so fields Studio does not edit are kept.
  function zone() {
    const f = form.elements;
    const z = structuredClone(original);
    delete z.revision;
    z.name = f.name.value.trim();
    z.header = f.header.value || null;
    z.hub_qr = f.hub_qr.value;
    const screenName = form.querySelector("[name=screen_name]");
    if (screenName) z.screen_name = screenName.value;
    z.sound = { enabled: f.sound_enabled.checked, device_id: f.sound_device.value || null };
    for (const r of regions()) {
      const id = r.dataset.region;
      const s = { ...(z.regions[id] || {}) };
      const listed = entriesOf(r);
      const entries = withWall(r, listed);
      // A wall setting on the layout's widgets makes them the box's own, so the setting is kept.
      const changedWall = canonical(entries) !== canonical(listed);
      if (r.querySelector("[name=layout_widgets]").checked && !changedWall) delete s.widgets;
      else s.widgets = entries;
      const set = (name, value, fallback) => {
        if (value === fallback && !(name in (original.regions[id] || {})))
          Reflect.deleteProperty(s, name);
        else s[name] = value;
      };
      // The hero's default is the Director's (contracts/screen.md, The Director).
      set("rotation", r.querySelector("[name=rotation]").value, r.dataset.rotation);
      const indicator = r.querySelector("[name=indicator]");
      if (indicator) set("indicator", indicator.value, "line");
      set("idle", r.querySelector("[name=idle]").value || "logo", "logo");
      set("skip_empty", r.querySelector("[name=skip_empty]").checked, true);
      const dwell = r.querySelector("[name=dwell_seconds]").value;
      if (dwell === "") delete s.dwell_seconds;
      else s.dwell_seconds = Number(dwell);
      if (Object.keys(s).length > 0) z.regions[id] = s;
      else Reflect.deleteProperty(z.regions, id);
    }
    boxes.apply(z);
    return z;
  }

  // Changes: each control that differs from the page as drawn, by its label, then each region
  // whose widgets differ, by the widgets' names.
  const shown = (el, value) => {
    if (el.type === "checkbox") return say(value ? "change.on" : "change.off");
    if (el.tagName === "SELECT")
      return [...el.options].find((o) => o.value === value)?.textContent.trim() ?? value;
    return value === "" ? `${say("change.default")} (${el.placeholder || "–"})` : value;
  };
  const valueOf = (el) => (el.type === "checkbox" ? el.checked : el.value);
  const controls = [...form.elements].filter(
    (el) => el.name && el.name !== "add" && el.type !== "submit",
  );
  const before = new Map(controls.map((el) => [el, valueOf(el)]));
  const widgetsBefore = new Map(regions().map((r) => [r, entriesOf(r)]));
  const nameOfWidget = (r, entry) =>
    r
      .querySelector(`[name=add] option[value="${CSS.escape(String(entry.widget))}"]`)
      ?.textContent.trim() ?? String(entry.widget);
  function changes() {
    const lines = [];
    for (const [el, was] of before) {
      const now = valueOf(el);
      if (now === was) continue;
      const label =
        form.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim() ?? el.name;
      const region = el.closest("[data-region]");
      const what = region ? `${region.dataset.label}: ${label}` : label;
      lines.push(say("change.field", { what, from: shown(el, was), to: shown(el, now) }));
    }
    for (const [r, was] of widgetsBefore) {
      const now = entriesOf(r);
      const key = (e) => JSON.stringify(e);
      const region = r.dataset.label;
      const gone = was.filter((e) => !now.some((n) => key(n) === key(e)));
      const added = now.filter((e) => !was.some((w) => key(w) === key(e)));
      for (const e of added)
        lines.push(say("change.added", { region, widget: nameOfWidget(r, e) }));
      for (const e of gone)
        lines.push(say("change.removed", { region, widget: nameOfWidget(r, e) }));
      // The widgets both lists hold, in each list's order: a move among them is a new order.
      const kept = (list, other) =>
        list
          .filter((e) => other.some((o) => key(o) === key(e)))
          .map(key)
          .join();
      if (kept(now, was) !== kept(was, now)) lines.push(say("change.order", { region }));
    }
    return [...boxes.changes(), ...lines];
  }
  const list = form.querySelector("[data-changes]");
  const save = form.querySelector("[data-save]");
  const discard = form.querySelector("[data-discard]");
  // A gap is a warning, not a change: it never enables Go live, and saving with it is allowed.
  function gapLine({ text, fills }, i) {
    const li = document.createElement("li");
    li.className = "canccu-studio-changes__gap";
    const icon = document.createElement("span");
    icon.className = "canccu-i canccu-i--warn";
    icon.setAttribute("aria-hidden", "true");
    const words = document.createElement("span");
    words.textContent = text;
    li.append(icon, words);
    if (fills) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "canccu-button canccu-button--secondary canccu-button--sm";
      button.dataset.fillGap = String(i);
      button.textContent = say("gap.fill");
      li.append(button);
    }
    return li;
  }
  function changed(region) {
    if (region) refreshRegion(region);
    const lines = changes();
    list.replaceChildren(
      ...(lines.length ? lines : [say("change.none")]).map((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        if (!lines.length) li.className = "canccu-muted";
        return li;
      }),
      ...boxes.gaps().map(gapLine),
    );
    save.disabled = lines.length === 0;
    discard.disabled = lines.length === 0;
  }
  form.addEventListener("input", (event) => changed(event.target.closest("[data-region]")));
  form.addEventListener("change", (event) => changed(event.target.closest("[data-region]")));
  regions().forEach(refreshRegion);
  // A layout picked in the gallery is a change from the first moment.
  changed();
  // Discard goes back to the zone as saved, also from a layout picked in the gallery.
  discard.addEventListener("click", () => location.assign(location.pathname));
  // Another layout redraws the page with it, so changes not yet live would be lost.
  const picked = (form.dataset.layout || null) !== original.layout_id;
  for (const link of form.querySelectorAll("[data-layout-pick]")) {
    link.addEventListener("click", (event) => {
      if (changes().length > (picked ? 1 : 0) && !window.confirm(say("layout.discard")))
        event.preventDefault();
    });
  }

  // A true preview: the server composes the zone as it would be saved, and the real player draws it.
  const frame = form.querySelector("iframe[data-preview]");
  form.querySelector("[data-zone-preview]").addEventListener("click", async () => {
    const at = previewAt(document);
    const query = at === null ? "" : `?at=${encodeURIComponent(at)}`;
    const r = await api("POST", `${url}/preview${query}`, zone());
    if (!r.ok) return show(failure(r));
    frame.contentWindow.postMessage({ type: PREVIEW_MESSAGE, state: r.data }, location.origin);
  });

  screenPreview(document, { api, failure, say, zone });

  async function put(body) {
    const r = await api("PUT", url, body);
    if (r.status === 409 && r.data?.error?.code === "version_conflict") {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "canccu-button canccu-button--secondary canccu-button--sm";
      again.textContent = say("zone.reload");
      again.addEventListener("click", () => location.reload());
      show(say("zone.conflict"), again);
      return null;
    }
    if (!r.ok) {
      show(failure(r));
      return null;
    }
    return r.data;
  }

  // Undo for 10 minutes: the page keeps the zone it replaced and saves it back (contracts/screen.md, Preview).
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saved = await put({ ...zone(), revision: original.revision });
    if (saved === null) return;
    if (saved.revision !== original.revision) {
      const kept = { ...original };
      delete kept.revision;
      sessionStorage.setItem(
        undoKey,
        JSON.stringify({ zone: kept, revision: saved.revision, until: Date.now() + UNDO_MS }),
      );
    }
    reloadWith(say("zone.saved"));
  });
  const undo = JSON.parse(sessionStorage.getItem(undoKey) || "null");
  if (undo && undo.until > Date.now() && undo.revision === original.revision) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "canccu-button canccu-button--secondary canccu-button--sm";
    button.textContent = say("zone.undo");
    button.addEventListener("click", async () => {
      if ((await put({ ...undo.zone, revision: original.revision })) === null) return;
      sessionStorage.removeItem(undoKey);
      reloadWith(say("zone.undone"));
    });
    setTimeout(() => button.remove(), undo.until - Date.now());
    show(notice?.hidden ? say("zone.saved") : notice.textContent, button);
  } else sessionStorage.removeItem(undoKey);
})();
