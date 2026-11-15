/*
 * The ends the Ticker page and Freeze for the event send, on studio.js's helpers. Studio shows
 * every time on the event's clock, so an end typed in is read on it too, never on the browser's
 * own (each form names the zone in `data-time-zone`).
 */
import { nextAt, wallInstant } from "./studio-playlist-builder.js";

const { api, failure, reloadWith, say, show } = window.canccuStudio;

// The ticker, also the phone remote: one line, an end, one tap.
const ticker = document.querySelector("form[data-ticker]");
if (ticker) {
  const field = ticker.elements.text;
  const count = document.getElementById("canccu-studio-ticker-count");
  field.addEventListener("input", () => {
    if (count) count.textContent = say("ticker.chars", { count: field.value.length });
  });
  ticker.elements.at.addEventListener(
    "input",
    () => (ticker.querySelector("[value=at]").checked = true),
  );
  ticker.addEventListener("submit", async (event) => {
    event.preventDefault();
    const choice = new FormData(ticker).get("for");
    let until = null;
    if (choice === "at") {
      const at = ticker.elements.at.value;
      if (!/^\d{2}:\d{2}$/.test(at)) return show(say("ticker.time_needed"));
      until = new Date(nextAt(ticker.dataset.timeZone, Date.now(), at)).toISOString();
    } else if (choice !== "none") {
      until = new Date(Date.now() + Number(choice) * 60_000).toISOString();
    }
    const r = await api("PUT", "/api/screen/ticker", { text: field.value.trim(), until });
    if (!r.ok) return show(failure(r));
    reloadWith(say("ticker.set_done"));
  });
}

// "Freeze for the event" when the event has no end: the end comes from this form.
const freeze = document.querySelector("form[data-freeze]");
if (freeze) {
  freeze.addEventListener("submit", async (event) => {
    event.preventDefault();
    const at = wallInstant(freeze.dataset.timeZone, freeze.elements.until.value);
    const r = await api("PUT", "/api/screen/pin", {
      freeze: true,
      until: new Date(at).toISOString(),
    });
    if (!r.ok) return show(failure(r));
    reloadWith(say("pins.freeze_done"));
  });
}
