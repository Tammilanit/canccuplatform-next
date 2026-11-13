// The Settings form's save bar (docs/design/mockups.html, sheet 4). Each control carries what is
// saved (data-canccu-was, in the words control_value in forms.py writes); the bar counts the
// controls that differ, each shows "Was 45." while it does, and Undo puts them back. Save posts
// without leaving the page, so a save that fails keeps the change in the form. Without this script
// the form posts as usual and the server answers the same states.
const FORM = "form[data-canccu-settings]";
const phone = matchMedia("(max-width: 1099.98px)");

const read = (el) => {
  if (el.type === "checkbox") return el.checked ? "on" : "";
  if ("canccuList" in el.dataset) {
    const parts = el.value.split(",").map((part) => part.trim());
    return parts.filter(Boolean).join(", ");
  }
  return el.value;
};

function refresh() {
  const form = document.querySelector(FORM);
  if (!form) return;
  let changed = 0;
  let bad = 0;
  for (const el of form.querySelectorAll("[data-canccu-was]")) {
    const field = el.closest(".canccu-field");
    const differs = read(el) !== el.dataset.canccuWas;
    const invalid = !el.checkValidity();
    if (differs) changed++;
    if (invalid) bad++;
    field.querySelector("[data-canccu-was-hint]").hidden = !differs || invalid;
    const error = field.querySelector("[data-canccu-error]");
    if (error) error.hidden = !invalid;
    if (invalid) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }
  // Saved and a change are never shown together.
  if (changed) form.querySelector("[data-canccu-saved]")?.remove();
  const text = form.querySelector("[data-canccu-count]");
  text.textContent = bad
    ? `${bad} ${bad === 1 ? "field needs" : "fields need"} fixing before you can save`
    : `${changed} ${changed === 1 ? "change" : "changes"} not saved`;
  text.classList.toggle("is-down", bad > 0);
  form.querySelector("[data-canccu-save]").disabled = bad > 0;
  form.querySelector("[data-canccu-savebar]").hidden = !changed && !bad;
}

function undo(form) {
  for (const el of form.querySelectorAll("[data-canccu-was]")) {
    if (el.type === "checkbox") el.checked = el.dataset.canccuWas === "on";
    else el.value = el.dataset.canccuWas;
  }
  form.querySelector("[data-canccu-failed]")?.remove();
  form.querySelector("[data-canccu-unanswered]").hidden = true;
  form.querySelector("[data-canccu-save]").textContent = "Save";
  refresh();
}

// Caddy answers 502 for a part that is down: to the organiser, that is no answer. Any redirect
// but the saved one is a page's answer to an ended session: on to sign-in (app._not_signed_in).
function unsaved(res) {
  const kept = "Your change is still in the form.";
  if (!res || res.status >= 500) return `The platform didn't answer. ${kept}`;
  if (res.redirected)
    return `You were signed out. Sign in again in another tab, then save again. ${kept}`;
  return `The platform refused the change (HTTP ${res.status}). ${kept}`;
}

async function save(form) {
  const button = form.querySelector("[data-canccu-save]");
  button.disabled = true;
  let res = null;
  try {
    // Followed, so the two 303s can be told apart: a saved form goes to its page with "Saved",
    // an ended session to sign-in.
    res = await fetch(location.pathname, {
      method: "POST",
      body: new URLSearchParams(new FormData(form)),
    });
  } catch {
    // Nothing answered; the form keeps the change below.
  }
  if (res?.redirected && new URL(res.url).searchParams.has("saved")) {
    location.assign(res.url);
    return;
  }
  // A refused save answers the form again, with what was typed and why (settings_form.py).
  const next =
    res &&
    !res.redirected &&
    res.headers.get("content-type")?.startsWith("text/html")
      ? new DOMParser()
          .parseFromString(await res.text(), "text/html")
          .querySelector(FORM)
      : null;
  if (next) {
    form.replaceWith(next);
  } else {
    form.querySelector("[data-canccu-failed]")?.remove();
    const notice = form.querySelector("[data-canccu-unanswered]");
    notice.querySelector(".canccu-notice__body > p:last-child").textContent =
      unsaved(res);
    notice.hidden = false;
    button.textContent = "Save again";
  }
  button.disabled = false;
  refresh();
  document
    .querySelector(`${FORM} .canccu-notice`)
    ?.scrollIntoView({ block: "nearest" });
}

document.addEventListener("input", refresh);
document.addEventListener("change", refresh);
document.addEventListener("click", (event) => {
  const link = event.target.closest(`${FORM} [data-canccu-undo]`);
  if (!link) return;
  event.preventDefault();
  undo(link.closest(FORM));
});
document.addEventListener("submit", (event) => {
  if (!event.target.matches(FORM)) return;
  event.preventDefault();
  save(event.target);
});

// On a phone the bar steps aside while the page scrolls and comes back when it stops.
let still;
addEventListener(
  "scroll",
  () => {
    const bar = document.querySelector("[data-canccu-savebar]");
    if (!bar || !phone.matches) return;
    bar.classList.add("is-away");
    clearTimeout(still);
    still = setTimeout(() => bar.classList.remove("is-away"), 400);
  },
  { passive: true },
);

refresh();
