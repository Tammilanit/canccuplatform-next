/*
 * The Content page's playlists and Push now (#264; mockup 10), on studio.js's helpers: the
 * playlist picker, a new playlist, the editor (studio-playlist-editor.js), the library's cards
 * dragged into it, and the push form, whose end follows the event's clock. Every change goes
 * through the JSON API, which checks the right again.
 */
import { pushUntil } from "./studio-playlist-builder.js";
import { ASSET, PAGE, builder } from "./studio-playlist-editor.js";

const { api, failure, reloadWith, say, show } = window.canccuStudio;
const read = (id) => JSON.parse(document.getElementById(id)?.textContent || "null");

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
if (box && doc)
  builder(box, doc, box.dataset.write === "true", read("canccu-studio-library") ?? {});

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
