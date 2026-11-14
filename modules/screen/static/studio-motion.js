/*
 * The Motion card (v8 sheet 11), on top of static/studio.js's helpers. The event's level and
 * Follow the day go to `PUT /api/screen/motion` with the settings version read; each changed pin
 * goes to its zone's `PUT` with the revision read just before, so it never undoes another edit.
 */
"use strict";

(() => {
  const studio = window.canccuStudio;
  const form = document.querySelector("form[data-motion]");
  if (!studio || !form) return;
  const { api, failure, reloadWith, say, show } = studio;
  const pins = JSON.parse(form.dataset.pins);
  const levelNow = () => form.querySelector("[name=motion_level]:checked")?.value;
  const pinNow = (key) => form.elements.namedItem(`pin.${key}`).value || null;
  const before = { level: levelNow(), follow: form.elements.namedItem("follow_the_day").checked };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const level = levelNow();
    const follow = form.elements.namedItem("follow_the_day").checked;
    const event_changed = level !== before.level || follow !== before.follow;
    const changed = Object.keys(pins).filter((key) => pinNow(key) !== pins[key]);
    if (!event_changed && changed.length === 0) {
      show(say("motion.nothing"));
      return;
    }
    if (event_changed) {
      const saved = await api("PUT", "/api/screen/motion", {
        settings_version: Number(form.dataset.version),
        motion_level: level,
        follow_the_day: follow,
      });
      if (!saved.ok) return show(failure(saved));
    }
    for (const key of changed) {
      const url = `/api/screen/zones/${encodeURIComponent(key)}`;
      const read = await api("GET", url);
      if (!read.ok) return show(failure(read));
      const saved = await api("PUT", url, { ...read.data, motion_level: pinNow(key) });
      if (!saved.ok) return show(failure(saved));
    }
    reloadWith(say("motion.saved"));
  });
})();
