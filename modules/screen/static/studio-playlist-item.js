/*
 * One playlist item's fields in the builder (studio-playlist-editor.js): its seconds, a video's
 * own length, a deck's range and time per slide; and, for readers, what it plays in words.
 */
const { say } = window.canccuStudio;

export const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null));
  return node;
};
const isDeck = (kind) => kind === "pptx" || kind === "pdf";

export function numberField(label, value, min, onValue, changed, props = {}) {
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
}

/** An item's own fields: seconds, a video's own length, a deck's range and time per slide. */
export function itemFields(item, asset, slideshow, changed) {
  const set = (key) => (v) => (item[key] = v);
  if (!asset || (slideshow && asset.kind === "image")) return null;
  const out = el("div", { className: "canccu-studio-item__fields" });
  const muted = (key) =>
    el("span", { className: "canccu-small canccu-muted", textContent: say(key) });
  if (isDeck(asset.kind)) {
    out.append(
      muted("playlist.slides_word"),
      numberField(say("playlist.from"), item.slide_start, 1, set("slide_start"), changed, {
        placeholder: "1",
      }),
      el("span", { textContent: "–", ariaHidden: "true" }),
      numberField(say("playlist.to"), item.slide_end, 1, set("slide_end"), changed, {
        placeholder: asset.slides ?? "",
      }),
    );
  }
  const seconds = numberField(
    say(isDeck(asset.kind) ? "playlist.seconds_each" : "playlist.seconds"),
    item.duration_seconds,
    1,
    set("duration_seconds"),
    changed,
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
  out.append(seconds, muted(isDeck(asset.kind) ? "playlist.s_each" : "playlist.s"));
  return out;
}

/** What an item shows to those who read the playlist without editing it. */
export function itemDetail(item, asset, slideshow, imageSeconds) {
  if (!asset) return null;
  if (slideshow && asset.kind === "image") {
    return say("playlist.in_slideshow", { seconds: imageSeconds ?? 10 });
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
