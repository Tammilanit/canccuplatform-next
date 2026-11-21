// The Settings form's save bar (docs/design/mockups.html, sheet 4). Each control carries what is
// saved (data-canccu-was, in the words control_value in forms.py writes); the bar counts the
// controls that differ, each shows "Was 45." while it does, and Undo puts them back. Save posts
// without leaving the page, so a save that fails keeps the change in the form. Without this script
// the form posts as usual and the server answers the same states. The form also posts the values
// it was built from (was.<key>), so after a conflict only the fields the user changed keep what
// they typed (settings_form.kept_after_conflict). The controls (controls.py, #732): a quick pick
// or a stepper's button sets its number, a row of chips reads as the ticked values, a link's
// preview follows the typing, and this device's time zone joins the zone list's Suggested.
const FORM = "form[data-canccu-settings]";
const phone = matchMedia("(max-width: 1099.98px)");
// One save at a time: an edit while a save is out must not enable Save again (refresh).
let saving = false;

const read = (el) => {
  if (el.type === "checkbox") return el.checked ? "on" : "";
  if (el.tagName === "FIELDSET")
    return [...el.querySelectorAll("input:checked")]
      .map((chip) => chip.value)
      .join(", ");
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
    if (error) {
      error.hidden = !invalid;
      // An emptied field is not out of bounds: it has no value at all.
      error.textContent = el.validity.valueMissing
        ? "Needs a value."
        : error.dataset.canccuError;
    }
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
  form.querySelector("[data-canccu-save]").disabled = bad > 0 || saving;
  form.querySelector("[data-canccu-savebar]").hidden = !changed && !bad;
}

// Opens only a web address, as the server's preview does (controls.preview).
const WEB = /^https?:\/\/[^\s/?#]+\S*$/;
function preview(el) {
  const link = el
    .closest(".canccu-field")
    ?.querySelector("[data-canccu-preview]");
  if (!link) return;
  const page = WEB.test(el.value) ? el.value : "";
  link.hidden = !page;
  link.href = page;
  link.textContent = page ? `Open ${page}` : "";
}

function undo(form) {
  for (const el of form.querySelectorAll("[data-canccu-was]")) {
    if (el.type === "checkbox") el.checked = el.dataset.canccuWas === "on";
    else if (el.tagName === "FIELDSET") {
      const was = el.dataset.canccuWas.split(", ");
      for (const chip of el.querySelectorAll("input"))
        chip.checked = was.includes(chip.value);
    } else el.value = el.dataset.canccuWas;
    if (el.type === "url") preview(el);
  }
  form.querySelector("[data-canccu-failed]")?.remove();
  form.querySelector("[data-canccu-unanswered]").hidden = true;
  form.querySelector("[data-canccu-save]").textContent = "Save";
  refresh();
}

// Caddy answers 502 for a part that is down: to the organiser, that is no answer. Any redirect
// but the saved one went to sign-in: for an ended session (pages.not_signed_in), or for a session
// whose role was taken (pages.page_error_handler), where the sign-in page shows "No role yet"
// and signing in again would not help.
function unsaved(res, page) {
  const kept = "Your change is still in the form.";
  if (!res || res.status >= 500) return `The platform didn't answer. ${kept}`;
  if (res.redirected && page?.querySelector("[data-canccu-no-role]"))
    return `You no longer have a role here, so this can't be saved. Ask an event owner. ${kept}`;
  if (res.redirected)
    return `You were signed out. Sign in again in another tab, then save again. ${kept}`;
  return `The platform refused the change (HTTP ${res.status}). ${kept}`;
}

// Posts the form; true when the save went through and the page is on its way to "Saved".
async function post(form) {
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
    return true;
  }
  // A refused save answers the form again, with what was typed and why (settings_form.py).
  const page = res?.headers.get("content-type")?.startsWith("text/html")
    ? new DOMParser().parseFromString(await res.text(), "text/html")
    : null;
  const next = res && !res.redirected ? page?.querySelector(FORM) : null;
  if (next) {
    form.replaceWith(next);
  } else {
    form.querySelector("[data-canccu-failed]")?.remove();
    const notice = form.querySelector("[data-canccu-unanswered]");
    notice.querySelector(".canccu-notice__body > p:last-child").textContent =
      unsaved(res, page);
    notice.hidden = false;
    form.querySelector("[data-canccu-save]").textContent = "Save again";
  }
  return false;
}

async function save(form) {
  if (saving) return;
  saving = true;
  refresh();
  let leaving = false;
  try {
    leaving = await post(form);
  } finally {
    // Saved: Save stays off while the page goes to "Saved".
    if (!leaving) {
      saving = false;
      refresh();
      document
        .querySelector(`${FORM} .canccu-notice`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }
}

document.addEventListener("input", (event) => {
  if (event.target?.type === "url") preview(event.target);
  refresh();
});
document.addEventListener("change", refresh);
// A quick pick or a stepper's button: the number changes as if typed, so the bar counts it.
document.addEventListener("click", (event) => {
  const button =
    event.target.closest("[data-canccu-pick]") ??
    event.target.closest("[data-canccu-step]");
  const input = button && document.getElementById(button.dataset.canccuFor);
  if (!input) return;
  if ("canccuPick" in button.dataset) input.value = button.dataset.canccuPick;
  // stepUp keeps the number inside its min and max.
  else if (button.dataset.canccuStep === "-1") input.stepDown();
  else input.stepUp();
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
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

// The organiser is usually where the event is: this device's zone joins Suggested, after the
// saved one, when the list has it.
const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
for (const select of document.querySelectorAll("select[data-canccu-zones]")) {
  const suggested = select.querySelector('optgroup[label="Suggested"]');
  const listed = [...select.options].some((o) => o.value === here);
  if (
    !suggested ||
    !listed ||
    [...suggested.options].some((o) => o.value === here)
  )
    continue;
  const option = document.createElement("option");
  option.value = here;
  option.textContent = `${here.replaceAll("_", " ").replaceAll("/", " / ")} (this device)`;
  suggested.append(option);
}

refresh();
